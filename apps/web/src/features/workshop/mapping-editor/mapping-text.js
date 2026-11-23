/*
 * Слова и числа редактора маппинга — отдельно от компонентов: их берут кадр,
 * колонка правок, готовые виды и обложка.
 */

import {
  MAPPING_EMBLEM_LOCATIONS,
  MAPPING_FINISH_MODES,
  MAPPING_LOCATIONS,
  mappingModePaints,
  mappingTint,
  normalizeMappingProject,
} from "@modovik/climb-contract/recolor/mapping";
import { FINISH_MODE_LABELS, finishRepeats } from "@modovik/climb-contract/recolor/finish";
import { tr } from "../../../locales/ui.js";

/* Быстрые цвета мест: дерево, кирпич, песок, металл, яркие. */
export const MAPPING_SWATCHES = Object.freeze([
  "#e8e4da",
  "#c2a878",
  "#9c5a3c",
  "#7a5230",
  "#9e2b25",
  "#3b3f46",
  "#8d949c",
  "#56613f",
  "#2f6bff",
  "#18a558",
  "#ffb000",
]);

/* «100 %» — с неразрывным пробелом (п. 18 `design-qa.md`). */
export const percentText = (value) => `${Math.round(value)}\u00a0%`;

/* «15 файлов», «1 файл», «3 файла». */
export function filesText(count) {
  const tens = count % 100;
  const units = count % 10;
  const word =
    tens >= 11 && tens <= 14 ? tr("файлов") : units === 1 ? tr("файл") : units >= 2 && units <= 4 ? tr("файла") : tr("файлов");
  return `${count} ${word}`;
}

export const MAPPING_LOCATION_OPTIONS = Object.freeze(MAPPING_LOCATIONS.map((location) => [location.id, location.title]));

/* Облик места: как в игре (по умолчанию, ТЗ 10.10.2026), как в моде, свой цвет. */
export const MAPPING_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: "stock", label: "Как в игре" }),
  /* Модели автора мода — словами того, что в кадре, а не «Как в моде» (п. 15 `design-qa.md`). */
  Object.freeze({ value: "mod", label: "Модели мода" }),
  Object.freeze({ value: "colour", label: "Свой цвет" }),
]);
/*
 * Облики места в выборе. У места, где свой цвет красит штатные модели игры
 * (парковка, ТЗ 17.10.2026), — «как в игре» и свой цвет; модель мода у него —
 * шаблон («Парковка 5RP»), и в выборе она видна, только пока стоит.
 */
export function mappingModeOptions(location, mode) {
  if (!location?.stockEdit) return MAPPING_MODE_OPTIONS;
  return MAPPING_MODE_OPTIONS.filter((item) => item.value !== "mod" || mode === "mod");
}

/*
 * Облики места с отделкой (парковка, ТЗ 17.10.2026): как в игре, свой цвет,
 * узор, картинка, градиент — в словах общей отделки; модель сервера 5RP — в
 * выборе, только пока стоит (её ставит шаблон).
 */
export function mappingFinishOptions(mode) {
  return [
    ["stock", "Как в игре"],
    /* Модель сервера из шаблона — словами того, что она есть, а не «Как в моде» (п. 15 `design-qa.md`). */
    ...(mode === "mod" ? [["mod", "Модель сервера 5RP"]] : []),
    ["colour", "Свой цвет"],
    ...MAPPING_FINISH_MODES.map((item) => [item, FINISH_MODE_LABELS[item]]),
  ];
}

export const mappingModeLabel = (mode) =>
  (MAPPING_MODE_OPTIONS.find((item) => item.value === mode)?.label || FINISH_MODE_LABELS[mode] || tr("Как в игре")).toLowerCase();

/** Цвет места в списке и на схеме: свой цвет, серый мода или штатный (светлый нейтральный). */
export function mappingLocationColour(input, id) {
  const project = normalizeMappingProject(input);
  const settings = project.locations[id];
  if (settings?.mode === "colour") return settings.colour;
  /* Отделка (парковка): первый цвет узора или градиента. */
  if (settings?.mode === "pattern") return settings.pattern.colours[0];
  if (settings?.mode === "gradient") return settings.gradient.colours[0];
  if (settings?.mode === "image") return settings.colour;
  return settings?.mode === "mod" ? "#8a8d92" : "#c9c2b4";
}

