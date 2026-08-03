export const TARGETS = ["claude-code", "codex", "cursor"] as const;
export type AgentTarget = (typeof TARGETS)[number];
export type AgentProfile = "plugin" | "project";
export type MappingQuality = "exact" | "approximate" | "unsupported";

export interface AgentDiagnostic {
  code: string;
  severity: "notice" | "warning" | "error";
  message: string;
  component?: string;
  path?: string;
  target?: AgentTarget;
  profile?: AgentProfile;
  quality: MappingQuality;
  remediation?: string;
}

export interface SourceFile {
  path: string;
  content: Buffer;
  mode: number;
}

export interface MarkdownComponent {
  name: string;
  description: string;
  path: string;
  metadata: Record<string, unknown>;
  body: string;
  files: SourceFile[];
}

export interface BundleRule extends MarkdownComponent {
  activation: "always" | "files" | "model" | "manual";
  globs: string[];
}

export interface AgentBundle {
  schemaVersion: string;
  name: string;
  version: string;
  description: string;
  root: string;
  legacy: boolean;
  manifest: Record<string, unknown>;
  skills: MarkdownComponent[];
  agents: MarkdownComponent[];
  rules: BundleRule[];
  hooks?: { path: string; value: Record<string, unknown> };
  hookFiles: SourceFile[];
  policies: Array<{ path: string; value: Record<string, unknown> }>;
  mcp?: { path: string; value: Record<string, unknown> };
  assets: SourceFile[];
  diagnostics: AgentDiagnostic[];
  graph: Record<string, string[]>;
}

export interface Artifact {
  path: string;
  content: Buffer;
  mode: number;
}

export type HostStatus = "unknown" | "unverified" | "below-minimum" | "verified" | "newer";

export interface HostReport {
  target: AgentTarget;
  /** The version supplied via `--host-version`, or `null` when none was given. */
  requested: string | null;
  minimumVersion: string | null;
  verifiedThrough: string | null;
  documentationRevision: string;
  status: HostStatus;
}

export interface DoctorReport {
  /** One row per selected target, present even when no host version is known. */
  hosts: HostReport[];
  /** Populated only when `--output` was given. */
  output?: { root: string; missing: string[]; changed: string[]; unmanaged: string[] };
  /** Rendered paths no target profile describes. */
  undeclared: Array<{ target: AgentTarget; profile: AgentProfile; path: string }>;
  /**
   * Reserved for evidence from a host's own validator. Always empty in this
   * release: `agent doctor` never spawns a process, so its result does not
   * depend on what happens to be installed.
   */
  native: never[];
}

export interface AgentResult {
  command: "convert" | "validate" | "inspect" | "compat" | "doctor" | "specs";
  ok: boolean;
  source?: string;
  targets: AgentTarget[];
  profiles?: AgentProfile[];
  artifacts: Array<{ path: string; bytes: number; mode: string }>;
  diagnostics: AgentDiagnostic[];
  bundle?: unknown;
  compatibility?: unknown;
  /** The full target conformance profiles, emitted by `agent specs`. */
  specs?: unknown;
  /** Conformance findings, emitted by `agent doctor`. */
  doctor?: DoctorReport;
  dryRun?: boolean;
  check?: boolean;
  stale?: boolean;
}

export function diagnostic(
  code: string,
  message: string,
  quality: MappingQuality,
  extra: Partial<AgentDiagnostic> = {},
): AgentDiagnostic {
  return {
    code,
    severity:
      quality === "unsupported" ? "warning" : quality === "approximate" ? "warning" : "notice",
    message,
    quality,
    ...extra,
  };
}
