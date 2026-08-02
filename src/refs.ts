import { parseMarkdown, extractLinks, type Root } from "./markdown-ast.js";

export interface Reference {
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

/**
 * Extract all markdown references (links and images) from content,
 * skipping code blocks.
 */
export function extractReferences(input: string | Root): Reference[] {
  const tree = typeof input === "string" ? parseMarkdown(input) : input;
  return extractLinks(tree, typeof input === "string" ? input : undefined);
}
