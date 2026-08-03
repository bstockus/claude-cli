import type { OutputFormat } from "../types.js";
import {
  applyPlan,
  buildPlan,
  containmentRoot,
  snapshot,
  type EditPlan,
  type FileSnapshot,
  type PlannedEdit,
} from "../edit-plan.js";
import { extractCodeBlocks, parseMarkdown } from "../markdown-ast.js";
import {
  createSourceReader,
  snippetEdits,
  synchronizeSnippets,
  type SnippetReason,
  type SnippetSynchronization,
} from "../snippets.js";
import { fingerprint } from "../workspace-index.js";
import { resolveMarkdownInputs } from "../input-selection.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { jsonPayload } from "../result.js";

export type CheckSnippetsMode = "check" | "dry-run" | "write";

interface CheckSnippetsOptions {
  envelope?: boolean;
  format: string;
  paths?: string;
  check?: boolean;
  write?: boolean;
  dryRun?: boolean;
  includeOk: boolean;
  include: string[];
  exclude: string[];
}

export interface SnippetFindingJson {
  file: string;
  /** 1-based line of the opening fence. */
  line: number;
  endLine: number;
  status: "current" | "stale" | "unresolved" | "malformed";
  /** The attribute value as written. Absent when it could not be parsed. */
  target?: string;
  /** Absolute or relative per --paths. Absent until the path resolves. */
  source?: string;
  /** Present on everything except a clean match. */
  reason?: SnippetReason;
  message?: string;
  /** --dry-run only: the two bodies, container indentation removed. */
  documented?: string;
  expected?: string;
  /** Stale blocks outside --check: false when the fence cannot be rewritten. */
  writable?: boolean;
  /** --write only: whether this block's bytes changed. */
  applied?: boolean;
}

export interface CheckSnippetsPayload {
  mode: CheckSnippetsMode;
  filesScanned: number;
  /** Fences carrying a snippet link. An unlinked fence is never counted. */
  linked: number;
  current: number;
  drift: number;
  unresolved: number;
  malformed: number;
  /** Stale blocks the fence cannot accept. Always 0 under --check. */
  unwritable: number;
  /** Files whose bytes changed. Always 0 outside --write. */
  applied: number;
  /** `current` entries appear only under --include-ok. */
  findings: SnippetFindingJson[];
  conflicts: Array<{ kind: string; file: string; message: string; rules: string[] }>;
}

