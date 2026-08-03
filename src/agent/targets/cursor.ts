import type { TargetProfile } from "./schema.js";
import { PROFILE_SCHEMA_VERSION } from "./schema.js";

export const cursorProfile: TargetProfile = {
  schemaVersion: PROFILE_SCHEMA_VERSION,
  id: "cursor",
  host: {
    displayName: "Cursor",
    documentationRevision: "2026-08-02",
    // Not recorded: no verified host range has been established for this profile.
    minimumVersion: null,
    verifiedThrough: null,
    versionCommand: ["cursor", "--version"],
    nativeValidator: null,
  },
  profiles: ["plugin", "project"],
  manifest: {
    directory: ".cursor-plugin",
    file: "plugin.json",
    fields: [
      { name: "name", required: true, support: "exact" },
      { name: "version", required: true, support: "exact" },
      { name: "description", required: true, support: "exact" },
      { name: "skills", required: false, support: "exact" },
      { name: "agents", required: false, support: "exact" },
      { name: "hooks", required: false, support: "exact" },
      { name: "mcpServers", required: false, support: "exact" },
    ],
  },
  paths: {
    plugin: {
      skills: "skills",
      agents: "agents",
      hooks: "hooks",
      assets: "assets",
      mcp: ".mcp.json",
    },
    project: {
      skills: ".cursor/skills",
      agents: ".cursor/agents",
      rules: ".cursor/rules",
      policies: ".cursor/hooks.json",
      mcp: ".cursor/mcp.json",
      assets: "assets",
    },
    // Cursor plugin skill directories are namespaced as `${bundle}-${skill}`.
    namespacePluginSkills: true,
  },
  placeholders: {
    bundleRoot: { plugin: ".", project: "." },
    arguments: "advisory",
    rootVariables: [],
  },
  hooks: {
    events: {
      "session-start": "sessionStart",
      "pre-tool-use": "preToolUse",
      "post-tool-use": "postToolUse",
      stop: "stop",
    },
    envelope: "versioned",
    handlerShape: "flat",
    supportedProtocols: ["json", "stdio-json"],
  },
  models: {
    support: "approximate",
    classes: { fast: "fast", balanced: "inherit", capable: "inherit", inherit: "inherit" },
  },
  tools: {
    support: "approximate",
    capabilities: null,
  },
  rules: {
    exactActivation: ["always", "files"],
    approximateActivation: [],
    form: "mdc",
  },
  outputs: {
    plugin: [
      { feature: "manifest", pattern: ".cursor-plugin/plugin.json" },
      { feature: "skills", pattern: "skills/{name}/**" },
      { feature: "agents", pattern: "agents/{name}.md" },
      { feature: "rules", pattern: ".cursor/rules/{name}.mdc" },
      { feature: "hooks", pattern: "hooks/**" },
      { feature: "mcp", pattern: ".mcp.json" },
      { feature: "assets", pattern: "assets/**" },
    ],
    project: [
      { feature: "skills", pattern: ".cursor/skills/{name}/**" },
      { feature: "agents", pattern: ".cursor/agents/{name}.md" },
      { feature: "rules", pattern: ".cursor/rules/{name}.mdc" },
      { feature: "policies", pattern: ".cursor/hooks.json" },
      { feature: "mcp", pattern: ".cursor/mcp.json" },
      { feature: "assets", pattern: "assets/**" },
    ],
  },
  features: {
    skills: {
      support: "approximate",
      profiles: ["plugin", "project"],
      summary: "namespaced in plugins",
      surface: "skills/<bundle>-<name>/SKILL.md",
      diagnostics: ["AB310"],
    },
    agents: {
      support: "approximate",
      profiles: ["plugin", "project"],
      summary: "approximate model mapping",
      surface: "agents/<name>.md",
      diagnostics: ["AB330", "AB332"],
    },
    rules: {
      support: "exact",
      profiles: ["plugin", "project"],
      summary: ".cursor/rules/*.mdc",
      surface: ".cursor/rules/<name>.mdc",
      diagnostics: ["AB351"],
    },
    hooks: {
      support: "exact",
      profiles: ["plugin"],
      summary: "camel-cased portable events",
      surface: "hooks/hooks.json",
      diagnostics: ["AB320", "AB321", "AB322"],
    },
    policies: {
      support: "unsupported",
      profiles: ["project"],
      summary: "unsupported without hook override",
      surface: ".cursor/hooks.json",
      diagnostics: ["AB360", "AB361"],
    },
    mcp: {
      support: "exact",
      profiles: ["plugin", "project"],
      summary: "exact",
      surface: ".cursor/mcp.json",
      diagnostics: [],
    },
    assets: {
      support: "exact",
      profiles: ["plugin", "project"],
      summary: "exact",
      surface: "assets/",
      diagnostics: [],
    },
    placeholders: {
      support: "approximate",
      profiles: ["plugin", "project"],
      summary: "argument substitution is advisory",
      surface: null,
      diagnostics: [],
    },
  },
};
