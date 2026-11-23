/*
 * «Дороги» — дороги и тротуары всей карты сразу (задача 6 ТЗ 07.10.2026).
 *
 * Дорога в GTA V — это не одна текстура. Асфальт, грунтовки и тротуары
 * лежат листами в общих словарях `gtxd.rpf` (`globalroads`, `citywestrd`,
 * `cs4roads`…), их копии высокой чёткости — в `+hi`, дальние — в словарях
 * дальних планов под именем с `_lod` (`globalroadslods`, `desertroadslod`),
 * а копии тех же листов — ещё и в словарях районов. Поэтому редактор правит
 * не файл, а семейство листа: всё, что игра рисует этим листом, на любом
 * расстоянии — по описи (`inventory/roads.js`, `scripts/prepare-roads.mjs`).
 *
 * Три части — асфальт, грунтовки (грязь, песок, гравий), тротуары (плитка и
 * бордюры) — и у каждой облик:
 *   standard — «Стандарт», как в игре;
 *   colour   — свой цвет эффектом мастерской (цвет, градиент, радуга,
 *              перелив, линия): зерно и светотень листа остаются;
 *   flat     — «Без текстуры»: ровный цвет, рисунок листа убран;
 *   pattern  — узор каталога, image — своя картинка, gradient — градиент
 *              (общая система отделки, `finish.js`).
 *
 * Разметка (ТЗ 17.10.2026, вечер, задача 1) — по группам: «Осевая (жёлтая)»,
 * «Края и полосы (белая)», «Пешеходные переходы», «Стоп-линии и стрелки»,
 * «Цветная разметка» и «Парковка»; у каждой — свой цвет, «Как в игре» или
 * «Скрыть», своя яркость; поверх всех — общая яркость, износ краски и
 * «Скрыть всё». Краска лежит в листах-атласах (`im_roadmarkings*`, DXT5 с
 * альфой), в линиях, нарисованных прямо в листе асфальта (трассы, переходы),
 * и во встроенных листах моделей; на какие группы она делится — решает
 * разбор краски (`road-paint.js`, одна функция у кадра и у установщика).
 * Линии в асфальте получают облик разметки: перекраска асфальта их не
 * трогает — иначе жёлтые линии «перекрашивались бы случайно» в цвет дороги.
 *
 * Не дороги — не трогаются: парковки (`dc_parking_tarmac`), отбойники,
 * откосы, смеси с травой и листы нормалей и бликов в семейства не входят.
 */

import { colourEffectAt, lookOf, normalizeColourEffect } from "./colour-effects.js";
import { hexBytes, normalizeRecolourHex } from "./colour.js";
import {
  ROAD_GROUP_ALL,
  ROAD_GROUP_BITS,
  ROAD_GROUP_IDS,
  WHITE_SATURATION,
  YELLOW_HUE,
  YELLOW_SATURATION,
  paintHsv,
  roadPaintGroups,
} from "./road-paint.js";
import {
  finishImageAssets,
  finishRepeats,
  finishSignature,
  gradientTile,
  normalizeFinishFields,
  normalizeFinishImage,
  patternTile,
  sampleImage,
  sampleTile,
  tintImagePixels,
} from "./finish.js";

export { ROAD_GROUP_ALL, ROAD_GROUP_BITS, ROAD_GROUP_IDS, roadPaintGroups };

export const ROADS_PROJECT_SCHEMA = 1;
const NAME_LIMIT = 60;

/* ------------------------------------------------------------------ *
 * Части и семейства листов
 * ------------------------------------------------------------------ */

export const ROAD_PARTS = Object.freeze([
  Object.freeze({ id: "asphalt", label: "Асфальт", note: "Улицы, трассы и развязки", colour: "#3b3e44" }),
  Object.freeze({ id: "dirt", label: "Грунтовки", note: "Дороги по грязи, песку и гравию", colour: "#8a6f4d" }),
  Object.freeze({ id: "sidewalk", label: "Тротуары", note: "Плитка тротуаров и бордюры", colour: "#9a958c" }),
]);
export const ROAD_PART_IDS = Object.freeze(ROAD_PARTS.map((part) => part.id));
export const findRoadPart = (id) => ROAD_PARTS.find((part) => part.id === id) || null;

/*
 * Семейство листа по имени. Имя сводится к основе: без `nxg_`…`_h` (листы
 * высокой чёткости), без хвоста дальних планов (`_lod`, `_lod1`, `_slod`,
 * `_slod2`, приставки `lod_`), без «тёмных» вариантов (`_drk`, `dark`,
 * `flatdk`) и без приклеенного имени альфы: у листов DXT5 в словаре имя
 * цвета и имя альфы стоят подряд (`im_roadmarkings05im_roadmarkings05_a`,
 * `cs_rsl_ed_roadlinescs_rsn_sl_road_0003b_a`). Порядок правил важен:
 * разметка раньше асфальта.
 *
 * Не дороги: отбойники, знаки, мосты, стены, парковки и разметка парковок,
 * откосы и скалы у дорог, смеси дороги с травой и гравий земли — правила их
 * не узнают, и такие листы остаются как в игре.
 */
const NOT_ROAD = /grass|wall|sign|barrier|armco|build|odds|fence|bridge|rivets|roadcut|bank|parking|carpark|stencil|metal|roadblend|works|plate|underbelly|detailmask|detailmap/;

/*
 * Разметка парковок: свои листы, а не асфальт парковок (`dc_parking_tarmac`
 * остаётся как в игре). Правило идёт раньше `NOT_ROAD`: «parking» и
 * «carpark» в имени у неё — как раз признак.
 */
const PARKING_MARKINGS = /^im_carparkmarkings\d+[a-z]?(?:_big|_a_big|_alt_ro\d)?(?:_a)?$|^invader_parking_marking$/;

/*
 * Грязь и износ дорог лежат в листах с «roadmarkings» в имени, но краской не
 * являются (тёмные пятна и следы шин): их не красят как разметку.
 */
const ROAD_WEAR = /^im_roadmarkings05|^scrn_dtlsroadmarks/;

