import { slugify, type MdHeading } from "./markdown-ast.js";
import type { MarkdownDocument } from "./workspace.js";

export interface DocumentSection {
  file: string;
  /** Null for the content preceding the first heading. */
  heading: MdHeading | null;
  /** Heading depth; 0 for the preamble. */
  depth: number;
  /** 1-indexed, inclusive. */
  startLine: number;
  /** 1-indexed, inclusive. Less than `startLine` for an empty section. */
  endLine: number;
  content: string;
}

/**
 * Line number of a document's closing frontmatter fence, or 0 when there is none.
 *
 * `Workspace.document` parses with `parseMarkdown`, which has no frontmatter
 * extension, so a short frontmatter block whose body is one paragraph-shaped run
 * becomes a setext heading: `---\ntitle: X\n---` yields a phantom depth-2
 * heading. Callers that reason about document structure filter on this rather
 * than inheriting the phantom.
 */
export function frontmatterEndLine(content: string): number {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return 0;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!match) return 0;
  return match[0].replace(/\r?\n$/, "").split(/\r?\n/).length;
}

/**
 * The flat partition of a document: every heading owns the lines up to the next
 * heading of any depth, and the preamble owns whatever precedes the first one.
 *
 * Non-overlapping and exhaustive, which is what makes byte accounting over the
 * result exact. Nested sections are deliberately absent — a `--children` view
 * would double-count every ancestor's bytes.
 */
export function documentSections(document: MarkdownDocument): DocumentSection[] {
  const lines = document.content.split("\n");
  const frontmatterEnd = frontmatterEndLine(document.content);
  const headings = document.headings.filter((heading) => heading.line > frontmatterEnd);
  const slice = (start: number, end: number): string =>
    end >= start ? lines.slice(start - 1, end).join("\n") : "";
  const sections: DocumentSection[] = [];

  const preambleStart = frontmatterEnd + 1;
  const preambleEnd = (headings.length ? headings[0].line : lines.length + 1) - 1;
  if (preambleEnd >= preambleStart) {
    sections.push({
      file: document.path,
      heading: null,
      depth: 0,
      startLine: preambleStart,
      endLine: preambleEnd,
      content: slice(preambleStart, preambleEnd),
    });
  }

  for (let index = 0; index < headings.length; index++) {
    const startLine = headings[index].line;
    const endLine = index + 1 < headings.length ? headings[index + 1].line - 1 : lines.length;
    sections.push({
      file: document.path,
      heading: headings[index],
      depth: headings[index].depth,
      startLine,
      endLine,
      content: slice(startLine, endLine),
    });
  }
  return sections;
}

/** The shared heading lookup rule: case-insensitive text, or slug. */
function matches(heading: MdHeading, query: string): boolean {
  return heading.text.toLowerCase() === query.toLowerCase() || heading.slug === slugify(query);
}

/** A section located by name, which therefore always has a heading. */
export interface MatchedSection extends DocumentSection {
  heading: MdHeading;
}

/** Position in `sections` of the section named by `heading`, or -1. */
export function matchSectionIndex(sections: readonly DocumentSection[], heading: string): number {
  return sections.findIndex(
    (section) => section.heading !== null && matches(section.heading, heading),
  );
}

export interface FindSectionOptions {
  /** Extend the section through headings deeper than the match. Defaults to true. */
  children?: boolean;
  /** Include the heading line itself. Defaults to true. */
  includeHeading?: boolean;
}

/**
 * Locates one section by heading text or slug.
 *
 * Reproduces `md section`'s rule exactly, including its use of the unfiltered
 * heading list — that command predates `frontmatterEndLine` and its output is
 * published.
 */
export function findSection(
  document: MarkdownDocument,
  heading: string,
  options: FindSectionOptions = {},
): MatchedSection | undefined {
  const children = options.children ?? true;
  const includeHeading = options.includeHeading ?? true;
  const headings = document.headings;
  const matchIndex = headings.findIndex((candidate) => matches(candidate, heading));
  if (matchIndex === -1) return undefined;

  const matched = headings[matchIndex];
  const lines = document.content.split("\n");
  let endLine = lines.length;
  for (let index = matchIndex + 1; index < headings.length; index++) {
    if (!children || headings[index].depth <= matched.depth) {
      endLine = headings[index].line - 1;
      break;
    }
  }
  const startLine = includeHeading ? matched.line : matched.line + 1;
  return {
    file: document.path,
    heading: matched,
    depth: matched.depth,
    startLine,
    endLine,
    content: endLine >= startLine ? lines.slice(startLine - 1, endLine).join("\n") : "",
  };
}
