import fs from "node:fs";
import path from "node:path";
import { extractReferences } from "../refs.js";
import type { OutputFormat } from "../types.js";

interface RefsOptions {
  format: string;
  external: boolean;
  anchors: boolean;
  images: boolean;
}

interface ResolvedRef {
  line: number;
  linkText: string;
  target: string;
  isImage: boolean;
  isExternal: boolean;
  isAnchorOnly: boolean;
  exists: boolean | null; // null for external/anchor-only (not checked)
}

function resolveFormat(opts: RefsOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function formatResults(refs: ResolvedRef[], filePath: string, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(refs, null, 2);
  }

  if (refs.length === 0) {
    if (format === "human") {
      return `\x1b[32m✔ No references found in ${filePath}\x1b[0m`;
    }
    return `No references found in ${filePath}`;
  }

  const lines: string[] = [];
  const missing = refs.filter((r) => r.exists === false);

  if (format === "human") {
    lines.push(`\n\x1b[1m${refs.length} reference(s) in ${filePath}\x1b[0m\n`);
    for (const r of refs) {
      const loc = `\x1b[36m${filePath}:${r.line}\x1b[0m`;
      const status =
        r.exists === null
          ? "\x1b[90m—\x1b[0m"
          : r.exists
            ? "\x1b[32m✔\x1b[0m"
            : "\x1b[1;31m✖\x1b[0m";
      const type = r.isImage ? "[image] " : r.isExternal ? "[ext] " : "";
      lines.push(`  ${status} ${loc} ${type}${r.target}`);
    }
    if (missing.length > 0) {
      lines.push(`\n\x1b[1;31m${missing.length} missing reference(s)\x1b[0m`);
    }
  } else {
    lines.push(`${refs.length} reference(s) in ${filePath}:`);
    for (const r of refs) {
      const status = r.exists === null ? " " : r.exists ? " [exists]" : " [MISSING]";
      const type = r.isImage ? " (image)" : r.isExternal ? " (external)" : "";
      lines.push(`  ${filePath}:${r.line}${type} ${r.target}${status}`);
    }
    if (missing.length > 0) {
      lines.push(`${missing.length} missing reference(s)`);
    }
  }

  return lines.join("\n");
}

export async function refsAction(file: string, opts: RefsOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const allRefs = extractReferences(content);
  const dir = path.dirname(filePath);

  // Filter based on flags
  const filtered = allRefs.filter((r) => {
    if (r.isExternal && !opts.external) return false;
    if (r.isAnchorOnly && !opts.anchors) return false;
    if (r.isImage && !opts.images) return false;
    return true;
  });

  // Resolve existence
  const resolved: ResolvedRef[] = filtered.map((r) => {
    if (r.isExternal || r.isAnchorOnly) {
      return { ...r, exists: null };
    }
    const [targetFile] = r.target.split("#", 2);
    const resolvedPath = path.resolve(dir, targetFile);
    return { ...r, exists: fs.existsSync(resolvedPath) };
  });

  const output = formatResults(resolved, filePath, format);
  const missing = resolved.filter((r) => r.exists === false);

  if (missing.length > 0) {
    process.stderr.write(output + "\n");
    process.exit(2);
  } else {
    process.stdout.write(output + "\n");
  }
}
