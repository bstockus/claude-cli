import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, extractHeadings, type MdHeading } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";

interface OutlineOptions {
  format: string;
  maxDepth: string;
}

interface OutlineNode {
  text: string;
  slug: string;
  depth: number;
  line: number;
  children: OutlineNode[];
}

function resolveFormat(opts: OutlineOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function buildTree(headings: MdHeading[]): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const h of headings) {
    const node: OutlineNode = {
      text: h.text,
      slug: h.slug,
      depth: h.depth,
      line: h.line,
      children: [],
    };

    // Pop stack until we find a parent with lower depth
    while (stack.length > 0 && stack[stack.length - 1].depth >= h.depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return root;
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
  const filePath = path.resolve(file);
  const maxDepth = Math.min(6, Math.max(1, parseInt(opts.maxDepth, 10) || 6));

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const tree = parseMarkdown(content);
  const headings = extractHeadings(tree).filter((h) => h.depth <= maxDepth);

  if (headings.length === 0) {
    if (format === "human") {
      process.stdout.write(`\x1b[33mNo headings found in ${filePath}\x1b[0m\n`);
    } else if (format === "json") {
      process.stdout.write("[]\n");
    } else {
      process.stdout.write(`No headings found in ${filePath}\n`);
    }
    return;
  }

  if (format === "json") {
    const outlineTree = buildTree(headings);
    process.stdout.write(JSON.stringify(outlineTree, null, 2) + "\n");
    return;
  }

  const outlineTree = buildTree(headings);
  const lines = renderOutlineText(outlineTree, 0, format);
  process.stdout.write(lines.join("\n") + "\n");
}
