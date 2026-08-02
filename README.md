# claude-cli

A generic CLI toolkit for working with markdown files and related assets.

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

Only the three most recent versions are retained in the registry; a weekly job deletes
older ones. Git tags, GitHub Releases and `CHANGELOG.md` are never touched, so the history
of what shipped stays complete.

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
- `--format json` is in use, on any command
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

- `--format <fmt>` - Output format: `llm` (default), `human`, `json`
- `-fh` - Shorthand for `--format=human`
- `-fj` - Shorthand for `--format=json`

### Exit Codes

- `0` - Success / no issues
- `1` - Usage error (file not found, heading not found, etc.)
- `2` - Actionable issues found (broken links, orphans, etc.)

## Commands

### Validation

#### `md lint <file>`

Run checks on a single markdown file (mermaid, KaTeX, references).

```bash
claude-cli md lint path/to/file.md
claude-cli md lint --style path/to/file.md
```

Options:

- `-s, --style` - Include markdown style checks (markdownlint)

#### `md lint-dir <directory>`

Run checks on all markdown files in a directory.

```bash
claude-cli md lint-dir path/to/directory/
claude-cli md lint-dir --style path/to/directory/
claude-cli md lint-dir --summary path/to/directory/
```

Options:

- `-s, --style` - Include markdown style checks (markdownlint)
- `--summary` - Show one line per file with pass/fail and issue count

#### `md check-urls <file>`

Validate external URLs by making HTTP HEAD requests to verify they are reachable.

```bash
claude-cli md check-urls path/to/file.md
claude-cli md check-urls --include-ok --timeout 10000 path/to/file.md
```

Options:

- `--timeout <ms>` - Request timeout per URL in milliseconds (default: 5000)
- `--concurrency <n>` - Maximum concurrent requests (default: 5)
- `--retry <n>` - Number of retries on failure (default: 1)
- `--include-ok` - Include successful URLs in output (default: failures only)

Falls back to GET on 405 Method Not Allowed. Respects 429 rate limiting with Retry-After.

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

#### `md orphans <directory>`

Find markdown files not referenced by any other markdown file.

```bash
claude-cli md orphans path/to/docs/
claude-cli md orphans path/to/docs/ --entry README.md --ignore "archive/**"
```

Options:

- `--ignore <glob>` - Glob pattern to exclude (repeatable)
- `--entry <file>` - Entry-point file not considered orphan (repeatable)

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
```

Options:

- `--max-depth <n>` - Maximum heading depth (1-6, default: 6)
- `--min-depth <n>` - Minimum heading depth (1-6, default: 1)
- `--ordered` - Use numbered lists instead of bullets

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

- `--no-include-heading` - Exclude the heading line from output
- `--no-children` - Exclude nested subsections
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

#### `md rename-heading <file> <old-heading> <new-heading>`

Rename a heading and update all internal anchor references that point to it.

```bash
claude-cli md rename-heading path/to/file.md "Old Name" "New Name" --dry-run
claude-cli md rename-heading path/to/file.md "Old Name" "New Name" --directory path/to/docs/
```

Options:

- `--directory <dir>` - Also update references in other markdown files within this directory
- `--dry-run` - Show what would change without modifying files

This is the only `md` command that modifies files. Use `--dry-run` first.

## Checks

- **markdownlint** - Markdown structural and formatting rules (opt-in via `--style`)
- **mermaid** - Mermaid diagram syntax validation
- **katex** - KaTeX math expression validation
- **references** - Link, anchor, and image reference validation

The `--style` rule configuration lives in `.markdownlintrc` at the package root and ships
with the published package.

## License

MIT — see [LICENSE](LICENSE).
