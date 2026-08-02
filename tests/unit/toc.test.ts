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
