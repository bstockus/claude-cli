import fs from "node:fs";
import path from "node:path";
import type {
  AgentBundle,
  AgentDiagnostic,
  AgentProfile,
  AgentTarget,
  Artifact,
} from "../types.js";
import { diagnostic } from "../types.js";
import { renderBundle } from "../render.js";
import { profileFor } from "../targets/index.js";
import type { RenderedTree, TestFailure } from "./assert.js";
import { TEST_CHECKS, countAssertions, evaluate } from "./assert.js";
import type { TestCase } from "./schema.js";
import { TEST_FILE_SCHEMA_VERSION, discoverTestFiles, parseTestFile } from "./schema.js";

export * from "./assert.js";
export * from "./schema.js";

/** One unmet expectation, located in the tree it was evaluated against. */
export interface TestCaseFailure extends TestFailure {
  target: AgentTarget;
  profile: AgentProfile;
}

export interface TestCaseResult {
  name: string;
  /** Test file the case came from, bundle-relative POSIX. */
  file: string;
  status: "passed" | "failed" | "skipped";
  /** The target and profile selection actually evaluated, after every filter. */
  targets: AgentTarget[];
  profiles: AgentProfile[];
  assertions: { total: number; passed: number; failed: number };
  failures: TestCaseFailure[];
  /** Why a case was skipped. Present only on `skipped`. */
  reason?: string;
}

export interface TestReport {
  /** The test-file format this release reads. */
  schemaVersion: string;
  /** Test files loaded, bundle-relative POSIX. */
  files: string[];
  /**
   * Assertion codes this run can report. Like `audit.checks`, this is what
   * distinguishes "every expectation held" from "nothing was expected".
   */
  checks: string[];
  counts: { cases: number; passed: number; failed: number; skipped: number; assertions: number };
  cases: TestCaseResult[];
  /**
   * Reserved for evidence from a host's own validator. Always empty: `agent
   * test` never spawns a process, so its result does not depend on what happens
   * to be installed. `agent specs` publishes the validator commands to run
   * yourself.
   */
  native: never[];
}

export interface RunTestsOptions {
  /** `--tests`: a file or directory, bundle-relative or absolute. */
  tests?: string;
  /** `--target`: intersected with each case's own selection. Empty means all. */
  targets: AgentTarget[];
  /** `--profile`: intersected with each case's own selection. */
  profiles: AgentProfile[];
  /** `--case`: exact names. Empty means every case. */
  cases: string[];
}

function posix(value: string): string {
  return value.split(path.sep).join("/");
}

function note(
  code: string,
  message: string,
  extra: Partial<AgentDiagnostic> = {},
): AgentDiagnostic {
  return diagnostic(code, message, "exact", extra);
}

function fail(
  code: string,
  message: string,
  extra: Partial<AgentDiagnostic> = {},
): AgentDiagnostic {
  return { ...diagnostic(code, message, "unsupported", extra), severity: "error" };
}

/**
 * Renders each `<target>/<profile>` combination at most once.
 *
 * Cases overlap heavily — a bundle typically asserts several things about the
 * same tree — and rendering is the expensive part, so the cache is what keeps a
 * large test file from re-rendering the bundle per assertion.
 */
class RenderCache {
  private readonly trees = new Map<string, RenderedTree>();

  constructor(private readonly bundle: AgentBundle) {}

  get(target: AgentTarget, profile: AgentProfile): RenderedTree {
    const key = `${target}/${profile}`;
    const cached = this.trees.get(key);
    if (cached) return cached;
    const rendered = renderBundle(this.bundle, [target], [profile]);
    const prefix = `${key}/`;
    const artifacts: Artifact[] = rendered.artifacts
      .filter((artifact) => artifact.path.startsWith(prefix))
      .map((artifact) => ({ ...artifact, path: artifact.path.slice(prefix.length) }));
    const tree: RenderedTree = { target, profile, artifacts, diagnostics: rendered.diagnostics };
    this.trees.set(key, tree);
    return tree;
  }

  /** Every parse and render diagnostic the evaluated trees reported. */
  forwarded(): AgentDiagnostic[] {
    return [...this.trees.values()].flatMap((tree) => tree.diagnostics);
  }
}

