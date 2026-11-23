/*
 * Свои модели мест в файлах игры (ТЗ 11.10.2026, вечер, задача 1).
 *
 * Каждая модель работы места (`models` договора, `place-models.js`) — своя
 * модель игры:
 *   • сетка — та же функция, что рисует кадр окна (`placeModelUnitMesh` и
 *     `placeModelMesh`): размер и поворот — в вершинах, середина — в нуле;
 *   • лист — картинка человека (у своей модели из файла — её лист, собранный
 *     окном) степенью двойки до 1024, непрозрачность — в альфе, DXT5 со
 *     всеми мипами;
 *   • шейдер — `default` (непрозрачная), `alpha` (прозрачность картинки или
 *     своя непрозрачность), `emissive` / `emissive_alpha` (свечение);
 *   • движение — клип кости по образцу штатной крутящейся модели игры
 *     (`compile-star-model`, как у летающего лого): вращение — вокруг
 *     вертикали мира, парение — вверх-вниз;
 *   • расстановка — свой архетип (рамка с движением, флаги анимированной
 *     модели и словарь клипов) и сущность в своей карте места
 *     (`compile-placements`); сущность без поворота — поворот уже в сетке.
 * Карта и типы моделей — в контейнере места рядом с остальными его файлами;
 * манифест контейнера один, поэтому, если набор уже везёт `_manifest.ymf`
 * (плашки эмблем, манифест мода), связь «карта моделей → типы моделей»
 * дописывается в него (`compile-manifest` с основой), а не заводит второй.
 *
 * Место модели — в метрах сцены кадра; в мир его переводит начало сцены
 * (`scene` модели → `origin`), которое знает редактор места.
 *
 * ТЗ 11.10.2026, ночь:
 *   • живая картинка (гифка) — лист-атлас кадров и клип развёртки
 *     `<модель>_uv_0` в словаре клипов модели (`compile-star-model`,
 *     `uvAnimation`), архетипу — флаг 0x400; то же для чужих мест —
 *     `buildLiveBanner` (баннеры арены);
 *   • залы Majestic (`PLACE_MODEL_HALLS` договора) — типов помещений сервера
 *     нет, модель вшивается геометрией в модель самого зала
 *     (`graft-drawable`) поверх правки листов набора; без движения и без
 *     смены кадров.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { bleedTransparent, encodeDds, fullMipLevels, resample } from "@modovik/dds";
import { arenaStarModel } from "@modovik/climb-contract/recolor/arena-star";
import {
  PLACE_MODEL_ASSET,
  PLACE_MODEL_MAX_VERTICES,
  normalizePlaceModel,
  normalizePlaceModels,
  placeModelAnimationClip,
  placeModelEmissive,
  placeModelCellPixels,
  placeModelFrames,
  placeModelHallLocal,
  placeModelInHall,
  placeModelMesh,
  placeModelSceneRules,
  placeModelSolid,
  placeModelTitle,
  placeModelUnitMesh,
  placeModelWorld,
  shownPlaceModels,
} from "@modovik/climb-contract/recolor/place-models";
import { EMBLEM_ASSET } from "@modovik/climb-contract/recolor/emblems";
import { gifSurfaceFrame, placeModelSheetSide, placeModelsGifPlan } from "@modovik/climb-contract/recolor/gif-surface";

/* Флаги архетипа анимированной модели — как у штатных крутящихся моделей. */
const ANIMATED_ARCHETYPE_FLAGS = 0x80200;
/*
 * Флаг архетипа с клипом развёртки (живая картинка): 0x400 стоит у всех 653
 * архетипов игры с UV-клипами и ни у одного без них (скан .ytyp игры
 * 11.10.2026); у штатного экрана подлодки без скелета — только он.
 */
export const UV_ANIMATED_ARCHETYPE_FLAG = 0x400;
const SHEET_SIDE = 1024;
/* Лист живой картинки — атлас кадров: до 2048 (DXT5 со всеми мипами — 5,6 МБ). */
const ATLAS_SIDE = 2048;
/* Лист модели, вшитой в модель зала: 16 таких — +5,6 МБ к залу. */
/* Вшивка моделей в модель зала Majestic выключена (20.11.2026): клиент отвергает пересобранные модели с именами сервера. Включать только после захода на Majestic с доказательством. */
const hallGraft = () => process.env.ASTRAL_ARENA_GUARD === "0";
/*
 * Модель, поставленная человеком в зале Majestic (arena10, 21.11.2026) — дописанная сущность того помещения, в чьей комнате стоит её точка
 * (общее правило, не подгонка под одну арену). Комната — по её рамке; точка внутри нескольких комнат или ни в одной — ближайшая рамка, при равенстве
 * меньший номер (так её выбирает хост `compile-mlo-models`, `rage_res::mlo::nearest_box`). Точка вне ВСЕХ комнат (снаружи арены) в зал не идёт:
 * такая модель остаётся мировой сущностью сцены «снаружи», как и раньше. Модель зала без движения и смены кадров: словаря клипов у серверных
 * помещений нет. Включатель: `ASTRAL_ARENA_HALL_ENTITIES=1`, умолчание — выключено (вшивка в модель зала по-прежнему запрещена).
 */
