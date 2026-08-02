import { describe, expect, it } from "vitest";
import path from "node:path";
import { replaceFragment, resolveLocalPath, splitLocalTarget } from "../../src/link-target.js";

describe("local link targets", () => {
  it("separates and decodes path, query, and fragment", () => {
    expect(splitLocalTarget("other%20file.md?raw=1#%C3%BCber-caf%C3%A9")).toEqual({
      rawPath: "other%20file.md",
      path: "other file.md",
      query: "?raw=1",
      rawFragment: "%C3%BCber-caf%C3%A9",
      fragment: "über-café",
    });
  });

  it("resolves site-root paths from the workspace root", () => {
    expect(resolveLocalPath("/workspace/docs/source.md", "/guide.md", "/workspace")).toBe(
      path.resolve("/workspace/guide.md"),
    );
  });

  it("preserves encoded fragment style when replacing", () => {
    expect(replaceFragment("guide.md#old", "über")).toBe("guide.md#über");
    expect(replaceFragment("guide.md#old%20slug", "über")).toBe("guide.md#%C3%BCber");
  });
});
