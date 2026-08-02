import { slugify } from "../markdown-ast.js";
import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";

interface SectionOptions {
  format: string;
  includeHeading: boolean;
  children: boolean;
  raw: boolean;
}

function resolveFormat(opts: SectionOptions): OutputFormat {
  const fmt = opts.format;
  if (fmt === "llm" || fmt === "human" || fmt === "json") return fmt;
  return "llm";
}

export async function sectionAction(
  file: string,
  heading: string,
  opts: SectionOptions,
): Promise<void> {
  const format = resolveFormat(opts);
  const filePath = requireFile(file, opts);
  const shownPath = outputPath(filePath, opts);

  const document = runtime().workspace.document(filePath);
  const { content, headings } = document;

  const headingLower = heading.toLowerCase();
  const headingSlug = slugify(heading);
  const matchIdx = headings.findIndex(
    (h) => h.text.toLowerCase() === headingLower || h.slug === headingSlug,
  );

  if (matchIdx === -1) {
    process.stderr.write(`Error: Heading not found: ${heading}\n`);
    terminate(1);
  }

  const matched = headings[matchIdx];
  const contentLines = content.split("\n");

  // Determine end line
  let endLine = contentLines.length;
  for (let i = matchIdx + 1; i < headings.length; i++) {
    if (opts.children) {
      // Include children: stop at next heading at same or higher level
      if (headings[i].depth <= matched.depth) {
        endLine = headings[i].line - 1;
        break;
      }
    } else {
      // Exclude children: stop at any next heading
      endLine = headings[i].line - 1;
      break;
    }
  }

  const startLine = opts.includeHeading ? matched.line : matched.line + 1;
  const sectionContent = contentLines.slice(startLine - 1, endLine).join("\n");

  if (opts.raw) {
    process.stdout.write(sectionContent + "\n");
    return;
  }

  if (format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          file: shownPath,
          heading: matched.text,
          slug: matched.slug,
          depth: matched.depth,
          startLine,
          endLine,
          content: sectionContent,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const isHuman = format === "human";
  const bold = (s: string) => (isHuman ? `\x1b[1m${s}\x1b[0m` : s);

  process.stdout.write(
    bold(`Section "${matched.text}" (L${startLine}-L${endLine}) in ${shownPath}:`) +
      "\n\n" +
      sectionContent +
      "\n",
  );
}
