import { describe, it, expect } from "vitest";
import { extractReferences } from "../../src/refs.js";

describe("extractReferences", () => {
  it("extracts a simple link", () => {
    const refs = extractReferences("See [docs](./README.md) here.");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      line: 1,
      linkText: "docs",
      target: "./README.md",
      isImage: false,
      isExternal: false,
      isAnchorOnly: false,
    });
  });

  it("extracts image references", () => {
    const refs = extractReferences("An ![alt text](image.png) here.");
    expect(refs).toHaveLength(1);
    expect(refs[0].isImage).toBe(true);
    expect(refs[0].target).toBe("image.png");
  });

  it("identifies external URLs", () => {
    const refs = extractReferences("[site](https://example.com)");
    expect(refs).toHaveLength(1);
    expect(refs[0].isExternal).toBe(true);
  });

  it("identifies anchor-only links", () => {
    const refs = extractReferences("[section](#my-heading)");
    expect(refs).toHaveLength(1);
    expect(refs[0].isAnchorOnly).toBe(true);
    expect(refs[0].target).toBe("#my-heading");
  });

  it("skips code blocks", () => {
    const content = ["```", "[not a link](fake.md)", "```", "[real link](real.md)"].join("\n");
    const refs = extractReferences(content);
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe("real.md");
  });

  it("extracts multiple references from one line", () => {
    const refs = extractReferences("See [a](a.md) and [b](b.md) here.");
    expect(refs).toHaveLength(2);
    expect(refs[0].target).toBe("a.md");
    expect(refs[1].target).toBe("b.md");
  });

  it("handles file with anchor", () => {
    const refs = extractReferences("[sec](other.md#heading)");
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe("other.md#heading");
    expect(refs[0].isAnchorOnly).toBe(false);
    expect(refs[0].isExternal).toBe(false);
  });

  it("returns empty array for content with no links", () => {
    const refs = extractReferences("Just plain text.\n\nNo links here.");
    expect(refs).toHaveLength(0);
  });

  it("handles mailto links as external", () => {
    const refs = extractReferences("[email](mailto:test@example.com)");
    expect(refs).toHaveLength(1);
    expect(refs[0].isExternal).toBe(true);
  });
});
