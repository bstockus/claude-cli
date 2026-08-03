import { buildOutline, type OutlineNode } from "../outline.js";
import { outputPath, runtime } from "../runtime.js";
import { requireFile } from "../input.js";
import { jsonPayload } from "../result.js";

interface OutlineOptions {
  envelope?: boolean;
  format: string;
  maxDepth: string;
}

function resolveFormat(opts: OutlineOptions): "llm" | "human" | "json" {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function renderOutlineText(
  nodes: OutlineNode[],
  indent: number,
  format: "llm" | "human",
): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const padding = "  ".repeat(indent);
    if (format === "human") {
      lines.push(`${padding}\x1b[33m${node.text}\x1b[0m`);
    } else {
      lines.push(`${padding}${node.text}`);
    }
    lines.push(...renderOutlineText(node.children, indent + 1, format));
  }
  return lines;
}

export async function outlineAction(file: string, opts: OutlineOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);
  const maxDepth = Math.min(6, Math.max(1, parseInt(opts.maxDepth, 10) || 6));

  const headings = runtime()
    .workspace.document(filePath)
    .headings.filter((heading) => heading.depth <= maxDepth);

  if (headings.length === 0) {
    if (format === "human") {
      process.stdout.write(`\x1b[33mNo headings found in ${shownPath}\x1b[0m\n`);
    } else if (format === "json") {
      process.stdout.write("[]\n");
    } else {
      process.stdout.write(`No headings found in ${shownPath}\n`);
    }
    return;
  }

  if (format === "json") {
    const outlineTree = buildOutline(headings);
    process.stdout.write(jsonPayload("md outline", outlineTree, opts));
    return;
  }

  const outlineTree = buildOutline(headings);
  const lines = renderOutlineText(outlineTree, 0, format);
  process.stdout.write(lines.join("\n") + "\n");
}
