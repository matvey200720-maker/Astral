/*
 * Растительность: работа над файлами — перекраска листвы и земли, трава,
 * склады поставки (05.10.2026, вынесено из `recolor-vegetation.js`).
 *
 * Модуль чистый: ни окна, ни архивов игры, ни Electron. Поэтому его же
 * грузят потоки сборки (`vegetation-build-worker.js`): каждый файл работы
 * собирается отдельно от остальных, и пустыня целиком — полторы тысячи
 * словарей — собирается на всех ядрах процессора, а не на одном.
 *
 * Где файл ни собери — в главном процессе или в потоке, — выходит тот же
 * байт в байт: облик работы и склад «Сэнди» читаются из одних и тех же
 * данных (`createVegetationContext`), а правки одного файла ложатся в
 * одном порядке (`processVegetationJob`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildMipChain, decodeTexture, downsample, encodeBc7, encodeBlocks, levelBytes } from "@modovik/dds";
import { readDrawable } from "@modovik/rage-drawable";
import { openResourcePlain, openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import VEGETATION_PACKS from "@modovik/climb-contract/recolor/inventory/vegetation-packs";
import { bytesHex, hexBytes } from "@modovik/climb-contract/recolor/colour";
import {
  GRASS_ZONE_IDS,
  VEGETATION_WORLD,
  areaOfMapName,
  bushShare,
  compileVegetationEffect,
  compileVegetationLooks,
  flowerBatchChooser,
  grassZoneCentre,
  isBushCard,
  isBushFile,
  isNonPlantBatch,
  neutralisePalette,
  normalizeVegetationProject,
  plantSpriteIsFlower,
  recolourPlantSprite,
  plantTrees,
  recolourLeafLevel,
  sandyColourAt,
  sandyColourField,
  speciesShare,
  treeChooser,
  varietyActive,
  varietyArchetypeChooser,
  varietyGrassChooser,
  varietyPainted,
  varietySlots,
  vegetationSpeciesOf,
} from "@modovik/climb-contract/recolor/vegetation";
/* «В разнобой»: опись копий деревьев и кустов (задача 7 ТЗ 17.10.2026). */
import VEGETATION_VARIETY from "@modovik/climb-contract/recolor/inventory/vegetation-variety";
import {
  grassInstanceColour,
  grassReference,
  grassTarget,
  recolourDistantBlocks,
  recolourDistantSand,
  recolourGrass,
  setNativeGrassKernels,
  toYcc,
} from "@modovik/climb-contract/recolor/grass-colour";
import { compressResource, openAssetPack, readAssetPackParts } from "./asset-pack.js";
import { DEFAULT_RESOURCE_LEVEL, openResourceTextures, patchResourceTextures, readResourceTextures } from "./recolor-textures.js";
import { patchMapEntityArchetypes, readMapEntities } from "./place-isolation.js";
import { appendGrassBatches, appendMapEntities, readMapEntityPlaces } from "./map-entities-append.js";
/* Посадка: план рядов, полос и клумб засаженности (ТЗ 11.10.2026). */
import VEGETATION_PLANTING from "@modovik/climb-contract/recolor/inventory/vegetation-planting";
import { deflateRaw, grassKernels, inflateResource } from "@modovik/native-rs";

/* Ядра цвета травы на Rust (15.11.2026): циклы `grass-colour.js` по пикселям и блокам; нет модуля или `ASTRAL_RECOLOR_KERNELS=0` — JS. */
setNativeGrassKernels(grassKernels);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const LEAF_SHADERS = new Set(
  ["trees", "trees_normal", "trees_normal_spec", "trees_normal_diffspec", "trees_tnt", "trees_normal_spec_tnt", "trees_normal_diffspec_tnt"].map(
    (name) => jenkins(name),
  ),
);
const DIFFUSE = jenkins("DiffuseSampler");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inflateRaw = inflateResource;

function jenkins(text) {
  const value = String(text).toLowerCase();
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
}

/* ------------------------------------------------------------------ *
 * Текстуры
 * ------------------------------------------------------------------ */

function encodeLevel(format, rgba, width, height) {
  if (format === "BC7") return encodeBc7(rgba, width, height);
  if (format === "DXT1" || format === "DXT3" || format === "DXT5") return encodeBlocks(format, rgba, width, height);
  if (format === "A8R8G8B8" || format === "A8B8G8R8") {
    const out = new Uint8Array(width * height * 4);
    for (let at = 0; at < out.length; at += 4) {
      out[at] = format === "A8R8G8B8" ? rgba[at + 2] : rgba[at];
      out[at + 1] = rgba[at + 1];
      out[at + 2] = format === "A8R8G8B8" ? rgba[at] : rgba[at + 2];
      out[at + 3] = rgba[at + 3];
    }
    return out;
  }
  return null;
}

/* Байт первого уровня mip. */
const firstLevelBytes = (texture) => levelBytes(texture.format, texture.width, texture.height);

/*
 * Каждый уровень mip: `recolour(rgba, w, h, уровень)`; неизменный — байт в
 * байт. Уровни дальше `texture.writable` (хвост mip, общий с соседней
 * текстурой) не трогаются: их байты — и чужие тоже.
 */
function recolourTexture(texture, recolour) {
  const payload = Buffer.from(texture.payload);
  const limit = Math.min(payload.length, texture.writable ?? payload.length);
  let offset = 0;
  let changed = false;
  for (let level = 0; level < texture.levels; level += 1) {
    const width = Math.max(1, texture.width >> level);
    const height = Math.max(1, texture.height >> level);
    const size = levelBytes(texture.format, width, height);
    if (offset + size > limit) break;
    const rgba = decodeTexture(texture.format, payload.subarray(offset, offset + size), width, height);
    const next = recolour(rgba, width, height, level);
    if (next !== rgba) {
      const encoded = encodeLevel(texture.format, next, width, height);
      if (!encoded || encoded.length !== size) return null;
      payload.set(encoded, offset);
      changed = true;
    }
    offset += size;
  }
  return changed ? payload : null;
}

/*
 * Листы листвы в модели: DiffuseSampler материалов `trees_*`.
 *
 * Покраска: лист изгороди на обычном шейдере (11.10.2026). У «Реалистичных
 * деревьев» стриженые кусты (`prop_bush_ornament_01…04`, `prop_bush_neat_*`)
 * нарисованы шейдерами `default`/`normal` листом изгороди (`rsn_am_hedge_01`,
 * `nxg_im_branches_40_tile`) — по одному шейдеру их не найти, и кусты
 * оставались зелёными при своём цвете кустов.
 */
const HEDGE_SHEET = /(hedge|ivy|leaf|leaves|foliage|branches_\d+[a-z]?_tile|privet|topiary)/;

/**
 * Листы модели: `leaves` — листва `trees_*`, `sheets` — листы изгороди на других
 * шейдерах. `opened` — уже открытый ресурс файла (разжатие одно на файл).
 */