export const ROAD_TEXTURE_RULES = Object.freeze([
  Object.freeze({
    part: "markings",
    pattern:
      /^(?:im|dc)_(?:gg)?roadmarkings\d+[a-z]?(?:_a)?$|^po1_08_ggroadmarkings$|^cs_rsl_ed_roadlines$|^cs_rsn_sl_freeway(?:mrkings|arrows)_\d+$|^rnos_roadmarkings_\d+(?:_a)?$|^cls_cs3_07_newroadmarkings\d+$|^ss1_11_dtltxd_markings_d$|^bh1_13_roadmarkings$|^bh1_13_alleymarks1$|^bh1_15_genallmarkings$|^sc1_32_cmk_roadmarkings_001$|^rsn_os_marking01$|^po1_05_gg_chevron_ol$|^sc1_05_stripe$|^nb_roadmarkings$|^ih_roadmarkings_01(?:_ab(?:al)?)?$|^runway_edge_marks$|^ap_gate_markings$/,
  }),
  Object.freeze({
    part: "sidewalk",
    pattern:
      /^(?:im|dc|lm)_sidewalk\d+[a-z]?$|^im_kerbs\d+[a-z]?$|^im_ss_kerb\d+$|^cs_rn_tf_footpath\d$|^bh1_04_rsn_rls_sidewalk_\d+$|^po1-04_hc_sidewalk\d+$|^im_sidewalk_blend_\d+$|^rsn_os_sidewalk\d+$|^cm_vb_sidewalk\d+$|^cls_rn_chkerbs_\d+$|^os_mlyt_kerbs_\d+$|^tf_rsn_kerbs\d+$|^rbm_kerb\d+$|^dc_kerbs\d+$|^ja_rn_hw_kerb$|^njdocksidewalk$|^dc_pavement_plainsmall\d+$|^ap1_fuckedkerbs$/,
  }),
  Object.freeze({
    part: "dirt",
    pattern:
      /^cs_rsl_aa_dirttrack\d$|^cs_rsn_sl_agrdirttrack\d$|^cs_rsn_sl_agrdirttrack_sandy\d?$|^dc_gravel_road\d+$|^cs_rnad_dirtroad_\d+[a-z]?$|^cs_rsn_sm_dirtroad_\d+[a-z]?$|^cs_dirttrack\d$/,
  }),
  Object.freeze({
    part: "asphalt",
    pattern: new RegExp(
      [
        /^im_road_\d+[a-z]?(?:_new)?$/,
        /^dc_road_\d+$/,
        /^(?:im|dc)_road_damage(?:_dirt)?_\d+[a-z]?$/,
        /^im_road_edge_\d+$/,
        /^(?:im|dc)_road_crossing_\d+[a-z]?$/,
        /^im_freeway_road(?:\d+[a-z]?)?$|^mw_freeway_road\d+flat$/,
        /^cs_rsn_sl_road_\d+[a-z]?(?:_forfr_mw)?$|^cs_rsn_sl_roadb_\d+[a-z]*$|^cs_rsn_sl_roadc_\d+$|^cs_rsn_sl_townroad_\d+[a-z]?$/,
        /^cs_rsn_sl_freeway1_\d+[a-z]?$|^cs_rsn_sl_freeway(?:tarmac|cracks|rumble)_\d+(?:_b)?$/,
        /^cs_rsl_ps_newtarmac_\d+$|^cs_rsn_sl_(?:agr)?tarmactr(?:ac)?k\d[a-z]?$|^et_tarmacbusted\d*$|^darktarmacsd_\d+(?:_dustt?)?$/,
        /^plg_dc_road_\d+$|^plg_im_road_snow_\d+$|^rsn_et_road_\d+[a-z]?$|^og_road_\d+$|^gg_decalroad$|^rsn_am_road_stain_overlay_d$/,
        /^cs4_roads_dusty\d+$|^cs4_roadsb?_junc\d+$|^cs4_roadsb?_tpage\d+[a-z]?$/,
        /^cs[1-6]_(?:paleto)?roads[ab]?(?:_(?:tpage\d+[a-z]?|junction_\d+|hardshoulder|intf))?$|^cs2_slod\d_roads$/,
        /^cs_rsn_road1(?:_junc)?$|^cs_rsd_jl_roadb_\d+$|^cs_rsn_dc_road_tunnel_\d+$/,
        /^ch[123]_roads?[a-z0-9]*(?:_[a-z0-9]+)*$|^ch1_rds_ea_stripe$|^ch1_rsd_jl_rd[a-z]\d*$|^ch3_rd\d_road\d+$|^ch3_reb_roads_rumblestrip$|^ch2_6f_roadpatch$/,
      ]
        .map((pattern) => pattern.source)
        .join("|"),
    ),
  }),
]);

/* Основа имени без высокой чёткости, дальнего плана и тёмного варианта. */
function familyOf(name) {
  /* `_ql` — вариант качества листа разметки (`dc_roadmarkings01…_a_ql`). */
  let base = name.replace(/^nxg_/, "").replace(/_ql$/, "").replace(/_+$/, "");
  let lod = /^lod_/.test(base);
  base = base.replace(/^lod_/, "");
  /* Листы нормалей и бликов дорогой не считаются: их цвет игра не показывает. */
  if (/_(?:n|s|nm|nrm|spec|normal)(?:_s?lod_?\d*)?$|_s_lod_?\d*$/.test(base)) return null;
  const far = /_s?lod_?\d*$/.exec(base);
  if (far) {
    lod = true;
    base = base.slice(0, far.index);
  }
  if (/^cs2_slod\d_roads$/.test(base)) lod = true;
  base = base
    .replace(/_h$/, "")
    .replace(/flatdk$/, "flat")
    .replace(/_?(?:dark|drk)$/, "")
    .replace(/_+$/, "");
  if (ROAD_WEAR.test(base)) return null;
  if (PARKING_MARKINGS.test(base)) return { family: base, part: "markings", lod, kind: "parking" };
  if (NOT_ROAD.test(base)) return null;
  for (const rule of ROAD_TEXTURE_RULES)
    if (rule.pattern.test(base)) return { family: base, part: rule.part, lod, kind: rule.part === "asphalt" && /_crossing_/.test(base) ? "crossing" : null };
  return null;
}

/**
 * Семейство листа: `{ family, part, lod, kind }` или `null`; `kind` —
 * `crossing` (лист зебры переходов), `parking` (разметка парковок) или `null`.
 * Склеенное имя DXT5
 * разбирается по месту, где начинается имя альфы: часть до него должна
 * сама быть листом дороги.
 */
export function roadTextureFamily(name) {
  const lower = String(name || "").toLowerCase();
  /* Дальний лист и у склеенного имени (`…_lodим…_a_lod`): признак `lod` берётся по всему имени. */
  const far = /(?:^|_)s?lod\d*(?:_|$)/.test(lower);
  const direct = familyOf(lower);
  if (direct) return far && !direct.lod ? { ...direct, lod: true } : direct;
  for (let at = 6; at <= lower.length - 3; at += 1) {
    const first = lower.slice(0, at);
    const rest = lower.slice(at);
    if (!/^[a-z]/.test(rest)) continue;
    if (!(/_a(?:lpha)?(?:_[a-z0-9]+)?$/.test(rest) || rest === first || rest === `${first}s`)) continue;
    const glued = familyOf(first);
    if (glued) return far && !glued.lod ? { ...glued, lod: true } : glued;
  }
  return null;
}

/** Основа имени листа (для подписи): семейство или само имя строчными. */
export const roadSheetBase = (name) => roadTextureFamily(name)?.family || String(name || "").toLowerCase();

/* ------------------------------------------------------------------ *
 * Облик части и разметки
 * ------------------------------------------------------------------ */

export const ROAD_SURFACE_MODES = Object.freeze(["standard", "colour", "flat", "pattern", "image", "gradient"]);
export const ROAD_SURFACE_LABELS = Object.freeze({
  standard: "Стандарт",
  colour: "Свой цвет",
  flat: "Без текстуры",
  pattern: "Узор",
  image: "Своя текстура",
  gradient: "Градиент",
});
/* Яркость части, %: 100 — как в игре. */
export const ROAD_BRIGHTNESS = Object.freeze({ min: 40, max: 160, standard: 100 });

