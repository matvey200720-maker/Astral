/*
 * Предметы зала по одному (задача 10 ТЗ 18.10.2026, вечер): «редактор, чтобы можно
 * было редачить каждый объект по одиночке, либо все сразу, чтобы выделение было
 * корректно, чтобы можно было менять сам моник и экран на нём».
 *
 * В зале Majestic стоят 604 вещи с именем: модели сервера (`mj_ma_*`, из его
 * `dlc.rpf`) и штатные пропы игры игрока (`apa_mp_h_*`, `ex_mp_h_*`, `ch_prop_*`,
 * `prop_*`…). Каждая — сущность помещения со своим номером (`интерьер × 100000 +
 * номер в помещении`): тот же номер несёт каждая сетка сцены (`orbit-stage`), так
 * щелчок знает, чья вещь под курсором, а подсветка — какие сетки обвести.
 * Опись сцены — `inventory.objects` (`scripts/lib/arena-majestic.mjs`):
 *
 *   { models: [{ name, own }], rooms: ["room1", …], items: [[номер, модель, комната], …] }
 *
 * Охват выбора (`ARENA_OBJECT_SCOPES`, ТЗ владельца 21.10.2026): «этот» — эта вещь, «в комнате» — вещи той же
 * модели в той же комнате (MLO), «во всей арене» — вещи той же модели по всему залу (так их и ставит игра: правка
 * файла модели ложится на все места). Оболочка зала (стены, пол, потолок) — по материалу: «в комнате» и «во всей арене» —
 * её части того же материала (ТЗ владельца 21.10: «крашу деревянные стенки только этой комнаты»).
 * Чистые функции без DOM и Node: их читают окно (кадр, подсветка, панель) и тесты.
 */

import { arenaPlaces, arenaRemovableKeys, arenaServerInventory, arenaSlotElements } from "./arenas.js";
import { arenaObjectKind } from "./arena-object-kinds.js";
import { arenaItemParts } from "./arena-item-parts.js";
import { ARENA_OBJECTS } from "./inventory/arena-objects.js";

export const ARENA_OBJECT_SCOPES = Object.freeze(["one", "room", "arena"]);

/* Один зал — один номер: интерьер и номер сущности в помещении. */
export const ARENA_OBJECT_KEY_SPAN = 100_000;
export const arenaObjectKey = (interior, index) => interior * ARENA_OBJECT_KEY_SPAN + index;
export const arenaObjectInterior = (key) => Math.floor(key / ARENA_OBJECT_KEY_SPAN);

/* Род вещи по имени модели — `arena-object-kinds.js`. */
export { ARENA_OBJECT_KINDS, arenaObjectKind } from "./arena-object-kinds.js";

/* Описи вещей зала по серверам: раз за жизнь окна. */
const cache = new Map();
const stockCache = new Map();

/**
 * Вещи зала сервера по сцене: `{ models, items, byKey, total }` или `null` (у сервера опись без вещей). Только сущности помещения — их номера
 * ставит генератор, по ним же печётся сцена, рамки и разметка выделения. Окно, панель и установщик берут `arenaObjects` — та же опись с частями вещей.
 *   models — `[{ index, name, own, kind, count, keys }]` (`keys` — номера вещей этой модели);
 *   items  — `[{ key, model, room }]` в порядке описи; `byKey` — `Map(номер → вещь)`.
 */
export function arenaStockObjects(server) {
  if (stockCache.has(server)) return stockCache.get(server);
  /* Опись вещей — в описи сервера (Majestic) или снята со сцены зала (`inventory/arena-objects.js`, GTA 5 RP). */
  const raw = arenaServerInventory(server)?.objects || ARENA_OBJECTS[server];
  let out = null;
  if (raw?.items?.length) {
    /* `shell` — оболочка зала (стены, пол, потолок, наклейки): её красят, но не удаляют. */
    const models = raw.models.map((model, index) => ({
      index,
      name: model.name,
      own: Boolean(model.own),
      shell: Boolean(model.shell),
      kind: model.shell ? "structure" : arenaObjectKind(model.name),
      count: 0,
      keys: [],
    }));
    /* Комнаты зала по номерам вещей (GTA 5 RP: опись `interior.itemRooms`); без неё — комната описи вещей. */
    const roomOf = new Map(arenaServerInventory(server)?.interior?.itemRooms || []);
    const items = raw.items.map(([key, modelIndex, roomIndex]) => ({ key, model: modelIndex, room: roomOf.get(key) ?? (raw.rooms[roomIndex] || "") }));
    for (const item of items) {
      models[item.model].count += 1;
      models[item.model].keys.push(item.key);
    }
    out = { models, items, byKey: new Map(items.map((item) => [item.key, item])), total: items.length };
  }
  stockCache.set(server, out);
  return out;
}

/**
 * Вещи зала сервера вместе с частями вещей (`arena-item-parts.js`): у части — своя модель (`part` — её имя в описи частей), свой номер и комната вещи, чья она.
 * Часть — не оболочка и не сущность помещения: её убирают из самой модели. `null` — у сервера опись без вещей.
 */
