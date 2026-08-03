import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import type { OutputFormat } from "../types.js";
import {
  diffDocuments,
  summarize,
  type DiffReport,
  type FileDiff,
  type HeadingChange,
} from "../diff.js";
import {
  changesSince,
  readAtRevision,
  repositoryFor,
  repositoryRelative,
  resolveCommit,
  worktreePath,
  type GitRepository,
  type RevisionChange,
} from "../git.js";
import { buildDocument, type MarkdownDocument } from "../workspace.js";
import { requireFile } from "../input.js";
import { outputPath, runtime } from "../runtime.js";
import { jsonPayload } from "../result.js";

interface DiffOptions {
  envelope?: boolean;
  format: string;
  paths?: string;
  since?: string;
  summary: boolean;
  include: string[];
  exclude: string[];
}

function resolveFormat(opts: DiffOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

/** Parses a document at a revision without letting it into the workspace cache. */
function baseDocument(
  repository: GitRepository,
  revision: string,
  repoRelativePath: string,
): MarkdownDocument | null {
  const content = readAtRevision(repository, revision, repoRelativePath);
  if (content === undefined) return null;
  return buildDocument(worktreePath(repository, repoRelativePath), content);
}

function worktreeDocument(file: string): MarkdownDocument | null {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return runtime().workspace.document(file);
}

function revisionReport(target: string | undefined, opts: DiffOptions): DiffReport {
  const root = runtime().config.root;
  const revision = opts.since!;
  const repository = repositoryFor(root);
  const scope = path.resolve(target ?? root);
  const scopeIsFile = fs.existsSync(scope) && fs.statSync(scope).isFile();
  const scopePrefix = scopeIsFile ? repositoryRelative(repository, scope) : undefined;
  const scopeDirectory = scopeIsFile ? undefined : repositoryRelative(repository, scope);

  // A deleted file has no worktree entry, so include/exclude are matched
  // against the path string rather than resolved through the workspace walker.
  const selected = (change: RevisionChange): boolean => {
    const absolute = worktreePath(repository, change.newPath ?? change.oldPath ?? "");
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const matches = (pattern: string) =>
      minimatch(relative, pattern, { dot: true, nonegate: true });
    return opts.include.some(matches) && !opts.exclude.some(matches);
  };

  const inScope = (change: RevisionChange): boolean => {
    const name = change.newPath ?? change.oldPath ?? "";
    if (scopePrefix !== undefined) return name === scopePrefix;
    if (scopeDirectory) {
      if (name !== scopeDirectory && !name.startsWith(`${scopeDirectory}/`)) return false;
    }
    return selected(change);
  };

  const files: FileDiff[] = [];
  for (const change of changesSince(repository, revision).filter(inScope)) {
    const newPath = change.newPath;
    const oldPath = change.oldPath;
    const before = oldPath ? baseDocument(repository, revision, oldPath) : null;
    const after = newPath ? worktreeDocument(worktreePath(repository, newPath)) : null;
    if (!before && !after) continue;
    const shownFile = outputPath(worktreePath(repository, newPath ?? oldPath ?? ""), opts);
    files.push(
      diffDocuments(before, after, {
        root,
        file: shownFile,
        ...(oldPath && newPath && oldPath !== newPath
          ? { oldPath: outputPath(worktreePath(repository, oldPath), opts) }
          : {}),
        ...(change.similarity === undefined ? {} : { similarity: change.similarity }),
      }),
    );
  }

  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return summarize(files, {
    mode: "revision",
    base: revision,
    baseCommit: resolveCommit(repository, revision),
  });
}

function filesReport(from: string, to: string, opts: DiffOptions): DiffReport {
  const before = requireFile(from, opts);
  const after = requireFile(to, opts);
  const workspace = runtime().workspace;
  const diff = diffDocuments(workspace.document(before), workspace.document(after), {
    root: runtime().config.root,
    file: outputPath(after, opts),
    oldPath: outputPath(before, opts),
  });
  return summarize([diff], {
    mode: "files",
    from: outputPath(before, opts),
    to: outputPath(after, opts),
  });
}

function headingLine(change: HeadingChange): string {
  const where = change.newLine ?? change.oldLine;
  if (change.kind === "added") return `"${change.newText}" L${where}`;
  if (change.kind === "removed") return `"${change.oldText}" L${where}`;
  if (change.kind === "renamed") {
    return (
      `"${change.oldText}" -> "${change.newText}" (L${where}` +
      (change.heuristic ? ", heuristic)" : ")")
    );
  }
  if (change.kind === "moved")
    return `"${change.newText}" L${change.oldLine} -> L${change.newLine}`;
  return `"${change.newText}" L${where} body changed`;
}

function renderText(report: DiffReport, view: { human: boolean; summary: boolean }): string {
  const { human, summary } = view;
  const bold = (value: string) => (human ? `\x1b[1m${value}\x1b[0m` : value);
  const dim = (value: string) => (human ? `\x1b[2m${value}\x1b[0m` : value);
  const colored = (value: string, code: string) => (human ? `\x1b[${code}m${value}\x1b[0m` : value);
  const paint = (kind: string): string =>
    colored(
      kind.padEnd(7),
      kind === "added" ? "32" : kind === "removed" ? "31" : kind === "changed" ? "36" : "33",
    );

  const head =
    report.mode === "revision"
      ? `Diff: ${report.base} (${report.baseCommit?.slice(0, 7)}) -> worktree`
      : `Diff: ${report.from} -> ${report.to}`;
  const lines = [
    bold(head),
    `${report.totals.filesChanged} file(s) changed of ${report.totals.files}, ` +
      `${report.totals.headings + report.totals.frontmatter + report.totals.links + report.totals.tasks + report.totals.codeBlocks + report.totals.tables} change(s)`,
  ];

  for (const file of report.files) {
    if (file.status === "unchanged" && !summary) continue;
    const name = file.oldPath ? `${file.oldPath} -> ${file.file}` : file.file;
    lines.push("", bold(`${name} [${file.status}]`) + ` ${file.totals.changes} change(s)`);
    if (summary) continue;

    for (const change of file.headings) {
      lines.push(`  heading      ${paint(change.kind)} ${headingLine(change)}`);
    }
    for (const change of file.frontmatter) {
      const key = change.key ?? "(block)";
      const detail =
        change.key === null
          ? `${change.oldStatus} -> ${change.newStatus}`
          : `${JSON.stringify(change.oldValue) ?? ""} -> ${JSON.stringify(change.newValue) ?? ""}`;
      lines.push(`  frontmatter  ${paint(change.kind)} ${key}: ${detail}`);
    }
    for (const change of file.links) {
      const detail =
        change.kind === "changed"
          ? `${change.oldTarget} -> ${change.newTarget}${change.fragmentChanged ? " (anchor only)" : ""}`
          : (change.newTarget ?? change.oldTarget);
      lines.push(
        `  link         ${paint(change.kind)} ${detail} (L${change.newLine ?? change.oldLine})`,
      );
    }
    for (const change of file.tasks) {
      const state =
        change.kind === "changed"
          ? `[${change.oldChecked ? "x" : " "}] -> [${change.newChecked ? "x" : " "}]`
          : `[${(change.newChecked ?? change.oldChecked) ? "x" : " "}]`;
      lines.push(
        `  task         ${paint(change.kind)} ${state} "${change.text}" (L${change.newLine ?? change.oldLine})`,
      );
    }
    for (const change of file.codeBlocks) {
      const detail = change.langChanged
        ? `lang ${change.oldLang ?? "(none)"} -> ${change.newLang ?? "(none)"}`
        : `${change.newLang ?? change.oldLang ?? "(none)"}${change.contentChanged ? " body changed" : ""}`;
      lines.push(
        `  ${change.mermaid ? "diagram   " : "code-block"}   ${paint(change.kind)} ${detail} (L${change.newLine ?? change.oldLine})`,
      );
    }
    for (const change of file.tables) {
      lines.push(
        `  table        ${paint(change.kind)} ${change.newColumns ?? change.oldColumns} column(s), ` +
          `${change.newRows ?? change.oldRows} row(s)${change.headersChanged ? ", headers changed" : ""} ` +
          `(L${change.newLine ?? change.oldLine})`,
      );
    }
  }

  if (!report.totals.filesChanged) lines.push("", "No Markdown changes.");
  if (report.totals.heuristicRenames) {
    lines.push(
      "",
      dim(
        `${report.totals.heuristicRenames} rename(s) were matched by position and are a heuristic, not a fact.`,
      ),
    );
  }
  return lines.join("\n");
}

export async function diffAction(
  a: string | undefined,
  b: string | undefined,
  opts: DiffOptions,
): Promise<void> {
  const format = resolveFormat(opts);
  if (b !== undefined && opts.since) {
    throw new Error("--since cannot be combined with two paths");
  }
  if (b === undefined && !opts.since) {
    throw new Error("md diff needs two paths, or --since <revision> to compare against");
  }
  if (a === "-" || b === "-") throw new Error("md diff does not accept stdin");

  const report = b !== undefined ? filesReport(a!, b, opts) : revisionReport(a, opts);
  process.stdout.write(
    format === "json"
      ? jsonPayload("md diff", report, opts)
      : renderText(report, { human: format === "human", summary: opts.summary }) + "\n",
  );
}
