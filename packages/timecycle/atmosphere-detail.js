/*
 * Атмосфера подробно (21.11.2026): все пункты тумана, дымки, лучей и объёмного света одной ТАБЛИЦЕЙ.
 *
 * Окно (`AtmosphereDetail.jsx`) собирает группы и органы из этой таблицы, запись в файлы погоды (`applyAtmosphereDetail`) идёт
 * по ней же: добавить пункт — добавить строку, вёрстка и запись не меняются. Что в строке:
 *
 *   id, group     — имя пункта и группа (`ATMOSPHERE_DETAIL_GROUPS`); порядок строк — порядок в окне;
 *   label, aria   — подпись для tr() (ключ словаря `zone-sky-atmos-detail-2111.js`), aria — подпись ползунка для читалки, если отличается;
 *   kind          — `number` (ползунок) или `colour` (ряд цветов, только у прежних ручек цвета);
 *   mode          — как число ложится на кривые игры по часам:
 *                     `scale` — умножает число игры в каждом часу (форма суток остаётся игровой, 1 — «как в игре»; где у игры ноль — ноль остаётся);
 *                     `add`   — прибавляет к числу игры (0 — «как в игре»);
 *                     `set`   — ставит своё число во все подходящие часы (`null` — «как в игре»);
 *   legacy        — пункт живёт в прежнем поле атмосферы (`atmosphere.haze`, …), а не в `atmosphere.detail`; пишет его `look-apply.js`;
 *   unit, min, max, step, default, rest — единица, границы ползунка, шаг, значение «как в игре», где стоит бегунок при «как в игре» (`set`);
 *   fields        — какие поля w_*.xml пишет пункт (у цвета — имена без `_r/_g/_b`); cap — поля, которым значение служит потолком;
 *   hours         — на какие срезы ложится: `all` (все 13), `night` (ночные срезы и вечная ночь), `day` (остальные);
 *   out           — жёсткие границы РЕЗУЛЬТАТА (после множителя): число в файле не выйдет за них, как бы ни стоял ползунок;
 *   game          — числа самой игры по этим полям: наименьшее и наибольшее по 12 файлам w_*.xml чистого update.rpf, 312 срезов (замер 21.11.2026);
 *   proven        — действие пункта прочитано или замерено в игре (docs/GAME-OPTIMIZATION.md, TIMECYCLE-SKY.md, замеры 06.10 и 21.11);
 *   basis, note   — откуда взят предел: `game` (значения или пределы игры), `formula` (из формулы), `estimate` (запас от чисел игры,
 *                   проверить на стенде) — и пояснение словами.
 *
 * Правило безопасных границ (слово владельца 21.11.2026: «никаких ступеней и полос, крайние значения не дают брака»): пункт, у которого
 * настоящее число игры разное по 17 погодам и 13 часам, только УМНОЖАЕТ число игры на ограниченный коэффициент, а не ставит своё, и результат
 * не выходит за числа самой игры (`out` обнимает `game`: ползунок не подаёт в файл то, чего игра сама не держит). Своё число ставят только там,
 * где его смысл известен и предел — из игры или формулы (дальность прорисовки, начало и дно тумана).
 *
 * Нейтральность: значение «как в игре» не хранится вовсе — пустые детали ничего не пишут. Разбор идемпотентен, мусор уходит в границы.
 *
 * Не вошло (по замеру 21.11): `fog_shape_*` — у игры верх и низ слоя равны нулю в каждом из 312 срезов, веса 0…1 неизменны, логарифм видимости
 * равен 5 везде: Legacy их не читает, множитель на ноль ничего бы не сделал. `fog_cut_off` = 1, `fog_sun_lighting_calc_pow` = 8, `fogray_contrast` = 1,
 * `fogvolume_density_scalar_interior` = 1 неизменны по всем файлам — ручки на них двигают число, которого игра не меняет сама; их действие — на стенде.
 */

