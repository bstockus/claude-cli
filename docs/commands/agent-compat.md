# `agent compat`

## Synopsis

```text
claude-cli agent compat [source] [options]
```

Without `source`, prints the general platform compatibility matrix. With `source`, analyzes
that bundle and identifies exact, approximate, unsupported, or target-specific mappings.

## Arguments

| Argument | Required | Description                                                                   |
| -------- | -------- | ----------------------------------------------------------------------------- |
| `source` | No       | Optional bundle root to analyze. Omit it for the static compatibility matrix. |

## Options

| Option              | Default                | Description                                                    |
| ------------------- | ---------------------- | -------------------------------------------------------------- |
| `--target <target>` | All applicable targets | Repeatable target: `claude-code`, `codex`, `cursor`, or `all`. |
| `--strict`          | Off                    | Treat approximations as blocking findings.                     |
| `--format <fmt>`    | `llm`                  | Output as `llm`, `human`, or `json`. Shorthands: `-fh`, `-fj`. |
| `-h`, `--help`      | —                      | Show help.                                                     |

Compatibility findings use exit `2`; invocation and I/O errors use exit `1`.
