# Feature Ideas

Reviewed against the repository at `5d85165` on 2026-08-02. This is a forward-looking
backlog, not a commitment to implement every item.

## Product Reading

`claude-cli` has grown into two related products behind one deterministic, local CLI:

1. A Markdown workspace engine for humans, coding agents, and CI. It parses documents,
   validates content, builds a persistent index and link graph, answers structured queries,
   and performs a small set of safe refactors.
2. A portable agent-bundle compiler. It normalizes skills, agents, hooks, rules, command
   policies, MCP configuration, and assets, then renders Claude Code, Codex, and Cursor
   plugin or project artifacts with explicit compatibility diagnostics.

The common value is not merely "Markdown utilities." It is **model-free, inspectable
compilation and analysis of the files that give agents context and behavior**. The best new
features should reinforce that identity:

- Stay agent- and provider-agnostic at the source-model and command-contract layers.
- Prefer deterministic local operations over calling a hosted model.
- Make machine-readable output a first-class API, without weakening the human and `llm`
  formats.
- Reuse the workspace AST, reference graph, index, diagnostics, and atomic-write machinery.
- Keep writes explicit, previewable, workspace-bounded, and recoverable.
- Model target-specific behavior honestly instead of reducing every platform to a weak
  common denominator.

## Current Capability Map

| Area                 | Existing commands                                                                                                | What is already covered                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Validation           | `md lint`, `lint-dir`, `audit`, `check-urls`, `validate-frontmatter`                                             | Markdown style, Mermaid, KaTeX, local references, URLs, schemas, graph and TOC checks, changed-file selection, JSONL, and SARIF |
| References and graph | `md refs`, `refs-to`, `links`, `orphans`, `graph`                                                                | Outbound and inbound links, broken targets, reachability, components, cycles, Mermaid, and DOT                                  |
| Document inspection  | `md headers`, `outline`, `toc`, `stats`, `structure`, `section`, `frontmatter`, `tasks`, `tables`, `code-blocks` | Structured extraction for the main Markdown constructs                                                                          |
| Workspace data       | `md query`, `index`                                                                                              | Focused cross-file queries and a persistent parsed-document cache                                                               |
| Refactoring          | `md rename-heading`, `rename-file`, plus `toc --write`                                                           | Previewable heading/file moves, inbound-link updates, and marker-scoped generated content                                       |
| Agent bundles        | `agent validate`, `inspect`, `compat`, `convert`                                                                 | Neutral bundle parsing, dependency diagnostics, target/profile rendering, strict/dry-run/check modes, and conversion reports    |
| Distribution         | `check-update`                                                                                                   | Non-blocking release notification and explicit registry checks                                                                  |

The largest gaps are lifecycle gaps rather than missing AST extractors. Markdown analysis can
find information but does not yet prepare it for a task or explain how it changed. Agent
conversion can emit files but does not yet scaffold, import, test, audit, or package the
complete distributable.

## Priority Summary

| Priority | Idea                                           | Main payoff                                               | Approximate effort       |
| -------- | ---------------------------------------------- | --------------------------------------------------------- | ------------------------ |
| P0       | Target conformance profiles and `agent doctor` | Prevent silently stale or invalid generated plugins       | Medium                   |
| P0       | Versioned machine-readable result contracts    | Make the CLI a dependable API for agents and CI           | Medium                   |
| P1       | `agent import` and `agent upgrade`             | Complete the native-to-neutral-to-native loop             | Large                    |
| P1       | `agent init` and `agent add`                   | Make portable bundles easy to start correctly             | Small-medium             |
| P1       | Native overlays and a richer component model   | Preserve platform-only features without false portability | Medium                   |
| P1       | `agent package` and marketplace generation     | Turn rendered artifacts into installable products         | Large                    |
| P1       | `agent audit`                                  | Add security and supply-chain review before distribution  | Medium                   |
| P1       | `md context`                                   | Produce focused, reproducible context packs for agents    | Medium                   |
| P1       | `md diff`                                      | Make documentation changes reviewable by meaning          | Medium                   |
| P2       | `agent test`                                   | Catch behavioral-contract and artifact regressions        | Medium-large             |
| P2       | Planned Markdown fix engine                    | Convert deterministic findings into safe edits            | Large                    |
| P2       | Composable workspace queries                   | Avoid a growing list of narrow query kinds                | Medium                   |
| P2       | Source-linked snippet checking                 | Detect documentation examples that drift from code        | Medium                   |
| P2       | Read-only MCP server                           | Expose the workspace engine directly to agent hosts       | Medium                   |
| P3       | Library, editor, and CI integrations           | Reuse the engine without shell parsing                    | Large                    |
| P3       | Additional agent targets                       | Broaden reach after target maintenance is sustainable     | Per target: medium-large |

