import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");
const temporary: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bundle-e2e-"));
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

async function run(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("node", [cli, ...args]);
    return { ...result, exitCode: 0 };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.code ?? 1 };
  }
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("agent CLI", () => {
  it("shows every subcommand", async () => {
    const result = await run("agent", "--help");
    expect(result.exitCode).toBe(0);
    for (const command of ["convert", "validate", "inspect", "compat", "doctor", "specs"])
      expect(result.stdout).toContain(command);
  });

  it("validates and inspects without writing", async () => {
    const source = fixture();
    const before = fs.readdirSync(source, { recursive: true }).map(String);
    const validated = await run("agent", "validate", source, "--format", "json");
    expect(validated.exitCode).toBe(0);
    expect(JSON.parse(validated.stdout).command).toBe("validate");
    const inspected = await run("agent", "inspect", source, "-fj");
    expect(JSON.parse(inspected.stdout).bundle.components.skills).toHaveLength(1);
    expect(fs.readdirSync(source, { recursive: true }).map(String)).toEqual(before);
  });

  it("converts repeated targets and both profiles, then checks deterministically", async () => {
    const source = fixture();
    const output = path.join(os.tmpdir(), `agent-output-${path.basename(source)}`);
    temporary.push(output);
    const converted = await run(
      "agent",
      "convert",
      source,
      "--target",
      "claude-code",
      "--target",
      "cursor",
      "--output",
      output,
      "--format",
      "json",
    );
    expect(converted.exitCode).toBe(0);
    expect(
      fs.existsSync(path.join(output, "claude-code", "plugin", ".claude-plugin", "plugin.json")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(output, "cursor", "project", ".cursor", "skills", "hello", "SKILL.md"),
      ),
    ).toBe(true);
    const checked = await run(
      "agent",
      "convert",
      source,
      "--target",
      "claude-code",
      "--target",
      "cursor",
      "--output",
      output,
      "--check",
      "-fj",
    );
    expect(checked.exitCode).toBe(0);
    expect(JSON.parse(checked.stdout).stale).toBe(false);
  });

  it("dry-run and strict failures do not write", async () => {
    const source = fixture();
    fs.writeFileSync(
      path.join(source, "skills", "hello", "SKILL.md"),
      "---\nname: hello\ndescription: Say hello\n---\nUse $ARGUMENTS.\n",
    );
    const output = path.join(os.tmpdir(), `agent-dry-${path.basename(source)}`);
    temporary.push(output);
    const result = await run(
      "agent",
      "convert",
      source,
      "--target",
      "codex",
      "--output",
      output,
      "--strict",
      "--format",
      "json",
    );
    expect(result.exitCode).toBe(2);
    expect(fs.existsSync(output)).toBe(false);
  });

  it("shows the static compatibility matrix", async () => {
    const result = await run("agent", "compat", "--target", "all", "--format=json");
    expect(result.exitCode).toBe(0);
    expect(Object.keys(JSON.parse(result.stdout).compatibility)).toEqual([
      "claude-code",
      "codex",
      "cursor",
    ]);
  });

  it("publishes the target conformance profiles", async () => {
    const result = await run("agent", "specs", "--target", "all", "-fj");
    expect(result.exitCode).toBe(0);
    const specs = JSON.parse(result.stdout).specs;
    expect(specs.schemaVersion).toBe("1");
    expect(Object.keys(specs.targets)).toEqual(["claude-code", "codex", "cursor"]);
    expect(specs.targets.cursor.paths.namespacePluginSkills).toBe(true);
  });

  it("runs doctor without a bundle or an installed host", async () => {
    const result = await run("agent", "doctor", "--target", "all", "-fj");
    expect(result.exitCode).toBe(0);
    const doctor = JSON.parse(result.stdout).doctor;
    expect(doctor.hosts).toHaveLength(3);
    expect(doctor.hosts.every((host: { status: string }) => host.status === "unknown")).toBe(true);
    // Reserved for evidence from a host's own validator, which is never run.
    expect(doctor.native).toEqual([]);
  });

  it("accepts a host version with no recorded range and stays useful", async () => {
    const result = await run(
      "agent",
      "doctor",
      "--target",
      "claude-code",
      "--host-version",
      "claude-code@1.0.0",
      "-fj",
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.doctor.hosts[0]).toMatchObject({ requested: "1.0.0", status: "unverified" });
    expect(parsed.diagnostics.map((item: { code: string }) => item.code)).toContain("AB414");
  });

  it("rejects a malformed host version with a usage error", async () => {
    const result = await run("agent", "doctor", "--host-version", "codex@latest", "-fj");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).diagnostics[0].code).toBe("AB000");
  });

  it("detects drift between a bundle and its generated output", async () => {
    const source = fixture();
    const output = path.join(os.tmpdir(), `agent-doctor-${path.basename(source)}`);
    temporary.push(output);
    const args = ["--target", "claude-code", "--output", output];
    expect((await run("agent", "convert", source, ...args)).exitCode).toBe(0);

    const clean = await run("agent", "doctor", source, ...args, "-fj");
    expect(clean.exitCode).toBe(0);
    expect(JSON.parse(clean.stdout).doctor.output).toMatchObject({
      missing: [],
      changed: [],
      unmanaged: [],
    });

    fs.appendFileSync(path.join(output, "claude-code/plugin/skills/hello/SKILL.md"), "drift\n");
    const stale = await run("agent", "doctor", source, ...args, "-fj");
    expect(stale.exitCode).toBe(2);
    const codes = JSON.parse(stale.stdout).diagnostics.map((item: { code: string }) => item.code);
    expect(codes).toContain("AB402");
  });

  it("treats an unmanaged file as a warning unless strict", async () => {
    const source = fixture();
    const output = path.join(os.tmpdir(), `agent-doctor-extra-${path.basename(source)}`);
    temporary.push(output);
    const args = ["--target", "claude-code", "--output", output];
    expect((await run("agent", "convert", source, ...args)).exitCode).toBe(0);
    fs.writeFileSync(path.join(output, "claude-code/plugin/stray.txt"), "stray\n");

    const lenient = await run("agent", "doctor", source, ...args, "-fj");
    expect(lenient.exitCode).toBe(0);
    expect(JSON.parse(lenient.stdout).doctor.output.unmanaged).toEqual([
      "claude-code/plugin/stray.txt",
    ]);
    expect((await run("agent", "doctor", source, ...args, "--strict")).exitCode).toBe(2);
  });

  it("reports stale output and requires force for replacement", async () => {
    const source = fixture();
    const output = path.join(os.tmpdir(), `agent-force-${path.basename(source)}`);
    temporary.push(output);
    expect(
      (await run("agent", "convert", source, "--target", "claude-code", "--output", output))
        .exitCode,
    ).toBe(0);
    const refused = await run(
      "agent",
      "convert",
      source,
      "--target",
      "claude-code",
      "--output",
      output,
    );
    expect(refused.exitCode).toBe(1);
    fs.appendFileSync(path.join(source, "skills", "hello", "SKILL.md"), "Changed.\n");
    const checked = await run(
      "agent",
      "convert",
      source,
      "--target",
      "claude-code",
      "--output",
      output,
      "--check",
      "--format=json",
    );
    expect(checked.exitCode).toBe(2);
    expect(JSON.parse(checked.stdout).stale).toBe(true);
    expect(
      (
        await run(
          "agent",
          "convert",
          source,
          "--target",
          "claude-code",
          "--output",
          output,
          "--force",
        )
      ).exitCode,
    ).toBe(0);
  });
});
