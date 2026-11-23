/*
 * Облик вещей места (ТЗ 27.10.2026, «Предметы»: своя модель, цвет, своя картинка у вещи места — как у вещей зала арены, `arena-item-looks.js`).
 *
 * Вещь места — запись сущности в карте района игры. Установщик переводит её на свою копию модели (новое имя в типах места
 * `astral_<набор>_local`), общий файл игры и остальные вещи той же модели не меняются. Группы и их проверки — те же, что у арен
 * (`normalizeArenaItems`, `setArenaItemLook`, `arenaItemsSignature`), здесь — данные места: рамки моделей, места вещей, откуда брать файлы моделей
 * (`inventory/place-item-data.js`, строит `scripts/prepare-place-item-data.mjs`).
 *
 * У места есть вещи, чью копию честно не поставить: у модели нет места в описи (файл не нашёлся, типы с её архетипом не читаются, листы лежат в
 * словарях, откуда их не взять). Такие вещи не меняются — окно говорит об этом словами. «Своя модель» и стенд «Картинка вместо предмета» — только у
 * моделей-рисовалок (`ydr`): у фрагмента (`yft`) архетип другого вида, и собранную рисовалку он не загрузит; «Цвет» и своя картинка на листах
 * (`kind: "elements"`) — у обоих видов (копия файла байт в байт со своими листами: у фрагмента физика, дети и разлёт — как в игре).
 *
 * Облик на часть модели (`part: { box, label }`, ТЗ 29.10.2026: «та же логика на всех 3D-страницах») — как у вещей зала: копия — прежняя модель без
 * треугольников части (`itemPartTriangles`) и облик части, пересаженный в неё. Только у рисуемой модели (`ydr`): пересадка в фрагмент (`yft`) не
 * собирается, и группы частей у фрагментов отбрасываются.
 *
 * Картинка на элементах (`kind: "elements"`, владелец 31.10.2026, `item-elements.js`) — как «Цвет»: байтовая копия файла модели (`ydr` или `yft`),
 * листы элементов переписаны своей картинкой по развёртке; поэтому годится любой модели с местом в описи.
 *
 * Чистые функции без DOM и Node.
 */

import { PLACE_ITEM_DATA } from "./inventory/place-item-data.js";
import { normalizeArenaItems } from "./arena-item-looks.js";

export {
  ARENA_ITEM_GROUP_LIMIT as PLACE_ITEM_GROUP_LIMIT,
  arenaItemCopies as placeItemCopies,
  arenaItemGroupOf as placeItemGroupOf,
  arenaItemPartGroups as placeItemPartGroups,
  arenaItemLooksNeeded as placeItemLooksNeeded,
  arenaItemPartRemoved as placeItemPartRemoved,
  arenaItemsSignature as placeItemsSignature,
  itemLookModels as placeItemLookModels,
  itemPartTriangles,
  removeArenaItemPart as removePlaceItemPart,
  setArenaItemLook as setPlaceItemLook,
  setArenaItemLooks as setPlaceItemLooks,
} from "./arena-item-looks.js";

const dataOf = (setId) => PLACE_ITEM_DATA[setId] || null;

/** Есть ли у набора вещи с обликом. */
export const placeItemsAvailable = (setId) => Boolean(dataOf(setId));

/** Рамка модели в её осях `{ min, max }` или `null`. */
export function placeItemFrame(setId, model) {
  const frame = dataOf(setId)?.models?.[model];
  return frame ? { min: frame.slice(0, 3), max: frame.slice(3, 6) } : null;
}

/** Место вещи в сцене кадра: `{ position, rotation, scale: [по плоскости, по высоте] }` или `null`. */
export function placeItemPlace(setId, key) {
  const place = dataOf(setId)?.items?.[key];
  return place ? { position: place.slice(0, 3), rotation: place.slice(3, 7), scale: [place[7], place[8]] } : null;
}

