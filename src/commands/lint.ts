import { lintFile } from "../lint.js";
import { formatIssues } from "../formatters.js";
import type { OutputFormat } from "../types.js";
import { outputPath } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";

interface LintOptions {
  format: string;
  style: boolean;
  mermaid: boolean;
  katex: boolean;
  references: boolean;
}

function resolveFormat(opts: LintOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function lintAction(file: string, opts: LintOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);

  const issues = await lintFile(filePath, {
    style: opts.style,
    mermaid: opts.mermaid,
    katex: opts.katex,
    references: opts.references,
  });
  const shownIssues = issues.map((issue) => ({ ...issue, file: shownPath }));

  if (issues.length > 0) {
    process.stderr.write(formatIssues(shownIssues, shownPath, format) + "\n");
    terminate(2);
  } else {
    if (format === "json") {
      process.stdout.write("[]\n");
    } else if (format === "human") {
      process.stdout.write(`\x1b[32m✔ No issues found in ${shownPath}\x1b[0m\n`);
    } else {
      process.stdout.write(`No issues found in ${shownPath}\n`);
    }
  }
}
