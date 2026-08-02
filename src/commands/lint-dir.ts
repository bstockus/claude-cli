import fs from "node:fs";
import path from "node:path";
import { lintFile, findMarkdownFiles } from "../lint.js";
import { formatIssues } from "../formatters.js";
import type { Issue, OutputFormat } from "../types.js";

interface LintDirOptions {
  format: string;
  style: boolean;
  summary: boolean;
}

function resolveFormat(opts: LintDirOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function lintDirAction(directory: string, opts: LintDirOptions): Promise<void> {
  const format = resolveFormat(opts);
  const dirPath = path.resolve(directory);

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    process.stderr.write(`Error: Directory not found: ${dirPath}\n`);
    process.exit(1);
  }

  const mdFiles = findMarkdownFiles(dirPath);
  if (mdFiles.length === 0) {
    if (format === "json") {
      process.stdout.write("[]\n");
    } else {
      process.stdout.write(`No .md files found in ${dirPath}\n`);
    }
    return;
  }

  const allIssues: Issue[] = [];
  const issuesByFile: Record<string, Issue[]> = {};
  for (const filePath of mdFiles) {
    const issues = await lintFile(filePath, { style: opts.style });
    allIssues.push(...issues);
    if (issues.length > 0) {
      issuesByFile[filePath] = issues;
    }
  }

  if (opts.summary) {
    const isHuman = format === "human";
    const green = (s: string) => (isHuman ? `\x1b[32m${s}\x1b[0m` : s);
    const red = (s: string) => (isHuman ? `\x1b[1;31m${s}\x1b[0m` : s);
    const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);

    if (format === "json") {
      const results = mdFiles.map((f) => ({
        file: f,
        issues: (issuesByFile[f] ?? []).length,
        ok: !(f in issuesByFile),
      }));
      const output = JSON.stringify(results, null, 2) + "\n";
      if (allIssues.length > 0) {
        process.stderr.write(output);
        process.exit(2);
      }
      process.stdout.write(output);
      return;
    }

    const lines: string[] = [];
    for (const filePath of mdFiles) {
      const count = (issuesByFile[filePath] ?? []).length;
      if (count > 0) {
        lines.push(`  ${red("✖")} ${filePath}  ${count} issue(s)`);
      } else {
        lines.push(`  ${green("✔")} ${filePath}`);
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
      process.exit(2);
    }
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  if (allIssues.length > 0) {
    if (format === "json") {
      process.stderr.write(JSON.stringify(allIssues, null, 2) + "\n");
    } else {
      for (const [file, issues] of Object.entries(issuesByFile)) {
        process.stderr.write(formatIssues(issues, file, format) + "\n");
      }
      const fileCount = Object.keys(issuesByFile).length;
      const summary =
        format === "human"
          ? `\n\x1b[1;31m✖ ${allIssues.length} total issue(s) across ${fileCount} file(s)\x1b[0m\n`
          : `${allIssues.length} total issue(s) across ${fileCount} file(s)`;
      process.stderr.write(summary + "\n");
    }
    process.exit(2);
  } else {
    if (format === "json") {
      process.stdout.write("[]\n");
    } else if (format === "human") {
      process.stdout.write(
        `\x1b[32m✔ No issues found across ${mdFiles.length} file(s) in ${dirPath}\x1b[0m\n`,
      );
    } else {
      process.stdout.write(`No issues found across ${mdFiles.length} file(s) in ${dirPath}\n`);
    }
  }
}
