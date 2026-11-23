/*
 * «Бороды игры» (Ц3в, Б1, 16.11.2026): штатные бороды цирюльника как цели замены. Борода игры — наложение головы: имя листа в разделе `facialHair` файла
 * `update.rpf/common/data/effects/peds/facial_overlays.meta`, лист `mp_fm_faov_beard_NNN` на развёртке кожи головы (UV0), без геометрии. Здесь — только чтение
 * игры: список бород с номерами, где лежит лист, и его картинка для плитки. Запекание модели и установка — Б2 и Б3 (`NOTE-game-beards-api-1611.md`).
 *
 * Листы бывают в двух местах базы игры (`x64v.rpf`): `models/cdimages/ped_mp_overlay_txds.rpf` (словарь из трёх текстур: диффуз, `_n`, `_s`) и потоковая копия
 * `models/cdimages/strm_peds_mp_overlay_txds.rpf` (у 000…018 — диффуз отдельным файлом, чуть новее). Hipster-листы — `mphipster` (`mp_hip_faov_beard_NNN`), в списке игры
 * они `ng_Hip_…`: целью такой номер не показывается, пока сопоставление не выяснено.
 *
 * Только чтение: файлы игры не меняются. Список берётся из штатной основы `update.rpf` (без слоёв Astral), как у тату.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { GAME_BEARD_TINT, gameBeardEntries, parseFacialHair } from "@modovik/clothing/game-beards";
import sharp from "sharp";
import { beardTilePicture } from "./beard-picture.js";
import { readTattooYtd, stockUpdateArchive, tattooGameFiles, tattooPicture } from "./game-tattoos.js";

export { beardTilePicture };

/* 1 — первый разбор списка бород (Б1). */
export const GAME_BEARDS_INDEX_VERSION = 1;

const FACIAL_META = "common/data/effects/peds/facial_overlays.meta";
/* Архивы листов наложений головы: основной и потоковый (`strm_peds_…`), у дополнений — с приставкой пака. */
const OVERLAY_TXDS = /(^|\/)[^/]*peds?_mp_overlay_txds\.rpf$/i;
const STREAMED = /(^|\/)strm_[^/]*\.rpf$/i;
/* Лист бороды: имя словаря без суффиксов `_n`, `_s`. */
const BEARD_SHEET = /faov_beard_\d{3}$/i;
const HIPSTER_PACK = "mphipster";
const FULL_SIDE = 512;

const refusal = (code, message) => Object.assign(new Error(message), { code });
const textOf = (bytes) => new TextDecoder().decode(bytes);
const hashOf = (value) => createHash("sha256").update(String(value).toLowerCase()).digest("hex").slice(0, 16);
const arrayBufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/* Листы бород одного архива игры (или пака): `имя → [{ role, file, inner, entry }]`. `role` — `base` | `stream`. */
async function indexBeardSheets(archive, label, into) {
  for (const entry of archive.entries) {
    if (!OVERLAY_TXDS.test(entry.path)) continue;
    let child;
    try {
      child = await archive.open(entry.path);
    } catch {
      continue;
    }
    const inner = archive.chain ? [...archive.chain, archive.prefix + entry.path] : entry.path;
    const role = STREAMED.test(entry.path) ? "stream" : "base";
    for (const file of child.entries) {
      if (!/\.ytd$/i.test(file.path)) continue;
      const name = file.path.slice(file.path.lastIndexOf("/") + 1, -4).toLowerCase();
      if (!BEARD_SHEET.test(name)) continue;
      if (!into.has(name)) into.set(name, []);
      into.get(name).push({ role, file: label, inner, entry: file.path });
    }
  }
}

/**
 * Список бород игры. `io` — `tattooGameFiles` или его подмена. Ответ: `{ version, beards: [...] }` по договору (`index`, `number`, `name`, `family`, `title`, `target`, `reason`,
 * `places`, `place`, `state`). Номера — строки списка игры как есть: если у основной бороды листа нет, она пропускается, остальные номера не сдвигаются. Hipster остаются
 * в списке с `target: false`, даже без листа. Игра без списка (нет `facialHair`) — пустой ответ, не ошибка.
 */
export async function buildGameBeards({ io }) {
  const update = await io.openUpdate().catch(() => null);
  const meta = update ? await update.read(FACIAL_META).catch(() => null) : null;
  await update?.close?.();
  const names = meta ? parseFacialHair(textOf(meta)) : [];
  const sheets = new Map();
  if (names.length) {
    const base = await io.openBase().catch(() => null);
    if (base) {
      await indexBeardSheets(base, "x64v.rpf", sheets);
      await base.close?.();
    }
    const packs = names.some((name) => /^ng_hip_/i.test(name)) ? await io.listPacks().catch(() => []) : [];
    for (const pack of packs) {
      if (pack.name.toLowerCase() !== HIPSTER_PACK) continue;
      for (const file of pack.files) {
        let archive;
        try {
          archive = await io.openPackFile(pack.name, file, pack.within || null);
        } catch {
          continue;
        }
        try {
          await indexBeardSheets(archive, pack.within || `update/x64/dlcpacks/${pack.name}/${file}`, sheets);
        } finally {
          await archive.close?.();
        }
      }
    }
  }
  const beards = [];
  for (const entry of gameBeardEntries(names)) {
    /* Hipster: в списке `ng_hip_…`, в файлах `mp_hip_…` — лист ищем и под вторым именем, цели от этого он не становится. */
    const alias = entry.family === "hipster" ? entry.name.replace(/^ng_hip_/i, "mp_hip_") : "";
    const places = sheets.get(entry.name) || (alias ? sheets.get(alias) : null) || [];
    if (!places.length && entry.family !== "hipster") continue;
    beards.push({
      ...entry,
      places,
      /* Откуда читать картинку плитки: основная копия, иначе потоковая; ничего — `null`. */
      place: places.find((place) => place.role === "base") || places[0] || null,
      /* Б3 отметит `replaced`, когда пакет Astral стоит на этом номере. */
      state: "stock",
    });
  }
  return { version: GAME_BEARDS_INDEX_VERSION, builtAt: Date.now(), beards };
}

