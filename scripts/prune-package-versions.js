/**
 * Deletes old versions of the published package from GitHub Packages, keeping
 * the newest N.
 *
 * Deliberately standalone: no build step, no dependencies. A cleanup job that
 * destroys artefacts should not be able to fail because the TypeScript build
 * broke, and it should be readable in isolation.
 *
 * Selection is pure and unit-tested in tests/unit/prune-package-versions.test.js;
 * only the HTTP calls live in main().
 */

const DEFAULT_API = "https://api.github.com";

/** @typedef {{ id: number, name: string }} PackageVersion */

/** @returns {{ core: [number, number, number], prerelease: string | null } | null} */
export function parseSemver(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(value).trim(),
  );
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] ?? null,
  };
}

/** Ascending comparator. Unparseable input must be filtered out before calling. */
export function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Cannot compare unparseable versions: ${a} / ${b}`);

  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  // Same core: a prerelease sorts below its final release.
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/**
 * Splits versions into those to keep and those to delete.
 *
 * Anything whose name is not valid semver is never deleted and never counted
 * toward the keep quota. For an irreversible operation, silently discarding
 * something we could not parse is the worst possible failure mode.
 *
 * @param {PackageVersion[]} versions
 * @param {number} keepCount
 */
export function planPrune(versions, keepCount) {
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    throw new Error(`keepCount must be a positive integer, got: ${keepCount}`);
  }

  const parseable = [];
  const unparseable = [];
  for (const v of versions) {
    if (parseSemver(v.name)) parseable.push(v);
    else unparseable.push(v);
  }

  const newestFirst = [...parseable].sort((a, b) => compareVersions(b.name, a.name));

  return {
    keep: newestFirst.slice(0, keepCount),
    remove: newestFirst.slice(keepCount),
    unparseable,
  };
}

async function ghRequest(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function fetchAllVersions(api, packageName, token) {
  /** @type {PackageVersion[]} */
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${api}/user/packages/npm/${encodeURIComponent(packageName)}/versions?per_page=100&page=${page}`;
    const res = await ghRequest(url, token);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Listing versions failed (HTTP ${res.status}): ${body.slice(0, 400)}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch.map((v) => ({ id: v.id, name: v.name })));
    if (batch.length < 100) break;
  }
  return all;
}

async function deleteVersion(api, packageName, id, token) {
  const url = `${api}/user/packages/npm/${encodeURIComponent(packageName)}/versions/${id}`;
  const res = await ghRequest(url, token, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Deleting version ${id} failed (HTTP ${res.status}): ${body.slice(0, 400)}`);
  }
}

async function main() {
  const token = process.env.GH_TOKEN;
  const packageName = process.env.PACKAGE_NAME;
  const keepCount = Number(process.env.KEEP ?? "3");
  const dryRun = process.env.DRY_RUN !== "false";
  const api = process.env.GITHUB_API_URL || DEFAULT_API;

  if (!token) throw new Error("GH_TOKEN is required (needs read:packages and delete:packages).");
  if (!packageName) throw new Error("PACKAGE_NAME is required.");

  const versions = await fetchAllVersions(api, packageName, token);
  console.log(`Found ${versions.length} version(s) of ${packageName}.`);

  const { keep, remove, unparseable } = planPrune(versions, keepCount);

  for (const v of keep) console.log(`  keep    ${v.name}`);
  for (const v of unparseable) console.log(`  keep    ${v.name}  (unrecognised version format)`);
  for (const v of remove) console.log(`  ${dryRun ? "would delete" : "DELETE "} ${v.name}`);

  if (remove.length === 0) {
    console.log(
      `Nothing to prune; ${keep.length} version(s) within the keep limit of ${keepCount}.`,
    );
    return;
  }

  if (dryRun) {
    console.log(`\nDry run: ${remove.length} version(s) would be deleted. Nothing was changed.`);
    return;
  }

  for (const v of remove) {
    await deleteVersion(api, packageName, v.id, token);
    console.log(`Deleted ${v.name}`);
  }
  console.log(`\nPruned ${remove.length} version(s); kept ${keep.length + unparseable.length}.`);
}

// Only run when invoked directly, so the module stays importable by tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