export const ARENA_HALL_ENTITIES_DEFAULT = false;
export const hallEntitiesEnabledFrom = (value, fallback = ARENA_HALL_ENTITIES_DEFAULT) => (value === "1" ? true : value === "0" ? false : fallback);
const hallEntities = () => hallEntitiesEnabledFrom(process.env.ASTRAL_ARENA_HALL_ENTITIES);
const HALL_SHEET_SIDE = 512;
const HALL_FILE_LIMIT = 16 * 1024 * 1024 - 1;
/* «Объём» строится по картинке до 512 px — как в кадре окна. */
const SOLID_SIDE = 512;
const IMAGE_BYTES = 8 * 1024 * 1024;
const MESH_BYTES = 8 * 1024 * 1024;

/** Имена файлов моделей места. */
export function placeModelNames(setId) {
  const base = `astral_${String(setId).replace(/[^a-z0-9]/g, "")}`;
  return {
    types: `${base}_models`,
    map: `${base}_models_map`,
    model: (index) => `${base}_m${index + 1}`,
    clips: (index) => `${base}_m${index + 1}_clips`,
  };
}

/* ------------------------------------------------------------------ *
 * Картинки и сетки из окна
 * ------------------------------------------------------------------ */

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function base64Bytes(entry, limit, what) {
  const data = typeof entry?.data === "string" ? entry.data : "";
  if (!data) throw new Error(`${what} не пришла — нажмите «Применить» ещё раз.`);
  if (data.length > Math.ceil(limit / 3) * 4 || !BASE64.test(data)) throw new RangeError(`${what} не читается или больше 8 МБ.`);
  return Buffer.from(data, "base64");
}

/*
 * Пределы чисел в сетке окна. Сетка лежит в метрах игры, а не «единичной»: «Цвет» вещи зала несёт сетку самой вещи, а вещи арены бывают крупнее 64 м
 * (опись рамок — до 92 м; у владельца 06.11.2026 `mj_ma_int3_rm1_doors_static` — 79 м). Порчей считаются не-числа и дичь вроде 1e30, а не размер вещи;
 * развёртку игры (повтор листа — u, v в десятки) не ограничиваем: хосту она нужна в 0…1, это решает сборка (`flatColourUvs`).
 */
const MESH_REACH = 4096;
const MESH_NORMAL_REACH = 64;
const MESH_UV_REACH = 65536;

/** Сетка `AMSH` v1 (её пишет окно, `model-assets.js`) → сетка. `label` — как зовут модель в отказе. */
export function decodePlaceMeshBytes(bytes, label = "") {
  const buffer = Buffer.from(bytes);
  const fail = () => {
    throw new Error(`«${label || "Своя модель"}»: сетка модели повреждена в хранилище окна — поставьте эту модель или цвет в редакторе заново.`);
  };
  if (buffer.length < 16 || buffer.readUInt32LE(0) !== 0x48534d41 || buffer.readUInt32LE(4) !== 1) fail();
  const vertices = buffer.readUInt32LE(8);
  const count = buffer.readUInt32LE(12);
  if (vertices < 3 || vertices > PLACE_MODEL_MAX_VERTICES || count < 3 || count % 3 || buffer.length !== 16 + vertices * 32 + count * 4) fail();
  let at = 16;
  const floats = (length) => {
    const out = new Float32Array(length);
    for (let index = 0; index < length; index += 1, at += 4) out[index] = buffer.readFloatLE(at);
    return out;
  };
  const positions = floats(vertices * 3);
  const normals = floats(vertices * 3);
  const uvs = floats(vertices * 2);
  const indices = new Uint32Array(count);
  for (let index = 0; index < count; index += 1, at += 4) indices[index] = buffer.readUInt32LE(at);
  for (const [list, reach] of [[positions, MESH_REACH], [normals, MESH_NORMAL_REACH], [uvs, MESH_UV_REACH]]) for (const value of list) if (!Number.isFinite(value) || Math.abs(value) >= reach) fail();
  for (const index of indices) if (index >= vertices) fail();
  return { positions, normals, uvs, indices };
}

