import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import * as fsp from "node:fs/promises";
import * as gfx from "@modovik/gfx";
import * as drawableLib from "@modovik/rage-drawable";
import * as ddsLib from "@modovik/dds";
import * as yptLib from "@modovik/ypt";
import * as reticleCover from "@modovik/reticle-pack/workshop-cover";
import * as vectorMap from "@modovik/vector-map";
import * as rpfNode from "@modovik/rpf7/node";
import * as vegetation from "@modovik/climb-contract/recolor/vegetation";
import * as fingerprints from "@modovik/rpf-inspector/place-fingerprints";
import * as fastEntry from "@modovik/rpf-inspector/fast-entry";
import * as optimizationCover from "./optimization-cover.js";
import * as climbCover from "./climb-cover.js";
import * as zoneShapes from "./zone-footprints.js";
import * as placeScene from "./mod-place-scene.js";
import * as scheduleCover from "./schedule-cover.js";
import * as zoneOutlines from "./zone-outlines-cover.js";
import * as painters from "./part-cover-painters.js";
import * as mapPlaces from "./map-places.js";
import * as readHost from "./game-read-host.js";
import * as arenaBlank from "./arena-blank.js";
import * as hallModule from "./arena-hall-cover.js";
import * as modelSceneApi from "./mod-model-scene.js";
import * as coverInset from "./part-cover-inset.js";
import * as hangarProps from "./hangar-stock-props.js";
import * as isolation from "./place-isolation.js";
import * as mapEntities from "./map-entities-append.js";
import * as stockBuilding from "./stock-building.js";
import * as textureSheet from "./texture-sheet-cover.js";
import * as skyObjects from "./sky-objects-cover.js";
import { positionCaption } from "./minimap-position-cover.js";
import { emptyModelCover } from "./empty-model-cover.js";
import * as waterTextures from "./water-textures-cover.js";
import * as mapCard from "./map-card-cover.js";
import * as hudColours from "./hudcolor-cover.js";
import * as ownModels from "./own-model-cover.js";
import * as modelLights from "./model-lights.js";
import * as fontCovers from "./font-cover.js";
import * as cloudCovers from "./cloud-cover.js";
import { gameSourceMissing, keepMissing, missingArchiveLabel, readFirstPlace } from "./game-source-missing.js";
import { PROP_EXTENT, overviewOf, usableModel } from "./model-cover-plan.js";
import * as interiorsMeta from "./project-interiors/meta.js";

// Обложки частей редукса: выбор файлов вида, сцены мастерской, склейка кадров.

// Файлы мода и игры: ресурсы GTA, карты размещения.
const GAME_RESOURCES = /\.(ytd|ydr|yft|ydd)$/i;
const YMAP_FILE = /\.ymap$/i;
/* Интерьер редукса без карты: комната — модели, словари и типы автора (`redux-interior-cover.js`); карта `.ymap` — прежний вид «интерьеры». */
const INTERIOR_ROOM_FILES = /\.(ydr|yft|ydd|ytd|ytyp)$/i;

export const PART_COVER_FILES = Object.freeze(
  Object.fromEntries([
    ["reticle", /^hud_reticle\.gfx$/i],
    ["large-map", /^minimap(_sea)?_\d+_\d+\.ytd$/i],
    ["large-map-vector", /^([^/\\]+\.ydd|geometry\.apg1)$/i],
    ["tracers", /^(core\.ypt|tracer\.dds|tracer-work\.code|ptfx_bullet_tr?acer[a-z0-9_]*\.dds)$/i],
    ["large-map-zoom", /^mapzoomdata\.meta$/i],
    ["sounds", /\.(awc|rel)$/i],
    ["timecycle", /^(w_[a-z0-9_]+\.xml|timecycle_mods_\d+\.xml|visualsettings\.dat)$/i],
    ["kill-effects", /^(timecycle_mods_\d+\.xml|visualsettings\.dat)$/i],
    ["minimap", /^minimap\.gfx$/i],
    ["minimap-position", /^frontend\.xml$/i],
    /* Быстрый вход: цифры самого файла автора (пролёт камеры, ожидание) — «было → стало». */
    ["fast-entry", /^playerswitch\.meta$/i],
    ["water", /^water\.xml$/i],
    /* Цвета интерфейса: таблица автора, обложка — изменённые цвета парами «в игре → у автора» (`hudcolor-cover.js`). */
    ["hudcolor", /^hudcolor\.dat$/i],
    ["grass", /_grass_\d+\.ymap$/i],
    ["mapping", YMAP_FILE],
    /* «МСЛ-зоны» редукса: обложка — плитка мастерской, файлы автора окну не нужны; манифест контейнера — лишь знак, что пакет на месте. */
    ["msl-zones", /^_manifest\.ymf$/i],
    ["blood-routing", /^(bloodfx-routing\.json|bloodfx-base\.dat)$/i],
    ["core-effects", /^(core-merge\.json|rules\.json|clip-rows\.json|clip-grids\.json|own-export\.json|[a-z0-9_.-]+\.dds)$/i],
    ["interiors", /\.(ymap|ydr|yft|ydd|ytd|ytyp)$/i],
    /* `.ycd` — клипы экранов зала (`clip@…`): по ним экран показывает первый кадр клипа, а не лист-раскладку кадров целиком. */
    ["arenas", /\.(ytd|ydr|yft|ydd|ytyp|ycd)$/i],
    /* Метки залазов: своё имя, имя с приставкой автора (`kifin_arrow.ydr`) и словари текстур набора — метка без своих листов красится из словаря рядом. */
    ["climbs", /^(([a-z0-9]+[_-])*(arrow|stay|jump|firstpov|thirdpov|rightclick|car|teamneed|hit|q)\.ydr|[^/\\]+\.(ymap|ytd))$/i],
    ["zones", /\.(ydr|ymap|ytd)$/i],
    ["schedule", scheduleCover.SCHEDULE_MODEL],
    ["hangar", GAME_RESOURCES],
    ["roads-layer", GAME_RESOURCES],
    ["trees", GAME_RESOURCES],
    ["terrain", GAME_RESOURCES],
    ["vegetation-world", GAME_RESOURCES],
    /* Фонари редукса: свои модели автора (`lanterns.rpf`) со своими листами — обложка снимает их как модели (`own-model-cover.js`). */
    ["lanterns", GAME_RESOURCES],
    /* Шрифт редукса: библиотека шрифтов Scaleform автора; обложка — образцы, набранные её глифами (`font-cover.js`). */
    ["font", /^font_lib[a-z0-9_]*\.gfx$/i],
    /* Облака редукса: словари облачных шапок (`cloudhat_*.ytd`); обложка — листы плотности из них (`cloud-cover.js`). Вид выбирает этап обложек по слоту описи (`drawingKindOf`). */
    ["clouds", /\.(?:ytd|ydr)$/i],
  ]),
);

export const SCENE_COVERS = Object.freeze(
  Object.fromEntries([
    ["mapping", ["megamall"]],
    ["hangar", ["hangar"]],
    ["roads-layer", ["roads"]],
    ["trees", ["oak"]],
    ["terrain", ["terrain"]],
    ["vegetation-world", ["terrain", "oak", "bush", "hedge"]],
  ]),
);

export const MINIMAP_RADAR_FILE = "radar.apg1";
export const SCENE_COVER_FILES = GAME_RESOURCES;
export const WORK_CODE_FILE = "tracer-work.code";
export const PART_COVER_CAPTION = "";

// Размеры, пределы и доли.
const SEAM = 6;
const ARENA_MIN_SHEETS = 8;
const STRIP_TRIES = 3;
const SPECIES_MODELS = 4;
const OWN_MODELS = 6;
const STUB_TRIANGLES = 4;
const MIN_ZONES = 3;
const BARE_SHARE = 0.05;

// Тексты, цвета и признаки.
const NO_FRAME = "Окно снимков ответило без кадра — повторите отрисовку.";
const CLIP_FAILED = "ролик не вышел";
const SEAM_COLOUR = "#0c0c0c";
const ODD_MODEL = /fallen|stump|log|dead|burnt|lod|wint|snow|autumn/i;
const LOW_DETAIL = /(^|[_.])(l\d|hi)($|[_.])/;
const NEXT = Symbol("next");

// Наборы видов и пород.
const NEUTRAL_SPECIES = new Set(["bush", "plant", "tree"]);
const STRIP_SCENES = new Set(["vegetation-world"]);
const SPLIT_SCENES = new Set(["terrain"]);
const SCENE_KINDS = new Set(Object.keys(SCENE_COVERS));
const WINDOW_KINDS = new Set(["timecycle", "kill-effects", "minimap", "minimap-position", "water", "blood-routing", "core-effects", "msl-zones"]);
const ARENA_SERVERS = ["gta5rp", "majestic"];

/* Подписи кадров галереи арены из архивов двух серверов (VEX REDUX, 15.11.2026): у каждого кадра сказано, чей это зал. Переводы — `locales/ui-text/zone-empty-model-1411.js`. */
export const ARENA_SERVER_CAPTION = Object.freeze({ majestic: "Арена Majestic", gta5rp: "Арена GTA 5 RP" });
/* Сколько своих файлов сервера должно быть в наборе, чтобы зал этого сервера считался присутствующим (общий квартал и штатные файлы не в счёт). */
const ARENA_SECOND_MIN = 5;

/** Второй сервер арены автора из архивов двух серверов: чьих файлов не меньше ARENA_SECOND_MIN, кроме `server`; иначе `null`. */
export function otherArenaServer(names, server) {
  const counts = new Map();
  for (const name of names || []) {
    const owner = fingerprints.arenaFileOwner(name);
    if (ARENA_SERVERS.includes(owner)) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return ARENA_SERVERS.find((other) => other !== server && (counts.get(other) ?? 0) >= ARENA_SECOND_MIN) ?? null;
}

// Где лежат листы потока и сцены мастерской.
const SHEETS_HREF = new URL("./part-sheets.js", import.meta.url).href;
const SCENE_DIR = new URL("../../web/public/assets/workshop/", import.meta.url);
const encoder = new TextEncoder();

function debug(...parts) {
  if (!process.env.ASTRAL_COVER_DEBUG) return;
  console.error("[cover]", ...parts);
}

export function partCoverCaption(_kind, _options = {}) {
  return PART_COVER_CAPTION;
}

// ---------------------------------------------------------------- чистые помощники

const lowered = (entry) => String(entry.texture || "").toLowerCase();

// Сколько различных листов из списка есть у мода.
function hitsIn(textures, mod) {
  const distinct = Array.from(new Set(textures.map(lowered)));
  return { distinct, hits: distinct.filter((texture) => mod.has(texture)).length };
}

export function sceneMatches(need, mod) {
  const { distinct, hits } = hitsIn(need, mod);
  return hits >= Math.max(2, Math.ceil(0.1 * distinct.length)) ? hits : 0;
}

const folderOf = (at) => {
  const text = String(at || "");
  return text.includes("/") ? text.slice(0, text.lastIndexOf("/")) : null;
};
const oddness = (model) => (ODD_MODEL.test(model.name) ? 1 : 0);
const isModelFile = (entry) => /\.ydr$/i.test(String(entry));

// Строки по ключу: Map «ключ -> строки»; порядок ключей — по первому появлению.
function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return groups;
}

// Значения групп, собранные заново: Map «ключ -> результат».
const mapGroups = (groups, make) => new Map(Array.from(groups, ([key, rows]) => [key, make(rows)]));

