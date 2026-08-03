import { buildWorkspaceGraph, type GraphEdge, type WorkspaceGraph } from "./graph.js";
import {
  documentSections,
  frontmatterEndLine,
  matchSectionIndex,
  type DocumentSection,
} from "./sections.js";
import type { Workspace } from "./workspace.js";

export type ContextUnitKind = "frontmatter" | "preamble" | "section";
export type ContextDirection = "seed" | "link" | "backlink";

export interface ContextProvenance {
  /** Graph hops from the nearest seed; 0 for a seed. */
  distance: number;
  /** The document that pulled this one in. Absent at distance 0. */
  via?: string;
  /**
   * Line carrying the link. Absent at distance 0.
   *
   * The graph stores each edge's lines against its source, so this is a line in
   * `via` when `direction` is "link" and a line in *this* document when it is
   * "backlink" — the link points the other way.
   */
  viaLine?: number;
  direction: ContextDirection;
  reason: string;
}

export interface ContextUnit {
  /** `<file>#<slug>`, `<file>#frontmatter`, or `<file>#preamble`. */
  id: string;
  kind: ContextUnitKind;
  file: string;
  heading: string | null;
  slug: string | null;
  /** Heading depth; 0 for a preamble or frontmatter unit. */
  depth: number;
  startLine: number;
  endLine: number;
  /** UTF-8 bytes of `content`. */
  bytes: number;
  provenance: ContextProvenance;
  content: string;
}

export interface ContextOmission {
  id: string;
  file: string;
  heading: string | null;
  bytes: number;
  reason: "budget";
}

export interface ContextBrokenDependency {
  source: string;
  /** The link target as written. */
  target: string;
  /** The path it resolved to. */
  resolved: string;
  line: number;
}

export interface ContextBudgetReport {
  /** Null when no budget was set. */
  limitBytes: number | null;
  usedBytes: number;
  omittedBytes: number;
  /**
   * ceil(usedBytes / 4). A size signal, not a model tokenizer, and it never
   * gates inclusion — only bytes do.
   */
  tokenEstimate: number;
  truncated: boolean;
}

export interface ContextPack {
  seeds: string[];
  depth: number;
  backlinks: boolean;
  /** Documents contributing at least one included unit. */
  files: string[];
  units: ContextUnit[];
  omitted: ContextOmission[];
  broken: ContextBrokenDependency[];
  budget: ContextBudgetReport;
  totals: { files: number; units: number; bytes: number };
}

export interface ContextSeed {
  file: string;
  /** Restrict this seed to these positions in its section partition. */
  sections?: number[];
}

export interface ContextRequest {
  workspace: Workspace;
  /** In discovery order; the first seed listed is the first unit emitted. */
  seeds: ContextSeed[];
  /** Every document the traversal may reach. */
  files: string[];
  depth: number;
  backlinks: boolean;
  frontmatter: boolean;
  /** 0 means unlimited. */
  budgetBytes: number;
  /** Renders an absolute path for output. */
  path: (file: string) => string;
}

interface Selection {
  file: string;
  distance: number;
  via?: string;
  viaLine?: number;
  direction: ContextDirection;
  sections?: number[];
}

/**
 * The descendants of `sections[index]` in a flat partition: every following
 * section deeper than it, stopping at the first that is not.
 */
export function descendantSections(sections: readonly DocumentSection[], index: number): number[] {
  const found: number[] = [];
  for (let next = index + 1; next < sections.length; next++) {
    if (sections[next].depth <= sections[index].depth) break;
    found.push(next);
  }
  return found;
}

/** Positions a `--section` name selects, including descendants when asked. */
export function selectSections(
  sections: readonly DocumentSection[],
  heading: string,
  children: boolean,
): number[] {
  const index = matchSectionIndex(sections, heading);
  if (index === -1) return [];
  return children ? [index, ...descendantSections(sections, index)] : [index];
}

function edgeIndexes(edges: readonly GraphEdge[]): {
  forward: Map<string, GraphEdge[]>;
  inverse: Map<string, GraphEdge[]>;
} {
  const forward = new Map<string, GraphEdge[]>();
  const inverse = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const out = forward.get(edge.source) ?? [];
    out.push(edge);
    forward.set(edge.source, out);
    const back = inverse.get(edge.target) ?? [];
    back.push(edge);
    inverse.set(edge.target, back);
  }
  return { forward, inverse };
}

function reason(selection: Selection, shown: (file: string) => string): string {
  if (selection.direction === "seed") return "Requested as a seed";
  const via = shown(selection.via ?? "");
  const hops = `${selection.distance} hop(s) from a seed`;
  return selection.direction === "backlink"
    ? `Links to ${via} at line ${selection.viaLine ?? 0}, ${hops}`
    : `Linked to from ${via}:${selection.viaLine ?? 0}, ${hops}`;
}

/**
 * Breadth-first traversal of the reference graph from the seeds.
 *
 * The order is total and has no ties: graph distance, then the order a document
 * entered the frontier, then document order within it. Every input is a sorted
 * list, so the same workspace bytes always produce the same pack.
 */