## Detailed Recommendations

### 1. Target Conformance Profiles and `agent doctor`

**Command sketch:**

```text
claude-cli agent doctor --target all
claude-cli agent doctor ./bundle --target codex --host-version 1.2.3
claude-cli agent specs --format json
```

The converter currently encodes platform behavior directly in parser and renderer code.
That worked for the first implementation, but plugin surfaces are changing quickly. Codex
plugins now have richer install metadata and marketplace wiring; Claude Code documents more
component types and native validation commands; Cursor now treats plugins as a first-class
bundle of skills, subagents, MCP servers, hooks, and rules.

Create a versioned, data-driven capability profile for every target. It should describe:

- Supported manifest fields, default paths, component types, hook events, placeholders,
  model/tool metadata, and profile restrictions.
- Whether a mapping is exact, approximate, unsupported, or target-native pass-through.
- The target documentation revision or minimum host version used to define the profile.
- Fixture plugins and expected native layouts for conformance tests.

`agent doctor` would check a bundle and generated output against those profiles, report an
unknown/newer installed host version, and optionally invoke a host's own read-only validator
when installed. Native validators must be additive evidence; output should remain useful on
machines where the hosts are absent.

This is the best P0 investment because every other agent feature depends on knowing that
generated artifacts are current. It also makes adding a target an adapter-and-fixtures task
rather than another set of conditionals in one renderer.

### 2. Versioned Machine-Readable Result Contracts

**Command sketch:**

```text
claude-cli describe
claude-cli describe md graph --format json
claude-cli schema agent-result
```

JSON output is already important, but each command currently owns its own result shape.
Publish versioned JSON Schemas and a self-description command that exposes commands, options,
exit semantics, supported formats, and output schema IDs. Add a common envelope where it does
not break useful command-specific data:

```json
{
  "schemaVersion": "1",
  "command": "md graph",
  "ok": false,
  "findings": [],
  "summary": {}
}
```

The initial release does not need to redesign every payload. It can document current shapes,
add schema identifiers, and make future compatibility rules explicit. This would let agents
discover the CLI instead of scraping `--help`, let CI validate payloads, and make an MCP or
library wrapper much safer to build. The update notifier's machine-stream guarantees must
remain part of this contract.

### 3. `agent import` and `agent upgrade`

**Command sketch:**

```text
claude-cli agent import ./existing-plugin --from auto --output ./portable
claude-cli agent import . --from cursor-project --output ./portable --dry-run
claude-cli agent upgrade ./portable --to-schema 2 --check
```

`convert` accepts a neutral bundle and a legacy Claude plugin, but there is no general path
from existing native projects/plugins into maintainable neutral source. Add importers for the
same targets the tool renders. Import should:

- Detect the source platform and plugin versus project scope.
- Normalize portable components and preserve untranslatable pieces in native overlays.
- Emit a migration report with provenance for every source file and field.
- Be idempotent: importing the same unchanged source produces byte-identical output.
- Refuse to merge into a nonempty destination unless an explicit merge strategy is selected.

This differs from a host's user-environment migration feature: the output is a portable,
version-controlled source bundle that can subsequently generate all targets.

Keep schema evolution separate as `agent upgrade`. It should migrate a neutral bundle
between schema versions with `--check`, `--dry-run`, and explicit notes for changes that need
human judgment.

### 4. `agent init` and `agent add`

**Command sketch:**

```text
claude-cli agent init release-helper --output ./release-helper
claude-cli agent add skill prepare-release ./release-helper
claude-cli agent add hook pre-tool-use ./release-helper
```

Provide a noninteractive scaffold for the neutral format. The differentiator from each
platform's native scaffold is that this starts with a portable bundle and target-aware
defaults. Useful options include selected component types, intended targets, plugin/project
profiles, license, and whether to include target overlays.

Generated examples should be minimal and valid, not a large demo that users must delete.
`agent add` should update the manifest safely and create one component at a time. Both
commands should support JSON plans, `--dry-run`, and `--check` so an agent can use them
without parsing prompts.

