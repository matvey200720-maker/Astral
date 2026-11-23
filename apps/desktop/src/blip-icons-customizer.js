/*
 * Значки карты игры: что стоит у игрока и сборка патча (задача 05.11.2026, «Иконки» большой карты).
 * Устройство — `blip-icon-cells.js` (номер спрайта → клетка листа), `blip-icon-sheets.js` (пиксели клетки),
 * договор работы — `@modovik/vector-map/blip-icons`.
 *
 * Окно присылает работу (`{ icons: { "<номер>": правка } }`) и свои картинки, а здесь из `update.rpf` игрока берутся
 * `minimap.ytd` (листы значков) и `minimap.gfx` (таблица «номер → символ → клетка»), и в листах меняются блоки DXT только
 * нужных клеток — на каждом уровне mip; остальные клетки и остальные текстуры словаря остаются байт в байт.
 * `minimap.gfx` НЕ правится: картинка значка лежит в листе, а не в фильме, поэтому в игре меняется и мини-карта, и карта
 * паузы (это один фильм).
 *
 * Файл `minimap.ytd` общий с «Метками и GPS» (клетка значка метки). Здесь правятся только свои клетки поверх ЖИВОГО файла,
 * поэтому порядок установки не важен: клетка метки GPS остаётся, а «Как в игре» возвращает ТОЛЬКО клетки, что ставила эта
 * работа (`previous`), и только из сборки человека до Astral — живая может уже нести нашу правку.
 *
 * Патч уходит тому же нативному установщику, что ставит эффекты попадания, рядом лежит `recompose.json`: библиотека,
 * снимая работу из середины стопки, собирает её заново поверх нового архива.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { bleedTransparent, writeDdsHeader } from "@modovik/dds";
import { killEffectPatchManifest } from "@modovik/kill-effects/compile.js";
import { GPS_ICON_ENTRY, GPS_ICON_TARGET } from "@modovik/minimap-contract/gps";
import { GROUP_MARKER_OVERLAY_ENTRY } from "@modovik/minimap-contract/group-markers";
import { blipIconAssets, blipIconsWorkIsStock, describeBlipIcons, normalizeBlipIcons } from "@modovik/vector-map/blip-icons";
import { blockAligned, readBlipTable, realRect } from "./blip-icon-cells.js";
import { cellPicture, isBlockFormat, placeInCell, readSheets, replaceCellAny, restoreCellAny, sameCellAny } from "./blip-icon-sheets.js";
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
  preAstral: preAstralUpdateArchive,
});

const MAX_WORK_BYTES = 256 * 1024;
/* Своя картинка от окна — PNG до 64×64 точек: десятки килобайт; потолок на штуку. */
const MAX_PICTURE_BASE64 = 400_000;
const MAX_PICTURES = 256;
const PATCH_FAMILY = "blip-icon-patches";
const ATLAS_COLUMNS = 32;
const CELL_SIDE = 64;
/* Значок метки GPS правит «Мини-карта» (`gps-customizer.js`): у Иконок эта клетка заперта. */
const GPS_SPRITE = 8;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

