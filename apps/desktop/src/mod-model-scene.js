/*
 * Модели мода своими текстурами — сцена кадра (25.10.2026).
 *
 * Часть маппинга без карты размещения (остановки, банкоматы, отделка торгового
 * центра, площадка дуэлей) — свои модели мода поверх штатных, а где они стоят,
 * мод не говорит. Обложка — сами модели на нейтральной сцене мастерской
 * (`model-cover-plan.js` решает, какие и как поставить), листы — только из
 * мода: зашитые в модель и из его словарей (`.ytd` рядом). Модель без листа в
 * моде не берёт лист игры — она нейтрально-серая, и подпись обложки не врёт
 * (`part-models`): текстур Rockstar в поставке нет.
 *
 * Сцена — ARS1 (`recolor-shops-scene.js`), как у ангара моделями мода
 * (`mod-place-scene.js`); листы — WebP, по одному на разное содержимое: у
 * десятка моделей площадки один и тот же лист 2048², и по одному разу он и
 * едет окну.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import { inflateRawNode } from "@modovik/rpf7/node";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { facadeOf } from "./building-facade.js";
import { sceneBuilder } from "./mod-place-scene.js";
import { PROP_EXTENT, planModelCover, usableModel } from "./model-cover-plan.js";

/** Лист крупнее этого сжимается: окну хватает, а 2048² на каждую модель — десятки мегабайт. */
const SHEET_MAX = 1024;
/** Рисунок автора (`exact`: полотно на стене) — в полном размере листа, не мельче 4096 по большей стороне. */
const EXACT_SHEET_MAX = 4096;
/** Цвет поверхности, у которой в моде нет листа (нейтральный серый). */
export const NEUTRAL_COLOUR = "#8c8f94";
/** Сколько моделей части читается ради плана: у части без карты размещения их десятки, а не тысячи. */
const SCAN_LIMIT = 300;
/** Наклейки и тени не облик: на земле они мерцают, а в кадр ничего не добавляют. */
const NOT_DRAWN = /decal|shadow|proxy/i;
/** Палитры оттенков (`…_pal`) — не лист: оттенок кладёт шейдер. */
const PALETTE = /_pal$/i;

const toGame = ([x, y, z]) => [x, -z, y];

/* Рисуется ли сетка: не пустая и не наклейка. */
export const isDrawn = (mesh) => Boolean(mesh.indices?.length) && !NOT_DRAWN.test(String(mesh.material?.shader || ""));

/* Режим прозрачности листа в сцене: вырез по альфе — `cutout`, стекло — `blend`. */
const alphaOf = (material) => (material.alphaMode === "mask" ? "cutout" : material.alphaMode === "blend" ? "blend" : "opaque");

async function bytesOf(file) {
  const value = file.bytes ?? (typeof file.read === "function" ? await file.read() : null);
  return value ? new Uint8Array(value) : null;
}

/** Сводка модели для плана: `{ name, triangles, min, max }` (у картинки с вшитым листом ещё `picture`) в осях игры, или `null`, если модель не читается или пуста. */
export function modelFact(name, bytes) {
  const drawable = firstOf(bytes);
  if (!drawable) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const mesh of drawable.meshes.filter(isDrawn)) {
    triangles += mesh.indices.length / 3;
    for (let at = 0; at < mesh.positions.length; at += 3) {
      const point = toGame([mesh.positions[at], mesh.positions[at + 1], mesh.positions[at + 2]]);
      for (let axis = 0; axis < 3; axis += 1) {
        if (point[axis] < min[axis]) min[axis] = point[axis];
        if (point[axis] > max[axis]) max[axis] = point[axis];
      }
    }
  }
  if (!triangles || !Number.isFinite(min[0])) return null;
  /* Картинка автора: плоский квад с вшитым листом (значки подсказок, плакат) — мало треугольников, но не заглушка; у заглушки листа нет (`usableModel`). */
  return drawable.embeddedTextures?.length ? { name, triangles, min, max, picture: true } : { name, triangles, min, max };
}

function firstOf(bytes) {
  try {
    return readDrawable(new Uint8Array(bytes), { inflateRaw: inflateRawNode }).drawables[0] || null;
  } catch {
    return null;
  }
}

/* Признаки материала для поиска фасада: свечение и вывески по имени шейдера и листа, остекление — прозрачность или слово в имени. */
const SIGN_LIKE = /emissive|sign|logo|neon|billboard|banner|entr/i;
const OPEN_LIKE = /glass|window|door|vitr/i;

