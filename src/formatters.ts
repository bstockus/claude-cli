import type { Issue, OutputFormat } from "./types.js";
import { formatDiagnostics, type DiagnosticSummary } from "./automation.js";

function formatLlm(issues: Issue[], file: string): string {
  if (issues.length === 0) return "";
  const lines = [`${issues.length} issue(s) in ${file}:`];
  for (const i of issues) {
    lines.push(`  ${i.file}:${i.line} [${i.checker}] ${i.message}`);
  }
  return lines.join("\n");
}

function formatHuman(issues: Issue[], file: string): string {
  if (issues.length === 0) return "";
  const lines = [`\n\x1b[1;31m✖ ${issues.length} issue(s) in ${file}\x1b[0m\n`];
  for (const i of issues) {
    const loc = `\x1b[36m${i.file}:${i.line}\x1b[0m`;
    const rule = `\x1b[33m[${i.checker}]\x1b[0m`;
    lines.push(`  ${loc} ${rule} ${i.message}`);
  }
  return lines.join("\n");
}

function formatJson(issues: Issue[]): string {
  return JSON.stringify(issues, null, 2);
}

export function formatIssues(
  issues: Issue[],
  file: string,
  format: OutputFormat,
  summary: Partial<DiagnosticSummary> = {},
): string {
  const automated = formatDiagnostics(issues, format, {
    files: summary.files ?? (new Set(issues.map((issue) => issue.file)).size || 1),
    findings: summary.findings ?? issues.length,
    ...summary,
  });
  if (automated !== undefined) return automated;
  switch (format) {
    case "json":
      return formatJson(issues);
    case "human":
      return formatHuman(issues, file);
    default:
      return formatLlm(issues, file);
  }
}
