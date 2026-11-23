/*
 * Карта паузы: `minimap_main_map.gfx`.
 *
 * Картинка большой карты — не всё, что игра показывает по Esc. Сам
 * Scaleform-фильм карты паузы рисует поверх плиток своё: под плитками лежит
 * прямоугольник моря одного цвета (в штатном файле сине-серый), а над ними —
 * векторные контуры, которые игра включает по ступеням приближения: сетку
 * магистралей, контур суши и наложение дорог (`component_14`…`component_17`,
 * `roads_overlay`). Пока карта штатная, они её и повторяют. Стоит перекрасить
 * карту в белую или чёрную — и по ней идут серые штатные магистрали, а вокруг
 * штата остаётся сине-серое море: своя карта в игре получается наполовину.
 *
 * Сборки карт от сообщества решают это правкой того же файла: контуры
 * вычищают, море красят. Здесь то же делается по устройству файла, а не по
 * смещениям: символы находятся по именам, которыми пользуется ActionScript
 * самого фильма (`mapContainer` → `sea`, `map` → `main_map` →
 * `component_N`, экспорт `roads_overlay`), а цвет моря правится в заливке
 * найденной фигуры. Файл другого устройства — отказ с объяснением, а не
 * догадка.
 *
 * Основа — файл из игры самого игрока (`game-scaleform-base.js`), как у
 * мини-карты и прицела: чужие копии Rockstar в поставке не нужны.
 */

import { createHash } from "node:crypto";
import {
  SWF_TAG,
  defineSprite,
  indexSwf,
  readRect,
  spritePlacements,
  uncompressedScaleform,
} from "./scaleform-swf.js";

export const PAUSE_MAP_GFX_ENTRY =
  "x64/patch/data/cdimages/scaleform_minimap.rpf/minimap_main_map.gfx";

/*
 * Что убирается, когда карта своя: контуры, которые фильм кладёт поверх
 * плиток. Имена — те, под которыми их держит `mapComponents` в классе
 * `MINIMAP_MAIN_MAP`; `roads_overlay` фильм отдаёт наружу экспортом.
 */
export const PAUSE_MAP_OVERLAY_COMPONENTS = Object.freeze([
  "component_14",
  "component_15",
  "component_16",
  "component_17",
]);
export const PAUSE_MAP_ROADS_EXPORT = "roads_overlay";

const SHAPE_TAGS = new Set([
  SWF_TAG.DEFINE_SHAPE,
  SWF_TAG.DEFINE_SHAPE2,
  SWF_TAG.DEFINE_SHAPE3,
  SWF_TAG.DEFINE_SHAPE4,
]);

const HEX = /^#[0-9a-f]{6}$/i;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const toHex = (bytes) =>
  `#${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;

export function hexToRgb(value) {
  const text = String(value || "").trim();
  if (!HEX.test(text)) throw new RangeError(`Цвет не в виде #rrggbb: ${value}`);
  return [1, 3, 5].map((offset) => parseInt(text.slice(offset, offset + 2), 16));
}

/*
 * Единственная сплошная заливка фигуры: где лежат её байты цвета и сколько
 * их. У DefineShape и DefineShape2 цвет — RGB, у третьей и четвёртой версии —
 * RGBA; у четвёртой перед стилями лежат ещё границы кромок и флаги.
 */
function solidFill(buffer, tag) {
  const bounds = readRect(buffer, tag.payloadStart + 2);
  let offset = bounds.end;
  if (tag.code === SWF_TAG.DEFINE_SHAPE4) offset = readRect(buffer, offset).end + 1;
  let count = buffer[offset];
  offset += 1;
  if (count === 0xff) {
    count = buffer.readUInt16LE(offset);
    offset += 2;
  }
  if (count !== 1 || buffer[offset] !== 0x00) return null;
  const bytes =
    tag.code === SWF_TAG.DEFINE_SHAPE || tag.code === SWF_TAG.DEFINE_SHAPE2
      ? 3
      : 4;
  return { offset: offset + 1, bytes, rect: bounds.rect };
}

