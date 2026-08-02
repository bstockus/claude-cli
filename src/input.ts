import fs from "node:fs";
import path from "node:path";
import { terminate } from "./command-result.js";
import { outputPath, runtime } from "./runtime.js";

export function requireFile(value: string, options: object): string {
  if (value === "-") {
    const opts = options as { stdinName?: string; write?: boolean };
    if (opts.write) {
      process.stderr.write("Error: stdin cannot be used with a command that writes files\n");
      terminate(1);
    }
    const filePath = path.resolve(opts.stdinName ?? path.join(runtime().config.root, "stdin.md"));
    const content = fs.readFileSync(0, "utf-8");
    runtime().workspace.registerDocument(filePath, content);
    return filePath;
  }
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    process.stderr.write(`Error: File not found: ${outputPath(filePath, options)}\n`);
    terminate(1);
  }
  return filePath;
}

export function requireDirectory(value: string, options: object): string {
  const directory = path.resolve(value);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    process.stderr.write(`Error: Directory not found: ${outputPath(directory, options)}\n`);
    terminate(1);
  }
  return directory;
}
