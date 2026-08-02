import { describe, expect, it } from "vitest";
import { formatJsonl, formatSarif } from "../../src/automation.js";

const issue = { file: "docs/a.md", line: 3, checker: "ref/link", message: "missing" };

describe("automation formats", () => {
  it("ends JSONL findings with a summary record", () => {
    const records = formatJsonl([issue], { files: 1, findings: 1 })
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toEqual([
      { type: "finding", ...issue },
      { type: "summary", files: 1, findings: 1 },
    ]);
  });

  it("emits SARIF 2.1.0 locations", () => {
    const sarif = JSON.parse(formatSarif([issue])) as {
      version: string;
      runs: Array<{
        results: Array<{
          ruleId: string;
          locations: Array<{ physicalLocation: { region: { startLine: number } } }>;
        }>;
      }>;
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results[0].ruleId).toBe("ref/link");
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(3);
  });
});
