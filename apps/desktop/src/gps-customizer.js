/*
 * Метки и GPS: что стоит у игрока и сборка патча (задача 9 ТЗ 10.10.2026).
 * Устройство в игре — `@modovik/minimap-contract/gps` и `/paths`.
 *
 * Редактор присылает работу (и свою картинку значка, если она выбрана), а
 * здесь из `update.rpf` игрока берутся настоящие файлы, и в них меняется
 * только своё:
 *
 *   hudcolor.dat — числа строки `HUD_COLOUR_WAYPOINT` (и двух её тонов) и
 *                  строк выбранных цветов маршрутов сервера в обеих палитрах;
 *   minimap.ytd  — блоки DXT клетки метки 64×64 в листе
 *                  `blips_texturesheet_NG` на каждом уровне mip; остальные
 *                  значки листа — байт в байт;
 *   paths.rpf    — флаги узлов и связей (`transformYnd`): геометрия, связи и
 *                  названия улиц — как у игрока.
 *
 * Основа — сборка игрока до Astral (`pre-astral-base.js`), а её нет —
 * нынешний update.rpf: так прежняя работа GPS не ложится основой под новую.
 * «Как в игре» возвращает файлы этой основы там, где нынешние от неё
 * отличаются, и ничего не трогает там, где они те же.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { BLOCK_FORMATS, decodeTexture, encodeDds, writeDdsHeader } from "@modovik/dds";
import { readTextureDictionary } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import { killEffectPatchManifest } from "@modovik/kill-effects/compile.js";
import {
  GPS_HUD_ENTRY,
  GPS_HUD_NAMES,
  GPS_HUD_TARGET,
  GPS_ICON_CELL,
  GPS_ICON_ENTRY,
  GPS_ICON_TARGET,
  GPS_ICON_TEXTURE,
  GPS_MARKER_ICONS,
  compileHudColours,
  describeGpsWork,
  gpsHudColours,
  normalizeGpsWork,
  readHudColours,
} from "@modovik/minimap-contract/gps";
import { transformYnd, yndRoadGraph } from "@modovik/minimap-contract/paths";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { preAstralUpdateArchive } from "./pre-astral-base.js";
import { callNativeEngine } from "./native-engine.js";
import { registerPatchRecomposer, writeRecomposeSidecar } from "./patch-recompose.js";
import { extractRpfEntries, patchYtdTextures, searchRpfArchive } from "./rpf-composer.js";

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  extract: extractRpfEntries,
  search: searchRpfArchive,
  patchYtd: patchYtdTextures,
  preAstral: preAstralUpdateArchive,
});

const MAX_WORK_BYTES = 16 * 1024;
const MAX_PICTURE_BASE64 = 2_000_000;
const PATCH_FAMILY = "gps-patches";
const YND_PATTERN = /^x64\/levels\/gta5\/paths\.rpf\/nodes\d+\.ynd$/;
const DXT_BLOCK = { DXT1: 8, DXT3: 16, DXT5: 16 };
const ynd = { inflateRaw: (data) => zlib.inflateRawSync(data), deflateRaw: (data) => zlib.deflateRawSync(data, { level: 9 }) };

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

function boundedWork(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Работа меток и GPS обязательна.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_WORK_BYTES) throw new RangeError("Работа меток и GPS больше 16 КБ.");
  return normalizeGpsWork(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/* Файлы узлов в update.rpf: их 274 у Steam Legacy, но список читается, а не берётся из памяти. */
async function pathEntries(archivePath, gameRoot, search) {
  const found = await search({ archivePath, query: ".ynd", maxMatches: 5000, maxNestedDepth: 1, gameRoot, edition: "Legacy" });
  return [...new Set((found?.matches || []).map((item) => normalizeEntry(item.entry)).filter((entry) => YND_PATTERN.test(entry)))];
}

/*
 * Нынешние файлы игрока и та же тройка из основы до Astral. Отсутствие
 * файла — состояние, а не сбой: у сборок с чужими модами состав update.rpf
 * бывает другим. Рабочую папку убирает вызывающий.
 */
