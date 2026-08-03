# claude-cli

A TypeScript/Node ESM CLI published as `@bstockus/claude-cli`. The binary is `claude-cli`.

## Layout

```
src/cli.ts             commander entry point; every subcommand is registered here
src/commands/*.ts      one file per subcommand, each exporting a `<name>Action`
src/checkers/*.ts      katex, mermaid, references, markdown-lint
src/markdown-ast.ts    shared unified/remark parsing + extraction helpers
src/formatters.ts      llm / human / json output rendering
src/result.ts          the single `--format json` write path, and `--envelope`
src/agent/targets/*.ts versioned per-target capability profiles
src/contract/*.ts      published JSON Schemas + the per-command contract registry
tests/{unit,integration,e2e}
```

There are two toolsets, `md` and `agent`, plus the top-level `check-update`, `describe`, and
`schema`. Adding a subcommand means: a `src/commands/<name>.ts` exporting an action, a
`command(...)` registration in `src/cli.ts`, a `src/contract/registry.ts` entry, a
`docs/commands/<name>.md` page with entries in `docs/commands.md` and `docs/_contents.md`, a
README entry, and e2e coverage. For an `agent` subcommand, also widen
`AgentResult["command"]` in `src/agent/types.ts` and the `command` enum plus `commands` list
in `src/contract/schemas/agent.ts`.

## Conventions

- ESM only (`"type": "module"`). Relative imports **must** carry the `.js` extension —
  `moduleResolution` is `NodeNext`.
- Output format is always selectable via `--format llm|human|json` (default `llm`), with
  `-fh`/`-fj` shorthands expanded in `src/cli.ts` before commander parses argv.
- Exit codes: `0` success, `1` usage error, `2` actionable issues found.
- `md rename-heading`, `md rename-file`, `md toc --write`, and `agent convert` are the
  commands that write to files.
- Every `--format json` payload goes through `jsonPayload` in `src/result.ts`, which is what
  makes `--envelope` reach all of them. Writing `JSON.stringify` inline at a new site silently
  opts that command out.

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
- **The notice prints from cache in a `process.on("exit")` handler.** Command actions signal
  exit status without terminating the process, while the network refresh happens in a detached child
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
- **The package-retention job exists but is currently DISABLED.**
  `.github/workflows/prune-packages.yml` would keep only the newest 3 versions on GitHub
  Packages, but the workflow is in `disabled_manually` state, so nothing is pruned today.
  Re-enable with `gh workflow enable "Prune package versions"`.
  Two things to know before doing so: it deletes irreversibly, and it needs a
  `PACKAGES_TOKEN` secret (a classic PAT with `read:packages` + `delete:packages`) because
  the package is owned by a _user_ — deletion goes through `/user/packages/...`, which acts
  on the authenticated user, while `GITHUB_TOKEN` authenticates as `github-actions[bot]`.
  Manual runs default to a dry run; scheduled runs delete. Selection sorts by semver and
  never removes a version whose name is not valid semver.
- **ESLint uses the non-type-checked preset on purpose.** `tsc --strict` (`npm run typecheck`)
  is the type authority. typescript-eslint's `recommendedTypeChecked` flags ~26 long-standing
  intentional patterns here — uniformly-`async` commander handlers, `as unknown as` casts
  around jsdom globals, and `any` at the `JSON.parse`/YAML boundary. Adopting it means
  fixing those first, not just flipping the preset.
- **Target behavior is data, and the renderer reads that data.** `src/agent/targets/*.ts` holds
  the hook events, path roots, manifest directories, model and tool maps, rule activations, and
  declared output patterns; `src/agent/render.ts` looks them up rather than branching on the
  target. Do not reintroduce an `if (target === …)` for anything tabular — the conformance
  fixtures assert that every emitted path is one the profile declares, so an undeclared
  hardcoded path fails the build.
