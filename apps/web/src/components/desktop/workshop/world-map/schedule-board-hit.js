import { SCHEDULE_BOARD_CAPS, scheduleBoardPlaces } from "@modovik/vector-map";

/*
 * Правка прямо на табло «Расписания» (задача 36 ТЗ 19.10.2026): куда нажали и где встаёт поле правки.
 *
 * Табло — картинка-эмблема, его части лежат в «строках» от левого верхнего угла (`scheduleBoardPlaces`). Здесь —
 * перевод между точкой сцены и «строками» (с поворотом табло), поиск части под курсором и положение и кегль
 * поля, которое встаёт на буквы вместо сцены. Чистые функции, без окна.
 */

const inside = (rect, u, v, grow = 0) =>
  Boolean(rect) && u >= rect.x - grow && u <= rect.x + rect.w + grow && v >= rect.y - grow && v <= rect.y + rect.h + grow;

/** Табло в сцене: места частей, единица («строка») в единицах сцены, середина, поворот. */
export function boardFrame(emblem, projector) {
  const places = scheduleBoardPlaces(emblem.schedule);
  return {
    emblem,
    places,
    unit: projector.length(emblem.width / places.width),
    center: projector.point(emblem),
    rotation: emblem.rotation || 0,
  };
}

/** «Строки» от угла табло → точка сцены. */
export function boardToScene(frame, u, v) {
  const dx = (u - frame.places.width / 2) * frame.unit;
  const dy = (v - frame.places.height / 2) * frame.unit;
  const angle = (frame.rotation * Math.PI) / 180;
  return {
    x: frame.center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: frame.center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

/** Точка сцены → «строки» от угла табло. */
export function sceneToBoard(frame, point) {
  const angle = (-frame.rotation * Math.PI) / 180;
  const dx = point.x - frame.center.x;
  const dy = point.y - frame.center.y;
  return {
    u: (dx * Math.cos(angle) - dy * Math.sin(angle)) / frame.unit + frame.places.width / 2,
    v: (dx * Math.sin(angle) + dy * Math.cos(angle)) / frame.unit + frame.places.height / 2,
  };
}

/**
 * Что на табло под точкой сцены: `{ kind: "add" }` (свободное место под последней строкой), `title`, `heading` (`column`),
 * а у строки — `icon`, `name`, `time` или просто `row` (`row` — место строки из `scheduleBoardPlaces`). Мимо — `null`.
 */
export function boardPartAt(frame, point) {
  const { u, v } = sceneToBoard(frame, point);
  const { places } = frame;
  if (inside(places.add, u, v, 0.1)) return { kind: "add" };
  if (inside(places.title, u, v)) return { kind: "title" };
  for (const heading of places.headings) if (inside(heading, u, v)) return { kind: "heading", column: heading.column };
  for (const row of places.rows) {
    if (!inside(row.row, u, v)) continue;
    if (inside(row.box, u, v)) return { kind: "icon", row };
    if (inside(row.name, u, v)) return { kind: "name", row };
    if (inside(row.time, u, v)) return { kind: "time", row };
    return { kind: "row", row };
  }
  return null;
}

/* Высота прописных части по её примитиву сцены: название в две строчки мельче, время и заголовки — свои. */
function capOfItem(id, frame) {
  const part = /-(title|heading-\d|name-\d+(?:-b)?|time-\d+)$/.exec(id)?.[1] || "";
  if (part === "title") return SCHEDULE_BOARD_CAPS.title;
  if (part.startsWith("heading")) return SCHEDULE_BOARD_CAPS.heading;
  if (part.startsWith("time")) return SCHEDULE_BOARD_CAPS.time;
  const shown = Number(/name-(\d+)/.exec(part)?.[1]);
  const row = frame.places.rows[shown];
  return row?.lines > 1 ? SCHEDULE_BOARD_CAPS.nameTwo : SCHEDULE_BOARD_CAPS.name;
}

/** Идентификатор примитива сцены у части: название (`b` — вторая строчка), время, заголовок. */
export function boardItemId(frame, target, second = false) {
  const prefix = `schedule-${frame.emblem.id}-`;
  if (target.part === "title") return `${prefix}title`;
  if (target.part === "heading") return `${prefix}heading-${target.column}`;
  const shown = frame.places.rows.findIndex((row) => row.index === target.index);
  return `${prefix}${target.part === "time" ? "time" : "name"}-${shown}${second ? "-b" : ""}`;
}

/**
 * Поле правки на буквах части табло: `{ left, top, rotation, align, font }` в точках экрана (`scale` — точек на единицу
 * сцены; `frame0` — левый верхний угол кадра сцены). Кегль и шрифт берутся с примитивов табло в сцене: у пустого
 * названия или времени примитива нет — тогда по соседнему, в пропорции высоты прописных. Нет ни одного — `null`.
 * `target`: `{ part: "name" | "time", index }` (`index` — номер строки в списке), `{ part: "title" }`,
 * `{ part: "heading", column }`.
 */
export function boardFieldGeometry(frame, items, target, { scale, origin }) {
  const { places, emblem } = frame;
  const board = emblem.schedule;
  let spot;
  let align = "start";
  let color = board.look.text;
  let rowLines = 1;
  if (target.part === "title") {
    spot = places.title;
    align = "middle";
    color = board.look.heading;
  } else if (target.part === "heading") {
    spot = places.headings.find((item) => item.column === target.column);
    align = "middle";
    color = board.look.heading;
  } else {
    const row = places.rows.find((item) => item.index === target.index);
    if (!row) return null;
    spot = target.part === "time" ? row.time : row.name;
    rowLines = row.lines;
    align = target.part === "time" ? "end" : "start";
    const accent = board.rows[target.index]?.accent;
    color = accent ? board.look.accent : target.part === "time" ? board.look.time : board.look.text;
  }
  if (!spot) return null;
  const own = items.find((item) => item.id === boardItemId(frame, target));
  const ref = own || items.find((item) => item.kind === "text" && item.id.startsWith(`schedule-${emblem.id}-`));
  const letters = board.letters / 100;
  const wanted =
    target.part === "title"
      ? SCHEDULE_BOARD_CAPS.title
      : target.part === "heading"
        ? SCHEDULE_BOARD_CAPS.heading
        : target.part === "name" && rowLines > 1
          ? SCHEDULE_BOARD_CAPS.nameTwo
          : SCHEDULE_BOARD_CAPS.name;
  /* Кегль в единицах сцены: с примитива этой части; у пустой — по соседнему, в пропорции высоты прописных. */
  const size = own ? own.size : ref ? (ref.size / (capOfItem(ref.id, frame) * letters)) * wanted * letters : (wanted * letters * frame.unit) / 0.72;
  const anchor = boardToScene(frame, spot.ax, spot.ay);
  const step = rowLines > 1 && target.part === "name" ? 0.5 * frame.unit : size * 1.12;
  return {
    left: (anchor.x - origin.x) * scale,
    top: (anchor.y - origin.y) * scale,
    rotation: frame.rotation,
    align,
    font: {
      family: ref?.family || "",
      weight: ref?.weight || 800,
      size: size * scale,
      lineHeight: step * scale,
      spacing: 0,
      color: own?.fill || color,
      upper: board.upper,
    },
  };
}
