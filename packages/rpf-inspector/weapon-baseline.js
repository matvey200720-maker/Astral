// База штатных стволов: обход архивов чистой игры и хэши файлов w_xx_*, самих файлов в ней нет.

import { Buffer } from "node:buffer";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { entryContentHash } from "./baseline.js";

export const STOCK_WEAPONS_SCHEMA = 1;

const KIND = "stock-weapons";
const CANCELLED = "Отменено.";
const SHA256_HEX = /^[0-9a-f]{64}$/;
const WEAPON_FILE = /^w_[a-z]{2}_.+\.(?:ydr|ytd|yft)$/s;
const ASTRAL_LAYER = "x64/astral/";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function isSkippedFolder(name, parentName) {
  const folder = name.toLowerCase();
  return (
    folder === "mods" ||
    (folder.startsWith("astral") && parentName.toLowerCase() === "dlcpacks")
  );
}

export async function gameArchives(root) {
  const found = [];
  const pending = [{ absolute: root, relative: "", name: basename(root) }];
  while (pending.length) {
    const folder = pending.pop();
    for (const item of await readdir(folder.absolute, { withFileTypes: true })) {
      const relative = folder.relative + item.name;
      if (item.isDirectory()) {
        if (!isSkippedFolder(item.name, folder.name)) {
          pending.push({
            absolute: join(folder.absolute, item.name),
            relative: `${relative}/`,
            name: item.name,
          });
        }
      } else if (item.isFile() && item.name.toLowerCase().endsWith(".rpf")) {
        found.push(relative);
      }
    }
  }
  return found.sort();
}

function isStockWeaponEntry(entry) {
  if (entry.kind === "directory") return false;
  const path = String(entry.path ?? "").toLowerCase();
  return !path.startsWith(ASTRAL_LAYER) && WEAPON_FILE.test(path.split("/").pop());
}

export async function collectStockWeapons(archive, { rpf = "", signal = null } = {}) {
  const files = [];
  const problems = [];
  for (const entry of archive.entries) {
    if (isStockWeaponEntry(entry)) {
      if (signal?.aborted) throw signal.reason || new Error(CANCELLED);
      const path = rpf ? `${String(rpf)}/${entry.path}` : entry.path;
      try {
        const bytes = await archive.read(entry.path);
        files.push({
          name: String(entry.path).split("/").pop().toLowerCase(),
          path,
          sha256: entryContentHash(bytes, { resource: entry.kind === "resource" }),
        });
      } catch (error) {
        problems.push({ path, message: String(error?.message) });
      }
    }
  }
  return { files, problems };
}

export function stockWeaponsBaseline({ label = "", files = [], problems = [] }) {
  return {
    schema: STOCK_WEAPONS_SCHEMA,
    kind: KIND,
    source: { label: label ? String(label) : "" },
    files,
    problems,
  };
}

export async function writeStockWeapons(file, baseline) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await gzipAsync(Buffer.from(JSON.stringify(baseline)), { level: 9 }));
}

function isStockWeaponsBase(value) {
  return (
    value?.schema === STOCK_WEAPONS_SCHEMA &&
    value.kind === KIND &&
    Array.isArray(value.files) &&
    value.files.every((row) => typeof row?.name === "string" && SHA256_HEX.test(row.sha256))
  );
}

export async function readStockWeapons(file) {
  const raw = await readFile(file);
  const packed = raw[0] === 0x1f && raw[1] === 0x8b;
  const value = JSON.parse((packed ? await gunzipAsync(raw) : raw).toString("utf8"));
  if (!isStockWeaponsBase(value)) {
    throw new Error(
      `${basename(file)} — не база штатных стволов Astral (catalog:baseline --weapons, схема 1).`,
    );
  }
  return { ...value, hashes: new Set(value.files.map((row) => row.sha256)) };
}
