import type { MdHeading } from "./markdown-ast.js";

export const TOC_START = "<!-- claude-cli:toc:start -->";
export const TOC_END = "<!-- claude-cli:toc:end -->";

export function renderToc(headings: MdHeading[], ordered = false): string {
  if (!headings.length) return "";
  const baseDepth = Math.min(...headings.map((heading) => heading.depth));
  return headings
    .map(
      (heading) =>
        `${"  ".repeat(heading.depth - baseDepth)}${ordered ? "1." : "-"} [${heading.text}](#${heading.slug})`,
    )
    .join("\n");
}

export type TocSynchronization =
  | { status: "missing" }
  | { status: "malformed"; message: string }
  | { status: "current"; content: string; block: string }
  | { status: "stale"; content: string; replacement: string; block: string };

export function synchronizeToc(content: string, toc: string): TocSynchronization {
  const starts = [...content.matchAll(new RegExp(TOC_START, "g"))];
  const ends = [...content.matchAll(new RegExp(TOC_END, "g"))];
  if (!starts.length && !ends.length) return { status: "missing" };
  if (starts.length !== 1 || ends.length !== 1)
    return { status: "malformed", message: "Expected exactly one TOC marker pair" };
  const startEnd = starts[0].index! + TOC_START.length;
  const endStart = ends[0].index!;
  if (endStart < startEnd)
    return { status: "malformed", message: "TOC end marker appears before start marker" };
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const normalizedToc = toc.replace(/\r?\n/g, eol);
  const interior = `${eol}${normalizedToc}${normalizedToc ? eol : ""}`;
  const block = `${TOC_START}${interior}${TOC_END}`;
  if (content.slice(startEnd, endStart) === interior) return { status: "current", content, block };
  return {
    status: "stale",
    content,
    replacement: content.slice(0, startEnd) + interior + content.slice(endStart),
    block,
  };
}