function traverse(request: ContextRequest, graph: WorkspaceGraph): Selection[] {
  const { forward, inverse } = edgeIndexes(graph.edges);
  const order: Selection[] = [];
  const seen = new Set<string>();
  const add = (selection: Selection): boolean => {
    if (seen.has(selection.file)) return false;
    seen.add(selection.file);
    order.push(selection);
    return true;
  };

  for (const seed of request.seeds) {
    add({
      file: seed.file,
      distance: 0,
      direction: "seed",
      ...(seed.sections ? { sections: seed.sections } : {}),
    });
  }

  let frontier = order.map((selection) => selection.file);
  for (let distance = 1; distance <= request.depth && frontier.length; distance++) {
    const next: string[] = [];
    for (const file of frontier) {
      // Forward before backward, so a document reachable both ways records the
      // outbound link as its provenance.
      for (const edge of forward.get(file) ?? []) {
        if (
          add({
            file: edge.target,
            distance,
            via: file,
            viaLine: edge.lines[0],
            direction: "link",
          })
        ) {
          next.push(edge.target);
        }
      }
      if (!request.backlinks) continue;
      for (const edge of inverse.get(file) ?? []) {
        if (
          add({
            file: edge.source,
            distance,
            via: file,
            viaLine: edge.lines[0],
            direction: "backlink",
          })
        ) {
          next.push(edge.source);
        }
      }
    }
    frontier = next;
  }
  return order;
}

function unitsFor(
  selection: Selection,
  request: ContextRequest,
  shown: (file: string) => string,
): ContextUnit[] {
  const document = request.workspace.document(selection.file);
  const sections = documentSections(document);
  const file = shown(selection.file);
  const provenance: ContextProvenance = {
    distance: selection.distance,
    ...(selection.via === undefined ? {} : { via: shown(selection.via) }),
    ...(selection.viaLine === undefined ? {} : { viaLine: selection.viaLine }),
    direction: selection.direction,
    reason: reason(selection, shown),
  };
  const unit = (
    kind: ContextUnitKind,
    slug: string | null,
    heading: string | null,
    depth: number,
    startLine: number,
    endLine: number,
    content: string,
  ): ContextUnit => ({
    id: `${file}#${slug ?? kind}`,
    kind,
    file,
    heading,
    slug,
    depth,
    startLine,
    endLine,
    bytes: Buffer.byteLength(content, "utf8"),
    provenance,
    content,
  });

  const units: ContextUnit[] = [];
  const frontmatterEnd = frontmatterEndLine(document.content);
  if (request.frontmatter && frontmatterEnd > 0) {
    const content = document.content.split("\n").slice(0, frontmatterEnd).join("\n");
    units.push(unit("frontmatter", null, null, 0, 1, frontmatterEnd, content));
  }

  const chosen = selection.sections
    ? selection.sections.filter((index) => index < sections.length)
    : sections.map((_, index) => index);
  for (const index of [...chosen].sort((a, b) => a - b)) {
    const section = sections[index];
    units.push(
      unit(
        section.heading ? "section" : "preamble",
        section.heading?.slug ?? null,
        section.heading?.text ?? null,
        section.depth,
        section.startLine,
        section.endLine,
        section.content,
      ),
    );
  }
  return units;
}

export function buildContextPack(request: ContextRequest): ContextPack {
  const shown = request.path;
  const graph = buildWorkspaceGraph(request.workspace, request.files, []);
  const selections = traverse(request, graph);
  const ordered = selections.flatMap((selection) => unitsFor(selection, request, shown));

  // The pack is a prefix of the ordered units: the first unit that would exceed
  // the budget stops inclusion, and everything after it is omitted too. Skipping
  // an oversized unit and continuing would make the pack non-contiguous and make
  // its contents shift unpredictably under small edits.
  const limit = request.budgetBytes > 0 ? request.budgetBytes : null;
  const units: ContextUnit[] = [];
  const omitted: ContextOmission[] = [];
  let usedBytes = 0;
  let omittedBytes = 0;
  for (const unit of ordered) {
    if (limit !== null && (omitted.length > 0 || usedBytes + unit.bytes > limit)) {
      omitted.push({
        id: unit.id,
        file: unit.file,
        heading: unit.heading,
        bytes: unit.bytes,
        reason: "budget",
      });
      omittedBytes += unit.bytes;
      continue;
    }
    units.push(unit);
    usedBytes += unit.bytes;
  }

  const included = new Set(selections.map((selection) => selection.file));
  const files = [...new Set(units.map((unit) => unit.file))];
  const broken = graph.broken
    .filter((edge) => included.has(edge.source))
    .map((edge) => ({
      source: shown(edge.source),
      target: edge.target,
      resolved: shown(edge.resolved),
      line: edge.line,
    }));

  return {
    seeds: request.seeds.map((seed) => shown(seed.file)),
    depth: request.depth,
    backlinks: request.backlinks,
    files,
    units,
    omitted,
    broken,
    budget: {
      limitBytes: limit,
      usedBytes,
      omittedBytes,
      tokenEstimate: Math.ceil(usedBytes / 4),
      truncated: omitted.length > 0,
    },
    totals: { files: files.length, units: units.length, bytes: usedBytes },
  };
}