- **Every visible command needs a `src/contract/registry.ts` entry.** `describe` merges the
  registry into the walked command tree, and `tests/e2e/contract.test.ts` fails on any command
  reported as `stability: "undeclared"` and on any registry id that no longer maps to a command.
  The registry records current behavior, including the known inconsistencies (`md links -fj`
  never exiting 2, `md lint-dir --summary`'s divergent shape) — those are documented in
  `notes`, not quietly fixed, because changing them is breaking.
- **Schemas and target profiles are TypeScript modules, not data directories.** `tsconfig` sets
  `rootDir: "src"` with no `resolveJsonModule`, so a top-level `schemas/` or `.json` profile
  would never reach `dist` and the published package would silently lack it — the same trap as
  `.markdownlintrc`, but with no error at all. Moving them means adding the directory to
  `package.json` `files` **and** to `tests/e2e/packaging.test.ts`.
- **`CONTRACT_VERSION` and `PROFILE_SCHEMA_VERSION` are hand-owned.** They version the contract
  surface and the target-profile structure, not the package. Do not bump them for a normal
  release; semantic-release does not touch them. Payload-level breaking changes are versioned by
  the major in the schema `$id` path instead. The rules are in `docs/contract.md`.
- **The bundle `schemaVersion` is a third hand-owned version.** It versions the _source_ format
  authors write (`src/agent/manifest.ts`), separate from `CONTRACT_VERSION` and
  `PROFILE_SCHEMA_VERSION`. Schema 2 is a strict superset of 1: it adds `marketplace:` and
  `native:` and changes nothing else, which is why `agent upgrade` can verify byte-identical
  rendering before and after and refuse (AB224) if that ever stops holding.
- **Native overlay paths are deliberately undeclared.** `TargetProfile.outputs` describes what
  the _renderer_ emits; an overlay is user-supplied content whose whole purpose is a surface the
  portable profile does not describe. `agent doctor` and the conformance suite skip artifacts
  with `origin === "native"` and report them under `doctor.overlays`. Do not "fix" this by adding
  a `**` output pattern — that would disable the check for portable output too.
- **`Artifact.origin` is emitted only when `"native"`.** Always emitting it would change
  `conversion-report.json` and `agent convert -fj` bytes for every bundle that has no overlay.
- **`hasFindings` fails on any `approximate` diagnostic.** That is right for `convert` and
  `validate` and wrong for `doctor`, `import`, `upgrade`, and `package`, where approximation is
  the expected outcome rather than a defect. Those four call `outputDecidedResult` with their own
  error/strict rule. A new command that reports approximations should do the same.
- **`agent audit`'s exit rule is split by origin, not just by severity.** Almost every review
  finding is a `warning` by design, so blocking on errors alone would let a bundle embedding a
  literal credential exit `0`. But audit forwards render diagnostics, and every Codex bundle
  carries approximate warnings. So a warning whose code is in `AUDIT_CODES` blocks; a forwarded
  one blocks only under `--strict`. Adding a check means adding its code to `SOURCE_CHECKS`,
  `RENDERED_CHECKS`, or `BASELINE_CHECKS`, or it will neither gate CI nor appear in
  `audit.checks` — which is what tells a consumer "clean" from "not checked".
- **Audit re-emits `AB504`, `AB505`, and `AB506` rather than minting its own codes.** One
  condition keeps one ID whichever command surfaces it, or a consumer's suppression list breaks.
  It calls the packager's exported checks over a _bundle-root-relative_ inventory
  (`buildSourceInventory`): `bundle.hookFiles` paths are relative to the hook directory, so
  passing them straight through would miss `checkExecutables`' `hooks/` prefix and flag every
  scaffolded hook script. `agent init` output auditing clean is a guarded constraint.
- **`src/sarif.ts` builds its document in a load-bearing key order.** The five `md` diagnostic
  commands share `sarifDocument` with `agent audit`, and `JSON.stringify` follows insertion
  order, so reordering a key silently changes bytes every existing SARIF consumer receives.
  `tests/unit/automation.test.ts` asserts byte equality against a fixed input. `formatSarif`'s
  hardcoded `level: "error"` is contract too, not an oversight: an `Issue` carries no severity.
  The agent mapper lives separately in `src/agent/sarif.ts` because it needs three levels, no
  `region`, and `properties` — and because agent SARIF goes to stdout, not stderr.
- **Sort generated output by byte comparison, never `localeCompare`.** It is ICU-build and
  locale dependent, so a differently configured CI runner would reorder archives and manifests.
  `render.ts:897` still uses `localeCompare`; leave it (changing it would move
  `conversion-report.json` artifact order, which is observable) but do not copy it.
- **`agent add` must not rewrite `agent-bundle.yaml` unless there is a real edit.**
  `parseDocument` preserves comments but normalizes incidental whitespace, so an unconditional
  round trip would churn the file. A plain `parse` + `stringify` would delete every comment.
- **`agent doctor --output` takes a conversion root, not a package root.** A package root also
  holds catalogs, checksums, and the inventory, which `diffOutput` would report as unmanaged.
- **No published schema may set `additionalProperties: false` or `$ref` another document.**
  The first would make every additive change break validating consumers; the second would make
  `claude-cli schema <id>` return something that cannot be compiled on its own.
  `tests/unit/contract-schemas.test.ts` enforces both.

## Commits

Conventional Commits are required — semantic-release derives the version from them, and
both a `commit-msg` hook and a CI job reject malformed messages. `feat:` → minor,
`fix:`/`perf:` → patch, `!`/`BREAKING CHANGE:` → major, everything else → no release.

## Before pushing

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
```
