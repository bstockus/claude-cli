# `agent inspect`

## Synopsis

```text
claude-cli agent inspect <source> [options]
```

Loads a bundle and displays its normalized representation, component references, target
overrides, and dependency graph. This is a read-only diagnostic command and does not render
target artifacts.

## Arguments

| Argument | Required | Description                    |
| -------- | -------- | ------------------------------ |
| `source` | Yes      | Root of the bundle to inspect. |

## Options

| Option           | Default | Description                                                    |
| ---------------- | ------- | -------------------------------------------------------------- |
| `--format <fmt>` | `llm`   | Output as `llm`, `human`, or `json`. Shorthands: `-fh`, `-fj`. |
| `-h`, `--help`   | —       | Show help.                                                     |

Exit `0` means inspection completed. Invalid bundles, missing paths, and I/O failures exit
`1`; validation findings use exit `2` through the shared agent command boundary.
