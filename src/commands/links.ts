import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, extractLinks, type MdLink } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";

interface LinksOptions {
  format: string;
  brokenOnly: boolean;
  type?: string;
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

function checkExists(link: MdLink, dir: string): boolean | null {
  if (link.isExternal || link.isAnchorOnly) return null;
  const [targetFile] = link.target.split("#", 2);
  const resolvedPath = path.resolve(dir, targetFile);
  return fs.existsSync(resolvedPath);
}

export async function linksAction(file: string, opts: LinksOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const contentLines = content.split("\n");
  const tree = parseMarkdown(content);
  const dir = path.dirname(filePath);
  let links = extractLinks(tree);

  // Filter by type
  if (opts.type) {
    links = links.filter((l) => classifyLink(l) === opts.type);
  }

  // Check existence and optionally filter to broken only
  const resolved = links.map((l) => ({
    ...l,
    type: classifyLink(l),
    exists: checkExists(l, dir),
    context: contentLines[l.line - 1]?.trim() ?? "",
  }));

  const filtered = opts.brokenOnly ? resolved.filter((r) => r.exists === false) : resolved;

  if (format === "json") {
    process.stdout.write(JSON.stringify(filtered, null, 2) + "\n");
    return;
  }

  if (filtered.length === 0) {
    if (format === "human") {
      const msg = opts.brokenOnly ? "No broken links" : "No links";
      process.stdout.write(`\x1b[32m✔ ${msg} found in ${filePath}\x1b[0m\n`);
    } else {
      const msg = opts.brokenOnly ? "No broken links" : "No links";
      process.stdout.write(`${msg} found in ${filePath}\n`);
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
    lines.push(`\n\x1b[1m${filtered.length} link(s) in ${filePath}\x1b[0m\n`);
  } else {
    lines.push(`${filtered.length} link(s) in ${filePath}:`);
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
    process.exit(2);
  } else {
    process.stdout.write(lines.join("\n") + "\n");
  }
}
