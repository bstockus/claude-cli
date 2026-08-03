import { exec as execShell, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { COMMAND_CONTRACTS } from "../../src/contract/registry.js";
import { SCHEMA_BY_ID } from "../../src/contract/schemas/index.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");
const fixtures = path.resolve("tests/fixtures");
const temporary: string[] = [];
const addFormats = addFormatsImport as unknown as (instance: Ajv2020) => Ajv2020;

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(...args: string[]): Promise<Run> {
  // A non-zero exit arrives as a rejection, so the exit code comes from here.
  try {
    const result = await exec("node", [cli, ...args], { env: { ...process.env, CI: "1" } });
    return { ...result, exitCode: 0 };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.code ?? 1 };
  }
}

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contract-e2e-"));
  temporary.push(root);
  fs.writeFileSync(path.join(root, "index.md"), "# Index\n\n- [Clean](./clean.md)\n");
  fs.writeFileSync(path.join(root, "clean.md"), "# Clean\n\n- [x] Done\n- [ ] Pending\n");
  fs.writeFileSync(path.join(root, "loner.md"), "# Loner\n\nNothing links here.\n");
  return root;
}

function bundle(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contract-bundle-"));
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

function validate(schemaId: string, payload: unknown, label: string): void {
  const entry = SCHEMA_BY_ID.get(schemaId);
  expect(entry, `${label}: schema ${schemaId} is not published`).toBeDefined();
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
  const check = ajv.compile(entry!.schema);
  const valid = check(payload);
  expect(valid, `${label}: ${ajv.errorsText(check.errors, { separator: "; " })}`).toBe(true);
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("describe", () => {
  it("describes the whole CLI", async () => {
    const result = await run("describe", "--format", "json");
    expect(result.exitCode).toBe(0);
    const described = JSON.parse(result.stdout);
    expect(described.schemaVersion).toBe("1");
    const ids = described.commands.map((command: { id: string }) => command.id);
    for (const id of ["md graph", "agent convert", "agent doctor", "describe", "schema"])
      expect(ids).toContain(id);
    // The internal cache refresh is hidden and must not be described.
    expect(ids).not.toContain("__refresh-update-cache");
  });

  it("is self-consistent with its own published schema", async () => {
    const result = await run("describe", "-fj");
    validate("describe", JSON.parse(result.stdout), "describe");
  });

  it("matches the registry in both directions", async () => {
    const result = await run("describe", "-fj");
    const described = JSON.parse(result.stdout) as {
      commands: Array<{ id: string; stability: string }>;
    };
    // Leaf commands are the ones a contract applies to; groups are containers.
    const groups = new Set(["md", "agent"]);
    const walked = described.commands
      .map((command) => command.id)
      .filter((id) => !groups.has(id))
      .sort();
    expect(walked).toEqual(Object.keys(COMMAND_CONTRACTS).sort());
    const undeclared = described.commands.filter(
      (command) => !groups.has(command.id) && command.stability === "undeclared",
    );
    expect(undeclared.map((command) => command.id)).toEqual([]);
  });

  it("narrows to a single command path", async () => {
    const result = await run("describe", "md", "graph", "--format", "json");
    expect(result.exitCode).toBe(0);
    const described = JSON.parse(result.stdout);
    expect(described.commands).toHaveLength(1);
    expect(described.commands[0].id).toBe("md graph");
    expect(described.commands[0].usage).toContain("md graph");
  });

  it("survives a reader that closes the pipe early", async () => {
    // describe is ~150KB, past the pipe buffer, so its write completes
    // asynchronously. `describe -fj | head` and `| jq '.commands[0]'` are normal
    // usage and must not surface an unhandled EPIPE.
    const { stdout, stderr } = await promisify(execShell)(
      `node ${JSON.stringify(cli)} describe --format json | head -c 200`,
      { env: { ...process.env, CI: "1" } },
    );
    expect(stderr).not.toMatch(/EPIPE/);
    expect(stdout.startsWith("{")).toBe(true);
  });

  it("rejects an unknown command path and an unsupported format", async () => {
    const unknown = await run("describe", "md", "nope");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown command/);
    expect((await run("describe", "--format", "sarif")).exitCode).toBe(1);
  });
});

describe("schema", () => {
  it("lists the published schemas", async () => {
    const result = await run("schema", "--format", "json");
    expect(result.exitCode).toBe(0);
    const listing = JSON.parse(result.stdout);
    validate("schema-list", listing, "schema listing");
    expect(listing.schemas.map((entry: { id: string }) => entry.id)).toContain("agent-result");
  });

  it("retrieves a schema document regardless of format", async () => {
    for (const args of [
      ["schema", "md-graph"],
      ["schema", "md-graph", "--format", "human"],
    ]) {
      const result = await run(...args);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).$id).toContain("/v1/md-graph.json");
    }
  });

  it("rejects an unknown id", async () => {
    const result = await run("schema", "nope");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Unknown schema id/);
  });
});

