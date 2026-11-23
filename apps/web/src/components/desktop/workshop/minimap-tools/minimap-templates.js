import { DEFAULT_MINIMAP_EFFECTS, normalizeMinimapLayout } from "@modovik/minimap-contract";
import { DEFAULT_MINIMAP_GPS, GPS_MARKER_HUD, normalizeMinimapGps } from "@modovik/minimap-contract/gps-marker";
import { applyMinimapVitalsLayout, createDefaultMinimapLayout } from "../minimap-layout.js";
import { tr } from "../../../../locales/ui.js";

/*
 * Шаблоны мини-карты — облики целиком (задача 1 ТЗ 11.10.2026, утро).
 * Владелец: «в шаблонах… чтобы там были карты, мини-карты были в шаблонах, а
 * не просто это» — вчерашние шаблоны меняли только метку и маршрут.
 *
 * Шаблон задаёт то, из чего складывается вид карты: раскладку полос и их
 * цвета, толщину и заливку, подложку, цифры, обводку радара, метку GPS и
 * линию маршрута. Остаётся работа человека, которая к облику не относится:
 * место карты на экране, дальность обзора, свои значки и картинки, урон и
 * «как отнимается HP», точность маршрута. Шаблон — начало: дальше любой
 * инструмент правит его.
 *
 * Плитка рисует сам облик (`MinimapPreview` и линия маршрута с меткой поверх
 * радара) — тем же расчётом, что ставит его на карту.
 */

/* Поля полос, которые задаёт шаблон: остальное в `effects` — работа человека. */
const LOOK_EFFECTS = Object.freeze([
  "healthColor",
  "armorColor",
  "lowHealthColor",
  "barOpacity",
  "barThickness",
  "trackMode",
  "trackColor",
  "trackOpacity",
  "barOutline",
  "barOutlineColor",
  "barOutlineWidth",
  "healthNumberColor",
  "armorNumberColor",
]);

const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key]]));
const OUTLINE_OFF = Object.freeze({ enabled: false });
const outline = (color, width, opacity = 100) => ({ enabled: true, color, width, opacity, top: true, right: true, bottom: true, left: true });

export const MINIMAP_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "game",
    get label() {
      return tr("Как в игре");
    },
    get note() {
      return tr("Полосы под картой, цвета и метка игры");
    },
    vitals: "under-map",
    numbers: false,
    effects: {},
    outline: OUTLINE_OFF,
    gps: {},
  }),
  Object.freeze({
    id: "neon",
    get label() {
      return tr("Неон");
    },
    get note() {
      return tr("Яркие полосы сверху, голубая рамка, розовый пунктир");
    },
    vitals: "top-row",
    numbers: true,
    effects: {
      healthColor: "#39ff88",
      armorColor: "#2de2ff",
      barOpacity: 100,
      barThickness: 6,
      trackMode: "custom",
      trackColor: "#000000",
      trackOpacity: 55,
      healthNumberColor: "#ffffff",
      armorNumberColor: "#2de2ff",
    },
    outline: outline("#2de2ff", 2),
    gps: { marker: { color: "#ff2bd6", icon: "diamond" }, line: { style: "dashed", width: 1.25 } },
  }),
  Object.freeze({
    id: "rp-classic",
    get label() {
      return tr("RP-классика");
    },
    get note() {
      return tr("HP и броня во всю ширину снизу, разрывчатая линия");
    },
    vitals: "bottom-stack",
    numbers: true,
    effects: {
      healthColor: "#3ddc84",
      armorColor: "#38bdf8",
      barOpacity: 100,
      barThickness: 8,
      trackMode: "custom",
      trackColor: "#0b0d10",
      trackOpacity: 60,
    },
    outline: outline("#ffffff", 1, 60),
    gps: { marker: { color: "#ffc21a", icon: "pin" }, line: { style: "broken", width: 1.25 } },
  }),
  Object.freeze({
    id: "minimal",
    get label() {
      return tr("Минимал");
    },
    get note() {
      return tr("Тонкие столбики слева, метка-крест, точки");
    },
    vitals: "left-vertical",
    numbers: false,
    effects: {
      healthColor: "#f0f0f0",
      armorColor: "#9aa4b1",
      barOpacity: 85,
      barThickness: 4,
      trackMode: "custom",
      trackColor: "#000000",
      trackOpacity: 35,
    },
    outline: OUTLINE_OFF,
    gps: { marker: { color: "#f0f0f0", icon: "cross", size: 0.85 }, line: { style: "dotted", width: 0.9, opacity: 0.8 } },
  }),
  Object.freeze({
    id: "red-alert",
    get label() {
      return tr("Красная тревога");
    },
    get note() {
      return tr("Столбики справа, красная рамка, штрих-пунктир");
    },
    vitals: "right-vertical",
    numbers: true,
    effects: {
      healthColor: "#ff3b5c",
      armorColor: "#ffd23f",
      lowHealthColor: "#ff0000",
      barOpacity: 100,
      barThickness: 7,
      healthNumberColor: "#ff9aa9",
      armorNumberColor: "#ffd23f",
    },
    outline: outline("#ff3b5c", 2),
    gps: { marker: { color: "#e8202a", icon: "target" }, line: { style: "dashdot", width: 1.2 } },
  }),
  Object.freeze({
    id: "gold",
    get label() {
      return tr("Золото");
    },
    get note() {
      return tr("Золотые полосы сверху, звезда и широкая линия");
    },
    vitals: "top-stack",
    numbers: true,
    effects: {
      healthColor: "#ffc21a",
      armorColor: "#f0f0f0",
      barOpacity: 100,
      barThickness: 6,
      trackMode: "custom",
      trackColor: "#1a1408",
      trackOpacity: 70,
      healthNumberColor: "#ffd970",
      armorNumberColor: "#ffffff",
    },
    outline: outline("#ffc21a", 2, 80),
    gps: { marker: { color: "#ffc21a", icon: "star", size: 1.25 }, line: { width: 1.5 } },
  }),
  Object.freeze({
    id: "night",
    get label() {
      return tr("Ночь");
    },
    get note() {
      return tr("Фиолетовые полосы снизу, тонкий пунктир");
    },
    vitals: "bottom-row",
    numbers: false,
    effects: {
      healthColor: "#a78bfa",
      armorColor: "#38bdf8",
      barOpacity: 100,
      barThickness: 6,
      trackMode: "custom",
      trackColor: "#0b0d10",
      trackOpacity: 70,
    },
    outline: outline("#a78bfa", 1, 70),
    gps: { marker: { color: "#a78bfa", icon: "flag" }, line: { style: "dashed", width: 0.8, opacity: 0.85 } },
  }),
  Object.freeze({
    id: "bold-route",
    get label() {
      return tr("Заметный маршрут");
    },
    get note() {
      return tr("Полосы игры, крупная метка и толстая голубая линия");
    },
    vitals: "under-map",
    numbers: false,
    effects: {},
    outline: OUTLINE_OFF,
    gps: { marker: { size: 2 }, line: { width: 2, colorMode: "custom", color: "#22d3ee" } },
  }),
]);

