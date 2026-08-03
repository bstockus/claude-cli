import type { QueryPlan } from "./plan.js";
import type { QueryResult } from "./execute.js";

const MAX_WIDTH = 60;

function cell(value: unknown): string {
  if (value === undefined || value === null) return "(none)";
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  // Task text and code-block bodies can span lines; a table row must not.
  const flat = text.replace(/[\t\r\n]+/g, " ");
  return flat.length > MAX_WIDTH ? `${flat.slice(0, MAX_WIDTH - 1)}…` : flat;
}

function table(fields: string[], rows: Record<string, unknown>[], indent: string): string[] {
  const widths = fields.map((field) =>
    Math.max(field.length, ...rows.map((row) => cell(row[field]).length), 0),
  );
  const line = (values: string[]): string =>
    indent +
    values
      .map((value, index) => value.padEnd(widths[index]))
      .join("  ")
      .trimEnd();
  return [line(fields), ...rows.map((row) => line(fields.map((field) => cell(row[field]))))];
}

export function renderQueryText(
  result: QueryResult,
  plan: QueryPlan,
  directory: string,
  human: boolean,
): string {
  const bold = (value: string) => (human ? `\x1b[1m${value}\x1b[0m` : value);
  const summary = plan.predicates.length
    ? `${result.matched} ${plan.entity} matching: ${plan.predicates.map((p) => p.source).join(", ")}`
    : `${result.matched} ${plan.entity} in ${directory}`;
  const lines = [bold(summary)];

  // An empty result prints the plan that ran, so a predicate that silently
  // matched nothing is still visible.
  if (!result.matched) return lines.join("\n");

  if (result.groups) {
    for (const group of result.groups) {
      lines.push("", bold(`${plan.groupBy}=${group.key ?? "(none)"} (${group.count})`));
      lines.push(...table(result.fields, group.rows, "  "));
    }
    return lines.join("\n");
  }
  lines.push(...table(result.fields, result.rows, ""));
  return lines.join("\n");
}
