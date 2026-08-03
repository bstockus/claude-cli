import { findSection } from "../sections.js";
import type { OutputFormat } from "../types.js";
import { outputPath, runtime } from "../runtime.js";
import { terminate } from "../command-result.js";
import { requireFile } from "../input.js";
import { jsonPayload } from "../result.js";

interface SectionOptions {
  envelope?: boolean;
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
  const section = findSection(document, heading, {
    children: opts.children,
    includeHeading: opts.includeHeading,
  });

  if (!section) {
    process.stderr.write(`Error: Heading not found: ${heading}\n`);
    terminate(1);
  }

  const { heading: matched, startLine, endLine, content: sectionContent } = section;

  if (opts.raw) {
    process.stdout.write(sectionContent + "\n");
    return;
  }

  if (format === "json") {
    process.stdout.write(
      jsonPayload(
        "md section",
        {
          file: shownPath,
          heading: matched.text,
          slug: matched.slug,
          depth: matched.depth,
          startLine,
          endLine,
          content: sectionContent,
        },
        opts,
      ),
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
