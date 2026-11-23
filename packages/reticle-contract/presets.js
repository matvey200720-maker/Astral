/*
 * Готовые прицелы — целиком: вид, цвет, обводка, прозрачность.
 *
 * Собраны по тому, что ставят на RP-серверах (Majestic, GTA5RP): статичный
 * белый крест — самый скачиваемый мод прицела; зелёная точка, которая не
 * закрывает голову на дистанции; синий тонкий крест для контроля отдачи;
 * жёлтый плюс, видный и на песке, и ночью. Для снайперки — то, с чем
 * «выбивают» с хевика: красное кольцо, фиолетовый и T-образный крест, чистый
 * зум без чёрных краёв, и классические сетки настоящих прицелов — дуплекс,
 * mil-dot, немецкий, ПСО.
 *
 * Пресет стоит на значениях по умолчанию: всё, что в нём не названо, берётся
 * оттуда, а не остаётся от прежнего прицела. Иначе «Зелёная точка» поверх
 * кольца оставляла бы кольцо.
 */

import {
  ORDINARY_RETICLE_DEFAULTS,
  SNIPER_RETICLE_DEFAULTS,
} from "./config.js";
import { ORDINARY_STYLES, SNIPER_STYLES } from "./styles.js";

const ordinaryStyle = (id) =>
  ORDINARY_STYLES.find((item) => item.id === id).values;
const sniperStyle = (id) => SNIPER_STYLES.find((item) => item.id === id).values;

const preset = (id, label, description, values) =>
  Object.freeze({ id, label, description, values: Object.freeze(values) });