### 5. Native Overlays and a Richer Component Model

Do not force every emerging platform feature into a portable abstraction. Introduce a clear
two-layer bundle:

```text
portable-bundle/
  agent-bundle.yaml
  skills/
  agents/
  hooks/
  rules/
  policies/
  mcp/
  native/
    claude-code/
    codex/
    cursor/
```

The portable layer should remain limited to concepts with defensible cross-target semantics.
The native overlay can hold platform-only components and manifest fragments, such as richer
listing metadata, target-specific app/UI wiring, LSP or monitor definitions, themes,
scheduled-task templates, and host-specific permission settings.

Rendering should merge overlays deterministically, diagnose collisions, record which output
came from portable versus native source, and forbid an overlay from escaping its target root.
This gives users access to new platform capabilities immediately without pretending they are
portable or waiting for a new neutral schema revision.

### 6. `agent package` and Marketplace Generation

**Command sketch:**

```text
claude-cli agent package ./bundle --target all --output ./dist
claude-cli agent package ./bundle --target codex --marketplace repo --check
claude-cli agent package ./bundle --target claude-code --archive
```

Conversion produces a directory tree, but distribution also needs marketplace entries,
install-surface metadata, archive layout, integrity information, and publish-readiness checks.
Add packaging as a separate stage so `convert` remains a pure compiler.

An MVP should support local/repository marketplace catalogs for the selected targets and
validate:

- Display name, short/long descriptions, categories, starter prompts, publisher details,
  icons/screenshots, legal links, and component paths where supported.
- Manifest and marketplace version agreement.
- Required files, asset dimensions/types, archive contents, executable modes, and paths.
- Checksums plus a simple software-bill-of-materials inventory for scripts and bundled
  executables.
- Deterministic archives and a `--check` mode suitable for release CI.

Actual publication, authentication, or submission should remain outside the first version.
The command can produce a complete package and a checklist without taking an irreversible
external action.

### 7. `agent audit`

**Command sketch:**

```text
claude-cli agent audit ./bundle --target all
claude-cli agent audit ./dist/codex/plugin --format sarif
```

Validation answers "is this structurally valid?" Audit should answer "what should a reviewer
inspect before trusting or distributing this?" Static checks could flag:

- Hook commands, executable assets, shell interpolation, absolute paths, and network tools.
- MCP servers that embed secret-looking values, inherit broad environment state, use an
  unexpected transport, or invoke an unpinned package.
- Overbroad tool permissions and policy rules whose examples do not cover risky boundaries.
- Symlinks, duplicate/case-colliding paths, unexpected binary files, and oversized resources.
- Manifest claims that do not match actual components or declared capabilities.
- Changes in executable files or permissions relative to a previous package/report.

Use stable diagnostic IDs and SARIF. Exit `2` should mean review findings, not proof that a
bundle is malicious. Make the limitations explicit: this is explainable static analysis, not
a sandbox or malware detector.

### 8. `md context`

**Command sketch:**

```text
claude-cli md context docs/architecture.md --depth 2 --budget 24000
claude-cli md context --section "Release process" --entry README.md --format json
claude-cli md context --target src/cli.ts --include-backlinks
```

Turn the existing AST, graph, section extraction, backlinks, and workspace index into
reproducible context packs for coding agents. Starting from one or more files, headings, or
referenced assets, the command would traverse selected relationships and emit:

- Ordered Markdown content with source/line provenance.
- A JSON manifest explaining why each section was included.
- Broken or omitted dependencies and a deterministic budget/truncation report.
- Optional backlinks, child sections, frontmatter, and code-block contents.

The MVP should use deterministic graph distance and document order, not embeddings or an LLM.
Use a byte/character budget first, or a clearly labeled token estimate; exact model-specific
tokenization would compromise the provider-neutral design. A later pluggable ranker could be
added without changing the output contract.

This is probably the single Markdown feature with the most direct agent value: it converts
analysis into ready-to-use, auditable task context.

### 9. `md diff`

**Command sketch:**

```text
claude-cli md diff --since origin/main docs
claude-cli md diff old.md new.md --format json
```

Provide an AST-aware change summary instead of another textual diff. Report added, removed,
moved, and renamed headings; frontmatter changes; links whose resolved target changed; task
state changes; code-block language/content changes; and tables or diagrams added/removed.