async function decodePicture(bytes) {
  let decoded;
  try {
    decoded = await sharp(bytes, { failOn: "error", limitInputPixels: 64 * 1024 * 1024 })
      .rotate()
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new RangeError("Картинка своей модели не читается (нужны PNG, JPEG или WebP).");
  }
  const { data, info } = decoded;
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/**
 * Картинки и сетки моделей работы из окна: `images.modelImages` и
 * `images.modelMeshes` (base64, `placeModelImages` окна) → `{ pictures:
 * Map(asset → { rgba, width, height }), meshes: Map(asset → сетка) }`.
 * Нужное решает работа: лишнее не читается, недостающее — отказ словами.
 */
export async function decodePlaceModelImages(input, images = {}) {
  const models = shownPlaceModels(normalizePlaceModels(input));
  const pictures = new Map();
  const meshes = new Map();
  for (const item of models) {
    if (item.shape === "mesh") {
      if (!PLACE_MODEL_ASSET.test(item.asset)) continue;
      if (!meshes.has(item.asset)) meshes.set(item.asset, decodePlaceMeshBytes(base64Bytes(images?.modelMeshes?.[item.asset], MESH_BYTES, "Своя модель"), placeModelTitle(item)));
      if (item.texture && EMBLEM_ASSET.test(item.texture) && !pictures.has(item.texture))
        pictures.set(item.texture, await decodePicture(base64Bytes(images?.modelImages?.[item.texture], IMAGE_BYTES, "Лист своей модели")));
    } else if (!pictures.has(item.asset)) pictures.set(item.asset, await decodePicture(base64Bytes(images?.modelImages?.[item.asset], IMAGE_BYTES, "Картинка своей модели")));
  }
  return { pictures, meshes };
}

/* ------------------------------------------------------------------ *
 * Лист модели
 * ------------------------------------------------------------------ */

const powerOfTwo = (value, side = SHEET_SIDE) => Math.min(side, Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, value)))));

function hasAlpha(picture) {
  for (let at = 3; at < picture.rgba.length; at += 4) if (picture.rgba[at] < 250) return true;
  return false;
}

/* Картинка «Объёма» в той же мерке, что у кадра окна. */
function solidSource(picture) {
  const scale = Math.min(1, SOLID_SIDE / Math.max(picture.width, picture.height));
  if (scale >= 1) return picture;
  const width = Math.max(1, Math.round(picture.width * scale));
  const height = Math.max(1, Math.round(picture.height * scale));
  return { rgba: new Uint8ClampedArray(resample(new Uint8ClampedArray(picture.rgba), picture.width, picture.height, width, height)), width, height };
}

/** Лист модели: DXT5 со всеми мипами, непрозрачность — в альфе; `side` — предел стороны (атлас живой картинки — 2048). */
export function placeModelSheet(picture, opacity = 100, side = SHEET_SIDE) {
  const width = powerOfTwo(picture.width, side);
  const height = powerOfTwo(picture.height, side);
  const rgba = new Uint8ClampedArray(resample(new Uint8ClampedArray(picture.rgba), picture.width, picture.height, width, height));
  if (opacity < 100) for (let at = 3; at < rgba.length; at += 4) rgba[at] = Math.round((rgba[at] * opacity) / 100);
  const dds = encodeDds({ width, height, format: "DXT5", mipLevels: fullMipLevels(width, height), rgba: bleedTransparent(rgba, width, height) });
  return { dds, width, height };
}

/* Серый лист 4 × 4: своя модель без своего листа. */
const GREY = Object.freeze({ rgba: new Uint8ClampedArray(64).fill(184).map((value, index) => (index % 4 === 3 ? 255 : value)), width: 4, height: 4 });

/** Шейдер модели по её облику. */
export function placeModelShader(item, picture) {
  const alpha = item.opacity < 100 || ((item.shape === "plate" || item.shape === "solid" || item.shape === "mesh") && hasAlpha(picture));
  if (item.glow > 0) return { shader: alpha ? "emissive_alpha" : "emissive", emissive: placeModelEmissive(item) };
  return { shader: alpha ? "alpha" : "default" };
}

/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

const round = (value, digits = 5) => Math.round(value * 10 ** digits) / 10 ** digits + 0;

/* Точка поворотом кватерниона `[x, y, z, w]` (`conjugate` — обратным). */
function turnBy([x, y, z, w], point, conjugate = false) {
  const [qx, qy, qz] = conjugate ? [-x, -y, -z] : [x, y, z];
  const [px, py, pz] = point;
  const tx = 2 * (qy * pz - qz * py);
  const ty = 2 * (qz * px - qx * pz);
  const tz = 2 * (qx * py - qy * px);
  return [px + w * tx + (qy * tz - qz * ty), py + w * ty + (qz * tx - qx * tz), pz + w * tz + (qx * ty - qy * tx)];
}

/*
 * Помещение игры: место мира → оси помещения. `instance` — экземпляр MLO
 * (`position`, `rotation` — как записан в карте, игра его не обращает:
 * мир = место + q·точка, см. `mloInstanceTransform` договора).
 */
export function mloLocalOf(instance, world) {
  const offset = world.map((value, axis) => value - instance.position[axis]);
  return turnBy(instance.rotation, offset, true);
}

