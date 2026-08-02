import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import GithubSlugger from "github-slugger";
import type {
  Root,
  Heading,
  Link,
  Image,
  LinkReference,
  ImageReference,
  Definition,
  Code,
  Text,
  InlineCode,
  ListItem,
  Table,
  TableRow,
} from "mdast";
import type { Node } from "unist";

export type { Root } from "mdast";

export interface MdLink {
  line: number;
  linkText: string;
  target: string;
  isImage: boolean;
  isExternal: boolean;
  isAnchorOnly: boolean;
  referenceType: "inline" | "full" | "collapsed" | "shortcut";
  definitionIdentifier?: string;
  destinationLine: number;
  destinationStart?: number;
  destinationEnd?: number;
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
  return new GithubSlugger().slug(text);
}

export function extractText(node: Node): string {
  const parts: string[] = [];
  visit(node, (child: Node) => {
    // Inline code is a literal: its content lives in `value`, not in text children.
    // Include it so rendered labels and GitHub heading slugs retain backtick spans.
    if (child.type === "text" || child.type === "inlineCode") {
      parts.push((child as Text | InlineCode).value);
    }
  });
  return parts.join("");
}

function isExternalTarget(target: string): boolean {
  if (/^[a-z]:[\\/]/i.test(target)) return false;
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target);
}

function destinationSpan(
  node: Node,
  target: string,
  source: string | undefined,
  kind: "inline" | "definition",
): { start?: number; end?: number; line: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const line = node.position?.start.line ?? 0;
  if (source === undefined || start === undefined || end === undefined) return { line };

  const raw = source.slice(start, end);
  const searchFrom = kind === "definition" ? raw.indexOf(":") + 1 : raw.lastIndexOf("]") + 1;
  let relative = raw.indexOf(target, Math.max(0, searchFrom));
  if (relative === -1) {
    const escaped = target.replace(/[()]/g, (char) => `\\${char}`);
    relative = raw.indexOf(escaped, Math.max(0, searchFrom));
    if (relative !== -1) {
      return { start: start + relative, end: start + relative + escaped.length, line };
    }
    return { line };
  }
  return { start: start + relative, end: start + relative + target.length, line };
}

function makeLink(
  line: number,
  linkText: string,
  target: string,
  isImage: boolean,
  referenceType: MdLink["referenceType"],
  destination: { start?: number; end?: number; line: number },
  definitionIdentifier?: string,
): MdLink {
  return {
    line,
    linkText,
    target,
    isImage,
    isExternal: isExternalTarget(target),
    isAnchorOnly: target.startsWith("#"),
    referenceType,
    definitionIdentifier,
    destinationLine: destination.line,
    destinationStart: destination.start,
    destinationEnd: destination.end,
  };
}

export function extractLinks(tree: Root, source?: string): MdLink[] {
  const links: MdLink[] = [];

  const definitions = new Map<string, Definition>();
  visit(tree, "definition", (node: Definition) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
  });

  visit(tree, "link", (node: Link) => {
    const line = node.position?.start.line ?? 0;
    const linkText = extractText(node);
    const target = node.url;
    links.push(
      makeLink(
        line,
        linkText,
        target,
        false,
        "inline",
        destinationSpan(node, target, source, "inline"),
      ),
    );
  });

  visit(tree, "image", (node: Image) => {
    const line = node.position?.start.line ?? 0;
    const linkText = node.alt ?? "";
    const target = node.url;
    links.push(
      makeLink(
        line,
        linkText,
        target,
        true,
        "inline",
        destinationSpan(node, target, source, "inline"),
      ),
    );
  });

  const addReference = (node: LinkReference | ImageReference, isImage: boolean): void => {
    const definition = definitions.get(node.identifier);
    if (!definition) return;
    const line = node.position?.start.line ?? 0;
    const linkText = isImage ? ((node as ImageReference).alt ?? "") : extractText(node);
    links.push(
      makeLink(
        line,
        linkText,
        definition.url,
        isImage,
        node.referenceType,
        destinationSpan(definition, definition.url, source, "definition"),
        node.identifier,
      ),
    );
  };

  visit(tree, "linkReference", (node: LinkReference) => {
    addReference(node, false);
  });
  visit(tree, "imageReference", (node: ImageReference) => {
    addReference(node, true);
  });

  // Sort by line number to maintain document order
  links.sort((a, b) => a.line - b.line);

  return links;
}

export function extractHeadings(tree: Root): MdHeading[] {
  const headings: MdHeading[] = [];
  const slugger = new GithubSlugger();

  visit(tree, "heading", (node: Heading) => {
    const line = node.position?.start.line ?? 0;
    const text = extractText(node);
    headings.push({ line, depth: node.depth, text, slug: slugger.slug(text) });
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
