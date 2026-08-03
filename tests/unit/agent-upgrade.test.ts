import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planUpgrade } from "../../src/agent/upgrade.js";
import { loadBundle } from "../../src/agent/parser.js";
import { renderBundle } from "../../src/agent/render.js";
import { TARGETS } from "../../src/agent/types.js";
import type { AgentProfile } from "../../src/agent/types.js";

const temporary: string[] = [];
const PROFILES: AgentProfile[] = ["plugin", "project"];

function bundle(manifest: string, extra: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-upgrade-"));
  temporary.push(root);
  fs.writeFileSync(path.join(root, "agent-bundle.yaml"), manifest);
  fs.mkdirSync(path.join(root, "skills", "hello"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Say hello\n---\n\nSay hello.\n",
  );
  for (const [relative, content] of Object.entries(extra)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function plan(root: string, to = "2") {
  const source = fs.readFileSync(path.join(root, "agent-bundle.yaml"), "utf8");
  return planUpgrade(loadBundle(root), source, to);
}

const V1 = "schemaVersion: '1'\nname: demo\nversion: 1.0.0\ndescription: A demo\n";

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("planUpgrade", () => {
  it("bumps the schema version and records the change", () => {
    const result = plan(bundle(V1));
    expect(result.content).not.toBeNull();
    expect(result.content?.toString()).toContain("schemaVersion: '2'");
    expect(result.report).toMatchObject({ from: "1", to: "2" });
    expect(result.report.changes).toContainEqual({
      field: "schemaVersion",
      from: "1",
      to: "2",
    });
  });

  it("hoists top-level component paths under components", () => {
    const result = plan(bundle(V1 + "skills: lib/skills\n"));
    const output = result.content?.toString() ?? "";
    expect(output).toContain("components:");
    expect(output).toContain("skills: lib/skills");
    expect(output.split("\n").filter((line) => line.startsWith("skills:"))).toEqual([]);
    expect(result.report.changes.map((change) => change.field)).toContain("components.skills");
  });

  it("keeps an existing components entry rather than overwriting it", () => {
    const result = plan(bundle(V1 + "skills: top\ncomponents:\n  skills: nested\n"));
    expect(result.content?.toString()).toContain("skills: nested");
    expect(result.content?.toString()).not.toContain("skills: top");
  });

  it("preserves comments through the migration", () => {
    const result = plan(bundle("# keep me\n" + V1));
    expect(result.content?.toString()).toContain("# keep me");
  });

  it("does not synthesize marketplace metadata, and says so", () => {
    // A half-filled block would look like a decision nobody made, and would
    // then produce agent package findings against invented values.
    const result = plan(bundle(V1));
    expect(result.content?.toString()).not.toContain("marketplace:");
    expect(result.diagnostics.map((item) => item.code)).toContain("AB221");
    expect(result.report.notes.join(" ")).toMatch(/marketplace/);
  });

  it("reports an already-current bundle with AB220 and plans no write", () => {
    const result = plan(bundle(V1.replace("'1'", "'2'")));
    expect(result.content).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toEqual(["AB220"]);
    expect(result.diagnostics[0].severity).toBe("notice");
  });

  it("refuses an unsupported target schema with AB222", () => {
    const result = plan(bundle(V1), "3");
    expect(result.content).toBeNull();
    expect(result.diagnostics.map((item) => [item.code, item.severity])).toEqual([
      ["AB222", "error"],
    ]);
  });

  it("refuses a legacy plugin with AB223", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-upgrade-legacy-"));
    temporary.push(root);
    fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "legacy", version: "1.0.0", description: "Legacy" }),
    );
    const result = planUpgrade(loadBundle(root), "", "2");
    expect(result.content).toBeNull();
    expect(result.diagnostics.map((item) => [item.code, item.severity])).toEqual([
      ["AB223", "error"],
    ]);
  });
});

describe("the migration never changes generated output", () => {
  // Schema 2 is a strict superset of schema 1, so this must hold for every
  // bundle. The command enforces it at runtime too, via AB224.
  const fixtures = path.resolve("tests/fixtures/agent/conformance");

  for (const name of ["minimal", "full", "overrides"]) {
    it(`renders the ${name} fixture identically before and after`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `agent-upgrade-${name}-`));
      temporary.push(root);
      fs.cpSync(path.join(fixtures, name, "bundle"), root, { recursive: true });

      const render = () =>
        renderBundle(loadBundle(root), [...TARGETS], PROFILES)
          .artifacts.map(
            (artifact) =>
              `${artifact.path} ${artifact.mode} ${artifact.content.toString("base64")}`,
          )
          .sort();

      const before = render();
      const result = plan(root);
      expect(result.content).not.toBeNull();
      fs.writeFileSync(path.join(root, "agent-bundle.yaml"), result.content!);
      expect(render()).toEqual(before);
      expect(loadBundle(root).schemaVersion).toBe("2");
    });
  }
});
