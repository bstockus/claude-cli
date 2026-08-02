import { describe, it, expect } from "vitest";
import { formatIssues } from "../../src/formatters.js";
import type { Issue } from "../../src/types.js";

const sampleIssues: Issue[] = [
  { file: "/tmp/test.md", line: 5, checker: "katex", message: "Invalid math" },
  {
    file: "/tmp/test.md",
    line: 10,
    checker: "ref/link",
    message: "Link not found: ./missing.md",
  },
];

describe("formatIssues", () => {
  describe("llm format", () => {
    it("returns empty string for no issues", () => {
      expect(formatIssues([], "/tmp/test.md", "llm")).toBe("");
    });

    it("formats issues with file:line [checker] message pattern", () => {
      const result = formatIssues(sampleIssues, "/tmp/test.md", "llm");
      expect(result).toContain("2 issue(s) in /tmp/test.md:");
      expect(result).toContain("/tmp/test.md:5 [katex] Invalid math");
      expect(result).toContain("/tmp/test.md:10 [ref/link] Link not found: ./missing.md");
    });
  });

  describe("human format", () => {
    it("returns empty string for no issues", () => {
      expect(formatIssues([], "/tmp/test.md", "human")).toBe("");
    });

    it("contains ANSI escape codes", () => {
      const result = formatIssues(sampleIssues, "/tmp/test.md", "human");
      expect(result).toContain("\x1b[");
    });

    it("contains issue count", () => {
      const result = formatIssues(sampleIssues, "/tmp/test.md", "human");
      expect(result).toContain("2 issue(s)");
    });
  });

  describe("json format", () => {
    it("returns empty array for no issues", () => {
      const result = formatIssues([], "/tmp/test.md", "json");
      expect(JSON.parse(result)).toEqual([]);
    });

    it("returns valid parseable JSON with correct structure", () => {
      const result = formatIssues(sampleIssues, "/tmp/test.md", "json");
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        file: "/tmp/test.md",
        line: 5,
        checker: "katex",
        message: "Invalid math",
      });
    });
  });
});
