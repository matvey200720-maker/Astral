/*
 * Слова и числа редактора завода — отдельно от компонентов: их берут кадр,
 * колонка правок, готовые виды и обложка.
 */

import {
  FACTORY_CLASSIC_COLOURS,
  FACTORY_GROUPS,
  FACTORY_MODE_LABELS,
  FACTORY_PARTS,
  FACTORY_PART_MODES,
  FACTORY_PART_MODE_LABELS,
  FACTORY_RUST_SHADE,
  factoryMaterialLook,
  factoryRustySheet,
  factoryPartOf,
} from "@modovik/climb-contract/recolor/factory";
import { finishRepeats } from "@modovik/climb-contract/recolor/finish";
import { tr } from "../../../locales/ui.js";
import { itemFrame } from "../items-panel/items-frame.js";
import { ringDisc } from "../model-stage/ring-fade.js";

/* Части корпуса и их режимы: «как весь корпус» и режимы корпусов. */
export const FACTORY_PART_OPTIONS = Object.freeze(FACTORY_PARTS.map((part) => [part.id, part.label]));
/* Серый вид автора мода — «Серый мода», а не «Как в моде»: слов для исходного два, «Как в игре» и «Как у всех …» (п. 15 `design-qa.md`). */
const MOD_LOOK = "Серый мода";
export const FACTORY_PART_MODE_OPTIONS = Object.freeze(
  FACTORY_PART_MODES.map((mode) => [mode, mode === "mod" ? MOD_LOOK : FACTORY_PART_MODE_LABELS[mode] || FACTORY_MODE_LABELS[mode]]),
);

/* Быстрые цвета: бетон, кирпич, хаки, промышленный жёлтый, морской… */
export const FACTORY_SWATCHES = Object.freeze([
  "#e8e8e8",
  "#9aa0a6",
  "#5f6368",
  "#2b2d31",
  "#9c4a32",
  "#8c5a3c",
  "#c9a227",
  "#56613f",
  "#2e8b57",
  "#1f5fae",
  "#7b2cff",
]);

/* Режимы группы в словах колонки: у контейнеров «свой цвет» — «один цвет». */
export function factoryModeOptions(group) {
  return group.modes.map((mode) => [
    mode,
    group.id === "containers" && mode === "colour" ? tr("Один цвет") : mode === "mod" ? tr(MOD_LOOK) : FACTORY_MODE_LABELS[mode],
  ]);
}

/* Подписи режимов общей отделки — одни у всех групп. */
const FINISH_HINTS = Object.freeze({
  standard: "Штатные листы GTA из вашей игры — ровно как без мода.",
  pattern: "Узор ложится в каждый лист группы, детали штатного листа остаются; игра повторяет лист по модели.",
  image: "Своя картинка — в каждом листе группы; игра повторяет лист по модели.",
  gradient: "Градиент — в каждом листе группы, по листу снизу вверх (или вдоль).",
});

export const FACTORY_GROUP_HINTS = Object.freeze({
  buildings: {
    ...FINISH_HINTS,
    mod: "Серые, как у автора мода.",
    colour: "Все стены, крыши, трубы и лестницы корпусов — одним цветом.",
    rainbow: "Каждая поверхность — свой цвет радуги: стены, крыши и трубы разные.",
  },
  ground: {
    ...FINISH_HINTS,
    mod: "Серая, как у автора мода.",
    colour: "Бетон двора и дальние планы места — одним цветом.",
    buildings: "Земля того же цвета, что корпуса.",
  },
  containers: {
    ...FINISH_HINTS,
    mod: "Серые, как у автора мода.",
    colour: "Все контейнеры одного цвета.",
    classic: "У каждого вида контейнера свой цвет, как в порту.",
    rainbow: "Контейнеры цветами радуги — каждый вид своим.",
  },
  props: {
    ...FINISH_HINTS,
    mod: "Серый, как у автора мода.",
    colour: "Заборы, блоки, ящики, погрузчик и прицеп — одним цветом.",
    buildings: "Реквизит того же цвета, что корпуса.",
    rainbow: "Каждая вещь — свой цвет радуги.",
  },
});

export const FACTORY_GROUP_BY_ID = Object.freeze(
  Object.fromEntries(FACTORY_GROUPS.map((group) => [group.id, group])),
);

/*
 * Лучший вид на весь завод: корпуса с бункерами и конвейерами сбоку-сверху,
 * рамка — по корпусам (дальние заборы и блоки её не раздувают).
 */
