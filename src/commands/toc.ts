import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { requireFile } from "../input.js";

interface TocOptions {
  format: string;
  maxDepth: string;
  minDepth: string;
  ordered: boolean;
}

function resolveFormat(opts: TocOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function tocAction(file: string, opts: TocOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);
  const maxDepth = Math.min(6, Math.max(1, parseInt(opts.maxDepth, 10) || 6));
  const minDepth = Math.min(6, Math.max(1, parseInt(opts.minDepth, 10) || 1));

  const headings = runtime()
    .workspace.document(filePath)
    .headings.filter((heading) => heading.depth >= minDepth && heading.depth <= maxDepth);

  if (format === "json") {
    process.stdout.write(
      JSON.stringify(
        headings.map((h) => ({ text: h.text, slug: h.slug, depth: h.depth, line: h.line })),
        null,
        2,
      ) + "\n",
    );
    return;
  }

  if (headings.length === 0) {
    if (format === "human") {
      process.stdout.write(`\x1b[33mNo headings found in ${shownPath}\x1b[0m\n`);
    } else {
      process.stdout.write(`No headings found in ${shownPath}\n`);
    }
    return;
  }

  // Find the minimum depth present to use as base indentation
  const baseDepth = Math.min(...headings.map((h) => h.depth));
  const lines: string[] = [];

  for (const h of headings) {
    const indent = "  ".repeat(h.depth - baseDepth);
    const bullet = opts.ordered ? "1." : "-";
    lines.push(`${indent}${bullet} [${h.text}](#${h.slug})`);
  }

  process.stdout.write(lines.join("\n") + "\n");
}
