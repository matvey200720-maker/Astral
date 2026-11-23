/*
 * «Интерьеры проектов» (ТЗ 17.10.2026, вечер, задача 10, фаза 3) — сборка
 * пакета установки: отмеченные интерьеры из файлов игрока в одиночную игру.
 *
 * Что ставится. Файлы интерьера — те, что лежат у самого игрока: модели,
 * словари, коллизии, типы, карта размещения и `_manifest.ymf` пака. В поставке
 * Astral их нет, из папок игрока они никуда не копируются, кроме пакета
 * установки в хранилище Astral и, дальше, в `update.rpf` его же игры.
 * Каждый интерьер — свой контейнер `x64/astral/astral_proj_<номер>.rpf` слоя
 * Astral; общие файлы пака (библиотеки пропсов из соседних папок) едут в
 * контейнер того интерьера, который их требует первым (имя файла в игре одно).
 *
 * Что собирается поверх. «Цвет и блеск» работы ложатся на листы интерьера тем
 * же механизмом, что у «Интерьеров» магазинов (`recolor-shops.js`): цвет — тоном
 * по светотени листа, чистота — правкой пикселей, глянец и зеркало — бликом
 * шейдеров моделей этого интерьера. Красятся только листы из файлов самого
 * интерьера; листы штатных пропсов общие с игрой и остаются как были.
 *
 * Что проверяется до сборки (отказ — словами, без пакета):
 *   • интерьер есть в каталоге игрока и предлагается к установке;
 *   • каждый файл читается, это ресурс RSC7 и не больше предела;
 *   • имя файла не принадлежит самой игре (пак правит город) — по оглавлению
 *     игры игрока, а не по списку из поставки;
 *   • модель без группы шейдеров не едет: такая «пустышка» роняет GTA
 *     (дамп 03.10.2026, `unsafeDrawables`);
 *   • одно и то же имя в двух интерьерах — только если файлы одинаковы.
 * Дальше манифест проходит строгую проверку доверия
 * (`project-interiors-manifest-trust.js`), которую повторяет движок при
 * установке.
 *
 * Установка в игру не проверена на живой GTA V: Astral собрал ровно то, что
 * поставил бы мод этого пака; как игра примет контейнер, видно только в игре.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { readDrawable } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { shineDrawable } from "@modovik/ypt";
import { inspectProfile } from "@modovik/install-engine";
import { rpf7Room } from "@modovik/install-engine/rpf-limits.js";
import { PROJECT_IDS, PROJECT_SURFACE_IDS, installedInteriors, interiorLookOf, normalizeProjectInteriors, shopShine } from "@modovik/climb-contract/recolor/project-interiors";
import {
  PROJECT_INTERIORS_MAX_FILE_BYTES,
  PROJECT_INTERIORS_MAX_FILES,
  PROJECT_INTERIORS_MAX_TOTAL_BYTES,
  PROJECT_INTERIORS_MAX_UNITS,
  PROJECT_INTERIOR_MANIFEST_FILE,
  buildProjectInteriorsManifest,
  isLocalProjectInteriorsManifest,
  isProjectInteriorFileName,
  isProjectInteriorsModId,
  projectInteriorContainer,
} from "@modovik/install-engine/project-interiors-manifest-trust.js";
import { archiveKeysDirectory, provisionArchiveSupport } from "../loader-provisioner.js";
import { writePackageFiles } from "../package-files.js";
import { unsafeDrawables } from "../recolor-arenas.js";
import { bakeFile, inflateRaw } from "../recolor-sheets.js";
import { shopInteriorOp } from "../recolor-shops.js";
import { findUnit, readCatalog } from "./catalog.js";
import { lazyFolderReader } from "./file-source.js";
import { openGameNames } from "./game-names.js";
import { readProjectSurfaceSheets } from "./scene.js";
import { readSources, unitRoot } from "./store.js";

/* Где интерьер лежит в игре — для строки в окне; настоящие имена — по номеру. */
export const PROJECT_INTERIORS_CONTAINER_LABEL = "x64/astral/astral_proj_<номер>.rpf";

