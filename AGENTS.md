# claude-cli

A TypeScript/Node ESM CLI published as `@bstockus/claude-cli`. The binary is `claude-cli`.

## Layout

```
src/cli.ts          commander entry point; every subcommand is registered here
src/commands/*.ts   one file per `md` subcommand, each exporting a `<name>Action`
src/checkers/*.ts   katex, mermaid, references, markdown-lint
src/markdown-ast.ts shared unified/remark parsing + extraction helpers
src/formatters.ts   llm / human / json output rendering
tests/{unit,integration,e2e}
```

There is one toolset, `md`. Adding a subcommand means: a `src/commands/<name>.ts`
exporting an action, a `md.command(...)` registration in `src/cli.ts`, a README entry, and
e2e coverage in `tests/e2e/cli.test.ts`.

## Conventions

- ESM only (`"type": "module"`). Relative imports **must** carry the `.js` extension —
  `moduleResolution` is `NodeNext`.
- Output format is always selectable via `--format llm|human|json` (default `llm`), with
  `-fh`/`-fj` shorthands expanded in `src/cli.ts` before commander parses argv.
- Exit codes: `0` success, `1` usage error, `2` actionable issues found.
- `md rename-heading` is the only command that writes to files.

## Gotchas

- **The e2e suite spawns the compiled CLI** (`dist/cli.js`), not the source. `npm test`
  builds first via `pretest`; do not remove that script.
- **`.markdownlintrc` must stay in `package.json` "files".** `src/checkers/markdown-lint.ts`
  resolves it as `dist/checkers/../../.markdownlintrc` and falls back to `{}` silently when
  it is absent, so dropping it degrades `--style` without any error. `tests/e2e/packaging.test.ts`
  guards this.
- **Never hand-edit `version` in `package.json` or `CHANGELOG.md`.** semantic-release owns
  both. `src/cli.ts` reads the version at runtime rather than inlining it.
- **The update notifier must never write to a machine-readable stream.** Both stdout and
  stderr carry payloads depending on the command (`--format json` puts JSON on stderr for
  `md lint`, stdout when clean), so `src/update-notifier.ts` refuses to print unless
  stderr is a TTY, the format is not JSON, `CI` is unset, and the opt-out variable is
  unset. Changing those gates risks corrupting a consumer's parse.
- **The notice prints from cache in a `process.on("exit")` handler.** Commands call
  `process.exit()` directly on their issue and error paths, so anything awaited after
  `parse()` would be skipped. The network refresh happens in a detached child
  (`__refresh-update-cache`) guarded by an atomic `wx` lock file, so concurrent
  invocations spawn at most one.
- **`engines` mirrors jsdom, and the CI matrix must stay inside it.** jsdom is the
  most constrained dependency (`^22.22.2 || ^24.15.0 || >=26.0.0`); commander, katex
  and markdownlint all require `>=22`. v1.0.2 shipped claiming `>=20` and crashed on
  Node 20 with `webidl.util.markAsUncloneable is not a function`. When bumping any of
  these, re-check `npm view <pkg> engines` and update both `engines` and the matrix.
- **Release is gated on the CI workflow, not on push.** `release.yml` triggers via
  `workflow_run` after CI succeeds, so a red matrix cannot publish. It deliberately
  does not re-run the tests.
- **Package retention is enforced weekly and is irreversible.**
  `.github/workflows/prune-packages.yml` keeps only the newest 3 versions on GitHub
  Packages. It needs a `PACKAGES_TOKEN` secret (a PAT with `read:packages` +
  `delete:packages`) because the package is owned by a _user_: deletion goes through
  `/user/packages/...`, which acts on the authenticated user, and `GITHUB_TOKEN`
  authenticates as `github-actions[bot]`. Manual runs default to a dry run; scheduled
  runs delete. Selection never removes a version whose name is not valid semver.
- **ESLint uses the non-type-checked preset on purpose.** `tsc --strict` (`npm run typecheck`)
  is the type authority. typescript-eslint's `recommendedTypeChecked` flags ~26 long-standing
  intentional patterns here — uniformly-`async` commander handlers, `as unknown as` casts
  around jsdom globals, and `any` at the `JSON.parse`/YAML boundary. Adopting it means
  fixing those first, not just flipping the preset.

## Commits

Conventional Commits are required — semantic-release derives the version from them, and
both a `commit-msg` hook and a CI job reject malformed messages. `feat:` → minor,
`fix:`/`perf:` → patch, `!`/`BREAKING CHANGE:` → major, everything else → no release.

## Before pushing

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
```
