import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildModel, SHELLS, type CompletionModel } from "../../src/completion/model.js";
import { generateCompletion } from "../../src/completion/shells.js";
import { collect } from "../../src/option-utils.js";

function toy(): Command {
  const program = new Command("toy").description("Toy CLI");
  program.command("hidden-thing", { hidden: true }).description("Hidden");
  const group = program.command("grp").description("A group");
  group
    .command("run")
    .description("Runs it: quickly, [safely], and o'clock")
    .argument("<file>", "A file")
    .option("--mode <mode>", "Mode")
    .option("--tag <tag>", "Tag (repeatable)", collect)
    .option("--no-color", "Disable color")
    .option("-v, --verbose", "Loud");
  return program;
}

const model = (): CompletionModel => buildModel(toy(), { name: "toy", version: "1.2.3" });

describe("buildModel", () => {
  it("includes the root and excludes hidden commands", () => {
    const built = model();
    const ids = built.commands.map((command) => command.id);
    expect(ids).toContain("");
    expect(ids).toContain("grp");
    expect(ids).toContain("grp run");
    // The internal cache-refresh command must never become completable.
    expect(ids).not.toContain("hidden-thing");
  });

  it("carries repeatability, value kinds, and an injected help option", () => {
    const run = model().commands.find((command) => command.id === "grp run")!;
    const option = (long: string) => run.options.find((item) => item.long === long)!;
    expect(option("--tag").repeatable).toBe(true);
    expect(option("--mode").repeatable).toBe(false);
    expect(option("--mode").takesValue).toBe(true);
    expect(option("--verbose").short).toBe("-v");
    expect(option("--no-color").takesValue).toBe(false);
    // Commander's implicit help option is not in `command.options`.
    expect(option("--help").short).toBe("-h");
    expect(run.argument.kind).toBe("file");
  });
});

describe("generateCompletion", () => {
  it("is byte-stable across runs for every shell", () => {
    // Any Set or Object.keys iteration order leaking through would show here.
    for (const shell of SHELLS)
      expect(generateCompletion(model(), shell)).toBe(generateCompletion(model(), shell));
  });

  it("mentions every command in every shell", () => {
    const built = model();
    for (const shell of SHELLS) {
      const script = generateCompletion(built, shell);
      for (const command of built.commands)
        if (command.id) expect(script, `${shell} is missing ${command.id}`).toContain(command.id);
    }
  });

  it("escapes a description containing quotes and brackets", () => {
    // "Runs it: quickly, [safely], and o'clock" exercises the delimiters each
    // shell treats specially. Escaping is the real correctness risk here.
    // bash carries no descriptions at all — `compgen -W` lists words only.
    for (const shell of ["zsh", "fish", "powershell"] as const) {
      const script = generateCompletion(model(), shell);
      const lines = script.split("\n").filter((line) => line.includes("Runs it"));
      expect(lines.length, `${shell} dropped the description`).toBeGreaterThan(0);
      for (const line of lines) {
        // A bare apostrophe inside a single-quoted POSIX string would end it.
        if (shell !== "powershell") expect(line).not.toMatch(/[^\\']'clock/);
      }
      // zsh treats `:` and `[` as spec delimiters, so both must be escaped.
      if (shell === "zsh") expect(lines.join("\n")).toContain("Runs it\\:");
    }
  });

  it("records the generator version in a comment only", () => {
    // Version in the body would move every line on every release.
    const script = generateCompletion(model(), "bash");
    const [comments, body] = [
      script.split("\n").filter((line) => line.startsWith("#")),
      script.split("\n").filter((line) => !line.startsWith("#")),
    ];
    expect(comments.join("\n")).toContain("1.2.3");
    expect(body.join("\n")).not.toContain("1.2.3");
  });
});
