/*
 * Слова и числа редактора воды — отдельно от компонентов: их берут кадр,
 * колонка правок, готовые виды и обложка.
 */

import {
  WATER_DIRECTION_LABELS,
  WATER_GROUPS,
  WATER_GROUP_LABELS,
  WATER_VANILLA_TRANSPARENCY,
  compileWaterLooks,
  normalizeWaterProject,
  waterFogTexel,
  waterUnderLook,
  waterUnderwaterMistShare,
  waterUnderwaterModifier,
  waterUnderwaterReach,
  waterVisibility,
} from "@modovik/climb-contract/recolor/water";
import WATER_INVENTORY_SIZE from "./water-counts.js";
import { tr } from "../../../locales/ui.js";

/* Вкладки группы воды — переключатель над кадром. */
export const WATER_GROUP_OPTIONS = Object.freeze(
  WATER_GROUPS.map((value) => Object.freeze({ value, label: WATER_GROUP_LABELS[value] })),
);

/* Вид кадра: вблизи (блок воды на сетке) или под водой. */
export const WATER_VIEW_OPTIONS = Object.freeze([
  Object.freeze({ value: "close", label: "Вблизи" }),
  Object.freeze({ value: "under", label: "Под водой" }),
]);

/* Виды кадра из игры (`WaterSeaStage`): берег с мелью и дно со склоном. */
export const WATER_SEA_VIEW_OPTIONS = Object.freeze([
  Object.freeze({ value: "close", label: "У берега" }),
  Object.freeze({ value: "under", label: "Под водой" }),
]);

export { WATER_DIRECTION_LABELS };

/* Подписи двух цветов: «от берега в глубину» — отмель и глубь. */
export const waterColourLabels = (effect) =>
  effect?.direction === "height" ? { first: tr("У берега"), second: tr("На глубине") } : { first: tr("Первый цвет"), second: tr("Второй цвет") };

export const WATER_SWATCHES = Object.freeze([
  "#40f8f1",
  "#2a95b1",
  "#32bfea",
  "#63fff1",
  "#39c687",
  "#63d4d4",
  "#006387",
  "#002d63",
  "#39584e",
  "#4e4f28",
  "#ff6fb5",
  "#f4f7ff",
]);

const number = (value, digits = 1) =>
  String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");

const NBSP = String.fromCharCode(160);

/* Проценты — целыми и с неразрывным пробелом: «44 %», а не «44,2 %» (десятые человеку не нужны, п. 3 `design-qa.md`). */
export const percentText = (value) => `${Math.round(value)}${NBSP}%`;

/** Сколько видно дна — словами: «2,8 м», «24 м». */
export function visibilityText(transparency) {
  const metres = waterVisibility(transparency);
  return `${number(metres, metres < 10 ? 1 : 0)} ${tr("м")}`;
}

/* Шаблоны с `{0}` — ключи словаря: `tr` отдаёт перевод шаблона, вставку
   подставляем сами. Значения собираются здесь, при отрисовке: в данных
   уровня модуля язык ещё русский. */
const fill = (template, ...values) =>
  values.reduce((text, value, index) => text.replace(`{${index}}`, value), tr(template));

/** Сколько видно дна при этой прозрачности — строка «?» раздела, не подпись под ползунком (п. 3 `design-qa.md`). */
export function transparencyHint(transparency) {
  const vanilla = Math.abs(transparency - WATER_VANILLA_TRANSPARENCY) < 0.05;
  const vanillaText = visibilityText(WATER_VANILLA_TRANSPARENCY);
  if (vanilla) return fill("Как в игре: дно видно до {0}.", vanillaText);
  return fill(
    "Дно видно до {0} (в игре — {1}).",
    visibilityText(transparency),
    vanillaText,
  );
}

/*
 * Свет в толще (шейдер `PS_FogComposite`): цвет воды в игре не светится сам —
 * его освещают солнце и небо таймцикла. Подсказка под цветом и подпись
 * кадра; переводится в месте отрисовки (`tr`).
 */
export const WATER_LIGHT_NOTE =
  "Цвет толщи в игре освещают солнце и небо: днём на солнце он такой, как в кадре, в тени и в сумерках темнее, а ночью — и с небом, где ночь стоит весь день, — вода тёмная при любом цвете.";

