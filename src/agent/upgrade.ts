import { parseDocument } from "yaml";
import type { AgentBundle, AgentDiagnostic } from "./types.js";
import { diagnostic } from "./types.js";
import { COMPONENT_KEYS, CURRENT_BUNDLE_SCHEMA } from "./manifest.js";
import { YAML_OPTIONS } from "./scaffold.js";

export interface MigrationChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface UpgradeReport {
  /** Source schema layer, spelled as the manifest spells it. */
  from: string;
  to: string;
  changes: MigrationChange[];
  /** Items a human should decide, mirrored as AB221 notices. */
  notes: string[];
}

export interface UpgradePlan {
  report: UpgradeReport;
  /** The migrated manifest, or `null` when nothing needs to change. */
  content: Buffer | null;
  diagnostics: AgentDiagnostic[];
}

function notice(
  code: string,
  message: string,
  path: string,
  remediation?: string,
): AgentDiagnostic {
  return diagnostic(code, message, "exact", {
    path,
    ...(remediation ? { remediation } : {}),
  });
}

function error(code: string, message: string, path: string, remediation?: string): AgentDiagnostic {
  return {
    ...diagnostic(code, message, "unsupported", { path, ...(remediation ? { remediation } : {}) }),
    severity: "error",
  };
}

/**
 * Plans a 1 -> 2 migration of `agent-bundle.yaml`.
 *
 * Only the manifest is rewritten; no component file is touched. Schema 2 is a
 * strict superset of schema 1, so the migration is additive by construction —
 * which is what makes the byte-identity guarantee checkable rather than hoped
 * for. The caller verifies it by rendering before and after.
 */
export function planUpgrade(bundle: AgentBundle, source: string, to: string): UpgradePlan {
  const manifestPath = `${bundle.root}/agent-bundle.yaml`;
  const diagnostics: AgentDiagnostic[] = [];
  const report: UpgradeReport = {
    from: bundle.schemaVersion,
    to,
    changes: [],
    notes: [],
  };

  if (to !== CURRENT_BUNDLE_SCHEMA) {
    diagnostics.push(
      error(
        "AB222",
        `Unsupported target schema '${to}'`,
        manifestPath,
        `Use --to-schema ${CURRENT_BUNDLE_SCHEMA}.`,
      ),
    );
    return { report, content: null, diagnostics };
  }
  if (bundle.legacy) {
    diagnostics.push(
      error(
        "AB223",
        "A legacy Claude plugin has no neutral manifest to upgrade",
        manifestPath,
        "Run agent import to produce a portable bundle first.",
      ),
    );
    return { report, content: null, diagnostics };
  }
  if (bundle.schemaVersion === CURRENT_BUNDLE_SCHEMA) {
    diagnostics.push(notice("AB220", `Bundle is already at schemaVersion ${to}`, manifestPath));
    return { report, content: null, diagnostics };
  }

  const document = parseDocument(source);
  document.setIn(["schemaVersion"], to);
  report.changes.push({ field: "schemaVersion", from: bundle.schemaVersion, to });

  // v1 allowed component paths both at the top level and under `components`.
  // v2 prefers the nested form, so hoist them; the parser still honors either.
  for (const key of COMPONENT_KEYS) {
    const value = document.getIn([key]);
    if (value === undefined) continue;
    if (document.getIn(["components", key]) === undefined) {
      document.setIn(["components", key], value);
      report.changes.push({ field: `components.${key}`, from: undefined, to: value });
    }
    document.deleteIn([key]);
    report.changes.push({ field: key, from: value, to: undefined });
  }

  // Marketplace metadata is deliberately not synthesized. A half-filled block
  // would look like a decision nobody made, and `agent package` would then
  // report findings against values this migration invented.
  if (!bundle.marketplace) {
    report.notes.push(
      "Add a marketplace: block before packaging; displayName, categories, publisher, and license cannot be derived.",
    );
    diagnostics.push(
      notice(
        "AB221",
        "Marketplace metadata cannot be derived from a v1 bundle",
        manifestPath,
        "Add a marketplace: block before running agent package.",
      ),
    );
  }
  report.notes.push(
    "Native overlays are now available under native/<target>/; nothing was created because none existed.",
  );

  return { report, content: Buffer.from(document.toString(YAML_OPTIONS)), diagnostics };
}
