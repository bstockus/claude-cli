import fs from "node:fs";
import type { MdLink } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";
import { splitLocalTarget, resolveLocalPath } from "../link-target.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";
import { jsonPayload } from "../result.js";

interface LinksOptions {
  envelope?: boolean;
  format: string;
  brokenOnly: boolean;
  type?: string;
  stdinName?: string;
}

function resolveFormat(opts: LinksOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function classifyLink(link: MdLink): string {
  if (link.isImage) return "image";
  if (link.isExternal) return "external";
  if (link.isAnchorOnly) return "anchor";
  return "internal";
}

function checkExists(link: MdLink, sourceFile: string): boolean | null {
  if (link.isExternal || link.isAnchorOnly) return null;
  const targetFile = splitLocalTarget(link.target).path;
  const resolvedPath = resolveLocalPath(sourceFile, targetFile, runtime().config.root);
  return fs.existsSync(resolvedPath);
}

export async function linksAction(file: string, opts: LinksOptions): Promise<void> {
  if (file === "-" && !opts.stdinName)
    throw new Error("--stdin-name is required for links with stdin");
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);

  const document = runtime().workspace.document(filePath);
  const contentLines = document.lines;
  let links = document.references;

  // Filter by type
  if (opts.type) {
    links = links.filter((l) => classifyLink(l) === opts.type);
  }

  // Check existence and optionally filter to broken only
  const resolved = links.map((l) => ({
    line: l.line,
    linkText: l.linkText,
    target: l.target,
    isImage: l.isImage,
    isExternal: l.isExternal,
    isAnchorOnly: l.isAnchorOnly,
    type: classifyLink(l),
    exists: checkExists(l, filePath),
    context: contentLines[l.line - 1]?.trim() ?? "",
  }));

  const filtered = opts.brokenOnly ? resolved.filter((r) => r.exists === false) : resolved;

  if (format === "json") {
    process.stdout.write(jsonPayload("md links", filtered, opts));
    return;
  }

  if (filtered.length === 0) {
    if (format === "human") {
      const msg = opts.brokenOnly ? "No broken links" : "No links";
      process.stdout.write(`\x1b[32m✔ ${msg} found in ${shownPath}\x1b[0m\n`);
    } else {
      const msg = opts.brokenOnly ? "No broken links" : "No links";
      process.stdout.write(`${msg} found in ${shownPath}\n`);
    }
    return;
  }

  // Group by type
  const groups = new Map<string, typeof filtered>();
  for (const l of filtered) {
    const existing = groups.get(l.type) ?? [];
    existing.push(l);
    groups.set(l.type, existing);
  }

  const lines: string[] = [];
  const isHuman = format === "human";

  if (isHuman) {
    lines.push(`\n\x1b[1m${filtered.length} link(s) in ${shownPath}\x1b[0m\n`);
  } else {
    lines.push(`${filtered.length} link(s) in ${shownPath}:`);
  }

  for (const [type, groupLinks] of groups) {
    if (isHuman) {
      lines.push(`  \x1b[1;33m${type}\x1b[0m (${groupLinks.length})`);
    } else {
      lines.push(`  ${type} (${groupLinks.length}):`);
    }

    for (const l of groupLinks) {
      const status =
        l.exists === null
          ? isHuman
            ? "\x1b[90m—\x1b[0m"
            : " "
          : l.exists
            ? isHuman
              ? "\x1b[32m✔\x1b[0m"
              : "[exists]"
            : isHuman
              ? "\x1b[1;31m✖\x1b[0m"
              : "[MISSING]";

      if (isHuman) {
        lines.push(`    ${status} \x1b[36mL${l.line}\x1b[0m ${l.target}`);
        lines.push(`       ${l.context}`);
      } else {
        lines.push(`    L${l.line} ${status} ${l.target}`);
        lines.push(`      ${l.context}`);
      }
    }
  }

  const broken = filtered.filter((l) => l.exists === false);
  if (broken.length > 0) {
    process.stderr.write(lines.join("\n") + "\n");
    terminate(2);
  } else {
    process.stdout.write(lines.join("\n") + "\n");
  }
}
