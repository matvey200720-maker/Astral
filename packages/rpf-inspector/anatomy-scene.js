/*
 * Сцена обложки компонента — блок `scene` описи `part.json` (пакет Р3г, проект `REDUX-SYSTEM-1011.md`, §8; Хелпер 28, 10.11.2026).
 *
 * Обложка строится из моделей самого компонента, а вид задаёт только камера. Конвейер кладёт в опись данные для съёмки:
 *   models   — модели компонента (`.ydr/.yft/.ydd`, без `+hi` и LOD-дублей) с размерами;
 *   textures — все `.ytd` компонента (имя, файл, размер), без `+hi`-дублей, если есть основной словарь (схема 2);
 *   types    — пути `.ytyp` компонента, mapFiles — пути `.ymap` компонента (схема 2);
 *   venue    — у арены: `gta5rp` | `majestic`, только когда сервер доказан отпечатком (то же, чем подписывается карточка); иначе поля нет (схема 2);
 *   places   — места моделей в мире из `.ymap` компонента (позиция, поворот, карта);
 *   frame    — рамка по местам (центр и радиус круга мира);
 *   world    — есть ли места в мире. `false` — «своих карт у компонента нет»: его модели подменяют штатные, а мест в мире у них нет (на настоящем разборе так у арены и
 *              всех интерьеров: `world: false`, `places: []`); обложка — «модель на чёрном» без круга. Если `.ymap` в компоненте всё же есть, но ни одна сущность не
 *              из моделей компонента, `world` тоже `false`, а `mapFiles` эти карты называет. Место подмены, вход интерьера, перед здания и рамку считает потребитель
 *              (Хелпер 29) из файлов заявки и описи мира, а не этот модуль;
 *   camera   — вид съёмки по слоту (таблица §8).
 *
 * Чистый модуль: `.ymap` читает внедряемая `readPlaces(путь) → [{ archetype, position, rotation, scale }]` (`readMapEntityPlaces`).
 */

import { joaat } from "./place-split.js";

export const SCENE_SCHEMA = 2;
export const PLACES_LIMIT = 500;
export const MAPS_LIMIT = 80;
const MODEL = /\.(?:ydr|yft|ydd)$/i;
const LOD_COPY = /(?:\+hi|_lod\d*|_slod\d*|_far)\.(?:ydr|yft|ydd)$/i;
const TEXTURE = /\.ytd$/i;
const HI_TEXTURE = /\+hi\.ytd$/i;
const LIST_LIMIT = 400;
/* Сервер арены, который сцена называет: только эти два (`platforms` карточки). */
const VENUES = new Set(["gta5rp", "majestic"]);
const MIN_RADIUS = 5;

/** Камера по слоту компонента (§8): «как сейчас» — слоты, у которых своя сцена обложки. */
export function cameraOfSlot(slot) {
  const value = String(slot || "");
  if (value === "arenas") return "arena-hall";
  if (value === "hangar") return "hangar-entrance";
  if (/^interior-/.test(value)) return "interior-entrance";
  if (/^mapping-/.test(value)) return "model-front";
  if (["minimap", "minimap-position"].includes(value)) return "minimap";
  if (value === "large-map") return "large-map";
  if (value === "crosshair") return "crosshair";
  if (["timecycle", "kill-effects"].includes(value)) return "timecycle";
  if (["effects", "sounds"].includes(value)) return value;
  if (["hudcolor", "water", "optimization-toggles"].includes(value)) return "card";
  return "building-front";
}

const lower = (value) => String(value ?? "").split("\\").join("/").toLowerCase();
const baseOf = (path) => lower(path).split("/").pop();
const stemOf = (name) => name.replace(/\.[^.]+$/, "");
const round = (value) => Math.round(value * 1000) / 1000;

