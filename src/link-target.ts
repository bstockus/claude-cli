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

export function replaceFragment(target: string, newFragment: string): string {
  const hash = target.indexOf("#");
  if (hash === -1) return target;
  const old = target.slice(hash + 1);
  const replacement = old.includes("%") ? encodeURIComponent(newFragment) : newFragment;
  return `${target.slice(0, hash + 1)}${replacement}`;
}