/** Первая фигура под символом: спрайты проходятся до первого DefineShape. */
function firstShape(index, id, seen = new Set()) {
  if (seen.has(id)) return null;
  const tag = index.definitions.get(id);
  if (!tag) return null;
  if (SHAPE_TAGS.has(tag.code)) return { id, tag };
  if (tag.code !== SWF_TAG.DEFINE_SPRITE) return null;
  const next = new Set(seen).add(id);
  for (const placement of spritePlacements(index.buffer, tag)) {
    const found = firstShape(index, placement.characterId, next);
    if (found) return found;
  }
  return null;
}

const placementNamed = (index, spriteId, name) =>
  spritePlacements(index.buffer, index.definitions.get(spriteId)).find(
    (placement) => placement.name === name,
  ) || null;

const requireSprite = (index, id, label) => {
  const tag = id === undefined ? null : index.definitions.get(id);
  if (!tag || tag.code !== SWF_TAG.DEFINE_SPRITE)
    throw new Error(`minimap_main_map.gfx: не найден спрайт ${label}.`);
  return tag;
};

/**
 * Устройство файла карты паузы: где море, где контуры.
 *
 * @returns {{
 *   index: object,
 *   background: object|null,
 *   sea: {shapeId: number, fill: {offset: number, bytes: number}, color: string},
 *   overlays: {name: string, spriteId: number, shapeIds: number[]}[],
 * }}
 */
export function resolvePauseMapModel(buffer) {
  const index = indexSwf(uncompressedScaleform(buffer));
  const { exports } = index;
  const containerId = exports.get("mapContainer");
  requireSprite(index, containerId, "mapContainer");
  const seaPlacement = placementNamed(index, containerId, "sea");
  if (!seaPlacement)
    throw new Error("minimap_main_map.gfx: в mapContainer нет слоя sea.");
  const seaShape = firstShape(index, seaPlacement.characterId);
  const fill = seaShape ? solidFill(index.buffer, seaShape.tag) : null;
  if (!fill)
    throw new Error(
      "minimap_main_map.gfx: море устроено не одной сплошной заливкой.",
    );
  const sea = {
    spriteId: seaPlacement.characterId,
    shapeId: seaShape.id,
    fill,
    color: toHex(index.buffer.subarray(fill.offset, fill.offset + 3)),
  };

  const mapId = exports.get("map");
  requireSprite(index, mapId, "map");
  const mainMap = placementNamed(index, mapId, "main_map");
  if (!mainMap) throw new Error("minimap_main_map.gfx: в map нет main_map.");
  const mainMapTag = requireSprite(index, mainMap.characterId, "main_map");
  const components = new Map(
    spritePlacements(index.buffer, mainMapTag)
      .filter((placement) => placement.name)
      .map((placement) => [placement.name, placement.characterId]),
  );
  const overlays = [];
  for (const name of PAUSE_MAP_OVERLAY_COMPONENTS) {
    const spriteId = components.get(name);
    requireSprite(index, spriteId, name);
    overlays.push({ name, spriteId });
  }
  const roadsId = exports.get(PAUSE_MAP_ROADS_EXPORT);
  requireSprite(index, roadsId, PAUSE_MAP_ROADS_EXPORT);
  overlays.push({ name: PAUSE_MAP_ROADS_EXPORT, spriteId: roadsId });

  /*
   * Фигуры контуров уходят вместе со спрайтами — но только те, на которые
   * больше никто не ссылается: символ, который ставит кто-то ещё, удалять
   * нельзя, иначе фильм сломается на первом же кадре.
   */
  const references = new Map();
  for (const [id, tag] of index.definitions)
    if (tag.code === SWF_TAG.DEFINE_SPRITE)
      for (const placement of spritePlacements(index.buffer, tag))
        references.set(placement.characterId, [
          ...(references.get(placement.characterId) || []),
          id,
        ]);
  const overlayIds = new Set(overlays.map((item) => item.spriteId));
  for (const overlay of overlays) {
    overlay.shapeIds = spritePlacements(
      index.buffer,
      index.definitions.get(overlay.spriteId),
    )
      .map((placement) => placement.characterId)
      .filter((id) => {
        const tag = index.definitions.get(id);
        return (
          tag &&
          SHAPE_TAGS.has(tag.code) &&
          (references.get(id) || []).every((owner) => overlayIds.has(owner))
        );
      });
  }

  const background =
    index.tags.find((tag) => tag.code === SWF_TAG.SET_BACKGROUND_COLOR) ||
    null;
  return { index, background, sea, overlays };
}

