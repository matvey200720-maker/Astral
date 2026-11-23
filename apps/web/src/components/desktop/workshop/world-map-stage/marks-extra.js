// Отметки табло «Расписания» и рамки-призраки подписей донора и меток Majestic.
// Формы соседей сверены с worldmap4-WorldMapStage-neighbors-real.md (разделы 1, 3, 6).
import { createElement as h } from "react";
import { majesticMarkBounds, majesticMarkFromKey } from "@modovik/vector-map";
import MeshLabelMark, { MarkFrame } from "../world-map/MeshLabelMark.jsx";
import { framesOf, outlineOf, sceneOf } from "./board-bridge.js";
import { replacedKeys } from "./donor-hits.js";

const WHITE = "#ffffff";
const DARK = "#04060a";
const GHOST_LIMIT = 400;
const CROSS_ARM = 0.2;

const pairOf = (unit, first, second) => `${first * unit} ${second * unit}`;
const closedPath = (points) => `M${points.map((one) => `${one.x} ${one.y}`).join("L")}Z`;
const listed = (list, value) => Boolean(list?.includes?.(value));

// Пара контуров: тёмная подложка и белый пунктир поверх
function dashedOutline(d, unit, { back, line, dash }) {
  return [
    h("path", { key: "back", d, fill: "none", stroke: DARK, strokeWidth: back * unit }),
    h("path", {
      key: "line",
      d,
      fill: "none",
      stroke: WHITE,
      strokeWidth: line * unit,
      strokeDasharray: pairOf(unit, dash[0], dash[1]),
    }),
  ];
}

// «Добавить строку»: пунктирный контур места под последней строкой и крестик посередине
function addSlot(frame, unit) {
  const slot = frame.places.add;
  if (!slot) return null;
  const midU = slot.x + slot.w / 2;
  const midV = slot.y + slot.h / 2;
  const [west, east] = [sceneOf(frame, midU - CROSS_ARM, midV), sceneOf(frame, midU + CROSS_ARM, midV)];
  const [north, south] = [sceneOf(frame, midU, midV - CROSS_ARM), sceneOf(frame, midU, midV + CROSS_ARM)];
  const cross = `M${west.x} ${west.y}L${east.x} ${east.y}M${north.x} ${north.y}L${south.x} ${south.y}`;
  return h(
    "g",
    { opacity: 0.8 },
    ...dashedOutline(closedPath(outlineOf(frame, slot)), unit, { back: 3, line: 1.3, dash: [4, 3] }),
    h("path", { d: cross, stroke: WHITE, strokeWidth: 2 * unit, strokeLinecap: "round" }),
  );
}

// Только при инструменте «Расписание»: выбранная строка (номер в списке) и место «добавить»
export function boardMarks({ board, row, canAdd, projector, unit }) {
  if (!board) return null;
  const frame = framesOf(board, projector);
  const place = row >= 0 ? frame.places.rows.find((one) => one.index === row) : null;
  const parts = place
    ? dashedOutline(closedPath(outlineOf(frame, place.row, 0.05)), unit, {
        back: 3.2,
        line: 1.5,
        dash: [5, 3],
      })
    : [];
  const slot = canAdd ? addSlot(frame, unit) : null;
  const props = { key: "board-marks", className: "wmc-board-marks", pointerEvents: "none" };
  return h("g", props, ...parts, slot);
}

// ——— подписи донора («Подписи») ———

// Спрятанные подписи донора без замены (ключи из meshHidden), до 400: [{ mesh, key, id }]
export function meshGhosts({ markers }) {
  const ghosts = [];
  if (!markers?.enabled) return ghosts;
  markers.items.forEach((item) => {
    if (!item.mesh || item.enabled === false) return;
    const set = item.group || "own";
    if (listed(markers.hiddenGroups, set)) return;
    const replaced = replacedKeys(markers.items, set);
    (item.meshHidden ?? []).forEach((key) => {
      if (replaced.has(key) || ghosts.length >= GHOST_LIMIT) return;
      ghosts.push({ id: `${item.id}|${key}`, mesh: item.mesh, key });
    });
  });
  return ghosts;
}

const sameMesh = (a, b) => Boolean(a) && Boolean(b) && a.mesh === b.mesh && a.key === b.key;

// MeshLabelMark берёт выбор целиком в `pick` ({ mesh, key } достаточно); остальное — флаги
export function meshMarks({ ghosts, hover, picked, projector, unit }) {
  const parts = ghosts.map((one) =>
    h(MeshLabelMark, { key: one.id, pick: one, projector, unit, ghost: true }),
  );
  if (hover && !sameMesh(hover, picked)) {
    parts.push(h(MeshLabelMark, { key: "mesh-hover", pick: hover, projector, unit }));
  }
  if (picked) {
    parts.push(h(MeshLabelMark, { key: "mesh-pick", pick: picked, projector, unit, picked: true }));
  }
  return parts;
}

// ——— метки вики Majestic ———

// Спрятанные метки (marks — объект «ключ → { hidden?, color? }») включённых категорий, до 400
export function majesticGhosts({ majestic }) {
  const found = [];
  Object.entries(majestic?.marks ?? {}).forEach(([key, entry]) => {
    if (!entry || !entry.hidden || found.length >= GHOST_LIMIT) return;
    const mark = majesticMarkFromKey(key);
    if (mark && majestic.categories?.[mark.id]?.on) found.push(mark);
  });
  return found;
}

const asMark = (mark) => (typeof mark === "string" ? majesticMarkFromKey(mark) : mark);

// MarkFrame берёт рамку `box` в метрах карты; данных ещё нет — рамка пуста и ничего не рисует
export function majesticMarks({ ghosts, hover, picked, majestic, projector, unit }) {
  const frameOf = (key, mark, extra) => {
    const box = mark ? majesticMarkBounds(majestic, mark.id, mark.kind, mark.index) : null;
    return h(MarkFrame, { key, box, projector, unit, ...extra });
  };
  const parts = ghosts.map((mark) => frameOf(mark.key, mark, { ghost: true }));
  const hoverMark = asMark(hover);
  const pickedMark = asMark(picked);
  if (hoverMark && !(pickedMark && hoverMark.key === pickedMark.key)) {
    parts.push(frameOf("majestic-hover", hoverMark));
  }
  if (pickedMark) parts.push(frameOf("majestic-pick", pickedMark, { picked: true }));
  return parts;
}
