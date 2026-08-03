# Complete command listing

`claude-cli` contains two toolsets plus update and contract commands. Angle brackets in usage
signatures are required arguments; square brackets are optional arguments.

## Global interface

| Command                   | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `claude-cli --help`       | Show top-level help.                                                   |
| `claude-cli --version`    | Print the installed version.                                           |
| `claude-cli check-update` | Query the configured npm registry for the latest published version.    |
| `claude-cli describe`     | Describe the CLI contract: commands, options, exit codes, and schemas. |
| `claude-cli schema`       | Print a published output schema, or list the available schemas.        |
| `claude-cli agent`        | Convert, validate, and inspect portable agent bundles.                 |
| `claude-cli md`           | Validate, query, analyze, and modify Markdown workspaces.              |

## Agent commands

| Command                                                 | Description                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`agent init <name>`](commands/agent-init.md)           | Scaffold a new portable agent bundle.                                           |
| [`agent add <kind> <name>`](commands/agent-add.md)      | Add one component to an existing bundle.                                        |
| [`agent import <source>`](commands/agent-import.md)     | Import an existing native plugin or project into a portable bundle.             |
| [`agent convert <source>`](commands/agent-convert.md)   | Convert a portable bundle or legacy Claude plugin into target-native artifacts. |
| [`agent upgrade <source>`](commands/agent-upgrade.md)   | Migrate a bundle between neutral schema versions.                               |
| [`agent validate <source>`](commands/agent-validate.md) | Validate a bundle without generating artifacts.                                 |
| [`agent inspect <source>`](commands/agent-inspect.md)   | Show the normalized bundle, references, overrides, and component graph.         |
| [`agent compat [source]`](commands/agent-compat.md)     | Show the compatibility matrix or analyze one bundle against selected targets.   |
| [`agent package <source>`](commands/agent-package.md)   | Build a distributable package with catalogs, checksums, and archives.           |
| [`agent audit <source>`](commands/agent-audit.md)       | Review a bundle's executable surface, permissions, and supply chain.            |
| [`agent doctor [source]`](commands/agent-doctor.md)     | Check a bundle and generated output against the target conformance profiles.    |
| [`agent specs`](commands/agent-specs.md)                | Print the versioned target conformance profiles.                                |

Agent targets are `claude-code`, `codex`, `cursor`, and `all`.

## Markdown commands

The `md` parent accepts `--config <file>` to select a `.claude-cli.yml` file and
`--no-config` to disable discovery. These two options are mutually exclusive.

| Command                                                                                 | Description                                                                       |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`md lint <files...>`](commands/md-lint.md)                                             | Run syntax, reference, and optional style checks across selected Markdown inputs. |
| [`md lint-dir [directory]`](commands/md-lint-dir.md)                                    | Run the lint checks across a directory.                                           |
| [`md refs <file>`](commands/md-refs.md)                                                 | List references from one Markdown document and test local targets.                |
| [`md refs-to <file> [directory]`](commands/md-refs-to.md)                               | Find Markdown documents that reference a target file.                             |
| [`md headers <file>`](commands/md-headers.md)                                           | Extract headings, depths, lines, and GitHub-compatible slugs.                     |
| [`md outline <file>`](commands/md-outline.md)                                           | Render headings as a nested outline.                                              |
| [`md toc <file>`](commands/md-toc.md)                                                   | Generate or synchronize a Markdown table of contents.                             |
| [`md graph [directory]`](commands/md-graph.md)                                          | Analyze the selected Markdown document graph.                                     |
| [`md validate-frontmatter <paths...>`](commands/md-validate-frontmatter.md)             | Validate frontmatter with a schema and configured workspace rules.                |
| [`md audit [directory]`](commands/md-audit.md)                                          | Run composable lint, URL, frontmatter, graph, and TOC checks.                     |
| [`md stats <file>`](commands/md-stats.md)                                               | Report document statistics.                                                       |
| [`md code-blocks <file>`](commands/md-code-blocks.md)                                   | List fenced code blocks and optionally their contents.                            |
| [`md structure <file>`](commands/md-structure.md)                                       | Show a document skeleton of headings, code, lists, and math.                      |
| [`md links <file>`](commands/md-links.md)                                               | List links with context and optional filtering.                                   |
| [`md section <file> <heading>`](commands/md-section.md)                                 | Extract one section by heading text or slug.                                      |
| [`md frontmatter <file>`](commands/md-frontmatter.md)                                   | Parse YAML frontmatter or retrieve one nested key.                                |
| [`md tasks <file>`](commands/md-tasks.md)                                               | Extract GFM task-list items and completion totals.                                |
| [`md tables <file>`](commands/md-tables.md)                                             | List or extract GFM tables.                                                       |
| [`md check-urls <inputs...>`](commands/md-check-urls.md)                                | Validate deduplicated external URLs across selected inputs.                       |
| [`md orphans [directory]`](commands/md-orphans.md)                                      | Find unreferenced Markdown files.                                                 |
| [`md query <kind> [directory]`](commands/md-query.md)                                   | Run a workspace query, by shortcut kind or composable predicates.                 |
| [`md index <action> [directory]`](commands/md-index.md)                                 | Inspect, build, or clear the persistent workspace index.                          |
| [`md context [seeds...]`](commands/md-context.md)                                       | Assemble a reproducible context pack from the reference graph.                    |
| [`md diff <a> [b]`](commands/md-diff.md)                                                | Summarize Markdown changes by structure rather than by text.                      |
| [`md fix <inputs...>`](commands/md-fix.md)                                              | Plan and apply deterministic Markdown fixes.                                      |
| [`md rename-heading <file> <old-heading> <new-heading>`](commands/md-rename-heading.md) | Rename a heading and update matching anchor references.                           |
| [`md rename-file <source> <destination>`](commands/md-rename-file.md)                   | Move a document or asset and update Markdown references.                          |

## Exit codes

| Code | Meaning                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| `0`  | Success, no actionable findings, or an informational query completed.                    |
| `1`  | Usage, configuration, filesystem, network, or other operational error.                   |
| `2`  | Actionable findings, stale generated output, compatibility loss, or an available update. |

See each command page for its exact interpretation of exit code `2`.
