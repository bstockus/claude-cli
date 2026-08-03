import path from "node:path";
import type { AgentDiagnostic } from "./types.js";
import type { SarifLevel, SarifResult } from "../sarif.js";
import { sarifDocument } from "../sarif.js";

/**
 * Maps a diagnostic severity to a SARIF level.
 *
 * This is the whole reason the `md` SARIF writer cannot be reused directly: it
 * emits `"error"` for everything, because an `Issue` carries no severity.
 */
export function agentSarifLevel(severity: AgentDiagnostic["severity"]): SarifLevel {
  return severity === "error" ? "error" : severity === "warning" ? "warning" : "note";
}

/**
 * Locates a diagnostic.
 *
 * A diagnostic's `path` is absolute when it came from the parser and
 * output-relative when it came from the renderer, so an absolute path inside
 * the bundle is made relative and anything else is passed through. A
 * diagnostic with no path at all is about the bundle as a whole.
 */
function uriFor(diagnostic: AgentDiagnostic, root?: string): string {
  const candidate = diagnostic.path;
  if (!candidate) return "agent-bundle.yaml";
  if (!root || !path.isAbsolute(candidate)) return candidate.split(path.sep).join("/");
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : candidate.split(path.sep).join("/");
}

/**
 * SARIF for agent diagnostics. Ends with a newline, matching the other
 * `formatResult` branches.
 *
 * No `region` is emitted: an agent diagnostic identifies a file and a
 * condition, never a line. Everything the diagnostic carries beyond the SARIF
 * core is preserved under `properties`.
 */
export function formatAgentSarif(diagnostics: readonly AgentDiagnostic[], root?: string): string {
  const ids = [...new Set(diagnostics.map((item) => item.code))].sort();
  const results: SarifResult[] = diagnostics.map((item) => ({
    ruleId: item.code,
    level: agentSarifLevel(item.severity),
    message: { text: item.message },
    locations: [{ physicalLocation: { artifactLocation: { uri: uriFor(item, root) } } }],
    properties: {
      quality: item.quality,
      ...(item.target ? { target: item.target } : {}),
      ...(item.profile ? { profile: item.profile } : {}),
      ...(item.component ? { component: item.component } : {}),
      ...(item.remediation ? { remediation: item.remediation } : {}),
    },
  }));
  return (
    sarifDocument(
      ids.map((id) => ({ id, name: id })),
      results,
    ) + "\n"
  );
}
