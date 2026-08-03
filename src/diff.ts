import {
  extractCodeBlocks,
  extractTables,
  extractTasks,
  type MdCodeBlock,
  type MdHeading,
  type MdLink,
  type MdTable,
  type MdTask,
} from "./markdown-ast.js";
import { documentSections, frontmatterEndLine } from "./sections.js";
import { resolveLocalPath, splitLocalTarget } from "./link-target.js";
import type { FrontmatterResult, MarkdownDocument } from "./workspace.js";

export type DiffKind = "added" | "removed" | "changed" | "moved" | "renamed";
export type FrontmatterStatus = "missing" | "malformed" | "non-mapping" | "valid";

export interface HeadingChange {
  kind: DiffKind;
  oldText?: string;
  oldSlug?: string;
  oldLine?: number;
  oldDepth?: number;
  newText?: string;
  newSlug?: string;
  newLine?: number;
  newDepth?: number;
  /** The section body changed, independent of the heading itself. */
  bodyChanged?: boolean;
  /** Set only on a rename: matched by position, not by identity. */
  heuristic?: boolean;
  matchedBy?: "slug" | "text" | "position";
}

export interface FrontmatterChange {
  kind: DiffKind;
  /** Dotted path, or null for a whole-block status transition. */
  key: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  oldStatus?: FrontmatterStatus;
  newStatus?: FrontmatterStatus;
}

export interface LinkChange {
  kind: DiffKind;
  oldTarget?: string;
  newTarget?: string;
  /** Null for external and anchor-only references. */
  oldResolved?: string | null;
  newResolved?: string | null;
  oldLine?: number;
  newLine?: number;
  linkText?: string;
  /** Only the `#fragment` differs — the anchor-rot case. */
  fragmentChanged?: boolean;
}

export interface TaskChange {
  kind: DiffKind;
  text: string;
  oldLine?: number;
  newLine?: number;
  oldChecked?: boolean;
  newChecked?: boolean;
}

export interface CodeBlockChange {
  kind: DiffKind;
  oldLang?: string | null;
  newLang?: string | null;
  oldLine?: number;
  newLine?: number;
  langChanged?: boolean;
  contentChanged?: boolean;
  /** The block is a Mermaid diagram on either side. */
  mermaid?: boolean;
}

export interface TableChange {
  kind: DiffKind;
  oldLine?: number;
  newLine?: number;
  oldColumns?: number;
  newColumns?: number;
  oldRows?: number;
  newRows?: number;
  headersChanged?: boolean;
}

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "unchanged";

export interface FileDiff {
  file: string;
  /** Path at the base revision, when it differed. */
  oldPath?: string;
  status: FileStatus;
  /** Git similarity index for a rename, 0-100. */
  similarity?: number;
  headings: HeadingChange[];
  frontmatter: FrontmatterChange[];
  links: LinkChange[];
  tasks: TaskChange[];
  codeBlocks: CodeBlockChange[];
  tables: TableChange[];
  totals: {
    headings: number;
    frontmatter: number;
    links: number;
    tasks: number;
    codeBlocks: number;
    tables: number;
    changes: number;
  };
}

export interface DiffReport {
  mode: "files" | "revision";
  /** Revision mode: the revision as the user wrote it. */
  base?: string;
  /** Revision mode: the resolved commit, so a report says what it compared. */
  baseCommit?: string;
  /** Files mode. */
  from?: string;
  to?: string;
  files: FileDiff[];
  totals: {
    files: number;
    filesChanged: number;
    headings: number;
    frontmatter: number;
    links: number;
    tasks: number;
    codeBlocks: number;
    tables: number;
    /** Heading pairs the positional heuristic called renames. */
    heuristicRenames: number;
    /** Code-block changes whose language is Mermaid. */
    diagrams: number;
  };
}

/** Headings outside the frontmatter block, in document order. */
function realHeadings(document: MarkdownDocument): MdHeading[] {
  const end = frontmatterEndLine(document.content);
  return document.headings.filter((heading) => heading.line > end);
}

