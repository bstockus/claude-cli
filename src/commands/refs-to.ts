import path from "node:path";
import { findMarkdownFiles } from "../lint.js";
import type { OutputFormat } from "../types.js";
import { documentsReferencing } from "../backlinks.js";
import { outputPath } from "../runtime.js";
import { requireDirectory } from "../input.js";
import { jsonPayload } from "../result.js";

interface RefsToOptions {
  envelope?: boolean;
  format: string;
  include: string[];
  exclude: string[];
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

function formatResults(
  refs: IncomingRef[],
  targetFile: string,
  format: OutputFormat,
  opts: RefsToOptions,
): string {
  if (format === "json") {
    return jsonPayload("md refs-to", refs, opts).trimEnd();
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
  const searchDir = requireDirectory(directory ?? ".", opts);

  const mdFiles = findMarkdownFiles(searchDir, { include: opts.include, exclude: opts.exclude });
  const shownRefs: IncomingRef[] = documentsReferencing(mdFiles, targetPath).map((ref) => ({
    sourceFile: outputPath(ref.sourceFile, opts),
    line: ref.line,
    linkText: ref.linkText,
    rawTarget: ref.rawTarget,
  }));
  const output = formatResults(shownRefs, outputPath(targetPath, opts), format, opts);
  process.stdout.write(output + "\n");
}
