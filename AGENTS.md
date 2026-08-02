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
