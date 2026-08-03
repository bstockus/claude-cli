import { requireDirectory } from "../input.js";
import { outputPath, runtime } from "../runtime.js";
import { jsonPayload } from "../result.js";

interface IndexOptions {
  envelope?: boolean;
  format: string;
  include: string[];
  exclude: string[];
}

export async function indexAction(
  action: string,
  directory: string,
  opts: IndexOptions,
): Promise<void> {
  if (!["status", "build", "clear"].includes(action)) {
    throw new Error("Index action must be status, build, or clear");
  }
  const dir = requireDirectory(directory, opts);
  if (action === "clear") {
    runtime().workspace.clearIndex();
    const result = { action, directory: outputPath(dir, opts), cleared: true };
    process.stdout.write(
      opts.format === "json"
        ? jsonPayload("md index", result, opts)
        : `Cleared workspace index for ${result.directory}\n`,
    );
    return;
  }
  const files = runtime().workspace.markdownFiles(dir, {
    include: opts.include,
    exclude: opts.exclude,
  });
  const status =
    action === "build"
      ? runtime().workspace.rebuildIndex(dir, files)
      : runtime().workspace.indexStatus(files);
  const result = { action, directory: outputPath(dir, opts), ...status };
  if (opts.format === "json") {
    process.stdout.write(jsonPayload("md index", result, opts));
    return;
  }
  const prefix = action === "build" ? "Built" : "Workspace index";
  process.stdout.write(
    `${prefix} for ${result.directory}: ${status.current} current, ${status.stale} stale, ${status.missing} missing (${status.indexed} indexed)\nCache: ${status.cachePath}\n`,
  );
}