// Запись предмета описи: порода, число его листьев у мода, листья с владельцем и пригодность как модели.
function itemRecord(item, species, mod) {
  const present = (item.leaves || []).map((text) => String(text).toLowerCase()).filter((leaf) => mod.has(leaf));
  const owned = present
    .map((leaf) => {
      const found = vegetation.vegetationSpeciesOf(leaf);
      return { leaf, owner: NEUTRAL_SPECIES.has(found) ? species : found };
    })
    .filter(({ owner }) => !NEUTRAL_SPECIES.has(owner))
    .map(({ leaf, owner }) => ({ leaf, owner, folder: folderOf(item.at) }));
  const fitsName = /\.ydr$/i.test(String(item.name || ""));
  return { item, species, hits: present.length, owned, asModel: !NEUTRAL_SPECIES.has(species) && fitsName && Boolean(item.at) };
}

// Порода -> модели игры, у которых есть листья мода. Порядок строится по таблице моделей.
export function speciesModels(trees = [], mod = new Set(), names = []) {
  const records = [...trees].flatMap((item) => {
    const species = String(item?.species || "");
    return species ? [itemRecord(item, species, mod)] : [];
  });
  const owned = records.flatMap((record) => record.owned);
  const leafSets = mapGroups(groupBy(owned, (row) => row.owner), (rows) => new Set(rows.map((row) => row.leaf)));
  const foldersByOwner = groupBy(owned.filter((row) => row.folder !== null), (row) => row.owner);
  const folderLists = mapGroups(foldersByOwner, (rows) => [...new Set(rows.map((row) => row.folder))]);
  const modelRecords = groupBy(records.filter((record) => record.asModel), (record) => record.species);
  const ownModels = mapGroups(modelRecords, (rows) => rows.map((record) => record.item));
  const viaNames = Array.from(folderLists)
    .filter(([species]) => ownModels.has(species) === false)
    .map(([species, dirs]) => {
      const fits = names.filter((entry) => isModelFile(entry) && vegetation.vegetationSpeciesOf(String(entry)) === species);
      return [species, dirs.flatMap((dir) => fits.map((entry) => ({ name: entry, at: `${dir}/${entry}` })))];
    });
  const hitsOf = new Map(records.map((record) => [record.item, record.hits]));
  const byRank = (a, b) => oddness(a) - oddness(b) || (hitsOf.get(b) || 0) - (hitsOf.get(a) || 0);
  const eligible = [...ownModels, ...viaNames].filter(([species, list]) => list.length && leafSets.has(species));
  const bySize = eligible.sort(([one], [two]) => leafSets.get(two).size - leafSets.get(one).size);
  return bySize.map(([species, list]) => ({ species, models: [...list].sort(byRank).slice(0, SPECIES_MODELS) }));
}

const sceneCandidates = (found) => found.map(({ scene }) => ({ scene }));

// Дерево: порода oak заменяется дубовыми сценами (если они есть), остальные — своими моделями.
function treeCandidates(oakScenes, species) {
  const stock = species.flatMap((item) =>
    item.species === "oak" && oakScenes.length ? sceneCandidates(oakScenes) : item.models.map((model) => ({ model })),
  );
  const missingOak = oakScenes.length > 0 && !species.some((item) => item.species === "oak");
  return missingOak ? [...stock, ...sceneCandidates(oakScenes.slice(0, 1))] : stock;
}

// Группы по порядку: какие сцены берёт группа и чем собирает кандидатов.
const GROUP_PLAN = [
  { group: "terrain", scenes: ["terrain"], build: sceneCandidates },
  { group: "tree", scenes: ["oak"], build: treeCandidates },
  { group: "bush", scenes: ["bush", "hedge"], build: sceneCandidates },
];

export function stripGroups(matched = [], species = []) {
  return GROUP_PLAN.flatMap(({ group, scenes, build }) => {
    const ranked = matched.filter((probe) => scenes.includes(probe.scene)).sort((a, b) => b.hits - a.hits);
    const candidates = build(ranked, species);
    return candidates.length ? [{ group, candidates }] : [];
  });
}

export function isStubModel(bytes) {
  try {
    const { drawables } = drawableLib.readDrawable(new Uint8Array(bytes), { inflateRaw: rpfNode.inflateRawNode });
    const meshes = drawables[0]?.meshes || [];
    const triangles = meshes.reduce((sum, mesh) => sum + (mesh.indices?.length || 0) / 3, 0);
    return triangles <= STUB_TRIANGLES;
  } catch {
    return false;
  }
}

const modelCost = (name) => (name.includes("weeds_") ? 0 : name.includes("weed") ? 1 : 2);

const byCostThenName = (a, b) => modelCost(a.record.name) - modelCost(b.record.name) || a.record.name.localeCompare(b.record.name);

function* roundRobin(lanes) {
  for (let round = 0; lanes.some((lane) => lane.length > round); round += 1) {
    for (const lane of lanes) if (lane[round]) yield lane[round];
  }
}

// Модели игры по строчному имени (первая запись побеждает) и файлы мода, которые на них попадают.
function createModelShelf(trees) {
  const known = new Map();
  trees.forEach((item) => {
    const key = String(item?.name).toLowerCase();
    const fresh = /\.ydr$/i.test(item?.name) && item.at && !known.has(key);
    if (fresh) known.set(key, item);
  });

  function* claims(files) {
    for (const file of files) {
      const key = String(file?.name).toLowerCase();
      const record = known.get(key);
      if (record && !ODD_MODEL.test(key) && !LOW_DETAIL.test(key)) yield { record, file };
    }
  }

  // «tree» и «bush» -> дорожки по породам, длинные дорожки первыми.
  return {
    lanesFor(files) {
      const bySpecies = new Map();
      for (const claim of claims(files)) {
        const bucket = bySpecies.get(claim.record.species) || [];
        bySpecies.set(claim.record.species, [...bucket, claim]);
      }
      const groups = { tree: [], bush: [] };
      bySpecies.forEach((list, species) => {
        groups[NEUTRAL_SPECIES.has(species) ? "bush" : "tree"].push([...list].sort(byCostThenName));
      });
      return Object.entries(groups).map(([group, lanes]) => [group, lanes.sort((a, b) => b.length - a.length)]);
    },
  };
}

// Кандидат от своей модели мода: имя и путь, байты, признак «растение» и признак «заглушка».
function candidateOf(record, own, plant) {
  return {
    model: { name: record.name, at: record.at },
    own,
    ...(plant ? { frame: "plant" } : {}),
    ...(isStubModel(own) ? { removal: true } : {}),
  };
}

async function harvest(lanes, plant) {
  const candidates = [];
  for (const { record, file } of roundRobin(lanes)) {
    if (candidates.length >= OWN_MODELS) break;
    const raw = await bytesOf(file);
    if (raw) candidates.push(candidateOf(record, new Uint8Array(raw), plant));
  }
  return candidates;
}

export async function ownModelGroups(files = [], trees = []) {
  const shelf = createModelShelf(trees);
  const harvested = [];
  for (const [group, lanes] of shelf.lanesFor(files)) {
    harvested.push({ group, candidates: await harvest(lanes, group === "bush") });
  }
  return harvested.filter(({ candidates }) => candidates.length);
}

export function sheetSourceFromEnv(env = process.env) {
  const root = env.ASTRAL_GAME_PARTS || env.ASTRAL_GAME_ROOT || (env.ASTRAL_GAME_SHEETS ? "" : undefined);
  const keys = env.ASTRAL_RPF_KEYS;
  return root === undefined || !keys ? null : { root, keys };
}

export function pickArena(scenes, mod, names = []) {
  const scored = Object.entries(scenes).map(([server, textures]) => ({ server, hits: hitsIn(textures, mod).hits, textures }));
  const best = scored.reduce((top, row) => (!top || row.hits > top.hits ? row : top), null);
  /* Арена автора из архивов двух серверов (VEX REDUX, 15.11.2026: зал GTA 5 RP в `vex_gg.rpf` и арена Majestic в трёх `arena_mizaro*`): листов набирают оба сервера,
     и зал брался у того, чья сцена богаче листами, — у GTA 5 RP, хотя файлов Majestic в наборе больше. Зал снимается у сервера, чьих файлов больше. */
  const proven = scored.filter((row) => row.hits >= ARENA_MIN_SHEETS);
  if (proven.length > 1 && names.length) {
    const owned = (server) => names.filter((name) => fingerprints.arenaFileOwner(name) === server).length;
    const ranked = [...proven].sort((left, right) => owned(right.server) - owned(left.server) || right.hits - left.hits);
    if (owned(ranked[0].server) > owned(ranked[1].server)) return ranked[0];
  }
  if (best && best.hits >= ARENA_MIN_SHEETS) return best;
  const server = fingerprints.arenaServerOf(names);
  const known = Boolean(server) && Object.hasOwn(scenes, server);
  return known ? { server, hits: 0, textures: scenes[server] } : null;
}

// ---------------------------------------------------------------- файлы, поток чтения игры, окно

const bytesOf = async (file) => file.bytes ?? (typeof file.read === "function" ? await file.read() : null);
const named = (files, pattern) => files.filter((file) => pattern.test(String(file?.name || "")));

const withBytes = (file, raw) => ({ name: file.name, bytes: new Uint8Array(raw) });

async function takeBytes(file) {
  const raw = await bytesOf(file);
  return raw ? withBytes(file, raw) : null;
}

// Файлы списка, прочитанные по очереди; пустые чтения отбрасываются.
async function collectBytes(list) {
  const taken = [];
  for (const entry of list) taken.push(await takeBytes(entry));
  return taken.filter(Boolean);
}

// Свои файлы вида: подходящие по имени.
const pickOwn = (pattern, files) => collectBytes(named(files, pattern));

// Мягкое чтение: сбой чтения и пустые байты просто пропускают файл.
async function softFiles(chosen) {
  const raws = [];
  for (const file of chosen) raws.push(await bytesOf(file).catch(() => null));
  return raws.flatMap((raw, at) => (raw?.length ? [withBytes(chosen[at], raw)] : []));
}

// Чтение байтов файла игры по пути в архиве.
const gameBytesReader = (source) => (at) => sheetsThread("gameBytesOf", { root: source.root, keysDirectory: source.keys, at });

function sheetsThread(method, request) {
  return readHost.gameReadHostFor(SHEETS_HREF, null).callWithTools(method, [request], null, { transfer: true });
}

const jsonFile = (name, value) => ({ name, bytes: encoder.encode(JSON.stringify(value)) });
const sheetFiles = (sheets) => sheets.map(({ key, bytes }) => ({ name: key, bytes }));
const frameOf = (shot) => (shot?.png?.length ? shot.png : null);

// Запрос обычного вида: kind, partKind, files, name и флаги [ключ, включён, значение] по порядку.
function plainRequest(partKind, files, name, flags = []) {
  const extras = flags.filter(([, on]) => on).map(([key, , value]) => [key, value]);
  return { kind: "redux-part", partKind, files, name, ...Object.fromEntries(extras) };
}

// Ответ окна по общему правилу: кадр, «рисовать нечего» либо отказ.
function verdictOf(shot) {
  const hasFrame = Boolean(shot?.png?.length);
  if (!hasFrame && shot?.reason !== "nothing") throw new Error(NO_FRAME);
  if (hasFrame) return shot;
  if (shot.fxReason) return { png: null, fxReason: shot.fxReason };
  if (!shot.refused) return null;
  return { png: null, refused: shot.refused, rules: shot.rules || [] };
}

async function consult(render, partKind, files, name, flags) {
  if (typeof render !== "function") return null;
  return verdictOf(await render(plainRequest(partKind, files, name, flags)));
}

// Окно для сцен мастерской: kind, partKind, name, files.
function makeCamera(render, name) {
  const shoot = (partKind, files) => render({ kind: "redux-part", partKind, name, files });
  return {
    shoot,
    probe: (scene) => shoot("scene", [jsonFile("scene.json", { scene, probe: true })]),
    async frame(head, bin, sheets) {
      const binFile = bin ? [{ name: "scene.bin", bytes: bin }] : [];
      const files = [jsonFile("scene.json", head), ...binFile, ...sheetFiles(sheets)];
      return frameOf(await shoot("scene", files));
    },
  };
}

