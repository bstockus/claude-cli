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
import { selectFixers, type FixerContext, type UnfixableFinding } from "../fix/registry.js";
import { resolveMarkdownInputs } from "../input-selection.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { jsonPayload } from "../result.js";

export type FixMode = "check" | "dry-run" | "write";

interface FixOptions {
  envelope?: boolean;
  format: string;
  paths?: string;
  rule: string[];
  check?: boolean;
  write?: boolean;
  dryRun?: boolean;
  include: string[];
  exclude: string[];
  changedSince?: string;
  maxDepth: string;
  minDepth: string;
  ordered: boolean;
}

export interface FixEditJson {
  /** UTF-16 code-unit offset of the first replaced character. */
  start: number;
  /** Exclusive. `start === end` is an insertion. */
  end: number;
  /** 1-based line containing `start`. */
  line: number;
  /** The exact text currently at `[start, end)`. */
  expected: string;
  replacement: string;
  diagnostic: { rule: string; line: number; message: string };
}

export interface FixFileJson {
  file: string;
  edits: FixEditJson[];
  /** Present only in --write mode: whether the file's bytes changed. */
  applied?: boolean;
}

export interface FixPayload {
  mode: FixMode;
  /** The fixers that ran, sorted. */
  rules: string[];
  filesScanned: number;
  filesWithEdits: number;
  edits: number;
  /** Files whose bytes changed. Always 0 outside --write. */
  applied: number;
  files: FixFileJson[];
  conflicts: Array<{ kind: string; file: string; message: string; rules: string[] }>;
  unfixable: UnfixableFinding[];
}

