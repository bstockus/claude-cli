# `md toc`

## Synopsis

```text
claude-cli md toc <file> [options]
```

Generates a Markdown list from headings using GitHub-compatible anchors. It can also check,
preview, or update a generated block delimited by exactly one ordered marker pair:

```markdown
<!-- claude-cli:toc:start -->
<!-- claude-cli:toc:end -->
```

## Arguments

| Argument | Required | Description                                                                        |
| -------- | -------- | ---------------------------------------------------------------------------------- |
| `file`   | Yes      | Markdown file, or `-` for generation-only stdin use. Writing requires a real file. |

## Options

| Option                       | Default         | Description                                                                  |
| ---------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `--format <fmt>`             | Project default | `llm`, `human`, or `json`.                                                   |
| `--paths <style>`            | Project default | `absolute` or `relative`.                                                    |
| `--stdin-name <path>`        | None            | Logical path for stdin.                                                      |
| `--max-depth <n>`            | `6`             | Maximum included heading depth, 1–6.                                         |
| `--min-depth <n>`            | `1`             | Minimum included heading depth, 1–6.                                         |
| `--ordered` / `--no-ordered` | `false`         | Use numbered lists or bullets.                                               |
| `--check`                    | Off             | Verify that the marker block exists and is current; stale/missing exits `2`. |
| `--dry-run`                  | Off             | Print the proposed marker block without writing.                             |
| `--write`                    | Off             | Replace only the marker interior.                                            |
| `-h`, `--help`               | —               | Show help.                                                                   |

`--check`, `--dry-run`, and `--write` are mutually exclusive. Writes preserve surrounding
content and line endings; current files are not rewritten. `md toc` is one of the commands
that may modify a file, but only when `--write` is selected.
