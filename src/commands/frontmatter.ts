import { parse as parseYaml } from "yaml";
import { parseMarkdownWithFrontmatter } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";

interface FrontmatterOptions {
  format: string;
  key?: string;
}

function resolveFormat(opts: FrontmatterOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

function getNestedValue(obj: unknown, keyPath: string): unknown {
  const parts = keyPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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

  const content = runtime().workspace.document(filePath).content;
  const tree = parseMarkdownWithFrontmatter(content);

  // Find yaml node at the start of the file
  const yamlNode = tree.children.find(
    (node) => node.type === "yaml" && node.position?.start.line === 1,
  );

  if (!yamlNode) {
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

  const yamlContent = (yamlNode as unknown as { value: string }).value;
  const data = parseYaml(yamlContent);

  if (opts.key) {
    const value = getNestedValue(data, opts.key);
    if (value === undefined) {
      process.stderr.write(`Error: Key not found: ${opts.key}\n`);
      terminate(1);
    }
    if (format === "json") {
      process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    } else {
      process.stdout.write(String(value) + "\n");
    }
    return;
  }

  if (format === "json") {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);

  process.stdout.write(bold(`Frontmatter in ${shownPath}:`) + "\n" + formatYamlLike(data) + "\n");
}
