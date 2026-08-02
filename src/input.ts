import fs from "node:fs";
import path from "node:path";
import { terminate } from "./command-result.js";
import { outputPath } from "./runtime.js";

export function requireFile(value: string, options: object): string {
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