/** Группы подробного уровня, в порядке окна. */
export const ATMOSPHERE_DETAIL_GROUPS = Object.freeze(
  [
    {
      id: "fog",
      label: "Дальний туман",
      hint: "Где начинается туман, насколько он непрозрачен и как светится.",
    },
    {
      id: "colour",
      label: "Цвет тумана",
      hint: "Оттенок ночью и у горизонта. Яркость каждого часа остаётся из игры.",
    },
    {
      id: "haze",
      label: "Дымка вдали",
      hint: "Дымка ложится на фон за пределом прорисовки.",
    },
    {
      id: "shadow",
      label: "Тени тумана",
      hint: "Насколько туман темнеет в тени и на какой высоте это начинается.",
    },
    {
      id: "rays",
      label: "Лучи света",
      hint: "Лучи в тумане идут всегда. Длина и дальность лучей солнца видны при включённых бликах от солнца.",
    },
    {
      id: "volume",
      label: "Объёмный свет",
      hint: "Свет фонарей и фар в тумане игра считает только в сумерках и ночью: днём он остаётся выключенным.",
    },
    {
      id: "range",
      label: "Дальность прорисовки",
      hint: "Дальше предела мир не рисуется. Если даль закрыта туманом, края мира не видно.",
    },
  ].map((group) => Object.freeze(group)),
);

/* Ряды цветов тумана (прежние ручки «цвет ночью» и «цвет у горизонта»). */
const NIGHT_COLOUR_SWATCHES = Object.freeze([
  null,
  "#1c2024",
  "#161422",
  "#2a1d10",
  "#1a0a2a",
  "#0a1a2a",
]);
const HORIZON_COLOUR_SWATCHES = Object.freeze([
  null,
  "#b8bdc3",
  "#f0e6d8",
  "#d98a6a",
  "#6ad9c0",
  "#dba463",
  "#f4f5f7",
]);

/* Значение «как в игре» по способу записи. */
const DEFAULT_OF = Object.freeze({ scale: 1, add: 0, set: null });

/**
 * Во сколько раз туман у земли плотнее на дне слоя, чем на нём: плотность растёт как e^(спад/1000 · (дно − высота)), поэтому дно не выше
 * ПОТОЛОК / спад. 2000 — рост до e² ≈ 7,4 раза. У живых погод игры рост не выше ×1,65 (дно 50 м при спаде 10); единственное исключение —
 * один срез NEUTRAL (спад 65, дно 146 м: ×13 000), это дефект служебной погоды, на него не равняемся.
 */
export const ATMOSPHERE_BASE_HEIGHT_BOOST = 2000;

/** Самое высокое дно слоя (метры) при данном спаде тумана; спад не задан или нулевой — без потолка. */
export function atmosphereBaseHeightCeiling(falloff) {
  return Number.isFinite(falloff) && falloff > 0
    ? ATMOSPHERE_BASE_HEIGHT_BOOST / falloff
    : Infinity;
}

/** Одна строка таблицы с умолчаниями; лишнее не выдумывается, недостающее — строгое. */
function row(id, group, label, spec) {
  const mode = spec.mode;
  return Object.freeze({
    id,
    group,
    label,
    aria: null,
    kind: "number",
    legacy: null,
    unit: "percent",
    step: 0.05,
    default: DEFAULT_OF[mode],
    rest: null,
    hours: "all",
    out: null,
    swatches: null,
    proven: false,
    ...spec,
    fields: Object.freeze([...spec.fields]),
    cap: Object.freeze([...(spec.cap || [])]),
    game: Object.freeze({ ...spec.game }),
  });
}

const SAFE_SHARE = Object.freeze({ min: 0, max: 1 });

/**
 * Таблица пунктов. Прежние ручки (`legacy`) стоят здесь же, чтобы окно рисовало ВСЁ из одного места;
 * их границы повторяют `ATMOSPHERE_LIMITS` (тест держит их равными: файл не импортирует `atmosphere.js`, чтобы не было круга).
 */
