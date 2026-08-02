# Future Recommendations

## Product Positioning

Despite the `claude-cli` name, this project is intended to be a general support tool for
all LLM coding agents. Its Markdown inspection, validation, automation, and refactoring
capabilities should work equally well in workflows driven by Claude, Codex, Copilot,
Gemini, other coding agents, humans, and CI systems.

Future features should therefore remain agent-agnostic. Integrations may improve how an
agent consumes the CLI, but the core commands and output contracts should not depend on a
particular model provider, agent protocol, or hosted API.

The project's strongest identity is a predictable, mostly read-only Markdown analysis and
refactoring CLI with stable output for three audiences:

- LLM coding agents, through concise `llm` output
- Automation and CI, through structured `json` output and meaningful exit codes
- Humans, through readable `human` output

## Foundations to Address First

These improvements should precede substantial expansion of the command set because several
future features depend on them.

Status: implemented together as the initial foundations change. The sections remain here to
record the architectural intent that later recommendations should build upon.

### Renderer-compatible anchors and complete reference extraction

The current anchor slug generation is an approximation. It should model the selected
Markdown renderer's behavior for duplicate headings, Unicode, punctuation, and encoded URL
fragments. The implementation should make the renderer convention explicit, with GitHub
Markdown as a sensible default.

Reference extraction should also cover reference-style links and images, not only inline
`link` and `image` AST nodes. The resulting shared reference model should be used by linting,
TOC generation, section lookup, graph analysis, and refactoring commands.

### Shared project configuration and file discovery

Introduce a project configuration file such as `.claude-cli.yml` or
`.claude-cli.json`. It should support:

- Include and exclude globs
- Workspace root and document entry points
- Enabled and disabled checks
- Default output and command options where appropriate
- Markdown renderer or anchor convention
- Markdownlint configuration
- External URL exclusions and status allowances
- Frontmatter schema configuration

All directory-oriented commands should use one file-discovery implementation. Command-line
options should override project configuration.

### Shared command infrastructure

Consolidate behavior repeated by most commands:

- Output-format validation
- File and directory validation
- File reading and Markdown parsing
- Relative versus absolute path rendering
- Output stream and exit-code selection
- Common option and help registration

A command context that returns results rather than calling `process.exit()` deep inside each
action would also make unit testing and composition easier.

### Startup and workspace performance

Mermaid and jsdom are currently loaded for every CLI invocation through static imports,
including commands that do not inspect diagrams. Load them lazily and only when a Mermaid
block is present.

For directory operations, create a reusable workspace index that caches file contents,
parsed ASTs, headings, and references. This avoids parsing target documents repeatedly and
provides the basis for graph and refactoring features. Directory linting can then introduce
bounded concurrency where it is safe.

## Feature Recommendations

### 1. Workspace audit

Status: implemented by `md audit`.

Add `md audit <directory>` as the primary CI-oriented command. It should combine selected
workspace checks into one run:

- Markdown, Mermaid, KaTeX, and reference validation
- External URL validation when enabled
- Frontmatter schema validation
- Document reachability and graph checks
- Stale generated-content checks, such as a table of contents

It should support detailed and summary output while preserving the existing exit-code
contract: `0` for success, `1` for usage or operational failure, and `2` for actionable
findings.

### 2. Document graph and reachability

Status: implemented by `md graph`; `md orphans` reuses the shared graph model while
retaining its lightweight indegree contract.

Add `md graph <directory>` to build a workspace link graph. Useful outputs include JSON,
Mermaid, and DOT. Analysis should include:

- Inbound and outbound reference counts
- Documents unreachable from configured entry points
- Dead ends
- Cycles and disconnected components
- Broken graph edges

Reachability should be determined by traversal from entry points. The current orphan model
only checks whether a file has any inbound reference, which cannot identify a disconnected
cycle whose files reference one another.

The existing `md orphans` command can remain as a lightweight indegree check or evolve into
a compatibility alias for a specific graph query.

### 3. Frontmatter schema validation

Status: implemented by `md validate-frontmatter` with JSON Schema 2020-12 and shortcut
rules.

Extend frontmatter support beyond extraction with a command such as
`md validate-frontmatter <path>`. It should validate individual files or directories for:

- Required and prohibited keys
- Value types and allowed values
- Date and identifier formats
- Conditional fields
- Consistency or uniqueness across a workspace

JSON Schema is a good generic foundation, with concise configuration shortcuts for common
rules if needed.

### 4. TOC checking and synchronization

Status: implemented by marker-based `md toc --check`, `--dry-run`, and `--write` modes.

Extend `md toc` with marker-based maintenance:

- `--check` reports a missing or stale committed TOC without writing
- `--write` replaces only the content between explicit markers
- `--dry-run` previews the proposed change

The operation should use the same renderer-compatible anchor implementation as reference
validation. A check-only mode makes the feature useful in CI, while scoped markers keep the
write behavior safe and predictable.

### 5. Safe file rename and move

Add `md rename-file` or `md move` as the natural companion to `md rename-heading`. It should:

- Find and update inbound Markdown links and image references
- Preserve fragments and query components
- Recompute relative paths from every source document
- Refuse ambiguous or unsafe operations
- Support `--dry-run` and structured change output
- Apply changes atomically where practical

Project-level include and exclude rules should define the reference-update boundary.

### 6. Better automation inputs and outputs

Improve composability for agents, editors, hooks, and CI by adding:

- Standard-input support through `-`
- Multiple files and glob inputs where commands can naturally aggregate results
- Consistent relative-path output for portable logs
- JSON Lines for streaming large result sets
- SARIF output for code-scanning annotations
- An option to operate on files changed relative to a Git revision

Any new machine-readable format must retain the update notifier's guarantee that notices
never corrupt the payload stream.

### 7. Directory URL validation with caching

Extend `md check-urls` to accept a directory or shared workspace selection. Add:

- Deduplication across all documents
- A cache keyed by URL and relevant request options
- Configurable cache lifetime
- URL and domain ignore rules
- Allowed status-code rules
- Optional reporting of redirects and final destinations
- Stable handling for sites that reject `HEAD` requests

The cache should be an optimization and must never cause an otherwise valid command to fail.

### 8. Richer workspace queries

Once a workspace index exists, expose focused queries without reparsing the whole tree for
each one. Possible commands or graph options include:

- Documents linking to a heading or asset
- Duplicate titles, slugs, or frontmatter identifiers
- Unused image and asset files
- Code blocks grouped by language across a directory
- Tasks aggregated across a workspace
- Documents matching structural criteria, such as missing a top-level heading

Prefer adding coherent filters to a workspace query or audit model over accumulating many
nearly identical single-purpose commands.

## Suggested Delivery Order

1. Correct anchor and reference semantics.
2. Add shared configuration, discovery, command context, and lazy Mermaid loading.
3. Build a cached workspace index.
4. Implement `md graph`, including entry-point reachability.
5. Implement frontmatter schema validation and `md audit`.
6. Add TOC synchronization and safe file moves.
7. Add streaming, SARIF, changed-file selection, and URL caching.
8. Add richer queries based on demonstrated agent and CI workflows.

## Scope Guidance

Avoid arbitrary execution of code blocks by default. It would add a large security surface
and make safe agent use much harder. If executable examples are ever supported, execution
should require explicit configuration, command allowlists, isolation, timeouts, and clear
opt-in behavior.

Do not add provider-specific chat or model API behavior to the core CLI unless the product
scope intentionally changes. Provider-specific adapters should be thin integrations around
the same stable, agent-neutral commands and output contracts.
