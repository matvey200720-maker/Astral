/*
 * «Дым из-под колёс» (задача 1 ТЗ 11.10.2026, вечер): дым игры из-под
 * колёс и установка его вида.
 *
 * Окно присылает работу редактора (`@modovik/ptfx-studio/wheel-smoke.js`),
 * а этот модуль достаёт из update.rpf игрока настоящие файлы и собирает
 * нативный патч — только файлы update.rpf, пакета моделей у дыма нет:
 *
 *  • таблица колёс `common/data/effects/wheelfx.dat` — в столбцах эффектов
 *    целей вместо штатных правил имена клонов (или «-» у вида «Без дыма»);
 *  • клоны `astral_wheel_*` в трёх ядрах частиц (`core.ypt` в ptfx.rpf,
 *    ptfx_hi.rpf и ptfx_lo.rpf) — двоичные копии штатных правил игрока со
 *    своим цветом и ползунками; штатных правил помощник не трогает;
 *  • листы значков (звезда, сердце) — их рисует приложение
 *    (`wheelGlyphSheet`), текстур Rockstar в поставке нет — и их сетка в
 *    `ptxclipregions.dat`.
 *
 * Патч встаёт своей точкой отката в той же стопке, что небо, эффекты и
 * фонари, с запиской пересборки (`patch-recompose.js`): библиотека, вынимая
 * работу под этой, собирает её заново поверх перемотанного архива.
 *
 * ЧИСТАЯ ОСНОВА ТАБЛИЦЫ
 *
 * Клоны в ядре и строки сетки снимаются по своей приставке и ставятся
 * заново — такая правка сама себя не копит. С таблицей колёс так нельзя:
 * «Без дыма» пишет в ячейки «-», и по «-» уже не узнать, какое правило там
 * стояло (оптимизация «без дыма» пишет туда то же самое). Поэтому таблица
 * собирается от чистой основы — по памяти «что мы записали → из чего», как
 * огни вдали у фонарей: каждая наша запись помнит хеш своей основы, основа
 * лежит копией под своим хешем. Живой файл, который мы узнаём,
 * разворачивается к основе; любой другой — сам новая основа (его положил мод,
 * слой оптимизации или проверка файлов в Steam).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { decodeBlocks, encodeDds, levelBytes, resample } from "@modovik/dds";
import {
  VEHICLE_VFX_ENTRY,
  WHEEL_FX_ENTRY,
  WHEEL_SMOKE_DONORS,
  WHEEL_SMOKE_PREFIX,
  WHEEL_SMOKE_SLIPSTREAM,
  compileWheelSmoke,
  describeWheelSmoke,
  normalizeWheelSmokeProject,
  patchWheelFx,
  wheelFxHasClones,
  wheelGlyphSheet,
} from "@modovik/ptfx-studio/wheel-smoke.js";
import { openResource, readYptTextures } from "@modovik/ypt";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import { assertRpfHelperFeatures, exportYptRules, patchYptTextures, resolveRpfHelperExecutable } from "./rpf-composer.js";
import { createPtfxBaseCache, sourceStampOf } from "./ptfx-base-cache.js";
import { readClipGrids, upsertClipRegions } from "./ptfx-clip-regions.js";
import { registerPatchRecomposer, writeRecomposeSidecar } from "./patch-recompose.js";
import { retargetVehicleVfx } from "./vehicle-vfx.js";

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  patchCore: patchYptTextures,
  exportRules: exportYptRules,
  assertFeatures: assertRpfHelperFeatures,
});

/* Семейство патча: по папке библиотека называет работу (`installed-manager.js`). */
export const WHEEL_SMOKE_PATCH_FAMILY = "wheel-smoke-patches";
const WORK_FAMILY = "wheel-smoke-work";
const BASE_FAMILY = "wheel-smoke-bases";
const RECOMPOSE_KIND = "wheel-smoke";
const MAX_PROJECT_BYTES = 16 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const BASE_STORE_VERSION = 1;
/* Сколько наших записей таблицы помнить: столько версий дыма может
   вернуться в игру перемоткой из библиотеки. */
const PRODUCED_LIMIT = 6;
const PREVIEW_SHEET_EDGE = 512;

