import { schemaUri } from "../version.js";
import type { SchemaEntry } from "../types.js";
import { DRAFT, stringArray } from "./shared.js";

export const checkUpdateSchema: SchemaEntry = {
  id: "check-update",
  uri: schemaUri("v1", "check-update"),
  title: "Update check result",
  commands: ["check-update"],
  schema: {
    $schema: DRAFT,
    $id: schemaUri("v1", "check-update"),
    title: "Update check result",
    description:
      "Written to stdout on success. When the registry cannot be reached, the same shape with `error` set is written to stderr and the command exits 1.",
    type: "object",
    required: ["current", "latest", "updateAvailable"],
    properties: {
      current: { type: "string" },
      latest: { type: ["string", "null"] },
      updateAvailable: { type: "boolean" },
      error: { type: "string", description: "Present only when the registry was unreachable." },
    },
  },
};

const EXIT_CODE_DEF = {
  type: "object",
  required: ["code", "meaning"],
  properties: { code: { enum: [0, 1, 2] }, meaning: { type: "string" } },
};

export const describeSchema: SchemaEntry = {
  id: "describe",
  uri: schemaUri("v1", "describe"),
  title: "CLI contract description",
  commands: ["describe"],
  schema: {
    $schema: DRAFT,
    $id: schemaUri("v1", "describe"),
    title: "CLI contract description",
    description:
      "The static contract. Project configuration is not applied, so `defaultFormat` is the built-in default rather than the resolved one.",
    type: "object",
    required: [
      "schemaVersion",
      "tool",
      "formatShorthands",
      "machineStreams",
      "schemas",
      "commands",
    ],
    properties: {
      schemaVersion: { type: "string" },
      tool: {
        type: "object",
        required: ["name", "version"],
        properties: { name: { type: "string" }, version: { type: "string" } },
      },
      formatShorthands: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "argv token to the --format value it expands to before parsing.",
      },
      machineStreams: {
        type: "object",
        required: ["description", "stream", "suppressedWhen", "optOutEnv"],
        properties: {
          description: { type: "string" },
          stream: { type: "string" },
          suppressedWhen: stringArray,
          optOutEnv: { type: "string" },
        },
      },
      schemas: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "uri", "title", "commands"],
          properties: {
            id: { type: "string" },
            uri: { type: "string" },
            title: { type: "string" },
            commands: stringArray,
          },
        },
      },
      commands: { type: "array", items: { $ref: "#/$defs/command" } },
    },
    $defs: {
      command: {
        type: "object",
        required: ["id", "path", "description", "usage", "arguments", "options", "subcommands"],
        properties: {
          id: { type: "string", description: "Space-joined command path, e.g. 'md graph'." },
          path: stringArray,
          description: { type: "string" },
          usage: { type: "string" },
          arguments: { type: "array", items: { $ref: "#/$defs/argument" } },
          options: { type: "array", items: { $ref: "#/$defs/option" } },
          subcommands: stringArray,
          formats: { type: ["array", "null"], items: { type: "string" } },
          defaultFormat: { type: ["string", "null"] },
          formatConfigurable: { type: "boolean" },
          outputSchema: { type: ["string", "null"] },
          jsonlSchema: { type: ["string", "null"] },
          sarifSchema: { type: ["string", "null"] },
          exitCodes: { type: "array", items: EXIT_CODE_DEF },
          exitCodePassthrough: {
            type: "object",
            description:
              "Present only when the command forwards a child process's exit status verbatim, which is outside the three codes `exitCodes` declares.",
            required: ["min", "max", "description"],
            properties: {
              min: { type: "integer" },
              max: { type: "integer" },
              description: { type: "string" },
            },
          },
          stream: {
            type: ["object", "null"],
            properties: {
              success: { enum: ["stdout", "stderr"] },
              findings: { enum: ["stdout", "stderr"] },
            },
          },
          writes: { type: ["boolean", "null"] },
          stability: { enum: ["stable", "experimental", "undeclared"] },
          notes: { type: "string" },
        },
      },
      argument: {
        type: "object",
        required: ["name", "required", "variadic", "description"],
        properties: {
          name: { type: "string" },
          required: { type: "boolean" },
          variadic: { type: "boolean" },
          description: { type: "string" },
          default: {},
        },
      },
      option: {
        type: "object",
        required: [
          "flags",
          "long",
          "short",
          "description",
          "valueName",
          "valueRequired",
          "valueOptional",
          "mandatory",
          "variadic",
          "negated",
          "repeatable",
        ],
        properties: {
          flags: { type: "string" },
          long: { type: ["string", "null"] },
          short: { type: ["string", "null"] },
          description: { type: "string" },
          valueName: { type: ["string", "null"] },
          valueRequired: { type: "boolean" },
          valueOptional: { type: "boolean" },
          mandatory: { type: "boolean" },
          variadic: { type: "boolean" },
          negated: { type: "boolean" },
          repeatable: { type: "boolean" },
          default: {},
        },
      },
    },
  },
};

export const schemaListSchema: SchemaEntry = {
  id: "schema-list",
  uri: schemaUri("v1", "schema-list"),
  title: "Published schema index",
  commands: ["schema"],
  schema: {
    $schema: DRAFT,
    $id: schemaUri("v1", "schema-list"),
    title: "Published schema index",
    description:
      "Emitted by `schema --format json` with no id. With an id the schema itself is written instead, regardless of --format.",
    type: "object",
    required: ["schemaVersion", "schemas"],
    properties: {
      schemaVersion: { type: "string" },
      schemas: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "uri", "title", "commands"],
          properties: {
            id: { type: "string" },
            uri: { type: "string" },
            title: { type: "string" },
            commands: stringArray,
          },
        },
      },
    },
  },
};

export const envelopeSchema: SchemaEntry = {
  id: "envelope",
  uri: schemaUri("v1", "envelope"),
  title: "Result envelope",
  commands: [],
  schema: {
    $schema: DRAFT,
    $id: schemaUri("v1", "envelope"),
    title: "Result envelope",
    description:
      "Opt-in wrapper produced by `--format json --envelope`. `data` holds the command's payload verbatim, so unwrapping it yields exactly the output of the same run without the flag.",
    type: "object",
    required: ["schemaVersion", "tool", "command", "ok", "exitCode", "data"],
    properties: {
      schemaVersion: { type: "string" },
      tool: {
        type: "object",
        required: ["name", "version"],
        properties: { name: { type: "string" }, version: { type: "string" } },
      },
      command: { type: "string", description: "Space-joined command path, e.g. 'md graph'." },
      ok: { type: "boolean" },
      exitCode: { enum: [0, 1, 2] },
      schema: {
        type: ["string", "null"],
        description: "Canonical `$id` of the schema describing `data`, or null when unpublished.",
      },
      data: { description: "The command payload, unchanged from its unenveloped form." },
      summary: {
        type: "object",
        description: "Optional command-specific counters.",
      },
    },
  },
};
