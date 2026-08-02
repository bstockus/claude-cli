import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { FrontmatterRulesConfig } from "./config.js";
import type { Issue } from "./types.js";
import type { MarkdownDocument } from "./workspace.js";

function nested(data: unknown, propertyPath: string): unknown {
  let value = data;
  for (const part of propertyPath.split(".")) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

export class FrontmatterValidator {
  private readonly schema?: ValidateFunction;
  private readonly formatValidators = new Map<string, ValidateFunction>();

  constructor(
    readonly rules: FrontmatterRulesConfig,
    schemaPath?: string,
  ) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const addFormats = addFormatsImport as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    if (schemaPath) {
      if (!fs.existsSync(schemaPath) || !fs.statSync(schemaPath).isFile())
        throw new Error(`Schema file not found: ${schemaPath}`);
      let schema: unknown;
      try {
        schema = parseYaml(fs.readFileSync(schemaPath, "utf-8"));
      } catch (error) {
        throw new Error(`Malformed schema file ${schemaPath}: ${(error as Error).message}`, {
          cause: error,
        });
      }
      try {
        this.schema = ajv.compile(schema as never);
      } catch (error) {
        throw new Error(`Invalid schema ${schemaPath}: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
    for (const format of new Set(Object.values(rules.formats))) {
      try {
        this.formatValidators.set(format, ajv.compile({ type: "string", format }));
      } catch {
        throw new Error(`Unsupported frontmatter format: ${format}`);
      }
    }
  }

  validate(document: MarkdownDocument): Issue[] {
    const result = document.frontmatter;
    if (result.status === "malformed")
      return [
        { file: document.path, line: 1, checker: "frontmatter/yaml", message: result.message },
      ];
    if (result.status === "non-mapping")
      return [
        {
          file: document.path,
          line: 1,
          checker: "frontmatter/type",
          message: "Frontmatter must be a mapping",
        },
      ];
    const data: Record<string, unknown> = result.status === "valid" ? result.data : {};
    const issues: Issue[] = [];
    if (this.schema && !this.schema(data)) {
      for (const error of this.schema.errors ?? []) {
        const location = error.instancePath || "/";
        issues.push({
          file: document.path,
          line: 1,
          checker: "frontmatter/schema",
          message: `${location} ${error.message ?? "is invalid"}`,
        });
      }
    }
    for (const property of this.rules.required)
      if (nested(data, property) === undefined)
        issues.push({
          file: document.path,
          line: 1,
          checker: "frontmatter/required",
          message: `Required property missing: ${property}`,
        });
    for (const property of this.rules.prohibited)
      if (nested(data, property) !== undefined)
        issues.push({
          file: document.path,
          line: 1,
          checker: "frontmatter/prohibited",
          message: `Prohibited property present: ${property}`,
        });
    for (const [property, expected] of Object.entries(this.rules.types)) {
      const value = nested(data, property);
      if (value === undefined) continue;
      const matches =
        expected === "number"
          ? typeof value === "number"
          : expected === "object"
            ? value !== null && typeof value === "object" && !Array.isArray(value)
            : actualType(value) === expected;
      if (!matches)
        issues.push({
          file: document.path,
          line: 1,
          checker: "frontmatter/type",
          message: `${property} must be ${expected}`,
        });
    }
    for (const [property, allowed] of Object.entries(this.rules.allowedValues)) {
      const value = nested(data, property);
      if (
        value !== undefined &&
        !allowed.some((item) => JSON.stringify(item) === JSON.stringify(value))
      )
        issues.push({
          file: document.path,
          line: 1,
          checker: "frontmatter/allowed-values",
          message: `${property} has a value that is not allowed`,
        });
    }
    for (const [property, pattern] of Object.entries(this.rules.patterns)) {
      const value = nested(data, property);
      if (value !== undefined && (typeof value !== "string" || !new RegExp(pattern).test(value)))
        issues.push({
          file: document.path,
          line: 1,
          checker: "frontmatter/pattern",
          message: `${property} does not match ${pattern}`,
        });
    }
    for (const [property, format] of Object.entries(this.rules.formats)) {
      const value = nested(data, property);
      const validate = this.formatValidators.get(format)!;
      if (value !== undefined && !validate(value))
        issues.push({
          file: document.path,
          line: 1,
          checker: "frontmatter/format",
          message: `${property} must match format ${format}`,
        });
    }
    return issues;
  }

  validateMany(documents: MarkdownDocument[]): Issue[] {
    const issues = documents.flatMap((document) => this.validate(document));
    for (const property of this.rules.unique) {
      const groups = new Map<string, MarkdownDocument[]>();
      for (const document of documents) {
        if (document.frontmatter.status !== "valid") continue;
        const value = nested(document.frontmatter.data, property);
        if (value === undefined || value === null || typeof value === "object") continue;
        const key = `${typeof value}:${String(value)}`;
        const group = groups.get(key) ?? [];
        group.push(document);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        for (const document of group) {
          issues.push({
            file: document.path,
            line: 1,
            checker: "frontmatter/unique",
            message: `${property} duplicates a value elsewhere in the selected workspace`,
          });
        }
      }
    }
    return issues;
  }
}