/* Сетка — в оси помещения: обратный поворот экземпляра в вершинах. */
function meshIntoMlo(mesh, rotation) {
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < positions.length; at += 3) {
    const p = turnBy(rotation, [mesh.positions[at], mesh.positions[at + 1], mesh.positions[at + 2]], true);
    const n = turnBy(rotation, [mesh.normals[at], mesh.normals[at + 1], mesh.normals[at + 2]], true);
    for (let axis = 0; axis < 3; axis += 1) {
      positions[at + axis] = p[axis];
      normals[at + axis] = n[axis];
      min[axis] = Math.min(min[axis], p[axis]);
      max[axis] = Math.max(max[axis], p[axis]);
    }
  }
  return { ...mesh, positions, normals, bounds: { min, max } };
}

/* Единичная сетка модели по облику: своя модель — из окна, «Объём» — по картинке, остальное — договор. */
function unitMeshOf(item, picture, meshes, cell = null) {
  let unit = null;
  if (item.shape === "mesh") unit = placeModelUnitMesh(item, { mesh: meshes.get(item.asset) || null });
  else if (item.shape === "solid") {
    const source = solidSource(picture);
    unit = placeModelSolid(arenaStarModel, source.rgba, source.width, source.height, item.depth);
  } else unit = placeModelUnitMesh(item, { cell });
  if (!unit) throw new Error(`«${item.label || item.name || "Своя модель"}»: в картинке нет фигуры для «Объёма» — возьмите картинку с прозрачным фоном или другую форму.`);
  return unit;
}

/**
 * Одна своя модель — файлы игры (общий сборщик своих моделей мест и живых
 * плашек): `{ files, archetype, pivot, bounds, uvClip, animated, host }`.
 *
 * `item` — модель договора (`normalizePlaceModel`); `picture` — её картинка
 * `{ rgba, width, height }` (у живой — атлас кадров); `name` — имя модели
 * игры, `clipDictionary` — имя словаря клипов (нужен движению и живой
 * картинке); `mesh` — готовая сетка в облике модели (`placeModelMesh`, в
 * помещении — уже в его осях), иначе — по `unit`; `motion`, `animation` —
 * можно ли модели движение клипом и живую картинку (в модели зала — нет);
 * `compile` — нативный хост, `workDir` — пустая рабочая папка.
 * `archetype` — что ставить в типы: рамка (с движением), дальность, флаги
 * (0x80200 — движение, 0x400 — клип развёртки) и словарь клипов.
 */
export async function compilePlaceModel(
  item,
  { name, clipDictionary = `${name}_clips`, picture, unit = null, mesh = null, motion = true, animation = true, sheetSide = null, compile, workDir },
) {
  const shaped = mesh || placeModelMesh(item, unit);
  if (!shaped) throw new Error("У своей модели нет сетки.");
  const frames = motion ? placeModelFrames(item) : null;
  const live = animation && item.animation ? placeModelAnimationClip(item.animation) : null;
  const sheet = placeModelSheet(picture, item.opacity, sheetSide || (item.animation ? ATLAS_SIDE : SHEET_SIDE));
  const look = placeModelShader(item, picture);
  const clips = frames || live ? clipDictionary : null;
  await fs.mkdir(workDir, { recursive: true });
  const texture = path.join(workDir, "sheet.dds");
  await fs.writeFile(texture, sheet.dds, { flag: "wx" });
  const request = path.join(workDir, "model.json");
  const vertices = shaped.positions.length / 3;
  await fs.writeFile(
    request,
    JSON.stringify({
      format: "astral.compile-star-model",
      version: 1,
      name,
      clipDictionary: clips,
      texture,
      textureSha256: `sha256:${createHash("sha256").update(sheet.dds).digest("hex")}`,
      width: sheet.width,
      height: sheet.height,
      lodDist: item.distance,
      shader: look.shader,
      ...(look.emissive !== undefined ? { emissive: look.emissive } : {}),
      mesh: {
        positions: Array.from(shaped.positions, (value) => round(value)),
        normals: Array.from(shaped.normals, (value) => round(value)),
        uvs: Array.from(shaped.uvs, (value) => round(value)),
        /* Всё — на кости барабана (движется), у модели без движения — на корне. */
        parts: new Array(vertices).fill(frames ? 1 : 0),
        indices: Array.from(shaped.indices),
      },
      motion: frames,
      /* Живая картинка: сдвиг развёртки на каждый кадр клипа 30 кадров/с. */
      ...(live ? { uvAnimation: { duration: live.duration, shifts: live.shifts.flat().map((value) => round(value, 6)) } } : {}),
    }),
  );
  const out = path.join(workDir, "out");
  const result = await compile("compile-star-model", { input: request, output: out });
  const ydr = await fs.readFile(path.join(out, `${name}.ydr`)).catch(() => null);
  if (!ydr?.length) throw new Error("Сборка своей модели не дала файла модели.");
  const files = [{ name: `${name}.ydr`, bytes: ydr, path: path.join(out, `${name}.ydr`) }];
  if (clips) {
    const ycd = await fs.readFile(path.join(out, `${clips}.ycd`)).catch(() => null);
    if (!ycd?.length) throw new Error(frames ? "Сборка своей модели не дала клипа движения." : "Сборка живой картинки не дала клипа кадров.");
    files.push({ name: `${clips}.ycd`, bytes: ycd });
  }
  /* Ось модели (кость барабана) — над её серединой: сущность сдвигается на неё. */
  const pivot = Array.isArray(result?.pivot) ? result.pivot.map(Number) : [0, 0, 0];
  const bounds = result?.bounds?.min && result?.bounds?.max ? result.bounds : shaped.bounds;
  const archetype = {
    name,
    lodDist: item.distance,
    bbMin: bounds.min.map((value) => round(value, 4)),
    bbMax: bounds.max.map((value) => round(value, 4)),
    flags: (frames ? ANIMATED_ARCHETYPE_FLAGS : 0) | (live ? UV_ANIMATED_ARCHETYPE_FLAG : 0),
    ...(clips ? { clipDictionary: clips } : {}),
  };
  /* `host` — ответ хоста как есть: файлы с их сверкой после сборки (у живой — ключ и кадры UV-клипа). */
  return { files, archetype, pivot, bounds, uvClip: live ? `${name}_uv_0` : null, animated: Boolean(frames), host: result || null };
}

