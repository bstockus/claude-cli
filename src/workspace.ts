import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import {
  parseMarkdown,
  extractHeadings,
  extractLinks,
  type MdHeading,
  type MdLink,
  type Root,
} from "./markdown-ast.js";
import type { ResolvedConfig } from "./config.js";
import { parse as parseYaml } from "yaml";

export type FrontmatterResult =
  | { status: "missing" }
  | { status: "malformed"; message: string }
  | { status: "non-mapping"; data: unknown }
  | { status: "valid"; data: Record<string, unknown> };

const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

export interface MarkdownDocument {
  path: string;
  content: string;
  lines: string[];
  tree: Root;
  headings: MdHeading[];
  references: MdLink[];
  frontmatter: FrontmatterResult;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return { status: "missing" };
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!match) return { status: "malformed", message: "Unterminated YAML frontmatter" };
  try {
    const data: unknown = match[1].trim() === "" ? {} : parseYaml(match[1]);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { status: "non-mapping", data };
    }
    return { status: "valid", data: data as Record<string, unknown> };
  } catch (error) {
    return { status: "malformed", message: (error as Error).message.split("\n")[0] };
  }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export class Workspace {
  readonly root: string;
  private readonly cache = new Map<string, MarkdownDocument>();

  constructor(readonly config: ResolvedConfig) {
    this.root = config.root;
  }

  displayPath(filePath: string, style = this.config.output.paths): string {
    return style === "relative" ? path.relative(this.root, filePath) || "." : filePath;
  }

  document(filePath: string): MarkdownDocument {
    const absolute = path.resolve(filePath);
    const cached = this.cache.get(absolute);
    if (cached) return cached;
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`File not found: ${absolute}`);
    }
    const content = fs.readFileSync(absolute, "utf-8");
    const tree = parseMarkdown(content);
    const document = {
      path: absolute,
      content,
      lines: content.split("\n"),
      tree,
      headings: extractHeadings(tree),
      references: extractLinks(tree, content),
      frontmatter: parseFrontmatter(content),
    };
    this.cache.set(absolute, document);
    return document;
  }

  invalidate(filePath: string): void {
    this.cache.delete(path.resolve(filePath));
  }

  markdownFiles(
    directory: string = this.root,
    selection: { include?: string[]; exclude?: string[] } = {},
  ): string[] {
    const absolute = path.resolve(directory);
    if (this.config.configPath && !inside(this.root, absolute)) {
      throw new Error(`Directory is outside configured workspace root: ${absolute}`);
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
      throw new Error(`Directory not found: ${absolute}`);
    }
    const results: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          try {
            if (fs.statSync(fullPath).isDirectory()) continue;
          } catch {
            continue;
          }
        }
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name)) walk(fullPath);
          continue;
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const matchRoot = this.config.configPath ? this.root : absolute;
        const relative = path.relative(matchRoot, fullPath).split(path.sep).join("/");
        const include = selection.include ?? this.config.files.include;
        const exclude = selection.exclude ?? this.config.files.exclude;
        const matches = (pattern: string) =>
          minimatch(relative, pattern, { dot: true, nonegate: true });
        if (!include.some(matches)) continue;
        if (exclude.some(matches)) continue;
        results.push(fullPath);
      }
    };
    walk(absolute);
    return results.sort();
  }
}
