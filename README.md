# claude-cli

An agent-agnostic CLI toolkit for working with Markdown files and related assets. Despite
the name, `claude-cli` is intended to support all LLM coding agents, as well as humans and
CI systems; its commands do not depend on Claude or any model-provider API.

Published as `@bstockus/claude-cli` on the GitHub Packages npm registry; the installed
binary is named `claude-cli`.

## Install

The package is private, so npm needs to know where the `@bstockus` scope lives and how to
authenticate. Add this to your **`~/.npmrc`** once, using a GitHub personal access token
with the `read:packages` scope:

```ini
@bstockus:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<YOUR_PAT>
```

Then:

```bash
npm install -g @bstockus/claude-cli   # global `claude-cli` binary
npx @bstockus/claude-cli md lint FILE # one-off, no install
```

### Keeping a stable path across Node upgrades

`npm install -g` places the binary inside the active Node install. Under a version manager
such as nvm that directory changes on every Node upgrade, which silently breaks anything
holding an absolute path to the CLI (Claude Code hooks, for example). Pin a stable path:

```bash
mkdir -p ~/.local/bin
ln -sf "$(npm root -g)/@bstockus/claude-cli/dist/cli.js" ~/.local/bin/claude-cli
```

Make sure `~/.local/bin` is on your `PATH`.

## Development

```bash
git clone git@github.com:bstockus/claude-cli.git
cd claude-cli
npm ci

npm test           # builds dist/ via `pretest`, then runs unit/integration/e2e suites
npm run test:watch
npm run build      # tsc -> dist/
npm run lint       # ESLint
npm run format     # Prettier (write); `npm run format:check` in CI
npm run typecheck  # tsc --noEmit

npm link           # expose the working tree as the global `claude-cli`
npm unlink -g @bstockus/claude-cli
```

The e2e suite spawns the **compiled** `dist/cli.js`, so a build must precede it — `pretest`
handles that automatically.

## Releasing

