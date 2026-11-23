import { createElement } from "react";
import { mapText } from "./map-copy.js";
import { tr } from "../../../../locales/ui.js";
import { mapTemplateState, mapTemplateCard } from "../world-map-templates.js";
import {
  WORLD_MAP_TEMPLATE_MAP,
  MAP_TEMPLATE_MAP,
  MAP_TEMPLATES,
  mapStyleActive,
} from "@modovik/vector-map";

const h = createElement;

export const GAME_LOOK = "original";

// Скрыты из выбора, но старые проекты с этими картами читаются.
const LEGACY_ONLY = new Set(["akio-satellite-grid", "akio-bw", "akio-homa"]);

function describeCard(card) {
  const { id, title, author } = card;
  return { id, value: id, title, description: author, vector: card.kind === "vector" };
}

const readyEntries = [];
for (const card of MAP_TEMPLATES) {
  if (!LEGACY_ONLY.has(card.id)) readyEntries.push({ kind: "template", ...describeCard(card) });
}
export const READY_LOOKS = Object.freeze(readyEntries);

export const GAME_READY_LOOK = Object.freeze(
  Object.fromEntries([
    ["kind", "style"],
    ["id", GAME_LOOK],
    ["value", "style:" + GAME_LOOK],
    ["title", WORLD_MAP_TEMPLATE_MAP[GAME_LOOK]?.title || "Как в игре"],
    ["description", "Карта из вашей игры"],
    ["vector", true],
  ]),
);

const vectorFirst = READY_LOOKS.filter((look) => look.vector).concat(READY_LOOKS.filter((look) => !look.vector));
export const LOOK_CHOICES = Object.freeze([GAME_READY_LOOK].concat(vectorFirst));

const styleLook = (id) => ({ kind: "style", id });

// Вид, которым карта покрашена сейчас, либо "".
export function currentStyle(config) {
  const wanted = config.template;
  const view = WORLD_MAP_TEMPLATE_MAP[wanted];
  const schematic = config.base.source === "schematic";
  if (!view) return "";
  if (schematic) return wanted;
  const painted = mapStyleActive(config) && view.patch?.base?.recolor !== false;
  return painted ? wanted : "";
}

export function currentLook(config) {
  const base = config.base;
  const style = currentStyle(config);
  const onReadyMap = base.source === "template" && MAP_TEMPLATE_MAP[base.templateId];
  if (onReadyMap) return { kind: "template", id: base.templateId, style };
  if (style) return styleLook(style);
  return styleLook(base.recolor ? "" : GAME_LOOK);
}

export function lookTitle(look) {
  const [table, unnamed] =
    look.kind === "template" ? [MAP_TEMPLATE_MAP, "Готовая карта"] : [WORLD_MAP_TEMPLATE_MAP, "Свой вид"];
  return tr(table[look.id]?.title || unnamed);
}

// Подпись под названием: первое подходящее правило.
const viewName = (styleId) => tr(WORLD_MAP_TEMPLATE_MAP[styleId]?.title || "свой");

const NOTE_RULES = [
  [
    (look, card) => card?.virtual,
    (look, card, config) => config?.base?.packOrigin?.title || tr("Большая карта мода из каталога"),
  ],
  [
    (look) => look.kind === "template" && look.style,
    (look) => mapText("Шаблон «{title}»", { title: viewName(look.style) }),
  ],
  [(look) => look.kind === "template", (look, card) => tr(card?.author || "Готовая карта")],
];

export function lookNote(look, config = null) {
  const card = look.kind === "template" ? MAP_TEMPLATE_MAP[look.id] : null;
  for (const [applies, say] of NOTE_RULES) {
    if (applies(look, card)) return say(look, card, config);
  }
  return tr(look.id === GAME_LOOK ? "Карта из вашей игры" : "Свои цвета");
}

// ---- картинка вида ----
const SWATCH_FALLBACK_LOOK = "graphite";

// [свойство стиля, из каких полей патча брать цвет по порядку, цвет по умолчанию]
const SWATCH_SOURCES = [
  ["--swatch-land", ["land"], "#1d1d1d"],
  ["--swatch-roads", ["roads"], "#b4b4b4"],
  ["--swatch-water", ["water", "sea"], "#384a50"],
  ["--swatch-buildings", ["buildings", "land"], "#414141"],
];

function firstColor(base, fields, fallback) {
  for (const field of fields) {
    if (base[field]) return base[field];
  }
  return fallback;
}

const swatchOf = (lookId) => {
  const base = WORLD_MAP_TEMPLATE_MAP[lookId]?.patch?.base ?? {};
  const colors = SWATCH_SOURCES.map(([prop, fields, fallback]) => [prop, firstColor(base, fields, fallback)]);
  const style = Object.fromEntries(colors);
  return h("i", { className: "wmc-style-swatch is-loading", "aria-hidden": "true", style });
};

const photoOf = (src, lazy) =>
  h("img", { alt: "", ...(lazy ? { loading: "lazy" } : null), decoding: "async", draggable: false, src });

export function LookPicture(props) {
  const { look } = props;
  const thumbs = props.thumbs === undefined ? {} : props.thumbs;
  const variant = props.variant === undefined ? "card" : props.variant;
  if (look.kind === "template") {
    const file = (variant === "state" ? mapTemplateState : mapTemplateCard)(look.id);
    const src = file || thumbs[look.id];
    return src ? photoOf(src, true) : swatchOf(SWATCH_FALLBACK_LOOK);
  }
  const thumb = thumbs[look.id];
  return thumb ? photoOf(thumb, false) : swatchOf(look.id);
}
