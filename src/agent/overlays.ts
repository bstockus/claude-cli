import fs from "node:fs";
import path from "node:path";
import type {
  AgentDiagnostic,
  AgentProfile,
  AgentTarget,
  Artifact,
  NativeOverlay,
  SourceFile,
} from "./types.js";
import { diagnostic } from "./types.js";
import type { NativeOverlayDeclaration } from "./manifest.js";
import { profileFor } from "./targets/index.js";

const PROFILES: AgentProfile[] = ["plugin", "project"];

/** File name of the optional plugin-manifest fragment inside an overlay root. */
export const OVERLAY_MANIFEST = "manifest.json";

/** Root-level files that document the overlay rather than contributing output. */
const IGNORED_AT_ROOT = new Set(["README.md", "readme.md"]);

function error(
  diagnostics: AgentDiagnostic[],
  code: string,
  message: string,
  extra: Partial<AgentDiagnostic>,
): void {
  diagnostics.push({
    ...diagnostic(code, message, "unsupported", extra),
    severity: "error",
  });
}

/**
 * Rejects an overlay path that would escape its target output root.
 *
 * `allFiles` already refuses symlinks that leave the directory it walks, so
 * this is a second, purely lexical check. The invariant is promised at the
 * output boundary, so it is enforced there rather than inferred from the
 * filesystem walk.
 */
export function safeOverlayOutputPath(relative: string): string | null {
  const normalized = relative.split(path.sep).join("/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null;
  if (normalized.includes("\\")) return null;
  if (normalized.split("/").some((segment) => segment === ".." || segment === ".")) return null;
  return normalized;
}

function readOverlayFiles(directory: string): SourceFile[] {
  const files: SourceFile[] = [];
  const visit = (current: string): void => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      // Refuse a symlink that leaves the overlay root before reading it.
      if (entry.isSymbolicLink()) {
        const real = fs.realpathSync(full);
        const relative = path.relative(fs.realpathSync(directory), real);
        if (relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error(`Overlay symlink escapes its root: ${full}`);
      }
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory()))
        visit(full);
      else
        files.push({
          path: path.relative(directory, full),
          content: fs.readFileSync(full),
          mode: fs.statSync(full).mode & 0o777,
        });
    }
  };
  visit(directory);
  return files;
}

/**
 * Loads the declared native overlays for a bundle.
 *
 * Overlay content is deliberately **not** run through `processTargetBlocks` or
 * `rewritePlaceholders`. It is already native and target-specific; rewriting it
 * would be the exact "pretend it is portable" failure the overlay layer exists
 * to avoid.
 */
export function loadOverlays(
  root: string,
  declarations: NativeOverlayDeclaration[],
  manifestPath: string,
  diagnostics: AgentDiagnostic[],
): NativeOverlay[] {
  const overlays: NativeOverlay[] = [];
  for (const declaration of declarations) {
    const target = declaration.target;
    const overlayRoot = path.resolve(root, declaration.root);
    const relative = path.relative(root, overlayRoot);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      error(diagnostics, "AB183", `Native overlay root escapes the bundle: ${declaration.root}`, {
        target,
        path: manifestPath,
        remediation: "Keep the overlay root inside the bundle.",
      });
      continue;
    }
    if (!fs.existsSync(overlayRoot) || !fs.statSync(overlayRoot).isDirectory()) continue;

    const supported = profileFor(target).profiles;
    const files: Record<AgentProfile, SourceFile[]> = { plugin: [], project: [] };
    let manifest: Record<string, unknown> | undefined;

    for (const entry of fs
      .readdirSync(overlayRoot, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.isFile() && entry.name === OVERLAY_MANIFEST) {
        try {
          const parsed: unknown = JSON.parse(
            fs.readFileSync(path.join(overlayRoot, entry.name), "utf8"),
          );
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("must be a JSON object");
          manifest = parsed as Record<string, unknown>;
        } catch (cause) {
          error(
            diagnostics,
            "AB182",
            `Native overlay manifest fragment is invalid: ${(cause as Error).message}`,
            { target, path: path.join(overlayRoot, entry.name) },
          );
        }
        continue;
      }
      if (!entry.isDirectory()) {
        // Documentation and VCS scaffolding at the overlay root are ignored
        // rather than rejected — an overlay is a directory people maintain by
        // hand, and `agent init` writes a README explaining the contract.
        if (IGNORED_AT_ROOT.has(entry.name) || entry.name.startsWith(".")) continue;
        // Anything else has no output profile to belong to. Reporting it beats
        // silently dropping a file the author expected to be emitted.
        error(
          diagnostics,
          "AB186",
          `Native overlay entry '${entry.name}' is not an output profile directory`,
          {
            target,
            path: path.join(overlayRoot, entry.name),
            remediation: `Place it under ${PROFILES.join("/ or ")}/.`,
          },
        );
        continue;
      }
      if (!PROFILES.includes(entry.name as AgentProfile)) {
        error(
          diagnostics,
          "AB186",
          `Native overlay directory '${entry.name}' is not an output profile`,
          {
            target,
            path: path.join(overlayRoot, entry.name),
            remediation: `Use ${PROFILES.join(" or ")}.`,
          },
        );
        continue;
      }
      const profile = entry.name as AgentProfile;
      if (!supported.includes(profile)) {
        diagnostics.push(
          diagnostic(
            "AB187",
            `Native overlay declares the '${profile}' profile, which ${target} does not support`,
            "unsupported",
            { target, profile, path: path.join(overlayRoot, entry.name) },
          ),
        );
        continue;
      }
      for (const file of readOverlayFiles(path.join(overlayRoot, profile))) {
        const output = safeOverlayOutputPath(file.path);
        if (output === null) {
          error(diagnostics, "AB183", `Native overlay path escapes the target root: ${file.path}`, {
            target,
            profile,
            path: path.join(overlayRoot, profile, file.path),
          });
          continue;
        }
        files[profile].push({ ...file, path: output });
      }
    }

    if (!files.plugin.length && !files.project.length && !manifest) continue;
    overlays.push({ target, root: overlayRoot, files, manifest, onCollision: "overlay-wins" });
  }
  return overlays;
}