/* Место для живой плашки без своей картинки в хранилище окна. */
const LIVE_BANNER_ASSET = `hangar-emblem:${"0".repeat(64)}`;

/**
 * Живая плашка (ТЗ 11.10.2026, ночь, задача 2) — для чужих мест, которые
 * ставят модель сами (баннеры арены): атлас кадров гифки → модель игры с
 * клипом развёртки. Ответ — `{ files: [{ name, bytes }], archetype, pivot,
 * bounds, uvClip }`; архетип и сущность (место, поворот сущности) ставит
 * вызывающий: архетипу — `archetype` целиком (флаги 0x400, словарь клипов),
 * сущности — место минус `pivot` (ось модели ≈ (0,0006; −0,315; 0)).
 *
 * `picture` — атлас `{ rgba, width, height }`, `animation` — `{ columns,
 * rows, frames, delays }` (`normalizePlaceModelAnimation`), `width`/`height`
 * — размер одного кадра (пропорции плашки), `size` — длинная сторона, м;
 * `rotation` — «Z·Y·X», градусы, в вершинах (лицо плашки — −Y); `shape` —
 * `plate` (по умолчанию), `box`, `sphere`, `cylinder`; `opacity`, `glow`,
 * `distance` — как у своих моделей; `name` — имя модели игры (строчные,
 * цифры, `_`), словарь клипов — `<name>_clips`.
 */
