import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface GitRepository {
  /** Repository toplevel, as git reports it — already symlink-resolved. */
  root: string;
  /** The workspace root the caller asked about, which may be a symlink to it. */
  workspaceRoot: string;
}

export type RevisionStatus = "A" | "M" | "D" | "R" | "C";

export interface RevisionChange {
  status: RevisionStatus;
  /** Repository-relative path at the revision. Absent for an addition. */
  oldPath?: string;
  /** Repository-relative path in the worktree. Absent for a deletion. */
  newPath?: string;
  /** Similarity index git reported for a rename or copy, 0-100. */
  similarity?: number;
}

/** `md diff` accepts both spellings; `--changed-since` accepts `.mdown` instead. */
const MARKDOWN = /\.(md|markdown)$/i;

function git(repository: string, args: string[], revision: string): string {
  try {
    return execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw failure(error, revision);
  }
}

function failure(error: unknown, revision: string): Error {
  const detail = (error as { stderr?: Buffer | string }).stderr;
  const message = detail ? String(detail).trim().split("\n")[0] : (error as Error).message;
  return new Error(`Unable to read revision ${revision}: ${message}`, { cause: error });
}

export function repositoryFor(root: string): GitRepository {
  const workspaceRoot = fs.realpathSync(path.resolve(root));
  try {
    const toplevel = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { root: fs.realpathSync(toplevel), workspaceRoot };
  } catch (error) {
    const detail = (error as { stderr?: Buffer | string }).stderr;
    const message = detail ? String(detail).trim().split("\n")[0] : (error as Error).message;
    throw new Error(`Not inside a Git repository: ${message}`, { cause: error });
  }
}

/** Resolves a revision to a commit sha, so a report can name what it compared. */
export function resolveCommit(repository: GitRepository, revision: string): string {
  return git(repository.root, ["rev-parse", "--verify", `${revision}^{commit}`], revision).trim();
}

/**
 * Repository-relative POSIX path for an absolute worktree path.
 *
 * `rev-parse --show-toplevel` reports the real path while the workspace root may
 * be a symlink to it — `/tmp` is one on macOS — so both sides are resolved
 * before the relative path is taken. A file that no longer exists in the
 * worktree is resolved through its parent directory instead.
 */
export function repositoryRelative(repository: GitRepository, absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    real = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
  }
  return path.relative(repository.root, real).split(path.sep).join("/");
}

/** Absolute worktree path for a repository-relative path. */
export function worktreePath(repository: GitRepository, repoRelativePath: string): string {
  return path.resolve(repository.root, repoRelativePath);
}

/**
 * Reads one path at a revision.
 *
 * Returns undefined only when git says the path is not in that revision — the
 * "added since" case. Every other failure rethrows, because treating a typo'd
 * revision as "the whole tree is new" is the worst thing this function could do.
 */
export function readAtRevision(
  repository: GitRepository,
  revision: string,
  repoRelativePath: string,
): string | undefined {
  try {
    const buffer = execFileSync(
      "git",
      ["-C", repository.root, "show", `${revision}:${repoRelativePath}`],
      { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
    );
    return buffer.toString("utf-8");
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? "");
    if (/does not exist in|exists on disk, but not in|path .* does not exist/i.test(stderr)) {
      return undefined;
    }
    throw failure(error, revision);
  }
}

/** Markdown paths that differ between `revision` and the worktree. */
export function changesSince(repository: GitRepository, revision: string): RevisionChange[] {
  const diff = git(
    repository.root,
    ["diff", "--name-status", "--find-renames", "--find-copies", revision, "--"],
    revision,
  );
  const untracked = git(repository.root, ["ls-files", "--others", "--exclude-standard"], revision);

  const changes: RevisionChange[] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split("\t");
    const code = parts[0][0] as RevisionStatus;
    const similarity = Number(parts[0].slice(1));
    if (code === "R" || code === "C") {
      changes.push({
        status: code,
        oldPath: parts[1],
        newPath: parts[2],
        ...(Number.isInteger(similarity) ? { similarity } : {}),
      });
    } else if (code === "D") {
      changes.push({ status: "D", oldPath: parts[1] });
    } else if (code === "A") {
      changes.push({ status: "A", newPath: parts[1] });
    } else if (code === "M") {
      changes.push({ status: "M", oldPath: parts[1], newPath: parts[1] });
    }
  }
  for (const name of untracked.split(/\r?\n/).filter(Boolean)) {
    changes.push({ status: "A", newPath: name });
  }

  return changes
    .filter((change) => MARKDOWN.test(change.newPath ?? change.oldPath ?? ""))
    .sort((a, b) => {
      const left = a.newPath ?? a.oldPath ?? "";
      const right = b.newPath ?? b.oldPath ?? "";
      return left < right ? -1 : left > right ? 1 : 0;
    });
}
