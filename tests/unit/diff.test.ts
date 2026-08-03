import { describe, expect, it } from "vitest";
import { buildDocument, type MarkdownDocument } from "../../src/workspace.js";
import { diffDocuments, matchHeadings, summarize, type FileDiff } from "../../src/diff.js";
import { extractHeadings, parseMarkdown } from "../../src/markdown-ast.js";

const ROOT = "/workspace";

function document(content: string, name = "doc.md"): MarkdownDocument {
  return buildDocument(`${ROOT}/${name}`, content);
}

function diff(before: string, after: string): FileDiff {
  return diffDocuments(document(before), document(after), { root: ROOT, file: "doc.md" });
}

function headings(content: string) {
  return extractHeadings(parseMarkdown(content));
}

describe("matchHeadings", () => {
  it("pairs identical slugs first", () => {
    const before = headings("# One\n\n## Two\n");
    const after = headings("## Two\n\n# One\n");
    const { pairs, removed, added } = matchHeadings(before, after);
    expect(pairs.map((pair) => pair.matchedBy)).toEqual(["slug", "slug"]);
    expect(removed).toEqual([]);
    expect(added).toEqual([]);
  });

  it("falls back to text when a duplicate sibling shifts a slug", () => {
    // Adding a second "Notes" makes GithubSlugger append -1 to the later one,
    // so the surviving heading's slug moves even though nothing about it changed.
    const before = headings("# Notes\n");
    const after = headings("# Notes\n\n# Notes\n");
    const { pairs } = matchHeadings(before, after);
    expect(pairs[0].matchedBy).toBe("slug");
  });

  it("only guesses positionally when depth, parent, and ordinal all agree", () => {
    const before = headings("# Top\n\n## Alpha\n");
    const after = headings("# Top\n\n## Beta\n");
    const { pairs } = matchHeadings(before, after);
    expect(pairs.find((pair) => pair.matchedBy === "position")).toBeDefined();

    // Renaming the parent too moves Beta under a different parent, so Alpha and
    // Beta are no longer paired — only the two H1s are, which do share a
    // (empty) parent and an ordinal.
    const other = headings("# Other\n\n## Beta\n");
    const strict = matchHeadings(before, other);
    const alphaPaired = strict.pairs.some(
      (pair) => before[pair.before].text === "Alpha" && other[pair.after].text === "Beta",
    );
    expect(alphaPaired).toBe(false);
    expect(strict.removed.map((index) => before[index].text)).toEqual(["Alpha"]);
    expect(strict.added.map((index) => other[index].text)).toEqual(["Beta"]);
  });
});

describe("headings", () => {
  it("labels a positional rename as a heuristic", () => {
    const result = diff("# Top\n\n## Alpha\nbody\n", "# Top\n\n## Beta\nbody\n");
    const renamed = result.headings.find((change) => change.kind === "renamed")!;
    expect(renamed).toMatchObject({
      oldText: "Alpha",
      newText: "Beta",
      oldSlug: "alpha",
      newSlug: "beta",
      heuristic: true,
      matchedBy: "position",
    });
  });

  it("reports a move by ordinal, not by line", () => {
    // Inserting a paragraph shifts every following line but moves nothing.
    const result = diff("# A\nx\n\n# B\ny\n", "# A\nx\n\nextra\n\n# B\ny\n");
    expect(result.headings.filter((change) => change.kind === "moved")).toEqual([]);

    const reordered = diff("# A\nx\n\n# B\ny\n", "# B\ny\n\n# A\nx\n");
    expect(reordered.headings.filter((change) => change.kind === "moved")).toHaveLength(2);
  });

  it("reports a body change under an otherwise untouched heading", () => {
    const result = diff("# A\nold\n", "# A\nnew\n");
    expect(result.headings).toEqual([
      expect.objectContaining({ kind: "changed", newText: "A", bodyChanged: true }),
    ]);
  });

  it("treats a heading that both moved and was renamed as remove plus add", () => {
    // Conservative by design: the positional pass requires the same ordinal.
    const result = diff("# Top\n\n## Alpha\n\n## Gamma\n", "# Top\n\n## Gamma\n\n## Delta\n");
    const kinds = result.headings.map((change) => change.kind);
    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
  });

  it("ignores the phantom heading short frontmatter produces", () => {
    const result = diff("---\ntitle: X\n---\n# Real\n", "---\ntitle: Y\n---\n# Real\n");
    expect(result.headings).toEqual([]);
    expect(result.frontmatter).toEqual([
      { kind: "changed", key: "title", oldValue: "X", newValue: "Y" },
    ]);
  });
});

