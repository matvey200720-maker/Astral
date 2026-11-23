/*
 * «Интерьеры проектов» — листы для 3D-кадра интерьера.
 *
 * Кадр просит лист по адресу и имени: лист из файла самого интерьера
 * (`p:<путь каталога>`) или штатный лист из игры игрока (`архив:путь`). Ответ —
 * WebP по порядку запроса (`null` — листа нет), как у `workshop-textures.js`:
 * лист извлекается на машине игрока, уменьшается до размера кадра и ложится в
 * его кэш под отпечатком файла-источника. Ни листы проектов, ни листы Rockstar
 * никуда не уезжают и в поставке Astral их нет.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { inflateResource } from "@modovik/native-rs";
import { archiveKeysDirectory, provisionArchiveSupport } from "../loader-provisioner.js";
import { createGameReader } from "../optimization-layers.js";
import { findUnit } from "./catalog.js";
import { lazyFolderReader } from "./file-source.js";
import { PROJECT_FILE } from "./scene.js";
import { readSources, unitRoot } from "./store.js";

const MAX_REQUESTS = 96;
/* 2048 — лист целиком для студии текстур (ТЗ 29.10.2026-e): холст студии по размеру листа, а не по превью в 512. */
const SIZES = Object.freeze([64, 128, 256, 512, 1024, 2048]);
const MAX_RESOURCE_BYTES = 96 * 1024 * 1024;
const TEXTURE_NAME = /^[a-z0-9_.+-]{1,160}$/;
const INTERIOR_ID = /^p[0-9a-f]{8}$/;
const GAME_ADDRESS = /^(x64[a-z]\.rpf|update|update\/x64\/dlcpacks\/[a-z0-9_]{1,40}\/dlc\.rpf):((?:[a-z0-9_+.-]{1,80}\/){0,12}[a-z0-9_+.-]{1,120}\.(?:ydr|yft|ytd|ydd))$/;
const inflateRaw = inflateResource;
const sha = (text) => createHash("sha256").update(text).digest("hex");

export const SHEET_STATUS = Object.freeze({ ok: "ok", absent: "absent", unavailable: "unavailable" });

const defaultTools = () => ({
  archiveSupport: provisionArchiveSupport,
  openGame: async (gameRoot, keys) => createGameReader(gameRoot, keys),
});

async function encode(rgba, width, height) {
  let opaque = true;
  for (let at = 3; at < rgba.length; at += 4)
    if (rgba[at] < 250) {
      opaque = false;
      break;
    }
  const image = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } });
  return (opaque ? image.removeAlpha() : image).webp({ quality: 84, alphaQuality: 90, effort: 3 }).toBuffer();
}

const asArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/* Просьба о листе: свой файл интерьера или штатный адрес игры. */
function normalizeRequest(item) {
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "").toLowerCase();
  if (!TEXTURE_NAME.test(name)) return null;
  const size = SIZES.includes(Number(item.size)) ? Number(item.size) : 512;
  const address = String(item.game || "").replace(/\\/g, "/");
  if (address.startsWith(PROJECT_FILE)) {
    const file = address.slice(PROJECT_FILE.length);
    if (!file || file.split("/").some((part) => part === ".." || part === ".") || !/\.(ydr|yft|ytd|ydd)$/i.test(file) || file.length > 1024) return null;
    return { kind: "own", file, name, size };
  }
  const lower = address.toLowerCase();
  const match = GAME_ADDRESS.exec(lower);
  if (!match || match[2].split("/").some((part) => part === ".." || part === ".")) return null;
  return { kind: "game", location: lower, archive: match[1], name, size };
}

function texturesOf(bytes, fileName) {
  const resource = openResourceWith(bytes, inflateRaw);
  if (/\.ytd$/i.test(fileName)) return readTextureDictionary(resource);
  return readDrawable(resource, { inflateRaw, kind: fileName.split(".").pop().toLowerCase() }).drawables.flatMap((drawable) => drawable.embeddedTextures || []);
}

/**
 * Листы для кадра интерьера: `input = { project, id, gameRoot?, keys?,
 * textures: [{ game: "p:путь" | "архив:путь", name, size? }] }`. Ответ —
 * `{ textures: [ArrayBuffer | null], status: ["ok" | "absent" | "unavailable"] }`.
 */