function loadCases(
  bundle: AgentBundle,
  override: string | undefined,
): { files: string[]; cases: TestCase[]; diagnostics: AgentDiagnostic[] } {
  const cases: TestCase[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const files: string[] = [];
  for (const file of discoverTestFiles(bundle.root, override)) {
    const relative = posix(path.relative(bundle.root, file)) || posix(file);
    files.push(relative);
    const parsed = parseTestFile(fs.readFileSync(file, "utf8"), relative);
    cases.push(...parsed.cases);
    diagnostics.push(...parsed.diagnostics);
  }
  return { files, cases, diagnostics };
}

/** The target and profile pairs a case is evaluated against, after every filter. */
function selection(
  testCase: TestCase,
  options: RunTestsOptions,
): Array<{ target: AgentTarget; profile: AgentProfile }> {
  const targets = options.targets.length
    ? testCase.targets.filter((target) => options.targets.includes(target))
    : testCase.targets;
  const pairs: Array<{ target: AgentTarget; profile: AgentProfile }> = [];
  for (const target of targets)
    for (const profile of testCase.profiles) {
      if (!options.profiles.includes(profile)) continue;
      // A target that does not support an output profile emits nothing for it,
      // so every path assertion would fail for a reason that is a property of
      // the target rather than of the bundle.
      if (!profileFor(target).profiles.includes(profile)) continue;
      pairs.push({ target, profile });
    }
  return pairs;
}

/**
 * Runs the contract tests stored with a bundle.
 *
 * Nothing here executes: every expectation is evaluated against the same
 * in-memory render `agent convert` would write.
 */
export function runTests(
  bundle: AgentBundle,
  options: RunTestsOptions,
): { report: TestReport; diagnostics: AgentDiagnostic[]; forwarded: AgentDiagnostic[] } {
  const loaded = loadCases(bundle, options.tests);
  const diagnostics: AgentDiagnostic[] = [...loaded.diagnostics];

  if (options.cases.length) {
    const known = new Set(loaded.cases.map((item) => item.name));
    const unknown = options.cases.filter((name) => !known.has(name));
    // A typo in CI must not read as "everything passed", so this is a usage
    // error rather than a run that selects nothing.
    if (unknown.length) throw new Error(`Unknown --case name(s): ${unknown.join(", ")}`);
  }

  const cache = new RenderCache(bundle);
  const results: TestCaseResult[] = [];
  for (const testCase of loaded.cases) {
    const selected = options.cases.length && !options.cases.includes(testCase.name);
    const pairs = selected ? [] : selection(testCase, options);
    if (!pairs.length) {
      const reason = selected
        ? "excluded by --case"
        : "no selected target and profile combination applies";
      results.push({
        name: testCase.name,
        file: testCase.file,
        status: "skipped",
        targets: [],
        profiles: [],
        // Zero rather than the declared count: nothing was evaluated, and
        // counting a skipped case's expectations would make `counts.assertions`
        // read as coverage the run never had.
        assertions: { total: 0, passed: 0, failed: 0 },
        failures: [],
        reason,
      });
      diagnostics.push(
        note("AB720", `Case '${testCase.name}' was skipped: ${reason}`, {
          path: testCase.file,
          component: testCase.name,
        }),
      );
      continue;
    }

    const failures: TestCaseFailure[] = [];
    for (const { target, profile } of pairs)
      for (const failure of evaluate(testCase.expect, cache.get(target, profile)))
        failures.push({ ...failure, target, profile });

    const total = countAssertions(testCase.expect) * pairs.length;
    results.push({
      name: testCase.name,
      file: testCase.file,
      status: failures.length ? "failed" : "passed",
      targets: [...new Set(pairs.map((pair) => pair.target))],
      profiles: [...new Set(pairs.map((pair) => pair.profile))],
      assertions: {
        total,
        // One expectation can yield more than one failure: a single
        // `maxSeverity` ceiling reports every diagnostic above it. So the
        // subtraction is clamped rather than allowed to go negative.
        passed: Math.max(total - failures.length, 0),
        failed: failures.length,
      },
      failures,
    });
    for (const failure of failures)
      diagnostics.push(
        fail(failure.code, `${testCase.name} [${failure.assertion}]: ${failure.message}`, {
          component: testCase.name,
          path: testCase.file,
          target: failure.target,
          profile: failure.profile,
          remediation: `Expected ${failure.expected}; found ${failure.actual}.`,
        }),
      );
  }

  if (!loaded.cases.length)
    diagnostics.push({
      ...diagnostic("AB701", "No test cases were found", "approximate", {
        path: options.tests ?? "tests",
        remediation:
          "Add tests/<name>.test.yaml to the bundle, or point --tests at the file that holds them.",
      }),
    });

  const report: TestReport = {
    schemaVersion: TEST_FILE_SCHEMA_VERSION,
    files: loaded.files,
    checks: [...TEST_CHECKS],
    counts: {
      cases: results.length,
      passed: results.filter((item) => item.status === "passed").length,
      failed: results.filter((item) => item.status === "failed").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      assertions: results.reduce((total, item) => total + item.assertions.total, 0),
    },
    cases: results,
    native: [],
  };
  return { report, diagnostics, forwarded: cache.forwarded() };
}
