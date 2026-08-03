# `md audit`

## Synopsis

```text
claude-cli md audit [directory] [options]
```

Runs a bounded workspace audit combining enabled lint, external URL, frontmatter, graph, and
generated-TOC checks. Graph checking is enabled by default. Frontmatter and TOC checks run
when configured; external URL requests remain disabled unless enabled.

## Arguments

| Argument    | Required | Description                                                    |
| ----------- | -------- | -------------------------------------------------------------- |
| `directory` | No       | Directory to audit. Defaults to the configured workspace root. |

## Options

| Option                               | Default                       | Description                                         |
| ------------------------------------ | ----------------------------- | --------------------------------------------------- |
| `--format <fmt>`                     | Project default               | `llm`, `human`, `json`, `jsonl`, or `sarif`.        |
| `--paths <style>`                    | Project default               | `absolute` or `relative`.                           |
| `--stdin-name <path>`                | None                          | Shared option; audits normally use directory input. |
| `--summary` / `--no-summary`         | `false`                       | Select summarized or detailed findings.             |
| `--external` / `--no-external`       | `checks.external` (`false`)   | Toggle external URL checking.                       |
| `--frontmatter` / `--no-frontmatter` | `checks.frontmatter` (`true`) | Toggle configured frontmatter checks.               |
| `--graph` / `--no-graph`             | `checks.graph` (`true`)       | Toggle graph checks.                                |
| `--toc` / `--no-toc`                 | `checks.toc` (`true`)         | Toggle TOC synchronization checks for `toc.files`.  |
| `-s`, `--style` / `--no-style`       | `checks.markdownlint`         | Toggle markdownlint.                                |
| `--mermaid` / `--no-mermaid`         | `checks.mermaid`              | Toggle Mermaid checks.                              |
| `--katex` / `--no-katex`             | `checks.katex`                | Toggle KaTeX checks.                                |
| `--references` / `--no-references`   | `checks.references`           | Toggle reference checks.                            |
| `--concurrency <n>`                  | CPU count, clamped to 1–8     | Positive maximum concurrent checks.                 |
| `--timeout <ms>`                     | `5000`                        | Positive external URL timeout.                      |
| `--retry <n>`                        | `1`                           | Non-negative external URL retry count.              |
| `--changed-since <revision>`         | None                          | Restrict selected Markdown inputs to Git changes.   |
| `--entry <file>`                     | `files.entryPoints`           | Repeatable graph reachability entry point.          |
| `--include <glob>`                   | `files.include`               | Repeatable include glob.                            |
| `--exclude <glob>`                   | `files.exclude`               | Repeatable exclude glob.                            |
| `-h`, `--help`                       | —                             | Show help.                                          |

JSON output is one object containing enabled/skipped checks, totals, normalized findings, and
graph metrics. Exit `0` means the audit passed, `1` is an operational error, and `2` means
actionable findings were found.