const KEEP_PACKAGES = 2;
const MODEL = /\.(ydr|ydd|yft)$/i;
const BAKED = /\.(ytd|ydr|ydd|yft)$/i;
const MB = 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baseOf = (file) => file.slice(file.lastIndexOf("/") + 1);
const stemOf = (name) => name.replace(/\.[^.]+$/, "");
const megabytes = (bytes) => Math.max(1, Math.round(bytes / MB));
const fill = (template, ...values) => template.replace(/\{(\d+)\}/g, (_, slot) => String(values[Number(slot)] ?? ""));

/* Слова отказов: шаблоны с `{n}` есть в словаре окна (`zone-projects1710b.js`), и слой перевода разметки переводит их на экране. */
export const PROJECT_INTERIORS_REFUSALS = Object.freeze({
  nothing: "Ни один интерьер не отмечен «Поставить в игру» — ставить нечего.",
  tooMany: "За один раз ставится не больше {0} интерьеров — отметьте поменьше.",
  noGame: "Интерьеры ставятся рядом с файлами вашей игры — подключите GTA V.",
  noUnit: "Интерьера {0} нет в ваших папках — он убран из источников или файлы изменились. Откройте редактор и обновите список.",
  blocked: "Интерьер «{0}» нельзя поставить: {1}",
  noFile: "Файла «{0}» интерьера «{1}» не нашлось в вашей папке — проверьте источник.",
  notResource: "Файл «{0}» интерьера «{1}» не в формате игры — такой файл игра не откроет.",
  tooBigFile: "Файл «{0}» интерьера «{1}» слишком велик: {2} МБ.",
  inGame: "Файл «{0}» интерьера «{1}» уже есть в самой игре — пак правит файл игры, интерьер не ставится.",
  empty: "Модель «{0}» интерьера «{1}» без шейдеров уронила бы GTA — интерьер не ставится.",
  clash: "Файл «{0}» есть и в интерьере «{1}», и в «{2}», и они разные — в игре он может быть только один.",
  tooBigAll: "Интерьеры займут {0} МБ — больше предела в {1} МБ за один раз; отметьте поменьше.",
  tooManyFiles: "В отмеченных интерьерах {0} файлов — больше предела в {1} за один раз; отметьте поменьше.",
  archiveFull: "В update.rpf игры не хватает места: интерьеры займут {0} МБ, а свободно {1} МБ (сейчас архив {2} МБ, предел — {3} МБ). Снимите другие наборы Astral или отметьте меньше интерьеров.",
  trust: "Собранные интерьеры не прошли строгую проверку доверия.",
});

const refuse = (key, ...values) => new Error(fill(PROJECT_INTERIORS_REFUSALS[key], ...values));

/* Причина, по которой интерьер не предлагается, — теми же словами, что в окне (`project-interiors-text.js`). */
export const BLOCKER_WORDS = Object.freeze({
  "no-game": "Подключите GTA V: без неё нельзя проверить, чего не хватает интерьеру.",
  incomplete: "Интерьер неполный: ему чего-то не хватает.",
  "overrides-game": "Пак правит файлы самой игры (здания снаружи, штатные ресурсы) — это правка города, а не интерьера.",
  "hei-files": "В паке есть файлы сетевых районов (hei_): они ставятся отдельно.",
  "no-placement": "В паке нет карты размещения: где стоять интерьеру, неизвестно.",
  "too-big": "Интерьер слишком велик для одной установки.",
  "no-models": "В паке нет своих моделей.",
  "no-manifest": "В паке нет одного файла _manifest.ymf (или их несколько): без него игра не свяжет карту с типами.",
  "bad-names": "В паке есть файлы с именами, которые Astral не примет: пробелы, скобки или другие лишние символы.",
});

/*
 * Формат файла: ресурс RSC7 (модели, словари, коллизии, клипы, а у настоящих паков
 * и типы с картами) или метафайл PSIN (`_manifest.ymf` — у паков и у прострелов
 * Astral он PSIN, не ресурс). Всё остальное игра из контейнера не откроет.
 */
const hasMagic = (bytes, text) => bytes.length >= 16 && [...text].every((char, at) => bytes[at] === char.charCodeAt(0));
const isGameFile = (bytes, name) => hasMagic(bytes, "RSC7") || (/\.(ytyp|ymap|ymf)$/i.test(name) && hasMagic(bytes, "PSIN"));

