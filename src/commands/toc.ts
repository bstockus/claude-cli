import fs from "node:fs";
import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { requireFile } from "../input.js";
import { terminate } from "../command-result.js";
import { renderToc, synchronizeToc } from "../toc.js";
import { jsonPayload } from "../result.js";

export interface TocOptions {
  envelope?: boolean;
  format: string;
  maxDepth: string;
  minDepth: string;
  ordered: boolean;
  check?: boolean;
  write?: boolean;
  dryRun?: boolean;
}

function resolveFormat(opts: TocOptions): OutputFormat {
  return opts.format === "human" || opts.format === "json" ? opts.format : "llm";
}

export function tocSynchronizationIssue(
  filePath: string,
  opts: TocOptions,
): { issue?: string; malformed?: string; replacement?: string; block?: string; current: boolean } {
  const document = runtime().workspace.document(filePath);
  const maxDepth = Math.min(6, Math.max(1, parseInt(opts.maxDepth, 10) || 6));
  const minDepth = Math.min(6, Math.max(1, parseInt(opts.minDepth, 10) || 1));
  const headings = document.headings.filter(
    (heading) => heading.depth >= minDepth && heading.depth <= maxDepth,
  );
  const sync = synchronizeToc(document.content, renderToc(headings, opts.ordered));
  if (sync.status === "missing") return { issue: "TOC markers are missing", current: false };
  if (sync.status === "malformed") return { malformed: sync.message, current: false };
  if (sync.status === "current") return { block: sync.block, current: true };
  return {
    issue: "Generated TOC is stale",
    replacement: sync.replacement,
    block: sync.block,
    current: false,
  };
}

export async function tocAction(file: string, opts: TocOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);
  const explicitModes = [
    process.argv.includes("--check") ? "check" : undefined,
    process.argv.includes("--write") ? "write" : undefined,
    process.argv.includes("--dry-run") ? "dryRun" : undefined,
  ].filter((mode): mode is "check" | "write" | "dryRun" => mode !== undefined);
  if (explicitModes.length > 1) {
    throw new Error("--check, --write, and --dry-run are mutually exclusive");
  }
  const selected = explicitModes[0];
  const check = selected ? selected === "check" : opts.check;
  const write = selected ? selected === "write" : opts.write;
  const dryRun = selected ? selected === "dryRun" : opts.dryRun;
  const modes = [check, write, dryRun].filter(Boolean).length;
  if (modes > 1) throw new Error("--check, --write, and --dry-run are mutually exclusive");
  if (modes) {
    const result = tocSynchronizationIssue(filePath, opts);
    if (result.malformed) throw new Error(`${shownPath}: ${result.malformed}`);
    if ((write || dryRun) && !result.block)
      throw new Error(`${shownPath}: TOC markers are missing`);
    if (write) {
      if (result.replacement !== undefined) {
        fs.writeFileSync(filePath, result.replacement);
        runtime().workspace.invalidate(filePath);
      }
      const payload =
        format === "json"
          ? jsonPayload(
              "md toc",
              { file: shownPath, changed: result.replacement !== undefined },
              opts,
            )
          : `${result.replacement !== undefined ? "Updated" : "TOC already current in"} ${shownPath}\n`;
      process.stdout.write(payload);
      return;
    }
    if (dryRun) {
      if (format === "json")
        process.stdout.write(
          jsonPayload(
            "md toc",
            { file: shownPath, changed: !result.current, block: result.block },
            opts,
          ),
        );
      else process.stdout.write(result.block! + "\n");
      return;
    }
    const payload =
      format === "json"
        ? jsonPayload(
            "md toc",
            { file: shownPath, current: result.current, issue: result.issue ?? null },
            opts,
            { exitCode: result.current ? 0 : 2 },
          ).trimEnd()
        : result.current
          ? `TOC is current in ${shownPath}`
          : `${result.issue} in ${shownPath}`;
    (result.current ? process.stdout : process.stderr).write(payload + "\n");
    if (!result.current) terminate(2);
    return;
  }

  const maxDepth = Math.min(6, Math.max(1, parseInt(opts.maxDepth, 10) || 6));
  const minDepth = Math.min(6, Math.max(1, parseInt(opts.minDepth, 10) || 1));
  const headings = runtime()
    .workspace.document(filePath)
    .headings.filter((heading) => heading.depth >= minDepth && heading.depth <= maxDepth);
  if (format === "json") {
    process.stdout.write(
      jsonPayload(
        "md toc",
        headings.map((heading) => ({
          text: heading.text,
          slug: heading.slug,
          depth: heading.depth,
          line: heading.line,
        })),
        opts,
      ),
    );
    return;
  }
  if (!headings.length) {
    process.stdout.write(
      format === "human"
        ? `\x1b[33mNo headings found in ${shownPath}\x1b[0m\n`
        : `No headings found in ${shownPath}\n`,
    );
    return;
  }
  process.stdout.write(renderToc(headings, opts.ordered) + "\n");
}