/* У группы разметки: «Как в игре», свой цвет, «Скрыть». */
export const ROAD_MARKING_MODES = Object.freeze(["standard", "colour", "hidden"]);
/* Яркость разметки, %: 100 — как в игре; выше — свежая яркая краска и неон. */
export const ROAD_MARKING_BRIGHTNESS = Object.freeze({ min: 30, max: 250, standard: 100 });
/* Износ краски, %: 100 — как в игре (потёртая), 0 — ровная чистая краска. */
export const ROAD_MARKING_WEAR = Object.freeze({ min: 0, max: 100, standard: 100 });
export const ROAD_MARKING_GROUPS = Object.freeze([
  Object.freeze({ id: "center", label: "Осевая (жёлтая)", note: "Жёлтые линии вдоль дороги: осевая, двойная, жёлтая кромка бордюра", colour: "#f2c230" }),
  Object.freeze({ id: "edge", label: "Края и полосы (белая)", note: "Белые линии вдоль дороги: края, полосы, прерывистая", colour: "#f4f4f2" }),
  Object.freeze({ id: "crossing", label: "Пешеходные переходы", note: "Полосы зебры", colour: "#f4f4f2" }),
  Object.freeze({ id: "stops", label: "Стоп-линии и стрелки", note: "Стоп-линии поперёк дороги, стрелки, надписи и значки на асфальте", colour: "#f4f4f2" }),
  Object.freeze({ id: "coloured", label: "Цветная разметка", note: "Синяя, красная и зелёная краска: велополосы, места для инвалидов, остановки", colour: "#2f80ed" }),
  Object.freeze({ id: "parking", label: "Парковка", note: "Линии парковочных мест. Общий «Скрыть» и общая яркость их не трогают", colour: "#f4f4f2" }),
]);
/* Группы, которых касаются общие яркость, износ и «Скрыть всё»: парковка — только по своему выбору. */
const isGlobalGroup = (id) => id !== "parking";

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);
const clampInt = (value, { min, max, standard }) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : standard;
};

function normalizeSurface(part, input) {
  const source = plain(input);
  const colour = findRoadPart(part)?.colour || "#808080";
  return {
    mode: choice(source.mode, ROAD_SURFACE_MODES, "standard"),
    look: normalizeColourEffect(lookOf(source), { colour, colour2: "#ffffff", direction: "across" }),
    brightness: clampInt(source.brightness, ROAD_BRIGHTNESS),
    ...normalizeFinishFields(source),
  };
}

function normalizeGroup(group, input) {
  const source = plain(input);
  return {
    mode: choice(source.mode, ROAD_MARKING_MODES, "standard"),
    colour: normalizeRecolourHex(source.colour, group.colour),
    brightness: clampInt(source.brightness, ROAD_MARKING_BRIGHTNESS),
  };
}

/*
 * Разметка работы. Работы до 17.10.2026 держали две линии — `yellow` и
 * `white`: жёлтая красила всю жёлтую краску, белая — всю белую, и ту, что
 * теперь отдельные группы. Они читаются как раньше: жёлтая — осевая, белая —
 * края, переходы и стрелки.
 */
function normalizeMarkings(input) {
  const source = plain(input);
  const legacy = { center: source.yellow, edge: source.white, crossing: source.white, stops: source.white };
  return {
    ...Object.fromEntries(ROAD_MARKING_GROUPS.map((group) => [group.id, normalizeGroup(group, source[group.id] ?? legacy[group.id])])),
    brightness: clampInt(source.brightness, ROAD_MARKING_BRIGHTNESS),
    wear: clampInt(source.wear, ROAD_MARKING_WEAR),
    hidden: source.hidden === true,
  };
}

export function normalizeRoadsProject(input) {
  const source = plain(input);
  const parts = plain(source.parts);
  return {
    schema: ROADS_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    parts: Object.fromEntries(ROAD_PART_IDS.map((id) => [id, normalizeSurface(id, parts[id])])),
    markings: normalizeMarkings(source.markings),
  };
}

export const createRoadsProject = () => normalizeRoadsProject({});
export const serializeRoadsProject = (project) => JSON.stringify(normalizeRoadsProject(project));

export function parseRoadsProject(text) {
  try {
    return normalizeRoadsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createRoadsProject();
  }
}

export const roadSurfaceIsStock = (surface) =>
  surface.mode === "standard" && surface.brightness === ROAD_BRIGHTNESS.standard;
/* Группа как в игре: ни цвета, ни яркости, ни «Скрыть», ни общих правок (парковку общие не касаются). */
const groupIsStock = (markings, id) =>
  markings[id].mode === "standard" &&
  markings[id].brightness === ROAD_MARKING_BRIGHTNESS.standard &&
  (!isGlobalGroup(id) || (!markings.hidden && markings.brightness === ROAD_MARKING_BRIGHTNESS.standard && markings.wear === ROAD_MARKING_WEAR.standard));
export const roadMarkingsAreStock = (markings) => ROAD_MARKING_GROUPS.every((group) => groupIsStock(markings, group.id));

/* Что делает работа с краской группы: скрыть, свой цвет (или `null`), яркость (доля) и износ (доля). */
function markingState(markings, id) {
  const group = markings[id];
  const global = isGlobalGroup(id);
  return {
    hidden: group.mode === "hidden" || (global && markings.hidden),
    colour: group.mode === "colour" ? hexBytes(group.colour) : null,
    bright: (group.brightness / 100) * (global ? markings.brightness / 100 : 1),
    wear: global ? markings.wear / 100 : 1,
  };
}

/** Маска групп (`ROAD_GROUP_BITS`), которые работа меняет: словарь без их краски собирать незачем. */
export function roadsChangedMarkingGroups(input) {
  const { markings } = normalizeRoadsProject(input);
  return ROAD_MARKING_GROUPS.reduce((mask, group) => (groupIsStock(markings, group.id) ? mask : mask | ROAD_GROUP_BITS[group.id]), 0);
}

/** Дороги как в игре: ставить нечего. */
export function roadsProjectIsStock(input) {
  const project = normalizeRoadsProject(input);
  return ROAD_PART_IDS.every((id) => roadSurfaceIsStock(project.parts[id])) && roadMarkingsAreStock(project.markings);
}

/* Что из облика части меняет файлы. */
function surfaceSignature(surface) {
  if (roadSurfaceIsStock(surface)) return null;
  const brightness = surface.brightness === ROAD_BRIGHTNESS.standard ? {} : { brightness: surface.brightness };
  if (surface.mode === "standard") return brightness;
  if (surface.mode === "colour" || surface.mode === "flat") return { mode: surface.mode, look: surface.look, ...brightness };
  return { ...(finishSignature(surface) || { mode: surface.mode }), ...brightness };
}

function markingsSignature(markings) {
  if (roadMarkingsAreStock(markings)) return null;
  const changed = {};
  for (const group of ROAD_MARKING_GROUPS) {
    if (groupIsStock(markings, group.id)) continue;
    const state = markingState(markings, group.id);
    changed[group.id] = state.hidden
      ? { hidden: true }
      : {
          ...(state.colour ? { colour: markings[group.id].colour } : {}),
          brightness: Math.round(state.bright * 100),
          ...(state.wear < 1 ? { wear: Math.round(state.wear * 100) } : {}),
        };
  }
  return changed;
}