Releases are fully automated. Every push to `main` runs
[semantic-release](https://github.com/semantic-release/semantic-release), which derives the
next version from the commit messages, tags it, writes `CHANGELOG.md`, creates a GitHub
Release, and publishes to GitHub Packages. Nothing is versioned by hand — `version` in
`package.json` is managed by the release job.

Commits **must** follow [Conventional Commits](https://www.conventionalcommits.org/); a
`commit-msg` hook and a CI job both enforce it.

| Commit prefix                    | Effect        |
| -------------------------------- | ------------- |
| `fix:` / `perf:`                 | patch release |
| `feat:`                          | minor release |
| `feat!:` or `BREAKING CHANGE:`   | major release |
| `chore:` `docs:` `test:` `ci:` … | no release    |

## Update checks

The CLI checks whether a newer version has been published and prints a notice:

```text
Update available 1.0.3 → 1.1.0
Run npm install -g @bstockus/claude-cli to update.
```

The check runs **at most once every 24 hours**, in a detached background process, so it
never delays a command. The notice itself is printed from the cached result, which means
it appears at most 24 hours after a release.

It is deliberately silent unless it is safe and useful to speak. No notice is printed when:

- stderr is not a TTY — output is being piped or parsed
- `--format json`, `jsonl`, or `sarif` is in use
- `CI` is set
- `CLAUDE_CLI_NO_UPDATE_NOTIFIER=1` is set

Set `CLAUDE_CLI_NO_UPDATE_NOTIFIER=1` to disable the feature entirely, including the
background refresh.

The cached result lives at `${XDG_CACHE_HOME:-~/.cache}/claude-cli/update-check.json` and
can be deleted at any time to force a fresh check.

### `check-update`

Checks immediately, querying the registry directly rather than reading the 24h cache.

```bash
claude-cli check-update
claude-cli check-update --format json
```

Exit codes:

- `0` - Already on the latest version
- `1` - Could not reach the registry
- `2` - A newer version is available

## Common Options

All `md` subcommands support:

- `--format <fmt>` - Output format: `llm` (default), `human`, or `json`; `lint`,
  `lint-dir`, `audit`, `validate-frontmatter`, and `check-urls` also support `jsonl` and `sarif`
- `-fh` - Shorthand for `--format=human`
- `-fj` - Shorthand for `--format=json`
- `--paths <style>` - Display paths as `absolute` (default) or `relative` to the workspace
- `--stdin-name <path>` - Give stdin a workspace path when file-relative links must be resolved
- `--config <file>` - Use a specific `.claude-cli.yml`
- `--no-config` - Disable automatic project configuration discovery

### Project configuration

For `md` commands, the CLI searches from the current directory upward for
`.claude-cli.yml`. Command-line options override command-specific settings, which override
top-level settings, which override built-in defaults. Configuration-derived paths are
relative to the configuration file; explicit CLI paths remain relative to the invocation
directory.

```yaml
version: 1
root: docs

files:
  include: ["**/*.md"]
  exclude: ["archive/**", "generated/**"]
  entryPoints: ["docs/README.md"]

markdown:
  renderer: github

output:
  format: llm
  paths: relative

checks:
  mermaid: true
  katex: true
  references: true
  markdownlint: false
  graph: true
  frontmatter: true
  toc: true
  external: false

frontmatter:
  schema: schemas/document.yml
  rules:
    required: [title, metadata.owner]
    prohibited: [draftPassword]
    types: { title: string }
    allowedValues: { status: [draft, published] }
    formats: { publishedAt: date-time }
    patterns: { slug: "^[a-z0-9-]+$" }
    unique: [id, slug]

toc:
  files: ["README.md", "guides/**/*.md"]

markdownlint:
  config: .markdownlintrc

urls:
  ignore: ["https://example.invalid/**"]
  ignoreDomains: ["private.example.com"]
  allowedStatuses: [401, 403]
  cache: true
  cacheTtl: 86400000
  headFallbackStatuses: [400, 403, 405, 501]
  reportRedirects: false

commands:
  lint-dir:
    summary: true
    concurrency: 4
  toc:
    minDepth: 2
    maxDepth: 4
  graph:
    entry: [docs/README.md]
  audit:
    summary: true
```

`commands` uses the CLI command names and camel-case option names. It accepts defaults for
each command's non-positional options. Boolean defaults can always be reversed with the
corresponding `--no-*` option. Repeated CLI list options replace configured lists.
For URL checks, CLI options override `commands.check-urls`, which overrides the top-level
`urls` values shown above, which override the built-in defaults.

Directory commands use the configured include/exclude globs consistently. `.git` and
`node_modules` are always excluded, and directory symlinks are not followed. `lint-dir` and
`orphans` default to the workspace root when their directory argument is omitted;
`refs-to` uses it as the default search directory.

### Exit Codes

- `0` - Success / no issues
- `1` - Usage error (file not found, heading not found, etc.)
- `2` - Actionable issues found (broken links, orphans, etc.)

## Commands

### Validation

#### `md lint <files...>`

Run checks on a single markdown file (mermaid, KaTeX, references).

```bash
claude-cli md lint path/to/file.md
claude-cli md lint --style path/to/file.md
claude-cli md lint "docs/**/*.md" --changed-since origin/main --format sarif
```

Options:

- `-s, --style` - Include markdown style checks (markdownlint)
- `--[no-]mermaid` - Enable or disable Mermaid checks
- `--[no-]katex` - Enable or disable KaTeX checks
- `--[no-]references` - Enable or disable reference checks
- `--changed-since <revision>` - Intersect inputs with changed and untracked Git files

#### `md lint-dir [directory]`

Run checks on all markdown files in a directory.

```bash
claude-cli md lint-dir path/to/directory/
claude-cli md lint-dir --style path/to/directory/
claude-cli md lint-dir --summary path/to/directory/
```

Options:

- `-s, --style` - Include markdown style checks (markdownlint)
- `--summary` - Show one line per file with pass/fail and issue count
- `--concurrency <n>` - Maximum files checked concurrently
- `--include <glob>` / `--exclude <glob>` - Override workspace selection (repeatable)
- `--[no-]mermaid`, `--[no-]katex`, `--[no-]references` - Override configured checks
- `--changed-since <revision>` - Check only selected changed and untracked files

#### `md check-urls <inputs...>`

Validate external URLs in files, directories, globs, or stdin. URLs are deduplicated across the
selection while every source occurrence is retained in the report.

```bash
claude-cli md check-urls path/to/file.md
claude-cli md check-urls --include-ok --timeout 10000 path/to/file.md
claude-cli md check-urls docs "guides/**/*.md" --report-redirects --format jsonl
cat doc.md | claude-cli md check-urls - --stdin-name docs/doc.md
```

Options:

- `--timeout <ms>` - Request timeout per URL in milliseconds (default: 5000)
- `--concurrency <n>` - Maximum concurrent requests (default: 5)
- `--retry <n>` - Number of retries on failure (default: 1)
- `--include-ok` - Include successful URLs in output (default: failures only)
- `--ignore <glob>` / `--ignore-domain <domain>` - Ignore URLs (repeatable)
- `--allowed-status <code>` - Treat a status as successful (repeatable)
- `--[no-]cache`, `--cache-ttl <ms>` - Control raw-result caching (default: 24 hours)
- `--head-fallback-status <code>` - Status that retries with GET (repeatable)
- `--report-redirects` - Include redirect state and final destinations
- `--changed-since <revision>` - Intersect the input selection with Git changes

The cache is `${XDG_CACHE_HOME:-~/.cache}/claude-cli/url-checks.json`; missing, stale, corrupt,
or unwritable cache data is treated as a miss. HEAD falls back to GET on 400, 403, 405, and 501
by default.

#### `md validate-frontmatter <paths...>`

Validate one Markdown file or all selected files in a directory. A local JSON or YAML
Schema can be supplied with `--schema`; configured schema and shortcut rules are applied
cumulatively. Repeated `--include` and `--exclude` options override workspace selection.
Files, directories, globs, stdin, and `--changed-since` are supported.

```bash
claude-cli md validate-frontmatter docs --schema schemas/document.yml
```

#### `md audit [directory]`

Run configured lint, reference, graph, frontmatter, and generated-TOC checks as one bounded
workspace operation. Graph checking is on by default. Frontmatter and TOC checks run when
configured; external URLs stay offline unless enabled explicitly.

```bash
claude-cli md audit
claude-cli md audit docs --summary --external
claude-cli md audit docs --no-frontmatter --no-toc
```

Use `--[no-]frontmatter`, `--[no-]graph`, and `--[no-]toc` to select workspace checks.
Lint selection, concurrency, include/exclude, graph entry, and URL timeout/retry options
are also available. JSON output is one object containing enabled and skipped checks,
totals, normalized findings, and graph metrics.

JSONL writes one finding/result per line followed by a summary record. SARIF output is SARIF
2.1.0 with checker rule IDs and artifact line locations. Machine payloads go to stdout on success
and stderr when findings cause exit `2`; update notices are suppressed for every machine format.
Paths are absolute unless `--paths relative` is selected.

### References

#### `md refs <file>`

List all references from a markdown file and check if targets exist.

```bash
claude-cli md refs path/to/file.md
claude-cli md refs --external --anchors --images path/to/file.md
```

Options:

- `-e, --external` - Include external URLs
- `-a, --anchors` - Include anchor-only references
- `-i, --images` - Include image references

By default, only local file link references are listed.

#### `md refs-to <file> [directory]`

Find all markdown files that reference a given file.

```bash
claude-cli md refs-to path/to/target.md
claude-cli md refs-to path/to/target.md path/to/search/dir/
```

If no directory is provided, searches from the current working directory.

With project configuration, the default is the configured workspace root. `--include` and
`--exclude` override its file selection.

#### `md links <file>`

List all links with context, grouped by type (internal, external, image, anchor).

```bash
claude-cli md links path/to/file.md
claude-cli md links --broken-only path/to/file.md
claude-cli md links --type external path/to/file.md
```

Options:

- `--broken-only` - Only show broken links
- `--type <type>` - Filter by type: `internal`, `external`, `image`, `anchor`

#### `md orphans [directory]`

Find markdown files not referenced by any other markdown file.

```bash
claude-cli md orphans path/to/docs/
claude-cli md orphans path/to/docs/ --entry README.md --ignore "archive/**"
```

Options:

- `--ignore <glob>` - Glob pattern to exclude (repeatable)
- `--entry <file>` - Entry-point file not considered orphan (repeatable)
- `--include <glob>` / `--exclude <glob>` - Override workspace selection (repeatable)

#### `md graph [directory]`

Build the selected Markdown document graph. The report includes inbound/outbound reference
counts, broken Markdown targets, dead ends, weak components, strongly connected cycles, and
reachability from `--entry` or configured entry points. Without an applicable entry point,
reachability is reported as unevaluated.

```bash
claude-cli md graph docs --entry docs/README.md
claude-cli md graph docs --output mermaid
claude-cli md graph docs --output dot
```

`report` (the default) follows `--format`; Mermaid and DOT are deterministic raw stdout
payloads. Broken targets and unreachable documents exit `2`; informational graph metrics
do not.

### Document Analysis

#### `md headers <file>`

Extract all headings with their line numbers.

```bash
claude-cli md headers path/to/file.md
claude-cli md headers --max-depth 2 path/to/file.md
```

Options:

- `--max-depth <n>` - Maximum heading depth to include (1-6, default: 6)

#### `md outline <file>`

Show headings in an indented outline/tree format.

```bash
claude-cli md outline path/to/file.md
```

Options:

- `--max-depth <n>` - Maximum heading depth to include (1-6, default: 6)

#### `md toc <file>`

Generate a markdown-formatted table of contents from headings.

```bash
claude-cli md toc path/to/file.md
claude-cli md toc --min-depth 2 --ordered path/to/file.md
claude-cli md toc path/to/file.md --check
claude-cli md toc path/to/file.md --dry-run
claude-cli md toc path/to/file.md --write
```

Options:

- `--max-depth <n>` - Maximum heading depth (1-6, default: 6)
- `--min-depth <n>` - Minimum heading depth (1-6, default: 1)
- `--ordered` - Use numbered lists instead of bullets
- `--check` - Exit `2` when the marker block is missing or stale
- `--dry-run` - Print the proposed marker block without writing
- `--write` - Replace only the marker interior

Synchronization uses exactly one ordered marker pair:

```markdown
<!-- claude-cli:toc:start -->
<!-- claude-cli:toc:end -->
```

The three synchronization modes are mutually exclusive. Writes preserve surrounding text
and the file's line-ending style, and current files are not rewritten.

#### `md stats <file>`

Show document statistics: word count, heading counts by depth, link/image counts, code block counts by language, paragraph count, and list counts.

```bash
claude-cli md stats path/to/file.md
```

#### `md code-blocks <file>`

List fenced code blocks with language, line range, and line count.

```bash
claude-cli md code-blocks path/to/file.md
claude-cli md code-blocks --lang typescript --content path/to/file.md
```

Options:

- `--lang <language>` - Filter by language
- `--content` - Include code block content in output

#### `md structure <file>`

Show a bird's-eye structural skeleton of the document — headings, code blocks, math blocks, and lists with their line ranges.

```bash
claude-cli md structure path/to/file.md
```

#### `md section <file> <heading>`

Extract the full content of a section identified by its heading text or slug (case-insensitive match).

```bash
claude-cli md section path/to/file.md "Getting Started"
claude-cli md section path/to/file.md getting-started --raw
claude-cli md section path/to/file.md "Usage" --no-children
```

Options:

- `--[no-]include-heading` - Include or exclude the heading line
- `--[no-]children` - Include or exclude nested subsections
- `--raw` - Output raw markdown only (no metadata, ignores `--format`)

#### `md frontmatter <file>`

Parse and display YAML frontmatter from a markdown file.

```bash
claude-cli md frontmatter path/to/file.md
claude-cli md frontmatter path/to/file.md --key author.name
```

Options:

- `--key <key>` - Extract a specific key (dot notation for nested keys)

#### `md tasks <file>`

Extract GFM task list items (`- [ ]` / `- [x]`) with their completion status.

```bash
claude-cli md tasks path/to/file.md
claude-cli md tasks --status pending path/to/file.md
claude-cli md tasks --summary path/to/file.md
```

Options:

- `--status <status>` - Filter by status: `done`, `pending`
- `--summary` - Show only summary counts, not individual items

#### `md tables <file>`

List or extract GFM tables with location, dimensions, and optionally content.

```bash
claude-cli md tables path/to/file.md
claude-cli md tables --index 1 --content path/to/file.md
```

Options:

- `--content` - Include table content in output
- `--index <n>` - Extract only the nth table (1-based)

### Modification

#### `md rename-file <source> <destination>`

Move a Markdown file or referenced asset within the workspace and update selected inline and
reference-style links/images. Query strings, fragments, root-relative style, and URL encoding are
preserved; outbound relative links in a moved Markdown document are recomputed.

```bash
claude-cli md rename-file docs/old.md guides/new.md --dry-run --format json
claude-cli md rename-file images/old-name.png assets/new-name.png
```

The source and destination must remain inside the workspace. The command refuses symlink or
non-file sources, existing destinations, and missing destination parents. `--include` and
`--exclude` bound the Markdown reference scan.

#### `md rename-heading <file> <old-heading> <new-heading>`

Rename a heading and update all internal anchor references that point to it.

```bash
claude-cli md rename-heading path/to/file.md "Old Name" "New Name" --dry-run
claude-cli md rename-heading path/to/file.md "Old Name" "New Name" --directory path/to/docs/
```

Options:

- `--directory <dir>` - Also update references in other markdown files within this directory
- `--include <glob>` / `--exclude <glob>` - Limit files scanned for cross-file updates
- `--dry-run` - Show what would change without modifying files

Both rename commands can modify files. `toc --write` also updates its explicitly marked block.
Use `--dry-run` before rename operations.

## Checks

- **markdownlint** - Markdown structural and formatting rules (opt-in via `--style`)
- **mermaid** - Mermaid diagram syntax validation
- **katex** - KaTeX math expression validation
- **references** - Link, anchor, and image reference validation

Heading anchors follow GitHub's slugging behavior, including Unicode and duplicate-heading
suffixes. Inline links and full, collapsed, and shortcut reference-style links and images
are all resolved.

The `--style` rule configuration lives in `.markdownlintrc` at the package root and ships
with the published package.

## License

MIT — see [LICENSE](LICENSE).
