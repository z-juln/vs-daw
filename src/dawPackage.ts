import { promises as fs } from "fs";
import * as path from "path";
import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";

export const PACKAGE_INDEX = "index.daw";
export const PACKAGE_ASSETS = "assets";

export interface PackageEntry {
  /** POSIX path inside zip, no leading slash. */
  path: string;
  directory: boolean;
  size: number;
}

/** ZIP local-file magic PK\\x03\\x04 (also accept empty/spanned variants). */
export function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

export async function isDawPackageFile(absolutePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(absolutePath, "r");
    try {
      const buf = Buffer.alloc(4);
      const { bytesRead } = await handle.read(buf, 0, 4, 0);
      return bytesRead >= 4 && isZipBytes(buf.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function normalizeEntryPath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function readZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const unzipped = unzipSync(bytes);
  const map = new Map<string, Uint8Array>();
  for (const [raw, data] of Object.entries(unzipped)) {
    const key = normalizeEntryPath(raw);
    if (!key || key.endsWith("/")) continue;
    map.set(key, data);
  }
  return map;
}

export async function loadPackageEntries(absolutePath: string): Promise<Map<string, Uint8Array>> {
  const bytes = await fs.readFile(absolutePath);
  if (!isZipBytes(bytes)) throw new Error("不是 DAW 包（zip）");
  return readZipEntries(bytes);
}

export function listPackageEntries(files: Map<string, Uint8Array>): PackageEntry[] {
  const dirs = new Set<string>();
  const entries: PackageEntry[] = [];
  for (const [filePath, data] of files) {
    entries.push({ path: filePath, directory: false, size: data.byteLength });
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  for (const dir of dirs) {
    entries.push({ path: dir, directory: true, size: 0 });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** Children of `dir` ("" = root), one level. */
export function listPackageChildren(
  files: Map<string, Uint8Array>,
  dir = "",
): PackageEntry[] {
  const prefix = dir ? `${normalizeEntryPath(dir)}/` : "";
  const seen = new Map<string, PackageEntry>();
  for (const entry of listPackageEntries(files)) {
    if (!entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash < 0) {
      seen.set(rest, entry);
    } else {
      const name = rest.slice(0, slash);
      const childPath = prefix + name;
      if (!seen.has(name)) {
        seen.set(name, { path: childPath, directory: true, size: 0 });
      }
    }
  }
  return [...seen.values()].sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    const an = a.path.split("/").pop() ?? a.path;
    const bn = b.path.split("/").pop() ?? b.path;
    return an.localeCompare(bn, undefined, { numeric: true });
  });
}

export async function readPackageIndex(absolutePath: string): Promise<string> {
  const files = await loadPackageEntries(absolutePath);
  const data = files.get(PACKAGE_INDEX);
  if (!data) throw new Error(`DAW 包缺少 ${PACKAGE_INDEX}`);
  return strFromU8(data);
}

export async function readPackageAsset(
  absolutePath: string,
  entryPath: string,
): Promise<Uint8Array> {
  const files = await loadPackageEntries(absolutePath);
  const key = normalizeEntryPath(entryPath);
  const data = files.get(key);
  if (!data) throw new Error(`包内找不到资源：${key}`);
  return data;
}

export function buildPackageZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [raw, value] of Object.entries(files)) {
    const key = normalizeEntryPath(raw);
    if (!key) continue;
    input[key] = typeof value === "string" ? strToU8(value) : value;
  }
  if (!input[PACKAGE_INDEX]) {
    throw new Error(`打包需要 ${PACKAGE_INDEX}`);
  }
  return zipSync(input, { level: 6 });
}

export async function writePackageFile(
  absolutePath: string,
  files: Record<string, Uint8Array | string>,
): Promise<void> {
  const zip = buildPackageZip(files);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, zip);
}

/**
 * 将普通文本 `.daw` 原地改成包格式（index.daw + assets/）。
 * 若同目录已有 `assets/` 文件夹，会一并打进包内。
 */
export async function convertTextDawToPackage(absolutePath: string): Promise<{
  copiedAssets: number;
}> {
  if (await isDawPackageFile(absolutePath)) {
    throw new Error("已经是 DAW 包，无需转换");
  }
  const text = await fs.readFile(absolutePath, "utf8");
  if (!text.trim()) {
    throw new Error("工程内容为空，无法转换");
  }

  const files: Record<string, Uint8Array | string> = {
    [PACKAGE_INDEX]: text,
  };

  let copiedAssets = 0;
  const siblingAssets = path.join(path.dirname(absolutePath), PACKAGE_ASSETS);
  try {
    const stat = await fs.stat(siblingAssets);
    if (stat.isDirectory()) {
      async function walk(relativeDir: string): Promise<void> {
        const absDir = relativeDir
          ? path.join(siblingAssets, ...relativeDir.split("/"))
          : siblingAssets;
        const listing = await fs.readdir(absDir, { withFileTypes: true });
        for (const entry of listing) {
          const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(rel);
          } else if (entry.isFile()) {
            const data = await fs.readFile(path.join(siblingAssets, ...rel.split("/")));
            files[`${PACKAGE_ASSETS}/${rel}`] = data;
            copiedAssets += 1;
          }
        }
      }
      await walk("");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // 保证展开包时能看到 assets/ 目录
  if (copiedAssets === 0) {
    files[`${PACKAGE_ASSETS}/.gitkeep`] = new Uint8Array(0);
  }

  await writePackageFile(absolutePath, files);
  return { copiedAssets };
}

/** Normalize sample path used in grids (POSIX, no leading ./). */
export function normalizeSamplePath(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}
