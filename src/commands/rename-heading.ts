import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, extractHeadings, extractLinks, slugify } from "../markdown-ast.js";
import { findMarkdownFiles } from "../lint.js";
import type { OutputFormat } from "../types.js";

interface RenameHeadingOptions {
  format: string;
  directory?: string;
  dryRun: boolean;
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function renameHeadingAction(
  file: string,
  oldHeading: string,
  newHeading: string,
  opts: RenameHeadingOptions,
): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const tree = parseMarkdown(content);
  const headings = extractHeadings(tree);

  // Find the old heading
  const oldLower = oldHeading.toLowerCase();
  const oldSlugInput = slugify(oldHeading);
  const matchIdx = headings.findIndex(
    (h) => h.text.toLowerCase() === oldLower || h.slug === oldSlugInput,
  );

  if (matchIdx === -1) {
    process.stderr.write(`Error: Heading not found: ${oldHeading}\n`);
    process.exit(1);
  }

  const matched = headings[matchIdx];
  const oldSlug = matched.slug;
  const newSlug = slugify(newHeading);

  // Check for duplicate slug
  const existingSlugs = headings.filter((_, i) => i !== matchIdx).map((h) => h.slug);
  if (existingSlugs.includes(newSlug)) {
    process.stderr.write(`Error: A heading with slug "${newSlug}" already exists in ${filePath}\n`);
    process.exit(1);
  }

  // Collect all files to scan for anchor updates
  const filesToScan: string[] = [filePath];
  if (opts.directory) {
    const dirPath = path.resolve(opts.directory);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const dirFiles = findMarkdownFiles(dirPath).filter((f) => f !== filePath);
      filesToScan.push(...dirFiles);
    }
  }

  // Find all anchor references to update
  const updates: AnchorUpdate[] = [];
  const fileContents = new Map<string, string>();
  const fileName = path.basename(filePath);

  for (const scanFile of filesToScan) {
    const scanContent = scanFile === filePath ? content : fs.readFileSync(scanFile, "utf-8");
    fileContents.set(scanFile, scanContent);
    const scanTree = scanFile === filePath ? tree : parseMarkdown(scanContent);
    const links = extractLinks(scanTree);

    for (const link of links) {
      const target = link.target;
      if (scanFile === filePath && target === `#${oldSlug}`) {
        updates.push({
          file: scanFile,
          line: link.line,
          oldRef: `#${oldSlug}`,
          newRef: `#${newSlug}`,
        });
      } else if (scanFile !== filePath) {
        // Check for cross-file references: file.md#slug or relative/path/to/file.md#slug
        const relPath = path.relative(path.dirname(scanFile), filePath);
        if (target === `${fileName}#${oldSlug}` || target === `${relPath}#${oldSlug}`) {
          const newTarget = target.replace(`#${oldSlug}`, `#${newSlug}`);
          updates.push({ file: scanFile, line: link.line, oldRef: target, newRef: newTarget });
        }
      }
    }
  }

  // Format output
  if (format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          file: filePath,
          heading: {
            line: matched.line,
            oldText: matched.text,
            newText: newHeading,
            oldSlug,
            newSlug,
          },
          updates,
          dryRun: opts.dryRun,
        },
        null,
        2,
      ) + "\n",
    );
    if (opts.dryRun) return;
  }

  if (format !== "json") {
    const isHuman = format === "human";
    const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);
    const cyan = (s: string) => (isHuman ? `\x1b[36m${s}\x1b[0m` : s);

    const lines: string[] = [];
    const prefix = "#".repeat(matched.depth);
    lines.push(bold(`Rename heading in ${filePath}:`));
    lines.push(`  L${matched.line}  "${prefix} ${matched.text}" → "${prefix} ${newHeading}"`);

    if (updates.length > 0) {
      lines.push("");
      lines.push(bold("Anchor updates:"));
      for (const u of updates) {
        lines.push(`  ${cyan(`${u.file}:L${u.line}`)}       ${u.oldRef} → ${u.newRef}`);
      }
    }

    lines.push("");
    lines.push(
      `${updates.length} reference(s) updated across ${new Set(updates.map((u) => u.file)).size} file(s).`,
    );
    if (opts.dryRun) lines.push("(dry run — no files modified)");

    process.stdout.write(lines.join("\n") + "\n");
  }

  if (opts.dryRun) return;

  // Apply changes
  // First, update the heading line in the target file
  const targetLines = (fileContents.get(filePath) ?? content).split("\n");
  const headingLine = targetLines[matched.line - 1];
  targetLines[matched.line - 1] = headingLine.replace(/^(#{1,6}\s+)(.*)$/, `$1${newHeading}`);

  // Apply anchor replacements in the target file
  const targetFileUpdates = updates.filter((u) => u.file === filePath);
  for (const u of targetFileUpdates) {
    const lineIdx = u.line - 1;
    targetLines[lineIdx] = targetLines[lineIdx].replace(
      new RegExp(escapeRegex(u.oldRef), "g"),
      u.newRef,
    );
  }
  fs.writeFileSync(filePath, targetLines.join("\n"), "utf-8");

  // Apply anchor replacements in other files
  const otherFiles = new Set(updates.filter((u) => u.file !== filePath).map((u) => u.file));
  for (const otherFile of otherFiles) {
    const otherContent = fileContents.get(otherFile) ?? fs.readFileSync(otherFile, "utf-8");
    const otherLines = otherContent.split("\n");
    const fileUpdates = updates.filter((u) => u.file === otherFile);
    for (const u of fileUpdates) {
      const lineIdx = u.line - 1;
      otherLines[lineIdx] = otherLines[lineIdx].replace(
        new RegExp(escapeRegex(u.oldRef), "g"),
        u.newRef,
      );
    }
    fs.writeFileSync(otherFile, otherLines.join("\n"), "utf-8");
  }
}