export async function buildLiveBanner({
  name,
  picture,
  animation,
  width,
  height,
  size = 3,
  rotation = [0, 0, 0],
  shape = "plate",
  opacity = 100,
  glow = 0,
  distance = 300,
  compile,
  stateDir = "",
}) {
  if (typeof compile !== "function") throw new Error("Сборщик живой плашки не подключён — обновите Astral.");
  const item = normalizePlaceModel({ asset: LIVE_BANNER_ASSET, shape, width, height, size, rotation, opacity, glow, distance, animation });
  if (!item?.animation) throw new Error("У живой плашки нет кадров — нужна гифка из 2–64 кадров.");
  if (!picture?.rgba || !picture.width || !picture.height) throw new Error("Атлас кадров живой плашки не пришёл.");
  const workDir = path.join(stateDir || os.tmpdir(), "live-banners", randomUUID());
  try {
    const built = await compilePlaceModel(item, { name, picture, unit: placeModelUnitMesh(item), motion: false, compile, workDir });
    return { ...built, files: built.files.map(({ name: file, bytes }) => ({ name: file, bytes })) };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * Модели в модели зала (залы Majestic, `PLACE_MODEL_HALLS` договора):
 * каждая собирается статичной моделью (её сетка — уже в осях модели зала),
 * потом геометрии пересаживаются в модель зала (`graft-drawable`): сперва
 * все — в первую (быстро, модели маленькие), потом она одна — в зал (большой
 * файл зала — одним проходом). Сдвиг `graft-drawable` — в осях приёмника:
 * у первой модели её вершины — сетка + ось модели, поэтому в зал она едет
 * сдвигом «место − ось», остальные в неё — «место − место первой».
 */
async function graftIntoHall({ base, file, parts, compile, workDir }) {
  await fs.mkdir(workDir, { recursive: true });
  const [first, ...rest] = parts;
  let donor = first.ydr;
  let step = 0;
  for (const part of rest) {
    step += 1;
    const output = path.join(workDir, `donor-${step}`, `${first.name}.ydr`);
    const request = path.join(workDir, `donor-${step}.json`);
    await fs.writeFile(
      request,
      JSON.stringify({
        format: "astral.graft-drawable",
        version: 1,
        target: donor,
        donor: part.ydr,
        diffuse: [`${part.name}_star`],
        offset: part.centre.map((value, axis) => round(value - first.centre[axis], 4)),
      }),
    );
    await compile("graft-drawable", { input: request, output });
    donor = output;
  }
  const target = path.join(workDir, "base", file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, base);
  const output = path.join(workDir, "out", file);
  const request = path.join(workDir, "hall.json");
  await fs.writeFile(
    request,
    JSON.stringify({
      format: "astral.graft-drawable",
      version: 1,
      target,
      donor,
      diffuse: parts.map((part) => `${part.name}_star`),
      offset: first.centre.map((value, axis) => round(value - (first.pivot[axis] || 0), 4)),
    }),
  );
  const result = await compile("graft-drawable", { input: request, output });
  const bytes = await fs.readFile(output).catch(() => null);
  if (!bytes?.length) throw new Error(`Модели не встали в модель зала ${file}.`);
  if (bytes.length > HALL_FILE_LIMIT) throw new Error(`Модель зала со своими моделями — ${Math.round(bytes.length / 1048576)} МБ, больше 16 МБ: уберите часть моделей из зала или сделайте их проще.`);
  return { bytes, result };
}

/**
 * Файлы своих моделей места: `{ files, report }`.
 *
 * `input` — список моделей работы; `pictures`, `meshes` — их картинки и
 * сетки (`decodePlaceModelImages`); `origin(sceneId)` — начало сцены в
 * мире (`null` — сцены нет: модель пропускается с записью в отчёте);
 * `compile` — нативный хост; `manifest` — байты `_manifest.ymf`, что набор
 * уже везёт (связь моделей допишется в него), или `null` (манифест — свой).
 * `interior(sceneId)` — сцена внутри помещения игры: `{ file, mlo, instance,
 * read() }` (`read` — байты файла помещения: правленые набором или из
 * игры); модели такой сцены встают сущностями помещения, а не карты.
 * `hall(sceneId)` — у сцены «внутри» без своих помещений (залы Majestic,
 * `placeModelSceneRules`) — `{ read() }`: байты модели зала (правленые
 * набором или из поставки); модели вшиваются в неё геометрией.
 * `sheetSide` — предел стороны листа моделей (по умолчанию: 1024, у живой
 * картинки 2048, у «экономной» живой картинки места — 1024); живые плашки щитов держат листы поменьше.
 * Без моделей — `{ files: [] }`.
 */
export async function buildPlaceModels(
  setId,
  input,
  { pictures = new Map(), meshes = new Map(), origin = () => [0, 0, 0], interior = () => null, hall = () => null, compile = null, stateDir = "", manifest = null, sheetSide = null } = {},
) {
  const models = shownPlaceModels(normalizePlaceModels(input));
  const report = { models: 0, animated: 0, live: 0, skipped: [] };
  if (!models.length) return { files: [], report };
  if (typeof compile !== "function") throw new Error("Сборщик своих моделей не подключён — обновите Astral.");
  const names = placeModelNames(setId);
  const staging = path.join(stateDir, "recolor", setId, "models", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  const files = [];
  const archetypes = [];
  const entities = [];
  /* Кому из живых гифок быть живым (профиль `places`, 11.11.2026): не больше 16 и 96 МБ листов; что сверх — первым кадром, причина — в отчёте. Залы Majestic и сцены без места в мире в счёт не идут. */
  const gifPlan = placeModelsGifPlan(models.filter((item) => item.animation && !placeModelSceneRules(item.scene).hall && origin(item.scene)));
  report.gif = { count: gifPlan.count, bytes: gifPlan.bytes, still: [...gifPlan.still].map(([id, reason]) => ({ id, reason })) };
  /*
   * Модели в помещениях игры — по помещению: `файл|MLO` → { room, models }.
   * В одном файле типов бывает несколько помещений (винный магазин и Fleeca
   * — `v_int_10.ytyp`): у каждого свои модели.
   */
  const rooms = new Map();
  /* Модели в моделях залов: файл зала → { hall, read, parts }. */
  const halls = new Map();
  try {
    let index = 0;
    for (const original of models) {
      const start = origin(original.scene);
      if (!start) {
        report.skipped.push(original.id);
        continue;
      }
      const rules = placeModelSceneRules(original.scene);
      const atlas = original.shape === "mesh" ? (original.texture ? pictures.get(original.texture) : null) || GREY : pictures.get(original.asset);
      if (!atlas) throw new Error("Картинка своей модели не пришла — нажмите «Применить» ещё раз.");
      /* Гифка, которой в этом месте не играть (зал Majestic, сверх предела или веса), встаёт первым кадром — его клеткой листа, а не всем листом: кадр резкий и без клипа. */
      const stillGif = Boolean(original.animation) && (rules.hall || gifPlan.still.has(original.id));
      const item = stillGif ? { ...original, animation: null } : original;
      const picture = stillGif ? gifSurfaceFrame(atlas, original.animation, 0) : atlas;
      const itemSheet = sheetSide || (item.animation ? placeModelSheetSide(item.animation) : null);
      /* Отступ развёртки от края клетки живой картинки — в текселях листа (`placeModelCellInset`): у маленьких клеток двусторонняя фильтрация не берёт цвет соседнего кадра. */
      const unit = unitMeshOf(item, picture, meshes, placeModelCellPixels(item.animation, picture, itemSheet));
      const name = names.model(index);
      const work = path.join(staging, name);

      /* Зал Majestic сущностью помещения: точка в комнате одного из залов (`interior` отвечает `inside: false`, если точка вне всех комнат). */
      const entityHall = Boolean(rules.hall) && !hallGraft() && hallEntities();
      let hallRoom = null;
      if (entityHall) {
        hallRoom = interior?.(original.scene, placeModelWorld(item.position, start)) || null;
        if (!hallRoom || hallRoom.inside === false) {
          report.skipped.push(item.id);
          (report.outsideHall ||= []).push(item.id);
          continue;
        }
      }
      /* Зал без своих помещений: вшивка в модель зала меняет её строение, и клиент Majestic её отвергает («Invalid asset», вылет, опыт 20.11.2026) — не пишем. */
      if (rules.hall && !hallGraft() && !entityHall) {
        report.skipped.push(item.id);
        (report.hallRefused ||= []).push(item.id);
        continue;
      }
      if (rules.hall && !entityHall) {
        const base = hall?.(item.scene) || null;
        if (!base || !placeModelInHall(rules.hall, item)) {
          report.skipped.push(item.id);
          (report.outsideHall ||= []).push(item.id);
          continue;
        }
        const turned = meshIntoMlo(placeModelMesh(item, unit), rules.hall.rotation);
        /* Лист — до 512 px: модель зала с моделями не должна перерасти 16 МБ файла набора. */
        const built = await compilePlaceModel(item, { name, picture, mesh: turned, motion: false, animation: false, sheetSide: HALL_SHEET_SIDE, compile, workDir: work });
        if (stillGif) report.hallStill = (report.hallStill || 0) + 1;
        const group = halls.get(rules.hall.file) || { hall: rules.hall, read: base.read, parts: [] };
        group.parts.push({ name, ydr: built.files[0].path, centre: placeModelHallLocal(rules.hall, item.position), pivot: built.pivot });
        halls.set(rules.hall.file, group);
        report.models += 1;
        report.hall = (report.hall || 0) + 1;
        index += 1;
        continue;
      }

      const room = entityHall ? hallRoom : interior?.(item.scene, placeModelWorld(item.position, start)) || null;
      /* В помещении сущность стоит в его осях без поворота: обратный поворот экземпляра — в сетке. */
      const mesh = room ? meshIntoMlo(placeModelMesh(item, unit), room.instance.rotation) : placeModelMesh(item, unit);
      const built = await compilePlaceModel(item, {
        name,
        ...(entityHall ? { motion: false, animation: false } : { clipDictionary: names.clips(index) }),
        picture,
        mesh,
        sheetSide: itemSheet,
        compile,
        workDir: work,
      });
      files.push(...built.files.map(({ name: file, bytes }) => ({ name: file, bytes })));
      const { archetype, pivot } = built;
      const world = placeModelWorld(item.position, start);
      if (room) {
        const local = mloLocalOf(room.instance, world);
        const key = `${room.file.toLowerCase()}|${room.mlo ?? ""}`;
        const group = rooms.get(key) || { room, models: [] };
        group.models.push({ ...archetype, position: local.map((value, axis) => round(value - (pivot[axis] || 0), 4)), entityFlags: 32 });
        rooms.set(key, group);
        report.interior = (report.interior || 0) + 1;
      } else {
        archetypes.push(archetype);
        entities.push({ archetype: name, position: world.map((value, axis) => round(value - (pivot[axis] || 0), 4)), lodDist: item.distance, flags: 32 });
      }
      report.models += 1;
      if (built.animated) report.animated += 1;
      if (built.uvClip) {
        report.live += 1;
        /* Клип развёртки, как его перечитал хост после сборки: имя и число кадров. */
        (report.clips ||= []).push({ model: name, clip: built.uvClip, frames: built.host?.uvFrames ?? 0 });
      }
      index += 1;
    }
    /* Модели залов: геометрией в модель зала (поверх правки листов набора). */
    for (const [file, group] of halls) {
      const base = await group.read();
      if (!base?.length) throw new Error(`Модель зала ${file} не прочиталась — подготовьте арену заново.`);
      const grafted = await graftIntoHall({ base, file, parts: group.parts, compile, workDir: path.join(staging, "hall", file.replace(/[^a-z0-9_.-]/gi, "_")) });
      files.push({ name: file, bytes: grafted.bytes });
    }
    /* Помещения: архетипы и сущности моделей — в файл помещения; второе помещение того же файла — поверх первого. */
    const patched = new Map();
    let step = 0;
    for (const { room, models: placed } of rooms.values()) {
      const file = room.file;
      const base = patched.get(file.toLowerCase())?.bytes || (await room.read());
      if (!base?.length) throw new Error(`Файл помещения ${file} не прочитался — подключите GTA V и нажмите «Применить» ещё раз.`);
      step += 1;
      const work = path.join(staging, "mlo", String(step));
      const basePath = path.join(work, "base", file);
      await fs.mkdir(path.dirname(basePath), { recursive: true });
      await fs.writeFile(basePath, base);
      const request = path.join(work, "request.json");
      await fs.writeFile(request, JSON.stringify({ format: "astral.compile-mlo-models", version: 1, base: basePath, ...(room.mlo ? { mlo: room.mlo } : {}), models: placed }));
      const output = path.join(work, "out", file);
      await compile("compile-mlo-models", { input: request, output });
      const bytes = await fs.readFile(output).catch(() => null);
      if (!bytes?.length) throw new Error(`Модели в помещении ${file} не встали.`);
      patched.set(file.toLowerCase(), { name: file, bytes });
    }
    files.push(...patched.values());
    if (!entities.length) return { files, report };

    const placeRequest = path.join(staging, "place.json");
    await fs.writeFile(
      placeRequest,
      JSON.stringify({ format: "astral.compile-placements", version: 1, types: names.types, map: names.map, manifest: !manifest, archetypes, entities }),
    );
    const placeOut = path.join(staging, "place");
    await compile("compile-placements", { input: placeRequest, output: placeOut });
    for (const name of [`${names.types}.ytyp`, `${names.map}.ymap`, ...(manifest ? [] : ["_manifest.ymf"])]) {
      const bytes = await fs.readFile(path.join(placeOut, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Расстановка своих моделей не дала ${name}.`);
      files.push({ name, bytes });
    }
    /* Манифест набора уже есть — связь «карта моделей → типы» дописывается в него. */
    if (manifest) {
      const base = path.join(staging, "base.ymf");
      await fs.writeFile(base, manifest, { flag: "wx" });
      const request = path.join(staging, "manifest.json");
      await fs.writeFile(request, JSON.stringify({ format: "astral.compile-manifest", version: 1, base, dependencies: [{ map: names.map, types: [names.types] }] }));
      const output = path.join(staging, "merged", "_manifest.ymf");
      await compile("compile-manifest", { input: request, output });
      const bytes = await fs.readFile(output).catch(() => null);
      if (!bytes?.length) throw new Error("Манифест места со своими моделями не собрался.");
      files.push({ name: "_manifest.ymf", bytes });
    }
    return { files, report };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Свои модели — к собранному набору: файлы моделей добавляются, манифест
 * набора (если он есть) заменяется дописанным. `built` — ответ сборки
 * набора (`{ files, patches, … }`).
 */
export async function withPlaceModels(setId, models, built, options) {
  const existing = built.files.find((file) => file.name.toLowerCase() === "_manifest.ymf") || null;
  /* Файл помещения, что набор уже правит (кресла и звезда арены), — основа для моделей. */
  const interior = options.interior
    ? (scene, point) => {
        const room = options.interior(scene, point);
        if (!room) return null;
        const own = built.files.find((file) => file.name.toLowerCase() === room.file.toLowerCase());
        return own ? { ...room, read: async () => own.bytes } : room;
      }
    : undefined;
  /* Модель зала, что набор уже правит (листы экранов и стен Majestic), — основа: модели ложатся поверх. */
  const hall = options.hall
    ? (scene) => {
        const base = options.hall(scene);
        if (!base) return null;
        const own = built.files.find((file) => file.name.toLowerCase() === String(base.file || "").toLowerCase());
        return own ? { ...base, read: async () => own.bytes } : base;
      }
    : undefined;
  const placed = await buildPlaceModels(setId, models, { ...options, ...(interior ? { interior } : {}), ...(hall ? { hall } : {}), manifest: existing?.bytes || null });
  if (!placed.files.length) return built;
  const added = new Set(placed.files.map((file) => file.name.toLowerCase()));
  return {
    ...built,
    files: [...built.files.filter((file) => !added.has(file.name.toLowerCase())), ...placed.files],
    patches: [
      ...built.patches,
      {
        file: "models",
        models: placed.report.models,
        animated: placed.report.animated,
        ...(placed.report.live ? { live: placed.report.live } : {}),
        ...(placed.report.hall ? { hall: placed.report.hall } : {}),
      },
    ],
    modelsReport: placed.report,
  };
}