export async function readProjectSheets(input, stateDir, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  const requests = (Array.isArray(input?.textures) ? input.textures.slice(0, MAX_REQUESTS) : []).map(normalizeRequest);
  const id = String(input?.id || "");
  const unit = INTERIOR_ID.test(id) ? await findUnit(String(input?.project || ""), id, stateDir) : null;
  const source = unit ? (await readSources(stateDir)).find((item) => item.id === unit.internal.sourceId) : null;
  const allowed = new Set([...(unit?.internal.files || []), ...(unit?.internal.shared || [])]);
  const gameRoot = String(input?.gameRoot || "").trim();
  const withGame = Boolean(gameRoot && path.isAbsolute(gameRoot));
  const cacheDir = path.join(stateDir, "project-interiors", "sheets");
  await fs.mkdir(cacheDir, { recursive: true });

  const keysDirectory = requests.some(Boolean) ? await archiveKeysDirectory({ keys: input?.keys, stateDir, provision: t.archiveSupport }) : null;
  const keys = keysDirectory ? await keysFromDirectory(keysDirectory).catch(() => null) : null;
  const own = source ? lazyFolderReader(unitRoot(unit, source), { keys }) : null;
  let game = null;
  const gameReader = async () => (game ||= await t.openGame(gameRoot, keys));
  const stamps = new Map();
  const stampOf = async (request) => {
    const key = request.kind === "own" ? `own:${unit?.internal.sourceId}:${unit?.internal.pack || ""}` : `game:${request.archive}`;
    if (!stamps.has(key)) {
      const file = request.kind === "own" ? (source ? unitRoot(unit, source) : null) : path.join(gameRoot, request.archive === "update" ? "update/update.rpf" : request.archive);
      const stat = file ? await fs.stat(file).catch(() => null) : null;
      stamps.set(key, stat ? `${stat.size}:${Math.round(stat.mtimeMs)}` : null);
    }
    return stamps.get(key);
  };
  const resources = new Map();
  const listOf = (request) => {
    const key = request.kind === "own" ? `own:${request.file}` : `game:${request.location}`;
    if (!resources.has(key)) {
      resources.set(
        key,
        (async () => {
          const bytes = request.kind === "own" ? await own.read(request.file) : await (await gameReader()).read(request.location);
          if (!bytes || bytes.length > MAX_RESOURCE_BYTES) return [];
          try {
            return texturesOf(new Uint8Array(bytes), request.kind === "own" ? request.file : request.location);
          } catch {
            return [];
          }
        })(),
      );
    }
    return resources.get(key);
  };

  const result = [];
  const status = [];
  const answer = (value, state) => {
    result.push(value);
    status.push(state);
  };
  try {
    for (const request of requests) {
      if (!request) {
        answer(null, SHEET_STATUS.absent);
        continue;
      }
      if (request.kind === "own" ? !own || !allowed.has(request.file) : !withGame) {
        answer(null, request.kind === "own" ? SHEET_STATUS.absent : SHEET_STATUS.unavailable);
        continue;
      }
      const stamp = await stampOf(request);
      if (!stamp) {
        answer(null, SHEET_STATUS.unavailable);
        continue;
      }
      const where = request.kind === "own" ? `own:${unit.internal.sourceId}:${unit.internal.pack || ""}|${request.file}|${unit.files.bytes}` : `${gameRoot.toLowerCase()}|${request.location}`;
      const file = path.join(cacheDir, `${sha(`${where}|${request.name}|${request.size}|${stamp}`).slice(0, 32)}.webp`);
      const cached = await fs.readFile(file).catch(() => null);
      if (cached) {
        answer(asArrayBuffer(cached), SHEET_STATUS.ok);
        continue;
      }
      const ref = (await listOf(request)).find((item) => item.name.toLowerCase() === request.name);
      if (!ref) {
        answer(null, SHEET_STATUS.absent);
        continue;
      }
      try {
        const level = decodeTextureRef(ref, { maxSize: request.size });
        const bytes = await encode(level.rgba, level.width, level.height);
        await fs.writeFile(file, bytes).catch(() => {});
        answer(asArrayBuffer(bytes), SHEET_STATUS.ok);
      } catch {
        answer(null, SHEET_STATUS.unavailable);
      }
    }
  } finally {
    await game?.close?.().catch(() => {});
    await own?.close();
  }
  return { textures: result, status };
}
