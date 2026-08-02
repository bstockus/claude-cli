import type { ResolvedConfig } from "./config.js";
import { loadConfig, resolveCommandOptions, type PathStyle } from "./config.js";
import { Workspace } from "./workspace.js";
import type { OutputFormat } from "./types.js";

export interface Runtime {
  config: ResolvedConfig;
  workspace: Workspace;
}

let activeRuntime: Runtime | undefined;

export function initializeRuntime(config: ResolvedConfig): Runtime {
  activeRuntime = { config, workspace: new Workspace(config) };
  return activeRuntime;
}

export function resetRuntime(): void {
  activeRuntime = undefined;
}

export function runtime(): Runtime {
  return activeRuntime ?? initializeRuntime(loadConfig({ disabled: true }));
}

export type ResolvedOptions<T extends Record<string, unknown>> = T & {
  format: OutputFormat;
  paths: PathStyle;
};

export function commandOptions<T extends Record<string, unknown>>(
  command: string,
  builtins: T,
  cli: Record<string, unknown>,
): ResolvedOptions<T> {
  const aliases: Record<string, string[]> = {
    format: ["-fh", "-fj"],
    style: ["-s"],
    external: ["-e"],
    anchors: ["-a"],
    images: ["-i"],
  };
  const argv = process.argv.slice(2);
  const explicit = Object.fromEntries(
    Object.entries(cli).filter(([key]) => {
      const kebab = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
      return argv.some(
        (arg) =>
          arg === `--${kebab}` ||
          arg === `--no-${kebab}` ||
          arg.startsWith(`--${kebab}=`) ||
          (aliases[key] ?? []).includes(arg),
      );
    }),
  );
  const resolved = resolveCommandOptions(runtime().config, command, builtins, explicit);
  if (!["llm", "human", "json", "jsonl", "sarif"].includes(String(resolved.format))) {
    throw new Error(`Invalid output format: ${String(resolved.format)}`);
  }
  if (
    (resolved.format === "jsonl" || resolved.format === "sarif") &&
    !["lint", "lint-dir", "audit", "validate-frontmatter", "check-urls"].includes(command)
  ) {
    throw new Error(`${resolved.format} output is not supported by md ${command}`);
  }
  if (resolved.paths !== "absolute" && resolved.paths !== "relative") {
    throw new Error(`Invalid path display style: ${String(resolved.paths)}`);
  }
  return resolved;
}

export function displayPath(filePath: string, style?: PathStyle): string {
  return runtime().workspace.displayPath(filePath, style);
}

export function outputPath(filePath: string, options: object): string {
  const value = (options as { paths?: unknown }).paths;
  const style = value === "relative" || value === "absolute" ? value : undefined;
  return displayPath(filePath, style);
}
