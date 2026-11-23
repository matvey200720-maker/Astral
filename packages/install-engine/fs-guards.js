import fs from "node:fs/promises";
import path from "node:path";
import {
  isManagedOverlayTarget,
  isNewModsTarget,
  normalizeRelativePath,
  resolveInside,
} from "./manifest.js";

/*
 * Две проверки файловой системы, общие для установки, удаления и отката:
 * запрет выхода по символической ссылке и уборка опустевших папок.
 */
export async function assertNoSymlinkTraversal(
  root,
  relative,
  { includeLeaf = false } = {},
) {
  const parts = normalizeRelativePath(relative, {
    allowExecutable: true,
  }).split("/");
  const stop = includeLeaf ? parts.length : parts.length - 1;
  let current = path.resolve(root);
  for (let index = 0; index < stop; index++) {
    current = path.join(current, parts[index]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw new Error(`Символическая ссылка запрещена в пути: ${relative}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

/*
 * Та же проверка для одной операции над тысячами файлов (ТЗ 06.10.2026,
 * вечер): у сорока тысяч файлов пакета текстур одни и те же каталоги пути —
 * каждый из них проверяется один раз за операцию, а не сорок тысяч раз.
 * Помнится только в пределах одной установки: следующая проверяет заново.
 */
export function createSymlinkGuard() {
  const seen = new Map();
  const isLink = (current) => {
    if (!seen.has(current))
      seen.set(
        current,
        fs.lstat(current).then(
          (stat) => stat.isSymbolicLink(),
          (error) => {
            if (error.code !== "ENOENT") throw error;
            return false;
          },
        ),
      );
    return seen.get(current);
  };
  return async (root, relative, { includeLeaf = false } = {}) => {
    const parts = normalizeRelativePath(relative, { allowExecutable: true }).split("/");
    const stop = includeLeaf ? parts.length : parts.length - 1;
    let current = path.resolve(root);
    for (let index = 0; index < stop; index++) {
      current = path.join(current, parts[index]);
      if (await isLink(current)) throw new Error(`Символическая ссылка запрещена в пути: ${relative}`);
    }
  };
}

export async function pruneEmptyManagedDirectories(gameRoot, relativePaths) {
  const root = path.resolve(gameRoot);
  for (const relativePath of relativePaths) {
    if (!isManagedOverlayTarget(relativePath)) continue;
    const managedName = isNewModsTarget(relativePath) ? "newmods" : "mods";
    const managedRoot = resolveInside(root, managedName);
    let current =
      relativePath === managedName
        ? managedRoot
        : path.dirname(resolveInside(root, relativePath));
    while (
      current === managedRoot ||
      (!path.relative(managedRoot, current).startsWith("..") &&
        !path.isAbsolute(path.relative(managedRoot, current)))
    ) {
      try {
        const stat = await fs.lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) break;
        await fs.rmdir(current);
      } catch (error) {
        if (error.code === "ENOENT") {
          current = path.dirname(current);
          continue;
        }
        if (["ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(error.code))
          break;
        throw error;
      }
      if (current === managedRoot) break;
      current = path.dirname(current);
    }
  }
}
