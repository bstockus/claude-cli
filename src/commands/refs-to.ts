import fs from "node:fs";
import path from "node:path";
import { extractReferences } from "../refs.js";
import { findMarkdownFiles } from "../lint.js";
import type { OutputFormat } from "../types.js";

interface RefsToOptions {
  format: string;
}

interface IncomingRef {
  sourceFile: string;
  line: number;
  linkText: string;
  rawTarget: string;
}

function resolveFormat(opts: RefsToOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function formatResults(refs: IncomingRef[], targetFile: string, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(refs, null, 2);
  }

  if (refs.length === 0) {
    if (format === "human") {
      return `\x1b[33mNo references found to ${targetFile}\x1b[0m`;
    }
    return `No references found to ${targetFile}`;
  }

  // Group by source file
  const byFile = new Map<string, IncomingRef[]>();
  for (const r of refs) {
    const existing = byFile.get(r.sourceFile) ?? [];
    existing.push(r);
    byFile.set(r.sourceFile, existing);
  }

  const lines: string[] = [];

  if (format === "human") {
    lines.push(
      `\n\x1b[1m${refs.length} reference(s) to ${targetFile} across ${byFile.size} file(s)\x1b[0m\n`,
    );
    for (const [file, fileRefs] of byFile) {
      lines.push(`  \x1b[36m${file}\x1b[0m`);
      for (const r of fileRefs) {
        lines.push(`    line ${r.line}: \x1b[33m${r.rawTarget}\x1b[0m`);
      }
    }
  } else {
    lines.push(`${refs.length} reference(s) to ${targetFile} across ${byFile.size} file(s):`);
    for (const [file, fileRefs] of byFile) {
      lines.push(`  ${file}`);
      for (const r of fileRefs) {
        lines.push(`    ${file}:${r.line} ${r.rawTarget}`);
      }
    }
  }

  return lines.join("\n");
}

export async function refsToAction(
  file: string,
  directory: string | undefined,
  opts: RefsToOptions,
): Promise<void> {
  const format = resolveFormat(opts);
  const targetPath = path.resolve(file);
  const searchDir = path.resolve(directory ?? ".");

  if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
    process.stderr.write(`Error: Directory not found: ${searchDir}\n`);
    process.exit(1);
  }

  const mdFiles = findMarkdownFiles(searchDir);
  const incomingRefs: IncomingRef[] = [];

  for (const mdFile of mdFiles) {
    const content = fs.readFileSync(mdFile, "utf-8");
    const refs = extractReferences(content);
    const mdDir = path.dirname(mdFile);

    for (const ref of refs) {
      if (ref.isExternal || ref.isAnchorOnly) continue;

      const [targetFile] = ref.target.split("#", 2);
      const resolvedTarget = path.resolve(mdDir, targetFile);

      if (resolvedTarget === targetPath) {
        incomingRefs.push({
          sourceFile: mdFile,
          line: ref.line,
          linkText: ref.linkText,
          rawTarget: ref.target,
        });
      }
    }
  }

  const output = formatResults(incomingRefs, targetPath, format);
  process.stdout.write(output + "\n");
}
