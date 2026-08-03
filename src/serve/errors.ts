import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CommandExit } from "../command-result.js";
import { PathRejected } from "./paths.js";

/** Any `/`- or drive-rooted run of non-whitespace, once root-relative paths are out of the way. */
const ABSOLUTE = /(?:[A-Za-z]:)?[/\\][^\s"'`,;)]+/g;

/**
 * Rewrites absolute paths out of a message before it reaches the client.
 *
 * Paths under the served root become root-relative, which is the form every
 * tool result already uses. Anything still absolute is replaced outright rather
 * than shortened: those are the paths a confinement failure refused to serve,
 * and echoing one back in the error would disclose exactly what was withheld.
 */
export function scrub(message: string, root: string): string {
  const withRoot = message.split(`${root}${path.sep}`).join("").split(root).join(".");
  return withRoot.replace(ABSOLUTE, "<path outside root>");
}

/**
 * Maps a thrown error to a tool result the model can act on.
 *
 * Workspace-layer failures — a missing file, an unmatched heading, a malformed
 * query, a rejected path — are the model's to correct, so they come back as
 * `isError` content rather than as JSON-RPC errors. Protocol-level mistakes
 * (an unknown tool, arguments that fail their schema) are raised as `McpError`
 * by the caller instead and never reach here.
 *
 * `CommandExit` is caught defensively: no tool calls a command action, but a
 * stray call into `src/input.ts` would otherwise surface as an internal error.
 */
export function toolFailure(error: unknown, root: string): CallToolResult {
  const message =
    error instanceof CommandExit
      ? `Command exited with status ${error.exitCode}`
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    content: [{ type: "text", text: scrub(message, root) }],
    isError: true,
  };
}

/** Whether `error` came from confinement, which callers may want to log distinctly. */
export function isRejection(error: unknown): boolean {
  return error instanceof PathRejected;
}
