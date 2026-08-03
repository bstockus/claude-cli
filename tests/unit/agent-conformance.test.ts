import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "../../src/agent/parser.js";
import { renderBundle } from "../../src/agent/render.js";
import { TARGETS } from "../../src/agent/types.js";
import type { AgentProfile, AgentTarget } from "../../src/agent/types.js";
import { FEATURE_KEYS, describesPath, profileFor } from "../../src/agent/targets/index.js";
import type { FeatureSupport } from "../../src/agent/targets/index.js";

const fixtureRoot = path.resolve(
  fileURLToPath(new URL("../fixtures/agent/conformance", import.meta.url)),
);
const PROFILES: AgentProfile[] = ["plugin", "project"];

interface Expected {
  legacy: boolean;
  layouts: Record<string, string[]>;
  diagnostics: string[];
  executableModes: Record<string, string>;
  /** Overlay-sourced paths, prefixed `<target>/<profile>/`. Absent means none. */
  nativePaths?: string[];
}

const fixtures = fs
  .readdirSync(fixtureRoot)
  .filter((name) => fs.statSync(path.join(fixtureRoot, name)).isDirectory())
  .sort();

/** Best-to-worst ordering of mapping qualities. `native` is not comparable. */
const QUALITY_RANK: Record<string, number> = { exact: 2, approximate: 1, unsupported: 0 };

/** The best support any feature on this target claims for a diagnostic code. */
function declaredSupport(target: AgentTarget, code: string): FeatureSupport | undefined {
  const profile = profileFor(target);
  let best: FeatureSupport | undefined;
  for (const key of FEATURE_KEYS) {
    const feature = profile.features[key];
    if (!feature.diagnostics.includes(code)) continue;
    if (best === undefined || QUALITY_RANK[feature.support] > QUALITY_RANK[best])
      best = feature.support;
  }
  return best;
}

describe.each(fixtures)("conformance fixture: %s", (name) => {
  const bundleRoot = path.join(fixtureRoot, name, "bundle");
  const expected = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, name, "expected.json"), "utf8"),
  ) as Expected;

  it("parses at the expected schema layer", () => {
    expect(loadBundle(bundleRoot).legacy).toBe(expected.legacy);
  });

  it.each(TARGETS.flatMap((target) => PROFILES.map((profile) => [target, profile] as const)))(
    "renders the expected native layout for %s/%s",
    (target, profile) => {
      const { artifacts } = renderBundle(loadBundle(bundleRoot), [target], [profile]);
      const prefix = `${target}/${profile}/`;
      const paths = artifacts.map((artifact) => artifact.path.slice(prefix.length)).sort();
      expect(paths).toEqual(expected.layouts[`${target}/${profile}`]);
    },
  );

  it.each(TARGETS.flatMap((target) => PROFILES.map((profile) => [target, profile] as const)))(
    "emits only paths the %s/%s profile declares",
    (target, profile) => {
      // Legacy plugins place assets at the output root, which cannot be bounded
      // by target-relative patterns, so declared-path checking does not apply.
      if (expected.legacy) return;
      const { artifacts } = renderBundle(loadBundle(bundleRoot), [target], [profile]);
      const prefix = `${target}/${profile}/`;
      const undeclared = artifacts
        // Overlay paths are exempt: a native overlay exists precisely to emit
        // surfaces the portable profile does not describe.
        .filter((artifact) => artifact.origin !== "native")
        .map((artifact) => artifact.path.slice(prefix.length))
        .filter((candidate) => !describesPath(profileFor(target), profile, candidate));
      expect(undeclared).toEqual([]);
    },
  );

  it("emits exactly the expected diagnostic codes", () => {
    const { diagnostics } = renderBundle(loadBundle(bundleRoot), [...TARGETS], PROFILES);
    expect([...new Set(diagnostics.map((item) => item.code))].sort()).toEqual(expected.diagnostics);
  });

  it("declares every target mapping diagnostic it emits", () => {
    // AB3xx is the render/compat range: these are statements about what a
    // target can express, so a profile that does not list one is stale.
    const { diagnostics } = renderBundle(loadBundle(bundleRoot), [...TARGETS], PROFILES);
    const undeclared = diagnostics
      .filter((item) => item.target && /^AB3\d\d$/.test(item.code))
      .filter((item) => declaredSupport(item.target as AgentTarget, item.code) === undefined)
      .map((item) => `${item.target}:${item.code}`);
    expect([...new Set(undeclared)]).toEqual([]);
  });

  it("never emits a quality better than the declared feature support", () => {
    const { diagnostics } = renderBundle(loadBundle(bundleRoot), [...TARGETS], PROFILES);
    for (const item of diagnostics) {
      if (!item.target) continue;
      const support = declaredSupport(item.target, item.code);
      if (support === undefined || support === "native") continue;
      expect(
        QUALITY_RANK[item.quality],
        `${item.target} declares ${item.code} as at best '${support}' but emitted '${item.quality}'`,
      ).toBeLessThanOrEqual(QUALITY_RANK[support]);
    }
  });

  it("records overlay provenance on exactly the expected paths", () => {
    const { artifacts } = renderBundle(loadBundle(bundleRoot), [...TARGETS], PROFILES);
    const native = artifacts
      .filter((artifact) => artifact.origin === "native")
      .map((artifact) => artifact.path)
      .sort();
    expect(native).toEqual(expected.nativePaths ?? []);
  });

  it("preserves executable modes", () => {
    const { artifacts } = renderBundle(loadBundle(bundleRoot), [...TARGETS], PROFILES);
    const executable = Object.fromEntries(
      artifacts
        .filter((artifact) => (artifact.mode & 0o111) !== 0)
        .map((artifact) => [artifact.path, `0${artifact.mode.toString(8)}`]),
    );
    expect(executable).toEqual(expected.executableModes);
  });
});