/** The nearest enclosing headings, shallowest first, as a text path. */
function parentPath(headings: readonly MdHeading[], index: number): string[] {
  const path: string[] = [];
  let depth = headings[index].depth;
  for (let previous = index - 1; previous >= 0 && depth > 1; previous--) {
    if (headings[previous].depth < depth) {
      path.unshift(headings[previous].text);
      depth = headings[previous].depth;
    }
  }
  return path;
}

/** Position among siblings: headings at the same depth under the same parent. */
function siblingOrdinal(headings: readonly MdHeading[], index: number): number {
  let ordinal = 0;
  for (let previous = index - 1; previous >= 0; previous--) {
    if (headings[previous].depth < headings[index].depth) break;
    if (headings[previous].depth === headings[index].depth) ordinal++;
  }
  return ordinal;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Body of the section a heading owns, with the heading line removed. */
function sectionBodies(document: MarkdownDocument): Map<number, string> {
  const bodies = new Map<number, string>();
  for (const section of documentSections(document)) {
    if (!section.heading) continue;
    const body = section.content.split("\n").slice(1).join("\n");
    bodies.set(section.heading.line, body.replace(/\r\n/g, "\n"));
  }
  return bodies;
}

interface HeadingPair {
  before: number;
  after: number;
  matchedBy: "slug" | "text" | "position";
}

/**
 * Pairs headings across two revisions, conservatively.
 *
 * Three passes, most certain first: exact slug, then exact normalized text
 * (which recovers a heading whose slug only shifted because a duplicate sibling
 * appeared or vanished), then a positional guess. The positional pass requires
 * the same depth, the same parent path, and the same position among siblings,
 * and is the only one that ever produces a "renamed" verdict.
 *
 * String similarity is deliberately not used. It is the classic source of
 * confident nonsense, and a wrong rename is worse than an honest add plus
 * remove.
 */
export function matchHeadings(
  before: readonly MdHeading[],
  after: readonly MdHeading[],
): { pairs: HeadingPair[]; removed: number[]; added: number[] } {
  const pairs: HeadingPair[] = [];
  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();

  const pass = (
    key: (headings: readonly MdHeading[], index: number) => string | undefined,
    matchedBy: "slug" | "text" | "position",
  ): void => {
    const index = new Map<string, number[]>();
    for (let position = 0; position < after.length; position++) {
      if (usedAfter.has(position)) continue;
      const value = key(after, position);
      if (value === undefined) continue;
      index.set(value, [...(index.get(value) ?? []), position]);
    }
    for (let position = 0; position < before.length; position++) {
      if (usedBefore.has(position)) continue;
      const value = key(before, position);
      if (value === undefined) continue;
      const candidates = index.get(value);
      const match = candidates?.find((candidate) => !usedAfter.has(candidate));
      if (match === undefined) continue;
      usedBefore.add(position);
      usedAfter.add(match);
      pairs.push({ before: position, after: match, matchedBy });
    }
  };

  pass((headings, index) => headings[index].slug, "slug");
  pass((headings, index) => normalize(headings[index].text), "text");
  // Segments are joined with a separator that cannot appear in heading text,
  // so a parent path of ["a", "b"] never collides with one of ["ab"].
  pass(
    (headings, index) =>
      `${headings[index].depth}\0${parentPath(headings, index).map(normalize).join("\0")}\0${siblingOrdinal(headings, index)}`,
    "position",
  );

  return {
    pairs: pairs.sort((a, b) => a.after - b.after || a.before - b.before),
    removed: before.map((_, index) => index).filter((index) => !usedBefore.has(index)),
    added: after.map((_, index) => index).filter((index) => !usedAfter.has(index)),
  };
}

function headingChanges(
  before: MarkdownDocument | null,
  after: MarkdownDocument | null,
): HeadingChange[] {
  const oldHeadings = before ? realHeadings(before) : [];
  const newHeadings = after ? realHeadings(after) : [];
  const oldBodies = before ? sectionBodies(before) : new Map<number, string>();
  const newBodies = after ? sectionBodies(after) : new Map<number, string>();
  const { pairs, removed, added } = matchHeadings(oldHeadings, newHeadings);
  const changes: HeadingChange[] = [];

  for (const pair of pairs) {
    const from = oldHeadings[pair.before];
    const to = newHeadings[pair.after];
    const bodyChanged = oldBodies.get(from.line) !== newBodies.get(to.line);
    const renamed = normalize(from.text) !== normalize(to.text);
    // Ordinal, not line: inserting a paragraph must not report every following
    // heading as moved.
    const moved = pair.before !== pair.after || from.depth !== to.depth;
    if (!renamed && !moved && !bodyChanged) continue;

    const kind: DiffKind = renamed ? "renamed" : moved ? "moved" : "changed";
    changes.push({
      kind,
      oldText: from.text,
      oldSlug: from.slug,
      oldLine: from.line,
      oldDepth: from.depth,
      newText: to.text,
      newSlug: to.slug,
      newLine: to.line,
      newDepth: to.depth,
      ...(bodyChanged ? { bodyChanged: true } : {}),
      ...(kind === "renamed" ? { heuristic: pair.matchedBy === "position" } : {}),
      matchedBy: pair.matchedBy,
    });
  }

  for (const index of removed) {
    const heading = oldHeadings[index];
    changes.push({
      kind: "removed",
      oldText: heading.text,
      oldSlug: heading.slug,
      oldLine: heading.line,
      oldDepth: heading.depth,
    });
  }
  for (const index of added) {
    const heading = newHeadings[index];
    changes.push({
      kind: "added",
      newText: heading.text,
      newSlug: heading.slug,
      newLine: heading.line,
      newDepth: heading.depth,
    });
  }
  return changes;
}

/** Flattens a mapping to dotted paths, treating arrays as leaves. */
function flatten(
  value: unknown,
  prefix = "",
  into = new Map<string, unknown>(),
): Map<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    if (prefix) into.set(prefix, value);
    return into;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    flatten(nested, prefix ? `${prefix}.${key}` : key, into);
  }
  return into;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function frontmatterChanges(
  before: FrontmatterResult | undefined,
  after: FrontmatterResult | undefined,
): FrontmatterChange[] {
  const oldStatus = before?.status;
  const newStatus = after?.status;
  if (before && after && oldStatus !== newStatus) {
    return [{ kind: "changed", key: null, oldStatus, newStatus }];
  }
  if (before?.status !== "valid" || after?.status !== "valid") return [];

  const oldFlat = flatten(before.data);
  const newFlat = flatten(after.data);
  const changes: FrontmatterChange[] = [];
  for (const [key, oldValue] of oldFlat) {
    if (!newFlat.has(key)) {
      changes.push({ kind: "removed", key, oldValue });
    } else if (!sameValue(oldValue, newFlat.get(key))) {
      changes.push({ kind: "changed", key, oldValue, newValue: newFlat.get(key) });
    }
  }
  for (const [key, newValue] of newFlat) {
    if (!oldFlat.has(key)) changes.push({ kind: "added", key, newValue });
  }
  // Byte comparison, never localeCompare: that is ICU-build and locale
  // dependent, so a differently configured runner would reorder the payload.
  return changes.sort((a, b) => {
    const left = a.key ?? "";
    const right = b.key ?? "";
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

interface ResolvedLink {
  reference: MdLink;
  resolved: string | null;
  fragment?: string;
  path: string;
}

function resolveLinks(document: MarkdownDocument, root: string): ResolvedLink[] {
  return document.references.map((reference) => {
    if (reference.isExternal || reference.isAnchorOnly) {
      return { reference, resolved: null, path: reference.target };
    }
    const parsed = splitLocalTarget(reference.target);
    return {
      reference,
      resolved: resolveLocalPath(document.path, parsed.path, root),
      ...(parsed.fragment === undefined ? {} : { fragment: parsed.fragment }),
      path: parsed.path,
    };
  });
}

/**
 * Pairs items across revisions by a sequence of keys, each tried in turn, in
 * order of appearance.
 *
 * There is deliberately no unconditional positional fallback. Pairing whatever
 * is left over by position invents a "changed" record out of an unrelated
 * removal and addition. Where a looser match is genuinely wanted — a code block
 * whose body was edited — it is expressed as a further key with its own guard,
 * so every pairing rule is visible here rather than implied.
 */
function pairByKeys<T>(
  before: readonly T[],
  after: readonly T[],
  keys: readonly ((item: T) => string)[],
): { pairs: Array<[number, number]>; removed: number[]; added: number[] } {
  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  const pairs: Array<[number, number]> = [];
  for (const key of keys) {
    for (let index = 0; index < before.length; index++) {
      if (usedBefore.has(index)) continue;
      const value = key(before[index]);
      const match = after.findIndex(
        (candidate, position) => !usedAfter.has(position) && key(candidate) === value,
      );
      if (match === -1) continue;
      usedBefore.add(index);
      usedAfter.add(match);
      pairs.push([index, match]);
    }
  }
  return {
    pairs: pairs.sort((a, b) => a[1] - b[1]),
    removed: before.map((_, index) => index).filter((index) => !usedBefore.has(index)),
    added: after.map((_, index) => index).filter((index) => !usedAfter.has(index)),
  };
}

function linkChanges(
  before: MarkdownDocument | null,
  after: MarkdownDocument | null,
  root: string,
): LinkChange[] {
  const oldLinks = before ? resolveLinks(before, root) : [];
  const newLinks = after ? resolveLinks(after, root) : [];
  // Link text is the stable identity when a target is repointed, which is the
  // change worth reporting. Links matching on neither text nor target stay a
  // removal plus an addition rather than being guessed into a "changed".
  const { pairs, removed, added } = pairByKeys(oldLinks, newLinks, [
    (link) => `${link.reference.linkText}\0${link.reference.target}`,
    (link) => link.reference.linkText,
    (link) => link.reference.target,
  ]);
  const changes: LinkChange[] = [];

  for (const [oldIndex, newIndex] of pairs) {
    const from = oldLinks[oldIndex];
    const to = newLinks[newIndex];
    if (from.reference.target === to.reference.target) continue;
    changes.push({
      kind: "changed",
      oldTarget: from.reference.target,
      newTarget: to.reference.target,
      oldResolved: from.resolved,
      newResolved: to.resolved,
      oldLine: from.reference.line,
      newLine: to.reference.line,
      linkText: to.reference.linkText,
      ...(from.path === to.path && from.fragment !== to.fragment ? { fragmentChanged: true } : {}),
    });
  }
  for (const index of removed) {
    changes.push({
      kind: "removed",
      oldTarget: oldLinks[index].reference.target,
      oldResolved: oldLinks[index].resolved,
      oldLine: oldLinks[index].reference.line,
      linkText: oldLinks[index].reference.linkText,
    });
  }
  for (const index of added) {
    changes.push({
      kind: "added",
      newTarget: newLinks[index].reference.target,
      newResolved: newLinks[index].resolved,
      newLine: newLinks[index].reference.line,
      linkText: newLinks[index].reference.linkText,
    });
  }
  return changes;
}

function taskChanges(
  before: MarkdownDocument | null,
  after: MarkdownDocument | null,
): TaskChange[] {
  const oldTasks: MdTask[] = before ? extractTasks(before.tree) : [];
  const newTasks: MdTask[] = after ? extractTasks(after.tree) : [];
  const { pairs, removed, added } = pairByKeys(oldTasks, newTasks, [
    (task) => normalize(task.text),
  ]);
  const changes: TaskChange[] = [];
  for (const [oldIndex, newIndex] of pairs) {
    const from = oldTasks[oldIndex];
    const to = newTasks[newIndex];
    if (from.checked === to.checked) continue;
    changes.push({
      kind: "changed",
      text: to.text,
      oldLine: from.line,
      newLine: to.line,
      oldChecked: from.checked,
      newChecked: to.checked,
    });
  }
  for (const index of removed) {
    changes.push({
      kind: "removed",
      text: oldTasks[index].text,
      oldLine: oldTasks[index].line,
      oldChecked: oldTasks[index].checked,
    });
  }
  for (const index of added) {
    changes.push({
      kind: "added",
      text: newTasks[index].text,
      newLine: newTasks[index].line,
      newChecked: newTasks[index].checked,
    });
  }
  return changes;
}

function codeBlockChanges(
  before: MarkdownDocument | null,
  after: MarkdownDocument | null,
): CodeBlockChange[] {
  const oldBlocks: MdCodeBlock[] = before ? extractCodeBlocks(before.tree) : [];
  const newBlocks: MdCodeBlock[] = after ? extractCodeBlocks(after.tree) : [];
  const { pairs, removed, added } = pairByKeys(oldBlocks, newBlocks, [
    (block) => `${block.lang ?? ""}\0${block.value}`,
    (block) => block.value,
    // Same language, body edited. Without this a rewritten block reads as a
    // removal plus an addition and the `contentChanged` signal is lost; the
    // language guard stops it pairing two unrelated fences.
    (block) => `lang\0${block.lang ?? ""}`,
  ]);
  const mermaid = (...langs: (string | null | undefined)[]): boolean =>
    langs.some((lang) => lang?.toLowerCase() === "mermaid");
  const changes: CodeBlockChange[] = [];

  for (const [oldIndex, newIndex] of pairs) {
    const from = oldBlocks[oldIndex];
    const to = newBlocks[newIndex];
    const langChanged = from.lang !== to.lang;
    const contentChanged = from.value !== to.value;
    if (!langChanged && !contentChanged) continue;
    changes.push({
      kind: "changed",
      oldLang: from.lang,
      newLang: to.lang,
      oldLine: from.line,
      newLine: to.line,
      ...(langChanged ? { langChanged: true } : {}),
      ...(contentChanged ? { contentChanged: true } : {}),
      ...(mermaid(from.lang, to.lang) ? { mermaid: true } : {}),
    });
  }
  for (const index of removed) {
    changes.push({
      kind: "removed",
      oldLang: oldBlocks[index].lang,
      oldLine: oldBlocks[index].line,
      ...(mermaid(oldBlocks[index].lang) ? { mermaid: true } : {}),
    });
  }
  for (const index of added) {
    changes.push({
      kind: "added",
      newLang: newBlocks[index].lang,
      newLine: newBlocks[index].line,
      ...(mermaid(newBlocks[index].lang) ? { mermaid: true } : {}),
    });
  }
  return changes;
}

function tableChanges(
  before: MarkdownDocument | null,
  after: MarkdownDocument | null,
): TableChange[] {
  const oldTables: MdTable[] = before ? extractTables(before.tree) : [];
  const newTables: MdTable[] = after ? extractTables(after.tree) : [];
  const { pairs, removed, added } = pairByKeys(oldTables, newTables, [
    (table) => table.headers.join("\0"),
    // Same shape, headers edited. The column count guards against pairing two
    // structurally unrelated tables.
    (table) => `columns\0${table.columns}`,
  ]);
  const changes: TableChange[] = [];
  for (const [oldIndex, newIndex] of pairs) {
    const from = oldTables[oldIndex];
    const to = newTables[newIndex];
    const headersChanged = from.headers.join("\0") !== to.headers.join("\0");
    if (from.columns === to.columns && from.rows === to.rows && !headersChanged) continue;
    changes.push({
      kind: "changed",
      oldLine: from.line,
      newLine: to.line,
      oldColumns: from.columns,
      newColumns: to.columns,
      oldRows: from.rows,
      newRows: to.rows,
      ...(headersChanged ? { headersChanged: true } : {}),
    });
  }
  for (const index of removed) {
    changes.push({
      kind: "removed",
      oldLine: oldTables[index].line,
      oldColumns: oldTables[index].columns,
      oldRows: oldTables[index].rows,
    });
  }
  for (const index of added) {
    changes.push({
      kind: "added",
      newLine: newTables[index].line,
      newColumns: newTables[index].columns,
      newRows: newTables[index].rows,
    });
  }
  return changes;
}

const KIND_ORDER: Record<DiffKind, number> = {
  added: 0,
  changed: 1,
  moved: 2,
  removed: 3,
  renamed: 4,
};

function sortChanges<T extends { kind: DiffKind; newLine?: number; oldLine?: number }>(
  changes: T[],
): T[] {
  return changes.sort(
    (a, b) =>
      (a.newLine ?? a.oldLine ?? 0) - (b.newLine ?? b.oldLine ?? 0) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}

export interface DiffOptions {
  /** Workspace root, for resolving link targets. */
  root: string;
  /** Path to show for the document. */
  file: string;
  oldPath?: string;
  similarity?: number;
}

/** Compares two revisions of one document. `null` means absent on that side. */
export function diffDocuments(
  before: MarkdownDocument | null,
  after: MarkdownDocument | null,
  options: DiffOptions,
): FileDiff {
  const headings = sortChanges(headingChanges(before, after));
  const frontmatter = frontmatterChanges(before?.frontmatter, after?.frontmatter);
  const links = sortChanges(linkChanges(before, after, options.root));
  const tasks = sortChanges(taskChanges(before, after));
  const codeBlocks = sortChanges(codeBlockChanges(before, after));
  const tables = sortChanges(tableChanges(before, after));

  const counts = {
    headings: headings.length,
    frontmatter: frontmatter.length,
    links: links.length,
    tasks: tasks.length,
    codeBlocks: codeBlocks.length,
    tables: tables.length,
  };
  const changes = Object.values(counts).reduce((total, count) => total + count, 0);

  let status: FileStatus = "unchanged";
  if (!before) status = "added";
  else if (!after) status = "removed";
  else if (options.oldPath && options.oldPath !== options.file) status = "renamed";
  else if (changes > 0) status = "modified";

  return {
    file: options.file,
    ...(options.oldPath && options.oldPath !== options.file ? { oldPath: options.oldPath } : {}),
    status,
    ...(options.similarity === undefined ? {} : { similarity: options.similarity }),
    headings,
    frontmatter,
    links,
    tasks,
    codeBlocks,
    tables,
    totals: { ...counts, changes },
  };
}

/** Rolls per-file diffs into a report. */
export function summarize(
  files: FileDiff[],
  head: Pick<DiffReport, "mode" | "base" | "baseCommit" | "from" | "to">,
): DiffReport {
  const sum = (pick: (file: FileDiff) => number): number =>
    files.reduce((total, file) => total + pick(file), 0);
  return {
    ...head,
    files,
    totals: {
      files: files.length,
      filesChanged: files.filter((file) => file.status !== "unchanged").length,
      headings: sum((file) => file.totals.headings),
      frontmatter: sum((file) => file.totals.frontmatter),
      links: sum((file) => file.totals.links),
      tasks: sum((file) => file.totals.tasks),
      codeBlocks: sum((file) => file.totals.codeBlocks),
      tables: sum((file) => file.totals.tables),
      heuristicRenames: sum(
        (file) => file.headings.filter((change) => change.heuristic === true).length,
      ),
      diagrams: sum((file) => file.codeBlocks.filter((change) => change.mermaid === true).length),
    },
  };
}