export const ATMOSPHERE_DETAIL_ROWS = Object.freeze([
  /* --- Дальний туман --- */
  row("start", "fog", "Начало тумана", {
    mode: "set",
    legacy: "start",
    unit: "metre",
    min: 0,
    max: 3000,
    step: 10,
    rest: 0,
    fields: ["fog_start"],
    game: { min: -50, max: 73 },
    proven: true,
    basis: "formula",
    note: "У игры −50…73 м (в 278 срезах из 312 — 0). Предел 3000 — ATMOSPHERE_LIMITS.start: при видимости не меньше начала плюс 20 м плотность 23000/(видимость − начало) остаётся конечной.",
  }),
  row("baseHeight", "fog", "Дно слоя", {
    mode: "set",
    legacy: "baseHeight",
    unit: "metre",
    min: -100,
    max: 1000,
    step: 5,
    rest: 0,
    fields: ["fog_base_height"],
    game: { min: 0, max: 146 },
    proven: true,
    basis: "formula",
    note: "У игры 0…146 м (в 290 срезах из 312 — 0). Туман у земли растёт как e^(спад/1000 · дно): дно не выше 2000/спад (рост не более e² ≈ 7,4 раза), иначе у земли белая стена — см. atmosphereBaseHeightCeiling. Ниже −100 на карте ничего нет.",
  }),
  row("alpha", "fog", "Непрозрачность тумана", {
    mode: "scale",
    min: 0,
    max: 1,
    step: 0.01,
    fields: ["fog_alpha"],
    out: SAFE_SHARE,
    game: { min: 0.6475, max: 1 },
    proven: true,
    basis: "game",
    note: "fog_alpha — доля 0…1 (RANGE_TABLE в parameters.js), у игры 0,65…1; множитель не больше 1 и результат зажат в 0…1: ручка только прозрачнит туман, плотнее игры не делает.",
  }),
  row("horizonTint", "fog", "Подкраска горизонта", {
    mode: "scale",
    min: 0,
    max: 2,
    fields: ["fog_horizon_tint_scale"],
    out: Object.freeze({ min: 0, max: 32 }),
    game: { min: 0.3997, max: 31.5938 },
    basis: "game",
    note: "У игры 0,4…31,6 по часам (ночью и в дымке много выше, чем днём). Результат не выше 32 — самого большого числа игры: ручка не уходит дальше того, что игра сама кладёт на горизонт.",
  }),
  row("fogBrightness", "fog", "Яркость тумана", {
    mode: "scale",
    min: 0.25,
    max: 2,
    fields: ["fog_hdr", "fog_haze_hdr"],
    out: Object.freeze({ min: 0, max: 40 }),
    game: { min: 0, max: 40 },
    proven: true,
    basis: "formula",
    note: "У игры fog_hdr 0,02…35,4, fog_haze_hdr 0…40; результат не выше 40. Тон-кривая 1 − e^(−2,81·x) (замер 06.10): выше ×2 туман вылетает в белое, ниже ×0,25 уходит в чёрное. Туман и дымка идут вместе: у дымки свой множитель яркости, и на краю дальности иначе выходит полоса (GAME-OPTIMIZATION.md).",
  }),
  row("sunGlow", "fog", "Острота пятна у солнца", {
    mode: "scale",
    min: 0.5,
    max: 2,
    fields: ["fog_sun_lighting_calc_pow"],
    hours: "day",
    out: Object.freeze({ min: 0.5 }),
    game: { min: 8, max: 8 },
    proven: true,
    basis: "formula",
    note: "У игры 8 во всех срезах (замер 21.11). Степень пятна тумана у солнца, как у зарева луны: результат не меньше 0,5 (HALO_POWER_MIN, замер 21.11), иначе пятно растекается на всё небо белой стеной; от ×0,5 до ×2 это 4…16.",
  }),

  /* --- Цвет тумана (ряды цветов; основной цвет — в простом уровне) --- */
  row("nightColour", "colour", "Цвет ночью", {
    kind: "colour",
    mode: "set",
    legacy: "nightColour",
    unit: "colour",
    min: 0,
    max: 1,
    step: 1,
    fields: ["fog_col", "fog_near_col", "fog_east_col"],
    hours: "night",
    swatches: NIGHT_COLOUR_SWATCHES,
    game: { min: 0, max: 1 },
    proven: true,
    basis: "formula",
    note: "Цвет красится оттенком с яркостью часа из файла (recolour в look-apply.js): ни чёрного экрана, ни белой стены, яркость остаётся игровой.",
  }),
  row("horizonColour", "colour", "Цвет у горизонта", {
    kind: "colour",
    mode: "set",
    legacy: "horizonColour",
    unit: "colour",
    min: 0,
    max: 1,
    step: 1,
    fields: ["fog_haze_col", "fog_east_col"],
    swatches: HORIZON_COLOUR_SWATCHES,
    game: { min: 0, max: 1 },
    proven: true,
    basis: "formula",
    note: "Дымка вдали и туман у солнца; красится так же, как основной цвет: оттенок с яркостью часа.",
  }),

  /* --- Дымка вдали --- */
  row("haze", "haze", "Дымка вдали", {
    mode: "scale",
    legacy: "haze",
    aria: "Дымка вдали: сила",
    min: 0,
    max: 4,
    fields: ["fog_haze_density"],
    game: { min: 0, max: 1000 },
    proven: true,
    basis: "game",
    note: "ATMOSPHERE_LIMITS.haze: до ×4 от числа игры. У игры 4…21 (у одного среза NEUTRAL — 1000, служебная погода); ×4 от 21 — 84, порядок игры.",
  }),
  row("hazeAlpha", "haze", "Непрозрачность дымки", {
    mode: "scale",
    min: 0,
    max: 1,
    step: 0.01,
    fields: ["fog_haze_alpha"],
    out: SAFE_SHARE,
    game: { min: 0.396, max: 1 },
    basis: "game",
    note: "fog_haze_alpha — доля 0…1 (у игры 0,4…1), как fog_alpha: множитель не больше 1, результат зажат в 0…1.",
  }),
  row("hazeStart", "haze", "Начало дымки", {
    mode: "scale",
    min: 0.25,
    max: 4,
    fields: ["fog_haze_start"],
    out: Object.freeze({ min: 0, max: 2000 }),
    game: { min: 0, max: 2000 },
    basis: "game",
    note: "У игры 0…2000 м, но в 293 срезах из 312 — 0 (дымка с самого начала): множитель двигает только там, где игра сама задала начало; ноль остаётся нулём. Результат не выше 2000 — самого большого числа игры.",
  }),

  /* --- Тени тумана --- */
  row("shadowAmount", "shadow", "Тень в тумане", {
    mode: "scale",
    min: 0,
    max: 1.5,
    fields: ["fog_shadow_amount"],
    out: SAFE_SHARE,
    game: { min: 0, max: 1 },
    basis: "game",
    note: "Доля 0…1 (у игры в дождь и грозу — 0, в ясные до 0,99): множитель до ×1,5, результат зажат в 0…1; где игра тень выключила, она остаётся выключенной.",
  }),
  row("shadowFalloff", "shadow", "Спад тени тумана", {
    mode: "scale",
    min: 0.25,
    max: 4,
    fields: ["fog_shadow_falloff"],
    out: Object.freeze({ min: 1, max: 1000 }),
    game: { min: 1, max: 800 },
    basis: "game",
    note: "У игры 1…800. Результат в пределах 1…1000: меньше единицы игра не держит (нулевой спад у тумана гасит его, замер 06.10).",
  }),
  row("shadowBase", "shadow", "Высота тени тумана", {
    mode: "add",
    unit: "metre-offset",
    min: -100,
    max: 200,
    step: 5,
    fields: ["fog_shadow_base_height"],
    out: Object.freeze({ min: 0, max: 300 }),
    game: { min: 0, max: 100 },
    basis: "game",
    note: "Метры к высоте игры (у игры 0…100, в 304 срезах из 312 — 0). Результат в пределах 0…300 м: ниже нуля у игры не бывает, выше — слой тени ушёл бы над городом.",
  }),

  /* --- Лучи света --- */
  row("rays", "rays", "Лучи света", {
    mode: "scale",
    legacy: "rays",
    aria: "Лучи света: сила",
    min: 0,
    max: 4,
    fields: ["fogray_intensity", "light_ray_mult"],
    game: { min: 0, max: 32 },
    proven: true,
    basis: "game",
    note: "ATMOSPHERE_LIMITS.rays: до ×4. У игры fogray_intensity 0…1, light_ray_mult 0…32; light_ray_mult обнуляется, пока блики от солнца выключены (SUN_GLARE_PARAMETERS), fogray_intensity идёт всегда.",
  }),
  row("rayDensity", "rays", "Густота лучей", {
    mode: "scale",
    min: 0,
    max: 2,
    fields: ["fogray_density"],
    out: Object.freeze({ min: 0, max: 2 }),
    game: { min: 0.8979, max: 1 },
    basis: "game",
    note: "У игры 0,9…1: единица-мера. До ×2, ноль — лучей в тумане нет. Действие проверить на стенде.",
  }),
  row("rayContrast", "rays", "Контраст лучей", {
    mode: "scale",
    min: 0.5,
    max: 2,
    fields: ["fogray_contrast"],
    out: Object.freeze({ min: 0.25, max: 3 }),
    game: { min: 1, max: 1 },
    basis: "estimate",
    note: "У игры 1 во всех срезах: вдвое в обе стороны вокруг числа игры — запас, где контраст ещё не выжигает лучи. Действие проверить на стенде.",
  }),
  row("rayRange", "rays", "Дальность лучей в тумане", {
    mode: "scale",
    min: 0.25,
    max: 3,
    fields: ["fogray_nearfade", "fogray_farfade"],
    out: Object.freeze({ min: 0, max: 600 }),
    game: { min: 0, max: 200 },
    basis: "game",
    note: "У игры ближнее затухание 0…10 м, дальнее 1…200 м. Оба идут одним множителем: порядок «ближнее раньше дальнего» не нарушается. Результат не выше 600 м. Действие проверить на стенде.",
  }),
  row("rayLength", "rays", "Длина лучей солнца", {
    mode: "scale",
    min: 0.25,
    max: 2,
    fields: ["light_ray_length"],
    out: Object.freeze({ min: 2, max: 20 }),
    game: { min: 7, max: 20 },
    basis: "game",
    note: "У игры 7…20 (нуля нет). Результат в пределах 2…20 — самое большое число игры. Видно только при включённых бликах от солнца: иначе light_ray_mult обнулён (SUN_GLARE_PARAMETERS).",
  }),
  row("rayDistance", "rays", "Дальность лучей солнца", {
    mode: "scale",
    min: 0.25,
    max: 2,
    fields: ["light_ray_dist"],
    out: Object.freeze({ min: 10, max: 430 }),
    game: { min: 20, max: 430 },
    basis: "game",
    note: "У игры 20…430. Результат в пределах 10…430 — самое большое число игры. Видно только при включённых бликах от солнца.",
  }),

  /* --- Объёмный свет --- */
  row("lamps", "volume", "Свет фонарей", {
    mode: "scale",
    legacy: "lamps",
    aria: "Свет фонарей: сила",
    min: 0,
    max: 6,
    fields: ["fog_volume_light_intensity", "fogvolume_density_scalar"],
    game: { min: 0, max: 10 },
    proven: true,
    basis: "game",
    note: "ATMOSPHERE_LIMITS.lamps: до ×6. У игры fog_volume_light_intensity 0…0,025, fogvolume_density_scalar 0…10; днём у игры ноль, от нуля множитель ничего не даёт — и не должен.",
  }),
  row("volRange", "volume", "Дальность света фонарей", {
    mode: "scale",
    min: 0.25,
    max: 2,
    fields: ["fog_volume_light_range"],
    out: Object.freeze({ min: 5, max: 260 }),
    game: { min: 25, max: 130 },
    basis: "game",
    note: "У игры 25…130 (нуля нет). До ×2 от числа игры, результат не меньше 5: луч нулевой длины мерцал бы. Действие проверить на стенде.",
  }),
  row("volSize", "volume", "Размер светового пятна", {
    mode: "scale",
    min: 0.25,
    max: 3,
    fields: ["fog_volume_light_size"],
    out: SAFE_SHARE,
    game: { min: 0, max: 1 },
    basis: "game",
    note: "У игры 0…1 (днём 0 — остаётся 0). Результат зажат в 0…1: больше единицы игра не держит. Действие проверить на стенде.",
  }),
  row("volFade", "volume", "Затухание света", {
    mode: "scale",
    min: 0.25,
    max: 2,
    fields: ["fog_volume_light_fade"],
    out: Object.freeze({ min: 5, max: 200 }),
    game: { min: 25, max: 100 },
    basis: "game",
    note: "У игры 25…100 (нуля нет). До ×2 от числа игры, результат не меньше 5. Действие проверить на стенде.",
  }),
  row("volInterior", "volume", "Свет в помещениях", {
    mode: "scale",
    min: 0,
    max: 2,
    fields: ["fogvolume_density_scalar_interior"],
    out: Object.freeze({ min: 0, max: 2 }),
    game: { min: 1, max: 1 },
    basis: "estimate",
    note: "Плотность объёмного света внутри зданий; у игры 1 во всех срезах, поэтому до ×2 и ноль (без него). Действие проверить на стенде.",
  }),
  row("volFogScaler", "volume", "Связь света с туманом", {
    mode: "scale",
    min: 0,
    max: 2,
    fields: ["fogvolume_fog_scaler"],
    out: Object.freeze({ min: 0, max: 2 }),
    game: { min: 0.8975, max: 1 },
    basis: "estimate",
    note: "Во сколько раз туман усиливает объёмный свет; у игры 0,9…1, поэтому до ×2 и ноль. Действие проверить на стенде.",
  }),

  /* --- Дальность прорисовки --- */
  row("farClip", "range", "Предел прорисовки", {
    mode: "set",
    unit: "metre",
    min: 2000,
    max: 10000,
    step: 100,
    rest: 10000,
    fields: ["far_clip"],
    cap: ["water_reflection_far_clip"],
    out: Object.freeze({ min: 2000, max: 10000 }),
    game: { min: 1500, max: 10000 },
    proven: true,
    basis: "game",
    note: "У игры 10000 м у всех обычных погод, 4500 в части часов XMAS, 1500 у NEUTRAL. Нижний предел 2000 м — число самой игры: так Rockstar режет дальность (ReduceDrawDistance, far_clip 2000). Отражения воды не дальше предела (замер 06.10).",
  }),
]);

