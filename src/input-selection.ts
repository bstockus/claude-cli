import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { minimatch } from "minimatch";
import { runtime } from "./runtime.js";

export interface SelectionOptions {
  include?: string[];
  exclude?: string[];
  changedSince?: string;
  stdinName?: string;
  requireStdinName?: boolean;
}

function hasMagic(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export function changedMarkdownFiles(revision: string, root = runtime().config.root): string[] {
  try {
    const absoluteRoot = path.resolve(root);
    const realRoot = fs.realpathSync(absoluteRoot);
    const repository = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const changed = execFileSync(
      "git",
      [
        "-C",
        repository,
        "diff",
        "--name-status",
        "--find-renames",
        "--find-copies",
        revision,
        "--",
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const untracked = execFileSync(
      "git",
      ["-C", repository, "ls-files", "--others", "--exclude-standard"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const names: string[] = [];
    for (const line of changed.split(/\r?\n/)) {
      if (!line) continue;
      const parts = line.split("\t");
      if (parts[0].startsWith("D")) continue;
      names.push(parts[0].startsWith("R") || parts[0].startsWith("C") ? parts[2] : parts[1]);
    }
    names.push(...untracked.split(/\r?\n/).filter(Boolean));
    return [...new Set(names)]
      .filter((name) => /\.md(?:own)?$/i.test(name))
      .map((name) => path.resolve(repository, name))
      .filter((file) => inside(realRoot, file) && fs.existsSync(file) && fs.statSync(file).isFile())
      .map((file) => path.resolve(absoluteRoot, path.relative(realRoot, file)))
      .sort();
  } catch (error) {
    const detail = (error as { stderr?: Buffer | string }).stderr;
    const message = detail ? String(detail).trim().split("\n")[0] : (error as Error).message;
    throw new Error(`Unable to select files changed since ${revision}: ${message}`, {
      cause: error,
    });
  }
}

export function resolveMarkdownInputs(
  inputs: readonly string[],
  options: SelectionOptions = {},
): string[] {
  const workspace = runtime().workspace;
  const root = workspace.root;
  const include = options.include ?? runtime().config.files.include;
  const exclude = options.exclude ?? runtime().config.files.exclude;
  const all = (): string[] => workspace.markdownFiles(root, { include, exclude });
  const files = new Set<string>();

  for (const input of inputs) {
    if (input === "-") {
      if (inputs.length !== 1) throw new Error("stdin cannot be combined with file inputs");
      if (options.requireStdinName && !options.stdinName) {
        throw new Error(
          "--stdin-name <path> is required when stdin needs file-relative resolution",
        );
      }
      const name = path.resolve(options.stdinName ?? path.join(root, "stdin.md"));
      if (!inside(root, name)) throw new Error(`stdin name is outside workspace root: ${name}`);
      workspace.registerDocument(name, fs.readFileSync(0, "utf-8"));
      files.add(name);
      continue;
    }
    const resolved = path.resolve(input);
    if (runtime().config.configPath && !inside(root, resolved)) {
      throw new Error(`Input is outside configured workspace root: ${resolved}`);
    }
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        for (const file of workspace.markdownFiles(resolved, { include, exclude })) files.add(file);
      } else if (stat.isFile()) files.add(resolved);
      else throw new Error(`Path is not a file or directory: ${resolved}`);
      continue;
    }
    if (hasMagic(input)) {
      const normalized = path.isAbsolute(input)
        ? path.relative(root, input).split(path.sep).join("/")
        : path.relative(root, path.resolve(input)).split(path.sep).join("/");
      for (const file of all()) {
        const relative = path.relative(root, file).split(path.sep).join("/");
        if (minimatch(relative, normalized, { dot: true, nonegate: true })) files.add(file);
      }
      continue;
    }
    throw new Error(`Path not found: ${resolved}`);
  }

  let selected = [...files].sort();
  const matchesSelection = (file: string): boolean => {
    if (!runtime().config.configPath && !inside(root, file)) return true;
    const relative = path.relative(root, file).split(path.sep).join("/");
    const matches = (pattern: string) =>
      minimatch(relative, pattern, { dot: true, nonegate: true });
    return include.some(matches) && !exclude.some(matches);
  };
  selected = selected.filter(matchesSelection);
  if (options.changedSince) {
    const changed = new Set(changedMarkdownFiles(options.changedSince, root));
    selected = (inputs.length ? selected : all()).filter((file) => changed.has(file));
  }
  return selected;
}
