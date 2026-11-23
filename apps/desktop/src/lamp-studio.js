/*
 * Фонари: лампы из игры игрока и установка их вида.
 *
 * Окно присылает работу редактора (`@modovik/street-light-contract/lamps`),
 * а этот модуль достаёт из игры настоящие файлы и собирает правки:
 *
 *  • модели фонарей из `x64h.rpf` — байты их ламп (помощник меняет только
 *    поля света) — и описание пропов с частицами у ламп. Эти файлы едут
 *    пакетом слоя Astral в `x64/astral/astral_lights.rpf`
 *    (`lamp-lights-package.js`): модели живут вне update.rpf, и подменить их
 *    можно только зарегистрированным контейнером;
 *  • огни вдали (`lodlights.rpf` в update.rpf и в патче DLC mp2025_02),
 *    дорожные огни (`visualsettings.dat`), строку частиц (`entityfx.dat`),
 *    клон правила частиц в трёх ядрах (`core.ypt`) и сетку его листов
 *    (`ptxclipregions.dat`). Это файлы update.rpf, общие с другими
 *    редакторами, и они ставятся нативным патчем со своей точкой отката — в
 *    той же стопке, что небо и эффекты, с запиской пересборки
 *    (`patch-recompose.js`).
 *
 * ПОРЯДОК: СНАЧАЛА ПАКЕТ, ПОТОМ ПАТЧ
 *
 * Движок, меняя пакет, перебазируется на живой архив, и всё, что лежало в
 * нём от нативных патчей, становится его основой. Поставь патч фонарей до
 * пакета — и точка отката фонарей оказалась бы под сборкой движка, откуда
 * корзина её уже не вынет. Поэтому пакет встаёт первым, а патч — поверх него:
 * точка фонарей всегда верхняя, и «Откатить» снимает обе части (перемотка к
 * сборке движка, затем движок снимает пакет). Прежнюю точку фонарей окно
 * снимает ДО смены пакета (`installLamps` в окне): иначе её огни вдали
 * запеклись бы в основу движка и пережили бы удаление.
 *
 * ЧИСТАЯ ОСНОВА
 *
 * Вид — преобразование чисел игрока: «яркость 140 %». Возьми основой файл,
 * который уже поставил сам Astral, — второе «Применить» сделало бы фонари
 * ярче ещё раз. Поэтому:
 *
 *  • модели и описание пропов всегда читаются из `x64h.rpf`, куда Astral не
 *    пишет;
 *  • огни вдали — по памяти «что мы записали → из чего»: каждый записанный
 *    файл помнит хеш своей основы, а основа лежит копией под своим хешем.
 *    Живой файл, который мы узнаём, разворачивается к основе; любой другой —
 *    сам новая основа (его положил мод или проверка файлов в Steam). Память
 *    держит несколько последних записей, а не одну: перемотка из библиотеки
 *    возвращает в игру и прежние наши версии;
 *  • ключи visualsettings — так же, по записанному тексту значения;
 *  • строка entityfx, клон ядра и строки сетки снимаются по своей приставке и
 *    ставятся заново: такая правка сама себя не копит.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { decodeBlocks, decodeDds, levelBytes, resample } from "@modovik/dds";
import { encodeDdsPooled } from "./dds-pool.js";
import {
  parseVisualSettings,
  patchVisualSettings,
  readVisualSetting,
  serializeVisualSettings,
} from "@modovik/optimizer";
import {
  BUTTERFLY_SHEET,
  BUTTERFLY_VARIANTS,
  CUSTOM_TEXTURE_EDGE,
  DISTANT_STREET_KEYS,
  LAMP_ARCHIVE,
  LAMP_FX_PREFIX,
  LAMP_MODEL_FILES,
  PARTICLE_DONORS,
  POLE_MODEL_NAMES,
  bridgeColour,
  butterflySheet,
  lookSheet,
  compileDistantLights,
  compileLampExtensions,
  compileLampModels,
  compileLampParticles,
  compileLodRule,
  lampGroupOf,
  lampProjectIsVanilla,
  lampRainbowLead,
  normalizeLampProject,
  patchEntityFx,
  poleJobFor,
  tintGlass,
} from "@modovik/street-light-contract/lamps";
import { openResource, readYptTextures } from "@modovik/ypt";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import {
  exportLampGlass,
  exportYptRules,
  inspectLampModels,
  patchLampArchetypes,
  patchLampLodPairs,
  patchLampModels,
  patchYptTextures,
  resolveRpfHelperExecutable,
} from "./rpf-composer.js";
import { createPtfxBaseCache, sourceStampOf } from "./ptfx-base-cache.js";
import { readClipGrids, upsertClipRegions } from "./ptfx-clip-regions.js";
import { planLampLightsPackage, setLampLightsPackage } from "./lamp-lights-package.js";
import { buildBridgeFiles } from "./lamp-bridges.js";
import { buildPoleFiles } from "./lamp-poles.js";
import { createGameReader } from "./optimization-layers.js";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { registerPatchRecomposer, writeRecomposeSidecar } from "./patch-recompose.js";

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  inspectModels: inspectLampModels,
  patchModels: patchLampModels,
  patchLod: patchLampLodPairs,
  patchYtyp: patchLampArchetypes,
  patchCore: patchYptTextures,
  exportRules: exportYptRules,
  exportGlass: exportLampGlass,
  packagePlan: planLampLightsPackage,
  lampPackage: setLampLightsPackage,
  /* Модели эстакад и словари района — прямым чтением архивов игры. */
  openGame: async (gameRoot, keys) => createGameReader(gameRoot, await keysFromDirectory(keys || "")),
  bridgeFiles: buildBridgeFiles,
  /* Столбы: краска корпуса, блеск, прозрачность, украшения (`lamp-poles.js`). */
  poleFiles: buildPoleFiles,
});

const MAX_PROJECT_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const RECOMPOSE_KIND = "lamp-studio";
const BASE_STORE_VERSION = 1;
/* Сколько наших записей файла помнить: столько версий фонарей может
   вернуться в игру перемоткой из библиотеки. */
const PRODUCED_LIMIT = 6;
const PLAN_TTL_MS = 20 * 60 * 1000;
const PLAN_LIMIT = 3;
const PREVIEW_SHEET_EDGE = 512;

