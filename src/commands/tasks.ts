import { extractTasks } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { requireFile } from "../input.js";

interface TasksOptions {
  format: string;
  status?: string;
  summary: boolean;
}

function resolveFormat(opts: TasksOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function tasksAction(file: string, opts: TasksOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);

  let tasks = extractTasks(runtime().workspace.document(filePath).tree);

  if (opts.status === "done") {
    tasks = tasks.filter((t) => t.checked);
  } else if (opts.status === "pending") {
    tasks = tasks.filter((t) => !t.checked);
  }

  const done = tasks.filter((t) => t.checked).length;
  const pending = tasks.filter((t) => !t.checked).length;
  const total = tasks.length;

  if (format === "json") {
    const result: Record<string, unknown> = { file: shownPath, total, done, pending };
    if (!opts.summary) {
      result.tasks = tasks.map((t) => ({ line: t.line, checked: t.checked, text: t.text }));
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);
  const green = (s: string) => (isHuman ? `\x1b[32m${s}\x1b[0m` : s);
  const yellow = (s: string) => (isHuman ? `\x1b[33m${s}\x1b[0m` : s);

  if (opts.summary) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    process.stdout.write(
      bold(`${total} task(s) in ${shownPath}:`) + ` ${done} done, ${pending} pending (${pct}%)\n`,
    );
    return;
  }

  if (total === 0) {
    if (isHuman) {
      process.stdout.write(`\x1b[33mNo tasks found in ${shownPath}\x1b[0m\n`);
    } else {
      process.stdout.write(`No tasks found in ${shownPath}\n`);
    }
    return;
  }

  const lines: string[] = [];
  lines.push(bold(`${total} task(s) in ${shownPath} (${done} done, ${pending} pending):`));
  for (const t of tasks) {
    const marker = t.checked ? green("[x]") : yellow("[ ]");
    lines.push(`  L${t.line}  ${marker} ${t.text}`);
  }

  process.stdout.write(lines.join("\n") + "\n");
}
