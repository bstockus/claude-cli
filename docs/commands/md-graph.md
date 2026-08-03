# `md graph`

## Synopsis

```text
claude-cli md graph [directory] [options]
```

Builds the selected Markdown document graph and reports inbound/outbound counts, broken
Markdown targets, dead ends, weak components, strongly connected cycles, and reachability.
Without an applicable entry point, reachability is reported as unevaluated.

## Arguments

| Argument    | Required | Description                                                   |
| ----------- | -------- | ------------------------------------------------------------- |
| `directory` | No       | Directory to scan. Defaults to the configured workspace root. |

## Options

| Option                | Default             | Description                                                        |
| --------------------- | ------------------- | ------------------------------------------------------------------ |
| `--format <fmt>`      | Project default     | Report rendering: `llm`, `human`, or `json`.                       |
| `--paths <style>`     | Project default     | `absolute` or `relative`.                                          |
| `--stdin-name <path>` | None                | Shared option; graph scans use files.                              |
| `--output <mode>`     | `report`            | `report`, raw deterministic `mermaid`, or raw deterministic `dot`. |
| `--entry <file>`      | `files.entryPoints` | Repeatable reachability root.                                      |
| `--include <glob>`    | `files.include`     | Repeatable include glob.                                           |
| `--exclude <glob>`    | `files.exclude`     | Repeatable exclude glob.                                           |
| `-h`, `--help`        | —                   | Show help.                                                         |

Broken targets and documents unreachable from applicable entry points exit `2`. Informational
metrics alone exit `0`.
