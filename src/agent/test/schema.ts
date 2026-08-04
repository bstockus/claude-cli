import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentDiagnostic, AgentProfile, AgentTarget } from "../types.js";
import { diagnostic, TARGETS } from "../types.js";
import { knownKeys, object, optionalString, strings } from "../../config-schema.js";

/**
 * Version of the test-case file format itself.
 *
 * A fourth hand-owned version, alongside `CONTRACT_VERSION` (the command
 * contract surface), `PROFILE_SCHEMA_VERSION` (the target profile structure),
 * and the bundle `schemaVersion` (the manifest authors write). This one versions
 * the *assertions* authors write. Semantic-release does not touch it; bump it
 * only when an existing test file would mean something different.
 */
export const TEST_FILE_SCHEMA_VERSION = "1";

/** The directory `agent test` looks in when `--tests` is not given. */
export const DEFAULT_TESTS_ROOT = "tests";

/** Suffixes a discovered test file must carry. */
const TEST_FILE_SUFFIXES = [".test.yaml", ".test.yml"];

export const SEVERITIES = ["notice", "warning", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface FileExpectation {
  /** Rendered path, relative to `<target>/<profile>/`. */
  path: string;
  /** Octal file mode, spelled as in `artifacts[].mode`. */
  mode?: string;
  includes: string[];
  excludes: string[];
  /** JavaScript regular expression sources, tested against the whole file. */
  matches: string[];
}

export interface JsonExpectation {
  path: string;
  /** Recursive subset match: every key here must be present with this value. */
  contains: Record<string, unknown>;
}

export interface DiagnosticExpectation {
  includes: string[];
  excludes: string[];
  /** The worst severity the render may report. Absent means unconstrained. */
  maxSeverity?: Severity;
}

export interface DigestExpectation {
  /** Golden digest over every rendered artifact for the target and profile. */
  tree?: string;
  /** Golden digest per rendered file, keyed by rendered path. */
  files: Record<string, string>;
}

export interface CaseExpectations {
  paths: { present: string[]; absent: string[] };
  files: FileExpectation[];
  json: JsonExpectation[];
  diagnostics?: DiagnosticExpectation;
  digest?: DigestExpectation;
}

export interface TestCase {
  name: string;
  /** Test file the case was read from, bundle-relative where possible. */
  file: string;
  targets: AgentTarget[];
  profiles: AgentProfile[];
  expect: CaseExpectations;
}

const FILE_KEYS = new Set(["schemaVersion", "cases"]);
const CASE_KEYS = new Set(["name", "targets", "profiles", "expect"]);
const EXPECT_KEYS = new Set(["paths", "files", "json", "diagnostics", "digest"]);
const PATHS_KEYS = new Set(["present", "absent"]);
const FILE_EXPECT_KEYS = new Set(["path", "mode", "includes", "excludes", "matches"]);
const JSON_EXPECT_KEYS = new Set(["path", "contains"]);
const DIAGNOSTIC_KEYS = new Set(["includes", "excludes", "maxSeverity"]);
const DIGEST_KEYS = new Set(["tree", "files"]);

function invalid(message: string, file: string): AgentDiagnostic {
  return {
    ...diagnostic("AB700", message, "unsupported", {
      path: file,
      remediation: `Correct the test file; see the format for schemaVersion ${TEST_FILE_SCHEMA_VERSION}.`,
    }),
    severity: "error",
  };
}

function requiredString(value: unknown, name: string): string {
  const result = optionalString(value, name);
  if (result === undefined || !result.trim()) throw new Error(`${name} is required`);
  return result;
}

function parseTargets(value: unknown, name: string): AgentTarget[] {
  const raw = strings(value, name, [...TARGETS]);
  const unknown = raw.filter((item) => !TARGETS.includes(item as AgentTarget));
  if (unknown.length) throw new Error(`Unknown ${name}: ${unknown.join(", ")}`);
  return [...new Set(raw)] as AgentTarget[];
}

function parseProfiles(value: unknown, name: string): AgentProfile[] {
  const raw = strings(value, name, ["plugin", "project"]);
  const unknown = raw.filter((item) => item !== "plugin" && item !== "project");
  if (unknown.length) throw new Error(`Unknown ${name}: ${unknown.join(", ")}`);
  return [...new Set(raw)] as AgentProfile[];
}

function parseFileExpectation(value: unknown, name: string): FileExpectation {
  const entry = object(value, name);
  knownKeys(entry, FILE_EXPECT_KEYS, name);
  const mode = optionalString(entry.mode, `${name}.mode`);
  if (mode !== undefined && !/^0[0-7]{3}$/.test(mode))
    throw new Error(`${name}.mode must be a four-digit octal mode such as '0644'`);
  const matches = strings(entry.matches, `${name}.matches`, []);
  for (const source of matches) {
    try {
      new RegExp(source);
    } catch (error) {
      throw new Error(`${name}.matches has an invalid pattern: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
  return {
    path: requiredString(entry.path, `${name}.path`),
    ...(mode !== undefined ? { mode } : {}),
    includes: strings(entry.includes, `${name}.includes`, []),
    excludes: strings(entry.excludes, `${name}.excludes`, []),
    matches,
  };
}

function parseJsonExpectation(value: unknown, name: string): JsonExpectation {
  const entry = object(value, name);
  knownKeys(entry, JSON_EXPECT_KEYS, name);
  if (entry.contains === undefined) throw new Error(`${name}.contains is required`);
  return {
    path: requiredString(entry.path, `${name}.path`),
    contains: object(entry.contains, `${name}.contains`),
  };
}

function parseDiagnosticExpectation(value: unknown, name: string): DiagnosticExpectation {
  const entry = object(value, name);
  knownKeys(entry, DIAGNOSTIC_KEYS, name);
  const maxSeverity = optionalString(entry.maxSeverity, `${name}.maxSeverity`);
  if (maxSeverity !== undefined && !SEVERITIES.includes(maxSeverity as Severity))
    throw new Error(`${name}.maxSeverity must be one of: ${SEVERITIES.join(", ")}`);
  return {
    includes: strings(entry.includes, `${name}.includes`, []),
    excludes: strings(entry.excludes, `${name}.excludes`, []),
    ...(maxSeverity !== undefined ? { maxSeverity: maxSeverity as Severity } : {}),
  };
}

function parseDigestExpectation(value: unknown, name: string): DigestExpectation {
  const entry = object(value, name);
  knownKeys(entry, DIGEST_KEYS, name);
  const files = object(entry.files, `${name}.files`);
  const digests: Record<string, string> = {};
  for (const [file, digest] of Object.entries(files))
    digests[file] = requiredString(digest, `${name}.files['${file}']`);
  return {
    ...(entry.tree !== undefined ? { tree: requiredString(entry.tree, `${name}.tree`) } : {}),
    files: digests,
  };
}

function parseExpectations(value: unknown, name: string): CaseExpectations {
  const entry = object(value, name);
  knownKeys(entry, EXPECT_KEYS, name);
  const paths = object(entry.paths, `${name}.paths`);
  knownKeys(paths, PATHS_KEYS, `${name}.paths`);
  const files = entry.files === undefined ? [] : entry.files;
  if (!Array.isArray(files)) throw new Error(`${name}.files must be a list`);
  const json = entry.json === undefined ? [] : entry.json;
  if (!Array.isArray(json)) throw new Error(`${name}.json must be a list`);
  return {
    paths: {
      present: strings(paths.present, `${name}.paths.present`, []),
      absent: strings(paths.absent, `${name}.paths.absent`, []),
    },
    files: files.map((item, index) => parseFileExpectation(item, `${name}.files[${index}]`)),
    json: json.map((item, index) => parseJsonExpectation(item, `${name}.json[${index}]`)),
    ...(entry.diagnostics !== undefined
      ? { diagnostics: parseDiagnosticExpectation(entry.diagnostics, `${name}.diagnostics`) }
      : {}),
    ...(entry.digest !== undefined
      ? { digest: parseDigestExpectation(entry.digest, `${name}.digest`) }
      : {}),
  };
}

/**
 * Parses one test file into cases.
 *
 * Structural problems become `AB700` findings rather than throws, so one
 * malformed case does not hide every other case in the bundle — the same split
 * `src/agent/parser.ts` makes between unreadable input and invalid content. A
 * file whose YAML will not parse at all is the caller's error to raise.
 */
export function parseTestFile(
  content: string,
  file: string,
): { cases: TestCase[]; diagnostics: AgentDiagnostic[] } {
  const diagnostics: AgentDiagnostic[] = [];
  let document: Record<string, unknown>;
  try {
    document = object(parseYaml(content) ?? {}, "Test file");
    knownKeys(document, FILE_KEYS, "test file");
    const schemaVersion = optionalString(document.schemaVersion, "schemaVersion");
    if (schemaVersion === undefined) throw new Error("schemaVersion is required");
    if (schemaVersion !== TEST_FILE_SCHEMA_VERSION)
      throw new Error(
        `Unsupported test schemaVersion '${schemaVersion}'; this release reads '${TEST_FILE_SCHEMA_VERSION}'`,
      );
    if (document.cases !== undefined && !Array.isArray(document.cases))
      throw new Error("cases must be a list");
  } catch (error) {
    return { cases: [], diagnostics: [invalid(`${(error as Error).message}`, file)] };
  }

  const cases: TestCase[] = [];
  const seen = new Set<string>();
  for (const [index, item] of ((document.cases ?? []) as unknown[]).entries()) {
    const label = `cases[${index}]`;
    try {
      const entry = object(item, label);
      knownKeys(entry, CASE_KEYS, label);
      const name = requiredString(entry.name, `${label}.name`);
      // Names are how --case selects and how a failure is reported, so a
      // duplicate inside one file would make both unaddressable.
      if (seen.has(name)) throw new Error(`Duplicate case name '${name}'`);
      seen.add(name);
      cases.push({
        name,
        file,
        targets: parseTargets(entry.targets, `${label}.targets`),
        profiles: parseProfiles(entry.profiles, `${label}.profiles`),
        expect: parseExpectations(entry.expect, `${label}.expect`),
      });
    } catch (error) {
      diagnostics.push(invalid(`${label}: ${(error as Error).message}`, file));
    }
  }
  return { cases, diagnostics };
}

function isTestFile(name: string): boolean {
  return TEST_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function walk(directory: string, results: string[]): void {
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    // Byte comparison rather than localeCompare: discovery order decides the
    // order cases are reported in, and an ICU-dependent sort would reorder a
    // payload between machines.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (entry.isFile() && isTestFile(entry.name)) results.push(full);
  }
}

/**
 * Test files for a bundle, in a stable order.
 *
 * With no override this is `<bundle>/tests/**\/*.test.yaml`, a convention rather
 * than a manifest key: that keeps schema 2 a strict superset of schema 1 and
 * lets a v1 or legacy bundle carry tests too. An explicit `--tests` path that
 * does not exist throws, because a typo there must not read as "no tests".
 */
export function discoverTestFiles(bundleRoot: string, override?: string): string[] {
  const root = override
    ? path.resolve(bundleRoot, override)
    : path.join(bundleRoot, DEFAULT_TESTS_ROOT);
  if (!fs.existsSync(root)) {
    if (override) throw new Error(`Test path does not exist: ${root}`);
    return [];
  }
  if (fs.statSync(root).isFile()) return [root];
  const results: string[] = [];
  walk(root, results);
  return results;
}
