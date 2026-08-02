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
}

export interface ResolvedConfig {
  configPath?: string;
  root: string;
  files: { include: string[]; exclude: string[]; entryPoints: string[] };
  markdown: { renderer: "github" };
  output: { format: OutputFormat; paths: PathStyle };
  checks: CheckConfig;
  markdownlint: { config?: string };
  urls: { ignore: string[]; allowedStatuses: number[] };
  commands: Record<string, Record<string, unknown>>;
}

const COMMAND_OPTIONS: Record<string, Set<string>> = {
  lint: new Set(["format", "paths", "style", "mermaid", "katex", "references"]),
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
  ]),
  refs: new Set(["format", "paths", "external", "anchors", "images"]),
  "refs-to": new Set(["format", "paths", "include", "exclude"]),
  headers: new Set(["format", "paths", "maxDepth"]),
  outline: new Set(["format", "paths", "maxDepth"]),
  toc: new Set(["format", "paths", "maxDepth", "minDepth", "ordered"]),
  stats: new Set(["format", "paths"]),
  "code-blocks": new Set(["format", "paths", "lang", "content"]),
  structure: new Set(["format", "paths"]),
  links: new Set(["format", "paths", "brokenOnly", "type"]),
  section: new Set(["format", "paths", "includeHeading", "children", "raw"]),
  frontmatter: new Set(["format", "paths", "key"]),
  tasks: new Set(["format", "paths", "status", "summary"]),
  tables: new Set(["format", "paths", "content", "index"]),
  "check-urls": new Set(["format", "paths", "timeout", "concurrency", "retry", "includeOk"]),
  orphans: new Set(["format", "paths", "include", "exclude", "ignore", "entry"]),
  "rename-heading": new Set(["format", "paths", "directory", "dryRun", "include", "exclude"]),
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
  "mermaid",
  "katex",
  "references",
]);

function validateCommandOption(command: string, key: string, value: unknown): void {
  const name = `commands.${command}.${key}`;
  if (key === "format" && value !== "llm" && value !== "human" && value !== "json") {
    throw new Error(`${name} must be llm, human, or json`);
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
  if (key === "retry") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  if (key === "status" && value !== "done" && value !== "pending") {
    throw new Error(`${name} must be done or pending`);
  }
  if (key === "type" && !["internal", "external", "image", "anchor"].includes(String(value))) {
    throw new Error(`${name} must be internal, external, image, or anchor`);
  }
  if (["lang", "key", "directory"].includes(key) && typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  if (["include", "exclude", "ignore", "entry"].includes(key)) strings(value, name, []);
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
  const output = object(rootObject.output, "output");
  knownKeys(output, new Set(["format", "paths"]), "output");
  const format = output.format ?? "llm";
  if (format !== "llm" && format !== "human" && format !== "json") {
    throw new Error("output.format must be llm, human, or json");
  }
  const paths = output.paths ?? "absolute";
  if (paths !== "absolute" && paths !== "relative") {
    throw new Error("output.paths must be absolute or relative");
  }

  const checks = object(rootObject.checks, "checks");
  knownKeys(checks, new Set(["mermaid", "katex", "references", "markdownlint"]), "checks");
  const markdownlint = object(rootObject.markdownlint, "markdownlint");
  knownKeys(markdownlint, new Set(["config"]), "markdownlint");
  const urls = object(rootObject.urls, "urls");
  knownKeys(urls, new Set(["ignore", "allowedStatuses"]), "urls");
  const allowedStatuses = urls.allowedStatuses ?? [];
  if (
    !Array.isArray(allowedStatuses) ||
    allowedStatuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)
  ) {
    throw new Error("urls.allowedStatuses must contain HTTP status codes from 100 to 599");
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

  const rootValue = optionalString(rootObject.root, "root") ?? ".";
  const root = path.resolve(base, rootValue);
  const markdownlintPath = optionalString(markdownlint.config, "markdownlint.config");
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
  const entryPoints = strings(files.entryPoints, "files.entryPoints", []).map((entry) =>
    path.resolve(base, entry),
  );
  for (const entry of [
    ...entryPoints,
    ...((commands.orphans?.entry as string[] | undefined) ?? []),
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
    markdown: { renderer: "github" },
    output: { format, paths },
    checks: {
      mermaid: boolean(checks.mermaid, "checks.mermaid", true),
      katex: boolean(checks.katex, "checks.katex", true),
      references: boolean(checks.references, "checks.references", true),
      markdownlint: boolean(checks.markdownlint, "checks.markdownlint", false),
    },
    markdownlint: {
      ...(markdownlintPath ? { config: resolveFile(base, markdownlintPath) } : {}),
    },
    urls: {
      ignore: strings(urls.ignore, "urls.ignore", []),
      allowedStatuses: [...allowedStatuses] as number[],
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
