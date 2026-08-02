import type { Issue, OutputFormat } from "./types.js";

export interface DiagnosticSummary {
  files: number;
  findings: number;
  [key: string]: unknown;
}

export function formatJsonl(issues: readonly Issue[], summary: DiagnosticSummary): string {
  return [
    ...issues.map((issue) => JSON.stringify({ type: "finding", ...issue })),
    JSON.stringify({ type: "summary", ...summary }),
  ].join("\n");
}

export function formatSarif(issues: readonly Issue[]): string {
  const ids = [...new Set(issues.map((issue) => issue.checker))].sort();
  return JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "claude-cli",
              informationUri: "https://github.com/bstockus/claude-cli",
              rules: ids.map((id) => ({ id, name: id })),
            },
          },
          results: issues.map((issue) => ({
            ruleId: issue.checker,
            level: "error",
            message: { text: issue.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: issue.file },
                  region: { startLine: Math.max(1, issue.line) },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  );
}

export function formatDiagnostics(
  issues: readonly Issue[],
  format: OutputFormat,
  summary: DiagnosticSummary,
): string | undefined {
  if (format === "jsonl") return formatJsonl(issues, summary);
  if (format === "sarif") return formatSarif(issues);
  return undefined;
}
