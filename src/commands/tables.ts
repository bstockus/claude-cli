import { extractTables } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";
import { jsonPayload } from "../result.js";

interface TablesOptions {
  envelope?: boolean;
  format: string;
  content: boolean;
  index?: string;
}

function resolveFormat(opts: TablesOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function tablesAction(file: string, opts: TablesOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);

  let tables = extractTables(runtime().workspace.document(filePath).tree);

  if (opts.index !== undefined) {
    const idx = parseInt(opts.index, 10);
    if (isNaN(idx) || idx < 1 || idx > tables.length) {
      process.stderr.write(
        `Error: Table index out of range: ${opts.index} (file has ${tables.length} table(s))\n`,
      );
      terminate(1);
    }
    tables = [tables[idx - 1]];
  }

  if (format === "json") {
    const result = tables.map((t) => ({
      line: t.line,
      endLine: t.endLine,
      columns: t.columns,
      rows: t.rows,
      align: t.align,
      headers: t.headers,
      data: t.data,
    }));
    process.stdout.write(jsonPayload("md tables", result, opts));
    return;
  }

  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);
  const cyan = (s: string) => (isHuman ? `\x1b[36m${s}\x1b[0m` : s);

  if (tables.length === 0) {
    if (isHuman) {
      process.stdout.write(`\x1b[33mNo tables found in ${shownPath}\x1b[0m\n`);
    } else {
      process.stdout.write(`No tables found in ${shownPath}\n`);
    }
    return;
  }

  const lines: string[] = [];
  lines.push(bold(`${tables.length} table(s) in ${shownPath}:`));

  for (const t of tables) {
    lines.push(`  ${cyan(`L${t.line}-L${t.endLine}`)}   ${t.columns} columns x ${t.rows} rows`);
    if (opts.content) {
      const colWidths = t.headers.map((h, i) => {
        let max = h.length;
        for (const row of t.data) {
          if (row[i] && row[i].length > max) max = row[i].length;
        }
        return max;
      });
      const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
      const headerLine = "| " + t.headers.map((h, i) => pad(h, colWidths[i])).join(" | ") + " |";
      const sepLine = "|" + colWidths.map((w) => "-".repeat(w + 2)).join("|") + "|";
      lines.push(`    ${headerLine}`);
      lines.push(`    ${sepLine}`);
      for (const row of t.data) {
        const rowLine = "| " + row.map((c, i) => pad(c, colWidths[i])).join(" | ") + " |";
        lines.push(`    ${rowLine}`);
      }
      lines.push("");
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}
