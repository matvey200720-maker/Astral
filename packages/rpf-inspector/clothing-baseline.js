// База штатной одежды: какие файлы вещей и наложений лежат в чистой игре, только имя, адрес и хэш.

import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { entryContentHash } from "./baseline.js";

export const STOCK_CLOTHING_SCHEMA = 1;

const KIND = "stock-clothing";
const CANCELLED = "Отменено.";
const SHA256_HEX = /^[0-9a-f]{64}$/;
const PED_FOLDERS = ["mp_m_freemode_01", "mp_f_freemode_01"];
const OVERLAY_CONTAINERS = ["_overlays.rpf", "ped_mp_overlay_txds.rpf"];

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function pathTail(path) {
  const parts = String(path ?? "").toLowerCase().split("/");
  return { file: parts.at(-1), folder: parts.at(-2) ?? "" };
}

function isNamed(file, ...extensions) {
  return extensions.some((ext) => file.length > ext.length && file.endsWith(ext));
}

function isGarmentFile({ file, folder }) {
  return (
    isNamed(file, ".ydd", ".ytd") &&
    !file.includes("^") &&
    PED_FOLDERS.some((ped) => folder.startsWith(ped))
  );
}

function isOverlayDictionary({ file, folder }) {
  return isNamed(file, ".ytd") && OVERLAY_CONTAINERS.some((tail) => folder.endsWith(tail));
}

function isStockClothingEntry(entry) {
  if (entry.kind === "directory") return false;
  const tail = pathTail(entry.path);
  return isGarmentFile(tail) || isOverlayDictionary(tail);
}

export async function collectStockClothing(archive, { rpf = "", signal = null } = {}) {
  const files = [];
  const problems = [];
  for (const entry of archive.entries) {
    if (isStockClothingEntry(entry)) {
      if (signal?.aborted) throw signal.reason || new Error(CANCELLED);
      const path = rpf ? `${String(rpf)}/${entry.path}` : entry.path;
      try {
        const bytes = await archive.read(entry.path);
        const sha256 = entryContentHash(bytes, { resource: entry.kind === "resource" });
        files.push({ name: pathTail(entry.path).file, path, sha256 });
      } catch (error) {
        problems.push({ path, message: String(error?.message) });
      }
    }
  }
  return { files, problems };
}

export function stockClothingBaseline({ label = "", files = [], problems = [] }) {
  return {
    schema: STOCK_CLOTHING_SCHEMA,
    kind: KIND,
    source: { label: label ? String(label) : "" },
    files,
    problems,
  };
}

export async function writeStockClothing(file, baseline) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await gzipAsync(Buffer.from(JSON.stringify(baseline)), { level: 9 }));
}

function isStockClothingBase(value) {
  return (
    value?.schema === STOCK_CLOTHING_SCHEMA &&
    value.kind === KIND &&
    Array.isArray(value.files) &&
    value.files.every((row) => typeof row?.name === "string" && SHA256_HEX.test(row.sha256))
  );
}

export async function readStockClothing(file) {
  const raw = await readFile(file);
  const packed = raw[0] === 0x1f && raw[1] === 0x8b;
  const text = (packed ? await gunzipAsync(raw) : raw).toString("utf8");
  const value = JSON.parse(text);
  if (!isStockClothingBase(value)) {
    throw new Error(
      `${basename(file)} — не база штатной одежды Astral (catalog:baseline --clothing, схема 1).`,
    );
  }
  return { ...value, hashes: new Set(value.files.map((row) => row.sha256)) };
}
