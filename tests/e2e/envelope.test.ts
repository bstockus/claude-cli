import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { SCHEMA_BY_ID } from "../../src/contract/schemas/index.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");
const fixtures = path.resolve("tests/fixtures");
const temporary: string[] = [];

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await exec("node", [cli, ...args], { env: { ...process.env, CI: "1" } });
    return { ...result, code: 0 };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code ?? 1 };
  }
}

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-e2e-"));
  temporary.push(root);
  fs.writeFileSync(path.join(root, "index.md"), "# Index\n\n- [Clean](./clean.md)\n");
  fs.writeFileSync(path.join(root, "clean.md"), "# Clean\n\n- [ ] Pending\n");
  return root;
}

function bundle(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-bundle-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "skills", "hello"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "agent-bundle.yaml"),
    "schemaVersion: '1'\nname: hello\nversion: 1.0.0\ndescription: Hello bundle\n",
  );
  fs.writeFileSync(
    path.join(root, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Say hello\n---\nSay hello.\n",
  );
  return root;
}

const envelopeSchema = SCHEMA_BY_ID.get("envelope")!.schema;
const validateEnvelope = new Ajv2020({ allErrors: true, strict: false }).compile(envelopeSchema);

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("--envelope", () => {
  it("wraps without changing the payload", async () => {
    const context = { workspace: workspace(), bundle: bundle() };
    const commands: string[][] = [
      ["md", "graph", context.workspace],
      ["md", "stats", path.join(fixtures, "clean.md")],
      ["md", "query", "tasks", context.workspace],
      ["md", "lint", path.join(fixtures, "clean.md")],
      ["md", "lint", path.join(fixtures, "mixed-errors.md")],
      ["md", "orphans", context.workspace],
      ["md", "index", "status", context.workspace],
      ["md", "headers", path.join(fixtures, "clean.md")],
      ["md", "toc", path.join(fixtures, "clean.md")],
      ["agent", "inspect", context.bundle],
      ["agent", "specs", "--target", "all"],
    ];

    for (const command of commands) {
      const plain = await run(...command, "--format", "json");
      const wrapped = await run(...command, "--format", "json", "--envelope");
      const label = command.join(" ");

      // The exit code and the stream carrying the payload must not change.
      expect(wrapped.code, `${label}: exit code changed`).toBe(plain.code);
      const plainOut = plain.stdout.trim() || plain.stderr.trim();
      const wrappedRaw = wrapped.stdout.trim() || wrapped.stderr.trim();
      expect(Boolean(wrapped.stdout.trim()), `${label}: stream changed`).toBe(
        Boolean(plain.stdout.trim()),
      );

      const envelope = JSON.parse(wrappedRaw);
      expect(
        validateEnvelope(envelope),
        `${label}: ${JSON.stringify(validateEnvelope.errors)}`,
      ).toBe(true);
      expect(envelope.schemaVersion, label).toBe("1");
      expect(envelope.command, label).toBe(
        command[0] === "md" || command[0] === "agent" ? `${command[0]} ${command[1]}` : command[0],
      );
      expect(envelope.exitCode, label).toBe(plain.code);
      expect(envelope.ok, label).toBe(plain.code === 0);
      // The whole point: unwrapping yields exactly the unenveloped output.
      expect(envelope.data, `${label}: data differs from the plain payload`).toEqual(
        JSON.parse(plainOut),
      );
    }
  });

  it("carries the schema id when one is published, and null otherwise", async () => {
    const graph = JSON.parse((await run("md", "graph", workspace(), "-fj", "--envelope")).stdout);
    expect(graph.schema).toContain("/v1/md-graph.json");
    const stats = JSON.parse(
      (await run("md", "stats", path.join(fixtures, "clean.md"), "-fj", "--envelope")).stdout,
    );
    expect(stats.schema).toBeNull();
  });

  it("requires --format json", async () => {
    for (const format of ["llm", "human", "jsonl", "sarif"]) {
      const result = await run(
        "md",
        "lint",
        path.join(fixtures, "clean.md"),
        "--format",
        format,
        "--envelope",
      );
      expect(result.code, format).toBe(1);
      expect(result.stderr, format).toMatch(/--envelope requires --format json/);
    }
  });

  it("leaves output untouched when not requested", async () => {
    const root = workspace();
    const before = await run("md", "graph", root, "-fj");
    const after = await run("md", "graph", root, "-fj");
    expect(after.stdout).toBe(before.stdout);
    expect(JSON.parse(before.stdout)).not.toHaveProperty("schemaVersion");
  });
});
