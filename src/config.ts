import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import type { OutputFormat } from "./types.js";

export type PathStyle = "absolute" | "relative";

export interface CheckConfig {
  mermaid: boolean;
  katex: boolean;
  references: boolean;
  markdownlint: boolean;
  frontmatter: boolean;
  graph: boolean;
  toc: boolean;
  external: boolean;
}

export interface FrontmatterRulesConfig {
  required: string[];
  prohibited: string[];
  types: Record<string, "string" | "number" | "integer" | "boolean" | "array" | "object" | "null">;
  allowedValues: Record<string, unknown[]>;
  formats: Record<string, string>;
  patterns: Record<string, string>;
  unique: string[];
}

export interface ResolvedConfig {
  configPath?: string;
  root: string;
  files: { include: string[]; exclude: string[]; entryPoints: string[] };
  assets: { extensions: string[] };
  markdown: { renderer: "github" };
  output: { format: OutputFormat; paths: PathStyle };
  checks: CheckConfig;
  frontmatter: { schema?: string; rules: FrontmatterRulesConfig };
  toc: { files: string[] };
  markdownlint: { config?: string };
  urls: {
    ignore: string[];
    ignoreDomains: string[];
    allowedStatuses: number[];
    cache: boolean;
    cacheTtl: number;
    headFallbackStatuses: number[];
    reportRedirects: boolean;
  };
  commands: Record<string, Record<string, unknown>>;
}

const COMMAND_OPTIONS: Record<string, Set<string>> = {
  lint: new Set([
    "format",
    "paths",
    "style",
    "mermaid",
    "katex",
    "references",
    "stdinName",
    "changedSince",
    "include",
    "exclude",
  ]),
  "lint-dir": new Set([
    "format",
    "paths",
    "style",
    "summary",
    "concurrency",
    "mermaid",
    "katex",
    "references",
    "include",
    "exclude",
    "changedSince",
  ]),
  refs: new Set(["format", "paths", "external", "anchors", "images", "stdinName"]),
  "refs-to": new Set(["format", "paths", "include", "exclude"]),
  headers: new Set(["format", "paths", "maxDepth", "stdinName"]),
  outline: new Set(["format", "paths", "maxDepth", "stdinName"]),
  toc: new Set([
    "format",
    "paths",
    "maxDepth",
    "minDepth",
    "ordered",
    "check",
    "write",
    "dryRun",
    "stdinName",
  ]),
  graph: new Set(["format", "paths", "output", "entry", "focus", "depth", "include", "exclude"]),
  "validate-frontmatter": new Set([
    "format",
    "paths",
    "schema",
    "include",
    "exclude",
    "stdinName",
    "changedSince",
  ]),
  audit: new Set([
    "format",
    "paths",
    "summary",
    "external",
    "frontmatter",
    "graph",
    "toc",
    "style",
    "mermaid",
    "katex",
    "references",
    "concurrency",
    "include",
    "exclude",
    "entry",
    "timeout",
    "retry",
    "changedSince",
    // `writeBaseline` is deliberately absent, on the same rule as `md fix`: a
    // checked-in config must not be able to turn a checker into a writer.
    // Reading a baseline is configurable because CI is exactly where it
    // belongs, and suppression is never silent — the payload reports it.
    "baseline",
  ]),
  stats: new Set(["format", "paths", "stdinName"]),
  "code-blocks": new Set(["format", "paths", "lang", "content", "stdinName"]),
  structure: new Set(["format", "paths", "stdinName"]),
  links: new Set(["format", "paths", "brokenOnly", "type", "stdinName"]),
  section: new Set(["format", "paths", "includeHeading", "children", "raw", "stdinName"]),
  frontmatter: new Set(["format", "paths", "key", "stdinName"]),
  tasks: new Set(["format", "paths", "status", "summary", "stdinName"]),
  tables: new Set(["format", "paths", "content", "index", "stdinName"]),
  "check-urls": new Set([
    "format",
    "paths",
    "timeout",
    "concurrency",
    "retry",
    "includeOk",
    "include",
    "exclude",
    "stdinName",
    "changedSince",
    "ignore",
    "ignoreDomain",
    "allowedStatus",
    "cache",
    "cacheTtl",
    "headFallbackStatus",
    "reportRedirects",
  ]),
  orphans: new Set(["format", "paths", "include", "exclude", "ignore", "entry"]),
  "rename-heading": new Set(["format", "paths", "directory", "dryRun", "include", "exclude"]),
  "rename-file": new Set(["format", "paths", "dryRun", "include", "exclude"]),
  query: new Set([
    "format",
    "paths",
    "include",
    "exclude",
    "target",
    "field",
    "lang",
    "content",
    "status",
    "summary",
    "assetExtension",
  ]),
  context: new Set([
    "format",
    "paths",
    "depth",
    "section",
    "target",
    "budget",
    "backlinks",
    "children",
    "frontmatter",
    "include",
    "exclude",
  ]),
  diff: new Set(["format", "paths", "since", "summary", "include", "exclude"]),
  // `check`, `write`, and `dryRun` are deliberately absent: the mutation mode
  // is CLI-only, so a checked-in config file can never turn `md fix` into a
  // writer, and mode resolution needs no config-versus-CLI disambiguation.
  fix: new Set(["format", "paths", "rule", "include", "exclude", "changedSince"]),
  index: new Set(["format", "paths", "include", "exclude"]),
};