async function rootsOf(textures) {
  const sets = [...new Set([...textures].map((entry) => entry.set).filter(Boolean))];
  if (!sets.length) return {};
  const { recolorResourceRoot } = await import("./recolor-customizer.js");
  const pairs = await Promise.all(sets.map(async (set) => [set, await recolorResourceRoot(set)]));
  return Object.fromEntries(pairs);
}

async function sheetRequest(textures, files, source) {
  const setRoots = await rootsOf(textures);
  return { textures, files, root: source.root, keysDirectory: source.keys, setRoots };
}

const sheetsFor = async (textures, files, source) =>
  sheetsThread("sceneSheetsOf", await sheetRequest(textures, files, source));

// Сцены мастерской рядом с приложением: zlib, "ARS1", версия, длина заголовка, JSON-заголовок.
async function workshopScene(file) {
  try {
    const raw = zlib.inflateSync(await fsp.readFile(new URL(file, SCENE_DIR)));
    return JSON.parse(raw.subarray(12, 12 + raw.readUInt32LE(8)).toString("utf8"));
  } catch {
    return null;
  }
}

async function hangarHint() {
  const scene = await workshopScene("hangar/scene.bin");
  const hint = new Map();
  try {
    scene.textures.forEach((entry) => {
      if (!entry?.game || !entry?.texture) return;
      const key = String(entry.texture).toLowerCase();
      if (key && !hint.has(key)) hint.set(key, entry.game);
    });
  } catch {
    return new Map();
  }
  return hint;
}

// Результат внутреннего рисования -> байты кадра или ответ окна.
function shapeAnswer(result, detail) {
  if (!result) return null;
  if (result instanceof Uint8Array) return detail ? { png: result } : result;
  return detail ? result : result.png;
}

// ---------------------------------------------------------------- склейка кадров (sharp)

// Композиция на фоне шва: pieces — список [вход, left], слои кладутся с top: 0.
const blankCanvas = (sharp, width, height) => sharp({ create: { width, height, channels: 4, background: SEAM_COLOUR } });

async function stitch(sharp, size, pieces) {
  const canvas = blankCanvas(sharp, size.width, size.height);
  const composed = await canvas.composite(pieces.map(([input, left]) => ({ input, left, top: 0 }))).png().toBuffer();
  return new Uint8Array(composed);
}

// Вырезки по порядку: левая берётся из «до» (растянутого до размера «после»), правая — из «после».
function* cutouts(before, after, frame, half) {
  yield { source: before, at: 0, stretch: true };
  yield { source: after, at: frame.width - half, stretch: false };
}

// Одна вырезка: левая растягивается до размера «после», правая берётся как есть.
async function cutPiece(sharp, cut, frame, half) {
  const source = sharp(cut.source);
  const shaped = cut.stretch ? source.resize(frame.width, frame.height, { fit: "fill" }) : source;
  const region = { left: cut.at, top: 0, width: half, height: frame.height };
  return [await shaped.extract(region).toBuffer(), cut.at];
}

export async function splitShots(before, after) {
  const { default: sharp } = await import("sharp");
  const frame = await sharp(after).metadata();
  const half = Math.floor((frame.width - SEAM) / 2);
  if (half <= 0) return after;
  const pieces = [];
  for (const cut of cutouts(before, after, frame, half)) pieces.push(await cutPiece(sharp, cut, frame, half));
  return stitch(sharp, frame, pieces);
}

const PROBE_SIZE = { width: 240, height: 160, fit: "fill" };
const BACKDROP_REACH = 12;
const CHANGE_REACH = 28;
const VISIBLE_SHARE = 0.06;

function* pixelOffsets(length) {
  for (let at = 0; at < length; at += 3) yield at;
}

export async function visiblyChanged(before, after) {
  const { default: sharp } = await import("sharp");
  const rawOf = (png) => sharp(png).resize({ ...PROBE_SIZE }).removeAlpha().raw().toBuffer();
  const [older, newer] = await Promise.all([rawOf(before), rawOf(after)]);
  const apart = (one, i, two, j, reach) =>
    [0, 1, 2].some((channel) => Math.abs(one[i + channel] - two[j + channel]) > reach);
  const tally = { shown: 0, moved: 0 };
  for (const at of pixelOffsets(newer.length)) {
    if (!apart(newer, at, newer, 0, BACKDROP_REACH) && !apart(older, at, newer, 0, BACKDROP_REACH)) continue;
    tally.shown += 1;
    if (apart(older, at, newer, at, CHANGE_REACH)) tally.moved += 1;
  }
  return tally.shown > 0 && tally.moved / tally.shown >= VISIBLE_SHARE;
}

// Чистое разбиение признаков на серии: подряд идущие матовые сливаются, остальные идут по одной.
const seriesOf = (flags) =>
  flags.reduce((series, flag, index) => {
    const last = series.at(-1);
    if (flag && last?.matte) last.to = index;
    else series.push({ from: index, to: index, matte: flag });
    return series;
  }, []);

async function matteParts(sharp, parts, slice, height) {
  const { isOnMatte, unbake } = await import("./cover-unbake.js");
  const { workshopMatteRgba } = await import("@modovik/gfx/workshop-matte");
  // Одно общее поле на серию, затем сами полосы серии без своего фона.
  const coverSeries = async (series) => {
    const span = series.at(-1).left + slice - series[0].left;
    const rgba = workshopMatteRgba(span, height);
    const field = await sharp(Buffer.from(rgba.buffer), { raw: { width: span, height, channels: 4 } }).png().toBuffer();
    const layers = [{ input: field, left: series[0].left, top: 0 }];
    for (const part of series) layers.push({ input: (await unbake(part.input)).png, left: part.left, top: 0 });
    return layers;
  };
  const flags = await Promise.all(parts.map((part) => isOnMatte(part.input)));
  const runs = seriesOf(flags).map(({ from, to, matte }) => ({ matte, series: parts.slice(from, to + 1) }));
  const rebuilt = [];
  for (const { matte, series } of runs) rebuilt.push(...(matte ? await coverSeries(series) : series));
  parts.splice(0, parts.length, ...rebuilt);
}

// Одна полоса, подогнанная под ширину среза.
async function fitStrip(sharp, strip, index, slice, height) {
  const fitted = sharp(strip).resize(slice, height, { fit: "cover", position: "centre" });
  return { input: await fitted.toBuffer(), left: index * (slice + SEAM), top: 0 };
}

export async function stripShots(strips, width, { seamless = false } = {}) {
  const [first] = strips;
  const { default: sharp } = await import("sharp");
  const { height } = await sharp(first).metadata();
  const slice = Math.floor((width - SEAM * (strips.length - 1)) / strips.length);
  if (!(slice > 0)) return first;
  const parts = [];
  for (const [index, strip] of strips.entries()) parts.push(await fitStrip(sharp, strip, index, slice, height));
  if (seamless) await matteParts(sharp, parts, slice, height);
  const composed = await blankCanvas(sharp, width, height).composite(parts).png().toBuffer();
  return new Uint8Array(composed);
}

// ---------------------------------------------------------------- растительность полосами

const probeHead = (scene, width, frame) => ({ scene, probe: false, width, frame });

// Один кандидат полосы: что снимать у мода и (если есть) «как в игре», как склеить и как снять итог.
class StripRun {
  constructor(camera, source, modFiles, needs) {
    Object.assign(this, { camera, source, modFiles, needs });
    this.tries = 0;
  }

  modSheets(textures) {
    return sheetsFor(textures, this.modFiles, this.source);
  }

  async stockSheets(textures) {
    const request = await sheetRequest(textures, [], this.source);
    return sheetsThread("sceneSheetsOf", request).catch(() => null);
  }

  stockBytes(at) {
    const { source } = this;
    /* Архива штатной модели в папке игры нет — отказ с его именем (сцена без игровой модели — дыра), а не «модели нет». */
    return readFirstPlace(source.root, [at], gameBytesReader(source), "штатных моделей");
  }

  shortage(label, answer) {
    debug(label, "нет листов:", answer.missing.slice(0, 6).join(", "));
    return null;
  }

  broken(label) {
    debug(label, "сцена модели не собралась");
    return null;
  }

  async sceneLane(scene) {
    const need = this.needs.get(scene);
    const mod = await this.modSheets(need);
    if (mod.missing.length) return this.shortage(scene, mod);
    this.tries += 1;
    const stock = await this.stockSheets(need);
    const head = probeHead(scene);
    const land = scene === "terrain";
    return {
      label: scene,
      mine: { head, sheets: mod.sheets },
      theirs: stock && !stock.missing.length ? { head, sheets: stock.sheets } : null,
      join: (against, shot) => splitShots(against, shot),
      final: async (width, shot) => {
        const landing = probeHead(scene, land ? undefined : width, land ? "land" : undefined);
        return (await this.camera.frame(landing, null, mod.sheets)) ?? (land ? shot : null);
      },
    };
  }

  async modelLane({ model, frame: kind }) {
    const bytes = await this.stockBytes(model.at);
    const scene = bytes ? placeScene.stockModelScene({ bytes, at: model.at }) : null;
    if (!scene) return this.broken(model.name);
    const mod = await this.modSheets(scene.textures);
    if (mod.missing.length) return this.shortage(model.name, mod);
    if (!mod.fromMod) return null;
    this.tries += 1;
    const stock = await this.stockSheets(scene.textures);
    const frame = kind || "tree";
    const mine = { head: probeHead("mod", undefined, frame), bin: scene.bytes, sheets: mod.sheets };
    const theirs = stock && !stock.missing.length ? { ...mine, sheets: stock.sheets } : null;
    return this.treeLane(model.name, frame, mine, theirs);
  }

  async ownLane(candidate) {
    const { model, own: bytes, removal } = candidate;
    const stockBytes = await this.stockBytes(model.at);
    const ownScene = placeScene.stockModelScene({ bytes, at: model.at });
    if (!ownScene) return this.broken(model.name);
    const stockScene = removal && stockBytes ? placeScene.stockModelScene({ bytes: stockBytes, at: model.at }) : null;
    if (removal && !stockScene) return null;
    const mod = await this.modSheets(ownScene.textures);
    if (mod.missing.length) return this.shortage(model.name, mod);
    this.tries += 1;
    const frame = candidate.frame || "tree";
    const head = probeHead("mod", undefined, frame);
    const mine = { head, bin: ownScene.bytes, sheets: mod.sheets };
    if (!removal) return this.treeLane(model.name, frame, mine, null);
    const stock = await this.stockSheets(stockScene.textures);
    const theirs = stock && !stock.missing.length ? { head, bin: stockScene.bytes, sheets: stock.sheets } : null;
    return this.treeLane(model.name, frame, mine, theirs);
  }

  // Дерево: слева игра, справа мод, каждое занимает половину ширины кадра.
  treeLane(label, frame, mine, theirs) {
    const side = (src, width) => this.camera.frame(probeHead("mod", width, frame), src.bin, src.sheets);
    return {
      label,
      mine,
      theirs,
      join: async (against, shot) => {
        const ruler = await rulerOf(shot);
        const pair = [];
        for (const src of [theirs, mine]) pair.push(await side(src, ruler.lane(2)));
        return pair.every(Boolean) ? stripShots(pair, ruler.width) : shot;
      },
      final: (width) => side(mine, width),
    };
  }

  skip(label, why) {
    debug(label, why);
    return null;
  }

  async settle(lane) {
    const { label, mine, theirs } = lane;
    const shot = await this.camera.frame(mine.head, mine.bin, mine.sheets);
    if (!shot) return this.skip(label, "кадра нет");
    const against = theirs ? await this.camera.frame(theirs.head, theirs.bin, theirs.sheets) : null;
    if (against && !(await visiblyChanged(against, shot))) return this.skip(label, "мод на кадре не виден");
    debug(label, "кадр взят");
    const frame = against ? await lane.join(against, shot) : shot;
    // Полос в кадре: игра | мод — две, если склейка удалась; иначе один кадр мода.
    return { frame, lanes: against && frame !== shot ? 2 : 1, final: (width) => lane.final(width, shot) };
  }

