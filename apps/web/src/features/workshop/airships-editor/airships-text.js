/* Слова и числа «Дирижаблей» (ТЗ 11.10.2026). */

import { AIRSHIP_GAME_COLOURS, AIRSHIP_KINDS, airshipCount, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";
import { currentUiLanguage, tr } from "../../../locales/ui.js";
import { pluralWord } from "../../../plural.js";

const number = (value, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");

export const metresText = (value) => `${Math.round(value)} ${tr("м")}`;
export const percentText = (value) => `${Math.round(value)} %`;
export const distanceText = (value) => (value >= 1000 ? `${number(value / 1000, 1)} ${tr("км")}` : `${Math.round(value)} ${tr("м")}`);
export const speedText = (value) => `×${number(value, 2)}`;

/* Образцы цветов оболочки и полос: первыми — цвета листа игры. */
export const AIRSHIP_BODY_SWATCHES = Object.freeze([AIRSHIP_GAME_COLOURS.body, "#111317", "#f2f2f2", "#b3121b", "#1d6b3a", "#5b2a86", "#ff7a00", "#00a6c8"]);
export const AIRSHIP_STRIPE_SWATCHES = Object.freeze([AIRSHIP_GAME_COLOURS.stripe, "#ffffff", "#111317", "#e8333a", "#22d36b", "#00e0ff", "#ff3df2", "#ff8a1f"]);
export const AIRSHIP_TEXT_SWATCHES = Object.freeze(["#ffffff", AIRSHIP_GAME_COLOURS.stripe, "#111317", "#00e0ff", "#ff3df2", "#22d36b", "#ff4d4d", "#ff8a1f"]);
/* Образцы цветов летающих: яркие, а не только цвета по умолчанию. */
export const AIRSHIP_KIND_SWATCHES = Object.freeze(["#2f7d4a", "#a3161b", "#e3c46a", "#2f5f9e", "#9aa5b4", "#ffa43a", "#5cf2ff", "#f2f2f2"]);

/** Сколько летающих словами: «1 летающий», «3 летающих». Форма — по правилу языка окна (`plural.js`): у английского «21 flyers», у французского «21 objets volants». */
export const skyCountText = (count) =>
  count ? `${count} ${pluralWord(count, [tr("летающий"), tr("летающих"), tr("летающих")])}` : tr("пусто");

/** Цвета вида: первый — главный (тело с картинкой, пока лист картинки рисуется). */
export function kindColours(kindId, input) {
  const project = normalizeAirshipsProject(input);
  const item = project.fleet[kindId];
  if (kindId === "blimp") {
    const own = project.blimp.sign !== "game";
    return own ? [project.blimp.body, project.blimp.stripe] : [AIRSHIP_GAME_COLOURS.body, AIRSHIP_GAME_COLOURS.stripe];
  }
  if (kindId === "dragon") return [item.colour, item.wings, item.eyes];
  if (kindId === "phoenix") return [item.colour, item.wings, item.flame];
  if (kindId === "jellyfish") return [item.colour, item.tentacles, item.glow];
  if (kindId === "banner") return [item.banner, item.colour, item.wings];
  if (kindId === "balloon") return item.colours;
  if (kindId === "lantern") return [item.colour];
  if (kindId === "ufo") return [item.colour, item.lights];
  if (kindId === "whale") return [item.colour, item.spots];
  if (kindId === "eastern_dragon") return [item.colour, item.mane, item.eyes];
  if (kindId === "griffin") return [item.colour, item.wings, item.head];
  return ["#8a8a8a"];
}

/* «Дракон» → «дракон», «НЛО» — как есть; у немецкого существительные остаются с большой буквы. */
const lowerFirst = (label) => (label === label.toUpperCase() || currentUiLanguage() === "de" ? label : label.charAt(0).toLowerCase() + label.slice(1));

/** Состав неба словами: «дракон ×2, воздушный шар ×5». */
export function fleetText(input) {
  const project = normalizeAirshipsProject(input);
  const total = airshipCount(project);
  if (!total) return tr("в небе пусто");
  return AIRSHIP_KINDS.filter((kind) => project.fleet[kind.id].count)
    .map((kind) => `${lowerFirst(tr(kind.label))} ×${project.fleet[kind.id].count}`)
    .join(", ");
}
