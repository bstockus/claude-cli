import fs from "node:fs";
import path from "node:path";
import { extractLinks, parseMarkdown } from "../markdown-ast.js";
import { resolveLocalPath, splitLocalTarget } from "../link-target.js";
import { outputPath, runtime } from "../runtime.js";
import type { OutputFormat } from "../types.js";
import { jsonPayload } from "../result.js";

interface Options {
  envelope?: boolean;
  format: string;
  paths?: string;
  dryRun: boolean;
  include: string[];
  exclude: string[];
}

interface Edit {
  start: number;
  end: number;
  value: string;
}

export interface FileReferenceUpdate {
  file: string;
  line: number;
  oldTarget: string;
  newTarget: string;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function regularNonSymlink(file: string): boolean {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function pathEntryExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function applyEdits(content: string, edits: readonly Edit[]): string {
  let result = content;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  }
  return result;
}

function encodePath(value: string, encoded: boolean): string {
  return encoded ? encodeURI(value).replace(/#/g, "%23") : value;
}

function rewrittenTarget(
  rawTarget: string,
  originalTarget: string,
  oldDocument: string,
  newDocument: string,
  source: string,
  destination: string,
  root: string,
): string | undefined {
  const split = splitLocalTarget(rawTarget);
  if (!split.path) return undefined;
  const resolved = resolveLocalPath(oldDocument, split.path, root);
  const movedTarget = resolved === source;
  if (!movedTarget && oldDocument === newDocument) return undefined;
  const absoluteTarget = movedTarget ? destination : resolved;
  let nextPath: string;
  if (split.rawPath.startsWith("/")) {
    if (!movedTarget) return undefined;
    nextPath = `/${path.relative(root, absoluteTarget).split(path.sep).join("/")}`;
  } else {
    nextPath = path.relative(path.dirname(newDocument), absoluteTarget).split(path.sep).join("/");
    if (!nextPath) nextPath = path.basename(absoluteTarget);
    if (split.rawPath.startsWith("./") && !nextPath.startsWith(".")) nextPath = `./${nextPath}`;
  }
  nextPath = encodePath(nextPath, split.rawPath.includes("%"));
  const suffix = split.query + (split.rawFragment === undefined ? "" : `#${split.rawFragment}`);
  const next = nextPath + suffix;
  return next === originalTarget ? undefined : next;
}

function format(options: Options): OutputFormat {
  return options.format === "human" || options.format === "json" ? options.format : "llm";
}

function temporarySibling(file: string): string {
  for (let index = 0; index < 100; index++) {
    const candidate = path.join(
      path.dirname(file),
      `.${path.basename(file)}.claude-cli-${process.pid}-${index}.tmp`,
    );
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate temporary file beside ${file}`);
}

export async function renameFileAction(
  sourceValue: string,
  destinationValue: string,
  opts: Options,
): Promise<void> {
  if (sourceValue === "-" || destinationValue === "-")
    throw new Error("rename-file does not accept stdin");
  const root = path.resolve(runtime().config.root);
  const source = path.resolve(sourceValue);
  const destination = path.resolve(destinationValue);
  if (!inside(root, source)) throw new Error(`Source is outside workspace root: ${source}`);
  if (!inside(root, destination))
    throw new Error(`Destination is outside workspace root: ${destination}`);
  if (!regularNonSymlink(source))
    throw new Error(`Source must be a regular, non-symlink file: ${source}`);
  if (pathEntryExists(destination)) throw new Error(`Destination already exists: ${destination}`);
  const parent = path.dirname(destination);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory())
    throw new Error(`Destination parent directory not found: ${parent}`);
  const realRoot = fs.realpathSync(root);
  if (!inside(realRoot, fs.realpathSync(source)))
    throw new Error(`Source is outside workspace root: ${source}`);
  if (!inside(realRoot, fs.realpathSync(parent)))
    throw new Error(`Destination is outside workspace root: ${destination}`);

  const markdownSource = /\.md(?:own)?$/i.test(source);
  const originalSource = fs.readFileSync(source);
  const sourceMode = fs.statSync(source).mode;
  const files = runtime()
    .workspace.markdownFiles(root, { include: opts.include, exclude: opts.exclude })
    .filter(regularNonSymlink);
  if (markdownSource && !files.includes(source)) files.push(source);
  files.sort();
  const generated = new Map<string, string>();
  const updates: FileReferenceUpdate[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const effectiveFile = file === source && markdownSource ? destination : file;
    const edits: Edit[] = [];
    const seen = new Set<string>();
    for (const link of extractLinks(parseMarkdown(content), content)) {
      if (
        link.isExternal ||
        link.destinationStart === undefined ||
        link.destinationEnd === undefined
      )
        continue;
      const key = `${link.destinationStart}:${link.destinationEnd}`;
      if (seen.has(key)) continue;
      const next = rewrittenTarget(
        link.target,
        link.target,
        file,
        effectiveFile,
        source,
        destination,
        root,
      );
      if (!next) continue;
      seen.add(key);
      const oldTarget = content.slice(link.destinationStart, link.destinationEnd);
      const newTarget = oldTarget.includes("\\")
        ? next.replace(/[()]/g, (character) => `\\${character}`)
        : next;
      edits.push({ start: link.destinationStart, end: link.destinationEnd, value: newTarget });
      updates.push({
        file: effectiveFile,
        line: link.destinationLine,
        oldTarget,
        newTarget,
      });
    }
    if (edits.length) generated.set(file, applyEdits(content, edits));
  }

  updates.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.oldTarget.localeCompare(b.oldTarget),
  );
  const changedFiles = [...new Set(updates.map((update) => update.file))].sort();
  const report = {
    move: { source: outputPath(source, opts), destination: outputPath(destination, opts) },
    changedFiles: changedFiles.map((file) => outputPath(file, opts)),
    updates: updates.map((update) => ({ ...update, file: outputPath(update.file, opts) })),
    dryRun: opts.dryRun,
  };
  if (format(opts) === "json") process.stdout.write(jsonPayload("md rename-file", report, opts));
  else {
    const lines = [
      `Move ${report.move.source} → ${report.move.destination}`,
      ...report.updates.map(
        (update) => `  ${update.file}:L${update.line}  ${update.oldTarget} → ${update.newTarget}`,
      ),
      `${updates.length} reference target(s) updated across ${changedFiles.length} file(s).`,
    ];
    if (opts.dryRun) lines.push("(dry run — no files modified)");
    process.stdout.write(lines.join("\n") + "\n");
  }
  if (opts.dryRun) return;

  const originals = new Map<string, string>();
  const staged = new Map<string, string>();
  let destinationStage: string | undefined;
  try {
    for (const [file, content] of generated) {
      if (file === source) continue;
      originals.set(file, fs.readFileSync(file, "utf-8"));
      const temporary = temporarySibling(file);
      fs.writeFileSync(temporary, content, { encoding: "utf-8", flag: "wx" });
      fs.chmodSync(temporary, fs.statSync(file).mode);
      staged.set(file, temporary);
    }
    const movedContent = generated.get(source);
    destinationStage = movedContent ? temporarySibling(destination) : undefined;
    if (destinationStage && movedContent !== undefined)
      fs.writeFileSync(destinationStage, movedContent, { encoding: "utf-8", flag: "wx" });
    if (destinationStage) fs.chmodSync(destinationStage, sourceMode);
    fs.renameSync(source, destination);
    if (destinationStage) fs.renameSync(destinationStage, destination);
    for (const [file, temporary] of staged) fs.renameSync(temporary, file);
  } catch (error) {
    for (const temporary of staged.values()) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        /* best effort */
      }
    }
    if (destinationStage) {
      try {
        fs.rmSync(destinationStage, { force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
    if (fs.existsSync(destination) && !fs.existsSync(source)) {
      try {
        fs.renameSync(destination, source);
      } catch {
        /* best effort */
      }
    }
    if (fs.existsSync(source)) {
      try {
        fs.writeFileSync(source, originalSource);
      } catch {
        // Best-effort rollback.
      }
    }
    for (const [file, content] of originals) {
      try {
        fs.writeFileSync(file, content, "utf-8");
      } catch {
        /* best effort */
      }
    }
    throw error;
  }
  runtime().workspace.invalidate(source);
  runtime().workspace.invalidate(destination);
  for (const file of generated.keys()) runtime().workspace.invalidate(file);
}