const ROWS_BY_ID = new Map(
  ATMOSPHERE_DETAIL_ROWS.map((item) => [item.id, item]),
);
/** Пункты, которые живут в `atmosphere.detail` (прежние ручки — в своих полях). */
const DETAIL_ROWS = Object.freeze(
  ATMOSPHERE_DETAIL_ROWS.filter((item) => !item.legacy),
);
const EPSILON = 1e-9;

export const findAtmosphereDetailRow = (id) => ROWS_BY_ID.get(id) || null;

/** Пункты одной группы, в порядке таблицы. */
export const atmosphereDetailRows = (groupId) =>
  ATMOSPHERE_DETAIL_ROWS.filter((item) => item.group === groupId);

const roundValue = (value) => Math.round(value * 1e6) / 1e6;

/**
 * Детали в границах: не объект — пусто; неизвестный пункт и мусор отбрасываются, число уходит в границы ползунка,
 * «как в игре» (`null`, пусто, значение умолчания) не хранится. Порядок ключей — порядок таблицы, разбор идемпотентен.
 */
export function normalizeAtmosphereDetail(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const item of DETAIL_ROWS) {
    const value = raw[item.id];
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    const bounded = roundValue(Math.min(Math.max(numeric, item.min), item.max));
    if (item.default !== null && Math.abs(bounded - item.default) <= EPSILON)
      continue;
    result[item.id] = bounded;
  }
  return result;
}