/**
 * Сцена места в облике работы: штатная из игры игрока или модели мода. Свой
 * цвет парковки (ТЗ 17.10.2026) — на штатной парковке.
 */
export function mappingSceneOf(location, input) {
  if (!location) return "";
  const mode = normalizeMappingProject(input).locations[location.id]?.mode;
  return mode === "stock" || (mappingModePaints(mode) && location.stockEdit) ? location.stockScene : location.scene;
}

/** Строка состояния: что из мест в игре. */
export function mappingStatusText(input, name = "Маппинг") {
  const project = normalizeMappingProject(input);
  const items = Object.values(project.locations);
  const mod = items.filter((item) => item.mode === "mod").length;
  const colour = items.filter((item) => mappingModePaints(item.mode)).length;
  if (!mod && !colour) return `${name} · ${tr("все места как в игре")}`;
  /* Части строки — шаблонами словаря: целиком строку слой перевода не узнаёт. */
  const fill = (text, ...values) => values.reduce((out, value, index) => out.replace(`{${index}}`, value), tr(text));
  const parts = [];
  if (colour) parts.push(fill("перекрашено мест: {0} из {1}", colour, items.length));
  /* Места с моделями мода — словами того, что стоит, а не «как в моде» (п. 15 `design-qa.md`). */
  if (mod) parts.push(fill("модели мода: {0}", mod));
  const stock = items.length - mod - colour;
  if (stock) parts.push(fill("как в игре: {0}", stock));
  return `${name} · ${parts.join(", ")}`;
}

/**
 * Облик материала сцены кадра: лист автора или ровный цвет с тоном своего
 * места (`info.group` — id места, `info.ref` — опорная яркость листа);
 * листы игры («keep») — как есть.
 */
/* Вид на место для плиток и обложки: всё место, чуть сверху. */
export function mappingShowcaseFrame(asset) {
  return { bounds: asset.bounds, ground: true, view: { yaw: -0.62, pitch: 0.42 } };
}

export function mappingFrameLook(input, info, { decals = null, textures = {} } = {}) {
  const own = decals?.length && !info.decal ? { decals } : {};
  if (info.group === "keep") return { colour: info.colour, ...own };
  /*
   * Отделка листа стен штатного места (парковка): плитка отделки по развёртке
   * листа, повторённая как в листе (`finishRepeats`), детали штатного листа —
   * светотенью, опора — яркость листа из описи (`info.ref`): ровно то, что
   * пишет в лист `bakeSheetFinish`. Картинка ещё не прочитана — штатный облик.
   */
  const finishSettings = normalizeMappingProject(input).locations[info.group];
  if (info.texture != null && MAPPING_FINISH_MODES.includes(finishSettings?.mode)) {
    /* Наклейка на листе стены (штукатурка парковки) при отделке убрана — как в игре. */
    if (info.decal) return { colour: info.colour, visible: false };
    const texture = textures[info.group];
    const repeats = finishRepeats(finishSettings);
    const palette = info.multiply ? { multiply: info.multiply } : {};
    return {
      colour: info.colour,
      ...(texture ? { finish: { texture, mode: "uv", uv: [repeats, repeats, 0, 0], shade: finishSettings.shade / 100, ref: Math.max(0.02, Number(info.ref) || 0.5) } } : {}),
      ...palette,
      ...own,
    };
  }
  /* Штатное место из игры: листы игры как есть, у моделей под тинтом — цвет палитры. */
  if (info.group === "stock") return { colour: info.colour, ...(info.multiply ? { multiply: info.multiply } : {}), ...own };
  const tint = mappingTint(input, info.group, info.ref);
  /* Стены штатной парковки под тинтом игры: тон, потом палитра — как в игре. */
  const palette = info.multiply ? { multiply: info.multiply } : {};
  return info.texture != null ? { colour: info.colour, tint, ...palette, ...own } : { colour: info.colour, tint, map: false, ...own };
}

/* Места, куда можно поставить эмблему, — для выбора в её разделе. */
export const MAPPING_EMBLEM_OPTIONS = Object.freeze(
  MAPPING_EMBLEM_LOCATIONS.map((id) => [id, MAPPING_LOCATIONS.find((location) => location.id === id)?.title || id]),
);
