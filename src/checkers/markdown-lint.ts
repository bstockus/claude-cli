import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "markdownlint/async";
import type { Issue } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "..", ".markdownlintrc");

export async function checkMarkdownLint(
  filePath: string,
  content: string,
  issues: Issue[],
): Promise<void> {
  let config: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  const results = await new Promise<
    Record<
      string,
      Array<{
        lineNumber: number;
        ruleNames: string[];
        ruleDescription: string;
        errorDetail?: string;
      }>
    >
  >((resolve, reject) => {
    lint({ strings: { [filePath]: content }, config }, (err: Error | null, result: unknown) => {
      if (err) reject(err);
      else
        resolve(
          result as Record<
            string,
            Array<{
              lineNumber: number;
              ruleNames: string[];
              ruleDescription: string;
              errorDetail?: string;
            }>
          >,
        );
    });
  });

  const fileResults = results[filePath] || [];
  for (const r of fileResults) {
    issues.push({
      file: filePath,
      line: r.lineNumber,
      checker: `markdownlint/${r.ruleNames[0]}`,
      message: `${r.ruleDescription}${r.errorDetail ? ": " + r.errorDetail : ""}`,
    });
  }
}
