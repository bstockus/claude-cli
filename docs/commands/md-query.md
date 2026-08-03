# `md query`

## Synopsis

```text
claude-cli md query <kind> [directory] [options]
```

Runs one focused, read-only query across selected Markdown documents. Matches are
informational and exit `0`.

## Arguments

| Argument    | Required | Description                                                                         |
| ----------- | -------- | ----------------------------------------------------------------------------------- |
| `kind`      | Yes      | `links-to`, `duplicates`, `unused-assets`, `code-blocks`, `tasks`, or `missing-h1`. |
| `directory` | No       | Directory to query. Defaults to the configured workspace root.                      |

## Kind-specific behavior

| Kind            | Relevant options        | Result                                                                    |
| --------------- | ----------------------- | ------------------------------------------------------------------------- |
| `links-to`      | `--target` (required)   | Links resolving to a path and optional heading fragment.                  |
| `duplicates`    | `--field`               | Duplicate `title`, `slug`, `heading-slug`, or `frontmatter:<key>` values. |
| `unused-assets` | `--asset-extension`     | Selected assets not referenced by selected Markdown.                      |
| `code-blocks`   | `--lang`, `--content`   | Fenced code blocks, optionally filtered and expanded.                     |
| `tasks`         | `--status`, `--summary` | GFM tasks or aggregate completion totals.                                 |
| `missing-h1`    | None                    | Documents without a level-one heading.                                    |

For duplicate titles, string frontmatter `title` takes precedence over the first level-one
heading.

## Options

| Option                       | Default             | Description                                          |
| ---------------------------- | ------------------- | ---------------------------------------------------- |
| `--format <fmt>`             | Project default     | `llm`, `human`, or `json`.                           |
| `--paths <style>`            | Project default     | `absolute` or `relative`.                            |
| `--stdin-name <path>`        | None                | Shared option; workspace queries use files.          |
| `--target <path>`            | None                | Target path and optional `#fragment` for `links-to`. |
| `--field <field>`            | `title`             | Duplicate field.                                     |
| `--lang <language>`          | Any                 | Code-block language filter.                          |
| `--content` / `--no-content` | `false`             | Include or exclude code-block bodies.                |
| `--status <status>`          | `all`               | `all`, `done`, or `pending` tasks.                   |
| `--summary` / `--no-summary` | `false`             | Show task totals or individual tasks.                |
| `--asset-extension <ext>`    | `assets.extensions` | Repeatable asset-extension override.                 |
| `--include <glob>`           | `files.include`     | Repeatable include glob.                             |
| `--exclude <glob>`           | `files.exclude`     | Repeatable exclude glob.                             |
| `-h`, `--help`               | —                   | Show help.                                           |

Invalid kinds or incompatible/missing kind-specific options exit `1`.