/* ------------------------------------------------------------------ *
 * Облик → правки листов и блеск моделей
 * ------------------------------------------------------------------ */

/**
 * Листы поверхностей всех помещений интерьера: `{ роль: [{ at, name }] }`,
 * лист — по разу (в первой роли, под которой его видит кадр).
 */
export function mergeSurfaceSheets(list) {
  const out = Object.fromEntries(PROJECT_SURFACE_IDS.map((id) => [id, []]));
  const seen = new Set();
  for (const sheets of list)
    for (const role of PROJECT_SURFACE_IDS)
      for (const sheet of sheets?.[role] || []) {
        const key = `${sheet.at.toLowerCase()}|${sheet.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out[role].push(sheet);
      }
  return out;
}

/**
 * Что делать с файлами интерьера по облику: `bake` — имя файла строчными →
 * `Map` лист → правка; `levels` — лист → уровень блеска шейдеров; `count` —
 * сколько листов красится. `paths` — имена файлов интерьера строчными.
 */
export function planLook(look, sheets, paths) {
  const bake = new Map();
  const levels = new Map();
  let count = 0;
  for (const role of PROJECT_SURFACE_IDS) {
    const surface = look.surfaces[role];
    const op = shopInteriorOp(surface);
    if (!op) continue;
    const shine = shopShine(surface.shine);
    for (const sheet of sheets?.[role] || []) {
      const name = sheet.name.toLowerCase();
      const file = baseOf(sheet.at).toLowerCase();
      /* Лист в двух копиях — обычной и HD (`+hi`, `+hidr`): игра берёт HD вблизи, без неё правка пропала бы у стены. */
      const stem = stemOf(file);
      const targets = [file, ...[`${stem}+hi.ytd`, `${stem}+hidr.ytd`].filter((candidate) => paths.has(candidate))];
      for (const target of targets) {
        if (!bake.has(target)) bake.set(target, new Map());
        if (!bake.get(target).has(name)) {
          bake.get(target).set(name, op);
          count += 1;
        }
      }
      if (shine.shader && !levels.has(name)) levels.set(name, shine.id);
    }
  }
  return { bake, levels, count };
}

/**
 * Правка по самим листам («Интерьеры Majestic RP», инструмент «Листы», ТЗ 29.10.2026-e): `looks` — `Map` имя листа строчными → облик листа
 * (`{ mode, colour }`), `sheets` — листы поверхностей помещений интерьера (`mergeSurfaceSheets`), `paths` — имена файлов интерьера строчными.
 * Возвращает `{ bake, count }`: `bake` — имя файла строчными → `Map` лист → облик. Лист ищется там же, где `planLook` ищет листы поверхностей (это
 * листы из файлов самого интерьера, их и красит установщик), вместе с HD-копиями; лист штатной вещи игры сюда не попадает.
 */
export function planSheets(looks, sheets, paths) {
  const bake = new Map();
  let count = 0;
  if (!looks?.size) return { bake, count };
  for (const role of PROJECT_SURFACE_IDS)
    for (const sheet of sheets?.[role] || []) {
      const name = sheet.name.toLowerCase();
      const look = looks.get(name);
      if (!look) continue;
      const file = baseOf(sheet.at).toLowerCase();
      const stem = stemOf(file);
      for (const target of [file, ...[`${stem}+hi.ytd`, `${stem}+hidr.ytd`].filter((candidate) => paths.has(candidate))]) {
        if (!bake.has(target)) bake.set(target, new Map());
        if (!bake.get(target).has(name)) {
          bake.get(target).set(name, look);
          count += 1;
        }
      }
    }
  return { bake, count };
}

/* Блеск модели по уровням: тот же порядок, что у «Интерьеров» магазинов (`shineByLevels`). */
export function shineModel(bytes, levels) {
  let materials = [];
  try {
    materials = readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw, kind: "ydr" }).drawables[0]?.materials || [];
  } catch {
    return { bytes, shined: 0 };
  }
  const byLevel = new Map();
  materials.forEach((material, index) => {
    const level = levels.get(String(material?.textures?.diffuse || "").toLowerCase());
    if (level) byLevel.set(level, [...(byLevel.get(level) || []), index]);
  });
  let current = bytes;
  let shined = 0;
  for (const [level, shaders] of byLevel) {
    const values = shopShine(level).shader;
    if (!values || !shaders.length) continue;
    /* Модель с необычной группой шейдеров (`Группа шейдеров заявляет слишком много шейдеров`) блеск не берёт: остаётся как есть, а не роняет установку. */
    let done;
    try {
      done = shineDrawable(current, { shaders, ...values });
    } catch {
      continue;
    }
    current = done.bytes;
    shined += done.shaders.length;
  }
  return { bytes: current, shined };
}

/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

/** Файлы интерьера для установки: имя строчными → путь в источнике (свои файлы раньше общих; чужие `.ymf` не едут). */
export function installList(unit) {
  const pick = new Map();
  for (const file of [...unit.internal.files, ...unit.internal.shared]) {
    const name = baseOf(file).toLowerCase();
    if (name.endsWith(".ymf") && name !== PROJECT_INTERIOR_MANIFEST_FILE) continue;
    if (!pick.has(name)) pick.set(name, file);
  }
  return pick;
}

/**
 * Сколько байт занимают в update.rpf игры стоящие интерьеры проектов: установка
 * заменяет прежний набор, и его место освободится. Размер берётся с файлов
 * хранилища движка, на которые смотрят верхние слои записей контейнеров
 * `astral_proj_<номер>.rpf`; нечитаемое считается нулём (запас в этом случае
 * не растёт — отказ выйдет осторожнее, не мягче).
 */
export async function installedProjectInteriorsBytes({ readState, stateDir, targetId }) {
  if (!targetId) return 0;
  const state = await readState({ stateDir });
  const entries = state?.targets?.[targetId]?.archives?.["update/update.rpf"]?.entries || {};
  let bytes = 0;
  for (const [entry, record] of Object.entries(entries)) {
    if (!/^x64\/astral\/astral_proj_[0-9a-f]{8}\.rpf\//.test(entry)) continue;
    const top = record?.layers?.at(-1);
    if (!top?.cachePath || !isProjectInteriorsModId(top.modId)) continue;
    bytes += (await fs.stat(top.cachePath).catch(() => null))?.size || 0;
  }
  return bytes;
}

/* Что подменяют тесты: чтение игры и папок, листы кадра, правка листов и блеска, сторож пустышек, размер архива игры и состояние движка. */
const defaultTools = () => ({
  readState: inspectProfile,
  archiveSize: async (root) => (await fs.stat(path.join(root, "update", "update.rpf")).catch(() => null))?.size ?? null,
  archiveSupport: provisionArchiveSupport,
  openGameNames,
  openReader: (root, keys) => lazyFolderReader(root, { keys }),
  surfaceSheets: readProjectSurfaceSheets,
  bake: bakeFile,
  shine: shineModel,
  unsafe: unsafeDrawables,
});

/* Свежий каталог проектов, где есть источники, и интерьер по номеру. */
export async function locateUnits(ids, stateDir, gameRoot, tools) {
  const sources = await readSources(stateDir);
  const projects = PROJECT_IDS.filter((project) => sources.some((item) => item.project === project));
  for (const project of projects) await readCatalog({ project, gameRoot }, stateDir, { openGameNames: tools.openGameNames, archiveSupport: tools.archiveSupport, ...(tools.catalog || {}) });
  const found = new Map();
  for (const id of ids)
    for (const project of projects) {
      const unit = await findUnit(project, id, stateDir);
      if (unit && (!found.has(id) || (unit.install?.offered && !found.get(id).unit.install?.offered))) found.set(id, { unit, project });
    }
  return { found, sources };
}

async function pruneOldPackages(directory, current) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(directory, entry.name);
    if (full === current) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat) packages.push({ full, time: stat.mtimeMs });
  }
  packages.sort((a, b) => b.time - a.time);
  for (const stale of packages.slice(KEEP_PACKAGES - 1)) await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}

/**
 * Пакет установки из работы «Интерьеры проектов». `input` — работа
 * (`{ interiors: { <номер>: { install, surfaces } } }`), `gameRoot` — папка
 * GTA V Legacy. Возвращает `{ setId, manifest, packageRoot, project,
 * payloadFiles, summary }` — то, что ждёт служба наборов
 * (`recolor-customizer.js`).
 */
export async function buildProjectInteriorsPackage(input, stateDir, { gameRoot = "", onProgress = null, tools: overrides = {}, keys: suppliedKeys = null, targetId = "" } = {}) {
  const tools = { ...defaultTools(), ...overrides };
  const project = normalizeProjectInteriors(input);
  const ids = installedInteriors(project).sort();
  if (!ids.length) throw refuse("nothing");
  if (ids.length > PROJECT_INTERIORS_MAX_UNITS) throw refuse("tooMany", PROJECT_INTERIORS_MAX_UNITS);
  const root = String(gameRoot || "").trim();
  if (!root || !path.isAbsolute(root)) throw refuse("noGame");

  const keysDirectory = await archiveKeysDirectory({ keys: suppliedKeys, stateDir, provision: tools.archiveSupport });
  const keys = keysDirectory ? await keysFromDirectory(keysDirectory).catch(() => null) : null;
  const directory = path.join(stateDir, "project-interiors");
  const game = await tools.openGameNames(root, { keys, cacheFile: path.join(directory, "game-names.json") }).catch(() => null);
  if (!game) throw refuse("noGame");

  const { found, sources } = await locateUnits(ids, stateDir, root, tools);
  const plan = [];
  for (const id of ids) {
    const entry = found.get(id);
    if (!entry) throw refuse("noUnit", id);
    const { unit } = entry;
    if (!unit.install?.offered) throw refuse("blocked", unit.label, (unit.install?.blockers || []).map((code) => BLOCKER_WORDS[code] || code).join(", "));
    const source = sources.find((item) => item.id === unit.internal.sourceId);
    if (!source) throw refuse("noUnit", id);
    plan.push({ id, unit, source, project: entry.project });
  }
  const totalFiles = plan.reduce((sum, item) => sum + installList(item.unit).size, 0);
  if (totalFiles > PROJECT_INTERIORS_MAX_FILES) throw refuse("tooManyFiles", totalFiles, PROJECT_INTERIORS_MAX_FILES);

  /*
   * Место в update.rpf (предел RPF7 — `rpf-limits.js`) проверяется ДО чтения файлов и до пересборки
   * архива: узнать на пересборке, спустя минуты, что 4 ГБ мало, — худшее, что можно сделать с
   * человеком. Первая сверка — по размерам собственных файлов интерьеров (меньше они занять не
   * могут), вторая, после сборки, — по байтам пакета. Прежний набор интерьеров заменяется, его место
   * освободится. Нет файла архива — молчим: отказ скажет сама установка.
   */
  const archiveBytes = await tools.archiveSize(root);
  const released = archiveBytes === null ? 0 : await installedProjectInteriorsBytes({ readState: tools.readState, stateDir, targetId }).catch(() => 0);
  const assertRoom = (wantedBytes) => {
    if (archiveBytes === null) return;
    const room = rpf7Room({ archiveBytes, releasedBytes: released, wantedBytes });
    if (!room.fits) throw refuse("archiveFull", Math.ceil(wantedBytes / MB), Math.floor(room.freeBytes / MB), Math.ceil(room.archiveBytes / MB), Math.floor(room.limitBytes / MB));
  };
  assertRoom(plan.reduce((sum, item) => sum + (item.unit.files?.bytes || 0), 0));

  const temporary = path.join(directory, "packages", `build-${randomUUID()}`);
  const readers = new Map();
  /* Читатель — по корню файлов интерьера: у пака с CDN Astral это папка самого пака, а не весь источник. */
  const readerOf = (source, unit) => {
    const root = unitRoot(unit, source);
    if (!readers.has(root)) readers.set(root, tools.openReader(root, keys));
    return readers.get(root);
  };
  try {
    /* Имя файла в игре одно: кто занял его первым, у того он и лежит; тот же файл у второго интерьера не повторяется. */
    const claimed = new Map();
    const units = [];
    const summary = [];
    let total = 0;
    let done = 0;
    for (const item of plan) {
      const { unit, id } = item;
      const list = installList(unit);
      const look = interiorLookOf(project, id);
      /* Листы поверхностей — из кадра интерьера: тот же разбор, что красит предпросмотр. */
      const sheetSets = [];
      const wantsLook = PROJECT_SURFACE_IDS.some((role) => look.surfaces[role].mode !== "standard" || look.surfaces[role].shine !== "game");
      if (wantsLook)
        for (const mlo of unit.mlo) {
          const answer = await tools.surfaceSheets({ project: item.project, id, mlo: (mlo.hash >>> 0).toString(16).padStart(8, "0"), gameRoot: root }, stateDir, { ...(tools.scene || {}) });
          if (answer.sheets) sheetSets.push(answer.sheets);
        }
      const applied = planLook(look, mergeSurfaceSheets(sheetSets), new Set(list.keys()));
      const reader = await readerOf(item.source, item.unit);
      const files = [];
      let bytesOfUnit = 0;
      let shined = 0;
      let painted = 0;

      for (const [name, at] of [...list].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        onProgress?.({ step: "project-interiors", done, total: totalFiles });
        done += 1;
        if (name !== PROJECT_INTERIOR_MANIFEST_FILE && game.hasName(name)) throw refuse("inGame", name, unit.label);
        if (!isProjectInteriorFileName(name)) throw refuse("blocked", unit.label, BLOCKER_WORDS["bad-names"]);
        let bytes = await reader.read(at).catch(() => null);
        if (!bytes) throw refuse("noFile", name, unit.label);
        if (!isGameFile(bytes, name)) throw refuse("notResource", name, unit.label);
        if (bytes.length > PROJECT_INTERIORS_MAX_FILE_BYTES) throw refuse("tooBigFile", name, unit.label, megabytes(bytes.length));

        if (MODEL.test(name) && tools.unsafe([{ name, bytes }]).length) throw refuse("empty", name, unit.label);
        if (/\.ydr$/i.test(name) && applied.levels.size) {
          const lit = tools.shine(bytes, applied.levels);
          bytes = lit.bytes;
          shined += lit.shined;
        }
        const ops = applied.bake.get(name);
        if (ops && BAKED.test(name)) {
          const baked = await tools.bake(bytes, name, (texture) => ops.get(texture) || null, { images: {} });
          if (baked.textures.length) {
            bytes = baked.bytes;
            painted += baked.textures.length;
          }
        }
        const digest = sha256(bytes);
        if (name !== PROJECT_INTERIOR_MANIFEST_FILE) {
          const owner = claimed.get(name);
          if (owner) {
            if (owner.sha256 !== digest) throw refuse("clash", name, owner.label, unit.label);
            continue;
          }
          claimed.set(name, { sha256: digest, label: unit.label });
        }
        total += bytes.length;
        if (total > PROJECT_INTERIORS_MAX_TOTAL_BYTES) throw refuse("tooBigAll", megabytes(total), megabytes(PROJECT_INTERIORS_MAX_TOTAL_BYTES));
        await writePackageFiles([{ target: path.join(temporary, "payload", id, name), bytes, sha256: digest }]);
        files.push({ name, size: bytes.length, sha256: digest });
        bytesOfUnit += bytes.length;
      }
      units.push({ id, files });
      summary.push({ id, label: unit.label, project: item.project, files: files.length, bytes: bytesOfUnit, sheets: painted, shined, container: projectInteriorContainer(id) });
    }

    assertRoom(total);
    const manifest = buildProjectInteriorsManifest(units);
    if (!isLocalProjectInteriorsManifest(manifest, "Legacy")) throw refuse("trust");
    const packageRoot = path.join(directory, "packages", manifest.projectInteriors.sourceDigest.slice("sha256:".length, "sha256:".length + 16));
    await fs.rm(packageRoot, { recursive: true, force: true });
    await fs.rename(temporary, packageRoot);
    await pruneOldPackages(path.dirname(packageRoot), packageRoot);
    return {
      setId: "projectinteriors",
      manifest,
      packageRoot,
      project,
      payloadFiles: manifest.files.map((file) => ({ name: file.source.slice("payload/".length), sha256: file.sha256 })),
      summary: {
        interiors: summary,
        interiorCount: summary.length,
        bytes: total,
        painted: summary.reduce((sum, item) => sum + item.sheets, 0),
        shined: summary.reduce((sum, item) => sum + item.shined, 0),
      },
    };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    for (const reader of readers.values()) await (await reader)?.close?.().catch(() => {});
  }
}
