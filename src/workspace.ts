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
import {
  fingerprint,
  WorkspaceIndex,
  type FileFingerprint,
  type WorkspaceIndexStatus,
} from "./workspace-index.js";
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

/**
 * Parses Markdown into a document without touching any cache.
 *
 * `md diff` needs this: `registerDocument` stores its result under the file's
 * absolute path and `document()` short-circuits on it, so registering a
 * historical revision would shadow the worktree file for the rest of the
 * process — and a diff needs both sides at once. `logicalPath` should be the
 * real worktree path so the revision's links resolve against the same directory
 * they always did.
 */
export function buildDocument(logicalPath: string, content: string): MarkdownDocument {
  const tree = parseMarkdown(content);
  return {
    path: logicalPath,
    content,
    lines: content.split("\n"),
    tree,
    headings: extractHeadings(tree),
    references: extractLinks(tree, content),
    frontmatter: parseFrontmatter(content),
  };
}

/** Whether `target` is `root` or lies beneath it, compared lexically. */
export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export class Workspace {
  readonly root: string;
  private readonly cache = new Map<
    string,
    { fingerprint?: FileFingerprint; document: MarkdownDocument; transient?: boolean }
  >();
  private readonly index: WorkspaceIndex;

  constructor(
    readonly config: ResolvedConfig,
    options: { cachePath?: string } = {},
  ) {
    this.root = config.root;
    this.index = new WorkspaceIndex(config.root, config.markdown.renderer, options.cachePath);
  }

  displayPath(filePath: string, style = this.config.output.paths): string {
    return style === "relative" ? path.relative(this.root, filePath) || "." : filePath;
  }

  document(filePath: string): MarkdownDocument {
    const absolute = path.resolve(filePath);
    const cached = this.cache.get(absolute);
    if (cached?.transient) return cached.document;
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`File not found: ${absolute}`);
    }
    const current = fingerprint(absolute);
    if (
      cached &&
      cached.fingerprint?.size === current.size &&
      cached.fingerprint.mtimeMs === current.mtimeMs
    ) {
      return cached.document;
    }
    const indexed = this.index.get(absolute, current);
    if (indexed) {
      this.cache.set(absolute, { fingerprint: current, document: indexed });
      return indexed;
    }
    const document = buildDocument(absolute, fs.readFileSync(absolute, "utf-8"));
    this.cache.set(absolute, { fingerprint: current, document });
    this.index.set(absolute, current, document);
    return document;
  }

  invalidate(filePath: string): void {
    const absolute = path.resolve(filePath);
    this.cache.delete(absolute);
    this.index.invalidate(absolute);
  }

  registerDocument(filePath: string, content: string): string {
    const absolute = path.resolve(filePath);
    this.cache.set(absolute, { transient: true, document: buildDocument(absolute, content) });
    return absolute;
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

  assetFiles(
    directory: string = this.root,
    extensions: string[] = this.config.assets.extensions,
    exclude: string[] = this.config.files.exclude,
  ): string[] {
    const absolute = path.resolve(directory);
    if (this.config.configPath && !inside(this.root, absolute)) {
      throw new Error(`Directory is outside configured workspace root: ${absolute}`);
    }
    const normalized = new Set(
      extensions.map((extension) =>
        (extension.startsWith(".") ? extension : `.${extension}`).toLowerCase(),
      ),
    );
    const results: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name)) walk(fullPath);
          continue;
        }
        if (!entry.isFile() || !normalized.has(path.extname(entry.name).toLowerCase())) continue;
        const relative = path.relative(this.root, fullPath).split(path.sep).join("/");
        if (exclude.some((pattern) => minimatch(relative, pattern, { dot: true, nonegate: true })))
          continue;
        results.push(fullPath);
      }
    };
    walk(absolute);
    return results.sort();
  }

  indexStatus(files: string[]): WorkspaceIndexStatus {
    return this.index.status(files);
  }

  rebuildIndex(directory: string, files: string[]): WorkspaceIndexStatus {
    const records = new Map<string, { fingerprint: FileFingerprint; document: MarkdownDocument }>();
    for (const file of files) {
      this.invalidate(file);
      const document = this.document(file);
      records.set(file, { fingerprint: fingerprint(file), document });
    }
    this.index.replace(directory, records);
    this.index.flush(true);
    return this.index.status(files);
  }

  clearIndex(): void {
    this.index.clear(true);
  }

  flush(): void {
    this.index.flush();
  }
}