  // Какой дорожкой снимать кандидата: сцена, своя модель или модель игры.
  laneFor(candidate) {
    if (candidate.scene) return this.sceneLane(candidate.scene);
    return candidate.own ? this.ownLane(candidate) : this.modelLane(candidate);
  }

  async pick(group) {
    this.tries = 0;
    for (const candidate of group.candidates) {
      if (this.tries >= STRIP_TRIES) break;
      const lane = await this.laneFor(candidate);
      const pair = lane && (await this.settle(lane));
      if (pair) return pair;
    }
    return null;
  }

  async collect(groups) {
    const pairs = [];
    for (const group of groups) pairs.push(await this.pick(group));
    return pairs.filter(Boolean);
  }
}

// Ширина кадра и её деление на равные полосы со швом.
async function rulerOf(png) {
  const { default: sharp } = await import("sharp");
  const { width } = await sharp(png).metadata();
  return { width, lane: (count) => Math.floor((width - SEAM * (count - 1)) / count) };
}

async function joinStrips(pairs, onGallery) {
  if (pairs.length === 1) return { png: pairs[0].frame, lanes: pairs[0].lanes };
  const ruler = await rulerOf(pairs[0].frame);
  const lane = ruler.lane(pairs.length);
  const finals = [];
  for (const pair of pairs) finals.push(await pair.final(lane));
  if (!finals.every(Boolean)) return { png: pairs[0].frame, lanes: pairs[0].lanes };
  if (typeof onGallery === "function") await onGallery(pairs.map((pair) => pair.frame));
  return { png: await stripShots(finals, ruler.width), lanes: finals.length };
}

// Запасной путь: полосы из своих моделей мода.
async function collectOwn(run, files, trees) {
  const own = await ownModelGroups(files, trees);
  debug("своих моделей:", JSON.stringify(own.map((entry) => [entry.group, entry.candidates.map((c) => c.model.name)])));
  if (own.length) run.names = new Set(await sheetsThread("modNamesOf", { files: run.modFiles }));
  return run.collect(own);
}

async function stripCover({ run, matched, trees, models, modNames, files, onGallery }) {
  const stock = await run.collect(stripGroups(matched, speciesModels(trees, modNames, models)));
  const pairs = stock.length ? stock : await collectOwn(run, files, trees);
  /* Кадр полос: ворота судят середину каждой полосы (`cover-gate.js: STRIPS_MODE`), а не середину всего кадра со швом посередине. */
  const joined = pairs.length ? await joinStrips(pairs, onGallery) : null;
  return joined ? { ...joined, layout: "strips" } : null;
}

// ---------------------------------------------------------------- сцены мастерской, ангар, арена

const STOP = Symbol("stop");

// Конвейер именованных шагов над общим контекстом: шаг, вернувший STOP, обрывает работу.
async function pipe(context, steps) {
  for (const step of steps) if ((await step(context)) === STOP) break;
  return context.out ?? null;
}

// Пробы сцен по порядку: сохраняются только те, где окно назвало листы.
async function probeScenes(camera, scenes) {
  const probes = [];
  for (const scene of scenes) {
    const shot = await camera.probe(scene);
    if (shot?.need?.length) probes.push({ scene, need: shot.need });
  }
  return probes;
}

// Имена листов, которые просим у потока: сперва листы проб, затем листья описи.
function wantedNames(probes, trees) {
  const fromProbes = probes.flatMap(({ need }) => need.map(lowered));
  const fromTrees = trees.flatMap((tree) => tree.leaves || []).map((leaf) => String(leaf).toLowerCase());
  return [...fromProbes, ...fromTrees];
}

async function plainScene(run, { scene, need }) {
  const mod = await run.modSheets(need);
  if (mod.missing.length) return run.shortage(scene, mod);
  const stock = await run.stockSheets(need);
  const intact = stock && !stock.missing.length;
  const head = probeHead(scene);
  const modShot = await run.camera.frame(head, null, mod.sheets);
  if (!modShot || !(SPLIT_SCENES.has(scene) && intact)) return modShot;
  const gameShot = await run.camera.frame(head, null, stock.sheets);
  return gameShot ? splitShots(gameShot, modShot) : modShot;
}

async function sceneCover(job) {
  const { kind, files, name, render, sheets, onGallery } = job;
  const source = sheets || sheetSourceFromEnv();
  if (!source) return null;
  const camera = makeCamera(render, name);
  const probes = await probeScenes(camera, SCENE_COVERS[kind]);
  const stripped = STRIP_SCENES.has(kind);
  const inventory = stripped ? (await import("@modovik/climb-contract/recolor/inventory/vegetation")).default : null;
  const trees = inventory?.trees || [];
  const wanted = new Set(wantedNames(probes, trees));
  if (!wanted.size) return null;
  const modFiles = await softFiles(named(files, SCENE_COVER_FILES));
  const modNames = new Set(await sheetsThread("modNamesOf", { files: modFiles, wanted: [...wanted] }));
  const scored = probes.map(({ scene, need }) => ({ scene, hits: sceneMatches(need, modNames), need }));
  const matched = scored.filter((probe) => probe.hits).sort((a, b) => b.hits - a.hits);
  const needs = new Map(probes.map(({ scene, need }) => [scene, need]));
  const run = new StripRun(camera, source, modFiles, needs);
  if (stripped) {
    return stripCover({ run, matched, trees, models: inventory?.models || [], modNames, files, onGallery });
  }
  return matched.length ? plainScene(run, matched[0]) : null;
}

// Словарь имён игры: sheetAt(txd) или null, если любой шаг цепочки отказал.
const gameNames = (source) =>
  import("@modovik/rpf7/node")
    .then(({ keysFromDirectory }) => keysFromDirectory(source.keys))
    .then(async (keys) => {
      const { openGameNames } = await import("./project-interiors/game-names.js");
      const cacheFile = path.join(os.tmpdir(), "astral-cover-game-names.json");
      return openGameNames(source.root, { keys, cacheFile });
    })
    .then(async (names) => {
      const { joaatName } = await import("./place-isolation.js");
      return (txd) => names.sheetAt(joaatName(txd));
    })
    .catch(() => null);

// Запрос листов игры без файлов мода: { textures, files: [], root, keysDirectory, size: 512 }.
const gameSheetRequest = (textures, source) => ({
  textures,
  files: [],
  root: source.root,
  keysDirectory: source.keys,
  size: 512,
});

// Вещи игры в ангаре: подсказка листов, опись места, словарь имён, вещи.
async function hangarGear(source, hangar) {
  const hint = await hangarHint();
  const plan = await isolation.readPlaceIsolation("hangar");
  const sheetAt = await gameNames(source);
  const read = gameBytesReader(source);
  const { centre, boxes } = hangar;
  const props = { plan, centre, box: boxes.interior, read, readMap: interiorsMeta.readMapData, sheetAt };
  const extras = await hangarProps.hangarStockProps(props).catch(() => []);
  return { stock: { read, hint, fallback: modelSceneApi.FILL_GAME }, extras };
}

async function gameLeaves(source, textures) {
  const answer = await sheetsThread("sceneSheetsOf", gameSheetRequest(textures, source));
  return (answer?.sheets || []).filter((sheet) => sheet?.bytes?.length);
}

const HANGAR_STEPS = [
  (c) => (typeof c.render === "function" ? undefined : STOP),
  async (c) => {
    c.inventory = (await import("@modovik/climb-contract/recolor/hangar")).HANGAR_INVENTORY;
    c.places = c.inventory.hangar?.placements || [];
    return placeScene.placedModModels(c.places, c.files).length ? undefined : STOP;
  },
  async (c) => {
    c.models = await pickOwn(/\.ydr$/i, c.files);
    c.source = c.sheets || sheetSourceFromEnv();
    c.hangar = c.inventory.hangar;
    c.gear = c.source?.root ? await hangarGear(c.source, c.hangar) : { stock: null, extras: [] };
    c.scene = await placeScene.modPlaceScene({
      placements: [...c.places, ...c.gear.extras],
      files: c.models,
      centre: c.hangar.centre,
      stock: c.gear.stock,
    });
    return c.scene ? undefined : STOP;
  },
  async (c) => {
    const withGame = c.source?.root && c.scene.game?.length;
    const sheetList = withGame ? [...c.scene.sheets, ...(await gameLeaves(c.source, c.scene.game))] : c.scene.sheets;
    const packed = [
      jsonFile("scene.json", { scene: "mod", frame: "hangar-inside" }),
      { name: "scene.bin", bytes: c.scene.bytes },
      ...sheetFiles(sheetList),
    ];
    c.out = frameOf(await makeCamera(c.render, c.name).shoot("scene", packed));
  },
];

const hangarCover = (job) => pipe({ ...job }, HANGAR_STEPS);

// Файлы запроса арены: arena.json, модели зала, листы зала, затем листы сцены (Map: повтор ключа — последние байты).
function arenaFiles(arena, hall, near, far) {
  const bins = [["hall.bin", hall?.inside], ["hall-outside.bin", hall?.outside]];
  const hallSheets = [...(hall?.inside?.sheets || []), ...(hall?.outside?.sheets || [])];
  const farSheets = !far.missing.length || hall?.outside ? far.sheets : [];
  const mapped = new Map([...near.sheets, ...farSheets].map((sheet) => [sheet.key, sheet.bytes]));
  return [
    jsonFile("arena.json", arena),
    ...bins.filter(([, piece]) => piece).map(([file, piece]) => ({ name: file, bytes: piece.bytes })),
    ...sheetFiles(hallSheets),
    ...Array.from(mapped, ([key, bytes]) => ({ name: key, bytes })),
  ];
}

// Сцены мастерской по серверам: изнутри — только читаемые, снаружи — по умолчанию пусто.
async function readArenaScenes() {
  const inside = {};
  const outside = {};
  for (const server of ARENA_SERVERS) {
    const near = await workshopScene(`arenas/${server}-inside.bin`);
    if (near) inside[server] = near.textures || [];
    outside[server] = (await workshopScene(`arenas/${server}-outside.bin`))?.textures || [];
  }
  return { inside, outside };
}

/* Арена редукса снимается только изнутри (владелец 12.11.2026: «превью снимать только изнутри: как арена выглядит внутри, со „звёздочкой“ и всем
   визуалом»): обложка кадров снаружи не несёт никогда. Штатная сцена «снаружи» (`ARENA_COVER_OUTSIDE`) выключена; а своя сборка фасада из файлов мода (`sp1_10_*`, HALLOWEN 240,
   13.11.2026: «автор менял фасад») идёт в галерею 2–3 кадрами, если у мода есть непустые модели фасада (`arena-hall-cover.js: hasOwnFacade`). */
export const ARENA_COVER_OUTSIDE = false;

