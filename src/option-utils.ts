/**
 * Accumulator for repeatable options. `src/contract/describe.ts` detects
 * repeatability by comparing an option's coercion against this function by
 * identity, so it must not be wrapped at registration sites.
 */
export function collect(val: string, acc: string[] = []): string[] {
  acc.push(val);
  return acc;
}