function leafSheetsOf(bytes, kind, opened = null) {
  const leaves = new Set();
  const sheets = new Set();
  try {
    const resource = opened || openResourceWith(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
    for (const drawable of readDrawable(resource, { inflateRaw, kind }).drawables || [])
      for (const material of drawable.materials || []) {
        if (!material) continue;
        const sampler = (material.samplers || []).find((item) => (item.sampler >>> 0) === DIFFUSE && item.texture);
        if (!sampler) continue;
        const name = String(sampler.texture).toLowerCase();
        if (LEAF_SHADERS.has(material.shaderHash >>> 0)) leaves.add(name);
        else if (HEDGE_SHEET.test(name)) sheets.add(name);
      }
  } catch {
    /* модель не читается — листвы нет */
  }
  for (const name of leaves) sheets.delete(name);
  return { leaves, sheets };
}

const salt = (name) => jenkins(name) & 0xffff;

/**
 * Листва в файле в облике работы или `null`, если она не меняется.
 * `leaves` — имена листов, `card` — карточки вдали, `species(имя листа)` —
 * доля породы для «По породам».
 */
export function recolourLeafFile(bytes, fileName, leaves, looks, options = {}) {
  const editor = openResourceTextures(bytes, fileName);
  const species = options.species || (() => 0.5);
  const style = (name) => ({ compiled: looks.trees.compiled, foliage: looks.trees.foliage, species: species(name) });
  return recolourLeafTextures(editor, leaves, style, options) ? editor.finish({ level: DISTANT_DEFLATE }) : null;
}

/*
 * Облик листа: листва деревьев или кустов (задача 2 ТЗ 10.10.2026, вечер —
 * у кустов и живых изгородей свой цвет, у пород — свой цвет поверх облика
 * листвы). `looks` — `compileVegetationLooks`, `share` — доля «По породам» /
 * «По видам кустов», `speciesId` — порода листа. `null` — лист как в игре.
 */
function treeStyle(looks, share, speciesId = null) {
  const { trees } = looks;
  const compiled = (speciesId && trees.bySpecies?.[speciesId]) || trees.compiled;
  return compiled || trees.foliage < 100 ? { compiled, foliage: trees.foliage, species: share } : null;
}
/* Доля куста в эффекте: «как листва» — порода «Кусты» («По породам», как
   до 10.10.2026), свой цвет — у каждой модели и листа своя («По видам кустов»). */
const bushShareOf = (looks, name) => (looks.bushes?.follow ? speciesShare("bush") : bushShare(name));
function bushStyle(looks, share, { opaque = false } = {}) {
  const { bushes } = looks;
  if (!bushes || (!bushes.compiled && bushes.foliage >= 100)) return null;
  /* Изгородь — сплошной лист без среза по альфе: густоты у неё нет, только цвет. */
  if (opaque && !bushes.compiled) return null;
  return { compiled: bushes.compiled, foliage: opaque ? 100 : bushes.foliage, species: share };
}

/**
 * Та же листва в открытом файле (`openResourceTextures`): легла ли она.
 * `styleOf(имя листа)` — облик листа (`treeStyle`/`bushStyle`) или `null`.
 */
function recolourLeafTextures(editor, leaves, styleOf, { card = false, leafOnly = false } = {}) {
  const wanted = new Set([...leaves].map((name) => name.toLowerCase()));
  const replacements = {};
  for (const texture of editor.textures()) {
    const name = texture.name.toLowerCase();
    /* Хвост mip общий с соседней текстурой (так пересохранены модели
       «Реалистичных деревьев», напр. колючки кактуса, и словари ступени
       «Ухудшения текстур» — карточки деревьев 8 × 8): красятся уровни до
       общего хвоста, хвост — как есть (задача 5 ТЗ 06.10.2026, вечер; прежде
       такой лист оставался штатным целиком — зелёные деревья вдали). Общий
       уже первый уровень — лист как есть, а не роняет весь пакет. */
    if (!wanted.has(name) || texture.writable < firstLevelBytes(texture)) continue;
    const style = styleOf(name);
    if (!style) continue;
    const payload = recolourTexture(texture, (rgba, width, height, level) =>
      recolourLeafLevel(rgba, width, height, {
        compiled: style.compiled,
        foliage: style.foliage,
        species: style.species,
        card,
        leafOnly,
        level,
        salt: salt(name),
      }),
    );
    if (payload) replacements[texture.name] = payload;
  }
  if (!Object.keys(replacements).length) return false;
  editor.patch(replacements);
  return true;
}

/* ------------------------------------------------------------------ *
 * «Зелёный Сэнди Шорс»
 * ------------------------------------------------------------------ */

/* Картинка в другой размер: вдвое усреднением, пока больше чем вдвое,
   дальше — билинейно (и вверх — тоже билинейно). */
function resizeRgba(rgba, width, height, nextWidth, nextHeight) {
  let current = rgba;
  let w = width;
  let h = height;
  while (w >= nextWidth * 2 && h >= nextHeight * 2) {
    current = downsample(current, w, h);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  if (w === nextWidth && h === nextHeight) return current;
  const out = new Uint8ClampedArray(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y += 1) {
    const sy = Math.max(0, Math.min(h - 1, ((y + 0.5) * h) / nextHeight - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < nextWidth; x += 1) {
      const sx = Math.max(0, Math.min(w - 1, ((x + 0.5) * w) / nextWidth - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const to = (y * nextWidth + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const top = current[(y0 * w + x0) * 4 + c] * (1 - fx) + current[(y0 * w + x1) * 4 + c] * fx;
        const bottom = current[(y1 * w + x0) * 4 + c] * (1 - fx) + current[(y1 * w + x1) * 4 + c] * fx;
        out[to + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return out;
}

/**
 * Лист мода на месте текстуры игры: размер, формат и число mip — как у
 * штатной (`target`), цвет травы — `colour` (или как у мода). `image` —
 * запись плана, `payload` — её байты из склада (у ровной — `null`).
 * Байты той же длины, что у штатной, или `null`, если формат не пишется.
 */
export function greenTexturePayload(image, payload, target, colour = null) {
  let width = image.width;
  let height = image.height;
  let rgba;
  if (image.flat) {
    width = target.width;
    height = target.height;
    rgba = new Uint8ClampedArray(width * height * 4);
    const [r, g, b] = hexBytes(image.flat);
    for (let at = 0; at < rgba.length; at += 4) {
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      rgba[at + 3] = 255;
    }
  } else rgba = decodeTexture(image.format, payload.subarray(0, levelBytes(image.format, width, height)), width, height);
  if (colour) rgba = recolourGrass(rgba, colour);
  rgba = resizeRgba(rgba, width, height, target.width, target.height);
  const parts = [];
  for (const level of buildMipChain(rgba, target.width, target.height, target.levels)) {
    const encoded = encodeLevel(target.format, level.rgba, level.width, level.height);
    if (!encoded) return null;
    parts.push(Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength));
  }
  const out = Buffer.concat(parts);
  return out.length === target.bytes ? out : null;
}

/**
 * Файл игры с зелёными листами плана: `textures` — `[[имя, картинка, цвет?]]`,
 * `sandy` — открытый склад (`openGreenSandy`), `cache` — готовые листы
 * между файлами (одна картинка мода стоит в сотнях мест). Возвращает
 * `{ bytes, count }` или `null`, если в файле ничего не легло.
 */
export function patchGreenFile(bytes, fileName, textures, sandy, colour, cache = new Map()) {
  const { replacements, count } = greenSheetPayloads(readResourceTextures(bytes, fileName), textures, sandy, colour, cache);
  if (!count) return null;
  return { bytes: patchResourceTextures(bytes, fileName, replacements).bytes, count };
}

/** Новые пиксели зелёных листов плана: `{ replacements: { имя: байты }, count }` по листам `refs` файла. */
function greenSheetPayloads(refList, textures, sandy, colour, cache) {
  const refs = new Map(refList.map((ref) => [ref.name.toLowerCase(), ref]));
  const replacements = {};
  let count = 0;
  for (const [name, imageId, tint] of textures) {
    const ref = refs.get(name);
    /* Нет текстуры (другая версия игры) или общий с соседней уже первый уровень — мимо.
       Покраска: общий хвост mip (словари, пересохранённые ретекстуром и «Ухудшением
       текстур») остаётся как есть, уровни до него — картинкой мода (11.10.2026). */
    if (!ref || ref.writable < firstLevelBytes(ref)) continue;
    const image = sandy.plan.images[imageId];
    if (!image) continue;
    const own = tint && colour ? colour : null;
    const key = `${imageId}|${ref.format}|${ref.width}x${ref.height}|${ref.levels}|${own || ""}`;
    let payload = cache.get(key);
    if (payload === undefined) {
      payload = greenTexturePayload(image, image.flat ? null : sandy.image(imageId), ref, own);
      cache.set(key, payload);
    }
    if (!payload) continue;
    replacements[ref.name] = ref.writable < ref.bytes ? keepSharedTail(payload, ref) : payload;
    count += 1;
  }
  return { replacements, count };
}

/*
 * Покраска: новые байты листа с общим хвостом mip — уровни, что целиком до
 * хвоста, новые, дальше — прежние байты (их делит соседняя текстура).
 */
function keepSharedTail(payload, ref) {
  let boundary = 0;
  for (let level = 0; level < ref.levels; level += 1) {
    const size = levelBytes(ref.format, Math.max(1, ref.width >> level), Math.max(1, ref.height >> level));
    if (boundary + size > ref.writable) break;
    boundary += size;
  }
  const out = Buffer.from(payload);
  Buffer.from(ref.payload).copy(out, boundary, boundary);
  return out;
}

/* ------------------------------------------------------------------ *
 * Дальние планы загородной карты (задача 10)
 * ------------------------------------------------------------------ */

/*
 * Дальние планы — как у мода, но во всей зоне. Мод кладёт свои листы
 * (трава, маски, нормали) в 335 словарей; тот же лист под тем же именем
 * стоит и в сотнях дальних словарей, которых в моде нет, — там вдали
 * оставался штатный песок. Поэтому:
 *   1. лист с именем листа мода получает картинку мода;
 *   2. уменьшенная копия листа мода (`…_lod`, `…_slod1`, `nxg_…`) — ту же
 *      картинку в своём размере;
 *   3. атлас SLOD (вид сверху, запечён с земли игры) — песок и сухая трава
 *      в цвет травы по месту на карте;
 *   4. остальное — как в игре: вблизи мод его тоже не трогает (дороги,
 *      скалы, пляжи, сухая трава холмов), и вдали не будет «наоборот».
 */
const SHEET_SUFFIX = /(_slod\d?|_lod\d?|_l\d)$/;
/** Имя листа вблизи для листа дальнего плана: `cs_x_lod` → `cs_x`. */
export const distantSheetBase = (name) => String(name).toLowerCase().replace(/^nxg_/, "").replace(SHEET_SUFFIX, "");

/**
 * Листы мода по имени: `exact` — имя → `[картинка, оттенок]`, `base` — имя
 * листа вблизи → то же (из нескольких картинок одного имени — самая
 * крупная).
 */
export function modSheetsOf(plan) {
  const exact = new Map();
  const base = new Map();
  const area = (id) => (plan.images[id]?.width || 0) * (plan.images[id]?.height || 0);
  const put = (map, key, imageId, tint) => {
    const was = map.get(key);
    if (!was || area(imageId) > area(was[0])) map.set(key, [imageId, tint]);
  };
  for (const target of plan.targets || [])
    for (const [name, imageId, tint] of target.textures || []) {
      if (!plan.images[imageId]) continue;
      put(exact, name, imageId, tint);
      put(base, distantSheetBase(name), imageId, tint);
    }
  return { exact, base };
}

/**
 * Листы мода для словаря дальнего плана: `[[имя, картинка, оттенок]]` по
 * его листам `names`, без листов, что уже кладёт план мода (`own`).
 */
export function distantModSheets(names, sheets, own = new Set()) {
  const out = [];
  for (const raw of names) {
    const name = String(raw).toLowerCase();
    if (own.has(name)) continue;
    const base = distantSheetBase(name);
    const sheet = sheets.exact.get(name) || (base !== name ? sheets.base.get(base) : null);
    if (sheet) out.push([name, sheet[0], sheet[1]]);
  }
  return out;
}

/*
 * Какие атласы — земля: карточки деревьев красит листва; маски, нормали и
 * блеск — данные; ночные окна, дома, дороги, вода, пляжи, тюрьма и щиты —
 * не трава (вблизи мод их тоже не трогает).
 */
/* Покраска: палитры тинта (`*_pal`) — не атласы, а таблицы: их обесцвечивает
   `neutralisePalette`, а не сдвиг по месту на карте (11.10.2026). */
const DISTANT_SKIP =
  /(^(slod_prop_|slod\d?_veg_|prop_|test_tree)|_pal$|_pal_|_lut$|mask|msk|_n$|_n_|_nm$|_nrm|normal|_s$|_spec|_h$|_height|_bump|emissive|window|night|roof|wall|build|_bld|door|fenc|fnc|rail|bridge|concrete|tarmac|asphalt|road|runway|parking|pavement|kerb|metal|wood|brick|tile|glass|sign|billb|water|river|sea_|_sea|seabed|_uw|pool|beach|prison|hangar|helipad|graffiti|decal)/;
/*
 * Атлас дальнего плана — вид сверху на свою рамку, тексель ложится на карту:
 * по имени SLOD/xref или по имени квартала — сам квартал (`cs4_01`) или его
 * земля (`ch1_07_ground_lod`, `ch1_11_land_lod`, `ch1_02_terrain`).
 */
/* …и атласы SLOD2 района по имени модели (`ch2_lod3_s2a`, `cs6_lod_06_s2`):
   у них в имени нет «slod», и холмы вдали оставались песком (задача 7 ТЗ
   10.10.2026). */
const ATLAS = /(slod|superlod|xref|_lod\d*_s\d+[a-z]?$)/;
/* Кварталы загорода (`cs`, `ch`) и города (`bh`, `dt`, `hw`, `id`, `kt`, `po`, `sc`, `sm`,
   `ss`, `sp`, `vb`, `ap`): земля квартала вдали — атлас. */
const BLOCK_ATLAS = /^(cs|ch|bh|dt|hw|id|kt|po|sc|sm|ss|sp|vb|ap)\d+[a-z]?_(\d+[a-z]?$|.*(ground|terrain|land|grnd))/;
/** Атлас земли дальнего плана, который красится по цвету (п. 3 выше). */
export const isDistantAtlas = (name) => {
  const key = String(name).toLowerCase();
  return (ATLAS.test(key) || BLOCK_ATLAS.test(key)) && !DISTANT_SKIP.test(key);
};

/**
 * Атласы SLOD в цвет травы: `colourOf(x, y)` — байты цвета травы в точке
 * мира (или `null` — там травы нет), `place` — рамка файла `[cx, cy, minX,
 * minY, maxX, maxY]`, `skip` — листы, что уже положил мод; `greens`, `sand`,
 * `gain`, `albedo` — как у `recolourDistantSand`. Возвращает байты файла или
 * `null`, если в нём ничего не поменялось.
 */
export function recolourDistantFile(bytes, fileName, options) {
  const replacements = distantAtlasPayloads(readResourceTextures(bytes, fileName), options);
  if (!Object.keys(replacements).length) return null;
  return patchResourceTextures(bytes, fileName, replacements, { level: DISTANT_DEFLATE }).bytes;
}

/* Словари зоны — сотни мегабайт листов DXT: первый уровень сжатия втрое быстрее шестого за +1,8 % размера (замер на 150 настоящих словарях текстур —
   `DEFAULT_RESOURCE_LEVEL` в recolor-textures.js; в профиле сборки растительности сжатие шестым — 54 из 162 с процессора). Прежде: шестой, ~1 % крупнее девятого. */
const DISTANT_DEFLATE = DEFAULT_RESOURCE_LEVEL;

/**
 * Новые пиксели атласов файла: `{ имя: байты }` по листам `refs`
 * (`readResourceTextures`). DXT — прямо в блоках (`recolourDistantBlocks`),
 * остальные форматы — раскодированием.
 */
function distantAtlasPayloads(refs, { colourOf, place = null, skip = new Set(), greens = false, sand = true, gain = null, albedo = 0.2, zone = "country" }) {
  const replacements = {};
  const options = { greens, sand, gain, albedo };
  const centre = place ? [place[0], place[1]] : grassZoneCentre(zone);
  const fixed = colourOf(centre[0], centre[1]);
  const framed = Boolean(place) && place[4] > place[2] && place[5] > place[3];
  for (const texture of refs) {
    const name = texture.name.toLowerCase();
    /* Общий с соседней уже первый уровень — на месте не переписать; общий хвост
       mip остаётся как есть (покраска 11.10.2026). */
    if (skip.has(name) || !isDistantAtlas(name) || texture.writable < firstLevelBytes(texture)) continue;
    const colourAt = (width, height) =>
      framed
        ? (px, py) => colourOf(place[2] + ((px + 0.5) / width) * (place[4] - place[2]), place[5] - ((py + 0.5) / height) * (place[5] - place[3]))
        : () => fixed;
    const payload = BLOCK_FORMATS.has(texture.format)
      ? recolourTextureBlocks(texture, (level, width, height) => recolourDistantBlocks(level, texture.format, width, height, colourAt(width, height), options))
      : recolourTexture(texture, (rgba, width, height) => recolourDistantSand(rgba, width, height, colourAt(width, height), options));
    if (payload) replacements[texture.name] = payload;
  }
  return replacements;
}

const BLOCK_FORMATS = new Set(["DXT1", "DXT3", "DXT5"]);

/* Каждый уровень mip сжатым: `recolour(байты уровня, w, h)` → новые байты или `null`.
   Уровни дальше `texture.writable` (общий хвост mip) — как есть. */
function recolourTextureBlocks(texture, recolour) {
  const payload = Buffer.from(texture.payload);
  const limit = Math.min(payload.length, texture.writable ?? payload.length);
  let offset = 0;
  let changed = false;
  for (let level = 0; level < texture.levels; level += 1) {
    const width = Math.max(1, texture.width >> level);
    const height = Math.max(1, texture.height >> level);
    const size = levelBytes(texture.format, width, height);
    if (offset + size > limit) break;
    const next = recolour(payload.subarray(offset, offset + size), width, height);
    if (next) {
      payload.set(next, offset);
      changed = true;
    }
    offset += size;
  }
  return changed ? payload : null;
}

/* ------------------------------------------------------------------ *
 * Склады поставки
 * ------------------------------------------------------------------ */

const exists = (file) =>
  fs
    .access(file)
    .then(() => true)
    .catch(() => false);

/**
 * Где склады растительности: в собранном приложении — рядом с ресурсами, в
 * разработке — в репозитории. Переменная окружения — для тестов.
 */
export async function vegetationResourceRoot() {
  const candidates = [
    process.env.ASTRAL_VEGETATION_RESOURCES,
    process.resourcesPath && path.join(process.resourcesPath, "vegetation"),
    path.resolve(dirname, "../../../resources/vegetation"),
  ].filter(Boolean);
  for (const candidate of candidates) if (await exists(path.join(candidate, "improved-trees.asp.000"))) return candidate;
  throw new Error("Склады растительности не найдены рядом с приложением — переустановите Astral.");
}

/* Склад по описи: части склеиваются, сумма сверяется — битый склад не едет в игру. */
async function openPack(id, expected) {
  const root = await vegetationResourceRoot();
  const bytes = await readAssetPackParts(path.join(root, id));
  if (!bytes) throw new Error(`Склада «${id}» нет рядом с приложением — переустановите Astral.`);
  if (sha256(bytes) !== expected) throw new Error(`Склад «${id}» повреждён — переустановите Astral.`);
  return openAssetPack(bytes);
}

/** «Реалистичные деревья» из склада: `{ entries, read(имя) }`. */
export async function openImprovedTrees() {
  let pack = await openPack("improved-trees", VEGETATION_PACKS.improved.sha256);
  const opened = () => {
    if (!pack) throw new Error("Склад «Реалистичных деревьев» уже отпущен.");
    return pack;
  };
  return {
    entries: [...pack.names],
    /* Размер файла склада без сжатия — по описи, склад не читается (оценка пакета до сборки). */
    sizeOf: (name) => (pack ? pack.sizeOf(name) : null),
    read: async (name) => opened().read(name),
    /* Без последнего сжатия (13.10.2026): `{ plain, bytes }`; работа над файлом разожмёт его сама, а сжатие в
       `read` шло девятым уровнем подряд в одном потоке — две трети времени чтения склада.
       `ASTRAL_IMPROVED_PLAIN=0` — прежний путь (для сверки замеров и на случай, если что-то пойдёт не так). */
    ...(process.env.ASTRAL_IMPROVED_PLAIN === "0" ? {} : { readPlain: async (name) => opened().readPlain(name) }),
    /* Склад в памяти — ~770 МБ распакованным: сборка отпускает его, как только деревья собраны. */
    release() {
      pack = null;
    },
  };
}

/** «Зелёный Сэнди Шорс» из склада: план, картинки и пустышки моделей. */
export async function openGreenSandy() {
  const plan = await openGrassPlan();
  const pack = await openPack("green-sandy", VEGETATION_PACKS.sandy.sha256);
  const image = (id) => pack.read(`img-${id}`);
  return { plan, image, stub: (name) => pack.read(name), green: modGreenOf(plan, image) };
}

/*
 * Только план «Травы по миру» (карты травы с зонами, модели травинок) —
 * без склада картинок: цветам и «без цветов» нужны карты травы, а не листы
 * мода (задача 2 ТЗ 10.10.2026, вечер).
 */
export async function openGrassPlan() {
  const root = await vegetationResourceRoot();
  const text = await fs.readFile(path.join(root, "green-sandy.json"), "utf8").catch(() => null);
  if (!text || sha256(Buffer.from(text, "utf8")) !== VEGETATION_PACKS.sandy.planSha256)
    throw new Error("План «Зелёного Сэнди Шорс» повреждён — переустановите Astral.");
  return JSON.parse(text);
}

/**
 * Опись растительности по миру (`world.json`, `prepare-vegetation-world.mjs`):
 * листы живых изгородей по файлам и карты районов с деревьями перемешки.
 * Сверяется по отпечатку описи окна — битая опись в игру не едет.
 */
export async function openVegetationWorld() {
  const root = await vegetationResourceRoot();
  const text = await fs.readFile(path.join(root, "world.json"), "utf8").catch(() => null);
  if (!text || sha256(Buffer.from(text, "utf8")) !== VEGETATION_WORLD.sha256)
    throw new Error("Опись растительности по миру повреждена — переустановите Astral.");
  return JSON.parse(text);
}

/**
 * Посадка: план засаженности (`planting.json`, `prepare-vegetation-planting.mjs`)
 * — места рядов вдоль дорог, деревьев и кусков полос, клумб и карты, где
 * им жить. Сверяется по отпечатку описи окна — битый план в игру не едет.
 */
export async function openVegetationPlanting() {
  const root = await vegetationResourceRoot();
  const text = await fs.readFile(path.join(root, "planting.json"), "utf8").catch(() => null);
  if (!text || sha256(Buffer.from(text, "utf8")) !== VEGETATION_PLANTING.sha256)
    throw new Error("План засаженности повреждён — переустановите Astral.");
  return JSON.parse(text);
}

/**
 * «В разнобой»: опись копий (`variety.json`, `prepare-vegetation-variety.mjs`)
 * — архетипы деревьев и кустов с адресами их моделей, словарей и типов,
 * словари с листами и карты районов, где они стоят. Сверяется по отпечатку
 * описи окна — битая опись в игру не едет.
 */
export async function openVegetationVariety() {
  const root = await vegetationResourceRoot();
  const text = await fs.readFile(path.join(root, "variety.json"), "utf8").catch(() => null);
  if (!text || sha256(Buffer.from(text, "utf8")) !== VEGETATION_VARIETY.sha256)
    throw new Error("Опись «В разнобой» повреждена — переустановите Astral.");
  return JSON.parse(text);
}

/*
 * Зелень мода для дальних планов: средний цвет самой частой травы мода
 * (`cs_rsn_sl_lushgrassrock2` стоит в сотнях мест). Вдали та же трава, что
 * вблизи, — без заметной ступени цвета на смене уровня.
 */
function modGreenOf(plan, image) {
  const uses = new Map();
  for (const target of plan.targets || [])
    for (const [, imageId, tint] of target.textures || []) if (tint) uses.set(imageId, (uses.get(imageId) || 0) + 1);
  const [top] = [...uses].sort((a, b) => b[1] - a[1])[0] || [];
  const picture = top === undefined ? null : plan.images[top];
  if (!picture || picture.flat) return picture?.flat ? hexBytes(picture.flat) : hexBytes("#4f7a34");
  try {
    const rgba = decodeTexture(picture.format, image(top).subarray(0, levelBytes(picture.format, picture.width, picture.height)), picture.width, picture.height);
    const mean = [0, 0, 0];
    for (let at = 0; at < rgba.length; at += 4) {
      mean[0] += rgba[at];
      mean[1] += rgba[at + 1];
      mean[2] += rgba[at + 2];
    }
    return mean.map((value) => Math.round(value / (rgba.length / 4)));
  } catch {
    return hexBytes("#4f7a34");
  }
}

/* ------------------------------------------------------------------ *
 * Трава
 * ------------------------------------------------------------------ */

/* Мета-ресурс карты: блоки структур и разыменование указателей. */
function openMeta(resource) {
  const { view } = resource;
  const rootAt = resource.at(resource.root);
  const rootBlock = view.getInt32(rootAt + 0x1c, true);
  const blocksAt = resource.at(view.getBigUint64(rootAt + 0x30, true));
  const count = view.getInt16(rootAt + 0x4c, true);
  const blocks = [];
  for (let index = 0; index < count; index += 1) {
    const at = blocksAt + index * 16;
    blocks.push({ dataAt: resource.at(view.getBigUint64(at + 8, true)) });
  }
  const resolve = (pointer) => {
    const block = blocks[Number(pointer & 0xfffn) - 1];
    return block ? block.dataAt + Number((pointer >> 12n) & 0xfffffn) : -1;
  };
  return { rootAt: blocks[rootBlock - 1]?.dataAt ?? -1, resolve };
}

/**
 * Экземпляры карты травы: `visit({ archetype, x, y, colour, at })` на каждый
 * (`colour` — байты `[r, g, b]`, `at` — место этих байт в `resource.data`).
 * `CMapData.instancedData.GrassInstanceList` (+208): партии по 96 байт —
 * рамка (+0 мин, +16 макс), модель травы (+48), экземпляры (+72 указатель,
 * +80 число) по 16 байт: позиция — три uint16 в рамке партии, цвет — три
 * байта с +8. Возвращает `{ raw, resource, instances }` или `null`, если
 * травы нет.
 */
export function readGrassInstances(bytes, visit) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  const { view } = resource;
  const { rootAt, resolve } = openMeta(resource);
  if (rootAt < 0) return null;
  const listAt = resolve(view.getBigUint64(rootAt + 208, true));
  const batches = view.getUint16(rootAt + 216, true);
  if (listAt < 0 || !batches) return null;
  let instances = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    const at = listAt + batch * 96;
    const min = [view.getFloat32(at, true), view.getFloat32(at + 4, true)];
    const max = [view.getFloat32(at + 16, true), view.getFloat32(at + 20, true)];
    const archetype = view.getUint32(at + 48, true) >>> 0;
    const itemsAt = resolve(view.getBigUint64(at + 72, true));
    const count = view.getUint16(at + 80, true);
    if (itemsAt < 0) continue;
    const z = [view.getFloat32(at + 8, true), view.getFloat32(at + 24, true)];
    for (let item = 0; item < count; item += 1) {
      const instance = itemsAt + item * 16;
      visit({
        archetype,
        x: min[0] + (view.getUint16(instance, true) / 65535) * (max[0] - min[0]),
        y: min[1] + (view.getUint16(instance + 2, true) / 65535) * (max[1] - min[1]),
        z: z[0] + (view.getUint16(instance + 4, true) / 65535) * (z[1] - z[0]),
        colour: [view.getUint8(instance + 8), view.getUint8(instance + 9), view.getUint8(instance + 10)],
        at: instance + 8,
      });
      instances += 1;
    }
  }
  return instances ? { raw, resource, instances } : null;
}

/* Лист травинки, если модели нет в описи: средняя зелень листов `ng_ip_*`. */
export const DEFAULT_BLADE = Object.freeze({ sheet: [0.36, 0.42, 0.22], mean: [0.45, 0.46, 0.35] });

/**
 * Экземпляры травы карты в цвете работы. `targetAt(x, y)` — цель цвета
 * травы в точке (`grassTarget`) или `null` (травинка как была), `blades` —
 * модели травинок плана (средний лист и средний цвет экземпляров): травинка
 * в игре — лист модели × цвет экземпляра, поэтому цвет экземпляра
 * подбирается под зелёный лист (`grassInstanceColour`). Возвращает
 * `{ bytes, instances }` или `null`, если травы нет или ничего не поменялось.
 */
export function patchGrassColours(bytes, targetAt, blades = {}) {
  const patched = patchGrassMap(bytes, { targetAt, blades });
  return patched && patched.instances ? { bytes: patched.bytes, instances: patched.instances } : null;
}

/* Пачка травы (`fwGrassInstanceListDef`, 96 байт): рамка, разброс размера,
   модель, дальность, экземпляры. */
const BATCH_BYTES = 96;
const BATCH_SCALE = 32;
const BATCH_ARCHETYPE = 48;
const INSTANCE_BYTES = 16;
const INSTANCE_COLOUR = 8;

/*
 * Пачка становится цветами (или травой у «без цветов»): модель и разброс
 * размера — как у Rockstar для этой модели, цвет экземпляров — к среднему
 * Rockstar той же модели (`tint`): лист цветов ложится на него, и пачка на
 * сухой траве пустыни не желтит цветы. Отличие травинок друг от друга
 * (цвет земли под каждой) остаётся. Число и места экземпляров — те же.
 */
function swapBatch(view, batchAt, itemsAt, count, choice) {
  view.setUint32(batchAt + BATCH_ARCHETYPE, choice.hash >>> 0, true);
  view.setFloat32(batchAt + BATCH_SCALE, choice.scale[0], true);
  view.setFloat32(batchAt + BATCH_SCALE + 4, choice.scale[1], true);
  view.setFloat32(batchAt + BATCH_SCALE + 8, choice.scale[2], true);
  if (itemsAt < 0 || !count) return;
  const mean = [0, 0, 0];
  for (let item = 0; item < count; item += 1)
    for (let channel = 0; channel < 3; channel += 1) mean[channel] += view.getUint8(itemsAt + item * INSTANCE_BYTES + INSTANCE_COLOUR + channel);
  const factor = mean.map((sum, channel) => Math.min(2, Math.max(0.5, choice.tint[channel] / Math.max(1, sum / count))));
  for (let item = 0; item < count; item += 1)
    for (let channel = 0; channel < 3; channel += 1) {
      const at = itemsAt + item * INSTANCE_BYTES + INSTANCE_COLOUR + channel;
      view.setUint8(at, Math.min(255, Math.round(view.getUint8(at) * factor[channel])));
    }
}

/**
 * Карта травы в облике работы за одно разжатие и одно сжатие: цветы на месте
 * мелкой травы (`flowerAt(модель, x, y)` — решение по углу рамки пачки,
 * `flowerBatchChooser`) и цвет травинок (`targetAt`, как у
 * `patchGrassColours`; своим цветом остаются только цветы, посаженные этой
 * сборкой, и камни с бревнами — `isNonPlantBatch`). Возвращает
 * `{ bytes, instances, flowers, swapped }` или `null`, если ничего не
 * поменялось.
 */
export function patchGrassMap(bytes, { flowerAt = null, targetAt = null, blades = {} } = {}) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  const { view } = resource;
  const { rootAt, resolve } = openMeta(resource);
  if (rootAt < 0) return null;
  const listAt = resolve(view.getBigUint64(rootAt + 208, true));
  const batches = view.getUint16(rootAt + 216, true);
  if (listAt < 0 || !batches) return null;
  const known = new Map();
  const bladeOf = (archetype) => {
    let blade = known.get(archetype);
    if (!blade) {
      const info = blades[archetype] || DEFAULT_BLADE;
      const reference = grassReference();
      reference.add(info.mean[0] * info.sheet[0], info.mean[1] * info.sheet[1], info.mean[2] * info.sheet[2]);
      known.set(archetype, (blade = { sheet: info.sheet, reference: reference.result() }));
    }
    return blade;
  };
  let instances = 0;
  let flowers = 0;
  let swapped = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    const at = listAt + batch * BATCH_BYTES;
    const min = [view.getFloat32(at, true), view.getFloat32(at + 4, true)];
    const max = [view.getFloat32(at + 16, true), view.getFloat32(at + 20, true)];
    const itemsAt = resolve(view.getBigUint64(at + 72, true));
    const count = view.getUint16(at + 80, true);
    const choice = flowerAt ? flowerAt(view.getUint32(at + BATCH_ARCHETYPE, true) >>> 0, min[0], min[1]) : null;
    if (choice) {
      swapBatch(view, at, itemsAt, count, choice);
      swapped += 1;
      if (choice.kind !== "grass") flowers += 1;
    }
    const archetype = view.getUint32(at + BATCH_ARCHETYPE, true) >>> 0;
    /* Покраска: красится вся мелкая трава, и цветы Rockstar тоже (их пачки —
       больше зелёные розетки и листья, чем лепестки: одуванчиков 1,2 млн).
       Своего цвета — только цветы, которые эта сборка посадила вместо травы,
       и камни с бревнами (11.10.2026; прежде цветы Rockstar оставались
       зелёными пятнами на крашеной траве). */
    if (!targetAt || itemsAt < 0 || (choice && choice.kind !== "grass") || isNonPlantBatch(archetype)) continue;
    const { sheet, reference } = bladeOf(archetype);
    for (let item = 0; item < count; item += 1) {
      const instance = itemsAt + item * INSTANCE_BYTES;
      const x = min[0] + (view.getUint16(instance, true) / 65535) * (max[0] - min[0]);
      const y = min[1] + (view.getUint16(instance + 2, true) / 65535) * (max[1] - min[1]);
      const target = targetAt(x, y);
      if (!target) continue;
      const colourAt = instance + INSTANCE_COLOUR;
      const [r, g, b] = grassInstanceColour([view.getUint8(colourAt), view.getUint8(colourAt + 1), view.getUint8(colourAt + 2)], target, sheet, reference);
      view.setUint8(colourAt, r);
      view.setUint8(colourAt + 1, g);
      view.setUint8(colourAt + 2, b);
      instances += 1;
    }
  }
  if (!instances && !swapped) return null;
  /* Карт травы — сотни, шестой уровень: на доли процента крупнее девятого и вдвое быстрее. */
  const compressed = deflateRaw(resource.data, { level: 6 });
  const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
  compressed.copy(out, RSC7_HEADER_BYTES);
  return { bytes: out, instances, flowers, swapped };
}

/**
 * Земля под травой для засаженности: места травинок карты травы (основание
 * травинки — земля: на дорогах, крышах и в воде травы нет), не больше одного
 * на клетку `cell` метров — `visit(x, y, z)`. Пачки камней, бревен и
 * папоротников тоже лежат на земле — годятся.
 */
export function grassGroundPoints(bytes, visit, { cell = 8 } = {}) {
  const seen = new Set();
  readGrassInstances(bytes, ({ x, y, z }) => {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    if (seen.has(key)) return;
    seen.add(key);
    visit(x, y, z);
  });
}

/* ------------------------------------------------------------------ *
 * Деревья районов: перемешка видов и засаженность
 * ------------------------------------------------------------------ */

/**
 * Карта района с деревьями видов перемешки: `treeAt(модель, x, y)` — новая
 * модель (хеш) или `null` (`treeChooser`). Меняется только хеш модели у
 * сущности — место, поворот, размер, дальность и родитель LOD те же
 * (`patchMapEntityArchetypes`). Возвращает `{ bytes, trees }` или `null`.
 */
export function patchForestMap(bytes, treeAt) {
  const { entities } = readMapEntities(bytes);
  const changes = new Map();
  entities.forEach((entity, index) => {
    if (!entity) return;
    const to = treeAt(entity.archetype, entity.position[0], entity.position[1]);
    if (to) changes.set(index, { from: entity.archetype, to, position: entity.position });
  });
  if (!changes.size) return null;
  const patched = patchMapEntityArchetypes(bytes, changes);
  return patched.bytes ? { bytes: patched.bytes, trees: patched.patched } : null;
}

/* ------------------------------------------------------------------ *
 * Штатная трава зон
 * ------------------------------------------------------------------ */

/**
 * Штатная трава словаря в свой цвет: `textures` — имена листов травы
 * (опись `lawns`), `colour` — `#rrggbb` цвета травы файла. DXT — прямо в
 * блоках (опорные цвета той же формулой, без нового сжатия), остальные —
 * раскодированием. Возвращает `{ имя: байты }`.
 */
function lawnPayloads(refs, textures, colour, skip = new Set()) {
  const wanted = new Set(textures);
  const bytes = hexBytes(colour);
  const replacements = {};
  for (const texture of refs) {
    const name = texture.name.toLowerCase();
    /* Общий хвост mip — как есть, уровни до него — в цвет (покраска 11.10.2026). */
    if (!wanted.has(name) || skip.has(name) || texture.writable < firstLevelBytes(texture)) continue;
    const payload = BLOCK_FORMATS.has(texture.format)
      ? recolourTextureBlocks(texture, (level, width, height) =>
          recolourDistantBlocks(level, texture.format, width, height, () => bytes, { greens: true, sand: false }),
        )
      : recolourTexture(texture, (rgba) => recolourGrass(rgba, colour));
    if (payload) replacements[texture.name] = payload;
  }
  return replacements;
}

/* ------------------------------------------------------------------ *
 * Покраска: процедурная трава и палитры тинта (11.10.2026)
 * ------------------------------------------------------------------ */

/**
 * Спрайты процедурной травы (`plantsmgr*.ytd`, `txgrassNN`) в цвет травы:
 * зелень листьев и травинок — цветом, лепестки цветочных спрайтов — свои
 * (`recolourPlantSprite`). Раскодированием: блоки DXT5 спрайта мешают лепесток
 * и лист, опорные цвета блока их не разделят. Возвращает `{ имя: байты }`.
 */
function plantPayloads(refs, textures, colour) {
  const wanted = new Set(textures);
  const replacements = {};
  for (const texture of refs) {
    const name = texture.name.toLowerCase();
    if (!wanted.has(name) || texture.writable < firstLevelBytes(texture)) continue;
    const flower = plantSpriteIsFlower(name);
    const payload = recolourTexture(texture, (rgba) => recolourPlantSprite(rgba, colour, { flower }));
    if (payload) replacements[texture.name] = payload;
  }
  return replacements;
}

/**
 * Палитры тинта без зелени (`neutralisePalette`): `all` — вся палитра
 * (плющ и изгороди), иначе — зелёные записи (земля). `skip` — уже легшие
 * листы. Возвращает `{ имя: байты }`.
 */
function palettePayloads(refs, textures, { all = false, skip = new Set() } = {}) {
  const wanted = new Set(textures);
  const replacements = {};
  for (const texture of refs) {
    const name = texture.name.toLowerCase();
    if (!wanted.has(name) || skip.has(name) || texture.writable < firstLevelBytes(texture)) continue;
    const payload = recolourTexture(texture, (rgba) => neutralisePalette(rgba, { all }));
    if (payload) replacements[texture.name] = payload;
  }
  return replacements;
}

/* ------------------------------------------------------------------ *
 * «В разнобой»: копии моделей и словарей своего цвета (17.10.2026)
 * ------------------------------------------------------------------ */

/* Облик копии: ровный цвет места палитры, густота — как у листвы деревьев. */
const varietyStyles = new Map();
function varietyStyle(colour, foliage) {
  const key = `${colour}|${foliage}`;
  if (!varietyStyles.has(key))
    varietyStyles.set(key, {
      compiled: compileVegetationEffect({ mode: "solid", colour, colour2: "#ffffff", direction: "along", width: 2, shift: 0 }),
      foliage,
      species: 0.5,
    });
  return varietyStyles.get(key);
}

/**
 * Копия модели или словаря для цвета палитры: `job.colour` — цвет места,
 * `job.foliage` — густота, `job.leaves` — листы словаря (у модели листва
 * ищется по её материалам, как у «Реалистичных деревьев»; у куста — и листы
 * изгороди на обычных шейдерах). Копия едет всегда — даже если листа в ней
 * нет (он в словаре): на её имя смотрит копия архетипа.
 */
function processVarietyJob(job, bytes) {
  const plain = job.plain === true;
  const style = varietyStyle(job.colour, job.foliage);
  const counts = {};
  let out = null;
  if (job.name.endsWith(".ytd")) {
    const editor = openResourceTextures(bytes, job.name, plain ? { plain: true } : {});
    if (recolourLeafTextures(editor, job.leaves || [], () => style)) out = editor.finish({ level: DISTANT_DEFLATE });
    counts.varietyDictionaries = 1;
  } else {
    let resource = null;
    try {
      resource = plain ? openResourcePlain(bytes) : openResourceWith(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
    } catch {
      /* модель не читается — едет как есть */
    }
    const { leaves, sheets } = resource ? leafSheetsOf(bytes, job.name.split(".").pop(), resource) : { leaves: new Set(), sheets: new Set() };
    const hedgeSheets = job.group === "bush" ? sheets : new Set();
    const editor = leaves.size || hedgeSheets.size ? openResourceTextures(bytes, job.name, { resource }) : null;
    const leafLaid = editor && leaves.size ? recolourLeafTextures(editor, leaves, () => style) : false;
    const sheetLaid = editor && hedgeSheets.size ? recolourLeafTextures(editor, hedgeSheets, () => ({ ...style, foliage: 100 }), { leafOnly: true }) : false;
    if (leafLaid || sheetLaid) out = editor.finish({ level: DISTANT_DEFLATE });
    counts.varietyModels = 1;
  }
  /* Лист не лёг (он в словаре) — копия байт в байт; склад отдал файл без сжатия — сжать. */
  if (!out) out = plain ? compressResource(bytes.subarray(0, RSC7_HEADER_BYTES), bytes.subarray(RSC7_HEADER_BYTES)) : bytes;
  return { bytes: Buffer.from(out), kinds: ["variety"], counts };
}

/* ------------------------------------------------------------------ *
 * Один файл работы
 * ------------------------------------------------------------------ */

/**
 * Всё, что нужно файлам одной сборки, кроме самих файлов: облик работы,
 * склад травы и цвета травы зон по карте. Собирается и в главном процессе,
 * и в каждом потоке сборки — из тех же данных, поэтому и файл выходит тем же.
 * `sandy` — открытый склад (`openGreenSandy`) или `null`.
 */
export function createVegetationContext(input, sandy) {
  const project = normalizeVegetationProject(input);
  const looks = compileVegetationLooks(project);
  const plan = sandy?.plan || {};
  const places = plan.places || {};
  const fileZones = plan.zones || {};
  /* Зелень мода (средний цвет самой частой травы мода) и яркость травы
     вблизи: песок вдали приводится к ней. */
  const modGreen = sandy?.green || hexBytes("#4f7a34");
  const albedo = toYcc(modGreen[0] / 255, modGreen[1] / 255, modGreen[2] / 255)[0];
  const modTarget = grassTarget(modGreen, { gain: 1 });
  /* Эффект зоны разобран один раз: атласы и травинки — миллионы точек,
     256 ступеней на зону. */
  const zones = Object.fromEntries(
    GRASS_ZONE_IDS.map((id) => {
      const zone = looks.sandy.zones[id];
      return [id, { ...zone, field: zone.look ? sandyColourField(zone.look, 256, id) : null }];
    }),
  );
  const targets = new Map();
  const targetOf = (colour) => {
    const key = (colour[0] << 16) | (colour[1] << 8) | colour[2];
    let target = targets.get(key);
    if (!target) targets.set(key, (target = grassTarget(colour)));
    return target;
  };
  const zoneOf = (name, fallback = "country") => fileZones[name] || fallback;
  /* Решения по районам — один раз на район: цветы и деревья перемешки. */
  const flowerChoosers = new Map();
  const treeChoosers = new Map();
  /* «В разнобой»: копия архетипа по месту сущности и цель цвета травинки пятнами. */
  const varietyAt = varietyArchetypeChooser(project.variety, { painted: varietyPainted(project) });
  const varietyGrass = varietyActive(project.variety) && project.variety.grass ? varietyGrassChooser(project.variety) : null;
  const varietyTargets = varietyGrass ? varietySlots(project.variety).map((slot) => (slot.colour ? grassTarget(hexBytes(slot.colour)) : null)) : null;
  return {
    project,
    looks,
    sandy,
    places,
    zones,
    albedo,
    treesActive: looks.trees.active,
    zoneOf,
    /* Облик листа листвы файла: деревья или кусты (`group` — `bush`/`tree`). */
    leafStyle: (group, name, speciesId) =>
      group === "bush" ? bushStyle(looks, bushShareOf(looks, name)) : treeStyle(looks, speciesShare(speciesId), speciesId),
    /* Облик листа карточки вдали: карточка куста — кустов, остальное — деревьев (порода — по имени листа). */
    cardStyle: (texture) => {
      if (isBushCard(texture)) return bushStyle(looks, bushShareOf(looks, texture));
      const speciesId = vegetationSpeciesOf(texture);
      return treeStyle(looks, speciesShare(speciesId), speciesId);
    },
    /* Лист живой изгороди: цвет кустов, без густоты. */
    hedgeStyle: (texture) => bushStyle(looks, bushShareOf(looks, texture), { opaque: true }),
    flowerAt: (area) => {
      if (!flowerChoosers.has(area)) flowerChoosers.set(area, flowerBatchChooser(project.flowers, area));
      return flowerChoosers.get(area);
    },
    treeAt: (area) => {
      if (!treeChoosers.has(area)) treeChoosers.set(area, treeChooser(project.forest, area));
      return treeChoosers.get(area);
    },
    varietyAt,
    /* Травинки «в разнобой»: цвет места палитры пятном; «как в игре» — цвет своей зоны (или как была). */
    varietyBladeTarget: (zoneTarget) =>
      varietyGrass ? (x, y) => varietyTargets[varietyGrass(x, y)] || (zoneTarget ? zoneTarget(x, y) : null) : zoneTarget,
    /* Цвет листов файла — в точке его места, 48 ступенями на всю зону
       (≈ 160 м на ступень у радуги с запада на восток — мельче самих
       файлов); `null` — зелень мода или зона как в игре. */
    fileColour: (name, zone = zoneOf(name)) => {
      const part = zones[zone];
      if (!part?.look) return null;
      const place = places[name];
      const centre = place ? [place[0], place[1]] : grassZoneCentre(zone);
      return bytesHex(sandyColourAt(part.look, centre[0], centre[1], 48, zone));
    },
    /* Атласы вдали: за городом песок становится травой (у мода — его
       зеленью), свой цвет красит и штатную зелень; в городе — только газоны. */
    distantOptions: (zone) => {
      const part = zones[zone];
      if (!part?.enabled) return null;
      if (part.mod) return zone === "country" ? { colourOf: () => modGreen, greens: false, sand: true, gain: 1, albedo, zone } : null;
      return { colourOf: (x, y) => part.field(x, y), greens: true, sand: zone === "country", gain: null, albedo, zone };
    },
    /* Травинки зоны: цель цвета в точке или `null` (как в игре и у мода). */
    bladeTarget: (zone) => {
      const part = zones[zone];
      if (!part?.field) return null;
      return (x, y) => targetOf(part.field(x, y));
    },
    modTarget,
    modSheets: sandy ? modSheetsOf(sandy.plan) : null,
    greenCache: new Map(),
  };
}

/**
 * Один файл работы: `job` — что с ним делать, `bytes` — он сам. Возвращает
 * `{ bytes, kinds, counts }`; `bytes` — `null`, если файл не меняется.
 *
 *   • `improved` — модель «Реалистичных деревьев» из склада: листва в
 *     облике работы; едет всегда, её имя занимает место модели игры;
 *   • `game` — файл игры: листва моделей (`leaves`, `group` — дерево или
 *     куст), карточки вдали (`cards`), листы живых изгородей (`hedges`),
 *     трава мода (`green`), дальние планы зоны (`distant`) и штатная трава
 *     зоны (`lawns`) — все правки за одно разжатие и одно сжатие, в прежнем
 *     порядке; `zone` — зона файла; с покраски 11.10.2026 ещё палитры тинта
 *     изгородей (`hedgePalettes`) и земли с травой (`palettes`) и спрайты
 *     процедурной травы (`plants`);
 *   • `grass` — карта травы: цветы на месте мелкой травы (`flowers`, по
 *     району `area`) и экземпляры в цвете травы своей зоны;
 *   • `forest` — карта района: деревья видов перемешки (`area`).
 */
export function processVegetationJob(job, bytes, context) {
  const counts = {};
  const add = (key, value = 1) => {
    counts[key] = (counts[key] || 0) + value;
  };
  if (job.kind === "variety") return processVarietyJob(job, bytes);
  if (job.kind === "improved") {
    let out = bytes;
    /* `plain` (13.10.2026): за заголовком RSC7 уже данные ресурса, а не поток deflate — склад отдал файл без сжатия;
       разжатие одно на файл (прежде два), сжатие одно и здесь, в потоке, а не подряд в главном. */
    const plain = job.plain === true;
    /* Куст мода красится как кусты, дерево — как листва деревьев. */
    const group = isBushFile(job.name) ? "bush" : "tree";
    const style = context.leafStyle(group, job.name, vegetationSpeciesOf(job.name));
    if (style && !job.name.endsWith(".ytd")) {
      let resource = null;
      try {
        resource = plain ? openResourcePlain(bytes) : openResourceWith(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
      } catch {
        /* модель не читается — листвы нет */
      }
      const { leaves, sheets } = resource ? leafSheetsOf(bytes, job.name.split(".").pop(), resource) : { leaves: new Set(), sheets: new Set() };
      /* Покраска: у куста — и листы изгороди на обычных шейдерах, только листовые
         пиксели (кора остаётся), без густоты — у такого шейдера среза по альфе нет. */
      const hedgeSheets = group === "bush" ? sheets : new Set();
      const editor = leaves.size || hedgeSheets.size ? openResourceTextures(bytes, job.name, { resource }) : null;
      const leafLaid = editor && leaves.size ? recolourLeafTextures(editor, leaves, () => style) : false;
      const sheetLaid = editor && hedgeSheets.size ? recolourLeafTextures(editor, hedgeSheets, () => ({ ...style, foliage: 100 }), { leafOnly: true }) : false;
      if (leafLaid || sheetLaid) out = editor.finish({ level: DISTANT_DEFLATE });
    }
    /* Файл не менялся — отдаётся таким, каким его собрал бы склад (`read`). */
    if (plain && out === bytes) out = compressResource(bytes.subarray(0, RSC7_HEADER_BYTES), bytes.subarray(RSC7_HEADER_BYTES));
    add("improved");
    return { bytes: Buffer.from(out), kinds: ["improved"], counts };
  }
  const zone = job.zone || context.zoneOf(job.name);
  if (job.kind === "grass") {
    /* Цветы — по району карты; цвет травинок — по зоне «Травы по миру», «в разнобой» — пятнами палитры. */
    const targetAt = job.variety ? context.varietyBladeTarget(context.bladeTarget(zone)) : context.bladeTarget(zone);
    const flowerAt = job.flowers ? context.flowerAt(job.area || areaOfMapName(job.name)) : null;
    const patched = targetAt || flowerAt ? patchGrassMap(bytes, { flowerAt, targetAt, blades: context.sandy?.plan.blades || {} }) : null;
    /* Посадка: клумбы — новые пачки цветов после перекраски травы (их она не трогает). */
    const beds = job.beds?.length ? appendGrassBatches(patched?.bytes || bytes, job.beds) : null;
    if (!patched && !beds) return { bytes: null, kinds: [], counts };
    const kinds = [];
    if (beds) {
      kinds.push("beds");
      add("bedMaps");
      add("bedBatches", job.beds.length);
    }
    if (!patched) return { bytes: beds, kinds, counts };
    if (patched.instances) {
      kinds.push("grass");
      add("grass");
      add("instances", patched.instances);
    }
    if (patched.swapped) {
      kinds.push("flowers");
      add("flowerMaps");
      add("flowerBatches", patched.flowers);
      add("grassBatches", patched.swapped - patched.flowers);
    }
    return { bytes: beds || patched.bytes, kinds, counts };
  }
  if (job.kind === "forest") {
    /* Сначала виды перемешки, затем новые деревья — уже среди новых видов. */
    const area = job.area || areaOfMapName(job.name);
    const kinds = [];
    let out = bytes;
    /* «В разнобой»: дерево (и дерево из смеси) — копией места палитры по своей точке. */
    const variant = job.variety ? context.varietyAt : () => null;
    if (job.mix || job.variety) {
      const mixAt = job.mix ? context.treeAt(area) : () => null;
      let mixed = 0;
      let varied = 0;
      const patched = patchForestMap(out, (archetype, x, y) => {
        const kind = mixAt(archetype, x, y);
        const copy = variant(kind ?? archetype, x, y);
        if (kind) mixed += 1;
        if (copy) varied += 1;
        return copy ?? kind;
      });
      if (patched) {
        out = patched.bytes;
        if (mixed) {
          kinds.push("forest");
          add("forestMaps");
          add("forestTrees", mixed);
        }
        if (varied) {
          kinds.push("variety");
          add("varietyMaps");
          add("varietyTrees", varied);
        }
      }
    }
    /* Посадка: ряды вдоль дорог и деревья полос — готовые сущности плана. */
    const rows = (job.rows || []).map(([archetype, x, y, z, qz, qw, scale, lodDist]) => ({ archetype, position: [x, y, z], rotation: [0, 0, qz, qw], scale: [scale, scale], lodDist }));
    const additions = [];
    if (job.plant?.count) {
      const mix = context.project.forest.enabled && context.project.forest.areas.includes(area) ? context.project.forest.kinds : null;
      const occupied = rows.flatMap((row) => [row.position[0], row.position[1]]);
      const grove = plantTrees({ entities: readMapEntityPlaces(out), points: job.plant.points, count: job.plant.count, mix, occupied });
      if (grove.length) {
        additions.push(...grove);
        kinds.push("plant");
        add("plantedMaps");
        add("plantedTrees", grove.length);
      }
    }
    if (rows.length) {
      additions.push(...rows);
      kinds.push("rows");
      add("rowMaps");
      add("rowTrees", rows.length);
    }
    /* Одной правкой карты: новые сущности ложатся одним массивом — «в разнобой» тоже копиями. */
    if (additions.length)
      out = appendMapEntities(
        out,
        job.variety ? additions.map((entity) => ({ ...entity, archetype: variant(entity.archetype, entity.position[0], entity.position[1]) ?? entity.archetype })) : additions,
      );
    return { bytes: kinds.length ? Buffer.from(out) : null, kinds, counts };
  }
  const kinds = [];
  const editor = openResourceTextures(bytes, job.name);
  if (job.leaves && recolourLeafTextures(editor, job.leaves, () => context.leafStyle(job.group, job.name, job.species))) {
    kinds.push(job.group === "bush" ? "bush" : "tree");
    add(job.group === "bush" ? "bushes" : "trees");
  }
  if (job.cards && recolourLeafTextures(editor, job.cards, context.cardStyle, { card: true })) {
    kinds.push("lod");
    add("lods");
  }
  /* Покраска: лист изгороди и плюща — только листовые пиксели (стена, ветки и
     цветы на том же листе остаются), палитра тинта изгороди — серой той же
     яркости, иначе она тянет плющ обратно в зелень (11.10.2026). */
  if (job.hedges && recolourLeafTextures(editor, job.hedges, context.hedgeStyle, { leafOnly: true })) {
    kinds.push("hedge");
    add("hedges");
  }
  if (job.hedgePalettes && context.hedgeStyle(job.name)) {
    const palettes = palettePayloads(editor.textures(), job.hedgePalettes, { all: true });
    const count = Object.keys(palettes).length;
    if (count) {
      editor.patch(palettes);
      if (!kinds.includes("hedge")) kinds.push("hedge");
      add("hedgePalettes", count);
    }
  }
  if (job.green || job.distant || job.lawns || job.palettes || job.plants) {
    /* Трава одним пересжатием файла: листы плана мода, листы мода по имени
       и их уменьшенные копии — картинкой мода, атласы SLOD — по цвету,
       штатная трава — своим цветом. */
    const { sandy, places, modSheets, greenCache } = context;
    const refs = editor.textures();
    const replacements = {};
    const colour = context.fileColour(job.name, zone);
    const own = new Set((job.green || []).map(([name]) => name));
    if (job.green) {
      const green = greenSheetPayloads(refs, job.green, sandy, colour, greenCache);
      if (green.count) {
        Object.assign(replacements, green.replacements);
        kinds.push("sandy");
        add("sandy");
        add("textures", green.count);
      }
    }
    const options = job.distant ? context.distantOptions(zone) : null;
    if (options) {
      const sheets = zone === "country" ? distantModSheets(refs.map((ref) => ref.name), modSheets, own) : [];
      const laid = sheets.length ? greenSheetPayloads(refs, sheets, sandy, colour, greenCache) : { replacements: {}, count: 0 };
      const skip = new Set([...own, ...sheets.map(([name]) => name)]);
      const atlases = distantAtlasPayloads(refs, { ...options, place: places[job.name] || null, skip });
      if (laid.count || Object.keys(atlases).length) {
        Object.assign(replacements, laid.replacements, atlases);
        kinds.push("distant");
        add("distant");
        add("textures", laid.count);
        add("distantSheets", laid.count);
      }
    }
    if (job.lawns && colour) {
      const lawns = lawnPayloads(refs, job.lawns, colour, new Set([...own, ...Object.keys(replacements).map((name) => name.toLowerCase())]));
      const count = Object.keys(lawns).length;
      if (count) {
        Object.assign(replacements, lawns);
        kinds.push("lawn");
        add("lawns");
        add("lawnTextures", count);
      }
    }
    /* Покраска: палитры тинта земли с травой (гольф-клуб вблизи, вдали и в
       супердали) — без зелени: трава берёт тон слоёв, как у соседних газонов. */
    if (job.palettes && colour) {
      const palettes = palettePayloads(refs, job.palettes, { skip: new Set(Object.keys(replacements).map((name) => name.toLowerCase())) });
      const count = Object.keys(palettes).length;
      if (count) {
        Object.assign(replacements, palettes);
        kinds.push("palette");
        add("palettes", count);
      }
    }
    /* Покраска: спрайты процедурной травы и листы наземных растений — цветом
       травы (`plantZone` — чьей зоны; у словаря с местом — по его месту). */
    const plantColour = job.plants ? context.fileColour(job.name, job.plantZone || zone) : null;
    if (plantColour) {
      const plants = plantPayloads(refs, job.plants, plantColour);
      const count = Object.keys(plants).length;
      if (count) {
        Object.assign(replacements, plants);
        kinds.push("plants");
        add("plants");
        add("plantSprites", count);
      }
    }
    if (Object.keys(replacements).length) editor.patch(replacements);
  }
  return { bytes: editor.changed ? editor.finish({ level: DISTANT_DEFLATE }) : null, kinds, counts };
}