describe("declared output schemas match real output", () => {
  interface Case {
    label: string;
    schema: string;
    args: (context: { workspace: string; bundle: string }) => string[];
    outcome: "success" | "findings";
    exitCode: number;
  }

  const cases: Case[] = [
    {
      label: "md lint (clean)",
      schema: "issue-list",
      args: () => ["md", "lint", path.join(fixtures, "clean.md"), "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md lint (findings)",
      schema: "issue-list",
      args: () => ["md", "lint", path.join(fixtures, "mixed-errors.md"), "-fj"],
      outcome: "findings",
      exitCode: 2,
    },
    {
      label: "md lint-dir --summary",
      schema: "lint-dir-summary",
      args: (c) => ["md", "lint-dir", c.workspace, "--summary", "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md graph",
      schema: "md-graph",
      args: (c) => ["md", "graph", c.workspace, "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md audit",
      schema: "md-audit",
      args: (c) => ["md", "audit", c.workspace, "--no-external", "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md audit --no-graph",
      schema: "md-audit",
      args: (c) => ["md", "audit", c.workspace, "--no-external", "--no-graph", "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md query tasks",
      schema: "md-query",
      args: (c) => ["md", "query", "tasks", c.workspace, "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md query links-to",
      schema: "md-query",
      args: (c) => ["md", "query", "links-to", c.workspace, "--target", "clean.md", "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md query duplicates",
      schema: "md-query",
      args: (c) => ["md", "query", "duplicates", c.workspace, "--field", "title", "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md check-urls (no external urls)",
      schema: "md-check-urls",
      args: () => ["md", "check-urls", path.join(fixtures, "clean.md"), "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "md orphans",
      schema: "md-orphans",
      args: (c) => ["md", "orphans", c.workspace, "-fj"],
      outcome: "findings",
      exitCode: 2,
    },
    {
      label: "md index status",
      schema: "md-index",
      args: (c) => ["md", "index", "status", c.workspace, "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "agent inspect",
      schema: "agent-result",
      args: (c) => ["agent", "inspect", c.bundle, "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "agent convert --dry-run",
      schema: "agent-result",
      args: (c) => [
        "agent",
        "convert",
        c.bundle,
        "--target",
        "all",
        "--output",
        path.join(c.workspace, "out"),
        "--dry-run",
        "-fj",
      ],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "agent doctor",
      schema: "agent-result",
      args: (c) => ["agent", "doctor", c.bundle, "--target", "all", "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "agent specs",
      schema: "agent-result",
      args: () => ["agent", "specs", "--target", "all", "-fj"],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "agent validate (invocation failure)",
      schema: "agent-result",
      args: (c) => ["agent", "validate", path.join(c.workspace, "absent"), "-fj"],
      outcome: "success",
      exitCode: 1,
    },
    {
      label: "agent init --dry-run",
      schema: "agent-result",
      args: (c) => [
        "agent",
        "init",
        "demo",
        "--output",
        path.join(c.workspace, "demo"),
        "--dry-run",
        "-fj",
      ],
      outcome: "success",
      exitCode: 0,
    },
    {
      label: "agent add --dry-run",
      schema: "agent-result",
      args: (c) => ["agent", "add", "skill", "extra", c.bundle, "--dry-run", "-fj"],
      outcome: "success",
      exitCode: 0,
    },
  ];

  it.each(cases)("$label", async (testCase) => {
    const context = { workspace: workspace(), bundle: bundle() };
    const args = testCase.args(context);
    const result = await run(...args);

    const id = args[0] === "md" || args[0] === "agent" ? `${args[0]} ${args[1]}` : args[0];
    const contract = COMMAND_CONTRACTS[id];
    expect(contract, `${id} has no contract entry`).toBeDefined();
    expect(
      contract.exitCodes.map((exit) => exit.code),
      `${testCase.label} exited ${result.exitCode}`,
    ).toContain(testCase.exitCode);
    expect(result.exitCode, testCase.label).toBe(testCase.exitCode);

    const declared =
      testCase.outcome === "findings" ? (contract.stream.findings ?? "stdout") : "stream";
    const stream = declared === "stderr" ? result.stderr : result.stdout;
    expect(stream.trim(), `${testCase.label} wrote nothing to the declared stream`).not.toBe("");
    validate(testCase.schema, JSON.parse(stream), testCase.label);
  });
});

describe("automation formats", () => {
  it("emits records matching the jsonl schema", async () => {
    const result = await run(
      "md",
      "lint",
      path.join(fixtures, "mixed-errors.md"),
      "--format",
      "jsonl",
    );
    expect(result.exitCode).toBe(2);
    const lines = result.stderr.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) validate("diagnostic-record", JSON.parse(line), "jsonl record");
    expect(JSON.parse(lines[lines.length - 1]).type).toBe("summary");
  });
});
