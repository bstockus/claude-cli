import { visit } from "unist-util-visit";
import type { Heading, Code, List } from "mdast";
import { extractText, type Root } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { requireFile } from "../input.js";

interface StructureOptions {
  format: string;
}

interface StructureEntry {
  type: "heading" | "code" | "list" | "math";
  line: number;
  endLine: number;
  detail: string;
}

function resolveFormat(opts: StructureOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function collectStructure(tree: Root, content: string): StructureEntry[] {
  const entries: StructureEntry[] = [];

  visit(tree, "heading", (node: Heading) => {
    const line = node.position?.start.line ?? 0;
    const text = extractText(node);
    entries.push({
      type: "heading",
      line,
      endLine: line,
      detail: `${"#".repeat(node.depth)} ${text}`,
    });
  });

  visit(tree, "code", (node: Code) => {
    const line = node.position?.start.line ?? 0;
    const endLine = node.position?.end.line ?? 0;
    const lang = node.lang ?? "(none)";
    const lineCount = endLine - line + 1;
    entries.push({
      type: "code",
      line,
      endLine,
      detail: `\`\`\`${lang} (${lineCount} lines)`,
    });
  });

  visit(tree, "list", (node: List) => {
    const line = node.position?.start.line ?? 0;
    const endLine = node.position?.end.line ?? 0;
    const kind = node.ordered ? "ordered" : "unordered";
    const itemCount = node.children.length;
    entries.push({
      type: "list",
      line,
      endLine,
      detail: `${kind} list (${itemCount} items)`,
    });
  });

  // Detect math blocks from raw content (not in AST without remark-math)
  const lines = content.split("\n");
  let inDisplayMath = false;
  let mathStart = 0;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l.trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (inDisplayMath) {
      if (l.includes("$$")) {
        entries.push({
          type: "math",
          line: mathStart + 1,
          endLine: i + 1,
          detail: "$$ display math",
        });
        inDisplayMath = false;
      }
    } else if (l.includes("$$")) {
      const afterStart = l.substring(l.indexOf("$$") + 2);
      if (afterStart.includes("$$")) {
        entries.push({
          type: "math",
          line: i + 1,
          endLine: i + 1,
          detail: "$$ inline display math",
        });
      } else {
        inDisplayMath = true;
        mathStart = i;
      }
    }
  }

  entries.sort((a, b) => a.line - b.line);
  return entries;
}

export async function structureAction(file: string, opts: StructureOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);

  const { content, tree } = runtime().workspace.document(filePath);
  const entries = collectStructure(tree, content);

  if (format === "json") {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return;
  }

  if (entries.length === 0) {
    if (format === "human") {
      process.stdout.write(`\x1b[33mNo structure found in ${shownPath}\x1b[0m\n`);
    } else {
      process.stdout.write(`No structure found in ${shownPath}\n`);
    }
    return;
  }

  const lines: string[] = [];
  const isHuman = format === "human";

  for (const e of entries) {
    const loc = e.line === e.endLine ? `L${e.line}` : `L${e.line}-${e.endLine}`;
    if (isHuman) {
      const typeColor =
        e.type === "heading"
          ? "\x1b[33m"
          : e.type === "code"
            ? "\x1b[32m"
            : e.type === "math"
              ? "\x1b[35m"
              : "\x1b[34m";
      lines.push(`\x1b[36m${loc.padEnd(12)}\x1b[0m ${typeColor}${e.detail}\x1b[0m`);
    } else {
      lines.push(`${loc.padEnd(12)} ${e.detail}`);
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}
