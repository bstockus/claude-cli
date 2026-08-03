import path from "node:path";
import { splitLocalTarget } from "../link-target.js";
import {
  ENTITY_KINDS,
  SPECS,
  fieldNames,
  type EntityKind,
  type FieldSpec,
  type Scalar,
} from "./entities.js";

/** Anything the user got wrong. Always exit 1, never a silently empty result. */
export class QueryUsageError extends Error {}

export type ComparisonOperator = "=" | "!=" | "~" | ">" | ">=" | "<" | "<=";

export interface ComparisonPredicate {
  type: "comparison";
  /** A registered field name, or a `frontmatter.<dotted.path>` token. */
  field: string;
  operator: ComparisonOperator;
  /** The operand as typed. */
  value: string;
  /** Pre-coerced operand for a statically typed field. */
  operand?: Scalar;
  /** Undefined for a dynamic frontmatter field. */
  spec?: FieldSpec;
  /** Dotted key path when the field is dynamic. */
  keyPath?: string;
  source: string;
}

export interface NamedPredicate {
  type: "named";
  name: "has" | "links-to";
  argument: string;
  negated: boolean;
  /** `links-to` only: the argument resolved against the working directory. */
  resolved?: { path: string; fragment?: string };
  /** `has` only: the field the argument names. */
  spec?: FieldSpec;
  keyPath?: string;
  source: string;
}

export type Predicate = ComparisonPredicate | NamedPredicate;

export interface QueryPlan {
  entity: EntityKind;
  /** Conjunction. There is deliberately no disjunction. */
  predicates: Predicate[];
  /** Projection in user order; the entity's default fields when unset. */
  select: string[];
  selectExplicit: boolean;
  groupBy?: string;
}

export interface ResolvedField {
  token: string;
  spec?: FieldSpec;
  keyPath?: string;
}

const FRONTMATTER = "frontmatter.";
// Longest first so ">=" is never read as ">" followed by "=".
const OPERATORS: ComparisonOperator[] = ["!=", ">=", "<=", "=", "~", ">", "<"];
const NAMED = /^!?([a-z][a-z0-9-]*):/;
const NUMERIC: ComparisonOperator[] = [">", ">=", "<", "<="];

export function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value);
}

/**
 * Resolves a field token against an entity.
 *
 * `frontmatter.<key>` is a virtual field on every entity, read from the
 * containing document. That is what lets `md query tasks --group-by
 * frontmatter.owner` work without a join.
 */
export function resolveField(entity: EntityKind, token: string): ResolvedField {
  if (token.startsWith(FRONTMATTER)) {
    const keyPath = token.slice(FRONTMATTER.length);
    if (!keyPath) throw new QueryUsageError("frontmatter fields need a key: frontmatter.<key>");
    return { token, keyPath };
  }
  const spec = SPECS[entity].fields.find((field) => field.name === token);
  if (!spec) {
    // A per-occurrence field on `documents` is a hidden join; name the entity
    // that actually has it rather than returning nothing.
    const hint =
      entity === "documents" && ["line", "text", "target", "slug"].includes(token)
        ? ` Per-occurrence fields need an occurrence entity — try: md query links --select file,${token}`
        : "";
    throw new QueryUsageError(
      `Unknown field for ${entity}: ${token}. Available: ${fieldNames(entity).join(", ")}, frontmatter.<key>.${hint}`,
    );
  }
  return { token, spec };
}

function coerce(spec: FieldSpec, value: string, source: string): Scalar {
  if (spec.type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new QueryUsageError(`${source}: ${spec.name} is a boolean field; use true or false`);
  }
  if (spec.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new QueryUsageError(`${source}: ${spec.name} is a numeric field; ${value} is not`);
    }
    return parsed;
  }
  return value;
}

function firstOperator(term: string): { operator: ComparisonOperator; index: number } | undefined {
  let best: { operator: ComparisonOperator; index: number } | undefined;
  for (const operator of OPERATORS) {
    const index = term.indexOf(operator);
    if (index <= 0) continue;
    if (!best || index < best.index) best = { operator, index };
  }
  return best;
}

