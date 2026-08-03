import { FrontmatterValidator } from "../frontmatter-validation.js";
import { formatIssues } from "../formatters.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import type { Issue, OutputFormat } from "../types.js";

interface Options {
  envelope?: boolean;
  format: string;
  schema?: string;
  include: string[];
  exclude: string[];
  stdinName?: string;
  changedSince?: string;
}
import { resolveMarkdownInputs } from "../input-selection.js";
import { jsonPayload } from "../result.js";

export function frontmatterIssues(files: string[], schema?: string): Issue[] {
  const validator = new FrontmatterValidator(
    runtime().config.frontmatter.rules,
    schema ?? runtime().config.frontmatter.schema,
  );
  return validator.validateMany(files.map((file) => runtime().workspace.document(file)));
}

export async function validateFrontmatterAction(
  target: string | string[],
  opts: Options,
): Promise<void> {
  const inputs = Array.isArray(target) ? target : [target];
  const files = resolveMarkdownInputs(inputs, opts);
  const schema = opts.schema;
  const issues = frontmatterIssues(files, schema);
  const shown = issues.map((issue) => ({ ...issue, file: outputPath(issue.file, opts) }));
  const format = (
    ["json", "jsonl", "sarif", "human"].includes(opts.format) ? opts.format : "llm"
  ) as OutputFormat;
  const label =
    inputs.length === 1
      ? outputPath(files[0] ?? runtime().config.root, opts)
      : `${files.length} files`;
  if (issues.length) {
    process.stderr.write(
      formatIssues(
        shown,
        label,
        format,
        { files: files.length },
        {
          command: "md validate-frontmatter",
          envelope: opts.envelope,
        },
      ) + "\n",
    );
    terminate(2);
  }
  process.stdout.write(
    format === "json"
      ? jsonPayload("md validate-frontmatter", [], opts, { summary: { findings: 0 } })
      : format === "jsonl" || format === "sarif"
        ? formatIssues([], label, format, { files: files.length }) + "\n"
        : `Frontmatter valid in ${files.length} file(s)\n`,
  );
}
