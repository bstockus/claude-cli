import fs from "node:fs";
import path from "node:path";

/**
 * A path argument that failed confinement, or otherwise cannot be served.
 *
 * Carries no absolute path: a rejected traversal names precisely the location
 * the server declined to disclose.
 */
export class PathRejected extends Error {}

/**
 * Resolves `root` through any symlinks, so comparisons against it are physical.
 *
 * Called once at startup. A root that does not exist is a startup failure, not
 * a per-call one.
 */
export function resolveRoot(root: string): string {
  const absolute = path.resolve(root);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error(`Root directory not found: ${absolute}`);
  }
  return fs.realpathSync(absolute);
}

/** Whether `target` is `root` or lies beneath it, compared lexically. */
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/**
 * The real path `value` names, once confined to `root`.
 *
 * Confinement is physical rather than lexical. `Workspace.inside` compares with
 * `path.relative` alone, and `Workspace.markdownFiles` admits symlinked *files*
 * even though it skips symlinked directories — so a `.md` symlink inside the
 * root pointing outside it would otherwise be served. Resolving both sides also
 * makes the comparison correct on macOS, where `/tmp` is a symlink to
 * `/private/tmp`.
 *
 * The nearest existing ancestor is resolved rather than the target itself, so a
 * path that simply does not exist reports as missing by the caller's own check
 * instead of being reported as a confinement failure.
 */
export function confine(root: string, value: string, label = "path"): string {
  if (value === "-") {
    // On a stdio server fd 0 is the JSON-RPC channel. `requireFile("-")` would
    // read it and deadlock the transport, so "-" never reaches the workspace.
    throw new PathRejected(`A ${label} of "-" is not available over MCP`);
  }
  if (value.includes("\0")) throw new PathRejected(`Invalid ${label}`);

  const absolute = path.resolve(root, value);
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = fs.existsSync(existing)
    ? path.join(fs.realpathSync(existing), path.relative(existing, absolute))
    : absolute;

  if (!within(root, real)) throw new PathRejected(`The ${label} is outside the served root`);
  return real;
}

/** Renders an absolute path relative to `root`, which is what tool results carry. */
export function relativeTo(root: string, target: string): string {
  const relative = path.relative(root, target);
  return (relative === "" ? "." : relative).split(path.sep).join("/");
}