const UPDATE_ARCHIVE = path.join("update", "update.rpf");
const DATA_FILES = Object.freeze({
  visual: { update: "common/data/visualsettings.dat", common: "data/visualsettings.dat" },
  entityfx: { update: "common/data/effects/entityfx.dat", common: "data/effects/entityfx.dat" },
  clip: {
    update: "common/data/effects/ptxclipregions.dat",
    common: "data/effects/ptxclipregions.dat",
  },
});
const CORE_ARCHIVES = Object.freeze(["ptfx.rpf", "ptfx_hi.rpf", "ptfx_lo.rpf"]);
const coreEntry = (archive) => `x64/patch/data/effects/${archive}/core.ypt`;
/* Наборы огней вдали в update.rpf: штатный и набор DLC mp2025_02 (его игра
   берёт для карты с последними дополнениями). Огни наборов старых DLC
   (hei_, apa_, vw_) лежат в своих dlcpacks и в эту версию не входят. */
const LOD_FOLDERS = Object.freeze([
  "x64/levels/gta5/lodlights.rpf/",
  "dlc_patch/mp2025_02/x64/levels/gta5/lodlights.rpf/",
]);
const modelEntry = (file) => `${LAMP_ARCHIVE.folder}/${file}`;
const YTYP_ENTRY = `${LAMP_ARCHIVE.folder}/${LAMP_ARCHIVE.ytyp}`;
/* Приставка всего, что редактор кладёт в игру: расширения пропов, клон
   правила, листы крыльев. */
const LAMP_PREFIX_BYTES = Buffer.from(LAMP_FX_PREFIX, "latin1");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/*
 * Есть ли в ядре клон или листы Astral. Ядро лежит в архиве сжатым ресурсом
 * RSC7, и имена правил видны только в распакованных данных: по сырым байтам
 * вид «как в игре» не находил клона, и бабочки оставались в игре. Ядро,
 * которое не читается, отдаётся помощнику — он разберёт его сам или объяснит
 * отказ.
 */
function coreCarriesLampFx(bytes) {
  try {
    return Buffer.from(openResource(bytes).data).includes(LAMP_PREFIX_BYTES);
  } catch {
    return true;
  }
}
const gameKey = (gameRoot) => sha256(path.resolve(gameRoot).toLowerCase()).slice(0, 16);
const flatName = (entry) => entry.replace(/[^a-z0-9.]+/gi, "_");

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Работа фонарей обязательна.");
  const text = JSON.stringify(input);
  if (Buffer.byteLength(text, "utf8") > MAX_PROJECT_BYTES)
    throw new RangeError("Работа фонарей превышает 64 КБ.");
  return normalizeLampProject(JSON.parse(text));
}

/*
 * Своя картинка частиц приходит из окна base64 (PNG, уже вписанный в квадрат
 * и с прозрачностью, — `lamp-pictures.js`). Предел — с запасом на большой
 * рисунок, а не на фотоальбом.
 */
const MAX_PICTURE_BYTES = 4 * 1024 * 1024;

function boundedPicture(input) {
  const text = typeof input === "string" ? input : typeof input?.png === "string" ? input.png : "";
  if (!text) return null;
  const base64 = text.replace(/^data:image\/[a-z+]+;base64,/i, "");
  if (base64.length > Math.ceil((MAX_PICTURE_BYTES * 4) / 3) + 8)
    throw new RangeError("Своя картинка частиц больше 4 МБ.");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new TypeError("Своя картинка частиц пуста.");
  return bytes;
}

const archiveKeys = (input, stateDir, tools) =>
  archiveKeysDirectory({ keys: input?.keys, stateDir, provision: tools.archiveSupport });

/* ---------- чтение из игры ---------- */

/*
 * Сколько символов записей идёт в один запуск хоста. Записи уходят ему
 * аргументами командной строки, а у Windows строка — 32 767 символов: 440
 * записей огней вдали по семьдесят символов в неё не влезали (ENAMETOOLONG
 * на копии игры владельца).
 */
const EXTRACT_BATCH_CHARS = 16_000;

function batches(entries) {
  const result = [];
  let current = [];
  let length = 0;
  for (const entry of entries) {
    const cost = entry.length + 12;
    if (current.length && length + cost > EXTRACT_BATCH_CHARS) {
      result.push(current);
      current = [];
      length = 0;
    }
    current.push(entry);
    length += cost;
  }
  if (current.length) result.push(current);
  return result;
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
  for (const batch of batches(entries)) {
    const result = await native(
      "extract-archive-entries",
      { input, outputDirectory: directory, entries: batch, gameRoot, keys },
      context,
    );
    for (const file of result?.files || [])
      found.set(String(file.entry).replace(/\\/g, "/").toLowerCase(), path.join(directory, file.file));
  }
  return found;
}

/** Текст файла данных из update.rpf, иначе из common.rpf: `{ text, inUpdate }`. */
async function readDataFile(io, spec, directory) {
  for (const [archive, entry, inUpdate] of [
    [UPDATE_ARCHIVE, spec.update, true],
    ["common.rpf", spec.common, false],
  ]) {
    const files = await extractEntries(io, archive, [entry], path.join(directory, inUpdate ? "update" : "common"));
    const file = files.get(entry.toLowerCase());
    if (!file) continue;
    if ((await fs.stat(file)).size > MAX_TEXT_BYTES)
      throw new RangeError(`${entry} в архиве игры неправдоподобно велик.`);
    return { text: await fs.readFile(file, "latin1"), inUpdate };
  }
  return null;
}

/*
 * Пары огней вдали: `lodlights_*` ↔ `distlodlights_*` (у набора DLC — с
 * приставкой: `m25_2_lodlights_*` ↔ `m25_2_distlodlights_*`) и
 * `*_lodlights` ↔ `*_distantlights`.
 */
export function lodPairsFromEntries(entries) {
  const known = new Set(entries.map((entry) => entry.toLowerCase()));
  const pairs = [];
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    const folder = LOD_FOLDERS.find((item) => lower.startsWith(item));
    if (!folder || !lower.endsWith(".ymap")) continue;
    const name = lower.slice(folder.length);
    let distant = null;
    if (/(^|_)lodlights_/.test(name) && !name.includes("distlodlights_"))
      distant = name.replace(/(^|_)lodlights_/, "$1distlodlights_");
    else if (name.endsWith("_lodlights.ymap"))
      distant = name.replace(/_lodlights\.ymap$/, "_distantlights.ymap");
    if (!distant || !known.has(folder + distant)) continue;
    pairs.push({ lod: folder + name, distant: folder + distant });
  }
  return pairs.sort((a, b) => (a.lod < b.lod ? -1 : a.lod > b.lod ? 1 : 0));
}