/** Отпечаток для очереди «Применить»: тот же облик дорог — тот же отпечаток. */
export function roadsProjectSignature(input) {
  const project = normalizeRoadsProject(input);
  return JSON.stringify({
    parts: Object.fromEntries(ROAD_PART_IDS.map((id) => [id, surfaceSignature(project.parts[id])])),
    markings: markingsSignature(project.markings),
  });
}

/** «Стандарт»: всё как в игре; цвета, узоры и картинки помнятся. */
export function applyRoadsStandard(input, partId = null) {
  const project = normalizeRoadsProject(input);
  const stockSurface = (surface) => ({ ...surface, mode: "standard", brightness: ROAD_BRIGHTNESS.standard });
  const stockMarkings = (markings) => ({
    ...markings,
    hidden: false,
    brightness: ROAD_MARKING_BRIGHTNESS.standard,
    wear: ROAD_MARKING_WEAR.standard,
    ...Object.fromEntries(ROAD_MARKING_GROUPS.map((group) => [group.id, { ...markings[group.id], mode: "standard", brightness: ROAD_MARKING_BRIGHTNESS.standard }])),
  });
  if (partId === "markings") return { ...project, markings: stockMarkings(project.markings) };
  if (partId && ROAD_PART_IDS.includes(partId))
    return { ...project, parts: { ...project.parts, [partId]: stockSurface(project.parts[partId]) } };
  return {
    ...project,
    parts: Object.fromEntries(ROAD_PART_IDS.map((id) => [id, stockSurface(project.parts[id])])),
    markings: stockMarkings(project.markings),
  };
}

export const resetRoadsProject = (input) => ({ ...createRoadsProject(), name: normalizeRoadsProject(input).name });

/* Картинки человека в код не едут: часть со своей текстурой становится «Стандартом». */
export function shareableRoadsProject(input) {
  const project = normalizeRoadsProject(input);
  return {
    ...project,
    parts: Object.fromEntries(
      ROAD_PART_IDS.map((id) => {
        const surface = project.parts[id];
        return [id, surface.mode === "image" ? { ...surface, mode: "standard", image: { ...surface.image, asset: null, name: "" } } : surface];
      }),
    ),
  };
}

export function roadsLostInCode(input) {
  const project = normalizeRoadsProject(input);
  return Object.values(project.parts).some((surface) => surface.mode === "image" && surface.image?.asset)
    ? "свои текстуры (остаются на этом компьютере)"
    : "";
}

/** Свои картинки работы, которые нужны установщику (`Map` ключ → имя). */
export function roadsImageAssets(input) {
  const project = normalizeRoadsProject(input);
  return finishImageAssets(Object.values(project.parts));
}

/* ------------------------------------------------------------------ *
 * Шаблоны: у каждой части — цветовые и текстурные
 * ------------------------------------------------------------------ */

const solid = (colour) => ({ mode: "solid", colour, colour2: "#ffffff", direction: "across", width: 2, shift: 0 });
const tinted = (id, label, colour, extra = {}) =>
  Object.freeze({ id, label, kind: "colour", surface: { mode: "colour", look: solid(colour), ...extra } });
const flat = (id, label, colour) => Object.freeze({ id, label, kind: "colour", surface: { mode: "flat", look: solid(colour) } });
const textured = (id, label, pattern, colours, scale = 100) =>
  Object.freeze({ id, label, kind: "texture", surface: { mode: "pattern", pattern: { id: pattern, colours, scale } } });

export const ROAD_PART_PRESETS = Object.freeze({
  asphalt: Object.freeze([
    tinted("fresh", "Свежий асфальт", "#26282c", { brightness: 85 }),
    tinted("faded", "Выцветший", "#77766f", { brightness: 115 }),
    tinted("red", "Красный асфальт", "#7c2b25"),
    tinted("blue", "Синий асфальт", "#1f3f73"),
    tinted("green", "Зелёный велоасфальт", "#2f6b3a"),
    flat("matte", "Матовый тёмный", "#222326"),
    textured("concrete", "Бетонные плиты", "concrete", ["#8e8c87", "#64625e", "#3d3c3a"], 140),
    textured("cobble", "Брусчатка", "bricks", ["#5d5750", "#3c3833", "#8a8379"], 70),
    textured("terrazzo", "Крошка", "terrazzo", ["#4a4b4f", "#6d6e72", "#2c2d30"], 80),
    textured("carbon", "Карбон", "carbon", ["#121316", "#2c2f35", "#6a707a"], 100),
  ]),
  dirt: Object.freeze([
    tinted("sand", "Жёлтый песок", "#c4a46a", { brightness: 110 }),
    tinted("clay", "Красная глина", "#8c4a2b"),
    tinted("gravel", "Серый гравий", "#7c7c78"),
    tinted("earth", "Тёмная земля", "#4b3b2b", { brightness: 90 }),
    flat("dust", "Пыльная дорога", "#a58f6c"),
    textured("stones", "Камни", "stone", ["#8a7e6c", "#4d4437", "#c2b49c"], 110),
    textured("rust", "Красный грунт", "rust", ["#7a6252", "#8a4a22", "#3a1e10"], 120),
    textured("terrazzo", "Мелкий гравий", "terrazzo", ["#9a9286", "#6e675c", "#c9c0b1"], 60),
  ]),
  sidewalk: Object.freeze([
    tinted("light", "Светлая плитка", "#cbc6bb", { brightness: 110 }),
    tinted("granite", "Тёмный гранит", "#45464a"),
    tinted("terracotta", "Терракота", "#a2573c"),
    tinted("sand", "Песчаный камень", "#b9a27a"),
    flat("white", "Белый тротуар", "#e8e6e1"),
    textured("tiles", "Плитка", "tiles", ["#f4f1ea", "#dcd3c2", "#8f8a80"], 90),
    textured("bricks", "Кирпич", "bricks", ["#9c4a32", "#6e2f1f", "#cfc6b8"], 80),
    textured("hex", "Соты", "hex", ["#2a2e3a", "#7a7f8c", "#3d4352"], 70),
    textured("marble", "Мрамор", "marble", ["#ece8e3", "#6d6a70", "#c9c4bf"], 100),
  ]),
});

export const ROAD_MARKING_PRESETS = Object.freeze([
  Object.freeze({ id: "game", label: "Как в игре", markings: {} }),
  Object.freeze({ id: "white", label: "Вся разметка белая", markings: { center: { mode: "colour", colour: "#f4f4f2" } } }),
  Object.freeze({ id: "bright", label: "Яркая", markings: { brightness: 145 } }),
  Object.freeze({ id: "worn", label: "Стёртая", markings: { brightness: 55 } }),
  Object.freeze({ id: "fresh", label: "Свежая краска", markings: { wear: 0, brightness: 115 } }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    markings: {
      center: { mode: "colour", colour: "#00e5ff" },
      edge: { mode: "colour", colour: "#ff2bd6" },
      crossing: { mode: "colour", colour: "#39ff14" },
      stops: { mode: "colour", colour: "#ffd400" },
      brightness: 200,
      wear: 0,
    },
  }),
  Object.freeze({ id: "hidden", label: "Без разметки", markings: { hidden: true } }),
]);

