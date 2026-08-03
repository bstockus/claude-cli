import { lintFile } from "../lint.js";
import { formatIssues } from "../formatters.js";
import type { Issue, OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { resolveMarkdownInputs } from "../input-selection.js";
import { jsonPayload } from "../result.js";

interface LintOptions {
  envelope?: boolean;
  format: string;
  style: boolean;
  mermaid: boolean;
  katex: boolean;
  references: boolean;
  include: string[];
  exclude: string[];
  stdinName?: string;
  changedSince?: string;
}

function resolveFormat(opts: LintOptions): OutputFormat {
  return ["llm", "human", "json", "jsonl", "sarif"].includes(opts.format)
    ? (opts.format as OutputFormat)
    : "llm";
}

export async function lintAction(input: string | string[], opts: LintOptions): Promise<void> {
  const format = resolveFormat(opts);
  const inputs = Array.isArray(input) ? input : [input];
  const files = resolveMarkdownInputs(inputs, { ...opts, requireStdinName: opts.references });
  if (!files.length && !opts.changedSince) throw new Error("No Markdown input files matched");
  const issues: Issue[] = [];
  for (const file of files) {
    issues.push(
      ...(await lintFile(
        file,
        {
          style: opts.style,
          mermaid: opts.mermaid,
          katex: opts.katex,
          references: opts.references,
        },
        runtime().workspace.document(file),
      )),
    );
  }
  const shown = issues.map((issue) => ({ ...issue, file: outputPath(issue.file, opts) }));
  const label = files.length === 1 ? outputPath(files[0], opts) : `${files.length} files`;
  if (issues.length) {
    process.stderr.write(
      formatIssues(
        shown,
        label,
        format,
        { files: files.length },
        {
          command: "md lint",
          envelope: opts.envelope,
        },
      ) + "\n",
    );
    terminate(2);
  }
  if (format === "json")
    process.stdout.write(jsonPayload("md lint", [], opts, { summary: { findings: 0 } }));
  else if (format === "jsonl" || format === "sarif")
    process.stdout.write(formatIssues([], label, format, { files: files.length }) + "\n");
  else if (format === "human")
    process.stdout.write(`\x1b[32m✔ No issues found in ${label}\x1b[0m\n`);
  else process.stdout.write(`No issues found in ${label}\n`);
}