/** Значение пункта у атмосферы: число, строка-цвет или `null` («как в игре» у `set`). */
export function atmosphereDetailValue(atmosphere, item) {
  const stored = item.legacy
    ? atmosphere?.[item.legacy]
    : atmosphere?.detail?.[item.id];
  return stored === undefined ? item.default : stored;
}

/**
 * Правка пункта для `setAtmosphere`: прежние ручки — своё поле, остальные — вся карта деталей целиком
 * (`setAtmosphere` сливает поля поверхностно, поэтому карта уходит полной).
 */
export function atmosphereDetailPatch(atmosphere, item, value) {
  if (item.legacy) return { [item.legacy]: value };
  return {
    detail: normalizeAtmosphereDetail({
      ...(atmosphere?.detail || {}),
      [item.id]: value,
    }),
  };
}

const clampOut = (value, out) => {
  if (!out) return value;
  let result = value;
  if (out.min !== undefined) result = Math.max(result, out.min);
  if (out.max !== undefined) result = Math.min(result, out.max);
  return result;
};

/**
 * Запись деталей в один срез рабочей копии региона (`work` — «параметр → 13 чисел»). Пишет только поля своих пунктов и только
 * те, что есть в файле региона; пункт без значения ничего не трогает; где у игры ноль, множитель ноль и оставляет. `night` — ночной
 * срез (или вечная ночь).
 */
export function applyAtmosphereDetail(work, detail, index, night) {
  if (!detail || typeof detail !== "object") return;
  for (const item of DETAIL_ROWS) {
    const value = detail[item.id];
    if (!Number.isFinite(value)) continue;
    if (item.hours === "night" && !night) continue;
    if (item.hours === "day" && night) continue;
    for (const name of item.fields) {
      const curve = work[name];
      if (!Array.isArray(curve) || !Number.isFinite(curve[index])) continue;
      if (item.mode === "scale" && curve[index] === 0) continue;
      const next =
        item.mode === "scale"
          ? curve[index] * value
          : item.mode === "add"
            ? curve[index] + value
            : value;
      curve[index] = clampOut(next, item.out);
    }
    for (const name of item.cap) {
      const curve = work[name];
      if (
        Array.isArray(curve) &&
        Number.isFinite(curve[index]) &&
        curve[index] > value
      )
        curve[index] = value;
    }
  }
}
