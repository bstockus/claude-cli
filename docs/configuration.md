# Project configuration schema

Markdown commands discover `.claude-cli.yml` by walking from the current directory toward
the filesystem root. An explicitly selected file must exist. A discovered or explicit
configuration must set `version: 1`; unknown keys are rejected at every validated level.

Paths in configuration are resolved relative to the directory containing the configuration
file. `root` defaults to that directory. Entry points and rename scan directories must stay
inside the resolved workspace root.

## Complete shape and defaults

This example contains every top-level field and every nested non-command field. Values shown
are built-in defaults unless the comment says otherwise.

```yaml
version: 1 # required when a configuration file is loaded; the only accepted value
root: . # string; workspace root relative to this file

files:
  include: ["**/*.md"] # list of strings
  exclude: [] # list of strings
  entryPoints: [] # list of paths; each must resolve inside root

assets:
  extensions: # list of strings used by the unused-assets query
    - .png
    - .jpg
    - .jpeg
    - .gif
    - .webp
    - .svg
    - .avif
    - .ico
    - .bmp
    - .pdf
    - .mp3
    - .wav
    - .ogg
    - .mp4
    - .webm
    - .mov

markdown:
  renderer: github # the only accepted value

output:
  format: llm # llm, human, json, jsonl, or sarif
  paths: absolute # absolute or relative

checks:
  mermaid: true
  katex: true
  references: true
  markdownlint: false
  frontmatter: true
  graph: true
  toc: true
  external: false

frontmatter:
  schema: schemas/document.yml # optional JSON or YAML Schema path
  rules:
    required: [] # dotted field paths that must exist
    prohibited: [] # dotted field paths that must not exist
    types: {} # field path -> supported JSON type name
    allowedValues: {} # field path -> list of accepted values
    formats: {} # field path -> format string
    patterns: {} # field path -> valid JavaScript regular-expression source
    unique: [] # field paths whose values must be unique across selected files

toc:
  files: [] # workspace-relative globs/files checked by md audit

markdownlint:
  config: .markdownlintrc # optional markdownlint configuration path

urls:
  ignore: [] # URL minimatch globs
  ignoreDomains: [] # domains and their subdomains
  allowedStatuses: [] # integer HTTP statuses from 100 through 599
  cache: true
  cacheTtl: 86400000 # non-negative integer milliseconds
  headFallbackStatuses: [400, 403, 405, 501]
  reportRedirects: false

commands: {} # command-specific defaults; schema documented below
```

Omitted mappings are treated as empty mappings. Lists must contain strings except the two
HTTP-status lists. Every boolean field must be a YAML boolean, not a quoted string.

## Frontmatter rule value types

`frontmatter.rules.types` accepts these exact values:

| Value     | Meaning                   |
| --------- | ------------------------- |
| `string`  | A string value.           |
| `number`  | Any finite numeric value. |
| `integer` | An integer numeric value. |
| `boolean` | `true` or `false`.        |
| `array`   | A YAML sequence.          |
| `object`  | A YAML mapping.           |
| `null`    | A null value.             |

`required`, `prohibited`, and all rule maps use dotted paths such as `metadata.owner`.
Schema validation and shortcut rules are cumulative when both are configured.

## Command-default schema

`commands` is a mapping keyed by an exact `md` command name. Agent commands and
`check-update` cannot be configured here. Unknown command names and unknown option keys are
errors. Positional arguments cannot be configured.

All command mappings may use the shared `format` and `paths` keys. `stdinName` is accepted
only by commands that consume a single file or stdin, as listed below.

