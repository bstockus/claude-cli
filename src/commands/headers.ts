import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { requireFile } from "../input.js";
import { jsonPayload } from "../result.js";

interface HeadersOptions {
  envelope?: boolean;
  format: string;
  maxDepth: string;
}

function resolveFormat(opts: HeadersOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function headersAction(file: string, opts: HeadersOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);
  const maxDepth = Math.min(6, Math.max(1, parseInt(opts.maxDepth, 10) || 6));

  const headings = runtime()
    .workspace.document(filePath)
    .headings.filter((heading) => heading.depth <= maxDepth);

  if (format === "json") {
    process.stdout.write(jsonPayload("md headers", headings, opts));
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

  const lines: string[] = [];

  if (format === "human") {
    lines.push(`\n\x1b[1m${headings.length} heading(s) in ${shownPath}\x1b[0m\n`);
    for (const h of headings) {
      const prefix = "#".repeat(h.depth);
      lines.push(`  \x1b[36mL${h.line}\x1b[0m  \x1b[33m${prefix}\x1b[0m ${h.text}`);
    }
  } else {
    lines.push(`${headings.length} heading(s) in ${shownPath}:`);
    for (const h of headings) {
      const prefix = "#".repeat(h.depth);
      lines.push(`  L${h.line}  ${prefix} ${h.text}`);
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}