const UPDATE_ARCHIVE = path.join("update", "update.rpf");
/* Файлы данных: в update.rpf, иначе в common.rpf (старые сборки игры). */
const DATA_FILES = Object.freeze({
  wheelfx: { update: WHEEL_FX_ENTRY, common: "data/effects/wheelfx.dat" },
  clip: {
    update: "common/data/effects/ptxclipregions.dat",
    common: "data/effects/ptxclipregions.dat",
  },
});
const CORE_ARCHIVES = Object.freeze(["ptfx.rpf", "ptfx_hi.rpf", "ptfx_lo.rpf"]);
const coreEntry = (archive) => `x64/patch/data/effects/${archive}/core.ypt`;
const PREFIX_BYTES = Buffer.from(WHEEL_SMOKE_PREFIX, "latin1");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const gameKey = (gameRoot) => sha256(path.resolve(gameRoot).toLowerCase()).slice(0, 16);
const flatName = (entry) => entry.replace(/[^a-z0-9.]+/gi, "_");

/*
 * Есть ли в ядре клоны или листы дыма. Ядро лежит в архиве сжатым ресурсом
 * RSC7, и имена видны только в распакованных данных (у фонарей поиск по
 * сырым байтам не находил клона, и выключенные бабочки оставались в игре).
 * Ядро, которое не читается, отдаётся помощнику — он разберёт его сам или
 * объяснит отказ.
 */
function coreCarriesWheelSmoke(bytes) {
  try {
    return Buffer.from(openResource(bytes).data).includes(PREFIX_BYTES);
  } catch {
    return true;
  }
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Работа настройки автомобиля обязательна.");
  const text = JSON.stringify(input);
  if (Buffer.byteLength(text, "utf8") > MAX_PROJECT_BYTES)
    throw new RangeError("Работа настройки автомобиля больше 16 КБ.");
  return normalizeWheelSmokeProject(JSON.parse(text));
}

const archiveKeys = (input, stateDir, tools) =>
  archiveKeysDirectory({ keys: input?.keys, stateDir, provision: tools.archiveSupport });

/* ---------- чтение из игры ---------- */

/*
 * Воздушный пакет в базе окна — всегда штатный. Если клон Astral уже стоит под
 * штатным именем, штатное правило лежит под скрытым: оно и есть донор, а
 * правило под штатным именем — наш клон, которого в базе быть не должно
 * (поверх него клон собрался бы второй раз). Выписка помощника — по имени
 * правила; эмиттер и частица штатного правила от клона не зависят: у клона свои.
 */
export function stockSlipstream(model) {
  const hidden = model.effects?.[WHEEL_SMOKE_SLIPSTREAM.hidden];
  if (hidden) {
    model.effects[WHEEL_SMOKE_SLIPSTREAM.stock] = { ...hidden, Name: WHEEL_SMOKE_SLIPSTREAM.stock };
    delete model.effects[WHEEL_SMOKE_SLIPSTREAM.hidden];
  }
  for (const section of ["effects", "emitters", "particles"])
    for (const name of Object.keys(model[section] || {}))
      if (name.toLowerCase().startsWith(WHEEL_SMOKE_PREFIX) && name !== WHEEL_SMOKE_SLIPSTREAM.hidden) delete model[section][name];
}

/** Записи архива игры во временную папку: `entry (строчными) → файл`. */
async function extractEntries({ native, gameRoot, keys, context }, archive, entries, directory) {
  const found = new Map();
  if (!entries.length) return found;
  const input = path.join(gameRoot, archive);
  const exists = await fs.stat(input).then(
    (stat) => stat.isFile(),
    () => false,
  );
  if (!exists) return found;
  await fs.mkdir(directory, { recursive: true });
  const result = await native(
    "extract-archive-entries",
    { input, outputDirectory: directory, entries, gameRoot, keys },
    context,
  );
  for (const file of result?.files || [])
    found.set(String(file.entry).replace(/\\/g, "/").toLowerCase(), path.join(directory, file.file));
  return found;
}

async function readText(file, entry) {
  if ((await fs.stat(file)).size > MAX_TEXT_BYTES)
    throw new RangeError(`${entry} в архиве игры неправдоподобно велик.`);
  return fs.readFile(file, "latin1");
}

/*
 * Всё, что нужно сборке, одним запуском хоста: таблица колёс, сетка листов
 * и ядра (`cores` — какие из трёх). Таблицы, которой нет в update.rpf, —
 * из common.rpf: `{ text, inUpdate }`.
 */