async function readBases(input, stateDir, tools, { withPaths = true } = {}) {
  const { extract, search, preAstral } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const archivePath = path.join(gameRoot, "update", "update.rpf");
  const directory = path.join(path.resolve(stateDir || os.tmpdir()), "gps-bases", randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const outputs = (result) => new Map((result?.extracted || []).map((item) => [normalizeEntry(item.entry), item.output]));
  try {
    const nodes = withPaths ? await pathEntries(archivePath, gameRoot, search) : [];
    const entries = [GPS_HUD_ENTRY, GPS_ICON_ENTRY, ...nodes];
    const live = outputs(
      await extract({ archivePath, archiveTarget: "update/update.rpf", entries, outputDirectory: path.join(directory, "live"), gameRoot, edition: "Legacy" }),
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
    return { gameRoot, directory, live, before, nodes, hasBefore: before.size > 0 };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

const release = (bases) => (bases?.directory ? fs.rm(bases.directory, { recursive: true, force: true }).catch(() => {}) : null);
const baseFile = (bases, entry) => bases.before.get(entry) || bases.live.get(entry) || null;

/* ------------------------------------------------------------ значок */

/* Лист значков из словаря: сырые уровни без пересжатия. */
async function readSheet(file) {
  if (!file) return null;
  const bytes = await fs.readFile(file);
  const ref = readTextureDictionary(bytes, { inflateRaw: inflateRawNode }).find((item) => item.name.toLowerCase() === GPS_ICON_TEXTURE);
  if (!ref) return null;
  const levels = ref.spans.map((span) => Buffer.from(ref.resource.data.subarray(ref.dataAt + span.offset, ref.dataAt + span.offset + span.bytes)));
  return { name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels };
}

/* Блоки DXT клетки метки на уровне `level`: строки блоков подряд. */
function cellBlocks(sheet, level) {
  const block = DXT_BLOCK[sheet.format];
  const width = Math.max(1, sheet.width >> level);
  const perRow = Math.max(1, Math.ceil(width / 4));
  const size = Math.max(4, GPS_ICON_CELL.size >> level);
  const cells = size / 4;
  const rows = [];
  for (let row = 0; row < cells; row += 1) {
    const offset = ((GPS_ICON_CELL.y >> level) / 4 + row) * perRow * block + ((GPS_ICON_CELL.x >> level) / 4) * block;
    rows.push({ offset, bytes: cells * block });
  }
  return rows;
}

/* Клетка метки верхнего уровня картинкой PNG (base64) — для кадра окна. */
async function cellPng(sheet) {
  if (!sheet || !BLOCK_FORMATS.includes(sheet.format)) return null;
  const blocks = Buffer.concat(cellBlocks(sheet, 0).map(({ offset, bytes }) => sheet.levels[0].subarray(offset, offset + bytes)));
  const rgba = decodeTexture(sheet.format, blocks, GPS_ICON_CELL.size, GPS_ICON_CELL.size);
  const png = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width: GPS_ICON_CELL.size, height: GPS_ICON_CELL.size, channels: 4 },
  })
    .png()
    .toBuffer();
  return png.toString("base64");
}

const sameCell = (a, b) =>
  a.levels.every((level, index) =>
    cellBlocks(a, index).every(({ offset, bytes }) => level.subarray(offset, offset + bytes).equals(b.levels[index].subarray(offset, offset + bytes))),
  );

/* Белый силуэт с тёмным контуром 64×64 — как значки игры: цвет даёт игра. */
async function presetCell(iconId) {
  const icon = GPS_MARKER_ICONS.find((item) => item.id === iconId);
  if (!icon?.path) throw new Error(`Неизвестный значок метки «${iconId}».`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="${icon.path}" fill="#ffffff" fill-rule="evenodd" stroke="#000000" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/></svg>`;
  const { data } = await sharp(Buffer.from(svg)).resize(64, 64).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
}

/*
 * Своя картинка → силуэт: непрозрачное — белое, вокруг — контур в три
 * точки чёрным, как у значков игры. Цвет картинки не нужен: игра красит
 * значок метки сама, цветом метки.
 */
async function pictureCell(input) {
  const data = String(input?.data || "");
  if (!data || data.length > MAX_PICTURE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new RangeError("Своя картинка метки не читается — выберите её заново.");
  const inner = 52;
  const { data: raw } = await sharp(Buffer.from(data, "base64"), { failOn: "error", limitInputPixels: 4096 * 4096 })
    .ensureAlpha()
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 6, bottom: 6, left: 6, right: 6, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const size = 64;
  const alpha = new Uint8Array(size * size);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = raw[i * 4 + 3];
  const inside = (x, y) => x >= 0 && y >= 0 && x < size && y < size && alpha[y * size + x] > 96;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 4;
      if (inside(x, y)) {
        out[at] = out[at + 1] = out[at + 2] = 255;
        out[at + 3] = 255;
        continue;
      }
      let ring = false;
      for (let dy = -3; dy <= 3 && !ring; dy += 1) for (let dx = -3; dx <= 3 && !ring; dx += 1) if (dx * dx + dy * dy <= 9 && inside(x + dx, y + dy)) ring = true;
      if (ring) out[at + 3] = 255;
    }
  return out;
}

/*
 * Новый minimap.ytd с одной заменённой клеткой — или `null`, если словарь
 * трогать незачем. Причина, по которой его не тронули, — словами.
 */
async function buildIcon({ bases, work, picture, directory, tools }) {
  const { patchYtd } = { ...defaultTools(), ...tools };
  const liveFile = bases.live.get(GPS_ICON_ENTRY);
  const live = await readSheet(liveFile);
  if (!live) {
    if (work.marker.icon === "stock") return { ytd: null, note: "" };
    throw new Error(`В ${GPS_ICON_ENTRY} игры нет листа значков ${GPS_ICON_TEXTURE} — значку метки встать некуда.`);
  }
  if (!BLOCK_FORMATS.includes(live.format)) throw new Error(`Лист значков игры в непривычном формате ${live.format}.`);
  let levels;
  if (work.marker.icon === "stock") {
    const stock = await readSheet(bases.before.get(GPS_ICON_ENTRY)).catch(() => null);
    if (!stock) return { ytd: null, note: bases.hasBefore ? "" : "основы до Astral нет — значок метки не тронут" };
    if (stock.format !== live.format || stock.width !== live.width || stock.levels.length !== live.levels.length)
      return { ytd: null, note: "лист значков другого устройства — значок метки не тронут" };
    if (sameCell(live, stock)) return { ytd: null, note: "" };
    levels = live.levels.map((level, index) => {
      const copy = Buffer.from(level);
      for (const { offset, bytes } of cellBlocks(live, index)) stock.levels[index].copy(copy, offset, offset, offset + bytes);
      return copy;
    });
  } else {
    const rgba = work.marker.icon === "custom" ? await pictureCell(picture) : await presetCell(work.marker.icon);
    const cellLevels = Math.min(live.levels.length, Math.log2(GPS_ICON_CELL.size / 4) + 1);
    const encoded = Buffer.from(encodeDds({ width: GPS_ICON_CELL.size, height: GPS_ICON_CELL.size, format: live.format, mipLevels: cellLevels, rgba }));
    let at = 128;
    levels = live.levels.map((level, index) => {
      const copy = Buffer.from(level);
      if (index >= cellLevels) return copy;
      const rows = cellBlocks(live, index);
      for (const { offset, bytes } of rows) {
        encoded.copy(copy, offset, at, at + bytes);
        at += bytes;
      }
      return copy;
    });
  }
  const dds = Buffer.concat([Buffer.from(writeDdsHeader({ width: live.width, height: live.height, mipLevels: live.levels.length, format: live.format })), ...levels]);
  const source = path.join(directory, `${GPS_ICON_TEXTURE}.dds`);
  await fs.writeFile(source, dds);
  const output = path.join(directory, "minimap.ytd");
  await patchYtd({ input: liveFile, output, patches: [{ texture: live.name, source, sha256: sha256(dds) }], gameRoot: bases.gameRoot, edition: "Legacy" });
  return { ytd: await fs.readFile(output), note: "" };
}

/* ------------------------------------------------------------- узлы */

/*
 * Файлы узлов, которые уходят в игру: из основы с точностью работы, и
 * только те, что отличаются от нынешних. «Как в игре» — основа там, где
 * нынешние уже правлены.
 */
async function buildPaths({ bases, work }) {
  const files = [];
  let nodes = 0;
  let links = 0;
  for (const entry of bases.nodes) {
    const liveFile = bases.live.get(entry);
    const sourceFile = baseFile(bases, entry);
    if (!liveFile || !sourceFile) continue;
    const [liveBytes, sourceBytes] = await Promise.all([fs.readFile(liveFile), fs.readFile(sourceFile)]);
    let bytes = sourceBytes;
    if (work.route.accuracy !== "stock") {
      const transformed = transformYnd(sourceBytes, work.route.accuracy, ynd);
      nodes += transformed.nodes;
      links += transformed.links;
      bytes = transformed.bytes;
    }
    /* Сравнение — по разжатым данным: одно и то же сжимается по-разному. */
    if (Buffer.from(ynd.inflateRaw(bytes.subarray(16))).equals(Buffer.from(ynd.inflateRaw(liveBytes.subarray(16))))) continue;
    files.push({ entry, bytes });
  }
  return { files, nodes, links };
}

/* ------------------------------------------------------------ состояние */

/**
 * Что у игрока стоит сейчас: цвета метки и маршрутов, свой ли значок и сам
 * лист значков картинкой для кадра окна, и правлены ли узлы дорог.
 */
export async function readGpsState(input, context, stateDir, tools = {}) {
  const bases = await readBases(input, stateDir, tools, { withPaths: false });
  try {
    const hudFile = bases.live.get(GPS_HUD_ENTRY);
    const hudBase = baseFile(bases, GPS_HUD_ENTRY);
    const colours = hudFile ? readHudColours(await fs.readFile(hudFile, "utf8")) : null;
    /* Цвета до Astral — по ним игрок узнаёт маршрут своего сервера. */
    const baseColours = hudBase && hudBase !== hudFile ? readHudColours(await fs.readFile(hudBase, "utf8")) : colours;
    const live = await readSheet(bases.live.get(GPS_ICON_ENTRY)).catch(() => null);
    const stock = await readSheet(bases.before.get(GPS_ICON_ENTRY)).catch(() => null);
    const reasons = [];
    if (!colours) reasons.push(`в update.rpf нет ${GPS_HUD_ENTRY}`);
    if (!live) reasons.push(`в update.rpf нет листа значков (${GPS_ICON_ENTRY})`);
    return {
      available: reasons.length === 0,
      reason: reasons.join("; "),
      colours,
      baseColours,
      icon: live
        ? {
            format: live.format,
            width: live.width,
            height: live.height,
            stock:
              stock && stock.format === live.format && stock.width === live.width && stock.levels.length === live.levels.length
                ? sameCell(live, stock)
                : null,
            /* Значок метки картинкой: штатный (основа до Astral) и нынешний. */
            stockPng: await cellPng(stock || live).catch(() => null),
            livePng: await cellPng(live).catch(() => null),
          }
        : null,
    };
  } finally {
    await release(bases);
  }
}

/* Граф дорог для предпросмотра маршрута: узлы машин всех файлов основы. */
const graphCache = new Map();

export async function readGpsRoadGraph(input, context, stateDir, tools = {}) {
  const gameRoot = requireGameRoot(input);
  const archive = await fs.stat(path.join(gameRoot, "update", "update.rpf")).catch(() => null);
  const cacheKey = `${gameRoot}|${archive?.size}|${archive?.mtimeMs}`;
  if (graphCache.has(cacheKey)) return graphCache.get(cacheKey);
  const bases = await readBases(input, stateDir, tools);
  try {
    const nodes = [];
    for (const entry of bases.nodes) {
      const file = baseFile(bases, entry);
      if (!file) continue;
      const bytes = await fs.readFile(file);
      nodes.push(...yndRoadGraph(Buffer.from(ynd.inflateRaw(bytes.subarray(16)))));
    }
    const graph = { nodes, files: bases.nodes.length, base: bases.hasBefore ? "before-astral" : "live" };
    graphCache.clear();
    graphCache.set(cacheKey, graph);
    return graph;
  } finally {
    await release(bases);
  }
}

/* ---------------------------------------------------------------- сборка */

const fileEntry = ({ file, target, bytes }) => ({ file, target, bytes, size: bytes.length, sha256: sha256(bytes) });

/* Сборка патча — и для «Применить», и для проверок (папку патча убирает вызывающий). */
export async function materializeGps(input, context, stateDir, tools = {}) {
  return materialize(input, context, stateDir, tools);
}

/**
 * Файлы работы GPS поверх игры игрока — без папки патча: `{ file, target,
 * bytes, size, sha256 }` только тех файлов, что отличаются от нынешних.
 * Пустой список — метка и маршрут у игры уже такие (не отказ).
 *
 * Читает её и мини-карта (задача 10 ТЗ 10.10.2026, вечер): метка и маршрут
 * переехали в её редактор, и их файлы уходят в игру одним патчем с ней.
 */
export async function gpsPatchFiles(input, context, stateDir, tools = {}) {
  const work = boundedWork(input.work);
  const picture = work.marker.icon === "custom" ? input.picture : null;
  const bases = await readBases(input, stateDir, tools);
  try {
    const hudFile = bases.live.get(GPS_HUD_ENTRY);
    if (!hudFile) throw new Error(`В update.rpf нет ${GPS_HUD_ENTRY} — цветам метки и маршрута некуда встать.`);
    const hudText = await fs.readFile(hudFile, "utf8");
    /* Цвета ложатся на основу: прежняя работа GPS не остаётся под новой. */
    const hudBase = baseFile(bases, GPS_HUD_ENTRY);
    const hud = compileHudColours(hudBase === hudFile ? hudText : await fs.readFile(hudBase, "utf8"), gpsHudColours(work));
    const icon = await buildIcon({ bases, work, picture, directory: bases.directory, tools });
    const paths = await buildPaths({ bases, work });
    const files = [
      ...(hud.text !== hudText ? [fileEntry({ file: "hudcolor.dat", target: GPS_HUD_TARGET, bytes: Buffer.from(hud.text, "utf8") })] : []),
      ...(icon.ytd ? [fileEntry({ file: "minimap.ytd", target: GPS_ICON_TARGET, bytes: icon.ytd })] : []),
      ...paths.files.map(({ entry, bytes }) =>
        fileEntry({ file: path.posix.basename(entry), target: `update:/${entry}`, bytes }),
      ),
    ];
    return {
      gameRoot: bases.gameRoot,
      work,
      picture,
      files,
      colours: hud.changed,
      icon: icon.ytd ? (work.marker.icon === "stock" ? "stock" : "custom") : "kept",
      iconNote: icon.note,
      paths: { files: paths.files.length, nodes: paths.nodes, links: paths.links, base: bases.hasBefore ? "before-astral" : "live" },
      summary: describeGpsWork(work),
    };
  } finally {
    await release(bases);
  }
}

async function materialize(input, context, stateDir, tools) {
  const generated = await gpsPatchFiles(input, context, stateDir, tools);
  const { files, work, picture, summary } = generated;
  if (!files.length) throw new Error("Метка и GPS у игры уже такие — ставить нечего.");

  const patchDirectory = path.join(path.resolve(stateDir || os.tmpdir()), PATCH_FAMILY, randomUUID());
  const payloadDirectory = path.join(patchDirectory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  for (const file of files) await fs.writeFile(path.join(payloadDirectory, file.file), file.bytes, { flag: "wx" });
  const manifest = killEffectPatchManifest({ name: `Astral GPS — ${summary}`, files });
  await fs.writeFile(path.join(patchDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  /* Записка пересборки: работа и своя картинка, из которых патч собран. */
  let recomposePicture = null;
  if (picture?.data) {
    await fs.mkdir(path.join(patchDirectory, "recompose"), { recursive: true });
    await fs.writeFile(path.join(patchDirectory, "recompose", "picture.png"), Buffer.from(String(picture.data), "base64"), { flag: "wx" });
    recomposePicture = "recompose/picture.png";
  }
  await writeRecomposeSidecar(patchDirectory, { kind: "gps", work, picture: recomposePicture });

  return {
    patch: patchDirectory,
    gameRoot: generated.gameRoot,
    work,
    files: files.map((file) => ({ file: file.file, target: file.target, size: file.size, sha256: file.sha256 })),
    colours: generated.colours,
    icon: generated.icon,
    iconNote: generated.iconNote,
    paths: generated.paths,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    summary,
  };
}

export async function planGps(input, context, stateDir, tools = {}) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  try {
    const validation = await native("validate-rpf-patch", { patch: generated.patch }, context);
    return { ...generated, validation, edition: "Legacy", archive: "update/update.rpf" };
  } finally {
    await fs.rm(generated.patch, { recursive: true, force: true }).catch(() => {});
  }
}

export async function applyGps(input, context, stateDir, { assertRuntimeSafety, ...tools } = {}) {
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

/*
 * Пересборка перед возвратом в игру (`patch-recompose.js`): та же работа и
 * та же картинка поверх архива, каким он стал после перемотки.
 */
registerPatchRecomposer("gps", async ({ sidecar, directory, gameRoot, stateDir, context, tools = {} }) => {
  let picture = null;
  if (sidecar.picture) {
    const file = path.resolve(directory, String(sidecar.picture));
    if (!file.startsWith(path.resolve(directory) + path.sep)) throw new Error("Картинка метки в записке пересборки лежит вне патча.");
    picture = { data: (await fs.readFile(file)).toString("base64") };
  }
  const generated = await materialize({ gameRoot, work: sidecar.work, picture }, context, stateDir, tools);
  return { patch: generated.patch };
});

export { GPS_HUD_NAMES };
