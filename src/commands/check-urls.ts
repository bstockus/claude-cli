import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, extractLinks } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";

interface CheckUrlsOptions {
  format: string;
  timeout: string;
  concurrency: string;
  retry: string;
  includeOk: boolean;
}

interface UrlResult {
  line: number;
  url: string;
  status: number | null;
  ok: boolean;
  error?: string;
}

function resolveFormat(opts: CheckUrlsOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

async function checkUrl(
  url: string,
  timeout: number,
  retries: number,
): Promise<{ status: number | null; ok: boolean; error?: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });

      // Fallback to GET if HEAD returns 405
      if (response.status === 405) {
        response = await fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(timeout),
          redirect: "follow",
        });
      }

      // Handle rate limiting
      if (response.status === 429 && attempt < retries) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, timeout)));
        continue;
      }

      const ok = response.status >= 200 && response.status < 400;
      return { status: response.status, ok };
    } catch (err: unknown) {
      if (attempt < retries) continue;
      const error =
        err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.message) : String(err);
      return { status: null, ok: false, error };
    }
  }
  return { status: null, ok: false, error: "Max retries exceeded" };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(() => {
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
}

export async function checkUrlsAction(file: string, opts: CheckUrlsOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = path.resolve(file);
  const timeout = parseInt(opts.timeout, 10) || 5000;
  const concurrency = parseInt(opts.concurrency, 10) || 5;
  const retries = parseInt(opts.retry, 10) || 1;

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const tree = parseMarkdown(content);
  const links = extractLinks(tree).filter((l) => l.isExternal && /^https?:/.test(l.target));

  if (links.length === 0) {
    if (format === "json") {
      process.stdout.write(
        JSON.stringify({ file: filePath, total: 0, ok: 0, broken: 0, results: [] }, null, 2) + "\n",
      );
    } else {
      process.stdout.write(`No external URLs found in ${filePath}\n`);
    }
    return;
  }

  // Deduplicate URLs, track line numbers
  const urlLines = new Map<string, number[]>();
  for (const l of links) {
    const existing = urlLines.get(l.target);
    if (existing) {
      existing.push(l.line);
    } else {
      urlLines.set(l.target, [l.line]);
    }
  }

  // Check each unique URL
  const urlResults = new Map<string, { status: number | null; ok: boolean; error?: string }>();
  await runWithConcurrency([...urlLines.keys()], concurrency, async (url) => {
    const result = await checkUrl(url, timeout, retries);
    urlResults.set(url, result);
  });

  // Expand results back to per-line entries
  const results: UrlResult[] = [];
  for (const [url, lineNums] of urlLines) {
    const result = urlResults.get(url)!;
    for (const line of lineNums) {
      const entry: UrlResult = { line, url, status: result.status, ok: result.ok };
      if (result.error) entry.error = result.error;
      results.push(entry);
    }
  }
  results.sort((a, b) => a.line - b.line);

  const okCount = results.filter((r) => r.ok).length;
  const brokenCount = results.filter((r) => !r.ok).length;

  if (format === "json") {
    process.stdout.write(
      JSON.stringify(
        { file: filePath, total: results.length, ok: okCount, broken: brokenCount, results },
        null,
        2,
      ) + "\n",
    );
    if (brokenCount > 0) process.exit(2);
    return;
  }

  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);
  const green = (s: string) => (isHuman ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s: string) => (isHuman ? `\x1b[31m${s}\x1b[0m` : s);

  const displayResults = opts.includeOk ? results : results.filter((r) => !r.ok);

  if (displayResults.length === 0 && !opts.includeOk) {
    process.stdout.write(green(`All ${results.length} URL(s) in ${filePath} are reachable`) + "\n");
    return;
  }

  const lines: string[] = [];
  if (opts.includeOk) {
    lines.push(
      bold(
        `${results.length} URL(s) checked in ${filePath} (${okCount} ok, ${brokenCount} broken):`,
      ),
    );
  } else {
    lines.push(bold(`${brokenCount} broken URL(s) in ${filePath}:`));
  }

  for (const r of displayResults) {
    if (r.ok) {
      lines.push(`  L${r.line}  ${green("[ok]")}    ${r.url}`);
    } else {
      const statusStr = r.status ? `[${r.status}]` : "[fail]";
      const detail = r.error ? `  (${r.error})` : "";
      lines.push(`  L${r.line}  ${red(statusStr)}   ${r.url}${detail}`);
    }
  }

  if (brokenCount > 0) {
    process.stderr.write(lines.join("\n") + "\n");
    process.exit(2);
  } else {
    process.stdout.write(lines.join("\n") + "\n");
  }
}