/* Туман Rockstar у берега и на глубине — для «как в игре». */
const VANILLA_SHORE = [50, 82, 82];
const VANILLA_DEEP = [1, 27, 33];

/**
 * Цвет воды на экране в точке — для кадра, карты и плиток: облик группы
 * (`compileWaterLooks(работа)[группа]`), отмель `s` и мировые координаты.
 * Тексель тумана и есть цвет экрана днём на солнце (шейдер берёт его
 * квадрат — линейный свет, — и солнце со небом его освещают); «Как в игре»
 * — туман Rockstar между отмелью и глубью.
 */
export function waterScreenColour(look, s, x, y, out = [0, 0, 0]) {
  if (!look.tint) {
    for (let channel = 0; channel < 3; channel += 1)
      out[channel] = Math.round(VANILLA_DEEP[channel] + (VANILLA_SHORE[channel] - VANILLA_DEEP[channel]) * s);
    return out;
  }
  return waterFogTexel(look.compiled, { s, x, y }, out);
}

export { compileWaterLooks };

/** Что уедет в игру — одной фразой в панели редактора. `under` — `waterUnderLook`. */
export function waterPlanText(looks, under = null) {
  /* Части — уже переведённые: слой перевода разметки вложенный шаблон в
     шаблоне не поймает. */
  const parts = [];
  if (looks.sea.tint || looks.inland.tint) parts.push(fill("цвет — плитки тумана воды ({0} штата и Кайо-Перико)", WATER_INVENTORY_SIZE.tiles));
  if (looks.inland.tint) parts.push(fill("туман рек ({0} файлов)", WATER_INVENTORY_SIZE.rivers));
  const transparent = [looks.sea, looks.inland].some((look) => Math.abs(look.transparency - WATER_VANILLA_TRANSPARENCY) >= 0.05);
  if (transparent) parts.push(tr("прозрачность — квады воды water.xml"));
  if (under && !under.vanilla)
    parts.push(
      tr(
        "вид под водой — подводные модификаторы таймцикла: underwater и местные у берега, в порту, каналах, реках и озёрах (поверх файла игрока), подводная дымка",
      ),
    );
  if (!parts.length) return tr("Вода как в игре: ставить нечего.");
  return fill("В игру уйдут: {0}. Дождь, лужи, бассейны и фонтаны не трогаются.", parts.join(", "));
}

/* ------------------------------------------------------------------ *
 * Под водой
 * ------------------------------------------------------------------ */

/*
 * Штатные подводные модификаторы (`timecycle_mods_1.xml` игры) — то, что
 * кадр «Под водой» и подсказки пересчитывают той же функцией, что
 * установщик: открытое море (`underwater`) и берег (`WATER_shore` — коробки
 * вдоль всего побережья, где ныряют чаще всего). Только числа, текстур в них
 * нет.
 */
const VANILLA_UNDERWATER = Object.freeze([
  ["fog_col_r", 0, 0.7],
  ["fog_col_g", 0.051, 0.7],
  ["fog_col_b", 0.173, 0.7],
  ["light_dir_col_r", 0.004, 0.9],
  ["light_dir_col_g", 0.078, 0.9],
  ["light_dir_col_b", 0.176, 0.9],
  ["fog_density", 100, 100],
  ["fog_falloff", 20, 20],
  ["fog_base_height", 1, 1],
  ["fog_start", 0, 0],
  ["far_clip", 200, 200],
  ["dof_blur_far", 1, 0],
  ["hh_maxIntensity", 1, 0],
  ["postfx_noise", 0.02, 0],
  ["postfx_vignetting_intensity", 0.915, 0],
]);
const VANILLA_SHORE_MODIFIER = Object.freeze([
  ["fog_start", -1, -1],
  ["fog_density", 400, 400],
  ["fog_falloff", 200, 200],
  ["fog_base_height", 2, 2],
  ["fog_haze_density", 20, 20],
  ["far_clip", 500, 500],
]);

/* Глубина кадра и подсказок: нырок у берега на 6 м. */
export const UNDER_DEPTH = 6;

