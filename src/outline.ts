import type { MdHeading } from "./markdown-ast.js";

export interface OutlineNode {
  text: string;
  slug: string;
  depth: number;
  line: number;
  children: OutlineNode[];
}

/**
 * Nests a flat heading list by depth.
 *
 * Depth gaps are not normalized: an h3 following an h1 becomes a child of that
 * h1 rather than gaining a synthetic h2. That is `md outline`'s published shape,
 * and `md lint` is what reports the skipped level.
 */
export function buildOutline(headings: readonly MdHeading[]): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const heading of headings) {
    const node: OutlineNode = {
      text: heading.text,
      slug: heading.slug,
      depth: heading.depth,
      line: heading.line,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) {
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