export function factoryShowcaseFrame(asset) {
  const part = asset.parts.find((item) => item.id === "buildings");
  return {
    bounds: part?.bounds || asset.bounds,
    ground: !ringDisc(asset),
    view: { yaw: -0.72, pitch: 0.42 },
  };
}

/* Кадр редактора: тот же вид, свободная камера — правой кнопкой. */
export function factoryStageFrame(asset) {
  return { ...factoryShowcaseFrame(asset), view: { yaw: -0.72, pitch: 0.42, zoom: 0.72 }, free: true, zoomRange: [0.2, 2.8] };
}

/* Коробка сеток группы завода (`info.group` материала) в осях кадра: `{ min, max }` или `null`. */
function groupBox(asset, group) {
  let box = null;
  for (const mesh of asset?.meshes || []) {
    if (!mesh.bounds || asset.materials?.[mesh.material]?.group !== group) continue;
    const low = mesh.bounds.slice(0, 3);
    const high = mesh.bounds.slice(3, 6);
    box = box
      ? { min: box.min.map((value, axis) => Math.min(value, low[axis])), max: box.max.map((value, axis) => Math.max(value, high[axis])) }
      : { min: low, max: high };
  }
  return box;
}

/**
 * Кадр к группе «Облика», взятой щелчком над панелью (владелец 31.10.2026: «камеру меняло, когда тыкаешь»): корпуса — вид по
 * умолчанию, земля — сверху, контейнеры и реквизит — их коробка в кадре. Группы нет в сцене — вид по умолчанию.
 */
export function factoryGroupFrame(asset, group) {
  const base = factoryStageFrame(asset);
  const box = group === "buildings" ? null : groupBox(asset, group);
  return (box && itemFrame(asset, null, { box, yaw: -0.72, pitch: group === "ground" ? 0.95 : 0.42 })) || base;
}

const luma = (hex) => {
  const value = parseInt(String(hex || "#808080").slice(1), 16);
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
};

/**
 * Облик материала сцены кадра. `textures` — текстуры отделки по ключу
 * (`factoryFinishKey`: группа, «как корпуса» — корпуса, своя часть корпуса —
 * `part:<id>`), `decals` — эмблема для шейдера (не на наклейках и надписях).
 *
 *   «как в моде», свой цвет, радуга — ровный цвет мода (листы 4×4);
 *   «Стандарт» — штатный лист игры, тинт — цвет строки палитры;
 *   узор, картинка, градиент — плитка отделки по развёртке, повторённая
 *   как в листе (`finishRepeats`), детали штатного листа — светотенью.
 */
export function factoryFrameLook(project, info, { textures = {}, decals = null } = {}) {
  const look = factoryMaterialLook(project, info);
  const own = decals?.length && !info.decal ? { decals } : {};
  if (look.standard) return { colour: look.colour, visible: look.visible, map: "vanilla", multiply: info.vanillaMultiply, ...own };
  if (look.finish) {
    const texture = textures[factoryFinishKey(project, info)];
    const repeats = finishRepeats(look.finish);
    return {
      colour: look.colour,
      visible: look.visible,
      map: "vanilla",
      finish: texture
        ? { texture, mode: "uv", uv: [repeats, repeats, 0, 0], shade: (look.finish.shade / 100) * (factoryRustySheet(info.texture) ? FACTORY_RUST_SHADE : 1), ref: Math.max(0.05, luma(info.vanillaColour)) }
        : null,
      ...own,
    };
  }
  return { colour: look.colour, visible: look.visible, map: false, ...own };
}

/* Чья отделка у материала: своя часть корпуса, корпус целиком, «как корпуса» — корпуса. */
export function factoryFinishKey(project, info) {
  if (info.group === "buildings") {
    const part = factoryPartOf(info.texture);
    return project?.parts?.[part] && project.parts[part].mode !== "buildings" ? `part:${part}` : "buildings";
  }
  return (info.group === "ground" || info.group === "props") && project?.[info.group]?.mode === "buildings" ? "buildings" : info.group;
}

export const metresText = (value) => `${String(Math.round(value * 10) / 10).replace(".", ",")} м`;
/* «100 %» — с неразрывным пробелом (п. 18 `design-qa.md`). */
export const percentText = (value) => `${Math.round(value)}\u00a0%`;

export { FACTORY_CLASSIC_COLOURS };
