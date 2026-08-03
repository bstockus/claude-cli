import { minimatch } from "minimatch";
import { formatSarif } from "../automation.js";
import { resolveMarkdownInputs } from "../input-selection.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import type { Issue, OutputFormat } from "../types.js";
import { jsonPayload } from "../result.js";
import {
  getUrlCachePath,
  readUrlCache,
  urlCacheKey,
  writeUrlCache,
  type RawUrlResult,
} from "../url-cache.js";

interface CheckUrlsOptions {
  envelope?: boolean;
  format: string;
  timeout: string;
  concurrency: string;
  retry: string;
  includeOk: boolean;
  include: string[];
  exclude: string[];
  stdinName?: string;
  changedSince?: string;
  ignore: string[];
  ignoreDomain: string[];
  allowedStatus: Array<string | number>;
  cache: boolean;
  cacheTtl: string | number;
  headFallbackStatus: Array<string | number>;
  reportRedirects: boolean;
}

export interface UrlResult {
  file: string;
  line: number;
  url: string;
  status: number | null;
  ok: boolean;
  error?: string;
  redirected?: boolean;
  finalUrl?: string;
}

export interface UrlOccurrence {
  file: string;
  line: number;
  url: string;
}

export interface UrlCheckOptions {
  timeout: number;
  concurrency: number;
  retries: number;
  allowedStatuses?: readonly number[];
  headFallbackStatuses?: readonly number[];
  cache?: boolean;
  cacheTtl?: number;
  cachePath?: string;
}

function format(opts: CheckUrlsOptions): OutputFormat {
  return ["llm", "human", "json", "jsonl", "sarif"].includes(opts.format)
    ? (opts.format as OutputFormat)
    : "llm";
}

function statusCodes(values: readonly (string | number)[], fallback: readonly number[]): number[] {
  if (!values.length) return [...fallback];
  const parsed = values.map(Number);
  if (parsed.some((value) => !Number.isInteger(value) || value < 100 || value > 599)) {
    throw new Error("HTTP statuses must be integers from 100 to 599");
  }
  return parsed;
}

export async function checkUrlRaw(
  url: string,
  timeout: number,
  retries: number,
  headFallbackStatuses: readonly number[] = [400, 403, 405, 501],
): Promise<RawUrlResult> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });
      if (headFallbackStatuses.includes(response.status)) {
        response = await fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(timeout),
          redirect: "follow",
        });
      }
      if (response.status === 429 && attempt < retries) continue;
      const finalUrl = response.url || url;
      return {
        status: response.status,
        redirected: response.redirected || finalUrl !== url,
        finalUrl,
      };
    } catch (error) {
      if (attempt < retries) continue;
      return {
        status: null,
        error:
          error instanceof Error
            ? ((error as NodeJS.ErrnoException).code ?? error.message)
            : String(error),
        redirected: false,
        finalUrl: url,
      };
    }
  }
  return { status: null, error: "Max retries exceeded", redirected: false, finalUrl: url };
}

export async function checkUrl(
  url: string,
  timeout: number,
  retries: number,
  allowedStatuses: readonly number[] = [],
  headFallbackStatuses: readonly number[] = [400, 403, 405, 501],
): Promise<RawUrlResult & { ok: boolean }> {
  const result = await checkUrlRaw(url, timeout, retries, headFallbackStatuses);
  return {
    ...result,
    ok:
      result.status !== null &&
      ((result.status >= 200 && result.status < 400) || allowedStatuses.includes(result.status)),
  };
}

async function concurrent<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
}

export async function checkUrlOccurrences(
  occurrences: UrlOccurrence[],
  options: UrlCheckOptions,
): Promise<UrlResult[]> {
  const allowed = options.allowedStatuses ?? runtime().config.urls.allowedStatuses;
  const fallback = options.headFallbackStatuses ?? runtime().config.urls.headFallbackStatuses;
  const cacheEnabled = options.cache ?? runtime().config.urls.cache;
  const ttl = options.cacheTtl ?? runtime().config.urls.cacheTtl;
  const cachePath = options.cachePath ?? getUrlCachePath();
  const unique = [...new Set(occurrences.map((item) => item.url))].sort();
  const checked = new Map<string, RawUrlResult>();
  await concurrent(unique, options.concurrency, async (url) => {
    const key = urlCacheKey(url, {
      timeout: options.timeout,
      retries: options.retries,
      headFallbackStatuses: fallback,
    });
    const cached = cacheEnabled ? readUrlCache(cachePath, key, ttl) : undefined;
    if (cached) {
      checked.set(url, cached);
      return;
    }
    const result = await checkUrlRaw(url, options.timeout, options.retries, fallback);
    checked.set(url, result);
    if (cacheEnabled) writeUrlCache(cachePath, key, result);
  });
  return occurrences.map((occurrence) => {
    const raw = checked.get(occurrence.url)!;
    return {
      ...occurrence,
      ...raw,
      ok:
        raw.status !== null &&
        ((raw.status >= 200 && raw.status < 400) || allowed.includes(raw.status)),
    };
  });
}