/** Сетки модели для `building-facade.js`: вершины в осях игры (x, y — по земле, z — вверх), индексы и признаки материала; наклейки и тени не берутся. */
export function modelParts(drawable) {
  return drawable.meshes.filter(isDrawn).map((mesh) => {
    const positions = new Float32Array(mesh.positions.length);
    for (let at = 0; at + 2 < positions.length; at += 3) positions.set(toGame([mesh.positions[at], mesh.positions[at + 1], mesh.positions[at + 2]]), at);
    const material = mesh.material || {};
    const words = `${material.shader || ""} ${material.textures?.diffuse || ""}`;
    return { positions, indices: mesh.indices, open: alphaOf(material) !== "opaque" || OPEN_LIKE.test(words), sign: SIGN_LIKE.test(words) };
  });
}

/** Сколько самых больших моделей проверяется на фасад: кадр строится по главной, остальные нужны, если главной окажется не здание. */
const FACADE_CANDIDATES = 3;

/** Листы словарей мода (`.ytd` из его файлов): имя → самый крупный. */
async function dictionaryRefs(files) {
  const refs = new Map();
  for (const file of files.filter((item) => /\.ytd$/i.test(item.name))) {
    try {
      const bytes = await bytesOf(file);
      if (!bytes) continue;
      for (const ref of readTextureDictionary(bytes, { inflateRaw: inflateRawNode })) keep(refs, ref);
    } catch {
      /* словарь не читается — лист у модели свой или его нет */
    }
  }
  return refs;
}

const pixelsOfRef = (ref) => ref.width * ref.height;

function keep(refs, ref) {
  const name = String(ref.name || "").toLowerCase();
  const had = refs.get(name);
  if (!had || pixelsOfRef(ref) > pixelsOfRef(had)) refs.set(name, ref);
}

/*
 * Листы игры тёмные на вид: свет игры (полуденное солнце, отражения) поднимает их, а студия мастерской светит мягче —
 * банкомат с листом в тридцать из двухсот пятидесяти пяти выходил чёрным силуэтом. Тёмный лист перед отправкой окну
 * подтягивается степенью (тени светлеют, свет остаётся) до средней яркости `SHEET_TARGET`; светлые листы не трогаются.
 */
export const SHEET_TARGET = 104;
const LIFT_STRONGEST = 0.45;

/** Степень подтяжки листа средней яркости `mean` (0…255): 1 — не трогать, меньше 1 — светлее. */
export function liftExponent(mean) {
  if (!(mean > 0) || mean >= SHEET_TARGET) return 1;
  return Math.max(LIFT_STRONGEST, Math.log(SHEET_TARGET / 255) / Math.log(mean / 255));
}

/** Средняя яркость видимых точек RGBA (0…255); прозрачное стекло в счёт не идёт. */
export function meanLuminance(rgba) {
  let sum = 0;
  let seen = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] < 16) continue;
    sum += 0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2];
    seen += 1;
  }
  return seen ? sum / seen : 0;
}

/** Подтянуть тёмный лист на месте (RGBA, альфа не трогается); возвращает использованную степень. */
export function liftDarkSheet(rgba) {
  const exponent = liftExponent(meanLuminance(rgba));
  if (exponent >= 1) return 1;
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) table[value] = Math.round(255 * (value / 255) ** exponent);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = table[rgba[at]];
    rgba[at + 1] = table[rgba[at + 1]];
    rgba[at + 2] = table[rgba[at + 2]];
  }
  return exponent;
}

/*
 * Объёмы-подсказки автора (прострелы: «здесь стена простреливается») — «призрачные» листы: прозрачность меньше половины (`GHOST_ALPHA`), у ALLIANCE V3 это четверть (Gray) и восьмая (RP).
 * Такой кадр — не здание: фасада (`building-facade.js`) и стороны у объёмов нет, обложка — общий вид площадки (`part-covers.js`). И не у всех призраков цвет читается на тёмной студии:
 * у Gray читается, у RP тёмно-фиолетовый на почти чёрном полу сливается с ним, и ворота обложки (`cover-gate.js`) честно говорят «в кадре пусто». Перекрашивать объём нельзя (цвет и прозрачность —
 * автора), поэтому меняется не он, а фон: если почти все сетки кадра призрачны и на тёмном полу студии видны хуже `FAINT_CONTRAST`, кадр снимается на светлой студии (`backdrop: "light"`), где тот же цвет
 * читается лучше. Видимость листа — `доля непрозрачности × наибольшая разница цвета с полом` (0…255): у (255, 27, 255) при 12,5 % — 29, при 25 % — 58.
 */