function boundedWork(input, label = "Работа значков карты") {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${label} обязательна.`);
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_WORK_BYTES) throw new RangeError(`${label} больше 256 КБ.`);
  return normalizeBlipIcons(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/* Свои картинки: ключ → PNG-байты; только те, что работа называет. */
function normalizePictures(input, work) {
  const wanted = new Set(blipIconAssets(work));
  const pictures = new Map();
  if (!input || typeof input !== "object" || Array.isArray(input)) return pictures;
  for (const [key, data] of Object.entries(input)) {
    if (!wanted.has(key)) continue;
    const encoded = String(data || "");
    if (!encoded || encoded.length > MAX_PICTURE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      throw new RangeError("Своя картинка значка не читается — выберите её заново.");
    pictures.set(key, Buffer.from(encoded, "base64"));
    if (pictures.size > MAX_PICTURES) throw new RangeError("Слишком много своих картинок значков.");
  }
  return pictures;
}

/*
 * Файлы игрока: живые `minimap.ytd` и `minimap.gfx` из update.rpf и те же из сборки человека до Astral. Отсутствие файла —
 * состояние, а не сбой (у сборок с чужими модами состав бывает другим). Рабочую папку убирает вызывающий.
 */
async function readBases(input, stateDir, tools) {
  const { extract, preAstral } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const directory = path.join(path.resolve(stateDir || os.tmpdir()), "blip-icon-bases", randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const outputs = (result) => new Map((result?.extracted || []).map((item) => [normalizeEntry(item.entry), item.output]));
  const entries = [GPS_ICON_ENTRY, GROUP_MARKER_OVERLAY_ENTRY];
  try {
    let liveFailure = "";
    const live = outputs(
      await extract({
        archivePath: path.join(gameRoot, "update", "update.rpf"),
        archiveTarget: "update/update.rpf",
        entries,
        outputDirectory: path.join(directory, "live"),
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
    const pick = (map, entry) => map.get(normalizeEntry(entry)) || null;
    return {
      gameRoot,
      directory,
      liveFailure,
      live: { ytd: pick(live, GPS_ICON_ENTRY), gfx: pick(live, GROUP_MARKER_OVERLAY_ENTRY) },
      before: { ytd: pick(before, GPS_ICON_ENTRY), gfx: pick(before, GROUP_MARKER_OVERLAY_ENTRY) },
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

const release = (bases) => (bases?.directory ? fs.rm(bases.directory, { recursive: true, force: true }).catch(() => {}) : null);

/*
 * Мир значков игрока: таблица клеток (из gfx до Astral, а его нет — из живого), живые листы и штатные (до Astral; а
 * сборки до Astral нет — живые: тогда живая и есть единственная основа).
 */
async function loadWorld(bases) {
  const liveSheets = bases.live.ytd ? readSheets(await fs.readFile(bases.live.ytd)) : null;
  if (!liveSheets?.size) throw new Error(`В update.rpf нет листов значков (${GPS_ICON_ENTRY}) — значкам карты встать некуда.`);
  const beforeSheets = bases.before.ytd ? readSheets(await fs.readFile(bases.before.ytd)) : null;
  const stockSheets = beforeSheets?.size ? beforeSheets : liveSheets;
  const gfxFile = bases.before.gfx || bases.live.gfx;
  if (!gfxFile) throw new Error("В update.rpf нет minimap.gfx — не узнать, какому значку какая клетка листа.");
  const table = readBlipTable(await fs.readFile(gfxFile));
  return { liveSheets, stockSheets, hasBefore: Boolean(beforeSheets?.size), table };
}

/* Клетка значка: листы игрока и её точки; `null` — у значка нет одной клетки в листе. */
function cellInfo(world, sprite) {
  const entry = world.table.sprites.get(sprite);
  if (!entry || entry.kind !== "bitmap" || entry.cells.length !== 1) return null;
  const cell = entry.cells[0];
  const sheet = world.liveSheets.get(cell.sheet);
  const stock = world.stockSheets.get(cell.sheet);
  if (!sheet || !stock || !isBlockFormat(sheet) || !isBlockFormat(stock)) return null;
  const rect = realRect(cell, sheet);
  return { entry, cell, sheet, stock, rect, aligned: blockAligned(rect) };
}

/** Почему значок нельзя править — слово для окна (`null` — можно). */
export function unsupportedReason(world, sprite) {
  const entry = world.table.sprites.get(sprite);
  if (!entry) return "unknown";
  if (entry.kind === "missing" || entry.kind === "empty") return "no-symbol";
  if (entry.kind === "placeholder") return "placeholder";
  if (entry.kind === "vector") return "vector";
  if (entry.kind !== "bitmap") return "no-picture";
  if (entry.cells.length > 1) return "composite";
  const info = cellInfo(world, sprite);
  if (!info) return "no-sheet";
  const gps = world.table.sprites.get(GPS_SPRITE)?.cells[0]?.key;
  if (sprite === GPS_SPRITE || (gps && info.cell.key === gps)) return "gps-owned";
  /* Клетка с границей посреди блока правится граничными блоками (`blip-icon-sheets.js`); негодная — нет. */
  if (!(info.rect.x1 > info.rect.x0 && info.rect.y1 > info.rect.y0 && info.rect.x0 >= 0 && info.rect.y0 >= 0 && info.rect.x1 <= info.sheet.width && info.rect.y1 <= info.sheet.height)) return "no-sheet";
  return null;
}

/* Клетка значка штатной картинкой 64×64 (экранная пропорция клетки — по центру) или `null`. */
function stockImage(world, sprite) {
  const entry = world.table.sprites.get(sprite);
  const cell = entry?.kind === "bitmap" && entry.cells.length === 1 ? entry.cells[0] : null;
  const sheet = cell ? world.stockSheets.get(cell.sheet) : null;
  if (!cell || !sheet || !isBlockFormat(sheet)) return null;
  return cellPicture(sheet, realRect(cell, sheet), cell.w / cell.h, CELL_SIDE);
}

const sameRgba = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

/* ------------------------------------------------------------ состояние */

/**
 * Что у игрока стоит сейчас: таблица значков (номер, символ, лист, можно ли править и почему нет, с кем делит клетку),
 * атлас штатных клеток одной картинкой — настоящие значки из его файлов — и номера значков, чья клетка в игре уже не
 * штатная (правка Astral или чужого мода).
 */
export async function readBlipIconsState(input, context, stateDir, tools = {}) {
  const bases = await readBases(input, stateDir, tools);
  try {
    let world;
    try {
      world = await loadWorld(bases);
    } catch (error) {
      return { available: false, reason: String(error?.message || error).slice(0, 300), sprites: [], atlas: null, edited: [] };
    }
    const sprites = [];
    const edited = [];
    const atlasItems = [];
    for (const entry of world.table.sprites.values()) {
      const reason = unsupportedReason(world, entry.sprite);
      const cell = entry.cells.length === 1 ? entry.cells[0] : null;
      const sharedWith = cell ? (world.table.byCell.get(cell.key) || []).filter((other) => other !== entry.sprite) : [];
      /* Составной значок (две и больше картинок) идёт за тем одиночным, с кем делит клетку. */
      let follows = null;
      if (entry.cells.length > 1)
        for (const part of entry.cells) {
          const owner = (world.table.byCell.get(part.key) || []).find((other) => world.table.sprites.get(other)?.cells.length === 1);
          if (owner !== undefined) {
            follows = owner;
            break;
          }
        }
      sprites.push({
        sprite: entry.sprite,
        symbol: entry.symbol,
        kind: entry.kind,
        sheet: cell?.sheet || null,
        editable: reason === null,
        ...(reason ? { reason } : {}),
        ...(sharedWith.length ? { sharedWith } : {}),
        ...(follows !== null ? { follows } : {}),
      });
      if (!cell || entry.kind !== "bitmap") continue;
      const info = cellInfo(world, entry.sprite);
      if (!info) continue;
      const aspect = cell.w / cell.h;
      const live = cellPicture(info.sheet, info.rect, aspect, CELL_SIDE);
      const stock = cellPicture(info.stock, realRect(cell, info.stock), aspect, CELL_SIDE);
      atlasItems.push({ sprite: entry.sprite, rgba: stock });
      if (!sameRgba(live, stock)) edited.push(entry.sprite);
    }
    return {
      available: true,
      reason: "",
      hasBefore: world.hasBefore,
      sprites,
      edited,
      atlas: await buildAtlas(atlasItems),
    };
  } finally {
    await release(bases);
  }
}

/* Штатные клетки одной картинкой PNG: `columns` в ряд, клетка 64×64, порядок — `items`. */
async function buildAtlas(items) {
  if (!items.length) return null;
  const rows = Math.ceil(items.length / ATLAS_COLUMNS);
  const width = ATLAS_COLUMNS * CELL_SIDE;
  const height = rows * CELL_SIDE;
  const rgba = Buffer.alloc(width * height * 4);
  items.forEach((item, index) => {
    const ox = (index % ATLAS_COLUMNS) * CELL_SIDE;
    const oy = Math.floor(index / ATLAS_COLUMNS) * CELL_SIDE;
    for (let y = 0; y < CELL_SIDE; y += 1)
      Buffer.from(item.rgba.buffer, item.rgba.byteOffset + y * CELL_SIDE * 4, CELL_SIDE * 4).copy(rgba, ((oy + y) * width + ox) * 4);
  });
  const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { png: png.toString("base64"), cell: CELL_SIDE, columns: ATLAS_COLUMNS, items: items.map((item) => item.sprite) };
}

/* ------------------------------------------------------------ правки клеток */

/* Правки работы → действия над клетками: по одной на клетку; общая клетка слушается меньшего номера. */
function resolveActions(world, work, previous) {
  const notes = [];
  const groups = new Map();
  const group = (info) => {
    if (!groups.has(info.cell.key)) groups.set(info.cell.key, { info, edits: [], restore: false });
    return groups.get(info.cell.key);
  };
  for (const [key, edit] of Object.entries(work.icons)) {
    const sprite = Number(key);
    const reason = unsupportedReason(world, sprite);
    if (reason) {
      notes.push({ sprite, reason });
      continue;
    }
    group(cellInfo(world, sprite)).edits.push({ sprite, edit });
  }
  for (const key of Object.keys(previous.icons)) {
    const sprite = Number(key);
    if (work.icons[key] || unsupportedReason(world, sprite)) continue;
    group(cellInfo(world, sprite)).restore = true;
  }
  const actions = [];
  for (const { info, edits, restore } of groups.values()) {
    if (edits.length) {
      edits.sort((a, b) => a.sprite - b.sprite);
      const [winner, ...rest] = edits;
      if (rest.some((other) => JSON.stringify(other.edit) !== JSON.stringify(winner.edit)))
        notes.push({ sprite: winner.sprite, reason: "shared-conflict", with: rest.map((other) => other.sprite) });
      actions.push({ info, sprite: winner.sprite, edit: winner.edit });
    } else if (restore) actions.push({ info, sprite: null, edit: null });
  }
  return { actions, notes };
}

/* Своя картинка → квадрат 64×64: целиком по центру, прозрачность сохраняется, цвет под прозрачным — от соседних точек. */
async function pictureSquare(bytes) {
  const { data } = await sharp(bytes, { failOn: "error", limitInputPixels: 4096 * 4096 })
    .ensureAlpha()
    .resize(CELL_SIDE, CELL_SIDE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return bleedTransparent(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), CELL_SIDE, CELL_SIDE);
}

/* Новые листы: живые, в которых переписаны клетки действий. `changed` — листы, чьи байты отличаются от живых. */
async function buildSheets(world, actions, pictures) {
  const working = new Map([...world.liveSheets].map(([name, sheet]) => [name, { ...sheet }]));
  const touched = [];
  for (const action of actions) {
    const { info } = action;
    const sheet = working.get(info.cell.sheet);
    const width = info.rect.x1 - info.rect.x0;
    const height = info.rect.y1 - info.rect.y0;
    const aspect = info.cell.w / info.cell.h;
    let levels;
    if (!action.edit) {
      if (sameCellAny(sheet, info.stock, info.rect)) continue;
      levels = restoreCellAny(sheet, info.stock, info.rect);
    } else {
      let rgba;
      if (action.edit.mode === "hidden") rgba = new Uint8ClampedArray(width * height * 4);
      else if (action.edit.mode === "set") {
        const image = stockImage(world, action.edit.from);
        if (!image) throw new Error(`У значка ${action.edit.from} нет картинки в листе — поставить его вместо ${action.sprite} нельзя.`);
        rgba = placeInCell(image, CELL_SIDE, aspect, width, height);
      } else {
        const bytes = pictures.get(action.edit.assetId);
        if (!bytes) throw new Error(`Своя картинка значка ${action.sprite} не приехала из окна.`);
        rgba = placeInCell(await pictureSquare(bytes), CELL_SIDE, aspect, width, height);
      }
      levels = replaceCellAny(sheet, info.rect, rgba);
    }
    sheet.levels = levels;
    touched.push(action.sprite ?? world.table.byCell.get(info.cell.key)?.[0] ?? null);
  }
  const changed = [];
  for (const [name, sheet] of working) {
    const live = world.liveSheets.get(name);
    if (sheet.levels.some((level, index) => !level.equals(live.levels[index]))) changed.push(sheet);
  }
  return { changed, touched: touched.filter((sprite) => sprite !== null) };
}

const fileEntry = ({ file, target, bytes }) => ({ file, target, bytes, size: bytes.length, sha256: sha256(bytes) });

/*
 * Собранный `minimap.ytd`: живой словарь, в котором заменены листы значков. Тот же помощник, что у значка метки GPS:
 * размер, формат и число mip листа обязаны совпасть.
 */
async function buildYtd({ bases, changed, directory, tools }) {
  const { patchYtd } = { ...defaultTools(), ...tools };
  const patches = [];
  for (const sheet of changed) {
    const dds = Buffer.concat([
      Buffer.from(writeDdsHeader({ width: sheet.width, height: sheet.height, mipLevels: sheet.levels.length, format: sheet.format })),
      ...sheet.levels,
    ]);
    const source = path.join(directory, `${sheet.name.toLowerCase()}.dds`);
    await fs.writeFile(source, dds);
    patches.push({ texture: sheet.name, source, sha256: sha256(dds) });
  }
  const output = path.join(directory, "minimap.ytd");
  await patchYtd({ input: bases.live.ytd, output, patches, gameRoot: bases.gameRoot, edition: "Legacy" });
  return fs.readFile(output);
}

/* ------------------------------------------------------------ сборка */

function describeWork(work) {
  const count = describeBlipIcons(work);
  const parts = [];
  if (count.set) parts.push(`заменено ${count.set}`);
  if (count.picture) parts.push(`своих картинок ${count.picture}`);
  if (count.hidden) parts.push(`скрыто ${count.hidden}`);
  return parts.length ? parts.join(", ") : "значки как в игре";
}

/**
 * Файлы работы поверх игры игрока — без папки патча: `{ files, summary, notes, touched }`; пустой список файлов — значки
 * у игры уже такие (не отказ). Читает её и сам установщик, и проверки.
 */
export async function blipIconsPatchFiles(input, context, stateDir, tools = {}) {
  const work = boundedWork(input.work);
  const previous = input.previous ? boundedWork(input.previous, "Прежняя работа значков") : normalizeBlipIcons({});
  const pictures = normalizePictures(input.pictures, work);
  const bases = await readBases(input, stateDir, tools);
  try {
    const world = await loadWorld(bases);
    const { actions, notes } = resolveActions(world, work, previous);
    const built = await buildSheets(world, actions, pictures);
    const files = [];
    if (built.changed.length) {
      const bytes = await buildYtd({ bases, changed: built.changed, directory: bases.directory, tools });
      files.push(fileEntry({ file: "minimap.ytd", target: GPS_ICON_TARGET, bytes }));
    }
    return {
      gameRoot: bases.gameRoot,
      work,
      previous,
      pictures,
      files,
      notes,
      touched: built.touched,
      hasBefore: world.hasBefore,
      summary: describeWork(work),
    };
  } finally {
    await release(bases);
  }
}

async function materialize(input, context, stateDir, tools) {
  const generated = await blipIconsPatchFiles(input, context, stateDir, tools);
  const { files, work, previous, pictures, summary } = generated;
  if (!files.length) return { ...generated, patch: null };
  const patchDirectory = path.join(path.resolve(stateDir || os.tmpdir()), PATCH_FAMILY, randomUUID());
  const payloadDirectory = path.join(patchDirectory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  for (const file of files) await fs.writeFile(path.join(payloadDirectory, file.file), file.bytes, { flag: "wx" });
  const manifest = killEffectPatchManifest({ name: `Astral blip icons — ${summary}`, files });
  await fs.writeFile(path.join(patchDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  /* Записка пересборки: работа, прежняя работа и свои картинки, из которых патч собран. */
  const recomposePictures = {};
  if (pictures.size) {
    await fs.mkdir(path.join(patchDirectory, "recompose"), { recursive: true });
    let index = 0;
    for (const [asset, bytes] of pictures) {
      const name = `picture-${index}.png`;
      index += 1;
      await fs.writeFile(path.join(patchDirectory, "recompose", name), bytes, { flag: "wx" });
      recomposePictures[asset] = `recompose/${name}`;
    }
  }
  await writeRecomposeSidecar(patchDirectory, { kind: "blip-icons", work, previous, pictures: recomposePictures });
  return {
    ...generated,
    patch: patchDirectory,
    files: files.map((file) => ({ file: file.file, target: file.target, size: file.size, sha256: file.sha256 })),
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
}

/* Что уходит окну: без байтов своих картинок и без прежней работы (они нужны только сборке). */
const publicView = ({ pictures: _pictures, previous: _previous, ...rest }) => rest;

export async function planBlipIcons(input, context, stateDir, tools = {}) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  if (!generated.patch) return { ...publicView(generated), unchanged: true, edition: "Legacy", archive: "update/update.rpf" };
  try {
    const validation = await native("validate-rpf-patch", { patch: generated.patch }, context);
    return { ...publicView(generated), validation, edition: "Legacy", archive: "update/update.rpf" };
  } finally {
    await fs.rm(generated.patch, { recursive: true, force: true }).catch(() => {});
  }
}

export async function applyBlipIcons(input, context, stateDir, { assertRuntimeSafety, ...tools } = {}) {
  const { native, archiveSupport } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  /* Значки у игры уже такие — патч не нужен: «Применить» ничего не пишет. */
  if (!generated.patch) return { ...publicView(generated), unchanged: true, edition: "Legacy" };
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
  return { ...installed, ...publicView(generated), edition: "Legacy" };
}

/** Работа без единой правки ставить нечего, пока в игре не стоит прежняя: окно спрашивает заранее. */
export const blipIconsNeedsInstall = (work, previous = null) => !blipIconsWorkIsStock(work) || !blipIconsWorkIsStock(previous || {});

/*
 * Пересборка перед возвратом в игру (`patch-recompose.js`): та же работа и те же картинки поверх архива, каким он стал
 * после перемотки.
 */
registerPatchRecomposer("blip-icons", async ({ sidecar, directory, gameRoot, stateDir, context, tools = {} }) => {
  const pictures = {};
  for (const [asset, relative] of Object.entries(sidecar.pictures || {})) {
    const file = path.resolve(directory, String(relative));
    if (!file.startsWith(path.resolve(directory) + path.sep)) throw new Error("Картинка значка в записке пересборки лежит вне патча.");
    pictures[asset] = (await fs.readFile(file)).toString("base64");
  }
  const generated = await materialize({ gameRoot, work: sidecar.work, previous: sidecar.previous || null, pictures }, context, stateDir, tools);
  return { patch: generated.patch };
});