async function arenaCover(job, chosen) {
  const { name, render, sheets, hallCover, onGallery } = job;
  const say = (...parts) => {
    debug(name, ...parts);
    return null;
  };
  if (typeof render !== "function") return null;
  const source = sheets || sheetSourceFromEnv();
  if (!source) return null;
  const { inside, outside } = await readArenaScenes();
  const lists = [inside, outside].flatMap((table) => ARENA_SERVERS.map((server) => table[server]));
  const wanted = new Set(lists.flatMap((list) => (list || []).map(lowered)));
  if (!wanted.size) return say("арена: у сцен мастерской нет листов");
  const modFiles = await softFiles(chosen);
  const modNames = new Set(await sheetsThread("modNamesOf", { files: modFiles, wanted: [...wanted] }));
  const fingerprintNames = chosen.map((entry) => String(entry?.name || "").toLowerCase());
  const picked = pickArena(inside, modNames, fingerprintNames);
  if (!picked) return say("арена: ни одна арена мастерской не подошла (листов мода:", modNames.size, ")");
  const { server, textures } = picked;
  const near = await sheetsFor(textures, modFiles, source);
  if (near.missing.length) {
    return say("арена", server, "нет листов игры:", near.missing.length, near.missing.slice(0, 4).join(", "));
  }
  const farList = ARENA_COVER_OUTSIDE ? outside[server] : [];
  const far = farList.length ? await sheetsFor(farList, modFiles, source) : { sheets: [], missing: ["нет сцены"] };
  const lacking = far.missing.length > 0;
  const hidden = await sheetsThread("blankModelsOf", { files: arenaBlank.blankCandidates(modFiles) });
  const facade = hallModule.hasOwnFacade(modFiles, hidden);
  const hall = await (hallCover || hallModule.arenaHallCover)({ files: modFiles, server, source, hidden, venues: hallModule.ARENA_COVER_VENUE, parts: facade ? ["inside", "outside"] : ["inside"] });
  if (hall && !ARENA_COVER_OUTSIDE && !facade) hall.outside = null;
  if (hall?.report) debug(name, "арена: ракурсы зала", JSON.stringify(hall.report));
  const arena = Object.assign(
    { server, outside: ARENA_COVER_OUTSIDE && !lacking, hidden, hall: Boolean(hall?.inside), hallOutside: Boolean(hall?.outside) },
    hall?.star ? { star: hall.star } : null,
    hall?.cover ? { cover: hall.cover } : null,
    hall?.views,
  );
  const shot = await makeCamera(render, name).shoot("arenas", arenaFiles(arena, hall, near, far));
  const frame = frameOf(shot);
  if (!frame) return say("арена", server, "окно не вернуло кадр");
  const second = otherArenaServer(fingerprintNames, server);
  const extra = second && typeof onGallery === "function" ? await secondArenaFrame({ second, first: server, inside, modFiles, source, name, render, hallCover }) : null;
  if (extra) {
    /* Арена двух серверов: кадры первого — с подписью его сервера, следом зал второго из его файлов автора. */
    const own = (shot.gallery || []).map((bytes) => (bytes instanceof Uint8Array ? { bytes, caption: ARENA_SERVER_CAPTION[server] } : bytes));
    await onGallery([...own, extra]);
  } else if (shot.gallery?.length && typeof onGallery === "function") await onGallery(shot.gallery);
  return frame;
}

/* Зал второго сервера из файлов автора, которые не принадлежат первому: один кадр в галерею (`null` — снять нечем, в журнал причина). */
async function secondArenaFrame({ second, first, inside, modFiles, source, name, render, hallCover }) {
  const files = modFiles.filter((file) => fingerprints.arenaFileOwner(file.name) !== first);
  const textures = inside[second] || [];
  if (!textures.length) return debug(name, "арена", second, "второй зал: у сцены нет листов");
  const near = await sheetsFor(textures, files, source);
  if (near.missing.length) return debug(name, "арена", second, "второй зал: нет листов игры:", near.missing.length);
  const hidden = await sheetsThread("blankModelsOf", { files: arenaBlank.blankCandidates(files) });
  const hall = await (hallCover || hallModule.arenaHallCover)({ files, server: second, source, hidden, venues: hallModule.ARENA_COVER_VENUE, parts: ["inside"] });
  const arena = Object.assign({ server: second, outside: false, hidden, hall: Boolean(hall?.inside), hallOutside: false }, hall?.star ? { star: hall.star } : null, hall?.cover ? { cover: hall.cover } : null, hall?.views);
  const shot = await makeCamera(render, name).shoot("arenas", arenaFiles(arena, hall, near, { sheets: [], missing: ["нет сцены"] }));
  const png = frameOf(shot);
  if (!png) return debug(name, "арена", second, "второй зал: окно не вернуло кадр");
  return { bytes: png, name: `arena-${second}`, caption: ARENA_SERVER_CAPTION[second] };
}

// ---------------------------------------------------------------- зоны и маппинг

const prefixless = (text) => text.replace(/^[a-z0-9]+_/, "");

// Облик зоны: среднее по каждому из четырёх каналов первой ступени первого листа модели мода.
function zoneLook(bytes) {
  try {
    const sheet = yptLib.readDrawableTextures(bytes)[0];
    const step = sheet.spans[0];
    if (!step) return null;
    const slice = sheet.payload.subarray(step.offset, step.offset + step.bytes);
    const rgba = ddsLib.decodeTexture(sheet.format, slice, sheet.width, sheet.height);
    const count = Math.max(rgba.length / 4, 1);
    const mean = [0, 1, 2, 3].map((channel) => {
      let sum = 0;
      for (let at = 0; at < rgba.length; at += 4) sum += rgba[at + channel];
      return Math.round(sum / count);
    });
    const hex = mean.slice(0, 3).map((value) => value.toString(16).padStart(2, "0"));
    return { colour: `#${hex.join("")}`, alpha: mean[3] };
  } catch {
    return null;
  }
}

function traceOf(zone, look) {
  const [px, py] = zone.position;
  const { axes, spans } = zone.frame;
  const [a0, a1] = spans.along;
  const [c0, c1] = spans.across;
  const corners = [[a0, c0], [a1, c0], [a1, c1], [a0, c1]];
  const coordinate = (base, axis) => (along, across) => base + axes.along[axis] * along + axes.across[axis] * across;
  const [xAt, yAt] = [coordinate(px, 0), coordinate(py, 1)];
  const points = corners.map(([along, across]) => [xAt(along, across), yAt(along, across)]);
  return { points, colour: look.colour, alpha: look.alpha, kind: zone.kind };
}

// Зоны без следов от соседа: облик берётся по первому загруженному файлу с тем же именем.
function zoneTraces(present, loaded) {
  const lookOf = ({ file }) => {
    const wanted = String(file?.name || "").toLowerCase();
    const model = loaded.find((entry) => String(entry.name || "").toLowerCase() === wanted);
    return model ? zoneLook(model.bytes) : null;
  };
  const shared = present.reduce((found, entry) => found || lookOf(entry), null);
  return present
    .filter(({ zone }) => zone.position && zone.frame)
    .flatMap((entry) => {
      const look = lookOf(entry) ?? shared;
      return look ? [traceOf(entry.zone, look)] : [];
    });
}

/* Зона автора — от этой стороны следа, м: плакат или значок (ppp, dark_prince — след в метр-два) зоной не считается и снимается моделью. */
const OWN_ZONE_SIDE = 20;

const ZONE_STEPS = [
  async (c) => {
    const { ZONES_INVENTORY } = await import("@modovik/climb-contract/recolor/zones");
    const nameOf = (file) => String(file?.name || "").toLowerCase();
    const byName = new Map(c.zoneFiles.map((file) => [nameOf(file), file]));
    const byTail = c.kind === "zones" ? new Map(c.zoneFiles.map((file) => [prefixless(nameOf(file)), file])) : null;
    c.matches = new Map();
    c.present = ZONES_INVENTORY.zones.filter((zone) => {
      const wanted = String(zone.file ?? "").toLowerCase();
      const file = byName.get(wanted) ?? byTail?.get(prefixless(wanted));
      if (file) c.matches.set(zone, file);
      return Boolean(file);
    });
    if (c.kind !== "mapping" || c.present.length >= MIN_ZONES) return undefined;
    /* Своих зон автора (СЖАТЫЙ · Mapping 2, 3, 5: плоские оболочки `vzhzone`, `porta`, `bizvar` по 350 м, на карте стоят по две) в описи игры нет, но у них есть след на земле: кадр — те же следы на карте,
       а не камера над тонкими линиями контура (ворота отклоняли такой кадр: «почти пусто»). */
    const wide = (zone) => {
      const [xs, ys] = [0, 1].map((axis) => zone.points.map((point) => point[axis]));
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= OWN_ZONE_SIDE;
    };
    const own = zoneShapes.zoneFootprints(await collectBytes(c.zoneFiles)).filter(wide);
    return own.length ? undefined : STOP;
  },
  async (c) => {
    c.loaded = await collectBytes(c.zoneFiles);
    const footprints = zoneShapes.zoneFootprints(c.loaded);
    const entries = c.present.map((zone) => ({ zone, file: c.matches.get(zone) }));
    c.zones = footprints.length ? footprints : zoneTraces(entries, c.loaded);
  },
  async (c) => {
    /* `whole` — часть «Зоны»: кадр — весь остров в рамке-карточке со врезками к мелким зонам; у маппинга с зонами — охват самих зон, как прежде. */
    const request = [jsonFile("zones.json", { zones: c.zones, ...(c.kind === "zones" ? { whole: true } : {}) })];
    if (c.zones.length) c.out = await consult(c.render, "zones", request, c.name);
    else if (c.kind === "zones") c.out = await zoneOutlines.zoneOutlinesPng(c.loaded);
  },
];

const zonesCover = (job) => pipe({ ...job }, ZONE_STEPS);

// Листы игры для «серых» моделей: имя листа -> { key, bytes }.
const gameFill = (sheets) => async (wantedNames) => {
  const answer = await sheetsThread(
    "sceneSheetsOf",
    gameSheetRequest(wantedNames.map((texture) => ({ game: modelSceneApi.FILL_GAME, texture })), sheets),
  );
  const filled = new Map();
  for (const sheet of answer?.sheets || []) {
    if (!sheet?.bytes?.length) continue;
    filled.set(sheet.key.slice(modelSceneApi.fillKey("").length), { key: sheet.key, bytes: sheet.bytes });
  }
  return filled;
};

const stemOfFile = (file) => String(file?.name || "").toLowerCase().replace(/\.[a-z0-9]+$/, "");

/*
 * Модели, что карты самой части ставят в мир (по хешу имени сущности `.ymap`): полотно автора поверх штатного здания (мегамолл: `opium_moll.ydr` — четыре стены-полотна
 * вокруг `sc1_22_mall_04bb`) ставит только эта карта, а здание остаётся штатным, и без неё рисунок автора в кадр не попадает. Карта, что не читается, ничего не ставит.
 */
export async function placedPlaces(files, models) {
  const byHash = new Map(models.map((file) => [isolation.joaatName(stemOfFile(file)), stemOfFile(file)]));
  const placed = new Map();
  for (const map of await softFiles(named(files, YMAP_FILE))) {
    try {
      for (const entity of mapEntities.readMapEntityPlaces(map.bytes)) {
        const stem = byHash.get(entity.archetype >>> 0);
        if (stem && !placed.has(stem)) placed.set(stem, { position: entity.position, rotation: entity.rotation, scale: entity.scale });
      }
    } catch {
      /* карта не читается — её модели не считаются поставленными */
    }
  }
  return placed;
}

/** Имена моделей, что карты части ставят в мир (без мест). */
export async function placedStems(files, models) {
  return new Set((await placedPlaces(files, models)).keys());
}

/* Оглавление игры для кадра со зданием из игры: собирается один раз и лежит рядом с оглавлением имён. */
const STOCK_INDEX_FILE = path.join(os.tmpdir(), "astral-cover-world-index.json");

/*
 * Полотно автора без здания (ENEMY V2, мегамолл): карта части ставит модель-оболочку, а здание, на которое она надета, в файлах части не лежит. Если под полотном нет модели самой части,
 * здание берётся из файлов игры (`stock-building.js`: модель, на стене которой полотно висит) вместе с землёй вокруг; нет игры, нет здания или полотно не оболочка — `null`, и
 * кадр строится как прежде, из одного полотна.
 */
