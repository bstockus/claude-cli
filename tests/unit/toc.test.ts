import { describe, expect, it } from "vitest";
import { renderToc, synchronizeToc, TOC_END, TOC_START } from "../../src/toc.js";

describe("TOC synchronization", () => {
  const toc = renderToc([{ text: "Title", slug: "title", depth: 1, line: 1 }]);

  it("detects missing, stale, current, duplicate, and reversed markers", () => {
    expect(synchronizeToc("# Title\n", toc).status).toBe("missing");
    const stale = synchronizeToc(`${TOC_START}\nold\n${TOC_END}\n`, toc);
    expect(stale.status).toBe("stale");
    if (stale.status === "stale")
      expect(synchronizeToc(stale.replacement, toc).status).toBe("current");
    expect(synchronizeToc(`${TOC_START}${TOC_START}${TOC_END}`, toc).status).toBe("malformed");
    expect(synchronizeToc(`${TOC_END}${TOC_START}`, toc).status).toBe("malformed");
  });

  it("ignores markers inside a fenced code block", () => {
    // A fence documenting the syntax — as this project's own README does — must
    // not read as a real pair, or a table of contents would be written into a
    // code sample.
    const documented = `# Title\n\nSyntax:\n\n\`\`\`markdown\n${TOC_START}\n${TOC_END}\n\`\`\`\n`;
    expect(synchronizeToc(documented, toc).status).toBe("missing");

    // A real pair alongside a documented one still synchronizes.
    const both = `${documented}\n${TOC_START}\nold\n${TOC_END}\n`;
    const result = synchronizeToc(both, toc);
    expect(result.status).toBe("stale");
    if (result.status === "stale") {
      // Only the real block changed; the code sample is untouched.
      expect(result.replacement).toContain(`\`\`\`markdown\n${TOC_START}\n${TOC_END}\n\`\`\``);
      expect(result.replacement).toContain(`${TOC_START}\n- [Title](#title)\n${TOC_END}`);
    }
  });

  it("parses for itself when no code blocks are supplied", () => {
    // The parameter exists only to avoid a second parse, so omitting it must
    // not silently skip the check.
    const documented = `# Title\n\n\`\`\`markdown\n${TOC_START}\n${TOC_END}\n\`\`\`\n`;
    expect(synchronizeToc(documented, toc).status).toBe("missing");
    // Claiming there are no code blocks is the only way to see the old
    // behavior, where the fenced pair counts as a real one.
    expect(synchronizeToc(documented, toc, []).status).toBe("stale");
  });

  it("preserves CRLF and changes only marker contents", () => {
    const result = synchronizeToc(`before\r\n${TOC_START}\r\nold\r\n${TOC_END}\r\nafter\r\n`, toc);
    expect(result.status).toBe("stale");
    if (result.status === "stale") {
      expect(result.replacement).toContain(`${TOC_START}\r\n- [Title](#title)\r\n${TOC_END}`);
      expect(result.replacement).toMatch(/^before\r\n/);
      expect(result.replacement).toMatch(/after\r\n$/);
    }
  });
});
