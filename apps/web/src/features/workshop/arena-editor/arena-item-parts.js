// Части и листы вещей зала арены: то, что известно только арене (место вещи в описи, оболочка зала),
// поверх общей логики панелей. Кадр и студия зовут эти функции на каждое наведение мыши.
import { tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { roomNumberOf, shellPartName } from "./arena-items.js";
import { arenaModelTitleParts } from "./arena-item-categories.js";
import { itemFrameOf } from "./arena-item-looks.js";
import { partTitles, partWords } from "../items-panel/part-names.js";
import { sceneItemElements } from "../items-panel/item-elements.js";
import { namedElements } from "../items-panel/scene-elements.js";
import { scenePartsOf, partAtHit, itemSeen, partSpec } from "../items-panel/scene-parts.js";
import { arenaObjectModel, arenaObjects } from "@modovik/climb-contract/recolor/arena-objects";
import { itemElementKey, itemElementWord } from "@modovik/climb-contract/recolor/item-elements";
import { arenaItemPlace, arenaItemSource } from "@modovik/climb-contract/recolor/arena-item-looks";

// Слова-метки: вид модели оболочки, группа материалов экранов, слово «экран» и разделитель подписи.
const WORDS = { shell: "structure", screens: "screens", screen: "Экран", dot: " · " };

// Память по паре ключей; внешний ключ — имя сервера (Map) или сцена (WeakMap).
class Shelf {
  constructor(Outer) {
    this.rows = new Outer();
  }

  // build получает те же два ключа, что и fetch.
  fetch(first, second, build) {
    const row = this.rows.get(first) ?? this.rows.set(first, new Map()).get(first);
    return row.has(second) ? row.get(second) : row.set(second, build(first, second)).get(second);
  }
}

const paintable = new Shelf(Map);
const plainLists = new Shelf(WeakMap);
const wholeSets = new Map();

// Когда вещь вообще не разбирается: проверки идут по порядку и останавливаются на первой сработавшей.
const REFUSALS = [
  ({ asset }) => !asset,
  ({ key }) => !Number.isInteger(key),
  ({ server, key }) => arenaObjectModel(server, key)?.kind === WORDS.shell,
];
const refused = (asset, server, key) => REFUSALS.some((test) => test({ asset, server, key }));

// Номер вещи из попадания кадра; null, если его нет или он не целый.
const entityOf = (hit) => (Number.isInteger(hit?.entity) ? hit.entity : null);

// Картинку можно класть, только если у модели есть рамка и установщик знает её файл.
const canPaint = (server, key) => {
  const frame = itemFrameOf(server, key);
  return frame ? arenaItemSource(server, frame.modelKey) !== null : false;
};

// Листы вещи без подписей; экран — лист из группы экранов сцены либо лист, который словарь зовёт «Экран».
const plainElements = (asset, key) => {
  const screenKeys = (asset.materials ?? []).reduce(
    (found, material) => (material.group === WORDS.screens ? found.add(itemElementKey(material.name)) : found),
    new Set(),
  );
  return sceneItemElements(asset, key).map((entry) => {
    const copy = { ...entry };
    delete copy.label;
    const known = screenKeys.has(itemElementKey(entry.texture));
    if (known || itemElementWord(entry.texture, entry.colour) === WORDS.screen) copy.screen = true;
    return copy;
  });
};

function findSheet(sheets, key) {
  for (const sheet of sheets) {
    if (itemElementKey(sheet.texture) === key) return sheet;
  }
  return undefined;
}

const matchSheet = (sheets, name) => {
  const wanted = itemElementKey(name);
  return findSheet(sheets, wanted) ? wanted : null;
};

const recordOf = (server, key) => {
  const book = arenaObjects(server);
  if (!book) return undefined;
  const slot = book.byKey.get(key);
  return book.models[slot?.model];
};

const headline = (model) => {
  const shellWord = model.kind === WORDS.shell ? shellPartName(model.name) : null;
  if (!shellWord) return trFill(...arenaModelTitleParts(model));
  const room = roomNumberOf(model.name);
  const head = tr(shellWord);
  return room ? `${head}, ${tr("комната {0}").replace("{0}", room)}` : head;
};

// Часть по её номеру среди частей вещи; пусто, если такой части нет.
const pieceOf = (parts, piece) => (Number.isInteger(piece) && parts?.[piece]) || null;

const partTitleAt = (asset, parts, piece) => {
  const part = pieceOf(parts, piece);
  if (!part) return "";
  const names = partTitles(partWords(asset, parts));
  const title = names[piece] || part.label;
  return title ? WORDS.dot + title : "";
};

// Уточнения к имени: сначала лист, потом часть; каждое отдаёт готовый хвост подписи или пустую строку.
const sheetTail = ({ server, key, asset, texture }) => {
  const sheet = texture && asset ? findSheet(arenaItemElements(asset, server, key), texture) : undefined;
  return sheet ? WORDS.dot + sheet.label : "";
};

const partTail = ({ server, key, piece, asset }) => {
  if (!Number.isInteger(piece) || !asset) return "";
  return partTitleAt(asset, arenaItemParts(asset, server, key), piece);
};

function* shellKeys(models) {
  for (const model of models) {
    if (model.kind === WORDS.shell) yield* model.keys;
  }
}

const describe = (model, context) =>
  headline(model) + [sheetTail, partTail].reduce((found, make) => found || make(context), "");

const arenaItemParts = (asset, server, key) =>
  refused(asset, server, key) ? [] : scenePartsOf(asset, key, arenaItemPlace(server, key));

const arenaPartAt = (asset, server, hit) => {
  const entity = entityOf(hit);
  return entity === null ? null : partAtHit(arenaItemParts(asset, server, entity), hit);
};

const arenaItemElements = (asset, server, key) =>
  refused(asset, server, key) || !paintable.fetch(server, key, canPaint)
    ? []
    : namedElements(plainLists.fetch(asset, key, plainElements));

const arenaElementAt = (asset, server, hit) => {
  const entity = hit?.pick ? null : entityOf(hit);
  const sheets = entity === null ? [] : arenaItemElements(asset, server, entity);
  return sheets.length < 2 ? null : matchSheet(sheets, hit.info?.name);
};

const arenaItemSeen = (stage, asset, server, key, piece = null) =>
  itemSeen(stage, asset, key, pieceOf(arenaItemParts(asset, server, key), piece));

const arenaWholeKeys = (server) =>
  wholeSets.get(server) ?? wholeSets.set(server, new Set(shellKeys(arenaObjects(server)?.models ?? []))).get(server);

const arenaItemName = (server, key, piece = null, asset = null, texture = null) => {
  const model = recordOf(server, key);
  return model ? describe(model, { server, key, piece, asset, texture }) : "";
};

export {
  arenaItemParts,
  arenaPartAt,
  arenaItemElements,
  arenaElementAt,
  partSpec as arenaPartSpec,
  arenaItemSeen,
  arenaWholeKeys,
  arenaItemName,
};