For Git comparisons, reuse the existing `--changed-since` machinery and parse the base
revision without modifying the worktree. Match headings conservatively and label probable
renames as heuristic rather than fact. JSON should retain old/new line and slug information.

This is useful in pull-request review, release notes, documentation ownership workflows, and
agent handoffs. It also provides a foundation for smarter but still reviewable fix plans.

### 10. Planned Markdown Fix Engine

**Command sketch:**

```text
claude-cli md fix docs --check
claude-cli md fix docs --dry-run --rule toc --rule redirects
claude-cli md fix docs --write --rule relative-links
```

Several existing commands already know how to calculate safe edits. Extract their planning,
conflict detection, staging, and reporting into a shared edit engine, then expose only
deterministic fixers initially:

- Marker-scoped TOC synchronization.
- Canonical percent-encoding and relative-path normalization.
- Updating a URL to a confirmed permanent redirect when explicitly enabled.
- Markdownlint fixes only for rules with unambiguous transformations.

Default to `--check` or `--dry-run`; require `--write` to mutate. A plan should include byte
ranges, expected old text, replacement text, and the originating diagnostic. Abort the full
transaction if inputs changed, edits overlap, or any target is outside the workspace.

Do not auto-guess broken link destinations in the MVP. Candidate suggestions are useful, but
fuzzy repairs should require a selected candidate or a separate explicit flag.

### 11. Composable Workspace Queries

**Command sketch:**

```text
claude-cli md query documents --where frontmatter.status=published --where has:h1
claude-cli md query documents --where links-to:docs/api.md --select file,title,line
claude-cli md query tasks --where status=pending --group-by frontmatter.owner
```

The existing query kinds prove the value of the workspace index, but adding one enum value
per new question will eventually become limiting. Add a small typed predicate model for
documents, headings, links, tasks, code blocks, and frontmatter.

Start with repeatable, validated predicates and explicit `--select`/`--group-by` fields. Do
not begin with a general expression language or arbitrary JavaScript. The same query plan can
serve the CLI, MCP tools, and future editor integration, while existing kinds remain as stable
shortcuts.

### 12. Source-Linked Snippet Checking

**Command sketch:**

```text
claude-cli md check-snippets docs
claude-cli md check-snippets docs --write
```

Allow fenced code blocks to declare a source file and named region or line span. The checker
would compare the documented snippet with the source, report drift, and optionally refresh
only explicitly linked blocks.

This fits the current code-block extraction and audit model and solves a common documentation
failure without executing untrusted code. Prefer named regions or stable markers over raw line
ranges. Define one conservative metadata syntax, preserve fence attributes and indentation,
and never run the snippet as part of synchronization.

### 13. `agent test`

**Command sketch:**

```text
claude-cli agent test ./bundle
claude-cli agent test ./bundle --target all --native
```

Support model-free contract tests stored with a bundle. Test cases could assert selected
targets/profiles, rendered paths, manifest fragments, compatibility diagnostics, transformed
placeholders, hook schemas, policy examples, and golden output digests.

An opt-in `--native` mode could run installed host validators in temporary directories with
timeouts and no network. Model-driven behavioral evaluations should be a later, explicitly
configured integration: they are nondeterministic, can cost money, and should not become a
requirement for ordinary validation.

### 14. Read-Only MCP Server

**Command sketch:**

```text
claude-cli serve mcp --root docs
claude-cli serve mcp --root . --allow-refactors
```

Expose the deterministic workspace engine as MCP tools such as `list_documents`,
`get_section`, `query_workspace`, `build_context`, `inspect_graph`, and `audit_markdown`.
This removes shell-output parsing for compatible hosts while retaining the same core result
types.

The default server should be read-only, local, and stdio-based. Refactor tools should be
disabled unless explicitly allowed and should return a plan before applying changes. Keep the
server thin: it should call the same library functions as the CLI, not spawn the binary or
reimplement command behavior.

### 15. Library, Editor, and CI Integrations

First expose a documented ESM API from the existing package (or a later
`@bstockus/claude-cli-core` package) for workspace loading, queries, diagnostics, context
packing, and edit plans. This is a prerequisite for integrations that should not parse shell
output.

Useful consumers, in likely order, are:

1. A reusable GitHub Action that caches URL/index data, supports changed-document audits,
   uploads SARIF, and writes a concise job summary.
2. A watch mode for local documentation work, with incremental diagnostics.
3. A language server for broken-link/frontmatter diagnostics, heading completion, backlinks,
   and rename operations.