async function stockCover(c) {
  const source = c.sheets || sheetSourceFromEnv();
  if (!source?.root || !source?.keys) return null;
  const { facts } = c.planned;
  const places = await placedPlaces(c.files, c.models);
  const stemOf = (fact) => String(fact.name).toLowerCase().replace(/\.[a-z0-9]+$/, "");
  const big = (fact) => usableModel(fact) && Math.max(fact.max[0] - fact.min[0], fact.max[1] - fact.min[1]) > PROP_EXTENT;
  for (const [stem, entity] of places) {
    const fact = facts.find((one) => stemOf(one) === stem && big(one));
    if (!fact || facts.some((other) => other !== fact && big(other) && stockBuilding.coversBase(other, fact, 1))) continue;
    const [file] = await softFiles(c.models.filter((one) => one.name === fact.name));
    if (!file) continue;
    const answer = await stockBuilding.stockBuildingCover({ overlay: { name: fact.name, bytes: file.bytes, entity }, files: c.models, source, indexFile: STOCK_INDEX_FILE, log: (line) => debug(c.name, "здание из игры:", line) });
    if (!answer?.bytes) {
      debug(c.name, "здание из игры не собрано:", answer?.reason || "нет ответа");
      continue;
    }
    const game = await sheetsThread("sceneSheetsOf", { textures: answer.textures, files: [], root: source.root, keysDirectory: source.keys, size: stockBuilding.STOCK_SHEET_SIZE });
    const sheets = [...answer.sheets, ...(game?.sheets || []).filter((sheet) => sheet?.bytes?.length)];
    debug(c.name, "здание из игры:", answer.building.name, "опора", answer.building.support.toFixed(2), "листов игры", game?.sheets?.length || 0, "нет листов", game?.missing?.length || 0);
    return { plan: answer.plan, built: { bytes: answer.bytes, sheets, textured: Math.max(1, answer.report?.triangles || 1), bare: 0, filled: 0 } };
  }
  return null;
}

/*
 * Маппинг, закрытый оболочкой (казино внутри глухого короба, UZI PURPLE V2 REDUX): снаружи виден только короб, и кадр был серым параллелепипедом. Оболочка узнаётся по геометрии
 * поставленных картами моделей (`enclosed-interior-cover.js`); тогда обложка и галерея — кадры изнутри с текстурами автора, как у интерьеров редукса. `null` — оболочки нет, часть снимается
 * как прежде; `{ png: null, why }` — оболочка есть, а снять изнутри не вышло: серый короб вместо интерьера не показывается, остаётся карта места (`drawMapping`).
 */
async function enclosedShot(c) {
  const source = c.sheets || sheetSourceFromEnv();
  const { enclosedCover } = await import("./enclosed-interior-cover.js");
  const shot = await enclosedCover({
    files: c.files,
    name: c.name,
    render: c.render,
    source,
    fill: source?.root ? gameFill(source) : null,
    onGallery: c.onGallery,
    onStaged: c.onStaged,
    deps: { debug },
  });
  if (!shot) return null;
  if (!shot.png) {
    debug(c.name, "закрытая оболочка, изнутри не снято:", shot.why);
    return shot;
  }
  /* Подпись интерьера стоит у обложки и у кадров изнутри; кадр-карта места, что `drawMapping` кладёт в галерею, — без неё. */
  return { ...shot, galleryCaption: "" };
}

/*
 * Объекты в небе (северное сияние, Barbie · Mapping (auroraa)): все размещения высоко над миром, коллизий нет, материал прозрачный или светящийся (`sky-objects-cover.js`) — кадр «с земли»:
 * модели на своих местах и в своём масштабе под ночным небом, первый взгляд — обложка, остальные — галерея. Не сошлось — часть снимается как раньше.
 */
async function skyShot(c) {
  const maps = await softFiles(named(c.files, YMAP_FILE));
  const models = await softFiles(named(c.files, /.ydr$/i));
  if (!maps.length || !models.length) return null;
  const found = await skyObjects.skyObjectsOf({ maps, models, collision: named(c.files, /.ybn$/i).length > 0 });
  if (!found) return null;
  const files = await softFiles(named(c.files, /.(ydr|ytd)$/i));
  const fill = c.sheets?.root ? gameFill(c.sheets) : null;
  const built = await modelSceneApi.modelsScene({ files, plan: found.plan, fill });
  if (!built) return null;
  debug(c.name, "объекты в небе:", found.count, "размещений, центр", found.centre.map(Math.round).join(","));
  const [lead, ...more] = found.views;
  const head = { scene: "mod", frame: "sky", view: lead, views: [lead, ...more] };
  const packed = [jsonFile("scene.json", head), { name: "scene.bin", bytes: built.bytes }, ...sheetFiles(built.sheets)];
  const out = await consult(c.render, "scene", packed, c.name);
  if (!out?.png?.length) return null;
  c.onStaged?.("models");
  if (out.gallery?.length && typeof c.onGallery === "function") await c.onGallery(out.gallery);
  return { ...out, layout: "sky" };
}

// Маппинг без карт: модели мода на нейтральной сцене.
const MODEL_STEPS = [
  (c) => (typeof c.render === "function" ? undefined : STOP),
  async (c) => {
    const sky = await skyShot(c).catch((failure) => {
      debug(c.name, "объекты в небе не сняты:", String(failure?.message || failure));
      return null;
    });
    if (!sky) return undefined;
    c.out = sky;
    return STOP;
  },
  async (c) => {
    c.models = named(c.files, /\.(ytd|ydr|yft)$/i);
    const inside = await enclosedShot(c);
    if (!inside) return undefined;
    c.out = inside;
    return STOP;
  },
  async (c) => {
    c.planned = await modelSceneApi.modelCoverPlan(c.models, { hint: `${c.hint} ${c.name}`, placed: await placedStems(c.files, c.models) });
    if (!c.planned) return STOP;
    /* Объёмы-подсказки автора (призрачные листы — прострелы): не здание и не полотно на стене — ни фасада, ни здания из игры им не нужно (ниже), только общий вид площадки. */
    c.volumes = await modelSceneApi.ghostShare({ files: c.models, plan: c.planned.plan }).catch(() => ({ ghost: 0, faint: 0 }));
    return undefined;
  },
  async (c) => {
    /* Штатное здание под объёмами прострелов показывало соседние дома игры, а сами объёмы (восьмая непрозрачности) на нём не видны: кадр был про чужие дома. */
    if (c.volumes.ghost >= modelSceneApi.GHOST_SHARE) return undefined;
    const stock = await stockCover(c).catch((failure) => {
      debug(c.name, "здание из игры не вышло:", String(failure?.message || failure));
      return null;
    });
    if (stock) {
      c.planned = { ...c.planned, plan: stock.plan };
      c.built = stock.built;
    }
  },
  async (c) => {
    if (c.built) return undefined;
    const fill = c.sheets?.root ? gameFill(c.sheets) : null;
    c.built = await modelSceneApi.modelsScene({ files: c.models, plan: c.planned.plan, fill });
    return c.built ? undefined : STOP;
  },
  async (c) => {
    const { built, planned, onStaged, onGallery } = c;
    /* Здание с найденным фасадом (`building-facade.js`): первый ракурс — обложка, остальные стороны и вид сверху — галерея, одной сценой.
       Объёмы-подсказки автора (призрачные листы — прострелы) не здание: фасада у них нет, обложка — общий вид площадки (`mod-model-scene.js`, `GHOST_SHARE`), а если цвет объёма
       на тёмной студии сливается с полом (`faint`, RP) — на светлой. */
    const ghost = c.volumes.ghost >= modelSceneApi.GHOST_SHARE;
    const light = c.volumes.faint >= modelSceneApi.GHOST_SHARE ? { backdrop: "light" } : {};
    const views = !ghost && planned.plan.views?.length ? { views: planned.plan.views } : {};
    const head = { scene: "mod", frame: "models", view: ghost ? { ...overviewOf(planned.plan), ...light } : planned.plan.view, ...views };
    const bin = { name: "scene.bin", bytes: built.bytes };
    const packed = [jsonFile("scene.json", head), bin, ...sheetFiles(built.sheets)];
    c.out = await consult(c.render, "scene", packed, c.name);
    if (c.out?.png?.length) {
      onStaged?.(built.bare >= BARE_SHARE * (built.bare + built.textured + built.filled) ? "models-bare" : "models");
      if (c.out.gallery?.length && typeof onGallery === "function") await onGallery(c.out.gallery);
    }
  },
];

const modelScene = (job) => pipe({ ...job }, MODEL_STEPS);

// ---------------------------------------------------------------- места

async function drawGrass({ own, render, name }) {
  const { areas, removed, maps } = mapPlaces.grassAreas(own);
  if (!areas.length) return null;
  return consult(render, "grass", [jsonFile("places.json", { areas, removed, maps })], name);
}

async function drawPlain({ own, render, name }) {
  const places = mapPlaces.mappingPlaces(own);
  if (!places.objects.length && !places.lights.length) return null;
  return consult(render, "mapping", [jsonFile("places.json", places)], name);
}

/*
 * Часть маппинга из одних текстур (ENEMY V2 · graz: логотипы марок `majestic_veh_brand_*.ytd`, ни карт, ни моделей): здания и интерьера нет, обложка — сами листы автора сеткой
 * (`texture-sheet-cover.js`). Карты или модели в части есть — маршрут не нужен, и часть снимается как раньше.
 */
const MODEL_FILE_ANY = /\.(ydr|yft|ydd)$/i;

async function textureSheetShot(job, bare) {
  if (!bare || named(job.files, MODEL_FILE_ANY).length) return null;
  const dictionaries = await pickOwn(/\.ytd$/i, job.files);
  if (!dictionaries.length) return null;
  const cover = await textureSheet.textureSheetCover(dictionaries);
  debug(job.name, "часть из одних текстур:", cover ? cover.sheets.join("; ") : "листов, что стоит показать, нет");
  return cover ? { png: cover.png, caption: cover.caption } : null;
}

/* Модель автора пуста (ANTEIKU V2 · delete_backpack): снимать нечего, обложка — значок «предмета нет» с честной подписью (`empty-model-cover.js`). */
async function emptyModelShot(job) {
  const others = named(job.files, /\.(yft|ydd)$/i).length;
  const cover = others ? null : await emptyModelCover(await pickOwn(/\.ydr$/i, job.files));
  debug(job.name, "модель автора пуста:", cover ? cover.names.join(", ") : "нет (моделей нет либо не все пусты)");
  return cover ? { png: cover.png, caption: cover.caption } : null;
}

/*
 * Часть маппинга из одних опустошённых карт травы (СЖАТЫЙ · Mapping (musor): 394 карты `*_grass_N.ymap` по девяти районам, в каждой ни одной травинки): автор убирает траву, ставить
 * в мир нечего. Обложка — схема карты с закрашенными районами (кадр «Трава») и подпись, что это схема, а не кадр игры (`GRASS_REMOVED_CAPTION`, словарь `ui-text/zone-empty-model-1411.js`).
 */
const GRASS_REMOVED_CAPTION = "Схема, а не кадр игры: автор убрал траву в закрашенных районах карты";

async function grassRemovedShot({ own, render, name }) {
  const grass = mapPlaces.grassAreas(own);
  if (!grass.removed || !grass.areas.length) return null;
  const shot = await consult(render, "grass", [jsonFile("places.json", { areas: grass.areas, removed: true, maps: grass.maps })], name);
  debug(name, "траву убрали:", grass.areas.join(", "), shot?.png?.length ? "схема снята" : "схема не снята");
  return shot?.png?.length ? { ...shot, caption: GRASS_REMOVED_CAPTION } : null;
}