/** Проверка базы по устройству: файл, в котором есть что править. */
export function verifyPauseMapBase(buffer) {
  if (!Buffer.isBuffer(buffer))
    throw new TypeError("Base minimap_main_map.gfx must be a Buffer.");
  resolvePauseMapModel(buffer);
}

/** Цвет моря карты паузы в этом файле — `#rrggbb`. */
export function readPauseMapSeaColor(buffer) {
  return resolvePauseMapModel(buffer).sea.color;
}

/**
 * Собирает `minimap_main_map.gfx` под проект.
 *
 * @param {Buffer} baseBuffer штатный файл из игры игрока
 * @param {object} options
 * @param {boolean} [options.hideOverlays] убрать штатные контуры поверх плиток
 * @param {string|null} [options.seaColor] цвет моря `#rrggbb`; null — как в файле
 * @param {boolean} [options.noSea] убрать море совсем (31.10.2026): слой `sea` — прямоугольник одного цвета,
 *   при отдалении он стоял квадратом поверх кадра игры. Спрайт остаётся пустым, код фильма его не теряет.
 */
export function compilePauseMapGfx(baseBuffer, options = {}) {
  if (!Buffer.isBuffer(baseBuffer))
    throw new TypeError("Base minimap_main_map.gfx must be a Buffer.");
  const hideOverlays = options.hideOverlays === true;
  const seaColor = options.seaColor ? String(options.seaColor) : null;
  if (seaColor && !HEX.test(seaColor))
    throw new RangeError(`Цвет моря не в виде #rrggbb: ${seaColor}`);
  const model = resolvePauseMapModel(baseBuffer);
  const { index } = model;
  const buffer = Buffer.from(index.buffer);

  if (seaColor) {
    const rgb = hexToRgb(seaColor);
    buffer.set(rgb, model.sea.fill.offset);
    /* Фон фильма — тот же цвет: под морем его не видно, но два разных цвета
       в одном файле — повод для вопросов у следующего, кто его откроет. */
    if (model.background) buffer.set(rgb, model.background.payloadStart);
  }

  const replacements = new Map();
  const dropped = new Set();
  const noSea = options.noSea === true;
  if (noSea) replacements.set(model.sea.spriteId, defineSprite(model.sea.spriteId, []));
  if (hideOverlays)
    for (const overlay of model.overlays) {
      replacements.set(overlay.spriteId, defineSprite(overlay.spriteId, []));
      for (const id of overlay.shapeIds) dropped.add(id);
    }

  const output = [buffer.subarray(0, index.headerLength)];
  for (const tag of index.tags) {
    const id =
      tag.code === SWF_TAG.DEFINE_SPRITE || SHAPE_TAGS.has(tag.code)
        ? buffer.readUInt16LE(tag.payloadStart)
        : null;
    if (id !== null && SHAPE_TAGS.has(tag.code) && dropped.has(id)) continue;
    output.push(
      id !== null && replacements.has(id)
        ? replacements.get(id)
        : buffer.subarray(tag.offset, tag.end),
    );
  }
  const compiled = Buffer.concat(output);
  compiled.writeUInt32LE(compiled.length, 4);
  return {
    buffer: compiled,
    sha256: sha256(compiled),
    hiddenOverlays: hideOverlays ? model.overlays.map((item) => item.name) : [],
    seaColor: seaColor || model.sea.color,
    noSea,
  };
}
