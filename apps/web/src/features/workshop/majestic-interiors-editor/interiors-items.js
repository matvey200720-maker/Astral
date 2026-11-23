/*
 * «Предметы» интерьеров Majestic RP (ТЗ владельца 26.10.2026, п. A): что стоит в помещении или зале казино — стены, пол и потолок
 * оболочки, столы, кресла, экраны, автоматы, свет. Помещение собирает у игрока Astral Desktop из файлов пака и игры, поэтому описи вещей
 * в записи сцены, как у арены или завода, нет: окно считает её само по частям загруженной сцены (`asset.parts`). Часть — одна сущность
 * помещения: `entity` — её номер (он же `mesh.entity` её сеток, по нему кадр знает вещь под щелчком), `model` — имя модели без расширения,
 * `own` — модель из файла самого интерьера, `group` — `shell` (оболочка) или `furniture`, `room` — номер комнаты MLO (`asset.rooms`).
 *
 * Здесь — слова про эту опись. Сначала таблица интерьеров по настоящим именам моделей (`interiors-item-rules.js`: категория, имя, род), если
 * модели в ней нет — общий словарь разметки выделения (`selection/vocab.js`: «как человек называет вещи зала», те же имена, что у арен) и
 * таблица имён арены (`arena-item-categories.js`), а чего нет нигде — внутреннее имя модели. Панель общая (`items-panel/SceneItemsSection.jsx`).
 * Чистый модуль без React и three: тесты гоняют его на настоящих частях.
 */

