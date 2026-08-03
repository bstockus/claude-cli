import type { AgentProfile, AgentTarget, BundleRule, MappingQuality } from "../types.js";

/**
 * Version of the target-profile shape itself. Hand-owned; unrelated to the
 * semantic-release-managed package version. Bump only when the profile
 * structure changes in a way consumers must react to.
 */
export const PROFILE_SCHEMA_VERSION = "1";

export const PORTABLE_HOOK_EVENTS = [
  "session-start",
  "pre-tool-use",
  "post-tool-use",
  "stop",
] as const;
export type PortableHookEvent = (typeof PORTABLE_HOOK_EVENTS)[number];

export type ModelClass = "fast" | "balanced" | "capable" | "inherit";
export type ToolCapability = "read" | "write" | "shell" | "web";
export type RuleActivation = BundleRule["activation"];

/** MappingQuality plus the target-native pass-through case profiles need. */
export type FeatureSupport = MappingQuality | "native";

export const FEATURE_KEYS = [
  "skills",
  "agents",
  "rules",
  "hooks",
  "policies",
  "mcp",
  "assets",
  "placeholders",
  "native",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeatureProfile {
  /**
   * The best mapping quality this feature achieves on this target. Individual
   * occurrences may be worse — a malformed input or an unsupported output
   * profile is reported per-diagnostic — but never better, which is what the
   * conformance suite asserts.
   */
  support: FeatureSupport;
  /** Output profiles in which this feature is emitted at all. Read by the renderer. */
  profiles: AgentProfile[];
  /** One line; the machine-generated replacement for a free-text compatibility cell. */
  summary: string;
  /** Native surface, e.g. ".claude/rules/<name>.md". Documentation only. */
  surface: string | null;
  /** Diagnostic codes this target may emit for this feature. */
  diagnostics: string[];
}

/**
 * A POSIX path relative to `<output>/<target>/<profile>`.
 *
 * Grammar: `{name}` matches exactly one path segment, `*` matches part of one
 * segment, and `**` matches any remaining suffix including nothing.
 */
export interface OutputPattern {
  feature: FeatureKey | "manifest";
  pattern: string;
}

export interface NativeValidatorSpec {
  /** `{dir}` is substituted with the generated `<target>/<profile>` directory. */
  command: string[];
  readOnly: true;
  appliesTo: AgentProfile[];
}

export interface HostProfile {
  displayName: string;
  /** ISO date of the target documentation this profile was written against. */
  documentationRevision: string;
  /** Below this version the profile is known to be wrong. `null` when not recorded. */
  minimumVersion: string | null;
  /** Highest host version this profile was verified against. `null` when not recorded. */
  verifiedThrough: string | null;
  /** Declared for callers to run themselves. This CLI never executes it. */
  versionCommand: string[] | null;
  /** Declared for callers to run themselves. This CLI never executes it. */
  nativeValidator: NativeValidatorSpec | null;
}

export interface ManifestFieldProfile {
  name: string;
  required: boolean;
  support: FeatureSupport;
}

export interface ManifestProfile {
  /** Plugin manifest directory, or `null` when the target has no plugin manifest. */
  directory: string | null;
  file: string;
  fields: ManifestFieldProfile[];
}

export interface PluginRoots {
  skills: string;
  agents: string | null;
  hooks: string;
  assets: string;
  mcp: string | null;
}

export interface ProjectRoots {
  skills: string;
  agents: string | null;
  rules: string | null;
  policies: string | null;
  mcp: string | null;
  assets: string;
}

export interface PathProfile {
  plugin: PluginRoots;
  project: ProjectRoots;
  /** True when plugin skill directories are namespaced as `${bundle}-${skill}`. */
  namespacePluginSkills: boolean;
}

export interface PlaceholderProfile {
  /** `${BUNDLE_ROOT}` substitution per output profile. */
  bundleRoot: Record<AgentProfile, string>;
  /**
   * How `$ARGUMENTS` survives: `native` means the host substitutes it,
   * `advisory` appends a prose hint beside it, `prose` replaces it outright.
   */
  arguments: "native" | "advisory" | "prose";
  /** Root variables the target understands, for documentation and `agent specs`. */
  rootVariables: string[];
}

export interface HookProfile {
  /** Portable event to native name; `null` means the target cannot express it. */
  events: Record<PortableHookEvent, string | null>;
  /** `versioned` wraps handlers in `{ version: 1, hooks }`; `hooks` emits `{ hooks }`. */
  envelope: "hooks" | "versioned";
  /** `claude-nested` wraps handlers in `{ matcher, hooks: [...] }`; `flat` does not. */
  handlerShape: "claude-nested" | "flat";
  supportedProtocols: string[];
}

export interface ModelProfile {
  support: FeatureSupport;
  /** Semantic class to native model id; `null` means the target has no model field. */
  classes: Record<ModelClass, string | null>;
}

export interface ToolProfile {
  support: FeatureSupport;
  /** `null` means capability restriction is not expressible natively. */
  capabilities: Record<ToolCapability, string[]> | null;
}

export interface RuleProfile {
  exactActivation: RuleActivation[];
  /** Activations that render, but not faithfully. Everything else is unsupported. */
  approximateActivation: RuleActivation[];
  form: "mdc" | "markdown" | "aggregated-agents-md" | null;
}

/** Where a catalog entry's value comes from. */
export type MarketplaceFieldSource =
  | { from: "manifest"; field: string }
  | { from: "marketplace"; field: string }
  | { from: "computed"; value: "source" };

export interface MarketplaceEntryField {
  name: string;
  required: boolean;
  source: MarketplaceFieldSource;
}

export interface MarketplaceAssetRule {
  role: "icon" | "screenshot";
  required: boolean;
  extensions: string[];
  maxBytes: number | null;
}

/**
 * How a target's marketplace catalog is shaped.
 *
 * Catalog structure is tabular target behavior, so it belongs here rather than
 * in the packager — the same rule that keeps paths and hook events out of the
 * renderer. Optional on {@link TargetProfile} so adding it stays additive:
 * every shipped profile defines it, but a consumer that has not been updated
 * simply sees a new key rather than a changed shape.
 */
export interface MarketplaceProfile {
  /** Catalog location per distribution mode; `null` when the mode is unsupported. */
  catalog: Record<"repo" | "local", { directory: string; file: string } | null>;
  /** Top-level array key inside the catalog document. */
  entriesKey: string;
  entryFields: MarketplaceEntryField[];
  assets: MarketplaceAssetRule[];
  /** `{name}`, `{version}`, `{target}`, and `{profile}` are substituted. */
  archiveName: string;
}

export interface TargetProfile {
  schemaVersion: string;
  id: AgentTarget;
  host: HostProfile;
  /** Output profiles this target supports at all. */
  profiles: AgentProfile[];
  manifest: ManifestProfile;
  paths: PathProfile;
  placeholders: PlaceholderProfile;
  hooks: HookProfile;
  models: ModelProfile;
  tools: ToolProfile;
  rules: RuleProfile;
  outputs: Record<AgentProfile, OutputPattern[]>;
  features: Record<FeatureKey, FeatureProfile>;
  /** Catalog shape for `agent package`. Optional so adding it stayed additive. */
  marketplace?: MarketplaceProfile;
}

function segmentToSource(segment: string): string {
  if (segment === "**") return "(?:.+)?";
  let source = "";
  for (let index = 0; index < segment.length;) {
    const char = segment[index];
    if (char === "{") {
      const close = segment.indexOf("}", index);
      if (close !== -1) {
        source += "[^/]+";
        index = close + 1;
        continue;
      }
    }
    if (char === "*") {
      source += "[^/]*";
      index++;
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\?]/, "\\$&");
    index++;
  }
  return source;
}

