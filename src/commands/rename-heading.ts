import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, extractHeadings, extractLinks, slugify } from "../markdown-ast.js";
import { findMarkdownFiles } from "../lint.js";
import { replaceFragment, resolveLocalPath, splitLocalTarget } from "../link-target.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";
import type { OutputFormat } from "../types.js";

interface RenameHeadingOptions {
  format: string;
  directory?: string;
  dryRun: boolean;
  include: string[];
  exclude: string[];
}

interface AnchorUpdate {
  file: string;
  line: number;
  oldRef: string;
  newRef: string;
}

interface Edit {
  start: number;
  end: number;
  value: string;
}

function resolveFormat(opts: RenameHeadingOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function applyEdits(content: string, edits: Edit[]): string {
  let result = content;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  }
  return result;
}

function headingTextSpan(content: string, line: number): { start: number; end: number } {
  const lines = content.split("\n");
  const startOfLine = lines
    .slice(0, line - 1)
    .reduce((total, value) => total + value.length + 1, 0);
  const raw = lines[line - 1] ?? "";
  const prefix = raw.match(/^(#{1,6}\s+)/)?.[0] ?? "";
  return { start: startOfLine + prefix.length, end: startOfLine + raw.length };
}

export async function renameHeadingAction(
  file: string,
  oldHeading: string,
  newHeading: string,
  opts: RenameHeadingOptions,
): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);

  const content = fs.readFileSync(filePath, "utf-8");
  const tree = parseMarkdown(content);
  const headings = extractHeadings(tree);
  const oldLower = oldHeading.toLowerCase();
  const oldSlugInput = slugify(oldHeading);
  const matchIdx = headings.findIndex(
    (heading) => heading.text.toLowerCase() === oldLower || heading.slug === oldSlugInput,
  );
  if (matchIdx === -1) {
    process.stderr.write(`Error: Heading not found: ${oldHeading}\n`);
    terminate(1);
  }

  const matched = headings[matchIdx];
  const headingSpan = headingTextSpan(content, matched.line);
  const headingEdit: Edit = { ...headingSpan, value: newHeading };
  const contentWithHeading = applyEdits(content, [headingEdit]);
  const newHeadings = extractHeadings(parseMarkdown(contentWithHeading));
  const slugChanges = new Map<string, string>();
  for (let index = 0; index < headings.length; index++) {
    if (headings[index].slug !== newHeadings[index].slug) {
      slugChanges.set(headings[index].slug, newHeadings[index].slug);
    }
  }
  const newSlug = newHeadings[matchIdx].slug;

  const filesToScan = [filePath];
  if (opts.directory) {
    const directory = path.resolve(opts.directory);
    try {
      filesToScan.push(
        ...findMarkdownFiles(directory, { include: opts.include, exclude: opts.exclude }).filter(
          (candidate) => candidate !== filePath,
        ),
      );
    } catch (error) {
      process.stderr.write(`Error: ${(error as Error).message}\n`);
      terminate(1);
    }
  }

  const updates: AnchorUpdate[] = [];
  const editsByFile = new Map<string, Edit[]>();
  const contents = new Map<string, string>();
  editsByFile.set(filePath, [headingEdit]);

  for (const scanFile of filesToScan) {
    const scanContent = scanFile === filePath ? content : fs.readFileSync(scanFile, "utf-8");
    contents.set(scanFile, scanContent);
    const links = extractLinks(
      scanFile === filePath ? tree : parseMarkdown(scanContent),
      scanContent,
    );
    const seenDestinations = new Set<string>();
    for (const link of links) {
      if (link.isExternal) continue;
      const target = splitLocalTarget(link.target);
      if (!target.fragment) continue;
      const targetPath = target.path
        ? resolveLocalPath(scanFile, target.path, runtime().config.root)
        : scanFile;
      if (targetPath !== filePath) continue;
      const replacementSlug = slugChanges.get(target.fragment);
      if (!replacementSlug) continue;
      if (
        scanFile === filePath &&
        link.destinationStart !== undefined &&
        link.destinationStart >= headingEdit.start &&
        link.destinationStart < headingEdit.end
      ) {
        continue;
      }
      const newTarget = replaceFragment(link.target, replacementSlug);
      const key = `${link.destinationStart ?? link.destinationLine}:${newTarget}`;
      if (seenDestinations.has(key)) continue;
      seenDestinations.add(key);
      updates.push({
        file: scanFile,
        line: link.destinationLine,
        oldRef: link.target,
        newRef: newTarget,
      });
      if (link.destinationStart !== undefined && link.destinationEnd !== undefined) {
        const edits = editsByFile.get(scanFile) ?? [];
        edits.push({ start: link.destinationStart, end: link.destinationEnd, value: newTarget });
        editsByFile.set(scanFile, edits);
      }
    }
  }

  if (format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          file: outputPath(filePath, opts),
          heading: {
            line: matched.line,
            oldText: matched.text,
            newText: newHeading,
            oldSlug: matched.slug,
            newSlug,
          },
          updates: updates.map((update) => ({
            ...update,
            file: outputPath(update.file, opts),
          })),
          dryRun: opts.dryRun,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    const isHuman = format === "human";
    const bold = (value: string) => (isHuman ? `\x1b[1m${value}\x1b[0m` : value);
    const cyan = (value: string) => (isHuman ? `\x1b[36m${value}\x1b[0m` : value);
    const prefix = "#".repeat(matched.depth);
    const lines = [
      bold(`Rename heading in ${outputPath(filePath, opts)}:`),
      `  L${matched.line}  "${prefix} ${matched.text}" → "${prefix} ${newHeading}"`,
    ];
    if (updates.length > 0) {
      lines.push("", bold("Anchor updates:"));
      for (const update of updates) {
        lines.push(
          `  ${cyan(`${outputPath(update.file, opts)}:L${update.line}`)}       ${update.oldRef} → ${update.newRef}`,
        );
      }
    }
    lines.push(
      "",
      `${updates.length} reference(s) updated across ${new Set(updates.map((update) => update.file)).size} file(s).`,
    );
    if (opts.dryRun) lines.push("(dry run — no files modified)");
    process.stdout.write(lines.join("\n") + "\n");
  }

  if (opts.dryRun) return;
  for (const [changedFile, edits] of editsByFile) {
    const original = contents.get(changedFile) ?? content;
    fs.writeFileSync(changedFile, applyEdits(original, edits), "utf-8");
    runtime().workspace.invalidate(changedFile);
  }
}
