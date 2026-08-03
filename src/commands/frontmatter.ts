import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";
import { jsonPayload } from "../result.js";
import { nestedValue } from "../object-path.js";

interface FrontmatterOptions {
  envelope?: boolean;
  format: string;
  key?: string;
}

function resolveFormat(opts: FrontmatterOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function formatYamlLike(data: unknown, indent: number = 2): string {
  if (data === null || data === undefined) return "null";
  if (typeof data !== "object") return String(data);
  if (Array.isArray(data)) {
    return (
      "[" +
      data.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") +
      "]"
    );
  }
  const lines: string[] = [];
  const prefix = " ".repeat(indent);
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      lines.push(formatYamlLike(value, indent + 2));
    } else {
      const formatted = Array.isArray(value)
        ? "[" +
          value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") +
          "]"
        : String(value);
      lines.push(`${prefix}${key}: ${formatted}`);
    }
  }
  return lines.join("\n");
}

export async function frontmatterAction(file: string, opts: FrontmatterOptions): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);

  const frontmatter = runtime().workspace.document(filePath).frontmatter;
  if (frontmatter.status === "missing") {
    if (opts.key) {
      process.stderr.write(`Error: Key not found: ${opts.key} (no frontmatter in file)\n`);
      terminate(1);
    }
    if (format === "json") {
      process.stdout.write("null\n");
    } else {
      process.stdout.write(`No frontmatter in ${shownPath}\n`);
    }
    return;
  }

  if (frontmatter.status === "malformed") {
    throw new Error(`${shownPath}: ${frontmatter.message}`);
  }
  const data = frontmatter.data;

  if (opts.key) {
    const value = nestedValue(data, opts.key);
    if (value === undefined) {
      process.stderr.write(`Error: Key not found: ${opts.key}\n`);
      terminate(1);
    }
    if (format === "json") {
      process.stdout.write(jsonPayload("md frontmatter", value, opts));
    } else {
      process.stdout.write(String(value) + "\n");
    }
    return;
  }

  if (format === "json") {
    process.stdout.write(jsonPayload("md frontmatter", data, opts));
    return;
  }

  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);

  process.stdout.write(bold(`Frontmatter in ${shownPath}:`) + "\n" + formatYamlLike(data) + "\n");
}
