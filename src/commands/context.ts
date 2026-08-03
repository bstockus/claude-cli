import path from "node:path";
import type { OutputFormat } from "../types.js";
import {
  buildContextPack,
  selectSections,
  type ContextPack,
  type ContextSeed,
} from "../context.js";
import { documentSections } from "../sections.js";
import { documentsReferencing } from "../backlinks.js";
import { splitLocalTarget } from "../link-target.js";
import { resolveMarkdownInputs } from "../input-selection.js";
import { outputPath, runtime } from "../runtime.js";
import { jsonPayload } from "../result.js";
import { boundedInteger } from "../option-utils.js";

interface ContextOptions {
  envelope?: boolean;
  format: string;
  paths?: string;
  depth: string;
  section: string[];
  target?: string;
  budget: string;
  backlinks: boolean;
  children: boolean;
  frontmatter: boolean;
  include: string[];
  exclude: string[];
}

function resolveFormat(opts: ContextOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

/**
 * Documents that reference `--target`, in workspace order.
 *
 * A fragment on the target narrows the match to references carrying that
 * anchor, which is the rule `md query links-to --target` already uses.
 */
function targetSeeds(target: string, files: string[]): string[] {
  const parsed = splitLocalTarget(target);
  const resolved = path.resolve(parsed.path);
  const references = documentsReferencing(files, resolved).filter(
    (reference) => parsed.fragment === undefined || reference.fragment === parsed.fragment,
  );
  return [...new Set(references.map((reference) => reference.sourceFile))];
}

function renderText(pack: ContextPack, human: boolean): string {
  const bold = (value: string) => (human ? `\x1b[1m${value}\x1b[0m` : value);
  const dim = (value: string) => (human ? `\x1b[2m${value}\x1b[0m` : value);
  const yellow = (value: string) => (human ? `\x1b[33m${value}\x1b[0m` : value);

  const lines = [
    bold(
      `# Context pack: ${pack.totals.files} document(s), ${pack.totals.units} unit(s), ` +
        `${pack.totals.bytes} bytes (~${pack.budget.tokenEstimate} tokens, estimate: bytes/4)`,
    ),
    bold("# Order: graph distance, then discovery order, then document order."),
  ];
  if (pack.budget.truncated) {
    lines.push(
      yellow(
        `# Truncated at ${pack.budget.limitBytes} bytes; ${pack.omitted.length} unit(s) omitted.`,
      ),
    );
  }

  for (const unit of pack.units) {
    const where = `${unit.id} (L${unit.startLine}-L${unit.endLine})`;
    const { distance, direction, via, viaLine } = unit.provenance;
    let origin = "seed";
    if (distance > 0) {
      // A backlink's line lives in this document, not in `via`, so it is worded
      // the other way round.
      origin =
        direction === "backlink"
          ? `distance ${distance}, links to ${via} at L${viaLine}`
          : `distance ${distance} via ${via}:${viaLine}`;
    }
    lines.push("", dim(`<!-- ${where} ${origin} -->`), unit.content.replace(/\n$/, ""));
  }

  if (pack.broken.length) {
    lines.push("", yellow(`# Broken dependencies (${pack.broken.length})`));
    for (const edge of pack.broken) {
      lines.push(`${edge.source}:${edge.line} -> ${edge.target}`);
    }
  }
  if (pack.omitted.length) {
    lines.push(
      "",
      yellow(`# Omitted for budget (${pack.omitted.length}, ${pack.budget.omittedBytes} bytes)`),
    );
    for (const omission of pack.omitted) {
      lines.push(`${omission.id} (${omission.bytes} bytes)`);
    }
  }
  return lines.join("\n");
}

export async function contextAction(seeds: string[], opts: ContextOptions): Promise<void> {
  const format = resolveFormat(opts);
  const depth = boundedInteger(opts.depth, "depth", 6);
  const budget = boundedInteger(opts.budget, "budget");
  if (seeds.includes("-")) throw new Error("md context does not accept stdin");
  if (!seeds.length && !opts.target) {
    throw new Error("md context requires at least one seed file or --target <path>");
  }

  const workspace = runtime().workspace;
  const files = workspace.markdownFiles(workspace.root, {
    include: opts.include,
    exclude: opts.exclude,
  });

  const seedFiles = seeds.length
    ? resolveMarkdownInputs(seeds, { include: opts.include, exclude: opts.exclude })
    : [];
  const fromTarget = opts.target ? targetSeeds(opts.target, files) : [];
  const ordered = [...new Set([...seedFiles, ...fromTarget])];
  if (!ordered.length) {
    throw new Error(
      opts.target && !seeds.length
        ? `No documents reference ${opts.target}`
        : "No documents matched the requested seeds",
    );
  }

  // `--section` restricts each seed to the named sections. A name matching
  // nothing anywhere is a usage error rather than a silently smaller pack.
  const resolvedSeeds: ContextSeed[] = [];
  const matched = new Set<string>();
  for (const file of ordered) {
    if (!opts.section.length) {
      resolvedSeeds.push({ file });
      continue;
    }
    const sections = documentSections(workspace.document(file));
    const chosen = new Set<number>();
    for (const heading of opts.section) {
      const indices = selectSections(sections, heading, opts.children);
      if (indices.length) matched.add(heading);
      for (const index of indices) chosen.add(index);
    }
    if (chosen.size) resolvedSeeds.push({ file, sections: [...chosen] });
  }
  for (const heading of opts.section) {
    if (!matched.has(heading)) throw new Error(`Heading not found in any seed: ${heading}`);
  }

  const pack = buildContextPack({
    workspace,
    seeds: resolvedSeeds,
    files,
    depth,
    backlinks: opts.backlinks,
    frontmatter: opts.frontmatter,
    budgetBytes: budget,
    path: (file) => outputPath(file, opts),
  });

  process.stdout.write(
    format === "json"
      ? jsonPayload("md context", pack, opts)
      : renderText(pack, format === "human") + "\n",
  );
}