export function arenaObjects(server) {
  if (cache.has(server)) return cache.get(server);
  const stock = arenaStockObjects(server);
  let out = stock;
  const parts = stock ? arenaItemParts(server).filter((part) => stock.byKey.has(part.entity)) : [];
  if (parts.length) {
    const models = [...stock.models];
    const items = [...stock.items];
    for (const part of parts) {
      const index = models.length;
      models.push({ index, name: part.model, own: false, shell: false, kind: arenaObjectKind(part.model), part: true, count: 1, keys: [part.key] });
      items.push({ key: part.key, model: index, room: stock.byKey.get(part.entity).room });
    }
    out = { models, items, byKey: new Map(items.map((item) => [item.key, item])), total: items.length };
  }
  cache.set(server, out);
  return out;
}

/** Вещь по номеру сущности или `null`. */
export const arenaObjectOf = (server, key) => arenaObjects(server)?.byKey.get(key) || null;

/** Модель вещи (`{ name, own, kind, count, keys }`) или `null`. */
export function arenaObjectModel(server, key) {
  const objects = arenaObjects(server);
  const item = objects?.byKey.get(key);
  return item ? objects.models[item.model] : null;
}

/**
 * Номера вещей под охват выбора: «этот» — `{ key }`, «в комнате» — вещи той же модели в той же комнате,
 * «во всей арене» — вещи той же модели по всему залу. Неизвестный номер — пустое множество.
 */
export function arenaObjectScope(server, key, scope = "one") {
  const objects = arenaObjects(server);
  const item = objects?.byKey.get(key);
  if (!item) return new Set();
  /* Оболочка зала (стена, пол, потолок): её части — по материалу, а не по модели. Охват — все оболочки комнаты или зала;
     материал отбирает части в подсветке (`itemSpec`, аргумент `material`). */
  if (objects.models[item.model].kind === "structure") {
    const shells = objects.items.filter((entry) => objects.models[entry.model].kind === "structure");
    if (scope === "arena") return new Set(shells.map((entry) => entry.key));
    if (scope === "room") return new Set(shells.filter((entry) => entry.room === item.room).map((entry) => entry.key));
    return new Set([key]);
  }
  if (scope === "arena") return new Set(objects.models[item.model].keys);
  if (scope === "room") return new Set(objects.items.filter((entry) => entry.model === item.model && entry.room === item.room).map((entry) => entry.key));
  return new Set([key]);
}

/** Можно ли у сервера убирать вещи зала по одной (GTA 5 RP: запись сущности интерьера). */
export const arenaObjectsRemovable = (server) => Boolean(arenaRemovableKeys(server));

/**
 * Номера вещей, что уйдут из игры по команде: «этот» — эта вещь, «в комнате» и «во всей арене» — вещи той же модели
 * в своём охвате. Оболочка зала (стены, пол, потолок, наклейки) не уходит никогда — её красят.
 */
export function arenaObjectRemoval(server, key, scope = "one") {
  const removable = arenaRemovableKeys(server);
  if (!removable) return [];
  return [...arenaObjectScope(server, key, scope === "room" || scope === "arena" ? scope : "one")].filter((entry) => removable.has(entry)).sort((a, b) => a - b);
}

/** Охват, что сказал бы выбор вещей по умолчанию: у вещи без копий «все такие» — то же, что «один». */
export const arenaObjectCopies = (server, key) => arenaObjectModel(server, key)?.count || 0;

/**
 * Экраны вещи (элементы раздела «Экраны»): те, чьё полотно лежит в рамке вещи — `box.min/max` (метры
 * сцены, запас `slack`) — и чей лист рисует сама вещь (`box.textures`, имена листов её сеток): на столе
 * стоят планшеты, но экраны планшетов — их, а не стола. `[{ key, place, label }]`; у вещи без экрана — пусто.
 */
export function arenaObjectScreens(server, box, { slack = 0.25 } = {}) {
  if (!box) return [];
  const inside = (point) => point.every((value, axis) => value >= box.min[axis] - slack && value <= box.max[axis] + slack);
  const places = new Map(arenaPlaces(server, "screens").map((place) => [place.id, place]));
  return arenaSlotElements(server, "screens").filter((element) => {
    const panel = element.panel;
    /*
     * Элемент без полотна — лист целиком (длинные экраны коридора) или всё место одним куском («Круглый экран над
     * залом» — у него листы места): у вещи, чьи сетки рисуют этот лист (10Б: у круглого экрана вкладка «Экран» была пуста).
     */
    if (!panel) {
      const sheets = element.texture ? [element.texture] : places.get(element.place)?.textures || [];
      return sheets.some((name) => box.textures?.has(name));
    }
    if (box.textures && panel.texture && !box.textures.has(panel.texture)) return false;
    const faces = panel.facets?.length ? panel.facets : [panel];
    return faces.some((face) => inside(face.point));
  });
}

/*
 * Модели зала, которые Astral может убрать или заменить своей (файл модели в наборе Majestic:
 * `ARENA_REPLACEABLE`, `arena-replace.js`) — по имени модели. `null` — это штатная модель игры или
 * модель сервера, которой нет в наборе: файла, под которым её можно подменить, нет.
 */
export function arenaObjectReplaceable(replaceables, modelName) {
  return replaceables.find((item) => item.model === modelName) || null;
}