/** Сколько метров: «12 м», «2,4 м». */
export const metresText = (metres) => `${number(metres, metres < 10 ? 1 : 0)} ${tr("м")}`;

/** На сколько видно: «примерно на 12 м», «дальше километра». */
const reachText = (metres) => (metres >= 1000 ? tr("дальше километра") : fill("примерно на {0}", metresText(metres)));

/*
 * Видимость под водой у берега и в открытом море для облика `look`
 * (`waterUnderLook`) — туманом игры (`waterUnderwaterReach`) на глубине
 * `UNDER_DEPTH`.
 */
function reachOf(look) {
  return {
    shore: waterUnderwaterReach(waterUnderwaterModifier(VANILLA_SHORE_MODIFIER, look), UNDER_DEPTH),
    sea: waterUnderwaterReach(waterUnderwaterModifier(VANILLA_UNDERWATER, look), UNDER_DEPTH),
  };
}
const VANILLA_REACH = Object.freeze(reachOf({ vanilla: true }));

/** Подсказка под ползунком видимости под водой («Своя»). */
export function underVisibilityText(transparency) {
  const reach = reachOf({ vanilla: false, colour: null, visibility: waterVisibility(transparency), clarity: 0 });
  return fill(
    "На глубине {0} м у берега видно {1}, в открытом море — {2} (в игре — {3} и {4}).",
    UNDER_DEPTH,
    reachText(reach.shore),
    reachText(reach.sea),
    metresText(VANILLA_REACH.shore),
    metresText(VANILLA_REACH.sea),
  );
}

/** Что делается под водой — подсказка раздела «Под водой». */
export function underHint(input) {
  const project = normalizeWaterProject(input);
  const look = waterUnderLook(project);
  if (project.under.mode === "game")
    return fill(
      "Под водой как в игре: у берега, в порту и каналах густой туман (на глубине {0} м видно {1}), тёмно-синий свет, размытие дальше 5 м, дрожание, шум и подводная дымка.",
      UNDER_DEPTH,
      reachText(VANILLA_REACH.shore),
    );
  if (look.vanilla) return tr("Сейчас под водой — как сверху.");
  const reach = reachOf(look);
  const clean =
    look.clarity >= 0.75 ? tr("чисто: без размытия, дрожания, шума и подводной дымки") : look.clarity > 0.05 ? tr("мути меньше") : tr("муть как в игре");
  const neutral = look.colour && Math.max(...look.colour) - Math.min(...look.colour) < 0.25 * Math.max(...look.colour, 0.001);
  const colour = !look.colour
    ? tr("оттенок как в игре")
    : neutral
      ? tr("даль уходит в синеву чистой воды, а не в молоко")
      : tr("туман и свет — оттенком вашего цвета");
  return fill(
    "Под водой у берега видно {0}, в открытом море — {1}; {2}, {3}. Так — у берега, в порту, каналах, реках, озёрах и в открытом море.",
    reachText(reach.shore),
    reachText(reach.sea),
    clean,
    colour,
  );
}

/**
 * Облик кадра «Под водой»: `{ fog: [r, g, b], light: [r, g, b] (доли), metres
 * (у берега), sea (в открытом море), blur (0…1), haze, noise, vignette, mist
 * (доля подводной дымки) }` — те же числа, что уедут в игру.
 */
export function underPreview(input) {
  const look = waterUnderLook(input);
  const fields = new Map(waterUnderwaterModifier(VANILLA_UNDERWATER, look).map(([name, value]) => [name, value]));
  const reach = reachOf(look);
  return {
    fog: [fields.get("fog_col_r"), fields.get("fog_col_g"), fields.get("fog_col_b")],
    light: [fields.get("light_dir_col_r"), fields.get("light_dir_col_g"), fields.get("light_dir_col_b")],
    metres: reach.shore,
    sea: reach.sea,
    blur: fields.get("dof_blur_far"),
    haze: fields.get("hh_maxIntensity"),
    noise: fields.get("postfx_noise"),
    vignette: fields.get("postfx_vignetting_intensity"),
    mist: waterUnderwaterMistShare(look),
    vanilla: look.vanilla,
  };
}
