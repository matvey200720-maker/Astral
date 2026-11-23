// Готовый пресет эффектов — не мод, а набор настроек мастерской. Человек ищет его там
// же, где всё остальное, поэтому здесь пресеты превращаются в варианты слота каталога
// («Трейсеры», «Эффекты при попадании»); «Настроить» открывает мастерскую на пресете.
//
// Берём только список пресетов (данные), а не собранные проекты: разбор проекта тянет
// выписку правил эффектов игры, которая не должна ехать в общий кусок приложения
// (бюджет куска). Подпуть preset-list.js без импортов держит tests/ptfx-studio.test.js.
import { PTFX_PRESET_LIST, presetHasImpact, presetHasTracer } from "@modovik/ptfx-studio/preset-list.js";
import { tr } from "../../../locales/ui.js";

const ID_PREFIX = "astral-fx-preset-";
const COVER_PREFIX = "data:image/svg+xml;utf8,";

// Обложка рисуется векторно здесь же: настоящая текстура пресета — восемь запусков
// генератора при каждом открытии каталога, а карточке нужен лишь цвет и тип (след или
// брызги). Рисунок один на слот, от пресета меняется только цвет, он подставляется
// в один атрибут группы без экранирования (цвета пресетов — безопасные #rrggbb).
const element = (name, attributes) =>
  `<${name} ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(" ")}/>`;

const BACKDROP =
  '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#0b1018"/><stop offset="1" stop-color="#05070c"/>' +
  "</linearGradient></defs>" +
  element("rect", { x: 0, y: 0, width: 320, height: 180, fill: "url(#bg)" });

// Линия: [x1, y1, x2, y2, толщина, непрозрачность]; две пары — широкая бледная и тонкая яркая.
const TRACER_LINES = [
  [30, 118, 196, 102, 7, 0.28],
  [30, 118, 196, 102, 2.5],
  [74, 70, 238, 58, 5, 0.2],
  [74, 70, 238, 58, 1.8],
];

// Круг: [cx, cy, радиус, непрозрачность]; радиус и непрозрачность убывают.
const IMPACT_DOTS = [
  [160, 90, 26, 0.85],
  [196, 70, 9, 0.7],
  [124, 112, 7, 0.7],
  [206, 112, 5, 0.55],
  [118, 66, 4.5, 0.55],
  [176, 128, 3.5, 0.45],
];

function tracerArt(colour) {
  const lines = TRACER_LINES.map(([x1, y1, x2, y2, width, opacity]) =>
    element("line", { x1, y1, x2, y2, "stroke-width": width, ...(opacity === undefined ? {} : { opacity }) }),
  );
  return `<g stroke="${colour}" stroke-linecap="round" fill="none">${lines.join("")}</g>`;
}

function impactArt(colour) {
  const dots = IMPACT_DOTS.map(([cx, cy, r, opacity]) => element("circle", { cx, cy, r, opacity }));
  return `<g fill="${colour}">${dots.join("")}</g>`;
}

function coverOf(art, colour) {
  const opening = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">';
  const markup = [opening, BACKDROP, art(colour), "</svg>"].join("");
  return COVER_PREFIX + encodeURIComponent(markup);
}

// Слот каталога -> какие пресеты ему подходят и как рисуется обложка. Map, чтобы слот
// сравнивался строго (массив ["tracers"] или «tracers » слотом не считаются).
const SLOTS = new Map([
  ["tracers", { suits: presetHasTracer, art: tracerArt }],
  ["hit-effects", { suits: presetHasImpact, art: impactArt }],
]);

export const PTFX_PRESET_SLOTS = Object.freeze([...SLOTS.keys()]);

export function ptfxPresetVariants(slotId, title, locale = "ru") {
  const slot = SLOTS.get(slotId);
  if (!slot) return [];
  const categoryLabel = title || (locale === "ru" ? tr("Мастерская") : "Workshop");
  const matching = PTFX_PRESET_LIST.filter((preset) => slot.suits(preset));
  return matching.map((preset) => ({
    id: `${ID_PREFIX}${slotId}-${preset.id}`,
    presetId: preset.id,
    name: preset.label,
    author: "Astral",
    description: preset.description,
    accent: preset.accent,
    cover: coverOf(slot.art, preset.accent),
    catalogSection: "redux",
    catalogSlot: slotId,
    categoryLabel,
    previewOnly: false,
    isPtfxPreset: true,
    sizeBytes: 0,
  }));
}
