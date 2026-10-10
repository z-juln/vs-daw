import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadPackageEntries,
  PACKAGE_INDEX,
  writePackageFile,
} from "./dawPackage";

const cacheRoot = path.join(os.tmpdir(), "vs-daw-pkg-cache");
/** materializedDir -> package absolute path */
const dirToPackage = new Map<string, string>();
/** package absolute path -> materializedDir */
const packageToDir = new Map<string, string>();

function hashPath(absolutePath: string): string {
  return createHash("sha1").update(path.resolve(absolutePath)).digest("hex").slice(0, 16);
}

export function packageForCacheFile(filePath: string): string | undefined {
  const resolved = path.resolve(filePath);
  for (const [dir, pkg] of dirToPackage) {
    if (resolved === dir || resolved.startsWith(`${dir}${path.sep}`)) return pkg;
  }
  return undefined;
}

export function cacheDirForPackage(pkgPath: string): string | undefined {
  return packageToDir.get(path.resolve(pkgPath));
}

/** Extract package into a temp working directory; returns that directory. */
export async function materializePackage(pkgAbsolutePath: string): Promise<string> {
  const pkg = path.resolve(pkgAbsolutePath);
  const existing = packageToDir.get(pkg);
  if (existing) {
    try {
      await fs.access(path.join(existing, PACKAGE_INDEX));
      return existing;
    } catch {
      packageToDir.delete(pkg);
      dirToPackage.delete(existing);
    }
  }

  const dir = path.join(cacheRoot, hashPath(pkg));
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const entries = await loadPackageEntries(pkg);
  for (const [entryPath, data] of entries) {
    const target = path.join(dir, ...entryPath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
  if (!entries.has(PACKAGE_INDEX)) {
    throw new Error(`DAW 包缺少 ${PACKAGE_INDEX}`);
  }

  packageToDir.set(pkg, dir);
  dirToPackage.set(dir, pkg);
  return dir;
}

export function resolvePackageEntryPath(pkgAbsolutePath: string, entryPath: string): string {
  const dir = packageToDir.get(path.resolve(pkgAbsolutePath));
  if (!dir) throw new Error("包尚未展开到工作目录");
  const normalized = entryPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(dir, ...normalized.split("/"));
  if (target !== dir && !target.startsWith(`${dir}${path.sep}`)) {
    throw new Error("非法包内路径");
  }
  return target;
}

/** Re-zip working directory back into the .daw package file. */
export async function repackPackage(pkgAbsolutePath: string): Promise<void> {
  const pkg = path.resolve(pkgAbsolutePath);
  const cached = packageToDir.get(pkg);
  if (!cached) return;
  const rootDir: string = cached;

  const files: Record<string, Uint8Array> = {};
  async function walk(relativeDir: string): Promise<void> {
    const absDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
    const listing = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of listing) {
      const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(rel.split(path.sep).join("/"));
      } else if (entry.isFile()) {
        files[rel.split(path.sep).join("/")] = await fs.readFile(
          path.join(rootDir, ...rel.split("/")),
        );
      }
    }
  }
  await walk("");
  await writePackageFile(pkg, files);
}

export async function ensurePackageEntry(
  pkgAbsolutePath: string,
  entryPath: string,
): Promise<string> {
  await materializePackage(pkgAbsolutePath);
  return resolvePackageEntryPath(pkgAbsolutePath, entryPath);
}
