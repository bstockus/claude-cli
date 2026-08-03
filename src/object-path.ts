export interface NestedValueOptions {
  /**
   * Whether a path segment may index into an array.
   *
   * The two call sites this replaces disagree, and both shapes are published:
   * `md frontmatter --key items.0` has always resolved, while
   * `md query duplicates --field frontmatter:items.0` has always returned
   * nothing. Preserved as a flag rather than unified — changing either is a
   * behavior change on a shipped command.
   */
  arrays?: boolean;
}

/** Resolves a dotted path against parsed frontmatter. */
export function nestedValue(
  value: unknown,
  keyPath: string,
  options: NestedValueOptions = {},
): unknown {
  const arrays = options.arrays ?? true;
  let current = value;
  for (const part of keyPath.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (!arrays && Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
