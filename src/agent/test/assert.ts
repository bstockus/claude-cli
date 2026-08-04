import crypto from "node:crypto";
import type { AgentDiagnostic, AgentProfile, AgentTarget, Artifact } from "../types.js";
import { outputPatternToRegExp } from "../targets/schema.js";
import type { CaseExpectations, Severity } from "./schema.js";
import { SEVERITIES } from "./schema.js";

/** Codes every run evaluates, in the order the checks apply. */
export const TEST_CHECKS = ["AB710", "AB711", "AB712", "AB713", "AB714", "AB715"];

/** One unmet expectation, for one target and profile. */
export interface TestFailure {
  code: string;
  /** Which expectation failed, e.g. `paths.present` or `files[0].includes`. */
  assertion: string;
  message: string;
  expected: string;
  actual: string;
}

/** A rendered `<target>/<profile>` tree, with the prefix already stripped. */
export interface RenderedTree {
  target: AgentTarget;
  profile: AgentProfile;
  /** Artifacts keyed by path relative to `<target>/<profile>/`. */
  artifacts: Artifact[];
  diagnostics: AgentDiagnostic[];
}

export function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function byPath(a: Artifact, b: Artifact): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function octal(mode: number): string {
  return `0${mode.toString(8)}`;
}

/**
 * Golden digest over a rendered tree.
 *
 * The serialization is part of the command's contract — authors paste the value
 * into a test file — so it is spelled out here and in the documentation rather
 * than left as "whatever the hash function was fed". Artifacts are ordered by
 * byte comparison of path, never `localeCompare`, so the value cannot depend on
 * the ICU build of the machine that produced it.
 */
export function treeDigest(artifacts: Artifact[]): string {
  const lines = [...artifacts]
    .sort(byPath)
    .map((artifact) => `${artifact.path}\n${octal(artifact.mode)}\n${sha256(artifact.content)}\n`);
  return sha256(Buffer.from(lines.join(""), "utf8"));
}

function sameDigest(expected: string, actual: string): boolean {
  return expected.trim().toLowerCase() === actual.toLowerCase();
}

function find(tree: RenderedTree, file: string): Artifact | undefined {
  return tree.artifacts.find((artifact) => artifact.path === file);
}

function matching(tree: RenderedTree, pattern: string): string[] {
  const expression = outputPatternToRegExp(pattern);
  return tree.artifacts.filter((artifact) => expression.test(artifact.path)).map((a) => a.path);
}

/**
 * Recursive containment.
 *
 * An object matches when every expected key is present and matches; an array
 * matches when every expected element has a counterpart somewhere in the actual
 * array, order-independent; anything else must be strictly equal. That is what
 * `contains` means in a test file, and it is why asserting a manifest fragment
 * does not require restating the whole document.
 */
export function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.every((item) => actual.some((candidate) => contains(candidate, item)))
    );
  if (expected && typeof expected === "object")
    return (
      Boolean(actual) &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
        contains((actual as Record<string, unknown>)[key], value),
      )
    );
  return actual === expected;
}

function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

function checkPaths(expect: CaseExpectations, tree: RenderedTree): TestFailure[] {
  const failures: TestFailure[] = [];
  for (const pattern of expect.paths.present)
    if (!matching(tree, pattern).length)
      failures.push({
        code: "AB710",
        assertion: "paths.present",
        message: `No rendered path matches '${pattern}'`,
        expected: pattern,
        actual: "no match",
      });
  for (const pattern of expect.paths.absent) {
    const hits = matching(tree, pattern);
    if (hits.length)
      failures.push({
        code: "AB711",
        assertion: "paths.absent",
        message: `Rendered path '${hits[0]}' matches '${pattern}', which was expected to be absent`,
        expected: `no match for ${pattern}`,
        actual: hits.join(", "),
      });
  }
  return failures;
}

function checkFiles(expect: CaseExpectations, tree: RenderedTree): TestFailure[] {
  const failures: TestFailure[] = [];
  for (const [index, expectation] of expect.files.entries()) {
    const label = `files[${index}]`;
    const artifact = find(tree, expectation.path);
    if (!artifact) {
      failures.push({
        code: "AB712",
        assertion: `${label}.path`,
        message: `'${expectation.path}' was not rendered`,
        expected: expectation.path,
        actual: "not rendered",
      });
      continue;
    }
    if (expectation.mode !== undefined && expectation.mode !== octal(artifact.mode))
      failures.push({
        code: "AB712",
        assertion: `${label}.mode`,
        message: `'${expectation.path}' has mode ${octal(artifact.mode)}`,
        expected: expectation.mode,
        actual: octal(artifact.mode),
      });
    const text = artifact.content.toString("utf8");
    for (const needle of expectation.includes)
      if (!text.includes(needle))
        failures.push({
          code: "AB712",
          assertion: `${label}.includes`,
          message: `'${expectation.path}' does not contain the expected text`,
          expected: needle,
          actual: "absent",
        });
    for (const needle of expectation.excludes)
      if (text.includes(needle))
        failures.push({
          code: "AB712",
          assertion: `${label}.excludes`,
          message: `'${expectation.path}' contains text that was expected to be absent`,
          expected: `absent: ${needle}`,
          actual: needle,
        });
    for (const source of expectation.matches)
      if (!new RegExp(source).test(text))
        failures.push({
          code: "AB712",
          assertion: `${label}.matches`,
          message: `'${expectation.path}' does not match the expected pattern`,
          expected: source,
          actual: "no match",
        });
  }
  return failures;
}