import { selectionGroupOfKind, selectionKindOfModel } from "@modovik/climb-contract/selection/vocab";
import { tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { arenaModelTitleRule } from "../arena-editor/arena-item-categories.js";
import { roomNumberOf, shellPartName } from "../arena-editor/arena-items.js";
import { INTERIORS_ITEM_CATEGORIES, interiorsRuleOf } from "./interiors-item-rules.js";

/**
 * Опись вещей сцены помещения в виде записи описи набора (`items-panel/items-inventory.js`):
 * `{ models: [{ name, own, shell }], rooms: [""], items: [[номер вещи, номер модели, номер комнаты]] }`. Комната вещи — номер комнаты MLO
 * строкой, `""` — вещь вне названных комнат. `null` — частей с именами моделей нет (сцена собрана без описи).
 */
export function interiorsObjects(asset) {
  const parts = asset?.parts;
  if (!parts?.length) return null;
  const models = [];
  const modelAt = new Map();
  const rooms = [""];
  const roomAt = new Map([["", 0]]);
  const items = [];
  const taken = new Set();
  for (const part of parts) {
    const entity = part?.entity;
    if (!Number.isInteger(entity) || entity < 0 || taken.has(entity) || !part.model) continue;
    taken.add(entity);
    const shell = part.group !== "furniture";
    const modelKey = `${shell ? "s" : "f"}|${part.model}`;
    if (!modelAt.has(modelKey)) {
      modelAt.set(modelKey, models.length);
      models.push({ name: part.model, own: Boolean(part.own), shell });
    }
    const room = Number.isInteger(part.room) && part.room >= 0 ? String(part.room) : "";
    if (!roomAt.has(room)) {
      roomAt.set(room, rooms.length);
      rooms.push(room);
    }
    items.push([entity, modelAt.get(modelKey), roomAt.get(room)]);
  }
  return items.length ? { models, rooms, items } : null;
}

/**
 * Категория модели описи: id из `INTERIORS_ITEM_CATEGORIES`. Оболочка — «Стены, пол и потолок»; вещь — по таблице интерьеров, а если её
 * там нет — по имени модели через общий словарь родов (чего нет в списке интерьеров, панель кладёт в «Прочее»).
 */
export function interiorsItemCategory(model) {
  if (model.shell) return "shell";
  return interiorsRuleOf(model.name)?.category || selectionGroupOfKind(selectionKindOfModel(model.name).kind);
}

/**
 * Род вещи для «Выбрать все такие»: у таблицы интерьеров — свой по семейству (все игровые автоматы, все бутылки, все койки), иначе из общего
 * словаря разметки; у оболочки и «прочего» рода нет — кнопки у них не будет.
 */
export function interiorsSelectionKind(model) {
  if (model.shell) return "";
  const own = interiorsRuleOf(model.name)?.kind;
  if (own) return own;
  const { kind } = selectionKindOfModel(model.name);
  return kind === "decor" ? "" : kind;
}

/**
 * Имя модели для человека на языке окна: оболочка — «Стена, комната 2» (часть и комната из внутреннего имени), вещь — по таблице
 * интерьеров («Больничная койка», «Игровой автомат 5»), затем по таблице арены («Планшет», «Диван»); модели, которой нет нигде, —
 * внутреннее имя.
 */
export function interiorsModelTitle(model) {
  if (model.shell) {
    const part = shellPartName(model.name);
    if (part) {
      const number = roomNumberOf(model.name);
      return number ? `${tr(part)}, ${trFill("комната {0}", number)}` : tr(part);
    }
    return model.name;
  }
  const own = interiorsRuleOf(model.name);
  if (own) {
    if (!own.title.includes("{0}")) return tr(own.title);
    return own.number ? trFill(own.title, own.number) : tr(own.title.replace(/[\s,]*\{0\}/, ""));
  }
  const rule = arenaModelTitleRule(model);
  return rule ? trFill(rule[0], ...rule.slice(1)) : model.name;
}

/** Комната MLO для человека: «Комната 3» для `GtaMloRoom003`, «Вне комнат» для «limbo» и вещей вне комнат, прочие — по названию. */
export function interiorsRoomLabel(name, index) {
  const text = String(name || "");
  if (!text && index === "") return tr("Вне комнат");
  if (/^limbo$/i.test(text)) return tr("Вне комнат");
  const number = /^GtaMloRoom0*(\d+)$/i.exec(text)?.[1];
  if (number) return trFill("Комната {0}", number);
  return text || trFill("Комната {0}", index);
}

/* Слова инструмента, слота правки вещи и пустой панели (русские ключи словаря: сверяет `scene-items.test.js`). */
export const INTERIORS_ITEMS_COPY = Object.freeze({
  note: "Каждая вещь интерьера отдельно",
  hint: "Щёлкните вещь в кадре или выберите её в списке: кадр обведёт её по краям, а «Найти» подлетит к ней",
  aim: "выбрать вещь под курсором",
  editorNote: "Цвет и блеск задаются поверхности интерьера целиком, а не одной вещи: в игру уходят листы интерьера. Вещь здесь можно найти, обвести и перелистать.",
  casinoEditorNote: "Покрытия и подсветка задаются листам зала целиком, а не одной вещи: в игру уходят листы казино. Вещь здесь можно найти, обвести и перелистать.",
  links: Object.freeze({
    surfaces: "Открыть «Цвет и блеск»",
    coverings: "Открыть «Покрытия»",
    glow: "Открыть «Подсветка зала»",
  }),
  removal: "Убрать отдельную вещь из интерьера нельзя: Astral красит листы интерьера, а вещи стоят в игре как были.",
  panelHint: "Всё, что стоит в помещении, — по группам. Откройте группу или щёлкните вещь в кадре: она обведётся, а «Найти» подлетит к ней.",
  casinoPanelHint: "Всё, что стоит в зале казино, — по группам. Откройте группу или щёлкните вещь в кадре: она обведётся, а «Найти» подлетит к ней.",
  origin: "модель из пака интерьера",
  empty: "В этом помещении отдельных вещей не нашлось: кадр собран без описи.",
});

/** Инструменты, к которым ведут кнопки в слоте правки вещи: у казино — покрытия и подсветка, у остальных интерьеров — цвет и блеск. */
export const interiorsEditorLinks = (casino) =>
  (casino ? ["coverings", "glow"] : ["surfaces"]).map((tool) => ({ tool, label: INTERIORS_ITEMS_COPY.links[tool] }));

/**
 * Слова панели про помещение. `asset` — сцена кадра (названия комнат), `casino` — зал казино («в зале»), иначе помещение интерьера.
 * «Только этот / Все такие» не показывается: правка ложится на лист и поверхность, а не на вещь.
 */
export function interiorsItemsAdapter(asset, { casino = false } = {}) {
  const rooms = asset?.rooms || [];
  const nameOf = (id) => (id === "" ? "" : rooms.find((room) => room.index === Number(id))?.name ?? rooms[Number(id)]?.name ?? "");
  /* «limbo» — всё, что вне названных комнат: с вещами без комнаты это одна комната. */
  const outside = (id) => id === "" || /^limbo$/i.test(nameOf(id));
  return {
    categories: INTERIORS_ITEM_CATEGORIES,
    categoryOf: interiorsItemCategory,
    roomOf: (item) => (outside(item.room) ? "" : item.room),
    /* По номеру комнаты MLO; «вне комнат» — последней. */
    roomOrder: (id) => (outside(id) ? 1e6 : Number(id)),
    roomLabel: (id) => interiorsRoomLabel(nameOf(id), id),
    titleOf: interiorsModelTitle,
    originOf: (model) => (model.own ? tr(INTERIORS_ITEMS_COPY.origin) : tr("штатная модель игры")),
    scopes: false,
    hint: casino ? INTERIORS_ITEMS_COPY.casinoPanelHint : INTERIORS_ITEMS_COPY.panelHint,
    words: casino
      ? undefined
      : Object.freeze({
          "{0} шт. в зале": "{0} шт. в помещении",
          "Один в зале": "Один в помещении",
          "Найти в зале": "Найти в кадре",
        }),
  };
}
