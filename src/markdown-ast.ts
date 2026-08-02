import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import type { Root, Heading, Link, Image, Code, Text, ListItem, Table, TableRow } from "mdast";
import type { Node } from "unist";

export type { Root } from "mdast";

export interface MdLink {
  line: number;
  linkText: string;
  target: string;
  isImage: boolean;
  isExternal: boolean;
  isAnchorOnly: boolean;
}

export interface MdHeading {
  line: number;
  depth: number;
  text: string;
  slug: string;
}

export interface MdCodeBlock {
  line: number;
  endLine: number;
  lang: string | null;
  value: string;
}

const parser = unified().use(remarkParse).use(remarkGfm);
const parserWithFrontmatter = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"]);

export function parseMarkdown(content: string): Root {
  return parser.parse(content);
}

export function parseMarkdownWithFrontmatter(content: string): Root {
  return parserWithFrontmatter.parse(content);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function extractText(node: Node): string {
  const parts: string[] = [];
  visit(node, "text", (textNode: Text) => {
    parts.push(textNode.value);
  });
  return parts.join("");
}

export function extractLinks(tree: Root): MdLink[] {
  const links: MdLink[] = [];

  visit(tree, "link", (node: Link) => {
    const line = node.position?.start.line ?? 0;
    const linkText = extractText(node);
    const target = node.url;
    const isExternal = /^(https?:|mailto:|ftp:)/.test(target);
    const isAnchorOnly = target.startsWith("#");

    links.push({ line, linkText, target, isImage: false, isExternal, isAnchorOnly });
  });

  visit(tree, "image", (node: Image) => {
    const line = node.position?.start.line ?? 0;
    const linkText = node.alt ?? "";
    const target = node.url;
    const isExternal = /^(https?:|mailto:|ftp:)/.test(target);
    const isAnchorOnly = target.startsWith("#");

    links.push({ line, linkText, target, isImage: true, isExternal, isAnchorOnly });
  });

  // Sort by line number to maintain document order
  links.sort((a, b) => a.line - b.line);

  return links;
}

export function extractHeadings(tree: Root): MdHeading[] {
  const headings: MdHeading[] = [];

  visit(tree, "heading", (node: Heading) => {
    const line = node.position?.start.line ?? 0;
    const text = extractText(node);
    headings.push({ line, depth: node.depth, text, slug: slugify(text) });
  });

  return headings;
}

export function extractCodeBlocks(tree: Root): MdCodeBlock[] {
  const blocks: MdCodeBlock[] = [];

  visit(tree, "code", (node: Code) => {
    const line = node.position?.start.line ?? 0;
    const endLine = node.position?.end.line ?? 0;
    blocks.push({ line, endLine, lang: node.lang ?? null, value: node.value });
  });

  return blocks;
}

export function isLineInCodeBlock(line: number, codeBlocks: MdCodeBlock[]): boolean {
  return codeBlocks.some((b) => line >= b.line && line <= b.endLine);
}

export interface MdTask {
  line: number;
  checked: boolean;
  text: string;
}

export function extractTasks(tree: Root): MdTask[] {
  const tasks: MdTask[] = [];
  visit(tree, "listItem", (node: ListItem) => {
    if (node.checked === null || node.checked === undefined) return;
    const line = node.position?.start.line ?? 0;
    const text = extractText(node);
    tasks.push({ line, checked: node.checked, text });
  });
  return tasks;
}

export interface MdTable {
  line: number;
  endLine: number;
  columns: number;
  rows: number;
  align: (string | null)[];
  headers: string[];
  data: string[][];
}

export function extractTables(tree: Root): MdTable[] {
  const tables: MdTable[] = [];
  visit(tree, "table", (node: Table) => {
    const line = node.position?.start.line ?? 0;
    const endLine = node.position?.end.line ?? 0;
    const align = node.align ?? [];
    const headerRow = node.children[0] as TableRow | undefined;
    const headers = headerRow?.children.map((cell) => extractText(cell)) ?? [];
    const dataRows = node.children.slice(1) as TableRow[];
    const data = dataRows.map((row) => row.children.map((cell) => extractText(cell)));
    tables.push({
      line,
      endLine,
      columns: headers.length,
      rows: dataRows.length,
      align,
      headers,
      data,
    });
  });
  return tables;
}
