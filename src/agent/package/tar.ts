import zlib from "node:zlib";

export interface TarEntry {
  /** POSIX path inside the archive. */
  path: string;
  content: Buffer;
  mode: number;
}

const BLOCK = 512;
/** GNU's default blocking factor; padding to it keeps every tar implementation happy. */
const RECORD = BLOCK * 20;

/** Longest name the ustar `name` field holds; longer paths use the `prefix` field. */
const NAME_LIMIT = 100;
const PREFIX_LIMIT = 155;

export class TarPathTooLongError extends Error {
  constructor(readonly path: string) {
    super(`Path does not fit the ustar header: ${path}`);
    this.name = "TarPathTooLongError";
  }
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

/**
 * Splits a path across the ustar `name` and `prefix` fields.
 *
 * A path that will not fit is refused rather than escalated to a PAX header:
 * PAX records carry their own name and mtime, which would need a separate
 * determinism policy. Refusing is honest and can be relaxed later.
 */
function splitPath(value: string): { name: string; prefix: string } {
  if (Buffer.byteLength(value) <= NAME_LIMIT) return { name: value, prefix: "" };
  const segments = value.split("/");
  for (let index = 1; index < segments.length; index++) {
    const prefix = segments.slice(0, index).join("/");
    const name = segments.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= PREFIX_LIMIT && Buffer.byteLength(name) <= NAME_LIMIT)
      return { name, prefix };
  }
  throw new TarPathTooLongError(value);
}

/**
 * Normalizes a mode to one of two values.
 *
 * This drops group/other write bits and setuid, so a stray 0o777 in a bundle
 * cannot ship inside an archive.
 */
export function normalizeMode(mode: number, directory: boolean): number {
  if (directory) return 0o755;
  return (mode & 0o111) !== 0 ? 0o755 : 0o644;
}

function header(entry: { path: string; size: number; mode: number; directory: boolean }): Buffer {
  const block = Buffer.alloc(BLOCK, 0);
  const { name, prefix } = splitPath(entry.directory ? `${entry.path}/` : entry.path);
  block.write(name, 0, NAME_LIMIT, "utf8");
  block.write(octal(entry.mode, 8), 100, 8, "utf8");
  // uid/gid zero and uname/gname empty: a nonempty uname would embed the
  // building machine's user in the archive bytes.
  block.write(octal(0, 8), 108, 8, "utf8");
  block.write(octal(0, 8), 116, 8, "utf8");
  block.write(octal(entry.size, 12), 124, 12, "utf8");
  block.write(octal(0, 12), 136, 12, "utf8"); // mtime
  block.write("        ", 148, 8, "utf8"); // checksum placeholder: eight spaces
  block.write(entry.directory ? "5" : "0", 156, 1, "utf8");
  block.write("ustar\0", 257, 6, "utf8");
  block.write("00", 263, 2, "utf8");
  block.write(octal(0, 8), 329, 8, "utf8"); // devmajor
  block.write(octal(0, 8), 337, 8, "utf8"); // devminor
  if (prefix) block.write(prefix, 345, PREFIX_LIMIT, "utf8");

  let checksum = 0;
  for (const byte of block) checksum += byte;
  block.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return block;
}

function pad(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder, 0);
}

/**
 * Builds a deterministic ustar archive.
 *
 * Every field that could vary between machines or runs is pinned: mtime, uid,
 * gid, uname, gname, mode, and entry order. Ordering is a byte comparison
 * rather than `localeCompare`, which is ICU-build and locale dependent and
 * would otherwise reorder the archive on a differently configured CI runner.
 */
export function tarball(entries: TarEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Directory entries are emitted explicitly so `tar tf` lists a complete tree.
  const directories = new Set<string>();
  for (const entry of sorted) {
    const segments = entry.path.split("/");
    for (let index = 1; index < segments.length; index++)
      directories.add(segments.slice(0, index).join("/"));
  }

  const all = [
    ...[...directories].map((path) => ({
      path,
      content: Buffer.alloc(0),
      mode: 0o755,
      directory: true,
    })),
    ...sorted.map((entry) => ({ ...entry, directory: false })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const blocks: Buffer[] = [];
  for (const entry of all) {
    blocks.push(
      header({
        path: entry.path,
        size: entry.content.length,
        mode: normalizeMode(entry.mode, entry.directory),
        directory: entry.directory,
      }),
    );
    if (entry.content.length) blocks.push(entry.content, pad(entry.content.length));
  }
  blocks.push(Buffer.alloc(BLOCK * 2, 0));

  const body = Buffer.concat(blocks);
  const remainder = body.length % RECORD;
  return remainder === 0 ? body : Buffer.concat([body, Buffer.alloc(RECORD - remainder, 0)]);
}

/**
 * Gzips deterministically.
 *
 * Node already writes a zero mtime, but the OS byte is a compile-time zlib
 * constant that differs across platforms. Normalizing it keeps the archive
 * byte-identical on macOS, Linux, and Windows.
 */
export function gzipDeterministic(payload: Buffer): Buffer {
  const compressed = zlib.gzipSync(payload, { level: 9 });
  compressed.writeUInt32LE(0, 4); // MTIME
  compressed[9] = 0x03; // OS = Unix
  return compressed;
}

/** A deterministic `.tar.gz` for the given entries. */
export function archive(entries: TarEntry[]): Buffer {
  return gzipDeterministic(tarball(entries));
}