async function drawMapping(job) {
  const { own, render, name } = job;
  const places = mapPlaces.mappingPlaces(own);
  const bare = !places.objects.length && !places.lights.length;
  const textures = await textureSheetShot(job, bare);
  if (textures) return textures;
  const empty = bare ? await emptyModelShot(job) : null;
  if (empty) return empty;
  const grassOff = bare ? await grassRemovedShot(job) : null;
  if (grassOff) return grassOff;
  const models = await modelScene(job);
  if (bare || models?.layout === "sky") return models;
  const askMap = () => consult(render, "mapping", [jsonFile("places.json", places)], name);
  if (!models?.png?.length) return askMap();
  return askMap()
    .catch(() => null)
    .then(async (map) => {
      /* Кадр с галереей — здание крупно, его фасад (`building-facade.js`): карта вставкой только на пустом углу, иначе — последним кадром галереи, а не поверх стены. */
      const facade = models.gallery?.length > 0;
      const inset = map?.png?.length ? await coverInset.withMapInset(models.png, map.png, { free: facade }) : null;
      if (!inset && facade && map?.png?.length && typeof job.onGallery === "function") await job.onGallery([...models.gallery, map.png]);
      return inset ? { ...models, png: inset } : models;
    });
}

const PLACE_HANDLERS = new Map([
  ["grass", drawGrass],
  ["mapping", drawMapping],
  ["interiors", ({ own, ...rest }) => drawPlain({ ...rest, own: own.filter((file) => YMAP_FILE.test(String(file?.name || ""))) })],
  ["climbs", drawPlain],
  ["zones", drawPlain],
]);

// ---------------------------------------------------------------- маршруты вида

/* Свои модели автора (растительность без штатных имён игры, фонари): сами модели со своими листами на сцене мастерской; листы игры — тем, чего у автора нет (печь с `--game`). */
async function ownModelsRoute(job) {
  const source = job.sheets || sheetSourceFromEnv();
  const fill = source?.root ? gameFill(source) : null;
  const { kind, files, name, render, onGallery, onStaged } = job;
  return ownModels.ownModelCover({ kind, files, name, render, fill, onGallery, onStaged, stockLights: source?.root && source?.keys ? stockLampLights(source) : null });
}

/* Свет штатной модели фонаря из игры игрока (`x64h.rpf`, `v_traffic_lights.rpf`): сравнить свет автора с игровым, когда рядом нет штатного двойника `…_def`. Нет модели или игры — `null`. */
const STOCK_LAMP_FOLDER = "x64h.rpf:levels/gta5/props/roadside/v_traffic_lights.rpf";
function stockLampLights(source) {
  const read = gameBytesReader(source);
  return async (stockName) => {
    /* Нет `x64h.rpf` — это не «у штатной модели света нет», а нехватка игры: отказ с именем архива. */
    const bytes = await readFirstPlace(source.root, ["yft", "ydr"].map((extension) => `${STOCK_LAMP_FOLDER}/${stockName}.${extension}`), read, "штатных фонарей");
    return bytes?.length ? modelLights.readModelLights(new Uint8Array(bytes), { name: stockName }).lights : null;
  };
}

const staged = (cover) => async (job) => {
  const { onStaged } = job;
  const frame = await cover(job);
  if (!frame) return NEXT;
  onStaged?.();
  return frame;
};

// Радар мини-карты добавляется последним файлом; любой сбой радара гасится.
function radarFile(radar) {
  try {
    const parsed = vectorMap.parsePackGeometry(radar, { readDrawable: drawableLib.readDrawable, inflateRaw: rpfNode.inflateRawNode });
    return parsed.triangles ? { name: MINIMAP_RADAR_FILE, bytes: vectorMap.encodePackGeometry(parsed) } : null;
  } catch {
    return null;
  }
}

// Кадр игры -> onFramed, иначе причина -> onFxNote (вызовы необязательные).
function announce(shot, onFramed, onFxNote) {
  if (shot?.framed) onFramed?.(shot.framed);
  else if (shot?.fxReason) onFxNote?.(shot.fxReason);
}

const SEA_KINDS = new Set(["timecycle", "water"]);

const WATER_XML = /^water\.xml$/i;
const WATER_YTD = /^water\.ytd$/i;

/* Штатный словарь воды из игры: обновление главнее базового архива; игры нет или файла в ней нет — `null` (обложка без пары «игра → автор»). */
async function stockWaterBytes(source) {
  if (!source?.root || !source?.keys) return null;
  const bytes = await readFirstPlace(source.root, waterTextures.STOCK_WATER_PLACES, gameBytesReader(source), "текстур воды");
  return bytes ? new Uint8Array(bytes) : null;
}

/*
 * Вода без `water.xml` — автор менял только текстуры поверхности (`water.ytd`, ENEMY V2): кадру моря из игры нечего красить, а лист `waterclear` он не читает, и положить на
 * море текстуры автора честно нельзя. Обложка — сами текстуры, «из игры → у автора» (`water-textures-cover.js`); с `water.xml` вид прежний, море из игры.
 */
async function waterRoute(job) {
  if (named(job.files, WATER_XML).length) return NEXT;
  const [textures] = await pickOwn(WATER_YTD, job.files);
  if (!textures) return NEXT;
  const stock = await stockWaterBytes(job.sheets || sheetSourceFromEnv()).catch(keepMissing);
  const cover = await waterTextures.waterTexturesCover(textures.bytes, { stock });
  debug(job.name, "вода из текстур автора:", cover ? cover.rows.map((row) => row.name + " " + row.state).join(", ") : "изменённых текстур нет", stock ? "(штатный словарь прочитан)" : "(штатного словаря нет)");
  return cover ? { png: cover.png, caption: cover.caption } : null;
}

/* Штатная таблица цветов интерфейса из игры: обновление главнее базового архива; игры нет — `null`, и обложки не будет (сравнивать не с чем). */
async function stockHudColours(source) {
  if (!source?.root || !source?.keys) return null;
  const bytes = await readFirstPlace(source.root, hudColours.STOCK_HUDCOLOR_PLACES, gameBytesReader(source), "цветов интерфейса");
  return bytes ? new Uint8Array(bytes) : null;
}

/* «Цвета интерфейса» редукса (HALLOWEN 240): что автор изменил в `hudcolor.dat` — парами «в игре → у автора». */
async function hudColourRoute(job) {
  const [table] = await pickOwn(PART_COVER_FILES.hudcolor, job.files);
  if (!table) return null;
  const stock = await stockHudColours(job.sheets || sheetSourceFromEnv()).catch(keepMissing);
  const cover = await hudColours.hudColourCover(table.bytes, { stock });
  debug(job.name, "цвета интерфейса:", cover ? "изменено " + cover.changes.length : stock ? "автор ничего не изменил" : "штатной таблицы нет");
  return cover ? { png: cover.png, caption: cover.caption } : null;
}

/*
 * Интерьер редукса (sad redux (5rp): `v_int_<N>`): расстановка — MLO в `.ytyp` автора, модели — его и штатные из игры; кадр изнутри комнаты на весь кадр
 * (`redux-interior-cover.js`). Файлов комнаты нет — прежний вид по карте `.ymap`; комната не собралась — отказ с причиной (`why` идёт в журнал печи), а у части с картой — прежний вид.
 */
async function interiorRoute(job) {
  const rooms = named(job.files, INTERIOR_ROOM_FILES);
  if (!rooms.length) return NEXT;
  const mapped = named(job.files, YMAP_FILE).length > 0;
  if (typeof job.render !== "function") return mapped ? NEXT : null;
  const { interiorCover } = await import("./redux-interior-cover.js");
  const { name, render, onGallery, onStaged } = job;
  const shot = await interiorCover({ files: rooms, name, render, source: job.sheets || sheetSourceFromEnv(), onGallery, onStaged, deps: { debug } });
  if (shot.png) return shot;
  debug(name, "интерьер не снят:", shot.why);
  return mapped ? NEXT : shot;
}

/* Штатная библиотека шрифтов из игры: обновление главнее базового архива; игры нет — `null`, и обложка рисуется по одному файлу автора. */
async function stockFontBytes(source) {
  if (!source?.root || !source?.keys) return null;
  const bytes = await readFirstPlace(source.root, fontCovers.STOCK_FONT_PLACES, gameBytesReader(source), "шрифтов");
  return bytes ? new Uint8Array(bytes) : null;
}

/* «Шрифт» редукса: образцы, набранные глифами файла автора; изменённые шрифты — парами «из игры → у автора», такой же файл — с подписью «те же, что в игре». */
async function fontRoute(job) {
  const [library] = await pickOwn(PART_COVER_FILES.font, job.files);
  if (!library) return null;
  const stock = await stockFontBytes(job.sheets || sheetSourceFromEnv()).catch(keepMissing);
  const cover = await fontCovers.fontCover(library.bytes, { stock });
  debug(job.name, "шрифты:", cover ? `${cover.mode}: ${cover.fonts.join(", ")}` : "в библиотеке нет шрифта с латиницей", stock ? "(штатная библиотека прочитана)" : "(штатной библиотеки нет)");
  return cover ? { png: cover.png, caption: cover.caption } : null;
}

/* Штатные файлы облачных шапок из игры: один читатель на всю сверку (десятки файлов — открывать архив на каждый было бы минутой); нет игры — `null`. */
async function stockCloudReader(source) {
  if (!source?.root || !source?.keys) return null;
  /* Архива облаков в папке игры нет — не «облака автора без сравнения», а отказ с именем архива (печь не выпускает такую обложку). */
  const gone = await missingArchiveLabel(source.root, cloudCovers.STOCK_CLOUD_PLACE);
  if (gone) throw gameSourceMissing([gone], "облаков");
  const { gamePartsReader } = await import("./part-sheets.js");
  const keys = await rpfNode.keysFromDirectory(source.keys);
  const reader = gamePartsReader(source.root, keys);
  return { read: (name) => reader.read(`${cloudCovers.STOCK_CLOUD_PLACE}/${name}`).catch(() => null), close: () => reader.close?.() };
}

const CLOUD_SKY_PREFIX = "timecycle/";

/*
 * «Облака» редукса. Обложка — небо с облаками под таймциклом того же редукса (владелец 13.11.2026: «желательно, чтобы ты фотографию туда ставил»): окно рисует кадр шейдера неба
 * мастерской, камера — в небо, облачные шапки — игры (`cloud-sky-cover.js`). Это честно, пока шапки автора с игровыми совпадают байт в байт (так у sad redux: часть везёт игровой набор);
 * отличаются — кадр с шапками автора ещё не собирается, и обложка — листы плотности его словарей (`cloud-cover.js`). Нет окна, игры или неба — тоже листы, причина — в журнале печи.
 */
async function cloudsRoute(job) {
  const own = (await pickOwn(PART_COVER_FILES.clouds, job.files)).filter((file) => !file.name.startsWith(CLOUD_SKY_PREFIX));
  const sky = job.files.filter((file) => file.name.startsWith(CLOUD_SKY_PREFIX) && file.bytes?.length).map((file) => ({ name: file.name.slice(CLOUD_SKY_PREFIX.length), bytes: file.bytes }));
  if (!own.length) return null;
  const source = job.sheets || sheetSourceFromEnv();
  const reader = await stockCloudReader(source).catch(keepMissing);
  try {
    const stockOf = reader ? (name) => reader.read(name) : null;
    const hats = await cloudCovers.compareHatFiles(own, stockOf);
    if (hats.identical && typeof job.render === "function") {
      const shot = await consult(job.render, "clouds-sky", sky, job.name, [["sea", true, { gameRoot: source.root }]]).catch((failure) => ({ png: null, fxReason: String(failure?.message || failure) }));
      if (shot?.png?.length) {
        const frames = (shot.gallery || []).filter((frame) => frame?.length).map((bytes) => ({ bytes, caption: cloudCovers.CLOUD_CAPTIONS.sky }));
        if (frames.length && typeof job.onGallery === "function") await job.onGallery(frames);
        debug(job.name, "облака: небо под таймциклом автора,", sky.length, "файлов неба;", shot.note || "");
        return { png: shot.png, gallery: shot.gallery, caption: cloudCovers.CLOUD_CAPTIONS.sky };
      }
      debug(job.name, "облака: кадр неба не снят —", shot?.fxReason || "окно не вернуло кадр", "— обложка листами плотности");
    } else {
      debug(job.name, "облака: кадр неба не берётся — шапки:", hats.identical ? "те же, что в игре, но окна нет" : `файлов ${hats.total}, отличаются ${hats.changed.length}, не сверены ${hats.unknown.length}`, "— обложка листами плотности");
    }
    const cover = await cloudCovers.cloudCover(own, { stockOf });
    debug(job.name, "облака:", cover ? `${cover.mode}: ${cover.sheets.join(", ")}` : "листов плотности в словарях нет");
    return cover ? { png: cover.png, caption: cover.caption } : null;
  } finally {
    await reader?.close();
  }
}

