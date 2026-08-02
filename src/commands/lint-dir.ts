import { lintFile, findMarkdownFiles } from "../lint.js";
import { formatIssues } from "../formatters.js";
import type { Issue, OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireDirectory } from "../input.js";
import { changedMarkdownFiles } from "../input-selection.js";

interface LintDirOptions {
  format: string;
  style: boolean;
  summary: boolean;
  concurrency: string;
  include: string[];
  exclude: string[];
  mermaid: boolean;
  katex: boolean;
  references: boolean;
  changedSince?: string;
}

function resolveFormat(opts: LintDirOptions): OutputFormat {
  const fmt = opts.format;
  if (["llm", "human", "json", "jsonl", "sarif"].includes(fmt)) return fmt as OutputFormat;
  return "llm";
}

export async function lintDirAction(directory: string, opts: LintDirOptions): Promise<void> {
  const format = resolveFormat(opts);
  const dirPath = requireDirectory(directory, opts);
  const shownDir = outputPath(dirPath, opts);

  let mdFiles: string[];
  try {
    mdFiles = findMarkdownFiles(dirPath, { include: opts.include, exclude: opts.exclude });
    if (opts.changedSince) {
      const changed = new Set(changedMarkdownFiles(opts.changedSince));
      mdFiles = mdFiles.filter((file) => changed.has(file));
    }
  } catch (error) {
    process.stderr.write(`Error: ${(error as Error).message}\n`);
    terminate(1);
  }
  if (mdFiles.length === 0) {
    if (format === "json") {
      process.stdout.write("[]\n");
    } else if (format === "jsonl" || format === "sarif") {
      process.stdout.write(formatIssues([], shownDir, format, { files: 0 }) + "\n");
    } else {
      process.stdout.write(`No .md files found in ${shownDir}\n`);
    }
    return;
  }

  const allIssues: Issue[] = [];
  const issuesByFile: Record<string, Issue[]> = {};
  const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 1);
  const results = new Array<Issue[]>(mdFiles.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < mdFiles.length) {
      const index = next++;
      const filePath = mdFiles[index];
      const document = runtime().workspace.document(filePath);
      results[index] = await lintFile(
        filePath,
        {
          style: opts.style,
          mermaid: opts.mermaid,
          katex: opts.katex,
          references: opts.references,
        },
        document,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, mdFiles.length) }, worker));
  for (let index = 0; index < mdFiles.length; index++) {
    const filePath = mdFiles[index];
    const issues = results[index];
    allIssues.push(...issues);
    if (issues.length > 0) issuesByFile[filePath] = issues;
  }

  if (opts.summary) {
    const isHuman = format === "human";
    const green = (s: string) => (isHuman ? `\x1b[32m${s}\x1b[0m` : s);
    const red = (s: string) => (isHuman ? `\x1b[1;31m${s}\x1b[0m` : s);
    const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);

    if (format === "json") {
      const results = mdFiles.map((f) => ({
        file: outputPath(f, opts),
        issues: (issuesByFile[f] ?? []).length,
        ok: !(f in issuesByFile),
      }));
      const output = JSON.stringify(results, null, 2) + "\n";
      if (allIssues.length > 0) {
        process.stderr.write(output);
        terminate(2);
      }
      process.stdout.write(output);
      return;
    }
    if (format === "jsonl" || format === "sarif") {
      const shown = allIssues.map((issue) => ({ ...issue, file: outputPath(issue.file, opts) }));
      const output = formatIssues(shown, shownDir, format, { files: mdFiles.length }) + "\n";
      if (allIssues.length) {
        process.stderr.write(output);
        terminate(2);
      }
      process.stdout.write(output);
      return;
    }

    const lines: string[] = [];
    for (const filePath of mdFiles) {
      const count = (issuesByFile[filePath] ?? []).length;
      if (count > 0) {
        lines.push(`  ${red("✖")} ${outputPath(filePath, opts)}  ${count} issue(s)`);
      } else {
        lines.push(`  ${green("✔")} ${outputPath(filePath, opts)}`);
      }
    }
    const failedCount = Object.keys(issuesByFile).length;
    const passedCount = mdFiles.length - failedCount;
    lines.push("");
    lines.push(
      bold(
        `${mdFiles.length} file(s): ${passedCount} passed, ${failedCount} failed, ${allIssues.length} total issue(s)`,
      ),
    );

    if (allIssues.length > 0) {
      process.stderr.write(lines.join("\n") + "\n");
      terminate(2);
    }
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  if (allIssues.length > 0) {
    if (format === "json") {
      process.stderr.write(
        JSON.stringify(
          allIssues.map((issue) => ({ ...issue, file: outputPath(issue.file, opts) })),
          null,
          2,
        ) + "\n",
      );
    } else if (format === "jsonl" || format === "sarif") {
      process.stderr.write(
        formatIssues(
          allIssues.map((issue) => ({ ...issue, file: outputPath(issue.file, opts) })),
          shownDir,
          format,
          { files: mdFiles.length },
        ) + "\n",
      );
    } else {
      for (const [file, issues] of Object.entries(issuesByFile)) {
        const shownFile = outputPath(file, opts);
        process.stderr.write(
          formatIssues(
            issues.map((issue) => ({ ...issue, file: shownFile })),
            shownFile,
            format,
          ) + "\n",
        );
      }
      const fileCount = Object.keys(issuesByFile).length;
      const summary =
        format === "human"
          ? `\n\x1b[1;31m✖ ${allIssues.length} total issue(s) across ${fileCount} file(s)\x1b[0m\n`
          : `${allIssues.length} total issue(s) across ${fileCount} file(s)`;
      process.stderr.write(summary + "\n");
    }
    terminate(2);
  } else {
    if (format === "json") {
      process.stdout.write("[]\n");
    } else if (format === "jsonl" || format === "sarif") {
      process.stdout.write(formatIssues([], shownDir, format, { files: mdFiles.length }) + "\n");
    } else if (format === "human") {
      process.stdout.write(
        `\x1b[32m✔ No issues found across ${mdFiles.length} file(s) in ${shownDir}\x1b[0m\n`,
      );
    } else {
      process.stdout.write(`No issues found across ${mdFiles.length} file(s) in ${shownDir}\n`);
    }
  }
}
