/*
 * Щелчок по детали ангара (18.10.2026, Session 2, задача 2): что правится под
 * курсором и что подсвечивать. Без React и three — тесты идут на чистых данных.
 *
 * Деталь ангара узнаётся по записи материала (`group`, `overlay`, `sheet`) и по
 * части сцены (`asset.parts[hit.part].id`):
 *   — железяки нутра и лампы (части фермы, кран, вентиляция, галерея, связи,
 *     трубы, лампы с подвесами) — «Конструкции и свет», строка их переключателя;
 *   — стены снаружи — «Снаружи»; стены и колонны изнутри, пол, разметка пола —
 *     «Внутри». Накладки (грязь, потёки) идут за стороной, на которой лежат;
 *   — всё остальное (двери для людей, окна, мебель комнаты) остаётся как
 *     в игре — править нечего; крыша с 31.10.2026 красится со стенами снаружи.
 */

import { HANGAR_RUST } from "@modovik/climb-contract/recolor/hangar";

/* Часть сцены → переключатель в «Конструкциях и свете». Подвесы ламп — лампы. */
const STRUCTURE_OF_PART = Object.freeze({
  trusses: "trusses",
  crane: "crane",
  vents: "vents",
  gallery: "gallery",
  bracing: "bracing",
  pipes: "pipes",
  lamps: "lamps",
  rods: "lamps",
  rodsLong: "lamps",
});

/* Переключатель → части сцены, что он убирает: подсвечиваются вместе. */
const PARTS_OF_STRUCTURE = Object.freeze(
  Object.entries(STRUCTURE_OF_PART).reduce((out, [part, key]) => ({ ...out, [key]: [...(out[key] || []), part] }), {}),
);

/* Что красят «Снаружи» и «Внутри» (пол и его разметка — «Внутри»). */
const SIDE_OF_GROUP = Object.freeze({ outside: "outside", inside: "inside", floor: "inside", frame: "inside", markings: "inside" });
const SIDE_OF_OVERLAY = Object.freeze({ outside: "outside", inside: "inside", floor: "inside" });

/** Ключи переключателей «Конструкций и света» в порядке колонки. */
export const HANGAR_STRUCTURE_KEYS = Object.freeze(["trusses", "crane", "vents", "gallery", "bracing", "pipes", "lamps"]);

/* Инструмент и элемент для записи материала `info` в части `partId`, или `null`. */
function classify(info, partId) {
  if (!info) return null;
  const structure = STRUCTURE_OF_PART[partId] || (info.group === "lamps" ? "lamps" : null);
  if (structure) return { tool: "structure", element: structure };
  const overlay = SIDE_OF_OVERLAY[info.overlay];
  if (overlay) {
    /* Ржавые подтёки на стенах красит «Ржавчина» той же стороны. */
    const rust = HANGAR_RUST[String(info.sheet || "").toLowerCase()]?.kind === "whole";
    return { tool: overlay, ...(rust ? { element: "rust" } : {}) };
  }
  const side = SIDE_OF_GROUP[info.group];
  if (!side) return null;
  if (info.group === "floor") return { tool: side, element: "floor" };
  if (info.group === "markings") return { tool: side, element: "markings" };
  return { tool: side };
}

/**
 * Что открыть по щелчку: `{ tool, element? }` или `null` — править нечего.
 * `asset` — сцена кадра (названия частей), `hit` — попадание кадра.
 */
export function hangarAimTarget(asset, hit) {
  if (!hit?.info) return null;
  return classify(hit.info, asset?.parts?.[hit.part]?.id);
}

/**
 * Описание подсветки для общего кадра: что красит или убирает взятый
 * инструмент (`tool`); у «Конструкций и света» с выбранным переключателем
 * (`element`) — только его части. Инструмент без деталей в кадре — `null`.
 */
export function hangarAimSpec(asset, tool, element = "") {
  if (!asset) return null;
  if (tool === "structure") {
    const parts = element ? new Set(PARTS_OF_STRUCTURE[element] || []) : new Set(Object.keys(STRUCTURE_OF_PART));
    return {
      where: (info, mesh) => {
        const partId = asset.parts?.[mesh?.userData?.part]?.id;
        return parts.has(partId) || (info?.group === "lamps" && (!element || element === "lamps"));
      },
    };
  }
  if (tool !== "outside" && tool !== "inside") return null;
  return {
    where: (info, mesh) => {
      const found = classify(info, asset.parts?.[mesh?.userData?.part]?.id);
      /* «Внутри» красит и фермы со связями (лист балок общий), но их щелчок ведёт к переключателю. */
      if (tool === "inside" && SIDE_OF_GROUP[info?.group] === "inside") return true;
      return found?.tool === tool;
    },
  };
}