async function windowRoute(job) {
  const { kind, own, name, render, radar, palette, fxFrames, fxClip, onFramed, onFxNote } = job;
  const radarPiece = kind === "minimap" && radar.length ? radarFile(radar) : null;
  if (typeof render !== "function") return null;
  /* Таймцикл снимается на квартале из игры (`sky-quarter-cover.js`), вода — на море из игры: окну нужна папка игры. Без неё — прежний кадр. */
  const gameRoot = SEA_KINDS.has(kind) ? (job.sheets || sheetSourceFromEnv())?.root || "" : "";
  const flags = [
    ["palette", kind === "minimap" && palette === "author", "author"],
    ["fx", fxFrames, true],
    ["fxClip", fxClip, true],
    ["sea", Boolean(gameRoot), { gameRoot }],
    ["still", kind === "minimap-position", true],
  ];
  const shot = await consult(render, kind, radarPiece ? [...own, radarPiece] : [...own], name, flags);
  announce(shot, onFramed, onFxNote);
  /* `frontend.xml`, который карту не двигает, снимается тоже (кадр экрана с картой на штатном месте); подпись под кадром говорит об этом прямо. */
  const caption = kind === "minimap-position" && shot?.png?.length ? positionCaption(own[0].bytes) : null;
  return caption ? { ...shot, caption } : shot;
}

// Файл для кадра трассеров: готовый код работы либо картинка трассера.
async function tracerFiles(own) {
  const work = own.find((entry) => entry.name === WORK_CODE_FILE);
  if (work) return [work];
  const [texture] = await painters.tracerDds(own);
  return texture ? [{ name: "tracer.dds", bytes: texture }] : [];
}

async function tracerRoute(job) {
  const { own, name, render, fxFrames, fxClip, fxView, onFramed, onFxNote } = job;
  const sent = await tracerFiles(own);
  const flags = [["fx", fxFrames, true], ["fxClip", fxClip, true], ["fxView", fxView, fxView]];
  const shot = sent.length ? await consult(render, "tracers", sent, name, flags).catch(() => null) : null;
  if (frameOf(shot)) {
    if (shot.framed) onFramed?.(shot.framed);
    return shot;
  }
  const reason = shot?.fxReason;
  if (reason) onFxNote?.(reason);
  return fxClip ? { png: null, fxReason: reason || CLIP_FAILED } : NEXT;
}

/* Быстрый вход редукса (владелец 12.11.2026: «сделать им превью»): что автор ускорил в `playerswitch.meta` — числами «штатно → у автора». Файл, который
   входа не ускоряет (числа как в игре или медленнее), обложки не получает: показывать нечего. */
async function fastEntryRoute({ own }) {
  const found = fastEntry.fastEntryOf(new TextDecoder().decode(own[0].bytes));
  const groups = found?.fast ? fastEntry.fastEntryCoverGroups(found.changes) : [];
  return groups.length ? optimizationCover.optimizationCoverPng(groups) : null;
}

async function reticleRoute({ own, name, render }) {
  const request = { kind: "redux-part", partKind: "crosshair", files: own, name };
  const drawn = typeof render === "function" ? await render(request).catch(() => null) : null;
  return drawn?.png?.length ? drawn : reticleCover.reticleWorkshopCoverPng(own[0].bytes);
}

// Файл геометрии карты: готовый в списке либо собранный из частей; null, если собирать нечего.
function geometryFile(own) {
  const baked = own.find((entry) => String(entry.name ?? "").toLowerCase() === "geometry.apg1");
  if (baked) return { bytes: baked.bytes };
  const geometry = vectorMap.parsePackGeometry(own, { readDrawable: drawableLib.readDrawable, inflateRaw: rpfNode.inflateRawNode });
  return geometry.triangles ? { bytes: vectorMap.encodePackGeometry(geometry) } : null;
}

async function vectorRoute({ own, name, render, exact }) {
  if (typeof render !== "function") return null;
  const geometry = geometryFile(own);
  if (!geometry) return null;
  return consult(render, "large-map-vector", [{ name: "geometry.apg1", bytes: geometry.bytes }], name, [["exact", exact === true, true]]);
}

/* Прозрачная карта ложится на чёрное матовое поле обложек мастерской — как прицел и мини-карта (ТЗ 10.11.2026, Б5). */
export async function onWorkshopMatte(rgba, width, height) {
  const { workshopMatteRgba } = await import("@modovik/gfx/workshop-matte");
  const field = workshopMatteRgba(width, height);
  const out = new Uint8Array(rgba.length);
  for (let at = 0; at < rgba.length; at += 4) {
    const own = rgba[at + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) out[at + channel] = Math.round(rgba[at + channel] * own + field[at + channel] * (1 - own));
    out[at + 3] = 255;
  }
  return out;
}

/* `exact` (часть редукса) — цвета плиток автора как есть: подъём тёмной карты (`mapCoverGamma`) показывал чёрную карту серой. */
async function tilesRoute({ own, exact }) {
  /* Часть редукса: остров вписан с запасом под рамку-карточку и обведён ею — окно страницы мода показывает тёмную карту автора целиком (`map-card-cover.js`). */
  const gap = exact === true ? mapCard.cardGapRatio(vectorMap.BIG_MAP_COVER) : undefined;
  const cover = vectorMap.mapPackCover(own, { inflateRaw: rpfNode.inflateRawNode, exact: exact === true, ...(gap === undefined ? {} : { gap }) });
  if (cover == null) return null;
  if (exact === true) return mapCard.cardMapPng(cover);
  return gfx.encodePng(await onWorkshopMatte(cover.rgba, cover.width, cover.height), cover.width, cover.height, 4);
}

async function ownRoute(job) {
  const { kind, files } = job;
  const pattern = PART_COVER_FILES[kind];
  job.own = await pickOwn(pattern, files);
  if (job.own.length) return NEXT;
  if (kind !== "mapping") return null;
  /* Часть из одних текстур (ENEMY V2 · graz): обложка — листы автора сеткой, расстановки нет и модели строить не из чего (`textureSheetShot`). */
  const sheets = await textureSheetShot(job, true);
  if (sheets) return { ...sheets, layout: "zones" };
  const empty = await emptyModelShot(job);
  if (empty) return { ...empty, layout: "zones" };
  /* Модели маппинга по своим местам мира — тот же вид, что кадр зон: россыпь с врезкой карты (`zoneRoute`). */
  const shot = await modelScene(job);
  return shot?.png?.length ? { ...shot, layout: "zones" } : shot;
}

async function zoneRoute(job) {
  job.zoneFiles = named(job.files, PART_COVER_FILES.zones);
  if (typeof job.render !== "function") return NEXT;
  const shot = await zonesCover(job);
  /* Кадр зон — объёмы автора россыпью по своим местам и врезка карты: предмета «в середине кадра» у него нет, и проверка середины (`cover-gate.js`,
     вид-объект компонента редукса) к нему не относится — прострелы GODMODE (дома и заборы по краям кадра) она отклоняла как «камера смотрит мимо». */
  if (shot?.png?.length) return { ...shot, layout: "zones" };
  return shot || NEXT;
}

async function placesRoute(job) {
  if (typeof job.render !== "function") return null;
  const shot = await PLACE_HANDLERS.get(job.kind)(job);
  /* Маппинг по местам мира — россыпь объёмов с врезкой карты, как кадр зон (`zoneRoute`): проверке кадра нужен режим россыпи, а не «предмет в середине». */
  /* Объекты в небе (`skyShot`) называют раскладку сами — «зоны» им не ставится. */
  return job.kind === "mapping" && shot?.png?.length ? { layout: "zones", ...shot } : shot;
}

// Порядок значим: первая сработавшая запись определяет ответ, NEXT передаёт вид дальше.
const ROUTES = [
  { applies: (job) => !PART_COVER_FILES[job.kind], handle: () => null },
  {
    applies: (job) => job.kind === "schedule",
    handle: async (job) => scheduleCover.scheduleCoverPng(await pickOwn(PART_COVER_FILES.schedule, job.files)),
  },
  { applies: (job) => job.kind === "mapping" || job.kind === "zones", handle: zoneRoute },
  { applies: (job) => job.kind === "hangar", handle: staged(hangarCover) },
  { applies: (job) => SCENE_COVERS[job.kind] && typeof job.render === "function", handle: staged(sceneCover) },
  /* Штатных сцен растительность автора не нашла (имена не игры) — его собственные модели; у фонарей сцены нет вовсе. */
  { applies: (job) => ownModels.OWN_MODEL_KINDS.includes(job.kind) && typeof job.render === "function", handle: ownModelsRoute },
  { applies: (job) => SCENE_KINDS.has(job.kind) && job.kind !== "mapping", handle: () => null },
  {
    applies: (job) => job.kind === "arenas",
    handle: (job) => arenaCover(job, named(job.files, PART_COVER_FILES.arenas)),
  },
  { applies: (job) => job.kind === "water", handle: waterRoute },
  { applies: (job) => job.kind === "hudcolor", handle: hudColourRoute },
  { applies: (job) => job.kind === "font", handle: fontRoute },
  { applies: (job) => job.kind === "clouds", handle: cloudsRoute },
  { applies: (job) => job.kind === "interiors", handle: interiorRoute },
  { applies: () => true, handle: ownRoute },
  { applies: (job) => job.kind === "fast-entry", handle: fastEntryRoute },
  { applies: (job) => job.kind === "tracers" && job.fxFrames && typeof job.render === "function", handle: tracerRoute },
  { applies: (job) => painters.PAINTED_KINDS[job.kind], handle: (job) => painters.paintPartCover(job.kind, job.own) },
  { applies: (job) => WINDOW_KINDS.has(job.kind), handle: windowRoute },
  { applies: (job) => job.kind === "climbs", handle: async (job) => (await climbCover.climbCoverPng(job.own)) || NEXT },
  { applies: (job) => PLACE_HANDLERS.has(job.kind), handle: placesRoute },
  { applies: (job) => job.kind === "large-map-vector", handle: vectorRoute },
  { applies: (job) => job.kind === "reticle", handle: reticleRoute },
  { applies: () => true, handle: tilesRoute },
];

async function draw({
  kind,
  render,
  files = [],
  name = "",
  sheets = null,
  hallCover,
  hint = "",
  onGallery = null,
  onStaged = null,
  fxFrames = false,
  fxClip = false,
  fxView = "",
  onFramed = null,
  onFxNote = null,
  radar = [],
  palette = "game",
  exact = false,
}) {
  const job = { kind, render, files, name, sheets, hallCover, hint, onGallery, onStaged };
  Object.assign(job, { fxFrames, fxClip, fxView, onFramed, onFxNote, radar, palette, exact });
  for (const route of ROUTES) {
    const outcome = route.applies(job) ? await route.handle(job) : NEXT;
    if (outcome !== NEXT) return outcome;
  }
  return null;
}

export async function renderPartCover(options) {
  return shapeAnswer(await draw(options), options?.detail);
}
