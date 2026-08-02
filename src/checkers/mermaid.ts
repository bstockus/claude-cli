import { JSDOM } from "jsdom";
import type { Issue } from "../types.js";
import { parseMarkdown, extractCodeBlocks, type Root } from "../markdown-ast.js";

// Mermaid requires a DOM environment — set up jsdom globals before importing
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});
globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;

const mermaid = (await import("mermaid")).default;
mermaid.initialize({ startOnLoad: false });

export async function checkMermaid(
  filePath: string,
  content: string,
  issues: Issue[],
  tree?: Root,
): Promise<void> {
  const parsedTree = tree ?? parseMarkdown(content);
  const mermaidBlocks = extractCodeBlocks(parsedTree).filter((b) => b.lang === "mermaid");

  for (const block of mermaidBlocks) {
    // Line of actual content (skip the opening fence)
    const blockStartLine = block.line + 1;

    try {
      await mermaid.parse(block.value);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      issues.push({
        file: filePath,
        line: blockStartLine,
        checker: "mermaid",
        message: `Mermaid syntax error: ${msg.split("\n")[0]}`,
      });
    }
  }
}
