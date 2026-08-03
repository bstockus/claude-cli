import type { Issue, OutputFormat } from "./types.js";
import { sarifDocument } from "./sarif.js";

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

/**
 * SARIF for `md` diagnostics.
 *
 * `level` is `"error"` for every finding. That is the current published
 * contract for these commands, not an oversight — `Issue` carries no severity,
 * so changing it would be a breaking change for consumers gating on it.
 */
export function formatSarif(issues: readonly Issue[]): string {
  const ids = [...new Set(issues.map((issue) => issue.checker))].sort();
  return sarifDocument(
    ids.map((id) => ({ id, name: id })),
    issues.map((issue) => ({
      ruleId: issue.checker,
      level: "error" as const,
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