async function readGameFiles(io, directory, cores = CORE_ARCHIVES) {
  const entries = [DATA_FILES.wheelfx.update, DATA_FILES.clip.update, VEHICLE_VFX_ENTRY, ...cores.map(coreEntry)];
  const update = await extractEntries(io, UPDATE_ARCHIVE, entries, path.join(directory, "update"));
  const data = {};
  const fallback = [];
  for (const [key, spec] of Object.entries(DATA_FILES)) {
    const file = update.get(spec.update.toLowerCase());
    if (file) data[key] = { text: await readText(file, spec.update), inUpdate: true };
    else fallback.push([key, spec]);
  }
  if (fallback.length) {
    const common = await extractEntries(
      io,
      "common.rpf",
      fallback.map(([, spec]) => spec.common),
      path.join(directory, "common"),
    );
    for (const [key, spec] of fallback) {
      const file = common.get(spec.common.toLowerCase());
      data[key] = file ? { text: await readText(file, spec.common), inUpdate: false } : null;
    }
  }
  /* Классы машин: только в update.rpf (в common.rpf и x64a.rpf лежат прежние версии). */
  const vehicleFile = update.get(VEHICLE_VFX_ENTRY.toLowerCase());
  const vehicle = vehicleFile ? { bytes: await fs.readFile(vehicleFile) } : null;
  const liveCores = [];
  for (const archive of cores) {
    const file = update.get(coreEntry(archive).toLowerCase());
    if (file) liveCores.push({ archive, file, bytes: await fs.readFile(file) });
  }
  return { wheelfx: data.wheelfx, clip: data.clip, vehicle, cores: liveCores };
}

/* ---------- база для окна ---------- */

/* Верхний уровень текстуры ядра в RGBA — тот же разбор, что у фонарей. */
function textureRgba(texture) {
  const bytes = levelBytes(texture.format, texture.width, texture.height);
  const top = texture.payload.subarray(0, bytes);
  if (texture.format === "A8R8G8B8") {
    const rgba = new Uint8ClampedArray(top.length);
    for (let index = 0; index < top.length; index += 4) {
      rgba[index] = top[index + 2];
      rgba[index + 1] = top[index + 1];
      rgba[index + 2] = top[index];
      rgba[index + 3] = top[index + 3];
    }
    return rgba;
  }
  return decodeBlocks(texture.format, top, texture.width, texture.height);
}