function resolveFormat(opts: CheckSnippetsOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

/**
 * Which of check, dry-run, and write was asked for.
 *
 * A plain guard is enough, as in `md fix`: those three keys are deliberately
 * absent from `COMMAND_OPTIONS["check-snippets"]`, so a checked-in config can
 * never turn this checker into a writer and there is no config-versus-CLI
 * ambiguity to disentangle. That rule matters more here than anywhere else,
 * because `--write` copies the contents of arbitrary source files into tracked
 * documents.
 */
function resolveMode(opts: CheckSnippetsOptions): CheckSnippetsMode {
  const requested = (
    [
      ["check", opts.check],
      ["write", opts.write],
      ["dry-run", opts.dryRun],
    ] as const
  )
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  if (requested.length > 1) {
    throw new Error("--check, --write, and --dry-run cannot be used together");
  }
  return requested[0] ?? "check";
}

function truncate(value: string, limit = 120): string {
  const flat = value.replace(/\n/g, "\\n");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function toFinding(
  file: string,
  result: SnippetSynchronization,
  mode: CheckSnippetsMode,
  applied: Set<string> | undefined,
  opts: CheckSnippetsOptions,
): SnippetFindingJson {
  const base = {
    file: outputPath(file, opts),
    line: result.line,
    endLine: result.endLine,
  };
  if (result.status === "malformed") {
    return { ...base, status: "malformed", reason: result.reason, message: result.message };
  }
  if (result.status === "unresolved") {
    return {
      ...base,
      status: "unresolved",
      target: result.target,
      ...(result.source ? { source: outputPath(result.source, opts) } : {}),
      reason: result.reason,
      message: result.message,
    };
  }
  if (result.status === "current") {
    return {
      ...base,
      status: "current",
      target: result.target,
      source: outputPath(result.source, opts),
    };
  }
  return {
    ...base,
    status: "stale",
    target: result.target,
    source: outputPath(result.source, opts),
    ...(result.unwritable && mode !== "check"
      ? { reason: result.unwritable.reason, message: result.unwritable.message }
      : {}),
    ...(mode === "dry-run" ? { documented: result.documented, expected: result.expected } : {}),
    ...(mode === "check" ? {} : { writable: Boolean(result.write) }),
    ...(applied ? { applied: applied.has(file) && Boolean(result.write) } : {}),
  };
}

function renderText(payload: CheckSnippetsPayload, human: boolean): string {
  const bold = (value: string) => (human ? `\x1b[1m${value}\x1b[0m` : value);
  const red = (value: string) => (human ? `\x1b[31m${value}\x1b[0m` : value);
  const green = (value: string) => (human ? `\x1b[32m${value}\x1b[0m` : value);
  const cyan = (value: string) => (human ? `\x1b[36m${value}\x1b[0m` : value);
  const lines: string[] = [];

  const headline =
    payload.mode === "write"
      ? payload.applied
        ? `Refreshed ${payload.applied} file(s) of ${payload.linked} linked snippet(s).`
        : `Nothing to refresh in ${payload.linked} linked snippet(s).`
      : payload.drift + payload.unresolved + payload.malformed
        ? bold(
            `${payload.drift} stale, ${payload.unresolved} unresolved, ${payload.malformed} malformed ` +
              `of ${payload.linked} linked snippet(s) in ${payload.filesScanned} file(s)`,
          )
        : `${payload.linked} linked snippet(s) up to date in ${payload.filesScanned} file(s)`;

  for (const finding of payload.findings) {
    const where = cyan(`${finding.file}:L${finding.line}`);
    if (finding.status === "current") {
      lines.push(`  ${where}  ok  ${finding.target}`);
      continue;
    }
    if (finding.status === "stale") {
      const suffix = finding.writable === false ? `  (not rewritten: ${finding.reason})` : "";
      lines.push(`  ${where}  stale  ${finding.target}${suffix}`);
      if (payload.mode === "dry-run") {
        lines.push(`    ${red(`- ${truncate(finding.documented ?? "")}`)}`);
        lines.push(`    ${green(`+ ${truncate(finding.expected ?? "")}`)}`);
      }
      continue;
    }
    lines.push(`  ${where}  ${finding.status}  ${finding.reason}  ${finding.message}`);
  }

  lines.push(headline);
  if (payload.mode === "dry-run" && payload.drift) {
    lines.push("(dry run — no files modified)");
  }
  if (payload.mode === "check" && payload.drift) {
    lines.push("Run with --dry-run to see the full plan, or --write to refresh.");
  }
  if (payload.conflicts.length) {
    lines.push("", bold("Conflicts (nothing will be written):"));
    for (const conflict of payload.conflicts) {
      lines.push(`  ${conflict.file}  ${conflict.kind}  ${conflict.message}`);
    }
  }
  return lines.join("\n");
}

export async function checkSnippetsAction(
  inputs: string[],
  opts: CheckSnippetsOptions,
): Promise<void> {
  const format = resolveFormat(opts);
  const mode = resolveMode(opts);
  // --write has no path to write stdin back to, and a snippet link is only
  // meaningful relative to a document that has a location on disk.
  if (inputs.includes("-")) throw new Error("md check-snippets does not accept stdin");

  const files = resolveMarkdownInputs(inputs, { include: opts.include, exclude: opts.exclude });

  // Two roots, deliberately. Source reads are bounded by the workspace, because
  // a document under docs/ legitimately points at ../src; writes are bounded by
  // the md fix containment root, which for `md check-snippets docs` is docs/
  // itself and would reject every real source.
  const readRoot = runtime().config.root;
  const writeRoot = containmentRoot(files, runtime().config);
  const read = createSourceReader(readRoot);

  const snapshots = new Map<string, FileSnapshot>();
  const perFile: Array<{ file: string; results: SnippetSynchronization[] }> = [];
  const edits: PlannedEdit[] = [];

  for (const file of files) {
    const taken = snapshot(file);
    snapshots.set(file, taken);
    const document = runtime().workspace.document(file);
    // Offsets address the snapshot's bytes; the cached tree is only safe to
    // reuse when it was parsed from exactly those bytes.
    const blocks =
      document.content === taken.content
        ? extractCodeBlocks(document.tree)
        : extractCodeBlocks(parseMarkdown(taken.content));
    const results = synchronizeSnippets(taken.content, blocks, { file, root: readRoot, read });
    if (!results.length) continue;
    perFile.push({ file, results });
    edits.push(...snippetEdits(file, taken.content, results));
  }

  const plan: EditPlan =
    mode === "write"
      ? buildPlan(writeRoot, edits, snapshots)
      : { root: writeRoot, files: [], conflicts: [] };

  let applied: Set<string> | undefined;
  if (mode === "write" && !plan.conflicts.length) {
    // applyPlan re-fingerprints its edit targets but knows nothing about the
    // sources the replacements were read from, so a source edited mid-run
    // would otherwise land already stale.
    for (const { results } of perFile) {
      for (const result of results) {
        if (result.status !== "stale" || !result.write) continue;
        const current = fingerprint(result.source);
        if (
          current.size !== result.sourceFingerprint.size ||
          current.mtimeMs !== result.sourceFingerprint.mtimeMs
        ) {
          throw new Error(`Aborted: ${result.source} changed after the plan was built`);
        }
      }
    }
    const result = applyPlan(plan, { invalidate: (file) => runtime().workspace.invalidate(file) });
    applied = new Set(result.files.filter((entry) => entry.changed).map((entry) => entry.file));
  }

  const findings: SnippetFindingJson[] = [];
  let linked = 0;
  let current = 0;
  let drift = 0;
  let unresolved = 0;
  let malformed = 0;
  let unwritable = 0;
  for (const entry of perFile) {
    for (const result of entry.results) {
      linked++;
      if (result.status === "current") current++;
      else if (result.status === "unresolved") unresolved++;
      else if (result.status === "malformed") malformed++;
      else {
        drift++;
        if (!result.write && mode !== "check") unwritable++;
      }
      if (result.status === "current" && !opts.includeOk) continue;
      findings.push(toFinding(entry.file, result, mode, applied, opts));
    }
  }

  const payload: CheckSnippetsPayload = {
    mode,
    filesScanned: files.length,
    linked,
    current,
    drift,
    unresolved,
    malformed,
    unwritable,
    applied: applied?.size ?? 0,
    findings,
    conflicts: plan.conflicts.map((conflict) => ({
      ...conflict,
      file: outputPath(conflict.file, opts),
    })),
  };

  // Unlike `md fix`, a finding with no available fix fails every mode. This
  // command's job is checking, so a snippet naming a deleted file or a deleted
  // region is the most severe drift it can report — exiting 0 would let CI pass
  // over provably wrong documentation. Drift itself only fails the modes that
  // are not about to correct it.
  const actionable =
    payload.conflicts.length > 0 ||
    payload.malformed + payload.unresolved + payload.unwritable > 0 ||
    (mode !== "write" && payload.drift > 0);

  const rendered =
    format === "json"
      ? jsonPayload("md check-snippets", payload, opts, {
          exitCode: actionable ? 2 : 0,
          summary: {
            linked: payload.linked,
            drift: payload.drift,
            unresolved: payload.unresolved + payload.malformed,
          },
        }).trimEnd()
      : renderText(payload, format === "human");
  (actionable ? process.stderr : process.stdout).write(rendered + "\n");
  if (actionable) terminate(2);
}