/** Яркость пола студии мастерской (`orbit-stage.js: uColour`, 0…255). */
export const STUDIO_FLOOR_TONE = 22;
/** Лист призрачный: средняя непрозрачность ниже этой (0…1). */
export const GHOST_ALPHA = 0.5;
/** Видимость листа на полу студии (0…255), ниже которой он «сливается» с полом. */
export const FAINT_CONTRAST = 40;
/** Доля треугольников кадра с такими листами, с которой кадр — набор объёмов (`ghost`) на светлой студии (`faint`). */
export const GHOST_SHARE = 0.8;

/** Видимость листа на тёмном полу: `stats` — `{ alpha: 0…1, colour: [r, g, b] }` (`sheetStats`). */
export const contrastOnFloor = ({ alpha, colour }, floor = STUDIO_FLOOR_TONE) => alpha * Math.max(...colour.map((value) => Math.abs(value - floor)));

/** Призрачный лист: заметно прозрачный (объём-подсказка, не стена и не стекло двери). */
export const isGhost = (stats) => Boolean(stats) && stats.alpha < GHOST_ALPHA;

/** Призрачный лист, который на тёмной студии не виден: пол затмевает цвет. */
export const isFaint = (stats) => isGhost(stats) && contrastOnFloor(stats) < FAINT_CONTRAST;

/** Средняя непрозрачность и цвет листа (по видимым точкам, с весом непрозрачности) по RGBA: `{ alpha: 0…1, colour: [r, g, b] }`. */
export function sheetStats(rgba) {
  let alpha = 0;
  const sum = [0, 0, 0];
  const points = rgba.length / 4;
  for (let at = 0; at < rgba.length; at += 4) {
    const weight = rgba[at + 3];
    alpha += weight;
    for (let channel = 0; channel < 3; channel += 1) sum[channel] += rgba[at + channel] * weight;
  }
  return { alpha: points ? alpha / (points * 255) : 0, colour: sum.map((value) => (alpha ? value / alpha : 0)) };
}

/** Сколько точек листа достаточно, чтобы узнать его непрозрачность и цвет: берётся мелкий уровень, а не полный лист. */
const STATS_SIDE = 64;

/**
 * Какая доля треугольников кадра — призрачные листы и какая из них не видна на тёмной студии (`GHOST_SHARE`, `FAINT_CONTRAST`): `{ ghost, faint }` (0…1). Считается по плану
 * (`modelCoverPlan`) до сборки сцены и до здания из игры: объёмы-подсказки на штатное здание не ставятся (`part-covers.js`). Листы читаются мелким уровнем; непрозрачные материалы листа не просят.
 */
export async function ghostShare({ files, plan }) {
  const byName = new Map(files.map((file) => [String(file.name).toLowerCase(), file]));
  const dictionary = await dictionaryRefs(files);
  const looks = new Map();
  let drawn = 0;
  let ghost = 0;
  let faint = 0;
  for (const item of plan.items) {
    const file = byName.get(item.name.toLowerCase());
    const bytes = file ? await bytesOf(file).catch(() => null) : null;
    const drawable = bytes ? firstOf(bytes) : null;
    if (!drawable) continue;
    const refs = new Map(dictionary);
    for (const ref of drawable.embeddedTextures || []) keep(refs, ref);
    for (const mesh of drawable.meshes.filter(isDrawn)) {
      const triangles = mesh.indices.length / 3;
      drawn += triangles;
      if (alphaOf(mesh.material || {}) !== "blend") continue;
      const name = String(mesh.material?.textures?.diffuse || "").toLowerCase();
      const ref = name && !PALETTE.test(name) ? refs.get(name) : null;
      if (!ref) continue;
      const key = `${name}|${ref.width}x${ref.height}|${ref.dataAt}`;
      if (!looks.has(key)) {
        try {
          looks.set(key, sheetStats(decodeTextureRef(ref, { maxSize: STATS_SIDE }).rgba));
        } catch {
          looks.set(key, null);
        }
      }
      const stats = looks.get(key);
      if (isGhost(stats)) ghost += triangles;
      if (isFaint(stats)) faint += triangles;
    }
  }
  return { ghost: drawn ? ghost / drawn : 0, faint: drawn ? faint / drawn : 0 };
}

