import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "markdownlint/async";
import type { Issue } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "..", ".markdownlintrc");

/** A markdownlint autofix, as the library describes it. */
export interface MarkdownlintFixInfo {
  /** Defaults to the finding's own line. */
  lineNumber?: number;
  /** 1-based column on the terminator-stripped line. */
  editColumn?: number;
  /** Characters to remove; -1 means the whole line, including its terminator. */
  deleteCount?: number;
  insertText?: string;
}

export interface MarkdownlintError {
  lineNumber: number;
  ruleNames: string[];
  ruleDescription: string;
  errorDetail?: string;
  /** Present only for rules that know how to repair themselves. */
  fixInfo?: MarkdownlintFixInfo | null;
}

export async function loadMarkdownlintConfig(
  userConfigPath?: string,
): Promise<Record<string, unknown>> {
  let config: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
  if (userConfigPath) {
    if (!fs.existsSync(userConfigPath)) {
      throw new Error(`Markdownlint configuration not found: ${userConfigPath}`);
    }
    const extension = path.extname(userConfigPath).toLowerCase();
    const raw = fs.readFileSync(userConfigPath, "utf-8");
    const userConfig =
      extension === ".json"
        ? (JSON.parse(raw) as Record<string, unknown>)
        : ((await import("yaml")).parse(raw) as Record<string, unknown>);
    config = { ...config, ...userConfig };
  }
  return config;
}

/**
 * Lints in-memory content, returning markdownlint's own findings.
 *
 * Exposed separately from `checkMarkdownLint` so `md fix` can read `fixInfo`,
 * which the `Issue` shape has nowhere to carry.
 */
export async function lintContent(
  filePath: string,
  content: string,
  config: Record<string, unknown>,
): Promise<MarkdownlintError[]> {
  const results = await new Promise<Record<string, MarkdownlintError[]>>((resolve, reject) => {
    lint({ strings: { [filePath]: content }, config }, (err: Error | null, result: unknown) => {
      if (err) reject(err);
      else resolve(result as Record<string, MarkdownlintError[]>);
    });
  });
  return results[filePath] || [];
}

export async function checkMarkdownLint(
  filePath: string,
  content: string,
  issues: Issue[],
  userConfigPath?: string,
): Promise<void> {
  const config = await loadMarkdownlintConfig(userConfigPath);
  for (const r of await lintContent(filePath, content, config)) {
    issues.push({
      file: filePath,
      line: r.lineNumber,
      checker: `markdownlint/${r.ruleNames[0]}`,
      message: `${r.ruleDescription}${r.errorDetail ? ": " + r.errorDetail : ""}`,
    });
  }
}