/** Шаблон части поверх работы: облик только этой части. */
export function applyRoadPartPreset(input, partId, presetId) {
  const project = normalizeRoadsProject(input);
  const preset = (ROAD_PART_PRESETS[partId] || []).find((item) => item.id === presetId);
  if (!preset) return project;
  const current = project.parts[partId];
  return normalizeRoadsProject({
    ...project,
    parts: { ...project.parts, [partId]: { ...current, brightness: ROAD_BRIGHTNESS.standard, ...preset.surface } },
  });
}

/** Шаблон разметки поверх работы. */
export function applyRoadMarkingPreset(input, presetId) {
  const project = normalizeRoadsProject(input);
  const preset = ROAD_MARKING_PRESETS.find((item) => item.id === presetId);
  if (!preset) return project;
  const stock = applyRoadsStandard(project, "markings").markings;
  /* Шаблон называет группы и общие поля: группа перекрывает только названное. */
  const markings = { ...stock };
  for (const [key, value] of Object.entries(preset.markings)) markings[key] = plain(value) === value && plain(stock[key]) === stock[key] ? { ...stock[key], ...value } : value;
  return normalizeRoadsProject({ ...project, markings });
}

/*
 * Готовые виды дорог целиком (ТЗ 24.10.2026, п. 5): шаблоны трёх частей и разметки, собранные в один
 * облик. Из них идут работы Astral в каталог (`studio-works.js`) взамен снятых редуксных дорог; «Как в
 * игре» в каталог не идёт — это не мод. Состав назван ссылками на шаблоны выше: поправили шаблон — поправился
 * и вид.
 */
export const ROADS_PRESETS = Object.freeze([
  Object.freeze({ id: "game", label: "Как в игре", description: "Дороги, тротуары и разметка Rockstar без правок.", parts: {}, markings: null }),
  Object.freeze({
    id: "neon",
    label: "Неоновая ночь",
    description: "Матовый тёмный асфальт, гранитные тротуары и неоновая разметка: голубая осевая, розовые края, зелёные переходы.",
    parts: { asphalt: "matte", dirt: "earth", sidewalk: "granite" },
    markings: "neon",
  }),
  Object.freeze({
    id: "fresh",
    label: "Свежая трасса",
    description: "Только что уложенный чёрный асфальт, светлая плитка тротуаров и яркая краска без износа.",
    parts: { asphalt: "fresh", dirt: "gravel", sidewalk: "light" },
    markings: "fresh",
  }),
  Object.freeze({
    id: "cobble",
    label: "Старый город",
    description: "Брусчатка вместо асфальта, кирпичные тротуары, красная глина на грунтовках и стёртая краска.",
    parts: { asphalt: "cobble", dirt: "clay", sidewalk: "bricks" },
    markings: "worn",
  }),
  Object.freeze({
    id: "concrete",
    label: "Бетонный город",
    description: "Бетонные плиты вместо асфальта, плитка на тротуарах, гравий на грунтовках и белая разметка без жёлтой.",
    parts: { asphalt: "concrete", dirt: "stones", sidewalk: "tiles" },
    markings: "white",
  }),
  Object.freeze({
    id: "desert",
    label: "Пустынное шоссе",
    description: "Выцветший на солнце асфальт, песчаные грунтовки и тротуары из песчаного камня, краска почти стёрта.",
    parts: { asphalt: "faded", dirt: "sand", sidewalk: "sand" },
    markings: "worn",
  }),
]);

/** Готовый вид поверх заготовки: все три части и разметка — по составу вида; имя работы не трогается. */
export function applyRoadsPreset(input, presetId) {
  const project = normalizeRoadsProject(input);
  const found = ROADS_PRESETS.find((item) => item.id === presetId);
  if (!found) return project;
  let next = { ...createRoadsProject(), name: project.name };
  for (const [partId, id] of Object.entries(found.parts)) next = applyRoadPartPreset(next, partId, id);
  return found.markings ? applyRoadMarkingPreset(next, found.markings) : next;
}

/** Шаблон части, с которым её облик совпадает, или `null`. */
export function matchingRoadPartPreset(input, partId) {
  const project = normalizeRoadsProject(input);
  const current = JSON.stringify(surfaceSignature(project.parts[partId]));
  return (
    (ROAD_PART_PRESETS[partId] || []).find(
      (item) => JSON.stringify(surfaceSignature(applyRoadPartPreset(project, partId, item.id).parts[partId])) === current,
    )?.id || null
  );
}

export function matchingRoadMarkingPreset(input) {
  const project = normalizeRoadsProject(input);
  const current = JSON.stringify(markingsSignature(project.markings));
  return ROAD_MARKING_PRESETS.find((item) => JSON.stringify(markingsSignature(applyRoadMarkingPreset(project, item.id).markings)) === current)?.id || null;
}

/* ------------------------------------------------------------------ *
 * Пиксели: разметка и линии в листе асфальта
 * ------------------------------------------------------------------ */

/**
 * Что за краска в пикселе: `"yellow"`, `"white"` или `null`. HSV, не HSL:
 * жёлтая — тон 26…72°, насыщенность от 0,36; белая — почти серая (и тёплая
 * кремовая тоже: её HSL-насыщенность обманчиво высока) и светлее `floor`.
 */
export function roadLineKind(r, g, b, floor = 0.42) {
  const [h, s, v] = paintHsv(r, g, b);
  if (s >= YELLOW_SATURATION && h >= YELLOW_HUE[0] && h <= YELLOW_HUE[1] && v >= 0.4) return "yellow";
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (s < WHITE_SATURATION && l >= floor) return "white";
  return null;
}

/* Цвет краски: свой тон по светлоте краски игры; износ 1 — потёртость игры остаётся, 0 — ровная краска. */
function lineColour(r, g, b, target, wear = 1) {
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const [tr, tg, tb] = target;
  /* Краска игры светлая (около 0,75): её светлота задаёт долю своего цвета. */
  const k = Math.min(1.25, luma / 0.75);
  const f = 1 + (k - 1) * wear;
  return [tr * f, tg * f, tb * f];
}

/* Краска игры без смены цвета: износ меньше полного подтягивает светлоту к светлоте свежей краски. */
function flattenPaint(r, g, b, wear) {
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luma < 0.04) return [r, g, b];
  const scale = 1 + (Math.min(2.2, 0.78 / luma) - 1) * (1 - wear);
  return [r * scale, g * scale, b * scale];
}

/* Одна точка краски в облике группы (скрытую здесь не рисуют). */
function paintAt(out, rgba, at, state) {
  let r = rgba[at];
  let g = rgba[at + 1];
  let b = rgba[at + 2];
  if (state.colour) [r, g, b] = lineColour(r, g, b, state.colour, state.wear);
  else if (state.wear < 1) [r, g, b] = flattenPaint(r, g, b, state.wear);
  out[at] = r * state.bright;
  out[at + 1] = g * state.bright;
  out[at + 2] = b * state.bright;
}

