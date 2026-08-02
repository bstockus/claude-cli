import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

interface PackResult {
  files: Array<{ path: string }>;
  bin?: Record<string, string>;
}

async function packFileList(): Promise<string[]> {
  const { stdout } = await exec("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: repoRoot,
    maxBuffer: 32 * 1024 * 1024,
  });
  const [result] = JSON.parse(stdout) as PackResult[];
  return result.files.map((f) => f.path);
}

describe("published package contents", () => {
  it("ships the CLI entry point declared in bin", async () => {
    expect(await packFileList()).toContain("dist/cli.js");
  });

  // markdown-lint.ts resolves its config as dist/checkers/../../.markdownlintrc, i.e. the
  // package root. It falls back to {} silently when the file is absent, so leaving this
  // out of package.json "files" would not crash — `md lint --style` would just start
  // reporting rules (MD013 in particular) that are disabled everywhere else.
  it("ships .markdownlintrc so --style uses the intended rule config", async () => {
    expect(await packFileList()).toContain(".markdownlintrc");
  });
});
