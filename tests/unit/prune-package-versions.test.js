import { describe, it, expect } from "vitest";
import { compareVersions, parseSemver, planPrune } from "../../scripts/prune-package-versions.js";

/** Shorthand: build the {id, name} shape the API returns. */
const v = (name, id = 0) => ({ id, name });

describe("parseSemver", () => {
  it("accepts plain, prefixed and build-tagged versions", () => {
    expect(parseSemver("1.2.3")).not.toBeNull();
    expect(parseSemver("v1.2.3")).not.toBeNull();
    expect(parseSemver("1.2.3-beta.1")).not.toBeNull();
    expect(parseSemver("1.2.3+build.9")).not.toBeNull();
  });

  it("rejects anything else", () => {
    expect(parseSemver("latest")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("sorts a prerelease below its final release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
  });

  it("throws rather than guessing at unparseable input", () => {
    expect(() => compareVersions("banana", "1.0.0")).toThrow();
  });
});

describe("planPrune", () => {
  it("keeps the newest N and removes the rest", () => {
    const versions = [v("1.0.0", 1), v("1.1.0", 2), v("1.0.3", 3), v("1.0.1", 4)];
    const { keep, remove } = planPrune(versions, 3);
    expect(keep.map((x) => x.name)).toEqual(["1.1.0", "1.0.3", "1.0.1"]);
    expect(remove.map((x) => x.name)).toEqual(["1.0.0"]);
  });

  it("orders by version, not by the order the API returned them", () => {
    const versions = [v("1.0.1"), v("2.0.0"), v("1.10.0"), v("1.9.0")];
    const { keep } = planPrune(versions, 2);
    expect(keep.map((x) => x.name)).toEqual(["2.0.0", "1.10.0"]);
  });

  it("removes nothing when the count is within the limit", () => {
    expect(planPrune([v("1.0.0"), v("1.1.0")], 3).remove).toEqual([]);
    expect(planPrune([v("1.0.0"), v("1.1.0"), v("1.2.0")], 3).remove).toEqual([]);
  });

  it("removes nothing from an empty package", () => {
    expect(planPrune([], 3)).toEqual({ keep: [], remove: [], unparseable: [] });
  });

  it("never deletes a version it cannot parse", () => {
    const versions = [v("1.0.0"), v("1.1.0"), v("1.2.0"), v("1.3.0"), v("weird-tag")];
    const { keep, remove, unparseable } = planPrune(versions, 3);
    expect(unparseable.map((x) => x.name)).toEqual(["weird-tag"]);
    expect(remove.map((x) => x.name)).toEqual(["1.0.0"]);
    expect(keep.map((x) => x.name)).toEqual(["1.3.0", "1.2.0", "1.1.0"]);
  });

  it("keeps a prerelease below its release when pruning", () => {
    const versions = [v("1.0.0"), v("1.0.0-rc.1"), v("0.9.0"), v("1.1.0")];
    const { keep, remove } = planPrune(versions, 2);
    expect(keep.map((x) => x.name)).toEqual(["1.1.0", "1.0.0"]);
    expect(remove.map((x) => x.name)).toEqual(["1.0.0-rc.1", "0.9.0"]);
  });

  it("preserves the id needed for deletion", () => {
    const { remove } = planPrune([v("1.0.0", 111), v("2.0.0", 222)], 1);
    expect(remove).toEqual([{ id: 111, name: "1.0.0" }]);
  });

  it("refuses a keep count that would delete everything", () => {
    expect(() => planPrune([v("1.0.0")], 0)).toThrow(/positive integer/);
    expect(() => planPrune([v("1.0.0")], -1)).toThrow(/positive integer/);
    expect(() => planPrune([v("1.0.0")], 1.5)).toThrow(/positive integer/);
  });
});
