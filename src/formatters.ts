import type { Issue, OutputFormat } from "./types.js";
import { formatDiagnostics, type DiagnosticSummary } from "./automation.js";
import { jsonPayload } from "./result.js";

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

/**
 * Identifies the emitting command so `--envelope` can wrap the finding list.
 * Omitted by callers that have no envelope option.
 */
export interface IssueContract {
  command: string;
  envelope?: boolean;
}

function formatJson(issues: Issue[], contract?: IssueContract): string {
  if (!contract) return JSON.stringify(issues, null, 2);
  return jsonPayload(contract.command, issues, contract, {
    exitCode: issues.length ? 2 : 0,
    summary: { findings: issues.length },
  }).trimEnd();
}

export function formatIssues(
  issues: Issue[],
  file: string,
  format: OutputFormat,
  summary: Partial<DiagnosticSummary> = {},
  contract?: IssueContract,
): string {
  const automated = formatDiagnostics(issues, format, {
    files: summary.files ?? (new Set(issues.map((issue) => issue.file)).size || 1),
    findings: summary.findings ?? issues.length,
    ...summary,
  });
  if (automated !== undefined) return automated;
  switch (format) {
    case "json":
      return formatJson(issues, contract);
    case "human":
      return formatHuman(issues, file);
    default:
      return formatLlm(issues, file);
  }
}
