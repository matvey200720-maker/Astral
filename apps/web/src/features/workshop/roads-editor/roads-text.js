/*
 * Слова редактора «Дороги» — отдельно от компонентов: их берут кадр,
 * колонка правок, шаблоны и обложка.
 */

import ROADS_COUNTS from "@modovik/climb-contract/recolor/inventory/roads-counts";
import {
  ROAD_MARKING_GROUPS,
  ROAD_PARTS,
  ROAD_SURFACE_LABELS,
  ROAD_SURFACE_MODES,
  normalizeRoadsProject,
  roadMarkingsAreStock,
  roadSurfaceIsStock,
} from "@modovik/climb-contract/recolor/roads";
import { currentUiLanguage, tr } from "../../../locales/ui.js";

/*
 * Два куска карты из игры (задача 13 ТЗ 18.10.2026, поздний вечер): «Город» — перекрёсток в Davis
 * (асфальт, переходы, разметка, бордюр и тротуар, края кварталов) и «Грунтовка» — дорога за Сэнди-Шорс через
 * землю и кустарник; вырезаны из моделей игры (`scripts/prepare-roads-city.mjs`, `prepare-roads-scene.mjs`). Каждая
 * краска видна в своём куске (`roadSceneOfTool`).
 */
export const ROADS_SCENES = Object.freeze({ city: "/assets/workshop/roads/roads-city.bin", dirt: "/assets/workshop/roads/roads-dirt.bin" });
export const ROADS_SCENE_URL = ROADS_SCENES.city;
export const roadsSceneUrl = (scene) => ROADS_SCENES[scene] || ROADS_SCENES.city;

/* Участок кадра: «Город» или «Грунтовка» — переключатель над кадром. */
export const ROAD_SCENE_OPTIONS = Object.freeze([
  { value: "city", label: "Город" },
  { value: "dirt", label: "Грунтовка" },
]);

/** В каком участке видна правка инструмента: грунтовка — на грунтовке, остальное (асфальт, тротуары, разметка) — в городе. */
export const roadSceneOfTool = (tool) => (tool === "dirt" ? "dirt" : "city");

/* Быстрые цвета: тона асфальта, грунта и плитки и яркие для своих. */
export const ROAD_SWATCHES = Object.freeze([
  "#26282c",
  "#3b3e44",
  "#77766f",
  "#c9c4ba",
  "#8a6f4d",
  "#c4a46a",
  "#7c2b25",
  "#a2573c",
  "#1f3f73",
  "#2f6b3a",
  "#f2c230",
  "#f4f4f2",
]);
export const MARKING_SWATCHES = Object.freeze(["#f2c230", "#f4f4f2", "#ffd400", "#ff8a00", "#e30613", "#00e5ff", "#ff2bd6", "#39ff14", "#2f80ed", "#15171b"]);

export const SURFACE_MODE_OPTIONS = Object.freeze(ROAD_SURFACE_MODES.map((mode) => [mode, ROAD_SURFACE_LABELS[mode]]));
export const partLabel = (id) => ROAD_PARTS.find((part) => part.id === id)?.label || (id === "markings" ? tr("Разметка") : id);
/* Группы разметки — слова контракта, переводятся здесь, в месте отрисовки. */
export const groupLabel = (id) => tr(ROAD_MARKING_GROUPS.find((group) => group.id === id)?.label || id);
export const groupNote = (id) => tr(ROAD_MARKING_GROUPS.find((group) => group.id === id)?.note || "");

export const percentText = (value) => `${Math.round(value)} %`;

/* Вид кадра: вблизи — листы, что видны у машины, вдали — их дальние планы. */
export const ROAD_VIEW_OPTIONS = Object.freeze([
  { value: "near", label: "Вблизи" },
  { value: "far", label: "Вдали" },
]);

/** Сколько файлов и листов каждой части и группы несёт опись (`roads-counts.js`). */
export const ROAD_COUNTS = ROADS_COUNTS;

/* Названия частей в середине фразы — строчными; у немецких существительных заглавная остаётся. */
const inSentence = (text) => (currentUiLanguage() === "de" ? text : text.toLowerCase());

/** Что изменится в игре — строка подписи кадра и статуса; дороги как в игре — пусто: шапка и так говорит «Как в игре», а «в игру
    ничего не уйдёт» повторяло её (п. 1 и 14 `design-qa.md`, четвёртый круг критика 31.10.2026). */
export function roadsPlanText(input) {
  const project = normalizeRoadsProject(input);
  const changed = ROAD_PARTS.filter((part) => !roadSurfaceIsStock(project.parts[part.id])).map((part) => inSentence(tr(part.label)));
  if (!roadMarkingsAreStock(project.markings)) changed.push(project.markings.hidden ? tr("разметка скрыта") : tr("разметка"));
  if (!changed.length) return "";
  return tr("В игру уйдёт: {0} — по всей карте, вблизи и в дальних планах.").replace("{0}", changed.join(", "));
}

/*
 * Куда смотрит кадр в каждом куске (метры сцены): коробка вокруг того, что показываем, и камера — с уровня улицы под
 * углом, как снимок. «Город» — перекрёсток в Davis (сцена с началом в его середине): взгляд с юго-запада
 * вдоль проспекта с трамвайной полосой, впереди переходы; «Грунтовка» — колея с ответвлением за Сэнди-Шорс (сцена в
 * метрах игры): взгляд с юга вверх по дороге. Высота коробки — по самой сцене.
 */
const FOCUS = Object.freeze({
  city: Object.freeze({ x: [-10, 22], y: [-10, 22], height: 4, yaw: -0.8, pitch: 0.2, zoom: 0.62 }),
  dirt: Object.freeze({ x: [394, 426], y: [-96, -64], height: 3, yaw: 0.25, pitch: 0.16, zoom: 0.7 }),
});
const roadBounds = (asset) => asset.parts?.find((part) => part.id === "road")?.bounds || asset.bounds;

/** Рамка кадра: кусок карты с уровня улицы под углом (больше `zoom` — дальше камера); вдали — камера отъезжает втрое и
 *  поднимается. Без React: ею снимает и окно-съёмщик обложек частей. Пола с сеткой нет — земля сцены непрозрачная,
 *  фон чёрный. */
export function roadsFrame(view = "near", { thumb = false, scene = "city" } = {}) {
  const focus = FOCUS[scene === "dirt" ? "dirt" : "city"];
  return (asset) => {
    const whole = roadBounds(asset);
    const far = view === "far";
    return {
      bounds: { min: [focus.x[0], focus.y[0], whole.min[2]], max: [focus.x[1], focus.y[1], whole.min[2] + focus.height] },
      ground: false,
      view: { yaw: focus.yaw, pitch: far ? 0.45 : thumb ? focus.pitch + 0.1 : focus.pitch, zoom: far ? focus.zoom * 3 : thumb ? focus.zoom * 0.95 : focus.zoom },
    };
  };
}
