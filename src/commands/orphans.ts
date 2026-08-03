import path from "node:path";
import { findMarkdownFiles } from "../lint.js";
import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireDirectory } from "../input.js";
import { buildWorkspaceGraph } from "../graph.js";
import { jsonPayload } from "../result.js";

interface OrphansOptions {
  envelope?: boolean;
  format: string;
  ignore: string[];
  entry: string[];
  include: string[];
  exclude: string[];
}

function resolveFormat(opts: OrphansOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export async function orphansAction(directory: string, opts: OrphansOptions): Promise<void> {
  const format = resolveFormat(opts);
  const dirPath = requireDirectory(directory, opts);
  const shownDir = outputPath(dirPath, opts);

  let files = findMarkdownFiles(dirPath, { include: opts.include, exclude: opts.exclude });

  // Apply ignore patterns
  if (opts.ignore.length > 0) {
    const patterns = opts.ignore.map(globToRegex);
    files = files.filter((f) => {
      const rel = path.relative(dirPath, f);
      return !patterns.some((p) => p.test(rel));
    });
  }

  // Resolve entry files
  const entryFiles = new Set(opts.entry.map((e) => path.resolve(dirPath, e)));
  const graph = buildWorkspaceGraph(runtime().workspace, files);
  const referencedFiles = new Set(
    graph.nodes.filter((node) => node.inbound > 0).map((node) => node.file),
  );

  // Find orphans
  const orphans = files.filter((f) => !referencedFiles.has(f) && !entryFiles.has(f));

  if (format === "json") {
    const json = jsonPayload(
      "md orphans",
      {
        directory: shownDir,
        totalFiles: files.length,
        orphans: orphans.map((file) => outputPath(file, opts)),
      },
      opts,
      { exitCode: orphans.length ? 2 : 0, summary: { orphans: orphans.length } },
    );
    if (orphans.length > 0) {
      process.stderr.write(json);
      terminate(2);
    }
    process.stdout.write(json);
    return;
  }

  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);

  if (orphans.length === 0) {
    if (isHuman) {
      process.stdout.write(
        `\x1b[32m✔ No orphans found in ${shownDir} (${files.length} files scanned)\x1b[0m\n`,
      );
    } else {
      process.stdout.write(`No orphans found in ${shownDir} (${files.length} files scanned)\n`);
    }
    return;
  }

  const lines: string[] = [];
  lines.push(
    bold(`${orphans.length} orphan(s) found in ${shownDir} (${files.length} files scanned):`),
  );
  for (const o of orphans) {
    lines.push(`  ${outputPath(o, opts)}`);
  }

  process.stderr.write(lines.join("\n") + "\n");
  terminate(2);
}