/** Блок `gps` шаблона: метка и линия — его, точность — человека. */
function templateGps(template, current) {
  const own = template.gps || {};
  return normalizeMinimapGps({
    marker: { ...DEFAULT_MINIMAP_GPS.marker, ...own.marker },
    route: {
      accuracy: current.route.accuracy,
      line: { ...DEFAULT_MINIMAP_GPS.route.line, color: GPS_MARKER_HUD.HUD_COLOUR_WAYPOINT, ...own.line },
    },
  });
}

/** Проект с обликом шаблона. */
export function applyMinimapTemplate(config, template) {
  const base = normalizeMinimapLayout(config);
  const stock = createDefaultMinimapLayout();
  const effects = {
    ...base.effects,
    ...pick(DEFAULT_MINIMAP_EFFECTS, LOOK_EFFECTS),
    ...template.effects,
    /* Заливка — ровным цветом шаблона: анимация прежнего облика спрятала бы его цвета. */
    healthFill: DEFAULT_MINIMAP_EFFECTS.healthFill,
    armorFill: DEFAULT_MINIMAP_EFFECTS.armorFill,
  };
  const layout = applyMinimapVitalsLayout({ ...base, effects }, template.vitals, { edge: "health" });
  const widgets = {
    ...layout.widgets,
    healthNumber: { ...layout.widgets.healthNumber, visible: template.numbers },
    armorNumber: { ...layout.widgets.armorNumber, visible: template.numbers },
  };
  return normalizeMinimapLayout({
    ...base,
    /* Шаблон ставит полосы к краю карты — HP снова при карте (задача 1 ТЗ
       17.10.2026). */
    layout: { ...layout, widgets, vitalsDetached: false },
    effects,
    frame: {
      ...base.frame,
      outline: template.outline.enabled ? { ...stock.frame.outline, ...template.outline } : { ...base.frame.outline, enabled: false },
    },
    gps: templateGps(template, base.gps),
  });
}

/* Облик проекта одной строкой — по ней плитка шаблона узнаёт себя. */
function lookSignature(config) {
  const normalized = normalizeMinimapLayout(config);
  const { layout, frame, gps } = normalized;
  return JSON.stringify({
    vitals: layout.vitalsLayout,
    numbers: [layout.widgets.healthNumber.visible, layout.widgets.armorNumber.visible],
    effects: pick(normalized.effects, LOOK_EFFECTS),
    fills: [normalized.effects.healthFill.mode, normalized.effects.armorFill.mode],
    outline: frame.outline.enabled ? frame.outline : false,
    marker: { ...gps.marker, assetId: "" },
    line: gps.route.line,
  });
}

/** Шаблон, облик которого стоит сейчас, — или пусто. */
export function matchingMinimapTemplate(config) {
  const current = lookSignature(config);
  return MINIMAP_TEMPLATES.find((template) => lookSignature(applyMinimapTemplate(config, template)) === current)?.id || "";
}
