/*
 * Групповые метки: что стоит у игрока и сборка патча (задача 21 ТЗ 18.10.2026, вечер).
 * Что за метки и почему именно эти — `@modovik/minimap-contract/group-markers`.
 *
 * Редактор присылает работу (и свои картинки, если они выбраны), а здесь из `update.rpf` игрока
 * берутся настоящие словари `x64/textures/script_txds.rpf/<словарь>.ytd`, и в них меняются пиксели
 * только выбранных листов; размер, формат и число mip — как у игрока, остальные листы словаря
 * (в `commonmenu` их 72) остаются байт в байт.
 *
 * «Как в игре» — штатный лист: из сборки человека до Astral (`pre-astral-base.js`), а её нет — из
 * Rockstar-архива (`x64v.rpf`, `x64a.rpf`); если в update.rpf уже он, словарь не трогается. У словаря,
 * чьего эталона нигде нет (`mppublicmissioncreatoricons` лежит только в update.rpf), вернуть лист
 * можно только снятием работы целиком.
 *
 * Накладки радара (`radar_overlay_*`) — не лист ytd, а спрайты Scaleform в `minimap.gfx`: цвет, «убрать» и своя
 * картинка — в том числе гифка кадрами, которая в игре играет (`group-marker-overlay-gfx.js`). Файл общий с
 * редактором «Мини-карта», поэтому правится поверх живого — только свои спрайты и свой диапазон номеров символов.
 *
 * Патч уходит тому же нативному установщику, что ставит эффекты попадания на экране, а рядом лежит
 * `recompose.json`: библиотека, снимая работу из середины стопки, собирает её заново поверх нового
 * архива.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { BLOCK_FORMATS, encodeDds, writeDdsHeader } from "@modovik/dds";
import { decodeTextureRef, readTextureDictionary } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import { killEffectPatchManifest } from "@modovik/kill-effects/compile.js";
import {
  GROUP_MARKERS,
  GROUP_MARKER_DICTS,
  GROUP_MARKER_EDGE_LIMIT,
  GROUP_MARKER_GIF_LIMITS,
  GROUP_MARKER_OVERLAY_ENTRY,
  GROUP_MARKER_OVERLAY_SHEET_ENTRY,
  GROUP_MARKER_OVERLAY_TARGET,
  GROUP_MARKER_STOCK_SOURCES,
  clearMark,
  describeGroupMarkersWork,
  finishMark,
  groupMarkerAssets,
  groupMarkerDictEntry,
  groupMarkerDictTarget,
  groupMarkerDictionaries,
  groupMarkerOverlays,
  groupMarkersWorkIsStock,
  hasGroupMarkerFinish,
  normalizeGroupMarkersWork,
  recolourMark,
} from "@modovik/minimap-contract/group-markers";
import { compileOverlayGfx, fitOverlayFrames, overlaysEdited, renderOverlayPng, resolveOverlays } from "./group-marker-overlay-gfx.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { preAstralUpdateArchive } from "./pre-astral-base.js";
import { callNativeEngine } from "./native-engine.js";
import { registerPatchRecomposer, writeRecomposeSidecar } from "./patch-recompose.js";
import { extractRpfEntries, patchYtdTextures } from "./rpf-composer.js";

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  extract: extractRpfEntries,
  patchYtd: patchYtdTextures,
});

const MAX_PROJECT_BYTES = 64 * 1024;
/* Своя картинка от окна — PNG: десятки килобайт; потолок на штуку и на все вместе. */
const MAX_PICTURE_BASE64 = 3_000_000;
/* На метку — картинка и, у накладки радара, лента кадров гифки. */
const MAX_PICTURES = GROUP_MARKERS.length * 2;
const OVERLAY_NAMES = GROUP_MARKERS.filter((item) => item.overlay).map((item) => item.overlay.sprite);
const PATCH_FAMILY = "group-marker-patches";
/* Насколько лист может отличаться от штатного и всё ещё быть им: DXT разные кодировщики собирают по-разному. */
const SAME_TOLERANCE = 3;
/* Картинка листа окну — не больше этого: карточке каталога хватает, а IPC не раздувается. */
const PREVIEW_EDGE = 128;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Работа групповых меток обязательна.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_BYTES) throw new RangeError("Работа групповых меток больше 64 КБ.");
  return normalizeGroupMarkersWork(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/*
 * Файлы игрока: словари из update.rpf; сборка человека до Astral; эталоны Rockstar из базовых
 * архивов. Отсутствие файла — состояние, а не сбой: у сборок с чужими модами состав бывает другим.
 * Рабочую папку убирает вызывающий.
 */
async function readBases(input, stateDir, tools) {
  const { extract, preAstral = preAstralUpdateArchive } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const directory = path.join(path.resolve(stateDir || os.tmpdir()), "group-marker-bases", randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const outputs = (result) => new Map((result?.extracted || []).map((item) => [normalizeEntry(item.entry), item.output]));
  const dicts = GROUP_MARKER_DICTS;
  /* Словари меток и, пока в каталоге есть накладки радара, minimap.gfx с листом значков. */
  const entries = [
    ...dicts.map(groupMarkerDictEntry),
    ...(OVERLAY_NAMES.length ? [GROUP_MARKER_OVERLAY_ENTRY, GROUP_MARKER_OVERLAY_SHEET_ENTRY] : []),
  ];
  try {
    /*
     * 19.10.2026, журнал тестера: «Nested RPF not found: script_txds.rpf» — помощник отказывал за весь
     * список, и редактор рисовал все метки очерком Astral. Теперь чего нет в update.rpf — нет только этого:
     * эталоны Rockstar (`x64v.rpf`, `x64a.rpf`) читаются ниже, а причина — в ответе окну.
     */
    let liveFailure = "";
    const live = outputs(
      await extract({
        archivePath: path.join(gameRoot, "update", "update.rpf"),
        archiveTarget: "update/update.rpf",
        entries,
        outputDirectory: path.join(directory, "update"),
        gameRoot,
        edition: "Legacy",
      }).catch((error) => {
        liveFailure = String(error?.message || error).slice(0, 200);
        return null;
      }),
    );
    const beforeArchive = await preAstral({ stateDir, gameRoot }).catch(() => null);
    const before = beforeArchive
      ? outputs(
          await extract({
            archivePath: beforeArchive,
            archiveTarget: "update/update.rpf",
            entries,
            outputDirectory: path.join(directory, "before"),
            gameRoot,
            edition: "Legacy",
          }).catch(() => null),
        )
      : new Map();
    /* Эталон Rockstar — по архиву за раз: у каждого словаря свой список мест. */
    const rockstar = new Map();
    const perArchive = new Map();
    for (const dict of dicts)
      for (const [archive, entry] of GROUP_MARKER_STOCK_SOURCES[dict] || []) {
        const list = perArchive.get(archive) || [];
        list.push([dict, entry]);
        perArchive.set(archive, list);
      }
    for (const [archive, list] of perArchive) {
      const got = outputs(
        await extract({
          archivePath: path.join(gameRoot, archive),
          archiveTarget: archive,
          entries: list.map(([, entry]) => entry),
          outputDirectory: path.join(directory, `stock-${archive.replace(/\W+/g, "-")}`),
          gameRoot,
          edition: "Legacy",
        }).catch(() => null),
      );
      for (const [dict, entry] of list) if (!rockstar.has(dict) && got.get(normalizeEntry(entry))) rockstar.set(dict, got.get(normalizeEntry(entry)));
    }
    return {
      gameRoot,
      directory,
      liveFailure,
      live: new Map(dicts.map((dict) => [dict, live.get(normalizeEntry(groupMarkerDictEntry(dict))) || null])),
      before: new Map(dicts.map((dict) => [dict, before.get(normalizeEntry(groupMarkerDictEntry(dict))) || null])),
      rockstar,
      /* Накладки радара: живой и штатный (до Astral) файлы и лист значков (живой — для картинки штатной накладки). */
      overlay: {
        live: live.get(normalizeEntry(GROUP_MARKER_OVERLAY_ENTRY)) || null,
        before: before.get(normalizeEntry(GROUP_MARKER_OVERLAY_ENTRY)) || null,
        sheet: before.get(normalizeEntry(GROUP_MARKER_OVERLAY_SHEET_ENTRY)) || live.get(normalizeEntry(GROUP_MARKER_OVERLAY_SHEET_ENTRY)) || null,
      },
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

const release = (bases) => (bases?.directory ? fs.rm(bases.directory, { recursive: true, force: true }).catch(() => {}) : null);

/**
 * Лист словаря: `{ name, format, width, height, levels, rgba, dds }` или `null`. `dds` — тот же лист
 * DDS-файлом из сырых уровней словаря, без пересжатия: «Как в игре» возвращает его байт в байт.
 */
async function dictionaryTexture(file, texture) {
  if (!file) return null;
  const bytes = await fs.readFile(file);
  const ref = readTextureDictionary(bytes, { inflateRaw: inflateRawNode }).find((item) => item.name.toLowerCase() === texture);
  if (!ref) return null;
  const level = decodeTextureRef(ref, { level: 0 });
  const raw = ref.spans.map((span) => Buffer.from(ref.resource.data.subarray(ref.dataAt + span.offset, ref.dataAt + span.offset + span.bytes)));
  const dds = BLOCK_FORMATS.includes(ref.format)
    ? Buffer.concat([Buffer.from(writeDdsHeader({ width: ref.width, height: ref.height, mipLevels: ref.levels, format: ref.format })), ...raw])
    : null;
  return { name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, rgba: level.rgba, dds };
}

function sameTexture(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
  for (let offset = 0; offset < a.rgba.length; offset += 4) {
    if (Math.abs(a.rgba[offset] - b.rgba[offset]) > SAME_TOLERANCE) return false;
    if (Math.abs(a.rgba[offset + 1] - b.rgba[offset + 1]) > SAME_TOLERANCE) return false;
    if (Math.abs(a.rgba[offset + 2] - b.rgba[offset + 2]) > SAME_TOLERANCE) return false;
    if (Math.abs(a.rgba[offset + 3] - b.rgba[offset + 3]) > SAME_TOLERANCE) return false;
  }
  return true;
}

/* Эталон листа: сборка человека до Astral — Rockstar — иначе `null`. */
async function stockTexture(bases, dict, texture) {
  const before = await dictionaryTexture(bases.before.get(dict), texture).catch(() => null);
  if (before?.dds) return { ...before, from: "before" };
  const rockstar = await dictionaryTexture(bases.rockstar.get(dict), texture).catch(() => null);
  return rockstar?.dds ? { ...rockstar, from: "rockstar" } : null;
}

/* Лист — окну картинкой (PNG base64), не больше PREVIEW_EDGE по длинной стороне. */
async function previewPng(texture) {
  if (!texture) return null;
  const png = await sharp(Buffer.from(texture.rgba.buffer, texture.rgba.byteOffset, texture.rgba.byteLength), {
    raw: { width: texture.width, height: texture.height, channels: 4 },
  })
    .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: "inside", withoutEnlargement: true, kernel: "nearest" })
    .png()
    .toBuffer();
  return png.toString("base64");
}

/*
 * Картинки штатных накладок радара берутся из листа значков: спрайт — куски `minimap.ytd` (внешняя картинка
 * Scaleform), без листа в кадр попадает пустое место.
 */
async function sheetImages(file) {
  if (!file) return null;
  const dictionary = readTextureDictionary(await fs.readFile(file), { inflateRaw: inflateRawNode });
  const cache = new Map();
  return (external) => {
    const key = String(external.exportName || "").toLowerCase();
    if (!cache.has(key)) {
      const ref = dictionary.find((texture) => texture.name.toLowerCase() === key);
      cache.set(key, ref ? decodeTextureRef(ref) : null);
    }
    return cache.get(key);
  };
}

/* Карточка накладки: найдена ли она в файле игры, габарит, кадры спрайта, штатная и нынешняя картинки. */
async function overlayState(bases, item) {
  const name = item.overlay.sprite;
  const out = { found: false, edited: false, box: null, frames: 0, stockPng: null, livePng: null };
  try {
    if (!bases.overlay.live) return out;
    const images = await sheetImages(bases.overlay.sheet).catch(() => null);
    const live = await fs.readFile(bases.overlay.live);
    const stock = bases.overlay.before ? await fs.readFile(bases.overlay.before) : live;
    const liveShot = await renderOverlayPng(live, name, { images });
    const stockShot = stock === live ? liveShot : await renderOverlayPng(stock, name, { images }).catch(() => null);
    if (!liveShot && !stockShot) return out;
    return {
      found: true,
      edited: Boolean(stockShot && liveShot && stockShot.png.compare(liveShot.png) !== 0),
      box: (stockShot || liveShot).box,
      frames: liveShot?.frames || 0,
      stockPng: (stockShot || liveShot).png.toString("base64"),
      livePng: liveShot ? liveShot.png.toString("base64") : null,
    };
  } catch {
    return out;
  }
}

/**
 * Что у игрока стоит сейчас: по каждой метке — есть ли её листы в игре, их размеры и формат, штатный
 * лист и нынешний картинками для карточки и кадра окна, и не правлен ли он (отличается от штатного).
 */
/*
 * Прочитанное помнится на диске по отпечатку архивов игры (размер и время update.rpf и эталонов Rockstar, сборка
 * до Astral): повторное открытие редактора — без помощника RPF и без чтения 2+ ГБ архивов (19.10.2026). Новая
 * установка меняет update.rpf — отпечаток другой, и всё читается заново.
 */
const STATE_CACHE_VERSION = 1;
const STATE_CACHE_DIRECTORY = "group-markers-state";

async function stateFingerprint(input, stateDir) {
  const gameRoot = requireGameRoot(input);
  const stamp = async (file) => {
    const stat = await fs.stat(file).catch(() => null);
    return stat ? `${stat.size}:${Math.round(stat.mtimeMs)}` : "none";
  };
  const before = await preAstralUpdateArchive({ stateDir, gameRoot }).catch(() => null);
  const parts = [
    `v${STATE_CACHE_VERSION}`,
    GROUP_MARKERS.map((item) => item.id).join(","),
    gameRoot.toLowerCase(),
    await stamp(path.join(gameRoot, "update", "update.rpf")),
    await stamp(path.join(gameRoot, "x64v.rpf")),
    await stamp(path.join(gameRoot, "x64a.rpf")),
    before ? `${before}:${await stamp(before)}` : "no-before",
  ];
  return sha256(parts.join("|")).slice(0, 32);
}

export async function readGroupMarkersState(input, context, stateDir, tools = {}) {
  /* Подменённые инструменты (проверки) — без памяти: каждый раз читается заново. */
  if (tools.extract || !stateDir) return readGroupMarkersStateFresh(input, context, stateDir, tools);
  const directory = path.join(path.resolve(stateDir), STATE_CACHE_DIRECTORY);
  const key = await stateFingerprint(input, stateDir).catch(() => null);
  const file = key ? path.join(directory, `${key}.json`) : null;
  if (file) {
    const kept = await fs
      .readFile(file, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (kept && Array.isArray(kept.marks)) return kept;
  }
  const state = await readGroupMarkersStateFresh(input, context, stateDir, tools);
  /* Память — только у прочитанного без сбоя: отказ update.rpf не запоминается, его стоит попробовать снова. */
  if (file && state.available) {
    await fs.mkdir(directory, { recursive: true }).catch(() => {});
    for (const name of await fs.readdir(directory).catch(() => [])) if (name !== `${key}.json`) await fs.rm(path.join(directory, name), { force: true }).catch(() => {});
    await fs.writeFile(file, JSON.stringify(state)).catch(() => {});
  }
  return state;
}

async function readGroupMarkersStateFresh(input, context, stateDir, tools = {}) {
  const bases = await readBases(input, stateDir, tools);
  try {
    const marks = [];
    for (const item of GROUP_MARKERS) {
      const targets = [];
      for (const target of item.targets) {
        const live = await dictionaryTexture(bases.live.get(target.dict), target.texture).catch(() => null);
        const stock = await stockTexture(bases, target.dict, target.texture);
        targets.push({
          dict: target.dict,
          texture: target.texture,
          present: Boolean(live),
          width: live?.width || target.width,
          height: live?.height || target.height,
          format: live?.format || null,
          levels: live?.levels || 0,
          stockKnown: Boolean(stock),
          changed: live && stock ? !sameTexture(live, stock) : null,
          /* Штатный лист, а его нигде нет — нынешний: кадр показывает то, что видит игрок. */
          stockPng: await previewPng(stock || live),
          livePng: await previewPng(live),
        });
      }
      if (item.overlay) {
        marks.push({ id: item.id, found: false, targets: [], overlay: await overlayState(bases, item) });
        continue;
      }
      marks.push({ id: item.id, found: targets.every((target) => target.present), targets });
    }
    const reasons = [];
    if (bases.liveFailure) reasons.push(`update.rpf не прочитался: ${bases.liveFailure}`);
    else if (!bases.live.get("commonmenu")) reasons.push(`в update.rpf нет ${groupMarkerDictEntry("commonmenu")}`);
    return {
      available: reasons.length === 0,
      reason: reasons.join("; "),
      marks,
    };
  } finally {
    await release(bases);
  }
}

/* ------------------------------------------------------- свои картинки */

/**
 * Свои картинки от окна: отпечаток → PNG. Установщик входу не верит: каждая картинка сверяется с
 * отпечатком и разбирается заново.
 */
async function normalizePictures(input, project) {
  const wanted = groupMarkerAssets(project);
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (wanted.size > MAX_PICTURES) throw new RangeError("Слишком много своих картинок.");
  const out = new Map();
  for (const asset of wanted.keys()) {
    const data = String(raw[asset] || "");
    if (!data || data.length > MAX_PICTURE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw new RangeError("Своя картинка метки не читается — выберите её заново.");
    const bytes = Buffer.from(data, "base64");
    if (sha256(bytes) !== asset) throw new RangeError("Своя картинка метки не совпала с отпечатком — выберите её заново.");
    const meta = await sharp(bytes, { failOn: "error", limitInputPixels: 4096 * 4096 }).metadata();
    if (!meta.width || !meta.height || meta.width > GROUP_MARKER_EDGE_LIMIT * 4 || meta.height > GROUP_MARKER_EDGE_LIMIT * 4)
      throw new RangeError("Своя картинка метки слишком велика.");
    out.set(asset, bytes);
  }
  return out;
}

/*
 * Лента кадров гифки (PNG, кадры друг под другом) → кадры накладки: `[{ png, delayMs }]`. Число кадров и высота ленты
 * сверяются: лента, что не делится на кадры, — отказ, а не тихо поломанная анимация.
 */
async function stripFrames(stripBytes, edit) {
  const meta = await sharp(stripBytes, { failOn: "error", limitInputPixels: 4096 * 16384 }).metadata();
  const count = edit.frames;
  if (!meta.width || !meta.height || !count || count > GROUP_MARKER_GIF_LIMITS.frames || meta.height % count !== 0) throw new RangeError("Лента кадров гифки не делится на кадры — выберите гифку заново.");
  const height = meta.height / count;
  const out = [];
  for (let index = 0; index < count; index += 1)
    out.push({
      png: await sharp(stripBytes, { failOn: "error", limitInputPixels: 4096 * 16384 }).extract({ left: 0, top: index * height, width: meta.width, height }).png().toBuffer(),
      delayMs: edit.delays[index],
    });
  return out;
}

/* Картинка → пиксели листа: вписана целиком по центру, вокруг прозрачно. */
async function fitted(bytes, width, height) {
  const { data } = await sharp(bytes, { failOn: "error", limitInputPixels: 4096 * 4096 })
    .ensureAlpha()
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
}

/* ---------------------------------------------------------------- сборка */

const fileEntry = ({ file, target, bytes }) => ({ file, target, bytes, size: bytes.length, sha256: sha256(bytes) });

/*
 * Что положить в лист: DDS нужного устройства (размер, формат, mip — как у игрока) или `null`, если
 * лист трогать незачем. `action` — что произошло, словами для сводки. `edit` — `null`, когда метку надо
 * вернуть игре (раньше она была правлена этой работой).
 */
async function textureDds({ bases, target, edit, pictures }) {
  const live = await dictionaryTexture(bases.live.get(target.dict), target.texture);
  if (!live) return { dds: null, action: "missing", note: `в игре нет листа ${target.dict}/${target.texture}` };
  if (!edit) {
    /* «Как в игре»: возвращать нечего, пока в игре штатный лист. */
    const stock = await stockTexture(bases, target.dict, target.texture);
    if (!stock) return { dds: null, action: "kept", note: "" };
    if (sameTexture(live, stock)) return { dds: null, action: "kept", note: "" };
    if (stock.width !== live.width || stock.height !== live.height || stock.levels !== live.levels || stock.format !== live.format)
      return { dds: null, action: "kept", note: `лист ${target.texture} другого устройства — не тронут` };
    return { dds: stock.dds, action: "stock", note: "" };
  }
  if (!BLOCK_FORMATS.includes(live.format) && live.format !== "A8R8G8B8") return { dds: null, action: "failed", note: `лист ${target.texture} в формате ${live.format}` };
  let pixels;
  let note = "";
  if (edit.mode === "image" || edit.mode === "text") {
    /* Надпись окно уже нарисовало картинкой (шрифты — его дело): здесь она листу — как любая своя картинка. */
    const bytes = edit.asset ? pictures.get(edit.asset) : null;
    if (!bytes) throw new RangeError(edit.mode === "text" ? "Надпись метки ещё не нарисована окном — откройте «Групповые метки», подождите, пока она появится, и примените снова." : "Картинки метки нет — выберите файл заново.");
    pixels = await fitted(bytes, live.width, live.height);
  } else {
    /* «Как в игре», цвет и «убрать»: основа — штатный рисунок (иначе перекраска и отделка ложились бы на уже правленое). */
    const stock = await stockTexture(bases, target.dict, target.texture);
    const base = stock && stock.width === live.width && stock.height === live.height ? stock : live;
    if (!stock && hasGroupMarkerFinish(edit)) note = `лист ${target.texture}: штатного эталона под рукой нет — отделка легла на нынешний лист`;
    pixels = new Uint8ClampedArray(base.rgba);
    if (edit.mode === "colour") recolourMark(pixels, edit.color);
    else if (edit.mode === "hidden") clearMark(pixels);
  }
  /* Размер, обводка, прозрачность, тонировка — тем же правилом, что рисует предпросмотр окна. */
  if (edit.mode !== "hidden") finishMark(pixels, live.width, live.height, edit);
  const dds = Buffer.from(encodeDds({ width: live.width, height: live.height, format: live.format, mipLevels: live.levels, rgba: pixels }));
  return { dds, action: edit.mode, note };
}

/** Новые словари по работе: `[{ dict, bytes }]` и заметки о том, что не тронуто и почему. */
async function buildDictionaries({ bases, project, restore, pictures, directory, tools }) {
  const { patchYtd } = { ...defaultTools(), ...tools };
  const changed = groupMarkerDictionaries(project);
  const built = [];
  const notes = [];
  const touched = [];
  for (const dict of GROUP_MARKER_DICTS) {
    const liveFile = bases.live.get(dict);
    if (!liveFile) {
      if (changed.has(dict)) notes.push(`в update.rpf нет словаря ${dict} — его метки не поставлены`);
      continue;
    }
    const patches = [];
    for (const item of GROUP_MARKERS)
      for (const target of item.targets) {
        if (target.dict !== dict) continue;
        const edit = project.marks[item.id] || null;
        /* Метка, которой работа не владеет, — чужая: чужой мод в том же словаре не откатывается. */
        if (!edit && !restore.has(item.id)) continue;
        const result = await textureDds({ bases, target, edit, pictures });
        if (result.note) notes.push(result.note);
        if (!result.dds) continue;
        const source = path.join(directory, `${dict}-${target.texture}.dds`);
        await fs.writeFile(source, result.dds);
        patches.push({ texture: target.texture, source, sha256: sha256(result.dds) });
        touched.push({ mark: item.id, dict, texture: target.texture, action: result.action });
      }
    if (!patches.length) continue;
    const output = path.join(directory, `${dict}.ytd`);
    await patchYtd({ input: liveFile, output, patches, gameRoot: bases.gameRoot, edition: "Legacy" });
    built.push({ dict, bytes: await fs.readFile(output) });
  }
  return { built, notes, touched };
}

/*
 * Накладки радара: новый `minimap.gfx` поверх живого или `null`, если трогать нечего. Свои накладки — по работе;
 * прежние, которых в новой работе нет, — штатным видом (`restore`).
 */
async function buildOverlay({ bases, project, restore, pictures }) {
  const wanted = groupMarkerOverlays(project);
  const restored = GROUP_MARKERS.filter((item) => item.overlay && restore.has(item.id)).map((item) => item.overlay.sprite);
  if (!wanted.length && !restored.length) return { gfx: null, notes: [], touched: [] };
  if (!bases.overlay.live) return { gfx: null, notes: [`в update.rpf нет ${GROUP_MARKER_OVERLAY_ENTRY} — накладки радара не поставлены`], touched: [] };
  const live = await fs.readFile(bases.overlay.live);
  const stockBuffer = bases.overlay.before ? await fs.readFile(bases.overlay.before) : null;
  /* Вернуть накладки нечем (сборки до Astral нет, а в файле наши правки): метки-листы всё равно возвращаются. */
  if (!wanted.length && !stockBuffer && overlaysEdited(live))
    return { gfx: null, notes: ["штатного minimap.gfx (сборки до Astral) под рукой нет — накладки радара не возвращены; верните их точкой отката"], touched: [] };
  const edits = new Map();
  const notes = [];
  try {
    for (const item of wanted) {
      const edit = item.edit;
      if (edit.mode !== "image") {
        edits.set(item.sprite, edit);
        continue;
      }
      /* Габарит штатной накладки — куда вписывается картинка; кадры — лента гифки или одна картинка. */
      const source = stockBuffer && stockBuffer.length ? stockBuffer : live;
      const bounds = resolveOverlays(source, [item.sprite]).sprites.get(item.sprite).bounds;
      if (!bounds) throw new Error(`У накладки ${item.sprite} нет габарита — картинку вписывать не во что.`);
      const frames = edit.strip && pictures.has(edit.strip) ? await stripFrames(pictures.get(edit.strip), edit) : [{ png: pictures.get(edit.asset), delayMs: 100 }];
      edits.set(item.sprite, { mode: "image", frames: await fitOverlayFrames(frames, bounds) });
    }
    const compiled = compileOverlayGfx(live, { names: OVERLAY_NAMES, edits, restore: new Set(restored), stockBuffer });
    if (compiled.buffer.equals(live)) return { gfx: null, notes, touched: [] };
    return {
      gfx: compiled.buffer,
      notes,
      touched: compiled.changed.map((item) => ({ mark: GROUP_MARKERS.find((mark) => mark.overlay?.sprite === item.name)?.id, dict: "minimap.gfx", texture: item.name, action: item.mode })),
    };
  } catch (error) {
    throw new Error(`Накладки радара: ${error.message}`);
  }
}

/* Метки прежней работы, которых в новой нет: их листы возвращаются игре. */
function restoredMarks(previousInput, project) {
  if (!previousInput || typeof previousInput !== "object") return new Set();
  const previous = boundedProject(previousInput);
  return new Set(Object.keys(previous.marks).filter((id) => !project.marks[id]));
}

async function materialize(input, context, stateDir, tools) {
  const project = boundedProject(input.project);
  const restore = restoredMarks(input.previous, project);
  const pictures = await normalizePictures(input.pictures, project);
  const bases = await readBases(input, stateDir, tools);
  try {
    const dictionaries = await buildDictionaries({ bases, project, restore, pictures, directory: bases.directory, tools });
    const overlays = await buildOverlay({ bases, project, restore, pictures });
    const { built } = dictionaries;
    const notes = [...dictionaries.notes, ...overlays.notes];
    const touched = [...dictionaries.touched, ...overlays.touched];
    if (!built.length && !overlays.gfx)
      throw new Error(notes.length ? `Нечего ставить: ${notes.join("; ")}.` : "В игре уже стоят штатные метки — менять нечего.");
    const files = [
      ...built.map(({ dict, bytes }) => fileEntry({ file: `${dict}.ytd`, target: groupMarkerDictTarget(dict), bytes })),
      ...(overlays.gfx ? [fileEntry({ file: "minimap.gfx", target: GROUP_MARKER_OVERLAY_TARGET, bytes: overlays.gfx })] : []),
    ];

    const patchDirectory = path.join(path.resolve(stateDir || os.tmpdir()), PATCH_FAMILY, randomUUID());
    const payloadDirectory = path.join(patchDirectory, "payload");
    await fs.mkdir(payloadDirectory, { recursive: true });
    for (const file of files) await fs.writeFile(path.join(payloadDirectory, file.file), file.bytes, { flag: "wx" });
    const summary = describeGroupMarkersWork(project);
    const manifest = killEffectPatchManifest({ name: `Astral group markers — ${summary}`, files });
    await fs.writeFile(path.join(patchDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    /* Записка пересборки: работа и свои картинки, из которых патч собран. */
    const recomposePictures = {};
    if (pictures.size) {
      await fs.mkdir(path.join(patchDirectory, "recompose"), { recursive: true });
      for (const [asset, bytes] of pictures) {
        await fs.writeFile(path.join(patchDirectory, "recompose", `${asset}.png`), bytes, { flag: "wx" });
        recomposePictures[asset] = `recompose/${asset}.png`;
      }
    }
    await writeRecomposeSidecar(patchDirectory, {
      kind: "group-markers",
      project,
      previous: input.previous ? boundedProject(input.previous) : null,
      pictures: recomposePictures,
    });

    return {
      patch: patchDirectory,
      gameRoot: bases.gameRoot,
      project,
      files: files.map((file) => ({ file: file.file, target: file.target, size: file.size, sha256: file.sha256 })),
      touched,
      notes,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      summary,
    };
  } finally {
    await release(bases);
  }
}

export async function planGroupMarkers(input, context, stateDir, tools = {}) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  try {
    const validation = await native("validate-rpf-patch", { patch: generated.patch }, context);
    return { ...generated, validation, edition: "Legacy", archive: "update/update.rpf" };
  } finally {
    /* План только проверяет: «Применить» собирает патч заново по живому архиву. */
    await fs.rm(generated.patch, { recursive: true, force: true }).catch(() => {});
  }
}

export async function applyGroupMarkers(input, context, stateDir, { assertRuntimeSafety, ...tools } = {}) {
  const { native, archiveSupport } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  await assertRuntimeSafety?.(generated.gameRoot);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    {
      patch: generated.patch,
      gameRoot: generated.gameRoot,
      archiveFix: path.join(support.directory, "ArchiveFix.exe"),
      keys: support.directory,
    },
    context,
  );
  return { ...installed, ...generated, edition: "Legacy" };
}

/* Работа без единой правки ставить нечего — окно спрашивает заранее. */
export const groupMarkersNeedsInstall = (project) => !groupMarkersWorkIsStock(project);

/*
 * Пересборка перед возвратом в игру (`patch-recompose.js`): та же работа и те же картинки поверх
 * архива, каким он стал после перемотки.
 */
registerPatchRecomposer("group-markers", async ({ sidecar, directory, gameRoot, stateDir, context, tools = {} }) => {
  const pictures = {};
  for (const [asset, relative] of Object.entries(sidecar.pictures || {})) {
    const file = path.resolve(directory, String(relative));
    if (!file.startsWith(path.resolve(directory) + path.sep)) throw new Error("Картинка метки в записке пересборки лежит вне патча.");
    pictures[asset] = (await fs.readFile(file)).toString("base64");
  }
  const generated = await materialize({ gameRoot, project: sidecar.project, previous: sidecar.previous || null, pictures }, context, stateDir, tools);
  return { patch: generated.patch };
});