function resolveFormat(opts: FixOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

/**
 * Which of check, dry-run, and write was asked for.
 *
 * A plain guard is enough here, unlike `md toc`, because those three keys are
 * deliberately absent from `COMMAND_OPTIONS.fix`: the mutation mode is
 * CLI-only, so a checked-in config file can never turn `md fix` into a writer
 * and there is no config-versus-CLI ambiguity to disentangle.
 */
function resolveMode(opts: FixOptions): FixMode {
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

function renderText(payload: FixPayload, human: boolean): string {
  const bold = (value: string) => (human ? `\x1b[1m${value}\x1b[0m` : value);
  const red = (value: string) => (human ? `\x1b[31m${value}\x1b[0m` : value);
  const green = (value: string) => (human ? `\x1b[32m${value}\x1b[0m` : value);
  const cyan = (value: string) => (human ? `\x1b[36m${value}\x1b[0m` : value);
  const rules = payload.rules.join(", ");
  const lines: string[] = [];

  if (payload.mode === "check") {
    lines.push(
      payload.edits
        ? bold(
            `${payload.edits} pending fix(es) in ${payload.filesWithEdits} file(s) [rules: ${rules}]`,
          )
        : `No pending fixes in ${payload.filesScanned} file(s) [rules: ${rules}]`,
    );
    for (const file of payload.files) {
      for (const item of file.edits) {
        lines.push(
          `  ${cyan(`${file.file}:L${item.line}`)}  ${item.diagnostic.rule}  ${item.diagnostic.message}`,
        );
      }
    }
    if (payload.edits) lines.push("Run with --dry-run to see the full plan, or --write to apply.");
  } else if (payload.mode === "dry-run") {
    for (const file of payload.files) {
      lines.push(bold(file.file));
      for (const item of file.edits) {
        lines.push(
          `  L${item.line}  ${item.diagnostic.rule}  [${item.start},${item.end})`,
          `    ${red(`- ${truncate(item.expected)}`)}`,
          `    ${green(`+ ${truncate(item.replacement)}`)}`,
        );
      }
    }
    lines.push(
      payload.edits
        ? `${payload.edits} edit(s) across ${payload.filesWithEdits} file(s). (dry run — no files modified)`
        : `No pending fixes in ${payload.filesScanned} file(s).`,
    );
  } else {
    for (const file of payload.files) {
      lines.push(`${file.file}  ${file.edits.length} edit(s)`);
    }
    lines.push(
      payload.applied
        ? `Applied ${payload.edits} edit(s) across ${payload.applied} file(s).`
        : `No pending fixes in ${payload.filesScanned} file(s).`,
    );
  }

  if (payload.conflicts.length) {
    lines.push("", bold("Conflicts (nothing will be written):"));
    for (const conflict of payload.conflicts) {
      lines.push(`  ${conflict.file}  ${conflict.kind}  ${conflict.message}`);
    }
  }
  if (payload.unfixable.length) {
    lines.push("", bold("Not fixable automatically:"));
    for (const item of payload.unfixable) {
      lines.push(`  ${item.file}:L${item.line}  ${item.rule}  ${item.message} (${item.reason})`);
    }
  }
  return lines.join("\n");
}

function toPayload(
  mode: FixMode,
  rules: string[],
  filesScanned: number,
  plan: EditPlan,
  unfixable: UnfixableFinding[],
  applied: Set<string> | undefined,
  opts: FixOptions,
): FixPayload {
  const files: FixFileJson[] = plan.files.map((entry) => ({
    file: outputPath(entry.file, opts),
    edits: entry.edits.map((item) => ({
      start: item.start,
      end: item.end,
      line: item.diagnostic.line,
      expected: item.expected,
      replacement: item.replacement,
      diagnostic: { ...item.diagnostic },
    })),
    ...(applied ? { applied: applied.has(entry.file) } : {}),
  }));
  return {
    mode,
    rules,
    filesScanned,
    filesWithEdits: plan.files.length,
    edits: plan.files.reduce((total, entry) => total + entry.edits.length, 0),
    applied: applied?.size ?? 0,
    files,
    conflicts: plan.conflicts.map((conflict) => ({
      ...conflict,
      file: outputPath(conflict.file, opts),
    })),
    unfixable: unfixable.map((item) => ({ ...item, file: outputPath(item.file, opts) })),
  };
}

export async function fixAction(inputs: string[], opts: FixOptions): Promise<void> {
  const format = resolveFormat(opts);
  const mode = resolveMode(opts);
  // md fix writes, and stdin has no path to write back to.
  if (inputs.includes("-")) throw new Error("md fix does not accept stdin");
  const fixers = selectFixers(opts.rule);

  const files = resolveMarkdownInputs(inputs, {
    include: opts.include,
    exclude: opts.exclude,
    changedSince: opts.changedSince,
  });

  const root = containmentRoot(files, runtime().config);
  const snapshots = new Map<string, FileSnapshot>();
  const context: FixerContext = {
    root,
    snapshot: (file) => {
      const cached = snapshots.get(file);
      if (cached) return cached;
      const taken = snapshot(file);
      snapshots.set(file, taken);
      return taken;
    },
    toc: { maxDepth: opts.maxDepth, minDepth: opts.minDepth, ordered: opts.ordered },
  };

  const edits: PlannedEdit[] = [];
  const unfixable: UnfixableFinding[] = [];
  for (const fixer of fixers) {
    const result = await fixer.plan(files, context);
    edits.push(...result.edits);
    unfixable.push(...result.unfixable);
  }

  const plan = buildPlan(root, edits, snapshots);
  let applied: Set<string> | undefined;
  if (mode === "write" && !plan.conflicts.length) {
    const result = applyPlan(plan, { invalidate: (file) => runtime().workspace.invalidate(file) });
    applied = new Set(result.files.filter((file) => file.changed).map((file) => file.file));
  }

  const payload = toPayload(
    mode,
    fixers.map((fixer) => fixer.name).sort(),
    files.length,
    plan,
    unfixable,
    mode === "write" ? (applied ?? new Set()) : undefined,
    opts,
  );

  // A conflict means --write cannot succeed, so it fails every mode: otherwise
  // `md fix --dry-run && md fix --write` would be a lie. A pending edit only
  // fails --check, which is the mode meant for CI. Unfixable findings never
  // change the exit code — there is no fix available to make them go away.
  const actionable = payload.conflicts.length > 0 || (mode === "check" && payload.edits > 0);

  const rendered =
    format === "json"
      ? jsonPayload("md fix", payload, opts, {
          exitCode: actionable ? 2 : 0,
          summary: { edits: payload.edits, conflicts: payload.conflicts.length },
        }).trimEnd()
      : renderText(payload, format === "human");
  (actionable ? process.stderr : process.stdout).write(rendered + "\n");
  if (actionable) terminate(2);
}