export const ORDINARY_PRESETS = Object.freeze([
  preset(
    "stock",
    "Как в игре",
    "Маленькая белая точка, как штатный простой прицел GTA.",
    {
      ...ordinaryStyle("dot"),
      dotSize: 2.5,
      color: "#ffffff",
      targetColor: "#ff1c21",
      outlineWidth: 0.5,
      outlineColor: "#000000",
      outlineOpacity: 50,
    },
  ),
  preset(
    "white-static",
    "Белый статичный",
    "Тонкий белый крест с точкой — не разъезжается при стрельбе.",
    {
      ...ordinaryStyle("cross-dot"),
      length: 6,
      thickness: 1.5,
      gap: 3.5,
      dotSize: 1.5,
      color: "#ffffff",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset(
    "green-dot",
    "Зелёная точка",
    "Яркая точка с чёрной обводкой — не закрывает голову на дистанции.",
    {
      ...ordinaryStyle("dot"),
      dotSize: 3.5,
      color: "#3dff5a",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset(
    "blue-tactical",
    "Синий тактический",
    "Тонкий синий крест с маленьким зазором — держать отдачу.",
    {
      ...ordinaryStyle("cross"),
      length: 7,
      thickness: 1.5,
      gap: 2.5,
      color: "#38bdf8",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset(
    "yellow-plus",
    "Жёлтый плюс",
    "Компактный плюс: виден и на песке днём, и в тёмном переулке.",
    {
      ...ordinaryStyle("plus"),
      length: 5,
      thickness: 2,
      color: "#ffe600",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset(
    "pink-dot",
    "Розовая точка",
    "Розовая точка с обводкой — заметна на любом фоне.",
    {
      ...ordinaryStyle("dot"),
      dotSize: 4,
      color: "#ff4fd8",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset(
    "cs-classic",
    "Классика CS",
    "Зелёный крест с зазором и тёмной обводкой.",
    {
      ...ordinaryStyle("cross"),
      length: 5.5,
      thickness: 1.5,
      gap: 2,
      color: "#44ff44",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset("holo", "Голограф", "Красное кольцо с точкой, как коллиматор.", {
    ...ordinaryStyle("circle-dot"),
    color: "#ff3b3b",
    outlineEnabled: false,
  }),
  preset(
    "t-white",
    "T-образный",
    "Без верхней линии: голова цели остаётся открытой.",
    {
      ...ordinaryStyle("t"),
      color: "#ffffff",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset(
    "segments",
    "Сегменты",
    "Голубое кольцо из четырёх дуг с точкой в центре.",
    {
      ...ordinaryStyle("segments"),
      color: "#7ce8ff",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset("brackets", "Уголки", "Салатовая рамка из уголков вокруг точки.", {
    ...ordinaryStyle("brackets"),
    color: "#b6ff3b",
    outlineWidth: 1,
    outlineColor: "#000000",
  }),
  preset(
    "chevron",
    "Шеврон",
    "Красная галочка — вершина и есть точка прицеливания.",
    {
      ...ordinaryStyle("chevron"),
      color: "#ff3b3b",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
  preset(
    "micro",
    "Минимализм",
    "Крошечная точка без обводки — почти не видна, но она есть.",
    {
      ...ordinaryStyle("dot"),
      dotSize: 1.5,
      color: "#ffffff",
      opacity: 85,
      outlineEnabled: false,
    },
  ),
  preset(
    "purple-x",
    "Фиолетовый X",
    "Косой крест не сливается со столбами и углами домов.",
    {
      ...ordinaryStyle("x"),
      color: "#b56cff",
      outlineWidth: 1,
      outlineColor: "#000000",
    },
  ),
]);

export const SNIPER_PRESETS = Object.freeze([
  preset(
    "classic",
    "Классика GTA",
    "Чёрный дуплекс с тонким центром, как штатная оптика.",
    {
      ...sniperStyle("duplex"),
      reticle: "#1b1d20",
      opacity: 100,
      glowWidth: 0,
      postThickness: 6,
      postStart: 45,
    },
  ),
  preset(
    "red-ring",
    "Красное кольцо",
    "Тонкий чёрный крест и красное кольцо — навестись с хевика.",
    {
      ...sniperStyle("tactical"),
      centerGap: 0,
      reticle: "#141414",
      opacity: 100,
      glowWidth: 0,
      centerColorEnabled: true,
      centerColor: "#ff2d2d",
      circleSize: 44,
      ringThickness: 2.5,
      dotSize: 0,
    },
  ),
  preset(
    "purple-heavy",
    "Фиолетовый хевик",
    "Фиолетовое перекрестие через всю линзу и точка.",
    {
      ...sniperStyle("crosshair"),
      thickness: 2,
      dotSize: 3,
      reticle: "#a855f7",
      opacity: 100,
      glowWidth: 1,
      glowColor: "#1a0b2e",
      glowOpacity: 70,
    },
  ),
  preset(
    "blue-tactical",
    "Голубой тактический",
    "Голубой крест с рисками и кольцом в центре.",
    {
      ...sniperStyle("ticks"),
      showCircle: true,
      circleSize: 34,
      ringThickness: 1.5,
      reticle: "#7cc8ff",
      opacity: 100,
      glowWidth: 1,
      glowColor: "#08121c",
      glowOpacity: 60,
    },
  ),
  preset("mil-dot", "Mil-dot", "Чёрные точки на линиях и толстые края.", {
    ...sniperStyle("mil-dot"),
    reticle: "#141414",
    opacity: 100,
    glowWidth: 0,
  }),
  preset("german", "Немецкий", "Три толстых столбика и открытый верх.", {
    ...sniperStyle("german"),
    reticle: "#141414",
    opacity: 100,
    glowWidth: 0,
  }),
  preset("pso", "ПСО-1", "Шевроны и боковая шкала, как у СВД.", {
    ...sniperStyle("pso"),
    reticle: "#141414",
    opacity: 100,
    glowWidth: 0,
    centerColorEnabled: true,
    centerColor: "#e53935",
  }),
  preset(
    "clean-zoom",
    "Чистый зум",
    "Без чёрных краёв и сетки — только красная точка.",
    {
      ...sniperStyle("dot"),
      dotSize: 4,
      reticle: "#ff2d2d",
      opacity: 100,
      glowWidth: 1,
      glowColor: "#000000",
      glowOpacity: 60,
      lensEnabled: false,
    },
  ),
  preset("t-heavy", "T для хевика", "Белый T-образный крест и красная точка.", {
    ...sniperStyle("t"),
    thickness: 2,
    reticle: "#ffffff",
    opacity: 100,
    glowWidth: 1,
    glowColor: "#000000",
    glowOpacity: 60,
    centerColorEnabled: true,
    centerColor: "#ff2d2d",
    dotSize: 3,
  }),
  preset("acog", "ACOG", "Красный шеврон со столбиком снизу.", {
    ...sniperStyle("chevron"),
    reticle: "#141414",
    opacity: 100,
    glowWidth: 0,
    centerColorEnabled: true,
    centerColor: "#ff2d2d",
  }),
  preset("bdc", "Ёлочка", "Поправки на дальность под центром.", {
    ...sniperStyle("bdc"),
    reticle: "#141414",
    opacity: 100,
    glowWidth: 0,
  }),
  preset(
    "white-thin",
    "Белый тонкий",
    "Белый крест с разрывом и красной точкой.",
    {
      ...sniperStyle("crosshair"),
      centerGap: 10,
      thickness: 1.5,
      dotSize: 2.5,
      reticle: "#ffffff",
      opacity: 100,
      glowWidth: 1,
      glowColor: "#000000",
      glowOpacity: 50,
      centerColorEnabled: true,
      centerColor: "#ff2d2d",
    },
  ),
]);

/** Прицел пресета целиком: значения по умолчанию, поверх — пресет. */
export function reticlePresetConfig(kind, item) {
  const defaults =
    kind === "sniper" ? SNIPER_RETICLE_DEFAULTS : ORDINARY_RETICLE_DEFAULTS;
  return { ...defaults, ...(item?.values || {}) };
}
