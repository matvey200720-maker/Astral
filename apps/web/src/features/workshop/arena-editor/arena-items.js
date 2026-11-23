/*
 * Предметы зала в кадре (задача 10 ТЗ 18.10.2026, вечер): рамки сущностей по сцене, описание
 * подсветки «ровно этого предмета» и перелёт камеры к нему. Чистые функции без React и three:
 * их берут кадр (что обвести под курсором и после щелчка), панель (куда лететь) и тест.
 *
 * Сетка сцены Majestic несёт номер сущности (`mesh.entity`, сцена версии 2): по нему кадр знает,
 * чей предмет под лучом, а подсветка (`selection-highlight.js`, поле `where`) обводит только
 * сетки с нужными номерами — соседний предмет той же модели и тот же лист у другого предмета
 * в рамку не попадают.
 */

import { boundsOfEntities, entityBounds, itemSpec as baseItemSpec } from "../items-panel/items-frame.js";

/* Рамки сущностей и подсветка «ровно этой вещи» — общие у редакторов с панелью «Предметы» (`items-panel/items-frame.js`). */
export { boundsOfEntities, entityBounds };

/* Перелёт камеры к вещи изнутри зала — общий с интерьерами (`items-panel/items-focus.js`). */
export { eyeInRoom, itemFocus, lineIsClear } from "../items-panel/items-focus.js";

/**
 * Что подсветить у арены: сетки сущностей из `entities` (`Set` номеров) — общая подсветка вещей плюс то, что только у арены:
 * `material` — имя материала стены (оболочка: обводятся её части этого материала), `part` — только экран или только корпус
 * вещи (`itemPartOf`).
 */
export function itemSpec(entities, asset = null, scope = "one", material = null, part = null) {
  /* Лист — без учёта регистра: ключ элемента вещи (`itemElementKey`) — имя листа строчными. */
  const sheet = material === null ? null : String(material).toLowerCase();
  return baseItemSpec(entities, asset, scope, (info) => (sheet === null || String(info?.name || "").toLowerCase() === sheet) && itemPartMatches(part, info));
}

/*
 * Экран и корпус монитора (владелец, 25.10.2026: «по экрану — картинка этого монитора, по корпусу — корпус»): у предмета, что
 * несёт экран, листы экрана — группы `screens` сцены арены, прочие — корпус. `part`: `"screen"` обводит только экран, `"body"` —
 * всё, кроме экрана, `null` — предмет целиком. У предмета без экрана корпус — это он весь. Лист без группы (сцена её не назвала)
 * ничего не говорит о части — `null`.
 */
export function itemPartOf(info) {
  const group = info?.group;
  if (typeof group !== "string" || !group) return null;
  return group === "screens" ? "screen" : "body";
}

function itemPartMatches(part, info) {
  return !part || itemPartOf(info) === part;
}

/*
 * Имена для человека (ТЗ владельца 21.10.2026): внутреннее имя модели (`int3_rm2_celling_b`) остаётся в подсказке,
 * в карточке — часть оболочки и номер комнаты. Функции возвращают ключ словаря (его переводит `tr` в месте отрисовки).
 */
const SHELL_PARTS = [
  [/cell|ceil/i, "Потолок"],
  [/floor/i, "Пол"],
  [/wall/i, "Стена"],
];
const WALL_COLOURS = {
  white: "Белый материал стен",
  black: "Чёрный материал стен",
  grey: "Серый материал стен",
  gray: "Серый материал стен",
};

/** Часть оболочки по внутреннему имени модели (`Потолок`, `Пол`, `Стена`) или `null`. */
export function shellPartName(name) {
  return SHELL_PARTS.find(([pattern]) => pattern.test(String(name)))?.[1] ?? null;
}

/** Номер комнаты из внутреннего имени (`int3_rm2_celling_b` → `2`) или `null`. */
export function roomNumberOf(name) {
  return /rm(\d+)/i.exec(String(name))?.[1] ?? null;
}

/** Материал стен по внутреннему имени: `white_blocking_basecolor_16` → «Белый материал стен»; прочие — «Материал стен». */
export function wallMaterialName(material) {
  const colour = /^(\w+?)_blocking_/.exec(String(material))?.[1];
  return (colour && WALL_COLOURS[colour.toLowerCase()]) || "Материал стен";
}