| Command key            | Additional accepted keys                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`                 | `style`, `mermaid`, `katex`, `references`, `stdinName`, `changedSince`, `include`, `exclude`                                                                                                               |
| `lint-dir`             | `style`, `summary`, `concurrency`, `mermaid`, `katex`, `references`, `include`, `exclude`, `changedSince`                                                                                                  |
| `refs`                 | `external`, `anchors`, `images`, `stdinName`                                                                                                                                                               |
| `refs-to`              | `include`, `exclude`                                                                                                                                                                                       |
| `headers`              | `maxDepth`, `stdinName`                                                                                                                                                                                    |
| `outline`              | `maxDepth`, `stdinName`                                                                                                                                                                                    |
| `toc`                  | `maxDepth`, `minDepth`, `ordered`, `check`, `write`, `dryRun`, `stdinName`                                                                                                                                 |
| `graph`                | `output`, `entry`, `include`, `exclude`                                                                                                                                                                    |
| `validate-frontmatter` | `schema`, `include`, `exclude`, `stdinName`, `changedSince`                                                                                                                                                |
| `audit`                | `summary`, `external`, `frontmatter`, `graph`, `toc`, `style`, `mermaid`, `katex`, `references`, `concurrency`, `include`, `exclude`, `entry`, `timeout`, `retry`, `changedSince`                          |
| `stats`                | `stdinName`                                                                                                                                                                                                |
| `code-blocks`          | `lang`, `content`, `stdinName`                                                                                                                                                                             |
| `structure`            | `stdinName`                                                                                                                                                                                                |
| `links`                | `brokenOnly`, `type`, `stdinName`                                                                                                                                                                          |
| `section`              | `includeHeading`, `children`, `raw`, `stdinName`                                                                                                                                                           |
| `frontmatter`          | `key`, `stdinName`                                                                                                                                                                                         |
| `tasks`                | `status`, `summary`, `stdinName`                                                                                                                                                                           |
| `tables`               | `content`, `index`, `stdinName`                                                                                                                                                                            |
| `check-urls`           | `timeout`, `concurrency`, `retry`, `includeOk`, `include`, `exclude`, `stdinName`, `changedSince`, `ignore`, `ignoreDomain`, `allowedStatus`, `cache`, `cacheTtl`, `headFallbackStatus`, `reportRedirects` |
| `orphans`              | `include`, `exclude`, `ignore`, `entry`                                                                                                                                                                    |
| `query`                | `include`, `exclude`, `target`, `field`, `lang`, `content`, `status`, `summary`, `assetExtension`                                                                                                          |
| `index`                | `include`, `exclude`                                                                                                                                                                                       |
| `rename-heading`       | `directory`, `dryRun`, `include`, `exclude`                                                                                                                                                                |
| `rename-file`          | `dryRun`, `include`, `exclude`                                                                                                                                                                             |

## Command-option types and constraints

| Keys                                                                                                                                                                                                                                                               | Type and constraint                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                                                                                                                                                                                                                                                           | `llm`, `human`, or `json`; `jsonl` and `sarif` are additionally allowed for `lint`, `lint-dir`, `audit`, `validate-frontmatter`, and `check-urls`. |
| `paths`                                                                                                                                                                                                                                                            | `absolute` or `relative`.                                                                                                                          |
| `style`, `summary`, `external`, `cache`, `reportRedirects`, `check`, `write`, `anchors`, `images`, `ordered`, `content`, `brokenOnly`, `includeHeading`, `children`, `raw`, `includeOk`, `dryRun`, `mermaid`, `katex`, `references`, `frontmatter`, `graph`, `toc` | Boolean.                                                                                                                                           |
| `maxDepth`, `minDepth`                                                                                                                                                                                                                                             | Integer from 1 through 6.                                                                                                                          |
| `timeout`, `concurrency`, `index`                                                                                                                                                                                                                                  | Positive integer. Numeric strings are accepted.                                                                                                    |
| `cacheTtl`, `retry`                                                                                                                                                                                                                                                | Non-negative integer. Numeric strings are accepted.                                                                                                |
| `status`                                                                                                                                                                                                                                                           | `all`, `done`, or `pending`. The `tasks` CLI documents only `done` and `pending`, but configuration also accepts `all`.                            |
| `type`                                                                                                                                                                                                                                                             | `internal`, `external`, `image`, or `anchor`.                                                                                                      |
| `output`                                                                                                                                                                                                                                                           | `report`, `mermaid`, or `dot`.                                                                                                                     |
| `lang`, `key`, `directory`, `schema`, `stdinName`, `changedSince`, `target`, `field`                                                                                                                                                                               | String.                                                                                                                                            |
| `include`, `exclude`, `ignore`, `ignoreDomain`, `entry`, `assetExtension`                                                                                                                                                                                          | List of strings.                                                                                                                                   |
| `allowedStatus`, `headFallbackStatus`                                                                                                                                                                                                                              | List of integer or numeric-string HTTP statuses from 100 through 599.                                                                              |

The `commands.graph.entry`, `commands.audit.entry`, `commands.orphans.entry`, and
`files.entryPoints` paths are resolved relative to the configuration and must remain inside
`root`. `commands.rename-heading.directory` has the same containment rule.
`commands.validate-frontmatter.schema`, every `stdinName`, `frontmatter.schema`, and
`markdownlint.config` are resolved relative to the configuration file.

## Default precedence

For a command invocation, explicit CLI options override `commands.<name>`, which overrides
related top-level settings, which override built-in defaults. Repeatable list options supplied
on the CLI replace configured lists.

URL checks use this more specific chain:

1. Explicit `md check-urls` option.
2. `commands.check-urls` value.
3. Corresponding top-level `urls` value.
4. Built-in default.

## Complete example

```yaml
version: 1
root: .
files:
  include: ["docs/**/*.md", "README.md"]
  exclude: ["docs/archive/**"]
  entryPoints: ["README.md"]
assets:
  extensions: [.png, .svg, .pdf]
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
  frontmatter: true
  graph: true
  toc: true
  external: false
frontmatter:
  schema: schemas/document.yml
  rules:
    required: [title, metadata.owner]
    prohibited: [draftPassword]
    types:
      title: string
      weight: integer
    allowedValues:
      status: [draft, published]
    formats:
      publishedAt: date-time
    patterns:
      slug: "^[a-z0-9-]+$"
    unique: [id, slug]
toc:
  files: [README.md, "docs/**/*.md"]
markdownlint:
  config: .markdownlintrc
urls:
  ignore: ["https://example.invalid/**"]
  ignoreDomains: [private.example.com]
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
    output: report
    entry: [README.md]
  check-urls:
    timeout: 10000
    retry: 2
  rename-heading:
    dryRun: true
```
