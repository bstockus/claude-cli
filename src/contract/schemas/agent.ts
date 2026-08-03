import { schemaUri } from "../version.js";
import type { SchemaEntry } from "../types.js";
import { DRAFT, stringArray } from "./shared.js";

const TARGETS = ["claude-code", "codex", "cursor"];
const PROFILES = ["plugin", "project"];

export const agentResultSchema: SchemaEntry = {
  id: "agent-result",
  uri: schemaUri("v1", "agent-result"),
  title: "Agent command result",
  commands: [
    "agent convert",
    "agent validate",
    "agent inspect",
    "agent compat",
    "agent doctor",
    "agent specs",
    "agent init",
    "agent add",
    "agent upgrade",
    "agent import",
    "agent package",
  ],
  schema: {
    $schema: DRAFT,
    $id: schemaUri("v1", "agent-result"),
    title: "Agent command result",
    description:
      "Shared by every agent subcommand, including the failure form: an invocation error emits ok=false with a single AB000 diagnostic and exits 1. All agent output goes to stdout, including failures.",
    type: "object",
    required: ["command", "ok", "targets", "artifacts", "diagnostics"],
    properties: {
      command: {
        enum: [
          "convert",
          "validate",
          "inspect",
          "compat",
          "doctor",
          "specs",
          "init",
          "add",
          "upgrade",
          "import",
          "package",
        ],
      },
      ok: { type: "boolean" },
      source: { type: "string", description: "Resolved bundle root, when one was given." },
      targets: { type: "array", items: { enum: TARGETS } },
      profiles: { type: "array", items: { enum: PROFILES } },
      artifacts: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "bytes", "mode"],
          properties: {
            path: { type: "string" },
            bytes: { type: "integer", minimum: 0 },
            mode: { type: "string", description: "Octal file mode, e.g. '0644'." },
            origin: {
              enum: ["portable", "native"],
              description:
                "Emitted only for artifacts contributed by a native overlay. Absent means portable.",
            },
          },
        },
      },
      diagnostics: { type: "array", items: { $ref: "#/$defs/diagnostic" } },
      bundle: { description: "The normalized bundle, emitted by `agent inspect`." },
      compatibility: {
        description: "Per-component summary keyed by target, emitted by `agent compat`.",
        type: "object",
        additionalProperties: { type: "object", additionalProperties: { type: "string" } },
      },
      specs: { description: "The target conformance profiles, emitted by `agent specs`." },
      doctor: { $ref: "#/$defs/doctor" },
      upgrade: {
        description: "Migration result, emitted by `agent upgrade`.",
        type: "object",
        required: ["from", "to", "changes", "notes"],
        properties: {
          from: {
            type: "string",
            description: "Source schema version, as the manifest spells it.",
          },
          to: { type: "string" },
          changes: {
            type: "array",
            items: {
              type: "object",
              required: ["field"],
              properties: {
                field: { type: "string" },
                from: { description: "Absent when the field is being added." },
                to: { description: "Absent when the field is being removed." },
              },
            },
          },
          notes: {
            description: "Items needing human judgment, mirrored as AB221 notices.",
            type: "array",
            items: { type: "string" },
          },
        },
      },
      package: {
        description: "Packaging result, emitted by `agent package`.",
        type: "object",
        required: ["catalogs", "archives", "checksums", "sbom", "checks"],
        properties: {
          catalogs: {
            type: "array",
            items: {
              type: "object",
              required: ["target", "profile", "path"],
              properties: {
                target: { enum: TARGETS },
                profile: { enum: PROFILES },
                path: { type: "string" },
              },
            },
          },
          archives: {
            type: "array",
            items: {
              type: "object",
              required: ["target", "profile", "path", "sha256", "bytes"],
              properties: {
                target: { enum: TARGETS },
                profile: { enum: PROFILES },
                path: { type: "string" },
                sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                bytes: { type: "integer", minimum: 0 },
              },
            },
          },
          checksums: { type: "string", description: "Path to the sha256sum-compatible file." },
          sbom: { type: "string", description: "Path to the file inventory." },
          checks: {
            type: "object",
            required: ["passed", "failed"],
            properties: {
              passed: { type: "integer", minimum: 0 },
              failed: { type: "integer", minimum: 0 },
            },
          },
        },
      },
      plan: {
        description:
          "What a writing command did or would do, emitted by `agent init` and `agent add`.",
        type: "object",
        required: ["root", "operations"],
        properties: {
          root: { type: "string" },
          operations: {
            type: "array",
            items: {
              type: "object",
              required: ["action", "path", "kind", "bytes", "mode"],
              properties: {
                action: { enum: ["create", "update", "skip"] },
                path: { type: "string", description: "POSIX path relative to `root`." },
                kind: { type: "string" },
                bytes: { type: "integer", minimum: 0 },
                mode: { type: "string", description: "Octal file mode, e.g. '0644'." },
                reason: { type: "string" },
              },
            },
          },
        },
      },
      dryRun: { type: "boolean" },
      check: { type: "boolean" },
      stale: { type: "boolean" },
    },
    $defs: {
      renderedPath: {
        type: "object",
        required: ["target", "profile", "path"],
        properties: {
          target: { enum: TARGETS },
          profile: { enum: PROFILES },
          path: { type: "string" },
        },
      },
      diagnostic: {
        type: "object",
        required: ["code", "severity", "message", "quality"],
        properties: {
          code: { type: "string", pattern: "^AB[0-9]{3}$" },
          severity: { enum: ["notice", "warning", "error"] },
          message: { type: "string" },
          quality: { enum: ["exact", "approximate", "unsupported"] },
          component: { type: "string" },
          path: { type: "string" },
          target: { enum: TARGETS },
          profile: { enum: PROFILES },
          remediation: { type: "string" },
        },
      },
      doctor: {
        type: "object",
        required: ["hosts", "undeclared", "native"],
        properties: {
          hosts: {
            type: "array",
            items: {
              type: "object",
              required: [
                "target",
                "requested",
                "minimumVersion",
                "verifiedThrough",
                "documentationRevision",
                "status",
              ],
              properties: {
                target: { enum: TARGETS },
                requested: { type: ["string", "null"] },
                minimumVersion: { type: ["string", "null"] },
                verifiedThrough: { type: ["string", "null"] },
                documentationRevision: { type: "string" },
                status: {
                  enum: ["unknown", "unverified", "below-minimum", "verified", "newer"],
                },
              },
            },
          },
          output: {
            description: "Present only when --output was given.",
            type: "object",
            required: ["root", "missing", "changed", "unmanaged"],
            properties: {
              root: { type: "string" },
              missing: stringArray,
              changed: stringArray,
              unmanaged: stringArray,
            },
          },
          undeclared: {
            type: "array",
            items: { $ref: "#/$defs/renderedPath" },
          },
          overlays: {
            description:
              "Paths contributed by a native overlay. Exempt from the declared-path check by design, so they are reported here rather than under `undeclared`.",
            type: "array",
            items: { $ref: "#/$defs/renderedPath" },
          },
          native: {
            type: "array",
            maxItems: 0,
            description:
              "Reserved for evidence from a host's own validator. Always empty: agent doctor never spawns a process.",
          },
        },
      },
    },
  },
};
