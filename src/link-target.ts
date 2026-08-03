import path from "node:path";

export interface LocalTarget {
  rawPath: string;
  path: string;
  query: string;
  rawFragment?: string;
  fragment?: string;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function splitLocalTarget(target: string): LocalTarget {
  const hash = target.indexOf("#");
  const beforeFragment = hash === -1 ? target : target.slice(0, hash);
  const rawFragment = hash === -1 ? undefined : target.slice(hash + 1);
  const question = beforeFragment.indexOf("?");
  const rawPath = question === -1 ? beforeFragment : beforeFragment.slice(0, question);
  const query = question === -1 ? "" : beforeFragment.slice(question);
  return {
    rawPath,
    path: decode(rawPath),
    query,
    ...(rawFragment === undefined ? {} : { rawFragment, fragment: decode(rawFragment) }),
  };
}

export function resolveLocalPath(
  sourceFile: string,
  targetPath: string,
  workspaceRoot: string,
): string {
  if (targetPath.startsWith("/")) return path.resolve(workspaceRoot, `.${targetPath}`);
  return path.resolve(path.dirname(sourceFile), targetPath);
}

/** Percent-encodes a path, including the `#` that `encodeURI` leaves literal. */
export function encodePath(value: string, encoded: boolean): string {
  return encoded ? encodeURI(value).replace(/#/g, "%23") : value;
}

/**
 * How a link target was spelled, so a rewrite can preserve it.
 *
 * Whether a target is written `./x.md` or `x.md`, and whether it is
 * percent-encoded, are authoring choices rather than correctness properties.
 * Normalizing them would rewrite every link in a repository on first run.
 */
export interface TargetStyle {
  /** The path contained `%`, so a rewrite re-encodes. */
  encoded: boolean;
  /** The raw destination text contained `\`, so `(` and `)` are re-escaped. */
  escapedParens: boolean;
  /** The path began with `/` and is therefore workspace-root-relative. */
  rootRelative: boolean;
  /** The path began with `./`. */
  dotSlash: boolean;
}

export function targetStyle(rawTarget: string, rawDestinationText = rawTarget): TargetStyle {
  const { rawPath } = splitLocalTarget(rawTarget);
  return {
    encoded: rawPath.includes("%"),
    escapedParens: rawDestinationText.includes("\\"),
    rootRelative: rawPath.startsWith("/"),
    dotSlash: rawPath.startsWith("./"),
  };
}

/** Rebuilds `<path><query>[#fragment]` in the original target's style. */
export function composeTarget(nextPath: string, split: LocalTarget, style: TargetStyle): string {
  let value = nextPath;
  if (!style.rootRelative && style.dotSlash && !value.startsWith(".")) value = `./${value}`;
  value = encodePath(value, style.encoded);
  const suffix = split.query + (split.rawFragment === undefined ? "" : `#${split.rawFragment}`);
  return value + suffix;
}

/**
 * Re-escapes parentheses when the original destination was written escaped.
 *
 * Applied after any comparison against the original target, since the escaping
 * is a property of the surrounding link syntax rather than of the target itself.
 */
export function escapeTargetParens(value: string, style: TargetStyle): string {
  return style.escapedParens ? value.replace(/[()]/g, (character) => `\\${character}`) : value;
}

export function replaceFragment(target: string, newFragment: string): string {
  const hash = target.indexOf("#");
  if (hash === -1) return target;
  const old = target.slice(hash + 1);
  const replacement = old.includes("%") ? encodeURIComponent(newFragment) : newFragment;
  return `${target.slice(0, hash + 1)}${replacement}`;
}