/**
 * Parses one `--where` term.
 *
 * A term is `NAME:ARG` only when the text before the first colon is a valid
 * predicate name *and* that colon precedes any operator. So `links-to:x.md` is
 * a named predicate while `target=https://example.com` is a comparison.
 */
export function parseWhere(entity: EntityKind, term: string): Predicate {
  if (!term.trim()) throw new QueryUsageError("--where needs a predicate");

  const named = NAMED.exec(term);
  const operator = firstOperator(term);
  const colon = term.indexOf(":");
  if (named && (!operator || colon < operator.index)) {
    const negated = term.startsWith("!");
    const name = named[1];
    const argument = term.slice(colon + 1);
    if (!argument) throw new QueryUsageError(`${term}: ${name} needs an argument`);

    if (name === "has") {
      const field = resolveField(entity, argument);
      return { type: "named", name, argument, negated, ...field, source: term };
    }
    if (name === "links-to") {
      if (!SPECS[entity].functions.includes("links-to")) {
        throw new QueryUsageError(
          `${term}: links-to is not available on ${entity}; use documents or links`,
        );
      }
      const parsed = splitLocalTarget(argument);
      return {
        type: "named",
        name,
        argument,
        negated,
        resolved: {
          path: path.resolve(parsed.path),
          ...(parsed.fragment === undefined ? {} : { fragment: parsed.fragment }),
        },
        source: term,
      };
    }
    throw new QueryUsageError(`${term}: unknown predicate ${name}. Available: has, links-to`);
  }

  if (!operator) {
    throw new QueryUsageError(
      `${term}: not a predicate. Use <field><op><value> with one of ${OPERATORS.join(" ")}, or has:<field> / links-to:<path>`,
    );
  }
  const field = resolveField(entity, term.slice(0, operator.index));
  const value = term.slice(operator.index + operator.operator.length);

  // A statically typed field validates its operator and operand now, so a typo
  // fails loudly. A frontmatter field is untyped YAML and can only be coerced
  // at evaluation.
  if (field.spec) {
    if (NUMERIC.includes(operator.operator) && field.spec.type !== "number") {
      throw new QueryUsageError(
        `${term}: ${operator.operator} is only valid on numeric fields; ${field.spec.name} is a ${field.spec.type}`,
      );
    }
    return {
      type: "comparison",
      field: field.token,
      operator: operator.operator,
      value,
      operand: coerce(field.spec, value, term),
      spec: field.spec,
      source: term,
    };
  }
  return {
    type: "comparison",
    field: field.token,
    operator: operator.operator,
    value,
    keyPath: field.keyPath,
    source: term,
  };
}

/** Splits and validates a comma-separated, repeatable field list. */
export function parseFieldList(entity: EntityKind, values: readonly string[]): string[] {
  const seen: string[] = [];
  for (const value of values) {
    for (const token of value.split(",")) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      resolveField(entity, trimmed);
      if (!seen.includes(trimmed)) seen.push(trimmed);
    }
  }
  return seen;
}

export interface PlanInput {
  kind: string;
  where: string[];
  select: string[];
  groupBy?: string;
}

export function buildPlan(input: PlanInput): QueryPlan {
  if (!isEntityKind(input.kind)) {
    // Shortcut kinds keep their historical payload rather than growing a second
    // shape, so name the entity form that answers the same question.
    const replacement: Record<string, string> = {
      "missing-h1": " Try: md query documents --where '!has:h1'",
      "links-to": " Try: md query links --where links-to:<path>",
    };
    throw new QueryUsageError(
      `${input.kind} does not support composable options. Entities: ${ENTITY_KINDS.join(", ")}.${replacement[input.kind] ?? ""}`,
    );
  }
  const entity = input.kind;
  const predicates = input.where.map((term) => parseWhere(entity, term));
  const select = parseFieldList(entity, input.select);
  const groupBy = input.groupBy?.trim();
  if (groupBy) resolveField(entity, groupBy);

  return {
    entity,
    predicates,
    select: select.length
      ? select
      : SPECS[entity].fields.filter((field) => field.default).map((field) => field.name),
    selectExplicit: select.length > 0,
    ...(groupBy ? { groupBy } : {}),
  };
}
