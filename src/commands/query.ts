import path from "node:path";
import { extractCodeBlocks, extractTasks } from "../markdown-ast.js";
import { resolveLocalPath, splitLocalTarget } from "../link-target.js";
import { requireDirectory } from "../input.js";
import { outputPath, runtime } from "../runtime.js";
import { jsonPayload } from "../result.js";
import { nestedValue } from "../object-path.js";

type QueryKind =
  "links-to" | "duplicates" | "unused-assets" | "code-blocks" | "tasks" | "missing-h1";

interface QueryOptions {
  envelope?: boolean;
  format: string;
  include: string[];
  exclude: string[];
  target?: string;
  field: string;
  lang?: string;
  content: boolean;
  status: string;
  summary: boolean;
  assetExtension: string[];
}

interface QueryEnvelope {
  kind: QueryKind;
  directory: string;
  count: number;
  results: unknown[];
  summary?: Record<string, number>;
}

function primitive(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function duplicateResults(files: string[], field: string, opts: QueryOptions): unknown[] {
  if (!["title", "slug", "heading-slug"].includes(field) && !field.startsWith("frontmatter:")) {
    throw new Error("--field must be title, slug, heading-slug, or frontmatter:<key>");
  }
  const groups = new Map<string, { value: string; occurrences: object[] }>();
  const add = (value: string, file: string, line: number): void => {
    const key = value.toLocaleLowerCase();
    const group = groups.get(key) ?? { value, occurrences: [] };
    group.occurrences.push({ file: outputPath(file, opts), line });
    groups.set(key, group);
  };
  for (const file of files) {
    const document = runtime().workspace.document(file);
    if (field === "heading-slug") {
      for (const heading of document.headings) add(heading.slug, file, heading.line);
      continue;
    }
    const data = document.frontmatter.status === "valid" ? document.frontmatter.data : {};
    if (field === "title") {
      const frontmatterTitle = primitive(data.title);
      const heading = document.headings.find((item) => item.depth === 1);
      if (frontmatterTitle !== undefined) add(frontmatterTitle, file, 1);
      else if (heading) add(heading.text, file, heading.line);
      continue;
    }
    const key = field === "slug" ? "slug" : field.slice("frontmatter:".length);
    if (!key) throw new Error("frontmatter duplicate fields require a key");
    // `arrays: false` preserves this command's long-standing refusal to index
    // into a frontmatter list; `md frontmatter --key` allows it.
    const value = primitive(nestedValue(data, key, { arrays: false }));
    if (value !== undefined) add(value, file, 1);
  }
  return [...groups.values()]
    .filter((group) => group.occurrences.length > 1)
    .sort((a, b) => a.value.localeCompare(b.value));
}

function linksToResults(files: string[], target: string, opts: QueryOptions): unknown[] {
  const parsedTarget = splitLocalTarget(target);
  const targetFile = path.resolve(parsedTarget.path);
  const targetFragment = parsedTarget.fragment;
  const results: object[] = [];
  for (const file of files) {
    for (const reference of runtime().workspace.document(file).references) {
      if (reference.isExternal || reference.isAnchorOnly) continue;
      const parsed = splitLocalTarget(reference.target);
      const resolved = resolveLocalPath(file, parsed.path, runtime().workspace.root);
      if (resolved !== targetFile) continue;
      const fragment = parsed.fragment;
      if (targetFragment !== undefined && fragment !== targetFragment) continue;
      results.push({
        sourceFile: outputPath(file, opts),
        line: reference.line,
        linkText: reference.linkText,
        rawTarget: reference.target,
      });
    }
  }
  return results;
}

function unusedAssetResults(files: string[], directory: string, opts: QueryOptions): unknown[] {
  const referenced = new Set<string>();
  for (const file of files) {
    for (const reference of runtime().workspace.document(file).references) {
      if (reference.isExternal || reference.isAnchorOnly) continue;
      const target = splitLocalTarget(reference.target).path;
      referenced.add(resolveLocalPath(file, target, runtime().workspace.root));
    }
  }
  const extensions = opts.assetExtension.length
    ? opts.assetExtension
    : runtime().config.assets.extensions;
  return runtime()
    .workspace.assetFiles(directory, extensions, opts.exclude)
    .filter((file) => !referenced.has(file))
    .map((file) => ({ file: outputPath(file, opts), extension: path.extname(file).toLowerCase() }));
}

function codeBlockResults(files: string[], opts: QueryOptions): unknown[] {
  const groups = new Map<string, object[]>();
  for (const file of files) {
    for (const block of extractCodeBlocks(runtime().workspace.document(file).tree)) {
      const language = block.lang ?? "(none)";
      if (opts.lang && language !== opts.lang) continue;
      const occurrence = {
        file: outputPath(file, opts),
        line: block.line,
        endLine: block.endLine,
        ...(opts.content ? { content: block.value } : {}),
      };
      groups.set(language, [...(groups.get(language) ?? []), occurrence]);
    }
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, occurrences]) => ({ language, count: occurrences.length, occurrences }));
}