async function sheetPng(texture, grid) {
  const rgba = textureRgba(texture);
  const scale = Math.min(1, PREVIEW_SHEET_EDGE / Math.max(texture.width, texture.height));
  const width = Math.max(1, Math.round(texture.width * scale));
  const height = Math.max(1, Math.round(texture.height * scale));
  const small = scale === 1 ? rgba : resample(rgba, texture.width, texture.height, width, height);
  const png = await sharp(Buffer.from(small.buffer, small.byteOffset, small.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
  return {
    width,
    height,
    columns: grid.columns,
    rows: grid.rows,
    png: `data:image/png;base64,${png.toString("base64")}`,
  };
}

/*
 * Таблица колёс игрока словами для окна: сколько строк материалов, сколько
 * ячеек целей с дымом игры или нашим, наша ли это запись. `smokeless` —
 * дыма в таблице нет вовсе, и он не наш «Без дыма»: стоит оптимизация «без
 * дыма из-под колёс» или чужой мод, и «Применить» откажет.
 */
function describeTable(text, ours) {
  try {
    const { rows, matched } = patchWheelFx(text, compileWheelSmoke({}).columns);
    const own = ours || wheelFxHasClones(text);
    return { rows, matched, ours: own, smokeless: matched === 0 && !own };
  } catch {
    return null;
  }
}

/**
 * Дым игрока для окна: правила-доноры из ядра `ptfx.rpf/core.ypt` (выписка
 * помощника — тот же разбор, что у фонарей и эффектов попадания) и их листы
 * с сеткой кадров из `ptxclipregions.dat`. Кадр проигрывает тот же клон, что
 * уедет в игру. `table` — что сейчас в таблице колёс игрока.
 */
export async function readWheelSmokeBase(input, context, stateDir, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const keys = await archiveKeys(input, stateDir, t);
  const io = { native: t.native, gameRoot, keys, context };
  const directory = path.join(os.tmpdir(), `astral-wheel-smoke-${randomUUID()}`);
  try {
    const files = await readGameFiles(io, directory, [CORE_ARCHIVES[0]]);
    const core = files.cores[0];
    if (!core) throw new Error("В update.rpf нет ядра частиц core.ypt.");
    /* Скрытое имя штатного воздушного пакета — в том же запросе: пока наш клон
       стоит под штатным именем, штатное правило лежит под ним. */
    const exported = await t.exportRules({
      gameRoot,
      input: core.file,
      rules: [...WHEEL_SMOKE_DONORS, WHEEL_SMOKE_SLIPSTREAM.hidden],
    });
    const model = exported?.export;
    if (!model) throw new Error("Помощник RPF не выписал правила дыма и огня выхлопа.");
    stockSlipstream(model);
    /* Окну нужны только сетки листов: заголовок таблицы редукса бывает с неверными счётчиками (тестер beta.109: «1212 кадров, в таблице 277»), игра её принимает — строго читает только запись. */
    const grids = files.clip ? readClipGrids(files.clip.text) : new Map();
    const wanted = new Set((model.textures || []).map((name) => String(name).toLowerCase()));
    const sheets = {};
    for (const texture of readYptTextures(core.bytes)) {
      const key = texture.name.toLowerCase();
      if (!wanted.has(key) || !texture.decodable || !texture.payload) continue;
      sheets[texture.name] = await sheetPng(texture, grids.get(key) || { columns: 1, rows: 1 });
    }
    let table = null;
    if (files.wheelfx) {
      const store = await openBaseStore(stateDir, gameRoot);
      const liveSha = sha256(Buffer.from(files.wheelfx.text, "latin1"));
      const ours = (store.meta.files[WHEEL_FX_ENTRY]?.produced || []).some(([written]) => written === liveSha);
      table = describeTable(files.wheelfx.text, ours);
    }
    return { model, sheets, table };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/* Что читает базу дыма: поменялся код — база читается заново. */
const READER_MODULES = Object.freeze(["./wheel-smoke.js", "./ptfx-clip-regions.js", "./ptfx-base-cache.js"]);
const READER_PACKAGES = Object.freeze(["@modovik/ptfx-studio/wheel-smoke.js", "@modovik/ypt", "@modovik/dds"]);

/**
 * База дыма читается из игры один раз на её состояние — тем же кэшем, что
 * база эффектов и фонарей (`ptfx-base-cache.js`), в своей папке. Один на
 * главный процесс и на запекание песочницы (`scripts/bake-wheel-smoke-base.mjs`):
 * отпечаток у них обязан совпадать.
 */
export function createWheelSmokeBaseCache(options = {}) {
  return createPtfxBaseCache({
    helperExecutable: () => resolveRpfHelperExecutable(),
    sourceStamp: () => sourceStampOf(READER_MODULES, READER_PACKAGES),
    folder: "wheel-smoke-base",
    ...options,
  });
}

/* ---------- память чистой основы таблицы ---------- */

async function openBaseStore(stateDir, gameRoot) {
  const directory = path.join(stateDir || os.tmpdir(), BASE_FAMILY, gameKey(gameRoot));
  let meta = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(directory, "base.json"), "utf8"));
  } catch {
    meta = null;
  }
  if (meta?.version !== BASE_STORE_VERSION || !meta.files || typeof meta.files !== "object")
    meta = { version: BASE_STORE_VERSION, files: {} };
  return { directory, meta };
}

const blobPath = (store, hash) => path.join(store.directory, "blobs", `${hash}.bin`);

async function readBlob(store, hash) {
  const bytes = await fs.readFile(blobPath(store, hash)).catch(() => null);
  return bytes && sha256(bytes) === hash ? bytes : null;
}

async function writeBlob(store, hash, bytes) {
  await fs.mkdir(path.dirname(blobPath(store, hash)), { recursive: true });
  await fs.writeFile(blobPath(store, hash), bytes, { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
}

/**
 * Основа файла: `{ bytes, sha256, ours }`. `ours` — в игре лежит наша запись,
 * и основа — то, из чего она собрана. Копия основы пропала — честнее взять
 * живой файл, чем гадать: имена клонов `patchWheelFx` вернёт к штатным сам,
 * а «-» прежнего «Без дыма» так и останется — об этом скажет отказ.
 */
async function fileBase(store, entry, live) {
  const liveSha = sha256(live);
  const record = store.meta.files[entry] || { base: null, produced: [] };
  store.meta.files[entry] = record;
  const hit = (record.produced || []).find(([written]) => written === liveSha);
  if (hit) {
    const bytes = await readBlob(store, hit[1]);
    if (bytes) return { bytes, sha256: hit[1], ours: true };
  }
  await writeBlob(store, liveSha, live);
  record.base = liveSha;
  return { bytes: live, sha256: liveSha, ours: false };
}

function remember(list, written, base) {
  return [...(list || []).filter(([item]) => item !== written), [written, base]].slice(-PRODUCED_LIMIT);
}

/** Запомнить поставленное: что записано и из какой основы. */
async function commitBaseStore(store, pending) {
  for (const { entry, written, base } of pending) {
    const record = store.meta.files[entry] || { base, produced: [] };
    record.produced = remember(record.produced, written, base);
    store.meta.files[entry] = record;
  }
  /* Копии, на которые больше ничто не ссылается, уходят: основа держится,
     пока по ней есть наша запись или пока она последняя виденная. */
  const keep = new Set();
  for (const record of Object.values(store.meta.files)) {
    if (record.base) keep.add(record.base);
    for (const [, base] of record.produced || []) keep.add(base);
  }
  const blobs = path.join(store.directory, "blobs");
  for (const name of await fs.readdir(blobs).catch(() => [])) {
    const hash = name.replace(/\.bin$/, "");
    if (!keep.has(hash)) await fs.rm(path.join(blobs, name), { force: true }).catch(() => {});
  }
  await fs.mkdir(store.directory, { recursive: true });
  const target = path.join(store.directory, "base.json");
  const staged = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(staged, `${JSON.stringify({ ...store.meta, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  await fs.rename(staged, target);
}

/* ---------- сборка ---------- */

/*
 * Листы значков работы — DDS для ядра. Рисует их приложение
 * (`wheelGlyphSheet`), тем же кодом, что кадр окна. Уровни mip — до четырёх
 * точек по меньшей стороне: у DXT меньше блока нет (у фонарей лист с уровнем
 * 4×1 не переживал сверку помощника).
 */
export async function glyphTextures(textures, directory) {
  if (!textures?.length) return [];
  await fs.mkdir(directory, { recursive: true });
  const patches = [];
  for (const item of textures) {
    const sheet = wheelGlyphSheet(item.glyph);
    const mipLevels = Math.max(1, Math.floor(Math.log2(Math.min(sheet.width, sheet.height) / 4)) + 1);
    const dds = encodeDds({ width: sheet.width, height: sheet.height, format: "DXT5", mipLevels, rgba: sheet.rgba });
    const file = path.join(directory, `${item.texture}.dds`);
    await fs.writeFile(file, dds);
    patches.push({ texture: item.texture, source: file, sha256: sha256(dds) });
  }
  return patches;
}

function patchManifest(name, actions) {
  return {
    ReduxName: name,
    ParsedAt: new Date().toISOString(),
    TotalPatchSize: actions.reduce((total, item) => total + item.size, 0),
    Actions: actions.map((item) => ({
      Type: item.action,
      TargetPath: `update:/${item.entry}`,
      SourcePath: `payload/${item.file}`,
      Size: item.size,
      Sha256: item.sha256,
      IsWholeReplaceNestedRpf: false,
    })),
  };
}

/*
 * Таблица колёс поверх чистой основы. Отказ — когда работе есть что
 * поставить, а ставить некуда: в ячейках целей нет ни штатного правила, ни
 * нашего клона. Так выглядит таблица после оптимизации «Без дыма из-под
 * колёс» (или чужого мода с той же правкой) — дым поверх неё в игре не
 * появился бы, а «Применить» отчиталось бы успехом.
 */
async function tableAction({ store, wheelfx, compiled }) {
  if (!wheelfx) throw new Error("В игре нет таблицы колёс wheelfx.dat — дыму некуда встать.");
  const live = Buffer.from(wheelfx.text, "latin1");
  const base = await fileBase(store, WHEEL_FX_ENTRY, live);
  const next = patchWheelFx(base.bytes.toString("latin1"), compiled.columns);
  const wants = Object.values(compiled.columns).some((rule) => rule.value !== rule.stock);
  if (wants && next.matched === 0)
    throw new Error(
      "В таблице колёс игры дыма нет вовсе — так её оставляет оптимизация «Без дыма из-под колёс» " +
        "(или чужой мод с той же правкой). Снимите эту оптимизацию в библиотеке, затем ставьте свой дым.",
    );
  const table = { rows: next.rows, changed: next.changed, matched: next.matched };
  const bytes = Buffer.from(next.text, "latin1");
  if (bytes.equals(live))
    return {
      action: null,
      /* Уже стоит нашей прежней версией: патч новой версии несёт файл сам (см. `carry` в materialize). */
      carry: wants
        ? { action: wheelfx.inUpdate ? "Replace" : "Import", entry: WHEEL_FX_ENTRY, bytes, restore: false }
        : null,
      pending: [],
      table,
    };
  const hash = sha256(bytes);
  const same = hash === base.sha256;
  return {
    action: {
      action: wheelfx.inUpdate ? "Replace" : "Import",
      entry: WHEEL_FX_ENTRY,
      bytes,
      restore: same,
    },
    pending: same ? [] : [{ entry: WHEEL_FX_ENTRY, written: hash, base: base.sha256 }],
    table,
  };
}

/*
 * Классы машин: имена огня выхлопа в vfxvehicleinfo.ymt — клоны работы или
 * штатные (`retargetVehicleVfx`). Отказ — когда огню выхлопа есть что
 * ставить, а в файле нет ни штатных правил, ни наших клонов (другая сборка
 * игры или чужой мод): «Применить» не должно отчитаться успехом.
 */
function vehicleAction({ vehicle, compiled }) {
  const wants = compiled.vehicleVfx.effects.some((effect) => effect.value !== effect.stock);
  if (!vehicle) {
    if (wants) throw new Error("В update.rpf нет vfxvehicleinfo.ymt — огню выхлопа некуда встать (другая сборка игры).");
    return { action: null, report: null };
  }
  let next;
  try {
    next = retargetVehicleVfx(vehicle.bytes, compiled.vehicleVfx);
  } catch (error) {
    if (wants) throw new Error(`vfxvehicleinfo.ymt не разобран: ${String(error?.message || error)}`);
    return { action: null, report: null };
  }
  const report = { instances: next.instances, matched: next.matched, changed: next.changed };
  if (wants && next.matched === 0)
    throw new Error(
      "В vfxvehicleinfo.ymt игры нет ни штатного заднего огня, ни хлопков — так его оставляет чужой мод. Огню выхлопа некуда встать.",
    );
  if (!next.changed)
    return {
      action: null,
      carry: wants
        ? { action: "Replace", entry: VEHICLE_VFX_ENTRY, bytes: Buffer.from(next.bytes), restore: false }
        : null,
      report,
    };
  return {
    action: { action: "Replace", entry: VEHICLE_VFX_ENTRY, bytes: Buffer.from(next.bytes), restore: !wants },
    report,
  };
}

/**
 * Всё, что уедет в игру, без записи в неё: папка нативного патча (если
 * файлы update.rpf меняются) и что запомнить об основе таблицы после
 * установки.
 */
async function materialize(input, context, stateDir, tools) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const project = boundedProject(input.project);
  const compiled = compileWheelSmoke(project);
  /* Клон под штатным именем и свечение клона — только у помощника, который их
     умеет: старый принял бы заказ и поставил бы обычный клон под своим именем. */
  if (compiled.helperFeatures.length) await t.assertFeatures(compiled.helperFeatures);
  const keys = await archiveKeys(input, stateDir, t);
  const io = { native: t.native, gameRoot, keys, context };
  const work = path.join(stateDir || os.tmpdir(), WORK_FAMILY, randomUUID());
  const read = path.join(work, "read");
  const out = path.join(work, "out");
  await fs.mkdir(out, { recursive: true });
  let patch = null;
  try {
    const store = await openBaseStore(stateDir, gameRoot);
    const files = await readGameFiles(io, read);
    const actions = [];
    /*
     * Что работа уже поставила и что не изменилось (19.10.2026, задача 39).
     * Патч считается как разница с игрой, но замена прежней версии снимает её
     * перемоткой архива и возвращает новую одним её патчем: всё, чего в нём
     * нет, пропадает. Поэтому патч, который вообще что-то меняет, несёт и
     * неизменившиеся файлы работы — таблицу колёс, классы машин, сетку
     * листов и ядра.
     */
    const carry = [];

    /* 1. Таблица колёс. */
    const table = await tableAction({ store, wheelfx: files.wheelfx, compiled });
    if (table.action) actions.push(table.action);
    else if (table.carry) carry.push(table.carry);

    /* 1b. Классы машин: имена огня выхлопа. */
    const vehicle = vehicleAction({ vehicle: files.vehicle, compiled });
    if (vehicle.action) actions.push(vehicle.action);
    else if (vehicle.carry) carry.push(vehicle.carry);

    /* 2. Сетка листов значков: строки семейства снимаются и ставятся заново. */
    const { clip } = files;
    if (compiled.clipSheets.length && !clip)
      throw new Error("В игре нет ptxclipregions.dat — листу значков некуда встать.");
    if (clip && (compiled.clipSheets.length || clip.text.toLowerCase().includes(WHEEL_SMOKE_PREFIX))) {
      const next = upsertClipRegions(clip.text, compiled.clipSheets, { reset: [WHEEL_SMOKE_PREFIX] });
      const action = {
        action: clip.inUpdate ? "Replace" : "Import",
        entry: DATA_FILES.clip.update,
        bytes: Buffer.from(next.text, "latin1"),
        restore: !compiled.clipSheets.length,
      };
      if (next.changed) actions.push(action);
      else if (compiled.clipSheets.length) carry.push(action);
    }

    /* 3. Клоны в трёх ядрах. Клоны или листы Astral в ядре — повод
       пересобрать ядро и без клонов в работе: иначе прежний дым остался бы
       висеть в ядре без ссылок на него. */
    const wantsClones = compiled.clones.length > 0;
    const coreHasOurs = files.cores.some((core) => coreCarriesWheelSmoke(core.bytes));
    if (wantsClones || coreHasOurs) {
      if (!files.cores.length) throw new Error("В update.rpf нет ядра частиц core.ypt.");
      const texturePatches = wantsClones ? await glyphTextures(compiled.textures, path.join(out, "glyphs")) : [];
      await fs.mkdir(path.join(out, "core"), { recursive: true });
      for (const core of files.cores) {
        const output = path.join(out, "core", `core-${core.archive.replace(/\./g, "-")}.ypt`);
        await t.patchCore({
          gameRoot,
          input: core.file,
          output,
          patches: texturePatches,
          effectClones: compiled.clones,
          effectCloneReset: compiled.cloneReset,
        });
        const bytes = await fs.readFile(output);
        const action = { action: "Replace", entry: coreEntry(core.archive), bytes, restore: !wantsClones };
        if (!bytes.equals(core.bytes)) actions.push(action);
        else if (wantsClones) carry.push(action);
      }
    }

    /* Ничего не изменилось — патча нет («уже такая»); иначе он несёт и
       неизменившееся: после перемотки новая версия встаёт целой. */
    if (actions.length) actions.push(...carry);

    /* 4. Папка патча. */
    const summary = describeWheelSmoke(project);
    if (actions.length) {
      patch = path.join(path.resolve(stateDir || os.tmpdir()), WHEEL_SMOKE_PATCH_FAMILY, randomUUID());
      const payload = path.join(patch, "payload");
      await fs.mkdir(payload, { recursive: true });
      const described = [];
      for (const [index, item] of actions.entries()) {
        const file = `${String(index).padStart(3, "0")}_${flatName(item.entry.split("/").slice(-2).join("_"))}`;
        await fs.writeFile(path.join(payload, file), item.bytes, { flag: "wx" });
        described.push({ ...item, file, size: item.bytes.length, sha256: sha256(item.bytes) });
      }
      const title = project.name
        ? `Astral — настройка автомобиля «${project.name}»`
        : `Astral — настройка автомобиля: ${summary}`;
      await fs.writeFile(path.join(patch, "manifest.json"), `${JSON.stringify(patchManifest(title, described), null, 2)}\n`, {
        flag: "wx",
      });
      await writeRecomposeSidecar(patch, { kind: RECOMPOSE_KIND, project });
    }

    return {
      gameRoot,
      project,
      stock: compiled.stock,
      patch,
      files: actions.map(({ entry, action, bytes, restore }) => ({ entry, action, size: bytes.length, restore })),
      restoresOnly: actions.every((item) => item.restore),
      clones: compiled.clones.map((clone) => clone.effect),
      glyphs: compiled.textures.map((item) => item.texture),
      table: table.table,
      vehicle: vehicle.report,
      store,
      pending: table.pending,
      summary,
      work,
    };
  } catch (error) {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    if (patch) await fs.rm(patch, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/* Ответ окну: без байтов, памяти основы и рабочих папок. */
const answerOf = (generated) => ({
  gameRoot: generated.gameRoot,
  project: generated.project,
  summary: generated.summary,
  files: generated.files,
  clones: generated.clones,
  glyphs: generated.glyphs,
  table: generated.table,
  vehicle: generated.vehicle,
  restoresOnly: generated.restoresOnly,
});

async function dispose(generated, { keepPatch = false } = {}) {
  await fs.rm(generated.work, { recursive: true, force: true }).catch(() => {});
  if (generated.patch && !keepPatch) await fs.rm(generated.patch, { recursive: true, force: true }).catch(() => {});
}

/**
 * План: что уедет в игру, и проверка пакета хостом. Ничего не пишет в игру
 * и патча за собой не оставляет — «Применить» собирает его заново по живому
 * архиву (как «Полоска HP»).
 */
export async function planWheelSmoke(input, context, stateDir, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, t);
  try {
    const validation = generated.patch
      ? await t.native("validate-rpf-patch", { patch: generated.patch }, context)
      : null;
    return { ...answerOf(generated), native: Boolean(generated.patch), validation, edition: "Legacy" };
  } finally {
    await dispose(generated);
  }
}

/**
 * «Применить»: патч update.rpf своей точкой отката. «Как в игре» снимает
 * наши клоны и строки сетки и возвращает таблице основу; если ничего нашего
 * в игре нет — ставить нечего, и это говорится словами, а не пустой точкой
 * отката.
 */
export async function applyWheelSmoke(input, context, stateDir, { assertRuntimeSafety, ...tools } = {}) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await assertRuntimeSafety?.(gameRoot);
  const generated = await materialize(input, context, stateDir, t);
  let installed = false;
  try {
    if (!generated.patch)
      throw new Error(
        generated.stock
          ? "Это настройки игры, и своей настройки автомобиля в игре нет — ставить нечего."
          : "Настройка автомобиля в игре уже такая — ставить нечего.",
      );
    await assertRuntimeSafety?.(gameRoot);
    const support = await t.archiveSupport({ stateDir });
    const result = await t.native(
      "install-rpf-patch",
      {
        patch: generated.patch,
        gameRoot,
        archiveFix: path.join(support.directory, "ArchiveFix.exe"),
        keys: support.directory,
      },
      context,
    );
    installed = true;
    /* Память основы — после того, как патч встал: точка отката уже есть,
       и сбой записи памяти не должен выдать установку за отказ. Следующее
       «Применить» тогда возьмёт основой живую таблицу. */
    let baseMemoryError = null;
    await commitBaseStore(generated.store, generated.pending).catch((error) => {
      baseMemoryError = String(error?.message || error);
    });
    return {
      ...result,
      ...answerOf(generated),
      patch: generated.patch,
      baseMemoryError,
      platform: "Majestic / GTA5RP",
      edition: "Legacy",
    };
  } finally {
    /* Патч, который так и не встал, не нужен никому: точки отката на него
       нет. Вставший остаётся — по нему библиотека ставит работу обратно. */
    await dispose(generated, { keepPatch: installed });
  }
}

/*
 * Библиотека, вынимая работу из середины стопки, ставит дым обратно поверх
 * перемотанного архива: патч собирается заново от того, что лежит в игре
 * сейчас, — иначе он вернул бы общие файлы (ядра, сетку листов) такими,
 * какими они были при первой установке, вместе с чужими правками тех дней.
 */
registerPatchRecomposer(RECOMPOSE_KIND, async ({ sidecar, gameRoot, stateDir, context, tools }) => {
  const generated = await materialize({ gameRoot, project: sidecar.project }, context, stateDir, tools);
  try {
    if (!generated.patch) return null;
    /* Запись основы безвредна, даже если библиотека этот патч не поставит:
       это только память «такой файл собран из такой основы». */
    await commitBaseStore(generated.store, generated.pending);
    return { patch: generated.patch };
  } finally {
    await fs.rm(generated.work, { recursive: true, force: true }).catch(() => {});
  }
});