const BEARDS_MEMO_MS = 8000;
const beardsMemo = new Map();

/** Для тестов: забыть список в памяти. */
export const forgetGameBeardsMemo = () => beardsMemo.clear();

async function readGameBeardsFromFiles({ gameRoot, stateDir, keysDirectory, io = null, readState }, { refresh = false } = {}) {
  if (!gameRoot || (!io && !path.isAbsolute(gameRoot))) throw refusal("GAME_BEARDS", "Выберите папку GTA V Legacy.");
  const files =
    io ||
    tattooGameFiles(gameRoot, keysDirectory ? await keysFromDirectory(keysDirectory) : null, {
      updatePath: await stockUpdateArchive({ gameRoot, stateDir, readState }),
    });
  const fingerprint = await files.fingerprint();
  const cache = stateDir ? path.join(stateDir, "clothing-index", `game-beards-${hashOf(gameRoot)}.json`) : null;
  if (cache && !refresh) {
    const stored = await fs
      .readFile(cache, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (stored?.version === GAME_BEARDS_INDEX_VERSION && stored.fingerprint === fingerprint) return stored;
  }
  const index = await buildGameBeards({ io: files });
  index.fingerprint = fingerprint;
  /* Пустой список — не игра без бород, а папка не та или архивы заняты: в кэш он не идёт. */
  if (cache && index.beards.length) {
    await fs.mkdir(path.dirname(cache), { recursive: true });
    const temporary = `${cache}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(index));
    await fs.rename(temporary, cache);
  }
  return index;
}

/** Список бород игры игрока: из кэша или собранный заново (кэш — по отпечатку файлов игры, пауза в памяти — против потока одинаковых просьб). */
export async function readGameBeards(args, options = {}) {
  if (args?.io || options.refresh || !args?.gameRoot || !args?.stateDir) return readGameBeardsFromFiles(args, options);
  const key = `${path.resolve(String(args.stateDir)).toLowerCase()}|${hashOf(args.gameRoot)}`;
  const known = beardsMemo.get(key);
  if (known && (known.pending || Date.now() - known.at < BEARDS_MEMO_MS)) return known.value;
  const record = { at: Date.now(), pending: true, value: null };
  record.value = readGameBeardsFromFiles(args, options).then(
    (index) => {
      record.pending = false;
      record.at = Date.now();
      return index;
    },
    (error) => {
      if (beardsMemo.get(key) === record) beardsMemo.delete(key);
      throw error;
    },
  );
  beardsMemo.set(key, record);
  return record.value;
}

/**
 * Картинка плитки: лист штатной бороды (RGBA, прозрачный фон), обрезанный по рисунку и вписанный в плитку 160 px (`beardTilePicture`); `full` — весь лист как есть, до 512. Голову с этим листом рисует окно
 * (слоем, как грим), здесь только лист. Кэш — по игре и бороде. Ответ: `{ key, bytes, tint }`.
 */
export async function readGameBeardPicture(input, { stateDir, keysDirectory, io = null } = {}) {
  const gameRoot = String(input?.gameRoot || "");
  const key = String(input?.key || "").toLowerCase();
  const full = input?.full === true;
  if (!key) throw refusal("GAME_BEARDS", "Не названа борода.");
  const cache = stateDir ? path.join(stateDir, "clothing-index", "beard-pictures", hashOf(gameRoot), `${hashOf(key)}${full ? "-full" : "-tile"}.png`) : null;
  let bytes = cache ? await fs.readFile(cache).catch(() => null) : null;
  if (!bytes) {
    const index = await readGameBeards({ gameRoot, stateDir, keysDirectory, io });
    const beard = index.beards.find((entry) => entry.key === key);
    if (!beard) throw refusal("GAME_BEARDS", "Такой бороды в игре нет.");
    if (!beard.place) throw refusal("GAME_BEARDS", "Листа этой бороды в игре нет.");
    const ytd = await readTattooYtd({ gameRoot, keysDirectory, tattoo: { place: beard.place }, io });
    /* В словаре основной копии три текстуры (диффуз, `_n`, `_s`): нужна та, что называется как лист. У hipster имя файла другое — берётся имя из `place.entry`. */
    const texture = beard.place.entry.slice(beard.place.entry.lastIndexOf("/") + 1, -4).toLowerCase();
    const picture = tattooPicture(ytd, texture, { maxSize: FULL_SIDE });
    bytes = full
      ? await sharp(Buffer.from(picture.rgba), { raw: { width: picture.width, height: picture.height, channels: 4 } }).png().toBuffer()
      : await beardTilePicture(picture.rgba, picture.width, picture.height);
    if (cache) {
      await fs.mkdir(path.dirname(cache), { recursive: true });
      await fs.writeFile(cache, bytes);
    }
  }
  return { key, bytes: arrayBufferOf(bytes), tint: GAME_BEARD_TINT };
}