function taskResults(
  files: string[],
  opts: QueryOptions,
): { results: unknown[]; summary: Record<string, number>; count: number } {
  if (!["all", "done", "pending"].includes(opts.status)) {
    throw new Error("--status must be all, done, or pending");
  }
  const results: object[] = [];
  let done = 0;
  let pending = 0;
  let matched = 0;
  for (const file of files) {
    for (const task of extractTasks(runtime().workspace.document(file).tree)) {
      if (task.checked) done++;
      else pending++;
      if (opts.status === "done" && !task.checked) continue;
      if (opts.status === "pending" && task.checked) continue;
      matched++;
      if (!opts.summary) {
        results.push({
          file: outputPath(file, opts),
          line: task.line,
          checked: task.checked,
          text: task.text,
        });
      }
    }
  }
  return { results, summary: { total: done + pending, done, pending, matched }, count: matched };
}

function textOutput(envelope: QueryEnvelope, human: boolean): string {
  const heading = `${envelope.kind}: ${envelope.count} result(s) in ${envelope.directory}`;
  const lines = [human ? `\x1b[1m${heading}\x1b[0m` : heading];
  if (envelope.summary) {
    lines.push(
      `  total=${envelope.summary.total} done=${envelope.summary.done} pending=${envelope.summary.pending}`,
    );
  }
  for (const result of envelope.results) lines.push(`  ${JSON.stringify(result)}`);
  return lines.join("\n");
}

export async function queryAction(
  kindValue: string,
  directory: string,
  opts: QueryOptions,
): Promise<void> {
  const kinds: QueryKind[] = [
    "links-to",
    "duplicates",
    "unused-assets",
    "code-blocks",
    "tasks",
    "missing-h1",
  ];
  if (!kinds.includes(kindValue as QueryKind)) {
    throw new Error(`Unknown query kind: ${kindValue}`);
  }
  const kind = kindValue as QueryKind;
  const dir = requireDirectory(directory, opts);
  const files = runtime().workspace.markdownFiles(dir, {
    include: opts.include,
    exclude: opts.exclude,
  });
  let results: unknown[];
  let summary: Record<string, number> | undefined;
  let resultCount: number | undefined;
  if (kind === "links-to") {
    if (!opts.target) throw new Error("links-to requires --target <path[#heading]>");
    results = linksToResults(files, opts.target, opts);
  } else if (kind === "duplicates") {
    results = duplicateResults(files, opts.field, opts);
  } else if (kind === "unused-assets") {
    results = unusedAssetResults(files, dir, opts);
  } else if (kind === "code-blocks") {
    results = codeBlockResults(files, opts);
  } else if (kind === "tasks") {
    ({ results, summary, count: resultCount } = taskResults(files, opts));
  } else {
    results = files
      .filter(
        (file) =>
          !runtime()
            .workspace.document(file)
            .headings.some((heading) => heading.depth === 1),
      )
      .map((file) => ({ file: outputPath(file, opts) }));
  }
  const envelope: QueryEnvelope = {
    kind,
    directory: outputPath(dir, opts),
    count: resultCount ?? results.length,
    results,
    ...(summary ? { summary } : {}),
  };
  process.stdout.write(
    opts.format === "json"
      ? jsonPayload("md query", envelope, opts)
      : textOutput(envelope, opts.format === "human") + "\n",
  );
}