describe("frontmatter", () => {
  it("reports added, removed, and changed keys by dotted path", () => {
    const result = diff(
      "---\nowner: alice\nmeta:\n  a: 1\ndrop: yes\n---\n# T\n",
      "---\nowner: bob\nmeta:\n  a: 2\nadd: new\n---\n# T\n",
    );
    expect(result.frontmatter).toEqual([
      { kind: "added", key: "add", newValue: "new" },
      // YAML 1.2 keeps `yes` a string; only `true`/`false` are booleans.
      { kind: "removed", key: "drop", oldValue: "yes" },
      { kind: "changed", key: "meta.a", oldValue: 1, newValue: 2 },
      { kind: "changed", key: "owner", oldValue: "alice", newValue: "bob" },
    ]);
  });

  it("reports a status transition as a single whole-block change", () => {
    const result = diff("# T\n", "---\nowner: bob\n---\n# T\n");
    expect(result.frontmatter).toEqual([
      { kind: "changed", key: null, oldStatus: "missing", newStatus: "valid" },
    ]);
  });

  it("compares arrays as leaves", () => {
    const result = diff("---\ntags: [a, b]\n---\n# T\n", "---\ntags: [a, c]\n---\n# T\n");
    expect(result.frontmatter).toEqual([
      { kind: "changed", key: "tags", oldValue: ["a", "b"], newValue: ["a", "c"] },
    ]);
  });
});

describe("links", () => {
  it("reports a retargeted link, keeping both resolved paths", () => {
    const result = diff("# T\n\n[Guide](./old.md)\n", "# T\n\n[Guide](./sub/new.md)\n");
    expect(result.links).toEqual([
      expect.objectContaining({
        kind: "changed",
        oldTarget: "./old.md",
        newTarget: "./sub/new.md",
        oldResolved: `${ROOT}/old.md`,
        newResolved: `${ROOT}/sub/new.md`,
        linkText: "Guide",
      }),
    ]);
  });

  it("flags an anchor-only change, which is the rot a rename leaves behind", () => {
    const result = diff("# T\n\n[G](./x.md#old)\n", "# T\n\n[G](./x.md#new)\n");
    expect(result.links[0]).toMatchObject({ kind: "changed", fragmentChanged: true });
  });

  it("leaves unrelated links as a removal plus an addition, not a change", () => {
    const result = diff("# T\n\n[One](./a.md)\n", "# T\n\n[Two](./b.md)\n");
    expect(result.links.map((change) => change.kind).sort()).toEqual(["added", "removed"]);
  });

  it("records external references with a null resolved path", () => {
    const result = diff("# T\n", "# T\n\n[E](https://example.com)\n");
    expect(result.links[0]).toMatchObject({ kind: "added", newResolved: null });
  });
});

describe("tasks", () => {
  it("reports a state change", () => {
    const result = diff("# T\n\n- [ ] Wire cache\n", "# T\n\n- [x] Wire cache\n");
    expect(result.tasks).toEqual([
      expect.objectContaining({
        kind: "changed",
        text: "Wire cache",
        oldChecked: false,
        newChecked: true,
      }),
    ]);
  });

  it("treats edited task text as a removal plus an addition", () => {
    const result = diff("# T\n\n- [ ] Old wording\n", "# T\n\n- [ ] New wording\n");
    expect(result.tasks.map((change) => change.kind).sort()).toEqual(["added", "removed"]);
  });
});

describe("code blocks and diagrams", () => {
  it("reports a language change and a body change", () => {
    const lang = diff("# T\n\n```bash\nls\n```\n", "# T\n\n```sh\nls\n```\n");
    expect(lang.codeBlocks[0]).toMatchObject({
      kind: "changed",
      oldLang: "bash",
      newLang: "sh",
      langChanged: true,
    });

    const body = diff("# T\n\n```ts\nold();\n```\n", "# T\n\n```ts\nnew();\n```\n");
    expect(body.codeBlocks[0]).toMatchObject({ kind: "changed", contentChanged: true });
  });

  it("flags Mermaid fences as diagrams without a second extractor", () => {
    const result = diff("# T\n", "# T\n\n```mermaid\ngraph TD;\n```\n");
    expect(result.codeBlocks[0]).toMatchObject({ kind: "added", mermaid: true });
    expect(summarize([result], { mode: "files" }).totals.diagrams).toBe(1);
  });
});

describe("tables", () => {
  it("reports shape and header changes but never cell edits", () => {
    const same = diff(
      "# T\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
      "# T\n\n| a | b |\n| - | - |\n| 9 | 9 |\n",
    );
    expect(same.tables).toEqual([]);

    const headers = diff(
      "# T\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
      "# T\n\n| a | c |\n| - | - |\n| 1 | 2 |\n",
    );
    expect(headers.tables[0]).toMatchObject({ kind: "changed", headersChanged: true });
  });
});

describe("file status and totals", () => {
  it("reports an absent side as added or removed", () => {
    const added = diffDocuments(null, document("# New\n"), { root: ROOT, file: "doc.md" });
    expect(added.status).toBe("added");
    expect(added.headings).toEqual([expect.objectContaining({ kind: "added", newText: "New" })]);

    const removed = diffDocuments(document("# Old\n"), null, { root: ROOT, file: "doc.md" });
    expect(removed.status).toBe("removed");
  });

  it("reports an unchanged document as unchanged with zero totals", () => {
    const result = diff("# Same\nbody\n", "# Same\nbody\n");
    expect(result.status).toBe("unchanged");
    expect(result.totals.changes).toBe(0);
  });

  it("rolls per-file counts into the report, including the heuristic tally", () => {
    const renamed = diff("# Top\n\n## Alpha\n", "# Top\n\n## Beta\n");
    const report = summarize([renamed], { mode: "files", from: "a.md", to: "b.md" });
    expect(report.totals.filesChanged).toBe(1);
    expect(report.totals.heuristicRenames).toBe(1);
  });
});