const ROOT_KEYS = new Set([
  "version",
  "root",
  "files",
  "markdown",
  "output",
  "checks",
  "markdownlint",
  "urls",
  "commands",
  "frontmatter",
  "toc",
  "assets",
]);

const AUTOMATION_FORMAT_COMMANDS = new Set([
  "lint",
  "lint-dir",
  "audit",
  "validate-frontmatter",
  "check-urls",
]);

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function knownKeys(value: Record<string, unknown>, allowed: Set<string>, name: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`Unknown ${name} key: ${unknown}`);
}

function strings(value: unknown, name: string, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be a list of strings`);
  }
  return [...value] as string[];
}

function boolean(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function resolveFile(base: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : path.resolve(base, value);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

const BOOLEAN_OPTIONS = new Set([
  "style",
  "summary",
  "external",
  "cache",
  "reportRedirects",
  "check",
  "write",
  "anchors",
  "images",
  "ordered",
  "content",
  "brokenOnly",
  "includeHeading",
  "children",
  "raw",
  "includeOk",
  "dryRun",
  "backlinks",
  "mermaid",
  "katex",
  "references",
  "frontmatter",
  "graph",
  "toc",
  "external",
]);

function validateCommandOption(command: string, key: string, value: unknown): void {
  const name = `commands.${command}.${key}`;
  if (key === "format" && !["llm", "human", "json", "jsonl", "sarif"].includes(String(value))) {
    throw new Error(`${name} must be llm, human, json, jsonl, or sarif`);
  }
  if (
    key === "format" &&
    (value === "jsonl" || value === "sarif") &&
    !AUTOMATION_FORMAT_COMMANDS.has(command)
  ) {
    throw new Error(`${name} supports jsonl and sarif only for aggregate diagnostic commands`);
  }
  if (key === "paths" && value !== "absolute" && value !== "relative") {
    throw new Error(`${name} must be absolute or relative`);
  }
  if (BOOLEAN_OPTIONS.has(key) && typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  if (["maxDepth", "minDepth"].includes(key)) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 6) {
      throw new Error(`${name} must be an integer from 1 to 6`);
    }
  }
  if (["timeout", "concurrency", "index"].includes(key)) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1)
      throw new Error(`${name} must be a positive integer`);
  }
  if (key === "cacheTtl" || key === "budget") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  if (key === "depth") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 6) {
      throw new Error(`${name} must be an integer from 0 to 6`);
    }
  }
  if (key === "retry") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  if (key === "status" && !["all", "done", "pending"].includes(String(value))) {
    throw new Error(`${name} must be all, done, or pending`);
  }
  if (key === "type" && !["internal", "external", "image", "anchor"].includes(String(value))) {
    throw new Error(`${name} must be internal, external, image, or anchor`);
  }
  if (
    [
      "lang",
      "key",
      "directory",
      "schema",
      "output",
      "stdinName",
      "changedSince",
      "target",
      "field",
      "since",
    ].includes(key) &&
    typeof value !== "string"
  ) {
    throw new Error(`${name} must be a string`);
  }
  if (
    [
      "include",
      "exclude",
      "ignore",
      "ignoreDomain",
      "entry",
      "assetExtension",
      "section",
      "rule",
    ].includes(key)
  )
    strings(value, name, []);
  if (["allowedStatus", "headFallbackStatus"].includes(key)) {
    if (
      !Array.isArray(value) ||
      value.some(
        (status) =>
          !Number.isInteger(Number(status)) || Number(status) < 100 || Number(status) > 599,
      )
    ) {
      throw new Error(`${name} must contain HTTP status codes from 100 to 599`);
    }
  }
  if (key === "output" && !["report", "mermaid", "dot"].includes(String(value))) {
    throw new Error(`${name} must be report, mermaid, or dot`);
  }
}

function stringMap<T>(
  value: unknown,
  name: string,
  validate: (item: unknown, itemName: string) => T,
): Record<string, T> {
  const source = object(value, name);
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => [key, validate(item, `${name}.${key}`)]),
  );
}

export interface ConfigSelection {
  explicitPath?: string;
  disabled: boolean;
}

export function selectConfig(
  argv: readonly string[],
  cwd: string = process.cwd(),
): ConfigSelection {
  let explicitPath: string | undefined;
  let disabled = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-config") disabled = true;
    else if (arg === "--config" && argv[i + 1]) explicitPath = path.resolve(cwd, argv[++i]);
    else if (arg.startsWith("--config=")) explicitPath = path.resolve(cwd, arg.slice(9));
  }
  if (disabled && explicitPath) throw new Error("--config and --no-config cannot be used together");
  return { explicitPath, disabled };
}

export function findConfig(start: string = process.cwd()): string | undefined {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, ".claude-cli.yml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function loadConfig(
  selection: ConfigSelection = { disabled: false },
  cwd: string = process.cwd(),
): ResolvedConfig {
  const configPath = selection.disabled ? undefined : (selection.explicitPath ?? findConfig(cwd));
  if (selection.explicitPath && !fs.existsSync(selection.explicitPath)) {
    throw new Error(`Configuration file not found: ${selection.explicitPath}`);
  }
  const base = configPath ? path.dirname(configPath) : path.resolve(cwd);
  const raw = configPath ? parseYaml(fs.readFileSync(configPath, "utf-8")) : {};
  const rootObject = object(raw, "configuration");
  knownKeys(rootObject, ROOT_KEYS, "configuration");
  if (configPath && rootObject.version !== 1) {
    throw new Error("Configuration version must be 1");
  }

  const files = object(rootObject.files, "files");
  knownKeys(files, new Set(["include", "exclude", "entryPoints"]), "files");
  const markdown = object(rootObject.markdown, "markdown");
  knownKeys(markdown, new Set(["renderer"]), "markdown");
  if (markdown.renderer !== undefined && markdown.renderer !== "github") {
    throw new Error("markdown.renderer must be github");
  }
  const assets = object(rootObject.assets, "assets");
  knownKeys(assets, new Set(["extensions"]), "assets");
  const output = object(rootObject.output, "output");
  knownKeys(output, new Set(["format", "paths"]), "output");
  const format = (output.format ?? "llm") as OutputFormat;
  if (!["llm", "human", "json", "jsonl", "sarif"].includes(String(format))) {
    throw new Error("output.format must be llm, human, json, jsonl, or sarif");
  }
  const paths = output.paths ?? "absolute";
  if (paths !== "absolute" && paths !== "relative") {
    throw new Error("output.paths must be absolute or relative");
  }

  const checks = object(rootObject.checks, "checks");
  knownKeys(
    checks,
    new Set([
      "mermaid",
      "katex",
      "references",
      "markdownlint",
      "frontmatter",
      "graph",
      "toc",
      "external",
    ]),
    "checks",
  );
  const frontmatter = object(rootObject.frontmatter, "frontmatter");
  knownKeys(frontmatter, new Set(["schema", "rules"]), "frontmatter");
  const rules = object(frontmatter.rules, "frontmatter.rules");
  knownKeys(
    rules,
    new Set(["required", "prohibited", "types", "allowedValues", "formats", "patterns", "unique"]),
    "frontmatter.rules",
  );
  const typeNames = new Set(["string", "number", "integer", "boolean", "array", "object", "null"]);
  const types = stringMap(rules.types, "frontmatter.rules.types", (item, name) => {
    if (typeof item !== "string" || !typeNames.has(item))
      throw new Error(`${name} has an unsupported type`);
    return item as FrontmatterRulesConfig["types"][string];
  });
  const allowedValues = stringMap(
    rules.allowedValues,
    "frontmatter.rules.allowedValues",
    (item, name) => {
      if (!Array.isArray(item)) throw new Error(`${name} must be a list`);
      return [...item];
    },
  );
  const formats = stringMap(rules.formats, "frontmatter.rules.formats", (item, name) => {
    if (typeof item !== "string") throw new Error(`${name} must be a string`);
    return item;
  });
  const patterns = stringMap(rules.patterns, "frontmatter.rules.patterns", (item, name) => {
    if (typeof item !== "string") throw new Error(`${name} must be a string`);
    try {
      new RegExp(item);
    } catch {
      throw new Error(`${name} must be a valid regular expression`);
    }
    return item;
  });
  const toc = object(rootObject.toc, "toc");
  knownKeys(toc, new Set(["files"]), "toc");
  const markdownlint = object(rootObject.markdownlint, "markdownlint");
  knownKeys(markdownlint, new Set(["config"]), "markdownlint");
  const urls = object(rootObject.urls, "urls");
  knownKeys(
    urls,
    new Set([
      "ignore",
      "ignoreDomains",
      "allowedStatuses",
      "cache",
      "cacheTtl",
      "headFallbackStatuses",
      "reportRedirects",
    ]),
    "urls",
  );
  const allowedStatuses = urls.allowedStatuses ?? [];
  if (
    !Array.isArray(allowedStatuses) ||
    allowedStatuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)
  ) {
    throw new Error("urls.allowedStatuses must contain HTTP status codes from 100 to 599");
  }
  const headFallbackStatuses = urls.headFallbackStatuses ?? [400, 403, 405, 501];
  if (
    !Array.isArray(headFallbackStatuses) ||
    headFallbackStatuses.some(
      (status) => !Number.isInteger(status) || (status as number) < 100 || (status as number) > 599,
    )
  ) {
    throw new Error("urls.headFallbackStatuses must contain HTTP status codes from 100 to 599");
  }
  const cacheTtl = urls.cacheTtl ?? 86_400_000;
  if (!Number.isInteger(cacheTtl) || (cacheTtl as number) < 0) {
    throw new Error("urls.cacheTtl must be a non-negative integer");
  }

  const commandsObject = object(rootObject.commands, "commands");
  const commands: Record<string, Record<string, unknown>> = {};
  for (const [name, value] of Object.entries(commandsObject)) {
    const allowed = COMMAND_OPTIONS[name];
    if (!allowed) throw new Error(`Unknown command configuration: ${name}`);
    const command = object(value, `commands.${name}`);
    knownKeys(command, allowed, `commands.${name}`);
    for (const [key, option] of Object.entries(command)) validateCommandOption(name, key, option);
    commands[name] = { ...command };
  }
  for (const command of Object.values(commands)) {
    if (typeof command.stdinName === "string") {
      command.stdinName = path.resolve(base, command.stdinName);
    }
  }

  const rootValue = optionalString(rootObject.root, "root") ?? ".";
  const root = path.resolve(base, rootValue);
  const markdownlintPath = optionalString(markdownlint.config, "markdownlint.config");
  const frontmatterSchema = optionalString(frontmatter.schema, "frontmatter.schema");
  if (typeof commands["rename-heading"]?.directory === "string") {
    commands["rename-heading"].directory = path.resolve(
      base,
      commands["rename-heading"].directory as string,
    );
  }
  if (Array.isArray(commands.orphans?.entry)) {
    commands.orphans.entry = (commands.orphans.entry as string[]).map((entry) =>
      path.resolve(base, entry),
    );
  }
  for (const command of ["graph", "audit"]) {
    if (Array.isArray(commands[command]?.entry)) {
      commands[command].entry = (commands[command].entry as string[]).map((entry) =>
        path.resolve(base, entry),
      );
    }
  }
  if (typeof commands["validate-frontmatter"]?.schema === "string") {
    commands["validate-frontmatter"].schema = path.resolve(
      base,
      commands["validate-frontmatter"].schema as string,
    );
  }
  const entryPoints = strings(files.entryPoints, "files.entryPoints", []).map((entry) =>
    path.resolve(base, entry),
  );
  for (const entry of [
    ...entryPoints,
    ...((commands.orphans?.entry as string[] | undefined) ?? []),
    ...((commands.graph?.entry as string[] | undefined) ?? []),
    ...((commands.audit?.entry as string[] | undefined) ?? []),
  ]) {
    if (!isInside(root, entry)) throw new Error(`Entry point is outside workspace root: ${entry}`);
  }
  const renameDirectory = commands["rename-heading"]?.directory;
  if (typeof renameDirectory === "string" && !isInside(root, renameDirectory)) {
    throw new Error(`Rename directory is outside workspace root: ${renameDirectory}`);
  }

  return {
    ...(configPath ? { configPath } : {}),
    root,
    files: {
      include: strings(files.include, "files.include", ["**/*.md"]),
      exclude: strings(files.exclude, "files.exclude", []),
      entryPoints,
    },
    assets: {
      extensions: strings(assets.extensions, "assets.extensions", [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".svg",
        ".avif",
        ".ico",
        ".bmp",
        ".pdf",
        ".mp3",
        ".wav",
        ".ogg",
        ".mp4",
        ".webm",
        ".mov",
      ]),
    },
    markdown: { renderer: "github" },
    output: { format, paths },
    checks: {
      mermaid: boolean(checks.mermaid, "checks.mermaid", true),
      katex: boolean(checks.katex, "checks.katex", true),
      references: boolean(checks.references, "checks.references", true),
      markdownlint: boolean(checks.markdownlint, "checks.markdownlint", false),
      frontmatter: boolean(checks.frontmatter, "checks.frontmatter", true),
      graph: boolean(checks.graph, "checks.graph", true),
      toc: boolean(checks.toc, "checks.toc", true),
      external: boolean(checks.external, "checks.external", false),
    },
    frontmatter: {
      ...(frontmatterSchema ? { schema: resolveFile(base, frontmatterSchema) } : {}),
      rules: {
        required: strings(rules.required, "frontmatter.rules.required", []),
        prohibited: strings(rules.prohibited, "frontmatter.rules.prohibited", []),
        types,
        allowedValues,
        formats,
        patterns,
        unique: strings(rules.unique, "frontmatter.rules.unique", []),
      },
    },
    toc: { files: strings(toc.files, "toc.files", []) },
    markdownlint: {
      ...(markdownlintPath ? { config: resolveFile(base, markdownlintPath) } : {}),
    },
    urls: {
      ignore: strings(urls.ignore, "urls.ignore", []),
      ignoreDomains: strings(urls.ignoreDomains, "urls.ignoreDomains", []),
      allowedStatuses: [...allowedStatuses] as number[],
      cache: boolean(urls.cache, "urls.cache", true),
      cacheTtl: cacheTtl as number,
      headFallbackStatuses: [...headFallbackStatuses] as number[],
      reportRedirects: boolean(urls.reportRedirects, "urls.reportRedirects", false),
    },
    commands,
  };
}

export function resolveCommandOptions<T extends Record<string, unknown>>(
  config: ResolvedConfig,
  command: string,
  builtins: T,
  cli: Record<string, unknown>,
): T & { format: OutputFormat; paths: PathStyle } {
  const configured = config.commands[command] ?? {};
  const supplied = Object.fromEntries(
    Object.entries(cli).filter(([, value]) => value !== undefined),
  );
  const format = supplied.format ?? configured.format ?? config.output.format;
  const paths = supplied.paths ?? configured.paths ?? config.output.paths;
  return { ...builtins, ...configured, ...supplied, format, paths } as T & {
    format: OutputFormat;
    paths: PathStyle;
  };
}

export function defaultLintConcurrency(): number {
  return Math.max(1, Math.min(8, os.availableParallelism()));
}