/**
 * Compiles an {@link OutputPattern} into an anchored regular expression.
 * `**` is only meaningful as a whole trailing segment.
 */
export function outputPatternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map(segmentToSource)
    .join("/")
    // A trailing `/**` must also match the bare directory prefix.
    .replace(/\/\(\?:\.\+\)\?$/, "(?:/.+)?");
  return new RegExp(`^${source}$`);
}

/** True when `candidate` is described by one of the target's declared output patterns. */
export function describesPath(
  profile: TargetProfile,
  outputProfile: AgentProfile,
  candidate: string,
): boolean {
  return (profile.outputs[outputProfile] ?? []).some((entry) =>
    outputPatternToRegExp(entry.pattern).test(candidate),
  );
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseSemver(value: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compares two plain versions. Deliberately not a range grammar — profiles
 * record single bounds, so ordering is all that is needed.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) throw new Error(`Invalid version: ${left ? b : a}`);
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  // A prerelease sorts below the matching release.
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** Returns the reasons a profile is internally inconsistent; empty when valid. */
export function validateProfile(profile: TargetProfile): string[] {
  const problems: string[] = [];
  if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION)
    problems.push(
      `schemaVersion is '${profile.schemaVersion}', expected '${PROFILE_SCHEMA_VERSION}'`,
    );
  if (!profile.profiles.length) problems.push("declares no output profiles");
  for (const key of FEATURE_KEYS) {
    const feature = profile.features[key];
    if (!feature) {
      problems.push(`missing feature declaration '${key}'`);
      continue;
    }
    if (!feature.summary.trim()) problems.push(`feature '${key}' has an empty summary`);
    for (const code of feature.diagnostics)
      if (!/^AB\d{3}$/.test(code))
        problems.push(`feature '${key}' declares malformed diagnostic code '${code}'`);
    for (const outputProfile of feature.profiles)
      if (!profile.profiles.includes(outputProfile))
        problems.push(`feature '${key}' names unsupported output profile '${outputProfile}'`);
  }
  for (const outputProfile of profile.profiles) {
    const patterns = profile.outputs[outputProfile];
    if (!patterns?.length) {
      problems.push(`output profile '${outputProfile}' declares no output patterns`);
      continue;
    }
    for (const entry of patterns) {
      if (entry.pattern.startsWith("/") || entry.pattern.includes("\\"))
        problems.push(`output pattern '${entry.pattern}' is not a POSIX relative path`);
      if (entry.pattern.split("/").includes(".."))
        problems.push(`output pattern '${entry.pattern}' escapes the target root`);
    }
  }
  for (const version of [profile.host.minimumVersion, profile.host.verifiedThrough])
    if (version !== null && !parseSemver(version))
      problems.push(`host version '${version}' is not a valid semantic version`);
  if (
    profile.host.minimumVersion &&
    profile.host.verifiedThrough &&
    compareSemver(profile.host.minimumVersion, profile.host.verifiedThrough) > 0
  )
    problems.push("host minimumVersion is greater than verifiedThrough");
  return problems;
}
