export interface Issue {
  file: string;
  line: number;
  checker: string;
  message: string;
}

export type OutputFormat = "llm" | "human" | "json";