function checkJson(expect: CaseExpectations, tree: RenderedTree): TestFailure[] {
  const failures: TestFailure[] = [];
  for (const [index, expectation] of expect.json.entries()) {
    const label = `json[${index}]`;
    const artifact = find(tree, expectation.path);
    if (!artifact) {
      failures.push({
        code: "AB713",
        assertion: `${label}.path`,
        message: `'${expectation.path}' was not rendered`,
        expected: expectation.path,
        actual: "not rendered",
      });
      continue;
    }
    let document: unknown;
    try {
      document = JSON.parse(artifact.content.toString("utf8"));
    } catch (error) {
      failures.push({
        code: "AB713",
        assertion: `${label}.path`,
        message: `'${expectation.path}' is not valid JSON: ${(error as Error).message}`,
        expected: "valid JSON",
        actual: "unparsable",
      });
      continue;
    }
    for (const [key, value] of Object.entries(expectation.contains))
      if (!contains((document as Record<string, unknown>)?.[key], value))
        failures.push({
          code: "AB713",
          assertion: `${label}.contains.${key}`,
          message: `'${expectation.path}' does not contain the expected value at '${key}'`,
          expected: JSON.stringify(value),
          actual: JSON.stringify((document as Record<string, unknown>)?.[key] ?? null),
        });
  }
  return failures;
}

function checkDiagnostics(expect: CaseExpectations, tree: RenderedTree): TestFailure[] {
  const expectation = expect.diagnostics;
  if (!expectation) return [];
  const failures: TestFailure[] = [];
  const codes = new Set(tree.diagnostics.map((item) => item.code));
  for (const code of expectation.includes)
    if (!codes.has(code))
      failures.push({
        code: "AB714",
        assertion: "diagnostics.includes",
        message: `Diagnostic ${code} was expected but not reported`,
        expected: code,
        actual: "not reported",
      });
  for (const code of expectation.excludes)
    if (codes.has(code))
      failures.push({
        code: "AB714",
        assertion: "diagnostics.excludes",
        message: `Diagnostic ${code} was reported but was expected to be absent`,
        expected: `absent: ${code}`,
        actual: code,
      });
  if (expectation.maxSeverity) {
    const ceiling = severityRank(expectation.maxSeverity);
    for (const item of tree.diagnostics)
      if (severityRank(item.severity) > ceiling)
        failures.push({
          code: "AB714",
          assertion: "diagnostics.maxSeverity",
          message: `${item.code} is ${item.severity}, above the expected ceiling`,
          expected: expectation.maxSeverity,
          actual: `${item.severity} (${item.code})`,
        });
  }
  return failures;
}

function checkDigests(expect: CaseExpectations, tree: RenderedTree): TestFailure[] {
  const expectation = expect.digest;
  if (!expectation) return [];
  const failures: TestFailure[] = [];
  if (expectation.tree !== undefined) {
    const actual = treeDigest(tree.artifacts);
    if (!sameDigest(expectation.tree, actual))
      failures.push({
        code: "AB715",
        assertion: "digest.tree",
        message: `The rendered tree digest changed`,
        expected: expectation.tree.trim(),
        actual,
      });
  }
  for (const [file, expected] of Object.entries(expectation.files)) {
    const artifact = find(tree, file);
    if (!artifact) {
      failures.push({
        code: "AB715",
        assertion: `digest.files['${file}']`,
        message: `'${file}' was not rendered`,
        expected: expected.trim(),
        actual: "not rendered",
      });
      continue;
    }
    const actual = sha256(artifact.content);
    if (!sameDigest(expected, actual))
      failures.push({
        code: "AB715",
        assertion: `digest.files['${file}']`,
        message: `'${file}' changed`,
        expected: expected.trim(),
        actual,
      });
  }
  return failures;
}

/** How many individual expectations a case states, for the assertion counts. */
export function countAssertions(expect: CaseExpectations): number {
  const files = expect.files.reduce(
    (total, item) =>
      total +
      (item.mode === undefined ? 0 : 1) +
      item.includes.length +
      item.excludes.length +
      item.matches.length,
    0,
  );
  const json = expect.json.reduce((total, item) => total + Object.keys(item.contains).length, 0);
  const diagnostics = expect.diagnostics
    ? expect.diagnostics.includes.length +
      expect.diagnostics.excludes.length +
      (expect.diagnostics.maxSeverity ? 1 : 0)
    : 0;
  const digest = expect.digest
    ? (expect.digest.tree === undefined ? 0 : 1) + Object.keys(expect.digest.files).length
    : 0;
  return (
    expect.paths.present.length + expect.paths.absent.length + files + json + diagnostics + digest
  );
}

/** Every expectation of a case, evaluated against one rendered tree. */
export function evaluate(expect: CaseExpectations, tree: RenderedTree): TestFailure[] {
  return [
    ...checkPaths(expect, tree),
    ...checkFiles(expect, tree),
    ...checkJson(expect, tree),
    ...checkDiagnostics(expect, tree),
    ...checkDigests(expect, tree),
  ];
}
