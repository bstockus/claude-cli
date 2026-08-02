import { describe, it, expect, vi } from "vitest";
import { checkMermaid } from "../../../src/checkers/mermaid.js";
import type { Issue } from "../../../src/types.js";

describe("checkMermaid", () => {
  it("produces no issues for valid flowchart", async () => {
    const content = "# Test\n\n```mermaid\nflowchart TD\n  A --> B\n```\n";
    const issues: Issue[] = [];
    await checkMermaid("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("produces no issues for valid sequence diagram", async () => {
    const content = "# Test\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```\n";
    const issues: Issue[] = [];
    await checkMermaid("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("produces no issues for valid class diagram", async () => {
    const content = "# Test\n\n```mermaid\nclassDiagram\n  Animal <|-- Duck\n```\n";
    const issues: Issue[] = [];
    await checkMermaid("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("produces no issues for valid state diagram", async () => {
    const content = "# Test\n\n```mermaid\nstateDiagram-v2\n  [*] --> Active\n```\n";
    const issues: Issue[] = [];
    await checkMermaid("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("produces no issues for valid ER diagram", async () => {
    const content = "# Test\n\n```mermaid\nerDiagram\n  CUSTOMER ||--o{ ORDER : places\n```\n";
    const issues: Issue[] = [];
    await checkMermaid("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("produces no issues for valid gantt chart", async () => {
    const content =
      "# Test\n\n```mermaid\ngantt\n  title A Chart\n  dateFormat YYYY-MM-DD\n  section S\n  Task :a1, 2026-01-01, 30d\n```\n";
    const issues: Issue[] = [];
    await checkMermaid("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(0);
  });

  it("detects invalid mermaid syntax", async () => {
    const content = "# Test\n\n```mermaid\nflowchart TD\n  A -->\n```\n";
    const issues: Issue[] = [];
    await checkMermaid("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(1);
    expect(issues[0].checker).toBe("mermaid");
    expect(issues[0].message).toContain("Mermaid syntax error");
  });

  it("reports correct line number for mermaid errors", async () => {
    const content = "# Test\n\nSome text\n\n```mermaid\nflowchart TD\n  A -->\n```\n";
    const issues: Issue[] = [];
    await checkMermaid("/tmp/test.md", content, issues);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(6);
  });

  it("produces no issues when no mermaid blocks exist", async () => {
    const content = "# Test\n\nJust some text.\n";
    const issues: Issue[] = [];
    const loader = vi.fn();
    await checkMermaid("/tmp/test.md", content, issues, undefined, loader);
    expect(issues).toHaveLength(0);
    expect(loader).not.toHaveBeenCalled();
  });
});