/** Модели компонента: файлы моделей единиц-архивов, один раз на имя. */
export function modelsOf(files) {
  const seen = new Map();
  for (const file of files) {
    const name = baseOf(file.path);
    if (!MODEL.test(name) || LOD_COPY.test(name) || seen.has(name)) continue;
    seen.set(name, { name, file: file.path, bytes: file.size });
  }
  return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Текстурные словари компонента (`.ytd`), один раз на имя; `+hi`-дубль отбрасывается, если есть основной словарь. */
export function texturesOf(files) {
  const seen = new Map();
  for (const file of files) {
    const name = baseOf(file.path);
    if (!TEXTURE.test(name) || seen.has(name)) continue;
    seen.set(name, { name, file: file.path, bytes: file.size });
  }
  return [...seen.values()]
    .filter((texture) => !(HI_TEXTURE.test(texture.name) && seen.has(texture.name.replace(HI_TEXTURE, ".ytd"))))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Пути файлов с расширением `extension` (`.ytyp`, `.ymap`): один раз на путь, по алфавиту. */
export function pathsOf(files, extension) {
  return [...new Set(files.map((file) => String(file.path)).filter((path) => baseOf(path).endsWith(extension)))].sort((left, right) => left.localeCompare(right));
}

/** Рамка по местам: центр — среднее, радиус — самое дальнее место (не меньше `MIN_RADIUS`). */
export function frameOf(places) {
  if (!places.length) return null;
  const count = places.length;
  const center = [0, 1, 2].map((axis) => round(places.reduce((sum, place) => sum + place.position[axis], 0) / count));
  const radius = places.reduce((far, place) => Math.max(far, Math.hypot(place.position[0] - center[0], place.position[1] - center[1], place.position[2] - center[2])), 0);
  return { center, radius: round(Math.max(radius, MIN_RADIUS)) };
}

/**
 * Сцена компонента.
 *
 * @param {{ slot: string }} component компонент анатомии
 * @param {{ path: string, size: number }[]} files файлы компонента (единицы-архивы)
 * @param {{ readPlaces?: (path: string) => Promise<object[]|null>|object[]|null }} [hooks]
 * @returns {Promise<object>} блок `scene` для `part.json`
 */
export async function sceneOf(component, files, hooks = {}) {
  const models = modelsOf(files);
  const textures = texturesOf(files);
  const types = pathsOf(files, ".ytyp");
  const mapFiles = pathsOf(files, ".ymap");
  const byHash = new Map(models.map((model) => [joaat(stemOf(model.name)), model.name]));
  const maps = files.filter((file) => baseOf(file.path).endsWith(".ymap"));
  const placed = [];
  const skipped = [];
  let seen = 0;
  for (const map of maps.slice(0, MAPS_LIMIT)) {
    let entities = null;
    try {
      entities = hooks.readPlaces ? await hooks.readPlaces(map.path) : null;
    } catch (failure) {
      skipped.push({ map: map.path, why: String(failure?.message || failure).slice(0, 120) });
      continue;
    }
    if (!Array.isArray(entities)) continue;
    for (const entity of entities) {
      seen += 1;
      const model = byHash.get(entity.archetype >>> 0);
      /* В круг мира идут только места моделей самого компонента: остальное — штатные объекты, которые карта автора подменяет. */
      if (!model) continue;
      placed.push({ model, position: entity.position.map(round), rotation: entity.rotation.map(round), map: baseOf(map.path) });
    }
  }
  if (maps.length > MAPS_LIMIT) skipped.push({ map: `${maps.length - MAPS_LIMIT} карт`, why: `больше предела ${MAPS_LIMIT}` });
  const frame = frameOf(placed);
  return {
    schema: SCENE_SCHEMA,
    camera: cameraOfSlot(component.slot),
    world: placed.length > 0,
    ...(component.slot === "arenas" && VENUES.has(component.server) ? { venue: component.server } : {}),
    models: models.slice(0, LIST_LIMIT),
    modelsTotal: models.length,
    textures: textures.slice(0, LIST_LIMIT),
    texturesTotal: textures.length,
    types: types.slice(0, LIST_LIMIT),
    typesTotal: types.length,
    mapFiles: mapFiles.slice(0, LIST_LIMIT),
    mapFilesTotal: mapFiles.length,
    places: placed.slice(0, PLACES_LIMIT),
    placesTotal: placed.length,
    entitiesSeen: seen,
    maps: maps.length,
    frame,
    ...(skipped.length ? { skipped } : {}),
  };
}
