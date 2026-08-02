import fs from "node:fs";
import path from "node:path";
import { lintFile } from "../lint.js";
import { formatIssues } from "../formatters.js";
import type { OutputFormat } from "../types.js";

interface LintOptions {
  format: string;
  style: boolean;
}

function resolveFormat(opts: LintOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function lintAction(file: string, opts: LintOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const issues = await lintFile(filePath, { style: opts.style });

  if (issues.length > 0) {
    process.stderr.write(formatIssues(issues, filePath, format) + "\n");
    process.exit(2);
  } else {
    if (format === "json") {
      process.stdout.write("[]\n");
    } else if (format === "human") {
      process.stdout.write(`\x1b[32m✔ No issues found in ${filePath}\x1b[0m\n`);
    } else {
      process.stdout.write(`No issues found in ${filePath}\n`);
    }
  }
}