async function listLodPairs({ native, gameRoot, keys, context }) {
  const listing = await native(
    "list-archive-entries",
    { gameRoot, archive: "update/update.rpf", filter: "lodlights.rpf/", depth: 6, maxEntries: 6000, keys },
    context,
  );
  return lodPairsFromEntries(
    (listing?.entries || []).map((item) => String(item.path || "").replace(/\\/g, "/")),
  );
}

/** Модели фонарей из x64h.rpf и опись их ламп: `{ models, files }`. */
async function describeModels(io, tools, directory) {
  const files = await extractEntries(io, LAMP_ARCHIVE.archive, LAMP_MODEL_FILES.map(modelEntry), directory);
  const present = LAMP_MODEL_FILES.map((file) => ({ file, path: files.get(modelEntry(file).toLowerCase()) })).filter(
    (item) => item.path,
  );
  if (!present.length) return { models: [], files: new Map() };
  const inspected = await tools.inspectModels({
    gameRoot: io.gameRoot,
    models: present.map((item) => ({ file: item.path, model: item.file.replace(/\.\w+$/, ""), entry: item.file })),
  });
  const byModel = new Map(present.map((item) => [item.file.replace(/\.\w+$/, ""), item]));
  return {
    models: inspected?.models || [],
    files: new Map((inspected?.models || []).map((model) => [model.model, byModel.get(model.model)])),
  };
}

/* ---------- база для окна ---------- */

/* Верхний уровень текстуры ядра в RGBA. */
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

async function readParticleBase(io, tools, directory) {
  const cores = await extractEntries(io, UPDATE_ARCHIVE, [coreEntry(CORE_ARCHIVES[0])], path.join(directory, "core"));
  const core = cores.get(coreEntry(CORE_ARCHIVES[0]).toLowerCase());
  if (!core) throw new Error("В update.rpf нет ядра частиц core.ypt.");
  const exported = await tools.exportRules({ gameRoot: io.gameRoot, input: core, rules: [...PARTICLE_DONORS] });
  const model = exported?.export;
  if (!model) throw new Error("Помощник RPF не выписал правила частиц.");
  const clip = await readDataFile(io, DATA_FILES.clip, path.join(directory, "clip")).catch(() => null);
  /* Окну нужны только сетки листов: заголовок таблицы редукса бывает с неверными счётчиками, игра её принимает — строго читает только запись (`ptfx-clip-regions.js: readClipGrids`). */
  const grids = clip ? readClipGrids(clip.text) : new Map();
  const wanted = new Set((model.textures || []).map((name) => String(name).toLowerCase()));
  const sheets = {};
  for (const texture of readYptTextures(await fs.readFile(core))) {
    const key = texture.name.toLowerCase();
    if (!wanted.has(key) || !texture.decodable || !texture.payload) continue;
    sheets[texture.name] = await sheetPng(texture, grids.get(key) || { columns: 1, rows: 1 });
  }
  return { model, sheets };
}

/**
 * Лампы игрока для окна: какие модели есть и какие в них лампы (цвет, сила,
 * флаги, где стоит лампа), сколько пар огней вдали и правила частиц-доноров с
 * их листами — предпросмотр проигрывает тот же клон, что уедет в игру.
 * Частицы не прочитались — лампы всё равно приходят, а причина — рядом.
 */
