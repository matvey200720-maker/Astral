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

import { HANGAR_RUST, isHangarCeilingSheet } from "@modovik/climb-contract/recolor/hangar";
import { HANGAR_HOUSE_COLOURS, hangarHouseActive, hangarHouseHasSheet } from "@modovik/climb-contract/recolor/hangar-house";
import { labelOf, labelled } from "../model-stage/hover-label.js";

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
    return { tool: overlay, element: rust ? "rust" : "walls" };
  }
  /* Домик у торца зала («Внутри → Дом»): блочная стенка и окна — листы нутра с группой «как в игре», их цвет красит вкладка «Дом». */
  if (info.group === "keep" && partId === "interior" && hangarHouseHasSheet(info.sheet)) return { tool: "inside", element: "house" };
  const side = SIDE_OF_GROUP[info.group];
  if (!side) return null;
  if (info.group === "floor") return { tool: side, element: "floor" };
  if (info.group === "markings") return { tool: side, element: "markings" };
  /* Потолок — листы гофры под крышей (`ap1_01_hangre_1`, `_4`): вкладка «Потолок»; остальные стены и колонны — «Стены». */
  return { tool: side, element: info.group === "inside" && isHangarCeilingSheet(info.sheet) ? "ceiling" : "walls" };
}

/* Детали ангара для подписи у курсора — те же слова, что у переключателей «Конструкций и света», у подвкладок «Внутри» (потолок, стены, дом) и у разделов сторон. */
export const HANGAR_ELEMENT_NAMES = Object.freeze({
  trusses: "Фермы",
  crane: "Кран",
  vents: "Вентиляция",
  gallery: "Галерея",
  bracing: "Связи",
  pipes: "Трубы",
  lamps: "Лампы",
  floor: "Пол",
  markings: "Разметка",
  rust: "Ржавчина",
  ceiling: "Потолок",
  walls: "Стены",
  house: "Дом",
});

/**
 * Подпись у курсора для цели `{ tool, element? }`: деталь и сторона («Дом · Внутри», «Фермы»). `translate` — перевод слова (`tr`); без него слова как есть.
 */
export function hangarAimLabel(target, translate = (word) => word) {
  if (!target) return "";
  const side = target.tool === "outside" ? "Снаружи" : target.tool === "inside" ? "Внутри" : "";
  return labelOf(target.element ? translate(HANGAR_ELEMENT_NAMES[target.element] || "") : "", side ? translate(side) : "");
}

/**
 * Что даёт наведение: описание подсветки с подписью (`labelled`) или `null`; `surface` — текущий цвет домика (`hangarHouseSurface`). Одно место для кадра и проверок: кадр отдаёт его общему кадру подсветки как `aimTarget`.
 */
export function hangarAimHover(asset, hit, translate, surface = "") {
  const target = hangarAimTarget(asset, hit);
  if (!target) return null;
  const spec = hangarAimSpec(asset, target.tool, target.tool === "structure" || target.element === "house" ? target.element : "", surface);
  return labelled(spec, hangarAimLabel(target, translate));
}

/**
 * Цвет домика сейчас — цвет, на котором подсветка должна быть видна: «Стены» (блоки, рамы и простенки — почти вся площадь домика) в «Свой цвет» — их цвет, иначе штатный светлый.
 * Стекло («Окна») тут не считается: оно узкое, а контур идёт по краю всего домика.
 */
export function hangarHouseSurface(project) {
  const paint = project?.house?.paint?.walls;
  return hangarHouseActive(project?.house, "walls") && paint?.colour ? paint.colour : HANGAR_HOUSE_COLOURS.walls;
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
 * (`element`) — только его части. У «Внутри» с `element === "house"` (открыта вкладка «Дом» или щёлкнули по домику) светится только домик; при остальных
 * вкладках «Внутри» домик не светится: его красит своя вкладка. Инструмент без деталей в кадре — `null`.
 */
export function hangarAimSpec(asset, tool, element = "", surface = "") {
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
  const house = tool === "inside" && element === "house";
  return {
    /* Цвет домика сейчас: подсветка сама берёт из токенов тот цвет, что виднее на нём (белый домик — тёмный контур и заливка; перекрашенный в тёмный — светлые), `selection-highlight.js`. */
    ...(house && surface ? { surface } : {}),
    where: (info, mesh) => {
      const found = classify(info, asset.parts?.[mesh?.userData?.part]?.id);
      /* Домик красит своя вкладка: светится только на ней, подсветка остальных вкладок «Внутри» его не захватывает. */
      if (house) return found?.element === "house";
      if (found?.element === "house") return false;
      /* «Внутри» красит и фермы со связями (лист балок общий), но их щелчок ведёт к переключателю. */
      if (tool === "inside" && SIDE_OF_GROUP[info?.group] === "inside") return true;
      return found?.tool === tool;
    },
  };
}
