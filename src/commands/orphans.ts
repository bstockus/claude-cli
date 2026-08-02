import fs from "node:fs";
import path from "node:path";
import { findMarkdownFiles } from "../lint.js";
import { extractReferences } from "../refs.js";
import type { OutputFormat } from "../types.js";

interface OrphansOptions {
  format: string;
  ignore: string[];
  entry: string[];
}

function resolveFormat(opts: OrphansOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export async function orphansAction(directory: string, opts: OrphansOptions): Promise<void> {
  const format = resolveFormat(opts);
  const dirPath = path.resolve(directory);

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    process.stderr.write(`Error: Directory not found: ${dirPath}\n`);
    process.exit(1);
  }

  let files = findMarkdownFiles(dirPath);

  // Apply ignore patterns
  if (opts.ignore.length > 0) {
    const patterns = opts.ignore.map(globToRegex);
    files = files.filter((f) => {
      const rel = path.relative(dirPath, f);
      return !patterns.some((p) => p.test(rel));
    });
  }

  // Build set of all referenced files
  const referencedFiles = new Set<string>();
  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const refs = extractReferences(content);
    const dir = path.dirname(file);
    for (const ref of refs) {
      if (ref.isExternal || ref.isAnchorOnly) continue;
      const [targetFile] = ref.target.split("#", 2);
      if (targetFile) {
        const resolved = path.resolve(dir, targetFile);
        referencedFiles.add(resolved);
      }
    }
  }

  // Resolve entry files
  const entryFiles = new Set(opts.entry.map((e) => path.resolve(dirPath, e)));

  // Find orphans
  const orphans = files.filter((f) => !referencedFiles.has(f) && !entryFiles.has(f));

  if (format === "json") {
    const json =
      JSON.stringify(
        {
          directory: dirPath,
          totalFiles: files.length,
          orphans,
        },
        null,
        2,
      ) + "\n";
    if (orphans.length > 0) {
      process.stderr.write(json);
      process.exit(2);
    }
    process.stdout.write(json);
    return;
  }

  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);

  if (orphans.length === 0) {
    if (isHuman) {
      process.stdout.write(
        `\x1b[32m✔ No orphans found in ${dirPath} (${files.length} files scanned)\x1b[0m\n`,
      );
    } else {
      process.stdout.write(`No orphans found in ${dirPath} (${files.length} files scanned)\n`);
    }
    return;
  }

  const lines: string[] = [];
  lines.push(
    bold(`${orphans.length} orphan(s) found in ${dirPath} (${files.length} files scanned):`),
  );
  for (const o of orphans) {
    lines.push(`  ${o}`);
  }

  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}