/**
 * Откуда брать файл модели: `{ at, kind, txd, ytyp, archetype, assetType }` или `null` (модели нет в описи — вещь не меняется).
 * `kind` — `ydr` (рисуемая модель) или `yft` (фрагмент).
 */
export const placeItemSource = (setId, model) => dataOf(setId)?.sources?.[model] || null;

/** Можно ли модели свою модель или стенд с картинкой: только рисуемая (`ydr`) с местом в описи. Картинка на листах — у любой модели с местом. */
export const placeItemCanReplace = (setId, model) => placeItemSource(setId, model)?.kind === "ydr";

/** Можно ли модели облик на часть: тоже только рисуемая — облик части пересаживается в копию прежней модели. */
export const placeItemCanPart = placeItemCanReplace;

/** Карты района, где стоят вещи набора и которых нет в плане изоляции места: адреса действующих копий (правки пакетов игры — каждая своя). */
export const placeItemMaps = (setId) => dataOf(setId)?.maps || [];

/** Начало сцены места в мире (у наборов из нескольких мест — по номеру места) или `null`. */
export const placeItemOrigin = (setId, place) => dataOf(setId)?.origins?.[place] || dataOf(setId)?.origin || null;

/** Место вещи в мире `[x, y, z]` (сцена + начало сцены места `place`) или `null`. Те же числа, что у записи карты, с точностью описи. */
export function placeItemWorld(setId, key, place) {
  const at = placeItemPlace(setId, key);
  const origin = placeItemOrigin(setId, place);
  return at && origin ? at.position.map((value, axis) => Math.round((value + origin[axis]) * 1000) / 1000) : null;
}

/** Есть ли у набора опись мест вещей. */
export const placeItemsKnown = (setId) => Boolean(dataOf(setId)?.items);

/** Номера вещей набора с местом в описи (все, что стоят в картах района) — по ним вещи убираются по одной. */
export const placeItemPlaced = (setId) => Object.keys(dataOf(setId)?.items || {}).map(Number);

/** Номера вещей набора, чью копию можно поставить: у модели есть место в описи. */
export function placeItemKeys(setId, modelOf) {
  const keys = new Set();
  for (const key of Object.keys(dataOf(setId)?.items || {})) {
    const model = modelOf(Number(key));
    if (model && placeItemSource(setId, model)) keys.add(Number(key));
  }
  return keys;
}

/**
 * Группы облика в работе набора: `[{ keys, kind, colour?, model, scale, turn }]` или `[{ keys, kind: "elements", elements }]`. Вещь без места в описи,
 * убранная и чужой модели в группу не берётся; «Своя модель» и «Своя картинка» у фрагмента (`yft`) — отбрасываются (у «Цвета» и картинки на
 * элементах файл модели — байтовая копия). Облик на часть (`part`) у фрагмента
 * отбрасывается до разбора: такая группа не забирает вещь у облика на всю модель.
 */
export function normalizePlaceItems(setId, input, { modelOf, removed = [] }) {
  const allowed = placeItemKeys(setId, modelOf);
  const partable = (raw) => !raw?.part || (Array.isArray(raw.keys) && raw.keys.some((key) => Number.isInteger(key) && placeItemCanPart(setId, modelOf(key))));
  const groups = Array.isArray(input) ? input.filter(partable) : input;
  return normalizeArenaItems(groups, { allowed, modelOf, removed }).filter((group) =>
    group.part ? placeItemCanPart(setId, modelOf(group.keys[0])) : group.kind === "colour" || group.kind === "elements" || placeItemCanReplace(setId, modelOf(group.keys[0])),
  );
}

/** Имя копии модели в типах места: `astral_<набор>_item_<номер группы>` (и расширение файла — у вызывающего). */
export const placeItemCopyName = (setId, group) => `astral_${setId}_item_${group + 1}`;

/** Все имена копий набора — для строгого списка доверия. */
export const placeItemCopyNames = (setId, limit = 16) => Array.from({ length: limit }, (_, group) => placeItemCopyName(setId, group));