const markingStates = (markings) => ROAD_MARKING_GROUPS.map((group) => markingState(markings, group.id));

/**
 * Лист-атлас с разметкой по настройкам: краска каждой группы — своим цветом,
 * яркостью и износом, скрытая — прозрачна. Форма краски (альфа) не меняется,
 * кроме «Скрыть». Остальное в листе (покрытие, грязь) не трогается.
 * `kind`, `lod` — как у `roadPaintGroups`; `groups` — готовая карта краски.
 */
export function roadMarkingsPixels(rgba, width, height, markings, { part = "markings", kind = null, lod = false, groups = null } = {}) {
  const settings = normalizeMarkings(markings);
  const found = groups || roadPaintGroups(rgba, width, height, { part, kind, lod }).groups;
  const states = markingStates(settings);
  const out = new Uint8ClampedArray(rgba);
  for (let index = 0, at = 0; index < found.length; index += 1, at += 4) {
    const group = found[index];
    if (!group) continue;
    if (states[group - 1].hidden) out[at + 3] = 0;
    else paintAt(out, rgba, at, states[group - 1]);
  }
  return out;
}

/*
 * Светлые камешки и трещины асфальта — точки и завитки, линия — полоса:
 * пятно меньше четырёх сотых процента листа (и меньше 16 текселей) или
 * короче пятой части листа линией не считается. Правит `mask` на месте
 * (1 — полоса), ответ — сколько в полосах текселей.
 */
function keepLongStripes(mask, width, height) {
  const least = Math.max(16, Math.round(mask.length * 0.0004));
  const stack = new Int32Array(mask.length);
  let lines = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1) continue;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    mask[start] = 2;
    const members = [];
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (top) {
      const index = stack[--top];
      members.push(index);
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[index - 1] === 1) (mask[index - 1] = 2), (stack[top++] = index - 1);
      if (x < width - 1 && mask[index + 1] === 1) (mask[index + 1] = 2), (stack[top++] = index + 1);
      if (index >= width && mask[index - width] === 1) (mask[index - width] = 2), (stack[top++] = index - width);
      if (index + width < mask.length && mask[index + width] === 1) (mask[index + width] = 2), (stack[top++] = index + width);
    }
    const long = maxY - minY + 1 >= height * 0.2 || maxX - minX + 1 >= width * 0.2;
    const keep = size >= least && long ? 3 : 0;
    for (const index of members) mask[index] = keep;
    if (keep) lines += size;
  }
  for (let index = 0; index < mask.length; index += 1) mask[index] = mask[index] === 3 ? 1 : 0;
  return lines;
}

/* Красная краска бордюра (запрет стоянки): насыщенный красный. */
function kerbRed(r, g, b) {
  const [h, s, v] = paintHsv(r, g, b);
  return s >= 0.5 && (h <= 14 || h >= 340) && v >= 0.3;
}

/**
 * Краска бордюров в листе тротуара: `{ mask, painted }`, где в `mask`
 * 1 — жёлтая полоса (разметка: следует настройкам жёлтых линий), 2 —
 * красная (запрет стоянки: всегда как в игре). Полосы — как у линий
 * асфальта: точки и завитки краской не считаются.
 */
export function roadKerbPaintMask(original, width, height) {
  const yellow = new Uint8Array(width * height);
  const red = new Uint8Array(width * height);
  for (let index = 0, at = 0; index < yellow.length; index += 1, at += 4) {
    if (original[at + 3] < 128) continue;
    if (roadLineKind(original[at], original[at + 1], original[at + 2], 2) === "yellow") yellow[index] = 1;
    else if (kerbRed(original[at], original[at + 1], original[at + 2])) red[index] = 1;
  }
  const yellows = keepLongStripes(yellow, width, height);
  const reds = keepLongStripes(red, width, height);
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) mask[index] = yellow[index] ? 1 : red[index] ? 2 : 0;
  return { mask, painted: yellows + reds >= mask.length * 0.005, yellow: yellows >= mask.length * 0.005 };
}