/**
 * Лист → WebP: до `SHEET_MAX` по большей стороне, с отпечатком содержимого (до подтяжки — одинаковые листы сводятся). `exact` — рисунок автора как есть: полный размер и
 * без подтяжки тёмного (полотно на стене — картинка, а не поверхность модели, её цвет автор выбрал сам).
 */
async function sheetOf(ref, { exact = false } = {}) {
  const level = decodeTextureRef(ref, { maxSize: exact ? EXACT_SHEET_MAX : SHEET_MAX });
  const rgba = Buffer.from(level.rgba.buffer, level.rgba.byteOffset, level.rgba.byteLength);
  const print = createHash("sha1").update(rgba).digest("hex") + (exact ? ":exact" : "");
  /* Копия: ресурс модели читателем не владеем, его байты не правим. */
  const lifted = Buffer.from(rgba);
  if (!exact) liftDarkSheet(lifted);
  return {
    print,
    bytes: async () =>
      new Uint8Array(
        await sharp(lifted, { raw: { width: level.width, height: level.height, channels: 4 } })
          .webp({ quality: 90, alphaQuality: 90, effort: 3 })
          .toBuffer(),
      ),
  };
}

/**
 * Файлы мода → решение кадра: `{ plan, facts }` — или `null`, если рисовать нечего. `files` — `[{ name, bytes | read }]`,
 * `hint` — латиница названия части (id заявки), по ней ищется модель, о которой часть.
 */
export async function modelCoverPlan(files, { hint = "", placed = new Set() } = {}) {
  const facts = [];
  const taken = [];
  for (const file of files.filter((item) => /\.(ydr|yft)$/i.test(item.name)).slice(0, SCAN_LIMIT)) {
    const bytes = await bytesOf(file).catch(() => null);
    const fact = bytes ? modelFact(file.name, bytes) : null;
    if (fact) {
      facts.push(fact);
      taken.push([fact, file]);
    }
  }
  await withFacades(taken);
  const plan = planModelCover(facts, { hint, placed });
  return plan ? { plan, facts } : null;
}

/*
 * Фасад (`building-facade.js`) — у самых больших моделей-зданий: площадь основания больше вещи, не запасной уровень и не служебная. У остальных (вещи, заглушки)
 * сторон нет, читать их не нужно. Модель, что не читается или не складывается в прямоугольник, остаётся без `facade`.
 */
async function withFacades(taken) {
  const base = ([fact]) => (fact.max[0] - fact.min[0]) * (fact.max[1] - fact.min[1]);
  const buildings = taken
    .filter(([fact]) => usableModel(fact) && Math.max(fact.max[0] - fact.min[0], fact.max[1] - fact.min[1]) > PROP_EXTENT)
    .sort((left, right) => base(right) - base(left))
    .slice(0, FACADE_CANDIDATES);
  for (const [fact, file] of buildings) {
    const bytes = await bytesOf(file).catch(() => null);
    const drawable = bytes ? firstOf(bytes) : null;
    const found = drawable ? facadeOf(modelParts(drawable)) : null;
    if (found) fact.facade = found;
  }
}

/** Куда сцена «кладёт» листы игры, которых нет в моде: общие словари города (`gtxd`), как ищет их игра (`part-sheets.js`, `sceneSheets`). */
export const FILL_GAME = "x64g.rpf:levels/gta5/generic/gtxd.rpf/_";
/** Ключ листа игры в файлах кадра — тот же, что у `sheetKey` (`part-sheets.js`): окно ищет лист записи сцены по нему. */
export const fillKey = (name) => `game:${FILL_GAME}/${name}`.toLowerCase();
/** Сколько листов игры просится за кадр: у моделей мода без листа их десятки, а не сотни. */
const FILL_LIMIT = 48;

/**
 * Сцена кадра по плану: `{ bytes, sheets: [{ key, bytes }], textured, bare, filled }` — ARS1 и листы WebP для съёмщика, число
 * треугольников с листом (мода или игры) и без него (у `bare` поверхность нейтрально-серая). `fill` — `async (names) => Map(имя → { bytes })`:
 * листы игры тем, чего в моде нет (печь с `--game`; без неё модель без листа серая — листов Rockstar в поставке нет). `null`, если ни одна
 * модель плана не собралась.
 */
