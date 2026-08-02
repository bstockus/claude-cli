import fs from "node:fs";
import path from "node:path";
import { FrontmatterValidator } from "../frontmatter-validation.js";
import { formatIssues } from "../formatters.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import type { Issue, OutputFormat } from "../types.js";

interface Options {
  format: string;
  schema?: string;
  include: string[];
  exclude: string[];
}

export function frontmatterIssues(files: string[], schema?: string): Issue[] {
  const validator = new FrontmatterValidator(
    runtime().config.frontmatter.rules,
    schema ?? runtime().config.frontmatter.schema,
  );
  return validator.validateMany(files.map((file) => runtime().workspace.document(file)));
}

export async function validateFrontmatterAction(target: string, opts: Options): Promise<void> {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) throw new Error(`Path not found: ${resolved}`);
  const files = fs.statSync(resolved).isDirectory()
    ? runtime().workspace.markdownFiles(resolved, { include: opts.include, exclude: opts.exclude })
    : fs.statSync(resolved).isFile()
      ? [resolved]
      : [];
  if (!files.length && !fs.statSync(resolved).isDirectory())
    throw new Error(`Path is not a file or directory: ${resolved}`);
  const schema = opts.schema ? path.resolve(opts.schema) : undefined;
  const issues = frontmatterIssues(files, schema);
  const shown = issues.map((issue) => ({ ...issue, file: outputPath(issue.file, opts) }));
  const format = (
    opts.format === "json" || opts.format === "human" ? opts.format : "llm"
  ) as OutputFormat;
  if (issues.length) {
    process.stderr.write(formatIssues(shown, outputPath(resolved, opts), format) + "\n");
    terminate(2);
  }
  process.stdout.write(
    format === "json" ? "[]\n" : `Frontmatter valid in ${files.length} file(s)\n`,
  );
}
