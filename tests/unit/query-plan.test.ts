import { describe, expect, it } from "vitest";
import { QueryUsageError, buildPlan, parseWhere, resolveField } from "../../src/query/plan.js";

function plan(kind: string, where: string[] = [], select: string[] = [], groupBy?: string) {
  return buildPlan({ kind, where, select, ...(groupBy ? { groupBy } : {}) });
}

describe("parseWhere", () => {
  it("classifies the four surface forms", () => {
    expect(parseWhere("documents", "frontmatter.status=published")).toMatchObject({
      type: "comparison",
      field: "frontmatter.status",
      operator: "=",
      value: "published",
      keyPath: "status",
    });
    expect(parseWhere("tasks", "status=pending")).toMatchObject({
      type: "comparison",
      operator: "=",
      operand: "pending",
    });
    expect(parseWhere("documents", "has:h1")).toMatchObject({
      type: "named",
      name: "has",
      argument: "h1",
      negated: false,
    });
    expect(parseWhere("documents", "links-to:docs/api.md")).toMatchObject({
      type: "named",
      name: "links-to",
      negated: false,
    });
  });

  it("reads a colon inside a value as a comparison, not a predicate name", () => {
    // The text before the first colon must be a valid name AND precede any
    // operator, or `target=https://x` would parse as a named predicate.
    expect(parseWhere("links", "target=https://example.com")).toMatchObject({
      type: "comparison",
      field: "target",
      value: "https://example.com",
    });
  });

  it("negates a named predicate with a leading bang", () => {
    expect(parseWhere("documents", "!has:h1")).toMatchObject({ negated: true, argument: "h1" });
  });

  it("picks the longest operator at a position", () => {
    expect(parseWhere("headings", "depth>=2")).toMatchObject({ operator: ">=", operand: 2 });
    expect(parseWhere("headings", "depth!=2")).toMatchObject({ operator: "!=", operand: 2 });
    expect(parseWhere("headings", "text~api")).toMatchObject({ operator: "~", value: "api" });
  });

  it("resolves links-to against the working directory", () => {
    const predicate = parseWhere("links", "links-to:docs/api.md#usage");
    expect(predicate).toMatchObject({ type: "named", name: "links-to" });
    if (predicate.type !== "named") throw new Error("expected a named predicate");
    expect(predicate.resolved?.path.endsWith("docs/api.md")).toBe(true);
    expect(predicate.resolved?.fragment).toBe("usage");
  });
});

describe("usage errors", () => {
  const cases: Array<[string, () => unknown, RegExp]> = [
    ["unknown entity", () => plan("nope", ["has:h1"]), /does not support composable options/],
    [
      "shortcut kind with a predicate",
      () => plan("duplicates", ["has:h1"]),
      /does not support composable options/,
    ],
    [
      "missing-h1 names its replacement",
      () => plan("missing-h1", ["has:h1"]),
      /md query documents --where '!has:h1'/,
    ],
    ["unknown field", () => parseWhere("documents", "nope=1"), /Unknown field for documents: nope/],
    [
      "unknown field in has",
      () => parseWhere("documents", "has:nope"),
      /Unknown field for documents/,
    ],
    [
      "links-to on an unsupported entity",
      () => parseWhere("headings", "links-to:x.md"),
      /links-to is not available on headings/,
    ],
    [
      "numeric operator on a string field",
      () => parseWhere("headings", "text>3"),
      /only valid on numeric fields/,
    ],
    [
      "non-boolean operand",
      () => parseWhere("tasks", "checked=maybe"),
      /boolean field; use true or false/,
    ],
    [
      "non-numeric operand",
      () => parseWhere("headings", "depth=deep"),
      /numeric field; deep is not/,
    ],
    ["empty predicate", () => parseWhere("documents", "  "), /--where needs a predicate/],
    ["frontmatter with no key", () => parseWhere("documents", "frontmatter.=x"), /need a key/],
    ["no operator at all", () => parseWhere("documents", "justtext"), /not a predicate/],
    [
      "unknown field in select",
      () => plan("documents", [], ["nope"]),
      /Unknown field for documents/,
    ],
    [
      "unknown field in group-by",
      () => plan("documents", [], [], "nope"),
      /Unknown field for documents/,
    ],
  ];

  it.each(cases)("rejects %s", (_label, run, message) => {
    expect(run).toThrow(QueryUsageError);
    expect(run).toThrow(message);
  });

  it("points a per-occurrence field on documents at the right entity", () => {
    // The sketch's `documents --select file,title,line` is a hidden join.
    expect(() => resolveField("documents", "line")).toThrow(/md query links --select file,line/);
  });
});

describe("buildPlan", () => {
  it("defaults the projection to the entity's default fields", () => {
    expect(plan("documents").select).toEqual(["file", "title"]);
    expect(plan("tasks").select).toEqual(["file", "line", "checked", "text"]);
    expect(plan("documents").selectExplicit).toBe(false);
  });

  it("merges repeated --select in order, de-duplicated", () => {
    const result = plan("headings", [], ["file,line", "line", "depth"]);
    expect(result.select).toEqual(["file", "line", "depth"]);
    expect(result.selectExplicit).toBe(true);
  });

  it("accepts a dynamic frontmatter field anywhere", () => {
    expect(() =>
      plan("tasks", ["frontmatter.owner=alice"], ["frontmatter.owner"], "frontmatter.owner"),
    ).not.toThrow();
  });

  it("allows any operator on an untyped frontmatter field", () => {
    // Untyped YAML cannot be validated at plan time; it simply does not match
    // at evaluation. That asymmetry with static fields is documented.
    expect(() => parseWhere("documents", "frontmatter.count>3")).not.toThrow();
  });

  it("conjoins repeated --where", () => {
    expect(plan("documents", ["has:h1", "words>10"]).predicates).toHaveLength(2);
  });
});
