import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONVERSION_REPORT, diffOutput, outputMatches } from "../../src/agent/output.js";
import type { Artifact } from "../../src/agent/types.js";

const temporary: string[] = [];

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const artifacts: Artifact[] = [
  {
    path: "claude-code/plugin/skills/hello/SKILL.md",
    content: Buffer.from("hello\n"),
    mode: 0o644,
  },
  { path: "claude-code/plugin/hooks/run.sh", content: Buffer.from("#!/bin/sh\n"), mode: 0o755 },
  { path: CONVERSION_REPORT, content: Buffer.from('{"generator":"a"}\n'), mode: 0o644 },
];

function tree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-output-"));
  temporary.push(root);
  for (const artifact of artifacts) {
    const file = path.join(root, artifact.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, artifact.content, { mode: artifact.mode });
    fs.chmodSync(file, artifact.mode);
  }
  return root;
}

const diff = (root: string) => diffOutput(root, artifacts, ["claude-code"], ["plugin"]);

describe("diffOutput", () => {
  it("reports a matching tree as clean", () => {
    const result = diff(tree());
    expect(result).toEqual({ missing: [], changed: [], unmanaged: [] });
    expect(outputMatches(result)).toBe(true);
  });

  it("reports a deleted artifact as missing", () => {
    const root = tree();
    fs.rmSync(path.join(root, "claude-code/plugin/skills/hello/SKILL.md"));
    expect(diff(root).missing).toEqual(["claude-code/plugin/skills/hello/SKILL.md"]);
  });

  it("reports an edited artifact as changed", () => {
    const root = tree();
    fs.appendFileSync(path.join(root, "claude-code/plugin/skills/hello/SKILL.md"), "drift\n");
    expect(diff(root).changed).toEqual(["claude-code/plugin/skills/hello/SKILL.md"]);
  });

  it("reports a mode change as changed", () => {
    const root = tree();
    fs.chmodSync(path.join(root, "claude-code/plugin/hooks/run.sh"), 0o644);
    expect(diff(root).changed).toEqual(["claude-code/plugin/hooks/run.sh"]);
  });

  it("reports an extra file as unmanaged", () => {
    const root = tree();
    fs.writeFileSync(path.join(root, "claude-code/plugin/stray.txt"), "stray\n");
    expect(diff(root).unmanaged).toEqual(["claude-code/plugin/stray.txt"]);
  });

  it("reports an absent target root as missing", () => {
    const root = tree();
    fs.rmSync(path.join(root, "claude-code/plugin"), { recursive: true });
    expect(diff(root).missing).toContain("claude-code/plugin");
  });

  it("compares the conversion report by existence, not by bytes", () => {
    const root = tree();
    // The report embeds the generator version, so a CLI upgrade rewrites it.
    // Treating that as drift would report every tree as stale after an upgrade.
    fs.writeFileSync(path.join(root, CONVERSION_REPORT), '{"generator":"different"}\n');
    expect(outputMatches(diff(root))).toBe(true);
    fs.rmSync(path.join(root, CONVERSION_REPORT));
    expect(diff(root).missing).toEqual([CONVERSION_REPORT]);
  });
});