export async function modelsScene({ files, plan, fill = null, asScene = false }) {
  const byName = new Map(files.map((file) => [String(file.name).toLowerCase(), file]));
  const dictionary = await dictionaryRefs(files);
  const sheets = new Map();
  /* Первый проход: что у модели есть из мода и каких листов нет — их спросим у игры одним запросом. */
  const loaded = [];
  const missing = new Set();
  for (const item of plan.items) {
    const file = byName.get(item.name.toLowerCase());
    const bytes = file ? await bytesOf(file).catch(() => null) : null;
    const drawable = bytes ? firstOf(bytes) : null;
    if (!drawable) continue;
    const refs = new Map(dictionary);
    for (const ref of drawable.embeddedTextures || []) keep(refs, ref);
    /* Лист модели — самый крупный из зашитого и словарного с этим именем. */
    const found = new Map();
    const sheetFor = async (name) => {
      if (found.has(name)) return found.get(name);
      let sheet = null;
      const ref = PALETTE.test(name) ? null : refs.get(name);
      if (ref) {
        try {
          const made = await sheetOf(ref, { exact: item.exact === true });
          if (!sheets.has(made.print)) sheets.set(made.print, { index: sheets.size, made });
          sheet = sheets.get(made.print).index;
        } catch {
          sheet = null;
        }
      }
      found.set(name, sheet);
      if (sheet === null && name && !PALETTE.test(name)) missing.add(name);
      return sheet;
    };
    for (const mesh of drawable.meshes.filter(isDrawn)) {
      const name = String(mesh.material?.textures?.diffuse || "").toLowerCase();
      if (name) await sheetFor(name);
    }
    loaded.push({ item, drawable, found });
  }
  /* Листы игры — тем, чего в моде нет; не пришли — поверхность остаётся серой, как была. */
  let gameSheets = new Map();
  if (fill && missing.size) gameSheets = await fill([...missing].slice(0, FILL_LIMIT)).catch(() => new Map());
  const builder = sceneBuilder({ colour: NEUTRAL_COLOUR });
  const counted = { textured: 0, bare: 0, filled: 0 };
  /* Какие сетки сцены чья: `{ name, from, to }` — сетки `from…to` идут от модели `name` (по порядку добавления; нужно планировщику ракурсов изнутри). */
  const spans = [];
  let meshAt = 0;
  for (const { item, drawable, found } of loaded) {
    for (const mesh of drawable.meshes.filter(isDrawn)) {
      const name = String(mesh.material?.textures?.diffuse || "").toLowerCase();
      const own = name ? found.get(name) : null;
      const game = own === null || own === undefined ? Boolean(name && gameSheets.has(name)) : false;
      counted[own !== null && own !== undefined ? "textured" : game ? "filled" : "bare"] += mesh.indices.length / 3;
    }
    const from = meshAt;
    /* `item.move` / `item.turn` — своё место вещи (карта части ставит её с поворотом и масштабом); без них — сдвиг `at` и опускание на землю. */
    builder.add(drawable, {
      move:
        item.move ||
        (([x, y, z]) => [x + item.at[0], y + item.at[1], z - item.ground]),
      ...(item.turn ? { turn: item.turn } : {}),
      keep: (mesh) => {
        if (!isDrawn(mesh)) return false;
        meshAt += 1;
        return true;
      },
      alphaOf: item.alpha ? () => item.alpha : alphaOf,
      textureOf: (name) => {
        const index = found.get(name);
        if (index !== null && index !== undefined) return { key: `m${index}`, entry: { name: `m:${index}`, set: "mod", resource: "models", texture: `m${index}` } };
        if (gameSheets.has(name)) return { key: fillKey(name), entry: { name: `g:${name}`, game: FILL_GAME, texture: name } };
        return null;
      },
    });
    spans.push({ name: item.name, from, to: meshAt });
  }
  /* `asScene` — сцена объектом, без кодирования: её склеивают со сценой места из игры (`stock-building.js`). */
  const scene = asScene ? builder.scene("models") : null;
  const bytes = asScene ? null : builder.finish("models");
  if (asScene ? !scene : !bytes) return null;
  const list = [];
  for (const { index, made } of sheets.values()) list.push({ key: `set:mod/models/m${index}`, bytes: await made.bytes() });
  /* Листы игры — только те, что сцена взяла. */
  for (const [name, sheet] of gameSheets) list.push({ key: sheet.key || fillKey(name), bytes: sheet.bytes });
  return {
    bytes,
    ...(asScene ? { scene } : {}),
    sheets: list,
    spans,
    ...counted,
  };
}
