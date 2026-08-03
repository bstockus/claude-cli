import { createRequire } from "node:module";

// Read the version at runtime rather than inlining it: semantic-release rewrites
// package.json at release time, so a literal here would always be stale.
// From dist/version.js, "../package.json" is the package root — always present in the tarball.
const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
  name: string;
};

export const packageName = manifest.name;
export const packageVersion = manifest.version;