function ignoredDomain(url: string, domains: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((value) => {
      const domain = value.toLowerCase().replace(/^\*\./, "");
      return host === domain || host.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

export async function checkUrlsAction(
  inputs: string | string[],
  opts: CheckUrlsOptions,
): Promise<void> {
  const files = resolveMarkdownInputs(Array.isArray(inputs) ? inputs : [inputs], {
    ...opts,
    requireStdinName: true,
  });
  const configured = runtime().config.urls;
  const parsedCacheTtl = Number(opts.cacheTtl);
  if (!Number.isInteger(parsedCacheTtl) || parsedCacheTtl < 0) {
    throw new Error("--cache-ttl must be a non-negative integer");
  }
  const occurrences = files.flatMap((file) =>
    runtime()
      .workspace.document(file)
      .references.filter((ref) => ref.isExternal && /^https?:/i.test(ref.target))
      .filter(
        (ref) => !opts.ignore.some((pattern) => minimatch(ref.target, pattern, { nonegate: true })),
      )
      .filter((ref) => !ignoredDomain(ref.target, opts.ignoreDomain))
      .map((ref) => ({ file, line: ref.line, url: ref.target })),
  );
  const results = await checkUrlOccurrences(occurrences, {
    timeout: Math.max(1, parseInt(opts.timeout, 10) || 5000),
    concurrency: Math.max(1, parseInt(opts.concurrency, 10) || 5),
    retries: Math.max(0, parseInt(opts.retry, 10) || 0),
    allowedStatuses: statusCodes(opts.allowedStatus, configured.allowedStatuses),
    headFallbackStatuses: statusCodes(opts.headFallbackStatus, configured.headFallbackStatuses),
    cache: opts.cache,
    cacheTtl: parsedCacheTtl,
  });
  results.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.url.localeCompare(b.url),
  );
  const shown = results.map((result) => ({
    ...result,
    file: outputPath(result.file, opts),
    ...(!opts.reportRedirects ? { redirected: undefined, finalUrl: undefined } : {}),
  }));
  const broken = shown.filter((result) => !result.ok);
  const payloadResults = opts.includeOk ? shown : broken;
  const summary = {
    type: "summary",
    files: files.length,
    total: shown.length,
    ok: shown.length - broken.length,
    broken: broken.length,
  };
  let payload: string;
  const outputFormat = format(opts);
  if (outputFormat === "json")
    payload = jsonPayload(
      "md check-urls",
      {
        ...(files.length === 1 ? { file: outputPath(files[0], opts) } : {}),
        files: files.length,
        total: shown.length,
        ok: shown.length - broken.length,
        broken: broken.length,
        results: shown,
      },
      opts,
      { exitCode: broken.length ? 2 : 0, summary: { total: shown.length, broken: broken.length } },
    ).trimEnd();
  else if (outputFormat === "jsonl")
    payload = [
      ...payloadResults.map((result) => JSON.stringify({ type: "result", ...result })),
      JSON.stringify(summary),
    ].join("\n");
  else if (outputFormat === "sarif") {
    const issues: Issue[] = broken.map((result) => ({
      file: result.file,
      line: result.line,
      checker: "external",
      message: `${result.url}: ${result.status ?? result.error ?? "request failed"}`,
    }));
    payload = formatSarif(issues);
  } else if (!shown.length) payload = `No external URLs found in ${files.length} file(s)`;
  else if (!payloadResults.length)
    payload = `All ${shown.length} URL(s) in ${files.length} file(s) are reachable`;
  else
    payload = [
      `${broken.length} broken URL(s) across ${files.length} file(s):`,
      ...payloadResults.map((result) => {
        const detail = result.error ? ` (${result.error})` : "";
        const redirect = opts.reportRedirects && result.redirected ? ` → ${result.finalUrl}` : "";
        return `  ${result.file}:L${result.line} [${result.status ?? "fail"}] ${result.url}${redirect}${detail}`;
      }),
    ].join("\n");
  (broken.length ? process.stderr : process.stdout).write(payload + "\n");
  if (broken.length) terminate(2);
}