/** The overlay artifacts for one target and output profile, in path order. */
export function overlayArtifacts(
  overlay: NativeOverlay | undefined,
  profile: AgentProfile,
): Artifact[] {
  if (!overlay) return [];
  return overlay.files[profile]
    .map((file) => ({
      path: file.path,
      content: file.content,
      mode: file.mode,
      origin: "native" as const,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Merges overlay artifacts into the portable set for one target and profile.
 *
 * Returns `portable` untouched when there is no overlay, so a bundle without
 * one cannot be affected by this code path at all.
 */
export function mergeOverlay(
  portable: Artifact[],
  overlay: Artifact[],
  onCollision: NativeOverlay["onCollision"],
  target: AgentTarget,
  profile: AgentProfile,
  diagnostics: AgentDiagnostic[],
): Artifact[] {
  if (!overlay.length) return portable;
  // Keyed by path rather than positional, so the result cannot depend on the
  // order the two lists happen to arrive in.
  const merged = new Map(portable.map((artifact) => [artifact.path, artifact]));
  for (const artifact of overlay) {
    if (!merged.has(artifact.path)) {
      merged.set(artifact.path, artifact);
      continue;
    }
    if (onCollision === "error") {
      error(
        diagnostics,
        "AB181",
        `Native overlay collides with the portable artifact at '${artifact.path}'`,
        {
          target,
          profile,
          path: artifact.path,
          remediation:
            "Rename the overlay file, remove the portable component, or set onCollision: overlay-wins.",
        },
      );
      continue;
    }
    diagnostics.push(
      diagnostic(
        "AB181",
        `Native overlay replaces the portable artifact at '${artifact.path}'`,
        "approximate",
        {
          target,
          profile,
          path: artifact.path,
          remediation: "Remove the portable component if the override is permanent.",
        },
      ),
    );
    merged.set(artifact.path, artifact);
  }
  return [...merged.values()];
}

/**
 * Merges an overlay manifest fragment over the generated plugin manifest.
 *
 * Applied to the object before the manifest artifact is built, so there is
 * exactly one manifest artifact and no path collision to resolve.
 */
export function applyOverlayManifest(
  generated: Record<string, unknown>,
  fragment: Record<string, unknown> | undefined,
  target: AgentTarget,
  diagnostics: AgentDiagnostic[],
): Record<string, unknown> {
  if (!fragment) return generated;
  if (profileFor(target).manifest.directory === null) {
    error(diagnostics, "AB182", `${target} has no plugin manifest to merge an overlay into`, {
      target,
      profile: "plugin",
    });
    return generated;
  }
  const merged = { ...generated };
  for (const [key, value] of Object.entries(fragment)) {
    if (key in generated)
      diagnostics.push(
        diagnostic(
          "AB182",
          `Native overlay manifest overrides the generated '${key}' field`,
          "approximate",
          { target, profile: "plugin", remediation: "Remove the key to keep the generated value." },
        ),
      );
    merged[key] = value;
  }
  return merged;
}
