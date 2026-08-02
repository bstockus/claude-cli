import fs from "node:fs";
import path from "node:path";
import { CommandExit, terminate } from "../command-result.js";
import { loadBundle } from "../agent/parser.js";
import { renderBundle } from "../agent/render.js";
import type {
  AgentBundle,
  AgentProfile,
  AgentResult,
  AgentTarget,
  Artifact,
} from "../agent/types.js";
import { TARGETS } from "../agent/types.js";

export interface AgentOptions {
  target?: string[];
  output?: string;
  profile?: string;
  strict?: boolean;
  force?: boolean;
  dryRun?: boolean;
  check?: boolean;
  format?: string;
}

export async function agentActionBoundary(
  command: AgentResult["command"],
  opts: AgentOptions,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof CommandExit) throw error;
    if (opts.format === "json") {
      const result: AgentResult = {
        command,
        ok: false,
        targets: (opts.target ?? []).filter((target): target is AgentTarget =>
          TARGETS.includes(target as AgentTarget),
        ),
        artifacts: [],
        diagnostics: [
          {
            code: "AB000",
            severity: "error",
            message: (error as Error).message,
            quality: "unsupported",
            remediation: "Correct the invocation, paths, or filesystem condition and retry.",
          },
        ],
      };
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      terminate(1);
    }
    throw error;
  }
}

export function resolveTargets(values: string[] | undefined, required = false): AgentTarget[] {
  const raw = values ?? [];
  if (required && raw.length === 0) throw new Error("At least one --target is required");
  const expanded = raw.includes("all") ? [...TARGETS] : raw;
  const unknown = expanded.filter((value) => !TARGETS.includes(value as AgentTarget));
  if (unknown.length) throw new Error(`Unknown target(s): ${unknown.join(", ")}`);
  return [...new Set(expanded)] as AgentTarget[];
}

function profiles(value: string | undefined): AgentProfile[] {
  if (!value || value === "both") return ["plugin", "project"];
  if (value === "plugin" || value === "project") return [value];
  throw new Error(`Unknown profile: ${value}`);
}

