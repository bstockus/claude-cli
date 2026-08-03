import {
  extractCodeBlocks,
  extractTasks,
  type MdCodeBlock,
  type MdHeading,
  type MdLink,
  type MdTask,
} from "../markdown-ast.js";
import { extractText } from "../markdown-ast.js";
import { visit } from "unist-util-visit";
import { frontmatterEndLine } from "../sections.js";
import type { MarkdownDocument } from "../workspace.js";

export const ENTITY_KINDS = [
  "documents",
  "headings",
  "links",
  "tasks",
  "code-blocks",
  "frontmatter",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export type Scalar = string | number | boolean | null;
export type FieldValue = Scalar | Scalar[] | undefined;
export type FieldType = "string" | "number" | "boolean";

/** One row of the `frontmatter` entity: a top-level key of a valid mapping. */
export interface FrontmatterEntry {
  key: string;
  value: unknown;
}

export type EntityNode = null | MdHeading | MdLink | MdTask | MdCodeBlock | FrontmatterEntry;

/** Per-document values computed once and shared by predicates and projection. */
export interface DocumentDerived {
  /** Headings outside the frontmatter block. */
  headings: MdHeading[];
  tasks: MdTask[];
  codeBlocks: MdCodeBlock[];
  frontmatterData: Record<string, unknown>;
  words: number;
}

export interface RowSource {
  /** Absolute path. */
  file: string;
  document: MarkdownDocument;
  node: EntityNode;
  derived: DocumentDerived;
}

export interface FieldSpec {
  /** Exactly the token typed in --where, --select, or --group-by. */
  name: string;
  type: FieldType;
  /** Emitted when no --select is given. */
  default: boolean;
  /** Rendered through the command layer's path display. */
  path?: boolean;
  read: (source: RowSource) => FieldValue;
}

export interface EntitySpec {
  kind: EntityKind;
  /** Rows for one document, in source order. */
  rows: (document: MarkdownDocument, derived: DocumentDerived) => EntityNode[];
  fields: readonly FieldSpec[];
  /** Named predicates with an argument that this entity supports. */
  functions: readonly string[];
}

function countWords(document: MarkdownDocument): number {
  let words = 0;
  // Only text nodes, so fenced code never inflates a prose count.
  visit(document.tree, "text", (node: { value: string }) => {
    words += node.value.split(/\s+/).filter(Boolean).length;
  });
  return words;
}

export function deriveDocument(document: MarkdownDocument): DocumentDerived {
  const end = frontmatterEndLine(document.content);
  return {
    // The underlying parser has no frontmatter extension, so a short block
    // becomes a phantom setext heading. Structural queries drop it rather than
    // report a `title: X` heading that is not in the document.
    headings: document.headings.filter((item) => item.line > end),
    tasks: extractTasks(document.tree),
    codeBlocks: extractCodeBlocks(document.tree),
    frontmatterData: document.frontmatter.status === "valid" ? document.frontmatter.data : {},
    words: countWords(document),
  };
}

const fileField: FieldSpec = {
  name: "file",
  type: "string",
  default: true,
  path: true,
  read: (source) => source.file,
};

function documentTitle(source: RowSource): string | null {
  const title = source.derived.frontmatterData.title;
  if (typeof title === "string") return title;
  return source.derived.headings.find((heading) => heading.depth === 1)?.text ?? null;
}

const heading = (source: RowSource): MdHeading => source.node as MdHeading;
const link = (source: RowSource): MdLink => source.node as MdLink;
const task = (source: RowSource): MdTask => source.node as MdTask;
const block = (source: RowSource): MdCodeBlock => source.node as MdCodeBlock;
const entry = (source: RowSource): FrontmatterEntry => source.node as FrontmatterEntry;

export const SPECS: Record<EntityKind, EntitySpec> = {
  documents: {
    kind: "documents",
    rows: () => [null],
    functions: ["links-to"],
    fields: [
      fileField,
      { name: "title", type: "string", default: true, read: documentTitle },
      {
        name: "h1",
        type: "boolean",
        default: false,
        read: (source) => source.derived.headings.some((item) => item.depth === 1),
      },
      {
        name: "headings",
        type: "number",
        default: false,
        read: (source) => source.derived.headings.length,
      },
      {
        name: "links",
        type: "number",
        default: false,
        read: (source) => source.document.references.length,
      },
      { name: "tasks", type: "number", default: false, read: (s) => s.derived.tasks.length },
      { name: "code", type: "number", default: false, read: (s) => s.derived.codeBlocks.length },
      { name: "words", type: "number", default: false, read: (s) => s.derived.words },
      {
        name: "frontmatterStatus",
        type: "string",
        default: false,
        read: (source) => source.document.frontmatter.status,
      },
    ],
  },

  headings: {
    kind: "headings",
    rows: (_document, derived) => derived.headings,
    functions: [],
    fields: [
      fileField,
      { name: "line", type: "number", default: true, read: (s) => heading(s).line },
      { name: "depth", type: "number", default: true, read: (s) => heading(s).depth },
      { name: "text", type: "string", default: true, read: (s) => heading(s).text },
      { name: "slug", type: "string", default: true, read: (s) => heading(s).slug },
    ],
  },

  links: {
    kind: "links",
    rows: (document) => document.references,
    functions: ["links-to"],
    fields: [
      fileField,
      { name: "line", type: "number", default: true, read: (s) => link(s).line },
      { name: "linkText", type: "string", default: true, read: (s) => link(s).linkText },
      { name: "target", type: "string", default: true, read: (s) => link(s).target },
      { name: "isImage", type: "boolean", default: false, read: (s) => link(s).isImage },
      { name: "isExternal", type: "boolean", default: false, read: (s) => link(s).isExternal },
      {
        name: "isAnchorOnly",
        type: "boolean",
        default: false,
        read: (s) => link(s).isAnchorOnly,
      },
      {
        name: "referenceType",
        type: "string",
        default: false,
        read: (s) => link(s).referenceType,
      },
    ],
  },

  tasks: {
    kind: "tasks",
    rows: (_document, derived) => derived.tasks,
    functions: [],
    fields: [
      fileField,
      { name: "line", type: "number", default: true, read: (s) => task(s).line },
      { name: "checked", type: "boolean", default: true, read: (s) => task(s).checked },
      { name: "text", type: "string", default: true, read: (s) => task(s).text },
      // Both spellings: `checked` matches the historical task row, `status`
      // matches the vocabulary `md query tasks --status` already uses.
      {
        name: "status",
        type: "string",
        default: false,
        read: (s) => (task(s).checked ? "done" : "pending"),
      },
    ],
  },

  "code-blocks": {
    kind: "code-blocks",
    rows: (_document, derived) => derived.codeBlocks,
    functions: [],
    fields: [
      fileField,
      { name: "line", type: "number", default: true, read: (s) => block(s).line },
      { name: "endLine", type: "number", default: true, read: (s) => block(s).endLine },
      { name: "language", type: "string", default: true, read: (s) => block(s).lang },
      { name: "content", type: "string", default: false, read: (s) => block(s).value },
      {
        name: "lines",
        type: "number",
        default: false,
        read: (s) => block(s).endLine - block(s).line + 1,
      },
    ],
  },

  frontmatter: {
    kind: "frontmatter",
    rows: (_document, derived) =>
      Object.entries(derived.frontmatterData).map(([key, value]) => ({ key, value })),
    functions: [],
    fields: [
      fileField,
      { name: "key", type: "string", default: true, read: (s) => entry(s).key },
      {
        name: "value",
        type: "string",
        default: true,
        read: (s) => {
          const value = entry(s).value;
          if (value === null) return null;
          if (Array.isArray(value)) return value.map((item) => String(item));
          if (typeof value === "object") return JSON.stringify(value);
          return value as Scalar;
        },
      },
      {
        name: "type",
        type: "string",
        default: true,
        read: (s) => {
          const value = entry(s).value;
          if (value === null) return "null";
          if (Array.isArray(value)) return "array";
          return typeof value;
        },
      },
    ],
  },
};

/** Field names an entity offers, for an error message. */
export function fieldNames(kind: EntityKind): string[] {
  return SPECS[kind].fields.map((field) => field.name);
}

export { extractText };