Keep these adapters in separate entry points so normal CLI startup does not pay for editor or
server dependencies.

### 16. Additional Targets Through an Adapter Interface

More agent hosts will be requested, but adding them directly to the current renderer would
multiply compatibility debt. After target profiles, native overlays, and conformance fixtures
exist, define an internal adapter contract for detection, validation, rendering, diagnostics,
and packaging.

Choose new built-in targets from demonstrated use rather than name recognition. A target
should have stable, public native formats; a meaningful overlap with the bundle model; fixture
coverage; and a maintainer willing to track upstream changes. Third-party adapters could be
considered later, but loading arbitrary adapter code would create a supply-chain boundary and
should not be the first extensibility mechanism.

## Smaller, Low-Risk Improvements

These do not need to become major roadmap items.

**Shipped:**

- [`completion <shell>`](../commands/completion.md) generates a static script for Bash, Zsh,
  Fish, and PowerShell from the same command walk `describe` uses.
- [`md audit --baseline`](../commands/md-audit.md) suppresses known findings and fails only on
  regressions; `--write-baseline` makes recording explicit and reviewable. Entries are keyed
  without a line number, so unrelated edits do not resurface a known finding.
- [`md graph --focus <file> --depth <n>`](../commands/md-graph.md) projects an undirected
  neighborhood out of the full graph.
- [`md query frontmatter-keys`](../commands/md-query.md) inventories top-level key adoption
  with counts, coverage, and value types.
- [`agent convert --report <file>`](../commands/agent-convert.md) writes the conversion report
  to any path, in every mode, without listing it among the artifacts.
- [`agent inspect --target`/`--profile`](../commands/agent-inspect.md) narrow a large bundle
  using the renderer's own selection predicate and the target profiles.

**Still open:**

- Add a neutral binary alias in a future major packaging pass while retaining `claude-cli` for
  compatibility; the current name understates the agent-agnostic positioning.

## Suggested Delivery Sequence

1. Build target capability profiles, conformance fixtures, and `agent doctor`.
2. Publish machine-readable schemas and `describe`; refactor command actions toward shared
   result objects where needed.
3. Add `agent init`/`add`, native overlays, then general `agent import` and schema upgrades.
4. Add `agent audit`, followed by deterministic packaging and marketplace output.
5. Implement `md context` and `md diff` on the current workspace/index foundation.
6. Extract the shared edit planner, then add only conservative `md fix` rules.
7. Generalize workspace queries and add source-linked snippet checking.
8. Expose a library API, then build the read-only MCP server and CI integration.
9. Add new targets only through the conformance-backed adapter model.

## Features to Avoid or Defer

- **Hosted model calls in core commands.** They would add credentials, cost, nondeterminism,
  and provider coupling. Emit context and contracts that any agent can consume instead.
- **Executing fenced code by default.** Static snippet synchronization is useful; arbitrary
  execution creates a much larger trust and sandboxing problem.
- **A general Markdown formatter or renderer.** Prettier, markdownlint, and site generators
  already own that space. This project is more differentiated at structural validation,
  graph analysis, context assembly, and safe refactoring.
- **One command per narrow query.** Prefer a typed query engine plus a small number of common
  shortcuts.
- **Automatic publication or plugin installation in the first packaging release.** Produce
  deterministic artifacts and checks first; external mutations can be layered on with clear
  authentication and confirmation boundaries.
- **Immediate support for many agent platforms.** A smaller target set that is continuously
  conformant is more valuable than broad output that quietly drifts from native schemas.

## External Signals Used in This Review

The recommendations above are grounded primarily in this repository. These current official
platform references were used only to check the direction of the rapidly changing plugin
surfaces:

- [OpenAI: Package your plugin](https://developers.openai.com/plugins/build/plugins) documents
  Codex plugin manifests, marketplace metadata, MCP wiring, hooks, assets, and local/repository
  distribution.
- [Anthropic: Plugins reference](https://code.claude.com/docs/en/plugins-reference) documents
  Claude Code component schemas, native validation and management commands, and additional
  plugin component types.
- [Cursor 2.5: Plugins](https://cursor.com/changelog/2-5) establishes Cursor's first-class
  plugin bundle and marketplace model for skills, subagents, MCP servers, hooks, and rules.

Because these formats evolve independently, their details should be captured in versioned
target profiles and fixtures rather than copied permanently into this planning document.
