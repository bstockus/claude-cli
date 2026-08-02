import fs from "node:fs";
import path from "node:path";
import { visit } from "unist-util-visit";
import type { Text, List } from "mdast";
import {
  parseMarkdown,
  extractHeadings,
  extractLinks,
  extractCodeBlocks,
  type Root,
} from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";

interface StatsOptions {
  format: string;
}

interface DocStats {
  file: string;
  wordCount: number;
  headings: { total: number; byDepth: Record<number, number> };
  links: { total: number; internal: number; external: number; images: number };
  codeBlocks: { total: number; byLang: Record<string, number> };
  paragraphs: number;
  lists: { total: number; ordered: number; unordered: number };
}

function resolveFormat(opts: StatsOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function countWords(tree: Root): number {
  let count = 0;
  // Count words only in text nodes that are NOT inside code blocks
  // (mdast code nodes contain their content in .value, not as text children)
  visit(tree, "text", (node: Text) => {
    const words = node.value
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    count += words.length;
  });
  return count;
}

function countParagraphs(tree: Root): number {
  let count = 0;
  visit(tree, "paragraph", () => {
    count++;
  });
  return count;
}

function countLists(tree: Root): { total: number; ordered: number; unordered: number } {
  let ordered = 0;
  let unordered = 0;
  visit(tree, "list", (node: List) => {
    if (node.ordered) {
      ordered++;
    } else {
      unordered++;
    }
  });
  return { total: ordered + unordered, ordered, unordered };
}

export async function statsAction(file: string, opts: StatsOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const tree = parseMarkdown(content);

  const headings = extractHeadings(tree);
  const links = extractLinks(tree);
  const codeBlocks = extractCodeBlocks(tree);

  const byDepth: Record<number, number> = {};
  for (const h of headings) {
    byDepth[h.depth] = (byDepth[h.depth] ?? 0) + 1;
  }

  const byLang: Record<string, number> = {};
  for (const b of codeBlocks) {
    const lang = b.lang ?? "(none)";
    byLang[lang] = (byLang[lang] ?? 0) + 1;
  }

  const internalLinks = links.filter((l) => !l.isExternal && !l.isImage);
  const externalLinks = links.filter((l) => l.isExternal);
  const images = links.filter((l) => l.isImage);

  const stats: DocStats = {
    file: filePath,
    wordCount: countWords(tree),
    headings: { total: headings.length, byDepth },
    links: {
      total: links.length,
      internal: internalLinks.length,
      external: externalLinks.length,
      images: images.length,
    },
    codeBlocks: { total: codeBlocks.length, byLang },
    paragraphs: countParagraphs(tree),
    lists: countLists(tree),
  };

  if (format === "json") {
    process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
    return;
  }

  const lines: string[] = [];
  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);
  const cyan = (s: string) => (isHuman ? `\x1b[36m${s}\x1b[0m` : s);

  lines.push(bold(`Statistics for ${filePath}`));
  lines.push("");
  lines.push(`  ${cyan("Words:")} ${stats.wordCount}`);
  lines.push(`  ${cyan("Paragraphs:")} ${stats.paragraphs}`);
  lines.push(`  ${cyan("Headings:")} ${stats.headings.total}`);
  for (const [depth, count] of Object.entries(stats.headings.byDepth).sort()) {
    lines.push(`    ${"#".repeat(Number(depth))}: ${count}`);
  }
  lines.push(`  ${cyan("Links:")} ${stats.links.total}`);
  lines.push(`    Internal: ${stats.links.internal}`);
  lines.push(`    External: ${stats.links.external}`);
  lines.push(`    Images: ${stats.links.images}`);
  lines.push(`  ${cyan("Code blocks:")} ${stats.codeBlocks.total}`);
  for (const [lang, count] of Object.entries(stats.codeBlocks.byLang).sort()) {
    lines.push(`    ${lang}: ${count}`);
  }
  lines.push(`  ${cyan("Lists:")} ${stats.lists.total}`);
  lines.push(`    Ordered: ${stats.lists.ordered}`);
  lines.push(`    Unordered: ${stats.lists.unordered}`);

  process.stdout.write(lines.join("\n") + "\n");
}
