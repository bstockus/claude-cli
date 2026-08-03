# `md fix`

## Synopsis

```text
claude-cli md fix <inputs...> [options]
```

Turns deterministic findings into reviewable edits. Every fixer produces a _plan_ — byte
ranges, the exact text expected at each range, the replacement, and the diagnostic that asked
for it — and `--write` applies the whole plan as one transaction.

Only unambiguous transformations are in scope. Nothing here guesses.

## Arguments

| Argument    | Required | Description                                                     |
| ----------- | -------- | --------------------------------------------------------------- |
| `inputs...` | Yes      | Markdown files, directories, or globs. Stdin (`-`) is rejected. |

Stdin is rejected because `md fix` writes and stdin has no path to write back to.

## Options

| Option                  | Default         | Description                              |
| ----------------------- | --------------- | ---------------------------------------- |
| `--format <fmt>`        | Project default | `llm`, `human`, or `json`.               |
| `--paths <style>`       | Project default | `absolute` or `relative`.                |
| `--rule <name>`         | Every fixer     | Fixer to run. Repeatable.                |
| `--check`               | **Default**     | Report pending fixes without writing.    |
| `--dry-run`             | Off             | Print the full plan without writing.     |
| `--write`               | Off             | Apply the plan as one transaction.       |
| `--include <glob>`      | `files.include` | Repeatable include glob.                 |
| `--exclude <glob>`      | `files.exclude` | Repeatable exclude glob.                 |
| `--changed-since <rev>` | None            | Only files changed since a Git revision. |
| `-h`, `--help`          | —               | Show help.                               |

`--check`, `--dry-run`, and `--write` are mutually exclusive. **The mode cannot be set from
project configuration**: `check`, `write`, and `dryRun` are deliberately absent from
`commands.fix`, so a checked-in `.claude-cli.yml` can never turn `md fix` into a writer.
Setting one is a configuration error.

## Fixers

| Rule  | What it does                                                           |
| ----- | ---------------------------------------------------------------------- |
| `toc` | Replaces the content between an existing `claude-cli:toc` marker pair. |

`md fix --rule toc` only touches documents that already carry a marker pair, or the documents
matched by `toc.files` when that is configured. **Inserting markers is an authoring decision,
not a fix**, so a document without them is left alone. A malformed marker pair is reported
under `unfixable` rather than thrown, so one bad document cannot kill a whole-tree run.

## The transaction

`--write` applies every file's edits together, and **refuses to write at all** when:

- any two edits overlap, or two insertions land on the same offset (no overlap, but an
  undefined order);
- any input changed after the plan was built;
- any target resolves outside the containment root, including through a symlinked directory.

Conflicts are reported with **both** rule names so it is clear which `--rule` to leave out.

The containment root is the configured workspace root when a `.claude-cli.yml` exists.
Without one it is the directory containing the selected inputs, so
`claude-cli md fix /elsewhere/docs` works from anywhere while a fixer still cannot emit an
edit reaching beyond what was selected.

Before writing, every file is rechecked and every `expected` re-verified. A stale input
therefore costs zero writes. Each file is then staged beside itself and committed by rename,
which is atomic per file.

**The multi-file commit is not atomic.** A failure part way through restores already-committed
files by rewriting their original bytes, which is best-effort and not crash-safe. This is the
same guarantee `md rename-file` gives.

## Offsets

`start` and `end` are **UTF-16 code-unit indices** into the decoded file — what
`content.slice(start, end)` uses — not byte offsets. They differ for any document containing
astral-plane characters such as emoji.

`expected` is therefore mandatory rather than advisory. A consumer applying an edit itself
should verify it first; internally a mismatch aborts the transaction rather than corrupting
the document.

## Exit codes

| Mode        | Condition                                    | Code | Stream |
| ----------- | -------------------------------------------- | ---- | ------ |
| `--check`   | Pending edits, or a conflict                 | `2`  | stderr |
| `--check`   | Clean                                        | `0`  | stdout |
| `--dry-run` | No conflicts, whether or not there is a plan | `0`  | stdout |
| `--dry-run` | A conflict                                   | `2`  | stderr |
| `--write`   | Applied, or nothing to do                    | `0`  | stdout |
| `--write`   | A conflict, so nothing was written           | `2`  | stderr |
| any         | Bad invocation, unknown rule, or I/O error   | `1`  | stderr |

`--dry-run` exits `0` on a non-empty plan because seeing the plan is what was asked for —
matching `md toc --dry-run`, which also exits `0` on a stale table. A **conflict** still exits
`2` in dry-run, because it means `--write` could not succeed and
`md fix --dry-run && md fix --write` must not be a lie.

Entries under `unfixable` never change the exit code. They name findings with no automatic
fix available, and failing on them would permanently redden CI with nothing to do about it.

## Not in scope

- **No guessing at broken links.** A fixer never changes which file a link points at.
- **No file creation, deletion, or renaming.** Content edits inside existing files only.
- **No TOC marker insertion.**
- **No `jsonl` or `sarif`.** The payload is a plan, not a finding list.
