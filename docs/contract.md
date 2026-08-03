# Machine-readable result contract

`claude-cli` is meant to be run by agents and CI, not only by people. This document is the
contract those consumers can rely on: what each command emits, which stream it lands on, what
the exit code means, and how all of that is allowed to change.

Two commands make the contract self-describing, so nothing here needs to be scraped from
`--help`:

```bash
claude-cli describe --format json          # every command, option, exit code, and schema id
claude-cli describe md graph --format json # one command
claude-cli schema                          # the published schemas
claude-cli schema md-graph                 # one schema document
```

## Contract version

`schemaVersion` (currently `1`) versions the **contract surface**: the envelope shape, the
`describe` payload, the schema id scheme, and the machine-stream guarantees below. It is
hand-owned and unrelated to the package version, which semantic-release manages.

Individual payloads are versioned separately, by the major in their schema id path. A breaking
change to one command's output publishes `v2/<id>.json` and changes that command's
`outputSchema`; it does not bump `schemaVersion`.

## Schema ids

Schema ids look like URLs:

```text
https://github.com/bstockus/claude-cli/schema/v1/md-graph.json
```

They are **identifiers, not fetchable URLs**. Retrieve a schema with `claude-cli schema <id>`.
Every schema is self-contained — no `$ref` leaves its own document — so a retrieved schema can
be compiled on its own.

**No published schema sets `additionalProperties: false`, and consumers must ignore properties
they do not recognize.** Adding a property is a non-breaking change; a consumer that rejects
unknown properties would break on every such change.

## What is and is not a breaking change

| Non-breaking (minor or patch)                | Breaking (major)                              |
| -------------------------------------------- | --------------------------------------------- |
| Adding a property to a payload               | Removing or renaming a property               |
| Adding a command, option, or accepted format | Changing a property's type or meaning         |
| Publishing a schema where the id was `null`  | Moving a payload between stdout and stderr    |
| Relaxing a constraint                        | Changing which exit code a condition produces |
|                                              | Removing a command, option, or format         |

## Exit codes

| Code | Meaning                                  |
| ---- | ---------------------------------------- |
| `0`  | Success; no actionable findings.         |
| `1`  | Invocation, I/O, or configuration error. |
| `2`  | Actionable findings.                     |

Per-command meanings are in `describe` output under `exitCodes`.

## Streams

The general rule is **actionable findings to stderr, clean and informational output to
stdout**. `describe` reports the actual assignment per command under `stream`, because a few
commands deviate. Those deviations are recorded rather than fixed, since changing them would be
breaking:

- `md links --format json` writes to stdout and returns before the broken-link check, so it
  exits `0` even when broken links exist.
- `md graph --output mermaid|dot` writes the diagram to stdout regardless of exit status and
  ignores `--format`.
- Every `agent` subcommand writes to stdout, including the failure result for an invocation
  error.
- `md lint-dir --summary --format json` emits a per-file summary, a different shape from the
  finding list `md lint-dir` emits without `--summary`.
- `md section --raw` and `md frontmatter --key` bypass the JSON shape: the first writes
  markdown, the second writes the raw extracted value, which may be a scalar or `null`.

## The update notice never corrupts a parse

The advisory update notice is written to **stderr only**, and only when every one of these
holds:

- `CLAUDE_CLI_NO_UPDATE_NOTIFIER` is not `1`
- `CI` is unset
- stderr is a TTY
- `--format` is not `json`, `jsonl`, or `sarif`, including a format selected by project
  configuration
- the command is not `check-update`, `describe`, `schema`, or the internal cache refresh

The same gate also blocks the background refresh, so a non-interactive caller never spawns a
child process. `describe` reports these conditions under `machineStreams`, read directly from
the code that enforces them.

## The result envelope

By default every command emits its own payload shape, unchanged from previous releases. Pass
`--envelope` alongside `--format json` for a uniform wrapper:

```bash
claude-cli md graph docs --format json --envelope
```

```json
{
  "schemaVersion": "1",
  "tool": { "name": "@bstockus/claude-cli", "version": "1.6.0" },
  "command": "md graph",
  "ok": false,
  "exitCode": 2,
  "schema": "https://github.com/bstockus/claude-cli/schema/v1/md-graph.json",
  "data": {},
  "summary": { "broken": 2, "unreachable": 1 }
}
```

`data` holds the command's payload **verbatim**, so unwrapping it yields exactly the output of
the same run without the flag. `schema` is `null` for commands whose payload has no published
schema yet. `--envelope` without `--format json` is an error rather than a silent no-op, and
`describe` and `schema` do not accept it — a schema document is written as-is, and the contract
description is not a command result.

## Experimental commands

Most commands are `stability: "stable"` and are covered by the breaking-change rules above. The
agent lifecycle commands added most recently are declared `stability: "experimental"` in
`describe` output, meaning their payload shapes may still change without a major schema
version:

```bash
claude-cli describe -fj | jq -r '.commands[] | select(.stability=="experimental") | .id'
```

They share the `agent-result` schema with the stable agent commands. The stable commands'
guarantees are unaffected.

## Published schemas

| Id                  | Covers                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| `issue`             | A single finding record.                                                   |
| `issue-list`        | `md lint`, `md lint-dir`, `md validate-frontmatter`, `md refs`, `md links` |
| `diagnostic-record` | One line of `--format jsonl` output.                                       |
| `lint-dir-summary`  | `md lint-dir --summary --format json`                                      |
| `md-graph`          | `md graph --output report`                                                 |
| `md-audit`          | `md audit`                                                                 |
| `md-query`          | `md query`                                                                 |
| `md-check-urls`     | `md check-urls`                                                            |
| `md-orphans`        | `md orphans`                                                               |
| `md-index`          | `md index`                                                                 |
| `md-context`        | `md context`                                                               |
| `md-diff`           | `md diff`                                                                  |
| `agent-result`      | Every `agent` subcommand, including the failure form.                      |
| `check-update`      | `check-update`                                                             |
| `describe`          | `describe --format json`                                                   |
| `schema-list`       | `schema --format json` with no id                                          |
| `envelope`          | The `--envelope` wrapper                                                   |

SARIF output follows the external
[SARIF 2.1.0 schema](https://json.schemastore.org/sarif-2.1.0.json); it is referenced, not
redefined.

Commands not listed report `"outputSchema": null` in `describe`. That is an honest statement
that no schema is published yet, not that the command has no JSON output. Publishing one later
is explicitly non-breaking.

## Consuming the contract

```bash
# Discover commands instead of parsing --help.
claude-cli describe --format json | jq '.commands[] | select(.writes) | .id'

# Find which stream a command puts findings on.
claude-cli describe md audit -fj | jq '.commands[0].stream'

# Validate CI output against the declared schema.
claude-cli schema md-audit > md-audit.schema.json
claude-cli md audit docs --format json > audit.json || true
# ...then validate audit.json with any JSON Schema 2020-12 validator.
```

`describe` reports the **static** contract. Project configuration from `.claude-cli.yml` is not
applied, so `defaultFormat` is the built-in default rather than the resolved one and the answer
does not depend on the working directory.