export async function readLampStudioBase(input, context, stateDir, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const keys = await archiveKeys(input, stateDir, t);
  const io = { native: t.native, gameRoot, keys, context };
  const directory = path.join(os.tmpdir(), `astral-lamps-${randomUUID()}`);
  try {
    const { models } = await describeModels(io, t, path.join(directory, "models"));
    const pairs = await listLodPairs(io).catch(() => []);
    let particles = null;
    let particlesError = null;
    try {
      particles = await readParticleBase(io, t, path.join(directory, "fx"));
    } catch (error) {
      particlesError = String(error?.message || error);
    }
    return {
      models: models.map((model) => ({
        model: model.model,
        group: lampGroupOf(model.model),
        lights: (model.lights || []).map((light) => ({
          list: light.list,
          index: light.index,
          type: light.type,
          flags: light.flags,
          bone: light.bone,
          color: light.color,
          intensity: light.intensity,
          falloff: light.falloff,
          falloffExponent: light.falloffExponent,
          corona: light.corona,
          volume: { intensity: light.volume?.intensity, sizeScale: light.volume?.sizeScale },
          position: light.position,
          direction: light.direction,
          coneOuterAngle: light.coneOuterAngle,
        })),
      })),
      lodPairs: pairs.length,
      particles,
      particlesError,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/* Что читает базу фонарей: поменялся код — база читается заново. */
const LAMP_READER_MODULES = Object.freeze(["./lamp-studio.js", "./ptfx-clip-regions.js", "./ptfx-base-cache.js"]);
const LAMP_READER_PACKAGES = Object.freeze(["@modovik/street-light-contract/lamps", "@modovik/ypt", "@modovik/dds"]);

/**
 * База фонарей читается из игры один раз на её состояние — тем же кэшем,
 * что база эффектов (`ptfx-base-cache.js`), в своей папке. Один на главный
 * процесс и на запекание песочницы (`scripts/bake-lamp-base.mjs`): отпечаток
 * у них обязан совпадать.
 */
export function createLampBaseCache(options = {}) {
  return createPtfxBaseCache({
    helperExecutable: () => resolveRpfHelperExecutable(),
    sourceStamp: () => sourceStampOf(LAMP_READER_MODULES, LAMP_READER_PACKAGES),
    folder: "lamp-base",
    ...options,
  });
}

/* ---------- память чистой основы ---------- */

async function openBaseStore(stateDir, gameRoot) {
  const directory = path.join(stateDir || os.tmpdir(), "lamp-bases", gameKey(gameRoot));
  let meta = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(directory, "base.json"), "utf8"));
  } catch {
    meta = null;
  }
  if (
    meta?.version !== BASE_STORE_VERSION ||
    !meta.files ||
    typeof meta.files !== "object" ||
    !meta.values ||
    typeof meta.values !== "object"
  )
    meta = { version: BASE_STORE_VERSION, files: {}, values: {} };
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
 * живой файл, чем гадать: фонари соберутся поверх нашей же прежней записи.
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

/** Основа значения ключа: `{ text, ours }`. */
function valueBase(store, key, liveText) {
  const hit = (store.meta.values[key]?.produced || []).find(([written]) => written === liveText);
  return hit ? { text: hit[1], ours: true } : { text: liveText, ours: false };
}

function remember(list, written, base) {
  return [...(list || []).filter(([item]) => item !== written), [written, base]].slice(-PRODUCED_LIMIT);
}

/** Запомнить поставленное: что записано и из какой основы. */
async function commitBaseStore(store, pending) {
  for (const { entry, written, base } of pending.files) {
    const record = store.meta.files[entry] || { base, produced: [] };
    record.produced = remember(record.produced, written, base);
    store.meta.files[entry] = record;
  }
  for (const { key, written, base } of pending.values) {
    const record = store.meta.values[key] || { produced: [] };
    record.produced = remember(record.produced, written, base);
    store.meta.values[key] = record;
  }
  /* Копии, на которые больше ничто не ссылается, уходят: основа файла
     держится, пока по ней есть наша запись или пока она последняя виденная. */
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

/* Доля канала для visualsettings: три знака, без хвостовых нулей, но с
   точкой — как пишет сама игра («1.0», «0.47»). */
export function fractionText(value) {
  const text = Number(value).toFixed(3).replace(/0+$/, "");
  return text.endsWith(".") ? `${text}0` : text;
}

/*
 * Листы частиц работы: ряд монархов из листа ядра игрока, перекрашенный под
 * вариант, листы видов для чужого движения (лепестки, снег, огоньки,
 * мотыльки — из ядра игрока как есть) и своя картинка человека. Уровни mip —
 * до четырёх точек по меньшей стороне: у DXT меньше блока нет, и лист с
 * уровнем 4×1 не переживал сверку помощника.
 */
async function particleTextures(particles, coreFile, directory, picture) {
  if (!particles?.textures.length) return [];
  await fs.mkdir(directory, { recursive: true });
  let coreTextures = null;
  const sources = new Map();
  /* Лист ядра по имени — раскодированный один раз на сборку. */
  const coreSheet = async (name, missing) => {
    const key = name.toLowerCase();
    if (sources.has(key)) return sources.get(key);
    coreTextures ??= readYptTextures(await fs.readFile(coreFile));
    const texture = coreTextures.find((item) => item.name.toLowerCase() === key);
    if (!texture?.payload || !texture.decodable) throw new Error(missing);
    const found = { width: texture.width, height: texture.height, rgba: textureRgba(texture) };
    sources.set(key, found);
    return found;
  };
  const patches = [];
  for (const item of particles.textures) {
    let sheet;
    if (item.custom) {
      if (!picture)
        throw new Error("Своей картинки частиц нет на этом компьютере — выберите файл в «Частицах» заново.");
      sheet = await customSheet(picture);
    } else if (item.copy) {
      const source = await coreSheet(
        item.copy.source,
        `В ядре игрока нет листа ${item.copy.source} — частицы этого вида собрать не из чего.`,
      );
      sheet = lookSheet(source.rgba, source.width, source.height, item.copy);
    } else {
      const source = await coreSheet(
        BUTTERFLY_SHEET.source,
        "В ядре игрока нет листа бабочек ptfx_insects_rgb — бабочек собрать не из чего.",
      );
      sheet = butterflySheet(source.rgba, source.width, source.height, item.sheet, BUTTERFLY_VARIANTS[item.variant]);
    }
    const mipLevels = Math.max(1, Math.floor(Math.log2(Math.min(sheet.width, sheet.height) / 4)) + 1);
    /* Лист может быть окном кэша ядра (`coreSheet`): его буфер не переносим, кодируем копию. */
    const dds = await encodeDdsPooled({ width: sheet.width, height: sheet.height, format: "DXT5", mipLevels, rgba: new Uint8ClampedArray(sheet.rgba) });
    const file = path.join(directory, `${item.texture}.dds`);
    await fs.writeFile(file, dds);
    patches.push({ texture: item.texture, source: file, sha256: sha256(dds) });
  }
  return patches;
}

/* Своя картинка → лист 128×128: вписана целиком, пустое — прозрачное. */
async function customSheet(picture) {
  const edge = CUSTOM_TEXTURE_EDGE;
  const { data } = await sharp(picture, { limitInputPixels: 64_000_000 })
    .ensureAlpha()
    .resize(edge, edge, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: edge, height: edge, rgba: new Uint8Array(data) };
}

/*
 * Стекло лампы — в цвет её света. Помощник выгрузил текстуру светящегося
 * шейдера (DDS), окно красит её `tintGlass` и собирает тем же форматом и
 * числом уровней: помощник кладёт байты на место прежних, и длина обязана
 * совпасть. Формат, который не собрать, пропускается — стекло останется как
 * было, а свет всё равно перекрасится.
 */
const GLASS_FORMATS = new Set(["DXT1", "DXT3", "DXT5", "A8R8G8B8"]);

async function tintGlassTexture(file, colour, directory) {
  try {
    const dds = decodeDds(await fs.readFile(file));
    if (!GLASS_FORMATS.has(dds.format) || !dds.levels.length) return null;
    const top = dds.levels[0];
    const out = await encodeDdsPooled({
      width: dds.width,
      height: dds.height,
      format: dds.format,
      mipLevels: dds.mipLevels,
      rgba: tintGlass(top.rgba, colour),
    });
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, path.basename(file));
    await fs.writeFile(target, out);
    return target;
  } catch {
    return null;
  }
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

/* Огни вдали: пары из основы, правка по правилу, возврат наших файлов. */
async function lodActions({ io, tools, store, project, models, read, out }) {
  const rule = compileLodRule(project, models);
  const pairs = await listLodPairs(io);
  const result = { actions: [], pending: [], pairs: 0, lights: 0, skipped: [] };
  if (!pairs.length) return result;
  const files = await extractEntries(
    io,
    UPDATE_ARCHIVE,
    pairs.flatMap((pair) => [pair.lod, pair.distant]),
    read,
  );
  const bases = [];
  for (const pair of pairs) {
    const lodLive = files.get(pair.lod);
    const distantLive = files.get(pair.distant);
    if (!lodLive || !distantLive) continue;
    const lod = await fileBase(store, pair.lod, await fs.readFile(lodLive));
    const distant = await fileBase(store, pair.distant, await fs.readFile(distantLive));
    bases.push({ pair, lod, distant });
  }
  const restore = (entry, base) => ({ entry, bytes: base.bytes, restore: true });
  const writes = [];
  if (rule && bases.length) {
    const baseDirectory = path.join(out, "lod-base");
    const outputDirectory = path.join(out, "lod");
    await fs.mkdir(baseDirectory, { recursive: true });
    await fs.mkdir(outputDirectory, { recursive: true });
    const request = [];
    for (const { pair, lod, distant } of bases) {
      const lodInput = path.join(baseDirectory, flatName(pair.lod));
      const distantInput = path.join(baseDirectory, flatName(pair.distant));
      await fs.writeFile(lodInput, lod.bytes);
      await fs.writeFile(distantInput, distant.bytes);
      request.push({
        lodInput,
        distantInput,
        lodOutput: path.join(outputDirectory, flatName(pair.lod)),
        distantOutput: path.join(outputDirectory, flatName(pair.distant)),
      });
    }
    const patched = await tools.patchLod({ gameRoot: io.gameRoot, rule, pairs: request });
    const reports = patched?.pairs || [];
    bases.forEach(({ pair, lod, distant }, index) => {
      const report = reports[index] || {};
      if (report.skipped) result.skipped.push({ lod: pair.lod, reason: report.skipped });
      if (Number(report.changed) > 0) {
        result.pairs += 1;
        result.lights += Number(report.changed);
        writes.push({ entry: pair.lod, file: request[index].lodOutput, base: lod });
        writes.push({ entry: pair.distant, file: request[index].distantOutput, base: distant });
        return;
      }
      /* Этой паре по правилу менять нечего, а в игре лежит наша прежняя
         запись — она возвращается к основе. */
      if (lod.ours) writes.push(restore(pair.lod, lod));
      if (distant.ours) writes.push(restore(pair.distant, distant));
    });
  } else {
    for (const { pair, lod, distant } of bases) {
      if (lod.ours) writes.push(restore(pair.lod, lod));
      if (distant.ours) writes.push(restore(pair.distant, distant));
    }
  }
  for (const item of writes) {
    const bytes = item.bytes || (await fs.readFile(item.file));
    const hash = sha256(bytes);
    const same = item.base ? hash === item.base.sha256 : false;
    result.actions.push({ action: "Replace", entry: item.entry, bytes, restore: Boolean(item.restore) || same });
    if (item.base && !same) result.pending.push({ entry: item.entry, written: hash, base: item.base.sha256 });
  }
  return result;
}

/* Дорожные огни: ключи по чистой основе, точность цвета — своя. */
function visualAction({ store, project, visual, models }) {
  const none = { action: null, pending: [], changed: 0 };
  if (!visual) return none;
  const document = parseVisualSettings(visual.text);
  const bases = new Map();
  for (const key of Object.values(DISTANT_STREET_KEYS)) {
    const live = readVisualSetting(document, key);
    if (live !== null) bases.set(key, valueBase(store, key, live));
  }
  const intensity = bases.get(DISTANT_STREET_KEYS.intensity);
  const wanted = compileDistantLights(project, intensity ? Number(intensity.text) : Number.NaN, models);
  const values = {};
  const pending = [];
  for (const [key, base] of bases) {
    const text = key in wanted ? fractionText(wanted[key]) : base.text;
    values[key] = text;
    if (text !== base.text) pending.push({ key, written: text, base: base.text });
  }
  const patched = patchVisualSettings(document, values);
  if (!patched.applied.length)
    return {
      ...none,
      /* Значения нашей прежней версии уже стоят: патч новой несёт файл сам. */
      carry: pending.length
        ? {
            action: visual.inUpdate ? "Replace" : "Import",
            entry: DATA_FILES.visual.update,
            bytes: Buffer.from(serializeVisualSettings(patched.document), "latin1"),
            restore: false,
          }
        : null,
    };
  return {
    action: {
      action: visual.inUpdate ? "Replace" : "Import",
      entry: DATA_FILES.visual.update,
      bytes: Buffer.from(serializeVisualSettings(patched.document), "latin1"),
      restore: pending.length === 0,
    },
    pending,
    changed: patched.applied.length,
  };
}

/**
 * Всё, что уедет в игру, без записи в неё: папка нативного патча (если файлы
 * update.rpf меняются), файлы пакета моделей и что с пакетом станет.
 * `models: false` — только файлы update.rpf (пересборка из библиотеки: пакет
 * движок держит сам).
 */
async function materialize(input, context, stateDir, tools, { models = true } = {}) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const project = boundedProject(input.project);
  const picture = boundedPicture(input.customTexture);
  const keys = await archiveKeys(input, stateDir, t);
  const io = { native: t.native, gameRoot, keys, context };
  const work = path.join(stateDir || os.tmpdir(), "lamp-studio-work", randomUUID());
  const read = path.join(work, "read");
  const out = path.join(work, "out");
  await fs.mkdir(out, { recursive: true });
  let patch = null;
  try {
    const store = await openBaseStore(stateDir, gameRoot);
    const particles = compileLampParticles(project);
    const summary = {
      models: 0,
      lamps: 0,
      archetypes: 0,
      lodPairs: 0,
      lodLights: 0,
      lodSkipped: 0,
      distant: 0,
      glass: 0,
      bridgeLights: 0,
      bridgeStrips: 0,
      bridgeMissing: 0,
      poles: 0,
      poleDecorated: 0,
      poleMissing: 0,
      particles: particles?.template || null,
    };

    /* 1. Модели и описание пропов — из x64h.rpf. Опись нужна и радуге огней
       вдали (подписи ламп), поэтому читается и при пересборке из библиотеки. */
    const described = await describeModels(io, t, path.join(read, "models"));
    const compiled = compileLampModels(described.models, project);
    const packageFiles = [];
    if (models) {
      const glassByModel = new Map();
      const glassModels = compiled.filter((item) => item.glass && described.files.get(item.model));
      if (glassModels.length) {
        const exported = await t.exportGlass({
          gameRoot,
          models: glassModels.map((item) => ({
            file: described.files.get(item.model).path,
            model: item.model,
            output: path.join(out, "glass", "base"),
          })),
        });
        for (const model of exported?.models || []) {
          const colour = glassModels.find((item) => item.model === model.model)?.glass;
          const textures = [];
          for (const texture of model.textures || []) {
            /* Текстуру берёт и несветящийся шейдер — перекраска задела бы
               корпус фонаря: такое стекло остаётся как было. */
            if (texture.shared || !colour) continue;
            const tinted = await tintGlassTexture(texture.file, colour, path.join(out, "glass", "tinted"));
            if (tinted) textures.push({ name: texture.name, source: tinted });
          }
          if (textures.length) glassByModel.set(model.model, textures);
        }
      }
      const patches = [];
      for (const item of compiled) {
        const textures = glassByModel.get(item.model) || [];
        if (!item.mutations.length && !textures.length) continue;
        const source = described.files.get(item.model);
        if (!source) continue;
        patches.push({
          input: source.path,
          output: path.join(out, "models", source.file),
          model: item.model,
          mutations: item.mutations,
          textures,
        });
      }
      if (patches.length) {
        await fs.mkdir(path.join(out, "models"), { recursive: true });
        await t.patchModels({ gameRoot, patches });
        for (const item of patches) packageFiles.push({ name: path.basename(item.output), source: item.output });
        summary.models = patches.length;
        summary.lamps = patches.reduce((total, item) => total + item.mutations.length, 0);
        summary.glass = glassByModel.size;
      }
      if (particles) {
        const extensions = compileLampExtensions(described.models, particles);
        if (extensions.length) {
          const ytyp = (await extractEntries(io, LAMP_ARCHIVE.archive, [YTYP_ENTRY], path.join(read, "ytyp"))).get(
            YTYP_ENTRY.toLowerCase(),
          );
          if (!ytyp)
            throw new Error("В игре нет описания фонарей v_traffic_lights.ytyp — частицам не к чему крепиться.");
          const output = path.join(out, "models", LAMP_ARCHIVE.ytyp);
          await fs.mkdir(path.dirname(output), { recursive: true });
          await t.patchYtyp({ gameRoot, input: ytyp, output, extensions, prefix: LAMP_FX_PREFIX });
          packageFiles.push({ name: LAMP_ARCHIVE.ytyp, source: output });
          summary.archetypes = extensions.length;
        }
      }
      /* 1а. Столбы (ТЗ 10.10, вечер): краска корпуса, блеск, прозрачность и
         украшения — поверх правки ламп той же модели (`lamp-poles.js`).
         Листы корпуса бывают в словаре архетипа (семейство 03, светофоры) и
         крупнее — в словаре высокой чёткости: они читаются из того же архива.
         Заказы — по всем моделям столбов, а не только по описи ламп: у
         столбиков светофоров (03a, 03b, ТЗ 11.10) ламп нет, в опись они не
         попадают, и их модели достаются отдельно. */
      const poleJobs = POLE_MODEL_NAMES.map((model) => poleJobFor(model, project.pole)).filter(Boolean);
      if (poleJobs.length) {
        const patched = new Map(patches.map((item) => [item.model, item.output]));
        const bare = await extractEntries(
          io,
          LAMP_ARCHIVE.archive,
          poleJobs.filter((job) => !described.files.get(job.model)?.path).map((job) => modelEntry(`${job.model}.yft`)),
          path.join(read, "pole-models"),
        );
        const dictionaryFiles = await extractEntries(
          io,
          LAMP_ARCHIVE.archive,
          [
            ...new Set(
              poleJobs.flatMap((job) =>
                [`${job.model}+hifr`, ...(job.txd ? [job.txd, `${job.txd}+hi`] : [])].map((name) =>
                  modelEntry(`${name}.ytd`),
                ),
              ),
            ),
          ],
          path.join(read, "pole-dictionaries"),
        );
        const poles = await t.poleFiles({
          jobs: poleJobs,
          sourceOf: (model) =>
            patched.get(model) ||
            described.files.get(model)?.path ||
            bare.get(modelEntry(`${model}.yft`).toLowerCase()) ||
            null,
          dictionaries: async (job) => {
            const found = [];
            for (const name of [`${job.model}+hifr`, ...(job.txd ? [job.txd, `${job.txd}+hi`] : [])]) {
              const file = dictionaryFiles.get(modelEntry(`${name}.ytd`).toLowerCase());
              if (file) found.push({ name, bytes: await fs.readFile(file) });
            }
            return found;
          },
          directory: path.join(out, "poles"),
          compile: (command, request) => t.native(command, request, context),
        });
        for (const file of poles.files) {
          const at = packageFiles.findIndex((item) => item.name === file.name);
          if (at >= 0) packageFiles[at] = file;
          else packageFiles.push(file);
        }
        summary.poles = poles.files.length;
        summary.poleDecorated = poles.reports.filter((item) => item.decorated).length;
        summary.poleMissing = poles.reports.reduce((total, item) => total + item.missing.length, 0);
      }

      /* 1б. Лампы под мостами и в тоннелях: модели дорог и словари района с
         листом трубки (`lamp-bridges.js`). По умолчанию — цветом фонарей
         (у радуги — первым её цветом), свой цвет или как в игре — на выбор. */
      const bridgeHex = bridgeColour(project, { lead: lampRainbowLead(described.models, project) });
      if (bridgeHex) {
        const reader = await t.openGame(gameRoot, keys);
        try {
          const bridge = await t.bridgeFiles({ reader, hex: bridgeHex, out: path.join(out, "bridges") });
          packageFiles.push(...bridge.files);
          summary.bridgeLights = bridge.lights;
          summary.bridgeStrips = bridge.strips;
          summary.bridgeMissing = bridge.missing?.length || 0;
        } finally {
          await reader.close();
        }
      }
    }

    /* 2. Файлы update.rpf. */
    const actions = [];
    /*
     * Что работа уже поставила и что не изменилось (19.10.2026, задача 39).
     * Патч считается как разница с игрой, но замена прежней версии снимает её
     * перемоткой архива и возвращает новую одним её патчем: всё, чего в нём
     * нет, пропадает. Поэтому патч, который вообще что-то меняет, несёт и
     * неизменившиеся файлы работы — дорожные огни, таблицу частиц, сетку
     * листов и ядра. Огни вдали берутся от основы и в разницу не попадают.
     */
    const carry = [];
    const pending = { files: [], values: [] };

    const lod = await lodActions({
      io,
      tools: t,
      store,
      project,
      models: described.models,
      read: path.join(read, "lod"),
      out,
    });
    actions.push(...lod.actions);
    pending.files.push(...lod.pending);
    summary.lodPairs = lod.pairs;
    summary.lodLights = lod.lights;
    summary.lodSkipped = lod.skipped.length;

    const visual = visualAction({
      store,
      project,
      models: described.models,
      visual: await readDataFile(io, DATA_FILES.visual, path.join(read, "visual")),
    });
    if (visual.action) actions.push(visual.action);
    else if (visual.carry) carry.push(visual.carry);
    pending.values.push(...visual.pending);
    summary.distant = visual.changed;

    const entityfx = await readDataFile(io, DATA_FILES.entityfx, path.join(read, "entityfx"));
    if (particles && !entityfx) throw new Error("В игре нет таблицы entityfx.dat — частицам некуда встать.");
    if (entityfx) {
      const next = patchEntityFx(entityfx.text, particles ? particles.entityFx : null);
      const action = {
        action: entityfx.inUpdate ? "Replace" : "Import",
        entry: DATA_FILES.entityfx.update,
        bytes: Buffer.from(next.text, "latin1"),
        restore: !particles,
      };
      if (next.changed) actions.push(action);
      else if (particles) carry.push(action);
    }

    const cores = await extractEntries(io, UPDATE_ARCHIVE, CORE_ARCHIVES.map(coreEntry), path.join(read, "core"));
    const liveCores = [];
    for (const archive of CORE_ARCHIVES) {
      const file = cores.get(coreEntry(archive).toLowerCase());
      if (file) liveCores.push({ archive, file, bytes: await fs.readFile(file) });
    }
    /* Клон или листы Astral в ядре — повод пересобрать ядро, даже если
       частиц в работе больше нет: иначе выключенные бабочки остались бы. */
    const coreHasOurs = liveCores.some((core) => coreCarriesLampFx(core.bytes));
    const clip = await readDataFile(io, DATA_FILES.clip, path.join(read, "clip"));
    /* Таблица нужна, только когда у частиц есть свои листы или в ней уже стоят строки семейства (их снимаем). Мотыльки и снятие частиц без строк таблицу не трогают, и чужая таблица с неверным
       счётчиком им не помеха — как у колёс (`wheel-smoke.js`: `compiled.clipSheets.length || prefix`); ядро с нашим клоном — повод пересобрать ядро ниже, а не таблицу. */
    if (clip && (particles?.clipSheets?.length || clip.text.toLowerCase().includes(LAMP_FX_PREFIX))) {
      const next = upsertClipRegions(clip.text, particles ? particles.clipSheets : [], { reset: [LAMP_FX_PREFIX] });
      const action = {
        action: clip.inUpdate ? "Replace" : "Import",
        entry: DATA_FILES.clip.update,
        bytes: Buffer.from(next.text, "latin1"),
        restore: !particles,
      };
      if (next.changed) actions.push(action);
      /* Своих листов у частиц нет (мотыльки) — таблица работе не нужна. */
      else if (particles?.clipSheets?.length) carry.push(action);
    }
    if (particles || coreHasOurs) {
      if (!liveCores.length) throw new Error("В update.rpf нет ядра частиц core.ypt.");
      const texturePatches = particles
        ? await particleTextures(particles, liveCores[0].file, path.join(out, "wings"), picture)
        : [];
      await fs.mkdir(path.join(out, "core"), { recursive: true });
      for (const core of liveCores) {
        const output = path.join(out, "core", `core-${core.archive.replace(/\./g, "-")}.ypt`);
        await t.patchCore({
          gameRoot,
          input: core.file,
          output,
          patches: texturePatches,
          effectClones: particles ? [particles.clone] : [],
          effectCloneReset: [LAMP_FX_PREFIX],
        });
        const bytes = await fs.readFile(output);
        const action = { action: "Replace", entry: coreEntry(core.archive), bytes, restore: !particles };
        if (!bytes.equals(core.bytes)) actions.push(action);
        else if (particles) carry.push(action);
      }
    }

    /* Ничего не изменилось — патча нет («уже такие»); иначе он несёт и
       неизменившееся: после перемотки новая версия встаёт целой. */
    if (actions.length) actions.push(...carry);

    /* 3. Папка патча. */
    if (actions.length) {
      patch = path.join(path.resolve(stateDir || os.tmpdir()), "lamp-studio-patches", randomUUID());
      const payload = path.join(patch, "payload");
      await fs.mkdir(payload, { recursive: true });
      const described = [];
      for (const [index, item] of actions.entries()) {
        const file = `${String(index).padStart(3, "0")}_${flatName(item.entry.split("/").slice(-2).join("_"))}`;
        await fs.writeFile(path.join(payload, file), item.bytes, { flag: "wx" });
        described.push({ ...item, file, size: item.bytes.length, sha256: sha256(item.bytes) });
      }
      const title = project.name ? `Astral — фонари «${project.name}»` : "Astral — фонари";
      await fs.writeFile(
        path.join(patch, "manifest.json"),
        `${JSON.stringify(patchManifest(title, described), null, 2)}\n`,
        { flag: "wx" },
      );
      /* Своя картинка едет в записке: пересборка из библиотеки соберёт тот
         же лист, даже если окно её уже забыло. */
      await writeRecomposeSidecar(patch, {
        kind: RECOMPOSE_KIND,
        project,
        customTexture: picture ? picture.toString("base64") : null,
      });
    }

    const packagePlan = models
      ? await t.packagePlan({ gameRoot, files: packageFiles }, stateDir)
      : { status: "untouched", modId: null, changes: false };

    return {
      gameRoot,
      project,
      patch,
      files: actions.map(({ entry, action, bytes, restore }) => ({ entry, action, size: bytes.length, restore })),
      restoresOnly: actions.every((item) => item.restore),
      packageFiles,
      packagePlan,
      store,
      pending,
      summary,
      work,
    };
  } catch (error) {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    if (patch) await fs.rm(patch, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/* ---------- планы ---------- */

const plans = new Map();

async function disposePlan(plan, { keepPatch = false } = {}) {
  await fs.rm(plan.work, { recursive: true, force: true }).catch(() => {});
  if (plan.patch && !keepPatch) await fs.rm(plan.patch, { recursive: true, force: true }).catch(() => {});
}

async function rememberPlan(generated) {
  const now = Date.now();
  for (const [id, plan] of [...plans])
    if (now - plan.createdAt > PLAN_TTL_MS) {
      plans.delete(id);
      await disposePlan(plan);
    }
  while (plans.size >= PLAN_LIMIT) {
    const [id, plan] = plans.entries().next().value;
    plans.delete(id);
    await disposePlan(plan);
  }
  const planId = randomUUID();
  plans.set(planId, { ...generated, createdAt: now });
  return planId;
}

/**
 * План: что уедет в игру и что станет с пакетом моделей. Окно по нему
 * решает, снимать ли прежнюю точку фонарей до смены пакета.
 */
export async function planLampStudio(input, context, stateDir, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, t);
  let validation = null;
  try {
    validation = generated.patch ? await t.native("validate-rpf-patch", { patch: generated.patch }, context) : null;
  } catch (error) {
    await disposePlan(generated);
    throw error;
  }
  const planId = await rememberPlan(generated);
  return {
    planId,
    summary: generated.summary,
    files: generated.files,
    models: generated.packageFiles.map((file) => file.name),
    native: Boolean(generated.patch),
    restoresOnly: generated.restoresOnly,
    engine: {
      status: generated.packagePlan.status,
      modId: generated.packagePlan.modId,
      changes: generated.packagePlan.changes,
    },
    validation,
  };
}

/**
 * «Применить» по плану: пакет моделей (если меняется), затем патч update.rpf.
 *
 * `previousRemoved` — окно уже сняло прежнюю точку фонарей: тогда патч,
 * который только возвращает наши файлы к основе, писать незачем — в игре и
 * так основа.
 *
 * Отказ патча после того, как пакет встал, не теряет пакет: ответ несёт его
 * `layerModId` и `nativeError`, и окно запоминает то, что в игре на самом
 * деле, прежде чем сказать об отказе.
 */
export async function applyLampStudio(input, context, stateDir, { assertRuntimeSafety, ...tools } = {}) {
  const t = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const planId = String(input?.planId || "");
  let generated = planId ? plans.get(planId) : null;
  if (generated && generated.gameRoot.toLowerCase() !== gameRoot.toLowerCase()) generated = null;
  if (generated) plans.delete(planId);
  /*
   * Окно сняло прежнюю точку фонарей после плана — игра под планом уже
   * другая: снятие вернуло update.rpf к основе, а план считал разницу с
   * прежней установкой. Файл, который в новом виде совпал с прежним (строка
   * entityfx того же роя), в план не попал, а снятие его откатило — рой
   * молча пропадал из игры (снято 28.09.2026). Поэтому после снятия план
   * собирается заново от живой игры.
   */
  let source = input;
  if (generated && input?.previousRemoved === true) {
    source = { ...input, project: input.project || generated.project };
    await disposePlan(generated);
    generated = null;
  }
  if (!generated) generated = await materialize(source, context, stateDir, t);

  let patchInstalled = false;
  try {
    const writeNative = Boolean(generated.patch) && !(input?.previousRemoved === true && generated.restoresOnly);
    if (!writeNative && !generated.packagePlan.changes)
      throw new Error(
        lampProjectIsVanilla(generated.project)
          ? "Это вид фонарей из игры — ставить нечего. Чтобы вернуть игру как была, нажмите «Откатить»."
          : "Фонари в игре уже такие — ставить нечего.",
      );
    await assertRuntimeSafety?.(gameRoot);

    let lampPackage = { status: generated.packagePlan.status, modId: generated.packagePlan.modId };
    let packageDone = false;
    if (generated.packagePlan.changes) {
      lampPackage = await t.lampPackage({ gameRoot, files: generated.packageFiles }, context, stateDir, {
        assertRuntimeSafety,
      });
      packageDone = true;
    }

    let installed = {};
    let nativeError = null;
    if (writeNative) {
      try {
        await assertRuntimeSafety?.(gameRoot);
        const support = await t.archiveSupport({ stateDir });
        installed = await t.native(
          "install-rpf-patch",
          {
            patch: generated.patch,
            gameRoot,
            archiveFix: path.join(support.directory, "ArchiveFix.exe"),
            keys: support.directory,
          },
          context,
        );
        patchInstalled = true;
        await commitBaseStore(generated.store, generated.pending);
      } catch (error) {
        if (!packageDone || patchInstalled) throw error;
        nativeError = String(error?.message || error);
        installed = {};
      }
    }
    return {
      ...installed,
      patch: patchInstalled ? generated.patch : null,
      gameRoot,
      layerModId: lampPackage?.modId || null,
      lampPackage,
      nativeError,
      summary: generated.summary,
      files: generated.files,
      models: generated.packageFiles.map((file) => file.name),
      platform: "Majestic / GTA5RP",
      edition: "Legacy",
    };
  } finally {
    /* Патч, который так и не встал, не нужен никому: точки отката на него
       нет. Вставший остаётся — по нему библиотека ставит работу обратно. */
    await disposePlan(generated, { keepPatch: patchInstalled });
  }
}

/*
 * Библиотека, вынимая работу из середины стопки, ставит фонари обратно
 * поверх перемотанного архива: патч собирается заново от того, что лежит в
 * игре сейчас, — иначе он вернул бы общие файлы (visualsettings, ядро) такими,
 * какими они были при первой установке, вместе с чужими правками тех дней.
 * Пакет моделей движок держит сам, и перематывать его не нужно.
 */
registerPatchRecomposer(RECOMPOSE_KIND, async ({ sidecar, gameRoot, stateDir, context, tools }) => {
  const generated = await materialize(
    { gameRoot, project: sidecar.project, customTexture: sidecar.customTexture || null },
    context,
    stateDir,
    tools,
    { models: false },
  );
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