/** Яркость части поверх облика (100 % — как есть). */
export function roadBrightnessPixels(rgba, brightness) {
  const k = Number(brightness) / 100;
  if (!(k > 0) || k === 1) return rgba;
  const out = new Uint8ClampedArray(rgba);
  for (let at = 0; at < out.length; at += 4) {
    out[at] = out[at] * k;
    out[at + 1] = out[at + 1] * k;
    out[at + 2] = out[at + 2] * k;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Лист целиком: облик работы по части листа — одна арифметика у кадра
 * мастерской и у установщика, поэтому в игре ровно то, что было в кадре
 * ------------------------------------------------------------------ */

/* Плитка узора и градиента части, текселей. */
export const ROAD_FINISH_TILE = 256;

/* Средняя светлота видимых текселей листа: опора облика (накладки — без прозрачного). */
function sheetMean(rgba) {
  let sum = 0;
  let count = 0;
  for (let at = 0; at < rgba.length; at += 4 * 3) {
    if (rgba[at + 3] < 128) continue;
    sum += (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
    count += 1;
  }
  return Math.max(0.04, count ? sum / count : 0.4);
}

/**
 * Накладка — лист с прозрачным (полосы разметки загородных дорог, трещины,
 * пятна): больше 5 % текселей прозрачнее половины. Сплошной асфальт —
 * DXT1 без прозрачного.
 */
export function roadSheetIsOverlay(rgba) {
  let clear = 0;
  let count = 0;
  for (let at = 3; at < rgba.length; at += 4 * 3) {
    count += 1;
    if (rgba[at] < 128) clear += 1;
  }
  return count > 0 && clear / count > 0.05;
}

/**
 * Источник отделки части: плитка узора или градиента, своя картинка
 * (`image` — `{ rgba, width, height }`) или `null`.
 */
export function roadFinishSource(surface, image = null) {
  if (surface?.mode === "pattern") return { kind: "tile", size: ROAD_FINISH_TILE, rgba: patternTile(surface.pattern, ROAD_FINISH_TILE) };
  if (surface?.mode === "gradient") return { kind: "tile", size: ROAD_FINISH_TILE, rgba: gradientTile(surface.gradient, ROAD_FINISH_TILE), clamp: true };
  if (surface?.mode === "image" && image?.rgba) {
    const spec = normalizeFinishImage(surface.image);
    return { kind: "image", rgba: tintImagePixels(image.rgba, spec), width: image.width, height: image.height, wrap: spec.fit === "tile" };
  }
  return null;
}

function sampleSource(source, s, t) {
  if (source.kind === "tile") {
    const u = source.clamp ? Math.min(0.999, Math.max(0, s)) : s;
    const v = source.clamp ? Math.min(0.999, Math.max(0, t)) : t;
    return sampleTile(source.rgba, source.size, u, v);
  }
  return sampleImage(source.rgba, source.width, source.height, s, 1 - t, source.wrap);
}

/**
 * Облик части в пикселях листа `rgba` (`width × height`): свой цвет и эффект
 * — зерно и светотень листа относительно его средней светлоты (выбранный цвет
 * — средний цвет покрытия, у листа вблизи и у его дальнего плана один);
 * «Без текстуры» — ровный цвет; узор, градиент и своя картинка — плиткой по
 * листу со светотенью листа (`shade`). Поверх — яркость части. Альфа —
 * листа.
 */
export function roadSurfacePixels(rgba, width, height, surface, source = null) {
  if (!surface || surface.mode === "standard") return roadBrightnessPixels(new Uint8ClampedArray(rgba), surface?.brightness ?? 100);
  const out = new Uint8ClampedArray(rgba.length);
  const mean = sheetMean(rgba);
  const look = normalizeColourEffect(surface.look);
  const flat = surface.mode === "flat" ? hexBytes(look.colour) : null;
  const solid = surface.mode === "colour" && look.mode === "solid" ? hexBytes(look.colour) : null;
  const finish = surface.mode === "pattern" || surface.mode === "image" || surface.mode === "gradient";
  const repeats = finish ? finishRepeats(surface) : 1;
  const share = (Number(surface.shade ?? 70) || 0) / 100;
  const bright = (Number(surface.brightness) || 100) / 100;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const r = rgba[at];
      const g = rgba[at + 1];
      const b = rgba[at + 2];
      const k = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 / mean;
      /* Цвет тексела — тремя числами, а не массивом на каждый тексель (04.11.2026: в профиле сборки «Дорог» это сборщик мусора и треть времени листа). */
      let cr;
      let cg;
      let cb;
      if (flat) {
        cr = flat[0];
        cg = flat[1];
        cb = flat[2];
      } else if (surface.mode === "colour") {
        let base = solid;
        if (!base) {
          const u = (x + 0.5) / width;
          const v = (y + 0.5) / height;
          const t = look.direction === "across" ? v : look.direction === "height" ? 1 - v : u;
          base = colourEffectAt(look, look.mode === "line" ? (t * 6) % 1 : t);
        }
        const f = Math.min(2.2, k);
        cr = base[0] * f;
        cg = base[1] * f;
        cb = base[2] * f;
      } else if (finish && source) {
        const sample = sampleSource(source, ((x + 0.5) / width) * repeats, ((y + 0.5) / height) * repeats);
        const f = 1 + (Math.min(1.6, k) - 1) * share;
        cr = sample[0] * f;
        cg = sample[1] * f;
        cb = sample[2] * f;
      } else {
        cr = r;
        cg = g;
        cb = b;
      }
      out[at] = cr * bright;
      out[at + 1] = cg * bright;
      out[at + 2] = cb * bright;
      out[at + 3] = rgba[at + 3];
    }
  return out;
}

/*
 * «Скрыть разметку» на сплошном листе асфальта: линия закрашивается тем же
 * асфальтом со стороны — у вертикальной линии сдвигом вбок на её ширину, у
 * поперечной — вдоль. Лист повторяется по дороге, поэтому сдвиг идёт по
 * кругу листа. Зерно асфальта на месте линии — настоящее, не пятно.
 */
export function inpaintRoadLines(base, mask, width, height) {
  const out = new Uint8ClampedArray(base);
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const members = [];
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (top) {
      const index = stack[--top];
      members.push(index);
      const x = index % width;
      const y = (index - x) / width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      /* Соседи слева, справа, сверху, снизу — без массива на каждый тексель (04.11.2026, профиль сборки «Дорог»). */
      if (x > 0 && mask[index - 1] && !seen[index - 1]) {
        seen[index - 1] = 1;
        stack[top++] = index - 1;
      }
      if (x < width - 1 && mask[index + 1] && !seen[index + 1]) {
        seen[index + 1] = 1;
        stack[top++] = index + 1;
      }
      if (y > 0 && mask[index - width] && !seen[index - width]) {
        seen[index - width] = 1;
        stack[top++] = index - width;
      }
      if (y < height - 1 && mask[index + width] && !seen[index + width]) {
        seen[index + width] = 1;
        stack[top++] = index + width;
      }
    }
    const vertical = maxY - minY >= maxX - minX;
    const span = vertical ? maxX - minX + 3 : maxY - minY + 3;
    for (const index of members) {
      const x = index % width;
      const y = (index - x) / width;
      let from = -1;
      for (const sign of [1, -1]) {
        const sx = vertical ? (((x + sign * span) % width) + width) % width : x;
        const sy = vertical ? y : (((y + sign * span) % height) + height) % height;
        const candidate = sy * width + sx;
        if (!mask[candidate]) {
          from = candidate;
          break;
        }
      }
      if (from < 0) continue;
      out[index * 4] = base[from * 4];
      out[index * 4 + 1] = base[from * 4 + 1];
      out[index * 4 + 2] = base[from * 4 + 2];
    }
  }
  return out;
}

/*
 * Накладка в асфальте (полосы разметки с альфой, трещины, пятна): краска
 * получает облик своей группы (или прозрачность у «Скрыть»), остальное —
 * облик асфальта.
 */
function roadOverlayPixels(rgba, width, height, surface, markings, source, surfaceStock, paint) {
  const recoloured = surfaceStock ? null : roadSurfacePixels(rgba, width, height, surface, source);
  const states = markingStates(markings);
  const out = new Uint8ClampedArray(rgba);
  for (let index = 0, at = 0; index < width * height; index += 1, at += 4) {
    if (rgba[at + 3] === 0) continue;
    const group = paint ? paint.groups[index] : 0;
    if (group) {
      if (states[group - 1].hidden) out[at + 3] = 0;
      else paintAt(out, rgba, at, states[group - 1]);
    } else if (recoloured) {
      out[at] = recoloured[at];
      out[at + 1] = recoloured[at + 1];
      out[at + 2] = recoloured[at + 2];
    }
  }
  return out;
}

/*
 * Тротуар с бордюром: жёлтая полоса на бордюре — жёлтая краска (группа
 * «Осевая»: её цвет и яркость; у «Скрыть» — облик бордюра), красная краска
 * запрета стоянки — как в игре, остальное — облик тротуара.
 */
function roadSidewalkPixels(rgba, width, height, surface, markings, source, surfaceStock) {
  const yellowStock = groupIsStock(markings, "center");
  if (surfaceStock && yellowStock) return null;
  const paint = roadKerbPaintMask(rgba, width, height);
  if (surfaceStock && !paint.yellow) return null;
  const base = surfaceStock ? new Uint8ClampedArray(rgba) : roadSurfacePixels(rgba, width, height, surface, source);
  if (!paint.painted) return base;
  const centre = markingState(markings, "center");
  const hide = new Uint8Array(paint.mask.length);
  let hidden = false;
  for (let index = 0, at = 0; index < paint.mask.length; index += 1, at += 4) {
    const kind = paint.mask[index];
    if (kind === 2) {
      base[at] = rgba[at];
      base[at + 1] = rgba[at + 1];
      base[at + 2] = rgba[at + 2];
    } else if (kind === 1) {
      if (centre.hidden) {
        hide[index] = 1;
        hidden = true;
      } else paintAt(base, rgba, at, centre);
    }
  }
  return hidden ? inpaintRoadLines(base, hide, width, height) : base;
}

/* Маска групп, что меняет разметка работы (внутренняя: настройки уже нормализованы). */
const changedGroupMask = (markings) => ROAD_MARKING_GROUPS.reduce((mask, group) => (groupIsStock(markings, group.id) ? mask : mask | ROAD_GROUP_BITS[group.id]), 0);

/**
 * Новые пиксели листа части `part` (`asphalt`, `dirt`, `sidewalk`,
 * `markings`) по работе или `null` — лист как в игре. `project` —
 * нормализованная работа (`normalizeRoadsProject`), `source` — источник
 * отделки части (`roadFinishSource`), `kind` и `lod` — из `roadTextureFamily`
 * листа. Асфальт держит свою краску (трассы, переходы, дальние планы): она
 * получает облик своей группы, а не цвет дороги, у «Скрыть» — закрашивается
 * асфальтом рядом.
 */
export function roadSheetPixels(rgba, width, height, part, project, { source = null, kind = null, lod = false } = {}) {
  const markings = project.markings;
  const marksStock = roadMarkingsAreStock(markings);
  const mask = changedGroupMask(markings);
  if (part === "markings") {
    if (marksStock) return null;
    const paint = roadPaintGroups(rgba, width, height, { part, kind, lod });
    return paint.present & mask ? roadMarkingsPixels(rgba, width, height, markings, { groups: paint.groups }) : null;
  }
  const surface = project.parts[part];
  if (!surface) return null;
  const surfaceStock = roadSurfaceIsStock(surface);
  if (part === "sidewalk") return roadSidewalkPixels(rgba, width, height, surface, markings, source, surfaceStock);
  if (part !== "asphalt") return surfaceStock ? null : roadSurfacePixels(rgba, width, height, surface, source);
  if (surfaceStock && marksStock) return null;
  const paint = roadPaintGroups(rgba, width, height, { part, kind, lod });
  if (roadSheetIsOverlay(rgba)) return paint.painted || !surfaceStock ? roadOverlayPixels(rgba, width, height, surface, markings, source, surfaceStock, paint) : null;
  if (!paint.painted) return surfaceStock ? null : roadSurfacePixels(rgba, width, height, surface, source);
  /* Асфальт как в игре, а правка разметки этих групп не касается — лист не меняется. */
  if (surfaceStock && !(paint.present & mask)) return null;
  const base = surfaceStock ? new Uint8ClampedArray(rgba) : roadSurfacePixels(rgba, width, height, surface, source);
  const states = markingStates(markings);
  const hide = new Uint8Array(width * height);
  let hidden = false;
  for (let index = 0, at = 0; index < hide.length; index += 1, at += 4) {
    const group = paint.groups[index];
    if (!group) continue;
    if (states[group - 1].hidden) {
      hide[index] = 1;
      hidden = true;
    } else paintAt(base, rgba, at, states[group - 1]);
  }
  return hidden ? inpaintRoadLines(base, hide, width, height) : base;
}

/**
 * Облик работы числами — всё, что `roadSheetPixels` берёт у работы, без её нормализации и шаблонов: для сборки вне JS (команда движка
 * `roads-build`, крейт `astral-recolor`, 14.11.2026). Арифметика листа там повторена байт в байт, а что работа значит — решается только
 * здесь, поэтому числа считаются тем же кодом, что у `roadSurfacePixels` и `paintAt`:
 *
 *   parts[часть] — `stock` (часть как в игре), `mode` (`standard`, `colour`, `flat`, `finish` — узор, градиент или своя картинка),
 *     `standardK` (множитель «Стандарта»), `colour` (байты ровного цвета или `null`), `repeats` (повторов плитки на лист),
 *     `share` (доля светотени листа под плиткой), `bright` (яркость части);
 *   markings — `stock`, `mask` (группы, что работа меняет) и `groups` по порядку `ROAD_GROUP_IDS`: `stock`, `hidden`, `colour`
 *     (байты или `null`), `bright`, `wear`.
 *
 * `null` — у работы есть облик, которого движок не считает: свой цвет с эффектом (градиент, радуга, перелив, линия — там синус и своя
 * развёртка по листу). Такую работу сборка ведёт прежним кодом на JS.
 */
export function roadsEngineLook(input) {
  const project = normalizeRoadsProject(input);
  const parts = {};
  for (const id of ROAD_PART_IDS) {
    const surface = project.parts[id];
    const look = normalizeColourEffect(surface.look);
    if (surface.mode === "colour" && look.mode !== "solid") return null;
    const finish = surface.mode === "pattern" || surface.mode === "image" || surface.mode === "gradient";
    parts[id] = {
      stock: roadSurfaceIsStock(surface),
      mode: finish ? "finish" : surface.mode,
      standardK: Number(surface.brightness ?? 100) / 100,
      colour: surface.mode === "flat" || surface.mode === "colour" ? hexBytes(look.colour) : null,
      repeats: finish ? finishRepeats(surface) : 1,
      share: (Number(surface.shade ?? 70) || 0) / 100,
      bright: (Number(surface.brightness) || 100) / 100,
    };
  }
  const markings = project.markings;
  return {
    parts,
    markings: {
      stock: roadMarkingsAreStock(markings),
      mask: changedGroupMask(markings),
      groups: ROAD_MARKING_GROUPS.map((group) => ({ stock: groupIsStock(markings, group.id), ...markingState(markings, group.id) })),
    },
  };
}

/**
 * Какие части листов меняет работа: `parts` — `Set` из `asphalt`, `dirt`,
 * `sidewalk`, `markings`; `groups` — маска групп разметки, что меняются
 * (`ROAD_GROUP_BITS`); `lines` — меняется ли разметка вообще (листы асфальта
 * с краской собираются и тогда, когда сам асфальт как в игре).
 */
export function roadsChangedParts(input) {
  const project = normalizeRoadsProject(input);
  const parts = new Set(ROAD_PART_IDS.filter((id) => !roadSurfaceIsStock(project.parts[id])));
  const groups = changedGroupMask(project.markings);
  if (groups) parts.add("markings");
  return { parts, lines: groups !== 0, groups };
}

/**
 * Нужен ли словарь описи работе: его листы — `[имя, часть, дальний, линии,
 * группы]` (`линии` — у асфальта нарисованы линии, у тротуара — жёлтая краска
 * бордюра; `группы` — маска групп краски на листе). Лист меняется, если
 * изменилась его часть или группа краски, что на нём есть; у описи без
 * масок (прежней) краска листа — любая группа.
 */
export function roadsDictionaryWanted(textures, changed) {
  return textures.some(([, part, , lines, groups]) => {
    if (part !== "markings" && changed.parts.has(part)) return true;
    if (!changed.groups && !changed.lines) return false;
    const onSheet = Number.isInteger(groups) ? groups : part === "markings" || lines ? ROAD_GROUP_ALL : 0;
    const wanted = changed.groups || ROAD_GROUP_ALL;
    return (part === "markings" || part === "asphalt" || part === "sidewalk") && (onSheet & wanted) !== 0;
  });
}