function formatResult(result: AgentResult, format: string | undefined): string {
  if (format && !["llm", "human", "json"].includes(format))
    throw new Error(`Invalid output format: ${format}`);
  if (format === "json") return JSON.stringify(result, null, 2) + "\n";
  const lines = [`${result.command}: ${result.ok ? "ok" : "findings"}`];
  if (result.source) lines.push(`source: ${result.source}`);
  if (result.targets.length) lines.push(`targets: ${result.targets.join(", ")}`);
  if (result.profiles) lines.push(`profiles: ${result.profiles.join(", ")}`);
  if (result.artifacts.length) lines.push(`artifacts: ${result.artifacts.length}`);
  if (result.dryRun) lines.push("dry run: no files written");
  if (result.check) lines.push(`check: ${result.stale ? "stale" : "current"}`);
  if (result.bundle) lines.push("", JSON.stringify(result.bundle, null, 2));
  if (result.compatibility) lines.push("", JSON.stringify(result.compatibility, null, 2));
  if (result.diagnostics.length) {
    lines.push("", "diagnostics:");
    for (const item of result.diagnostics) {
      const location = [item.target, item.profile, item.component, item.path]
        .filter(Boolean)
        .join("/");
      lines.push(
        `- ${item.severity} ${item.code} [${item.quality}]${location ? ` ${location}:` : ":"} ${item.message}${item.remediation ? ` Remediation: ${item.remediation}` : ""}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

function artifactInfo(artifacts: Artifact[]): AgentResult["artifacts"] {
  return artifacts.map((item) => ({
    path: item.path,
    bytes: item.content.length,
    mode: `0${item.mode.toString(8)}`,
  }));
}

function hasFindings(result: AgentResult, strict = false): boolean {
  return (
    result.stale === true ||
    result.diagnostics.some(
      (item) =>
        item.severity === "error" ||
        item.quality === "unsupported" ||
        item.quality === "approximate" ||
        (strict && item.severity === "warning"),
    )
  );
}

function outputResult(result: AgentResult, opts: AgentOptions): void {
  result.ok = !hasFindings(result, Boolean(opts.strict));
  process.stdout.write(formatResult(result, opts.format));
  if (!result.ok) terminate(2);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveThroughExistingAncestors(candidate: string): string {
  let existing = candidate;
  while (!fs.existsSync(existing) && existing !== path.dirname(existing))
    existing = path.dirname(existing);
  return path.resolve(fs.realpathSync(existing), path.relative(existing, candidate));
}

function compareOutput(
  output: string,
  artifacts: Artifact[],
  targets: AgentTarget[],
  selectedProfiles: AgentProfile[],
): boolean {
  const expected = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  for (const artifact of artifacts) {
    const file = path.join(output, artifact.path);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    if (
      !fs.readFileSync(file).equals(artifact.content) ||
      (fs.statSync(file).mode & 0o777) !== artifact.mode
    )
      return false;
  }
  for (const target of targets)
    for (const profile of selectedProfiles) {
      const root = path.join(output, target, profile);
      if (!fs.existsSync(root)) return false;
      const walk = (directory: string): boolean =>
        fs.readdirSync(directory, { withFileTypes: true }).every((entry) => {
          const full = path.join(directory, entry.name);
          return entry.isDirectory()
            ? walk(full)
            : expected.has(path.relative(output, full).split(path.sep).join("/"));
        });
      if (!walk(root)) return false;
    }
  return true;
}

function nonempty(directory: string): boolean {
  if (!fs.existsSync(directory)) return false;
  return !fs.statSync(directory).isDirectory() || fs.readdirSync(directory).length > 0;
}

function writeAtomically(
  output: string,
  artifacts: Artifact[],
  targets: AgentTarget[],
  selectedProfiles: AgentProfile[],
  force: boolean,
): void {
  for (const target of targets)
    for (const profile of selectedProfiles) {
      const destination = path.join(output, target, profile);
      if (nonempty(destination) && !force)
        throw new Error(`Destination is nonempty: ${destination} (use --force)`);
    }
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(output)}.staging-`));
  try {
    for (const artifact of artifacts) {
      const destination = path.join(staging, artifact.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, artifact.content, { mode: artifact.mode });
      fs.chmodSync(destination, artifact.mode);
    }
    fs.mkdirSync(output, { recursive: true });
    for (const target of targets)
      for (const profile of selectedProfiles) {
        const destination = path.join(output, target, profile);
        const staged = path.join(staging, target, profile);
        if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (fs.existsSync(staged)) fs.renameSync(staged, destination);
        else fs.mkdirSync(destination, { recursive: true });
      }
    const report = path.join(output, "conversion-report.json");
    if (fs.existsSync(report)) fs.rmSync(report);
    fs.renameSync(path.join(staging, "conversion-report.json"), report);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function publicBundle(bundle: AgentBundle): unknown {
  return {
    schemaVersion: bundle.schemaVersion,
    name: bundle.name,
    version: bundle.version,
    description: bundle.description,
    legacy: bundle.legacy,
    components: {
      skills: bundle.skills.map(({ name, description, path: source, metadata }) => ({
        name,
        description,
        source,
        metadata,
      })),
      agents: bundle.agents.map(({ name, description, path: source, metadata }) => ({
        name,
        description,
        source,
        metadata,
      })),
      rules: bundle.rules.map(
        ({ name, description, path: source, activation, globs, metadata }) => ({
          name,
          description,
          source,
          activation,
          globs,
          metadata,
        }),
      ),
      hooks: bundle.hooks,
      hookFiles: bundle.hookFiles.map((file) => file.path),
      policies: bundle.policies,
      mcp: bundle.mcp,
      assets: bundle.assets.map((asset) => asset.path),
    },
    graph: bundle.graph,
    targets: bundle.manifest.targets ?? {},
  };
}

export async function agentConvertAction(source: string, opts: AgentOptions): Promise<void> {
  const targets = resolveTargets(opts.target, true);
  const selectedProfiles = profiles(opts.profile);
  if (!opts.output) throw new Error("--output is required");
  if (opts.check && opts.dryRun) throw new Error("--check and --dry-run cannot be used together");
  const bundle = loadBundle(source);
  const output = path.resolve(opts.output);
  if (isInside(fs.realpathSync(bundle.root), resolveThroughExistingAncestors(output)))
    throw new Error("Output directory must not be inside the source tree");
  const rendered = renderBundle(bundle, targets, selectedProfiles);
  const report: AgentResult = {
    command: "convert",
    ok: true,
    source: bundle.root,
    targets,
    profiles: selectedProfiles,
    artifacts: artifactInfo(rendered.artifacts),
    diagnostics: rendered.diagnostics,
    dryRun: Boolean(opts.dryRun),
    check: Boolean(opts.check),
  };
  report.ok = !hasFindings(report, Boolean(opts.strict));
  const persistedReport: AgentResult = { ...report, dryRun: false, check: false };
  const reportArtifact: Artifact = {
    path: "conversion-report.json",
    content: Buffer.from(JSON.stringify(persistedReport, null, 2) + "\n"),
    mode: 0o644,
  };
  const artifacts = [...rendered.artifacts, reportArtifact];
  report.artifacts = artifactInfo(artifacts);
  if (opts.check) report.stale = !compareOutput(output, artifacts, targets, selectedProfiles);
  else if (!opts.dryRun) {
    const hardValidation = report.diagnostics.some((item) => item.severity === "error");
    const strictFailure =
      Boolean(opts.strict) && report.diagnostics.some((item) => item.quality !== "exact");
    if (!hardValidation && !strictFailure)
      writeAtomically(output, artifacts, targets, selectedProfiles, Boolean(opts.force));
  }
  outputResult(report, opts);
}

export async function agentValidateAction(source: string, opts: AgentOptions): Promise<void> {
  const targets = resolveTargets(opts.target);
  const bundle = loadBundle(source);
  const diagnostics = targets.length
    ? renderBundle(bundle, targets, ["plugin", "project"]).diagnostics
    : bundle.diagnostics;
  outputResult(
    { command: "validate", ok: true, source: bundle.root, targets, artifacts: [], diagnostics },
    opts,
  );
}

export async function agentInspectAction(source: string, opts: AgentOptions): Promise<void> {
  const bundle = loadBundle(source);
  outputResult(
    {
      command: "inspect",
      ok: true,
      source: bundle.root,
      targets: [],
      artifacts: [],
      diagnostics: bundle.diagnostics,
      bundle: publicBundle(bundle),
    },
    opts,
  );
}

export const COMPATIBILITY = {
  "claude-code": {
    skills: "exact",
    agents: "exact",
    hooks: "exact for portable events",
    rules: "project",
    policies: "project permissions",
    mcp: "exact",
  },
  codex: {
    skills: "exact",
    agents: "project only",
    hooks: "portable events",
    rules: "AGENTS.md project layer",
    policies: "project rules",
    mcp: "exact",
  },
  cursor: {
    skills: "namespaced in plugins",
    agents: "approximate model mapping",
    hooks: "camel-cased portable events",
    rules: ".cursor/rules/*.mdc",
    policies: "unsupported without hook override",
  },
};

export async function agentCompatAction(
  source: string | undefined,
  opts: AgentOptions,
): Promise<void> {
  const targets = resolveTargets(opts.target).length ? resolveTargets(opts.target) : [...TARGETS];
  if (!source) {
    outputResult(
      {
        command: "compat",
        ok: true,
        targets,
        artifacts: [],
        diagnostics: [],
        compatibility: Object.fromEntries(targets.map((target) => [target, COMPATIBILITY[target]])),
      },
      opts,
    );
    return;
  }
  const bundle = loadBundle(source);
  const rendered = renderBundle(bundle, targets, ["plugin", "project"]);
  outputResult(
    {
      command: "compat",
      ok: true,
      source: bundle.root,
      targets,
      artifacts: [],
      diagnostics: rendered.diagnostics,
      compatibility: Object.fromEntries(targets.map((target) => [target, COMPATIBILITY[target]])),
    },
    opts,
  );
}
