import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, extractHeadings, extractLinks, slugify } from "../markdown-ast.js";
import { findMarkdownFiles } from "../lint.js";
import { replaceFragment, resolveLocalPath, splitLocalTarget } from "../link-target.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";
import type { OutputFormat } from "../types.js";
import { jsonPayload } from "../result.js";
import {
  applyEdits,
  applyPlan,
  buildPlan,
  containmentRoot,
  snapshot,
  type FileSnapshot,
  type PlannedEdit,
  type TextEdit,
} from "../edit-plan.js";

interface RenameHeadingOptions {
  envelope?: boolean;
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

function resolveFormat(opts: RenameHeadingOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
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
  if (file === "-") throw new Error("rename-heading does not accept stdin");
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
  const headingEdit: TextEdit = { ...headingSpan, value: newHeading };
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
  const snapshots = new Map<string, FileSnapshot>();
  const planned: PlannedEdit[] = [
    {
      file: filePath,
      ...headingEdit,
      expected: content.slice(headingEdit.start, headingEdit.end),
      replacement: headingEdit.value,
      diagnostic: {
        rule: "rename-heading",
        line: matched.line,
        message: `Rename heading to ${newHeading}`,
      },
    },
  ];

  for (const scanFile of filesToScan) {
    const taken = snapshot(scanFile);
    snapshots.set(scanFile, taken);
    const scanContent = scanFile === filePath ? content : taken.content;
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
        planned.push({
          file: scanFile,
          start: link.destinationStart,
          end: link.destinationEnd,
          value: newTarget,
          expected: scanContent.slice(link.destinationStart, link.destinationEnd),
          replacement: newTarget,
          diagnostic: {
            rule: "rename-heading",
            line: link.destinationLine,
            message: `Update anchor to ${newTarget}`,
          },
        });
      }
    }
  }

  if (format === "json") {
    process.stdout.write(
      jsonPayload(
        "md rename-heading",
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
        opts,
      ),
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

  // Applied as one transaction rather than a bare write loop: the same edits
  // and the same applyEdits, so the bytes written are unchanged, but a stale
  // input or a pair of overlapping edits now refuses instead of silently
  // letting the last one win.
  const plan = buildPlan(containmentRoot(filesToScan, runtime().config), planned, snapshots);
  if (plan.conflicts.length) {
    throw new Error(
      `Refusing to write: ${plan.conflicts.map((conflict) => conflict.message).join("; ")}`,
    );
  }
  applyPlan(plan, { invalidate: (file) => runtime().workspace.invalidate(file) });
}
