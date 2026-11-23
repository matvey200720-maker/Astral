import { normalizeWorldMap } from "./model.js";

const INK = "#050608";

// Поля стиля в порядке записи; glowColor есть только у стиля со свечением.
const STYLE_FIELDS = ["font", "weight", "color", "outline", "outlineColor", "glow", "glowColor", "letterSpacing"];

// id, заголовок, образец, затем значения полей по STYLE_FIELDS (undefined — поля нет).
const PRESET_ROWS = [
  ["district", "Район", "ВАЙНВУД", "golos", "black", "#ffffff", 70, INK, 0, undefined, 2],
  ["region", "Регион", "ЧИЛИАД", "unbounded", "black", "#ffffff", 45, INK, 0, undefined, 24],
  ["place", "Метка", "Казармы", "inter", "bold", "#f4f6fa", 60, INK, 0, undefined, 4],
  ["orange", "Оранжевая", "ПЕСЧАНКА", "golos", "black", "#ff9d2e", 70, INK, 0, undefined, 2],
  ["blue", "Синяя", "МЕДЫ ГОС", "golos", "black", "#3fa9ff", 65, "#020a14", 0, undefined, 2],
  ["danger", "Опасно", "ОПАСНО", "golos", "black", "#ff3b3b", 70, INK, 28, "#ff3b3b", 4],
];

const patch = (base, changes) => ({ ...base, ...changes });

const styleOf = (values) =>
  Object.freeze(
    STYLE_FIELDS.reduce((style, field, at) => (values[at] === undefined ? style : patch(style, { [field]: values[at] })), {}),
  );

export const TEXT_PRESETS = Object.freeze(
  Array.from(PRESET_ROWS, ([id, title, sample, ...values]) => Object.freeze({ id, title, sample, style: styleOf(values) })),
);

export const TEXT_PRESET_MAP = Object.freeze(Object.assign({}, ...TEXT_PRESETS.map((preset) => ({ [preset.id]: preset }))));

// Заплата снимает собственный шрифт надписи.
const FONT_RESET = Object.freeze({ fontAssetId: "", fontName: "" });

// По этим полям надпись узнаётся; цвет свечения добавляется только у стиля со свечением.
const MATCH_FIELDS = STYLE_FIELDS.filter((field) => field !== "glowColor");

const sameText = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const fitsStyle = (emblem, style) =>
  [...MATCH_FIELDS, ...(style.glow === 0 ? [] : ["glowColor"])].every((field) =>
    sameText((typeof emblem === "object" ? emblem : {})[field], style[field]),
  );

export const textPresetOf = (emblem) =>
  (emblem && emblem.kind !== "image" ? TEXT_PRESETS.find(({ style }) => fitsStyle(emblem, style))?.id : null) ?? null;

export const textPresetPatch = (presetId) => {
  const hit = TEXT_PRESET_MAP[presetId];
  return hit ? patch(hit.style, FONT_RESET) : null;
};

export const applyTextPreset = (config, emblemId, presetId) => {
  const project = normalizeWorldMap(config);
  const fields = textPresetPatch(presetId);
  const wearer = project.emblems.items.find((item) => item.id === emblemId);
  const restyled = project.emblems.items.map((item) => (item.id === emblemId ? patch(item, fields) : item));
  return fields && wearer?.kind === "text"
    ? normalizeWorldMap(patch(project, { emblems: patch(project.emblems, { items: restyled }) }))
    : project;
};
