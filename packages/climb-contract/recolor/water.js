/*
 * Вода: цвет и прозрачность моря, озёр и рек.
 *
 * Как устроена вода GTA V (исследовано по файлам игры, 03.10.2026):
 *
 *  • ЦВЕТ — туман воды: плитки `x64/textures/waterfog_txds.rpf/
 *    waterfog-N.ytd` в update.rpf, 17×24 плитки по 500 м от (−4000, 8000)
 *    на юго-восток, 256² BC7 с полной цепочкой mip; Кайо-Перико — свои 8×8
 *    `waterfog_h4-N` от (2700, −3150). Их упрощённые копии 128² DXT1 —
 *    `waterfog_txds_dx.rpf/*-dx.ytd`. Тексель — цвет толщи воды в этом
 *    месте: у берега светлее (у Rockstar 50,82,82), на глубине темнее
 *    (1,27,33). Зелёный не ниже 4: ноль у шейдера — «здесь нет воды».
 *  • ПРОЗРАЧНОСТЬ — альфа квадов воды `water.xml` (a1…a4 по углам): чем
 *    она выше, тем гуще вода. Дно видно на 10 % на глубине 2754 / a² м: у
 *    штатных 26 — 4,1 м. Квады с высотой 0 — море (у болота Санкудо альфа
 *    80), выше нуля — озёра: Аламо (30 м), Вайнвуд (196,4), Лэнд-Экт (160,3).
 *
 *  КАК ГЛАДЬ ПОЛУЧАЕТ ЦВЕТ (дизассемблер `d3dcompiler_47` шейдеров
 *  `common.rpf/shaders/win32_40_final`, проверено кадрами стенда 12.10.2026):
 *  `PS_WaterFog` (water.fxc) кладёт в экранный буфер тексель тумана по
 *  мировым XY, альфу квада a и толщу d под гладью; `PS_FogComposite`
 *  (watertex.fxc) смешивает:
 *      T = 2^(−78,433·a²·d)                    — сколько видно дна,
 *      F = туман² · (A + 0,424·w·D)            — свет в толще,
 *      S = дно · lerp(2·туман, 1, 2^(−235,3·a²·|v_z|·d)) — дно в оттенке воды,
 *      итог = T·S + (1 − T)·F,
 *  где туман — тексель в долях (квадрат — переход в линейный свет: тексель
 *  ≈ sRGB-цвет экрана), A — рассеянный свет толщи, D — солнце, w — тень
 *  каскадов. Дальше `PS_Water` мешает это с отражением неба по Френелю.
 *  Поэтому: (1) цвет воды НЕ светится сам — его освещают солнце и небо
 *  таймцикла: днём тексель ≈ цвет экрана, в тени темнее, ночью (и с небом,
 *  где свет почти ноль на всех часах) вода тёмная при любом цвете; (2) у
 *  тёмного текселя квадрат гасит цвет: прежняя глубь «трети яркости» и предел
 *  180 давали глубине 6 % цвета (розовое море становилось бордовым), поэтому
 *  ровный цвет и эффекты по карте кладутся одной яркостью от берега до
 *  глубины, до 255 — глубину темнит сама толща.
 *  • РЕКИ — модели с шейдерами `water_river*` и СВОИМ туманом (текстуры
 *    `…fog` в моделях и словарях рядом, с копиями для LOD): опись —
 *    `inventory/water.js`.
 *  • Дождь и лужи — другие файлы (`puddle_*` в graphics.ytd, частицы
 *    погоды): вода их не трогает. Бассейны и фонтаны — свои шейдеры без
 *    тумана (`water_poolenv`, `water_fountain`): тоже нет.
 *
 *  • ПОД ВОДОЙ — модификаторы таймцикла `underwater`, `underwater_deep`
 *    (ниже 90 м — `DeepWaterModDepth` в watertune) и `underwater_deep_clear`
 *    в `timecycle_mods_1.xml` (update.rpf): туман от самой камеры
 *    (fog_density 100, fog_start 0, дальность 200 м), размытие дальше 5 м
 *    (dof_far, environmental_blur), дрожание (hh_*), шум, виньетка, тёмно-синий
 *    свет и туман; на глубине ещё обесцвечивание, синий сдвиг и искажение
 *    линзы. Сцену под водой туманит общий проход тумана игры
 *    (`PS_DepthEffects` в postfx.fxc — globalFogParams из таймцикла), свет —
 *    `PS_directional_underwater` (каустика без тумана); туман воды из квадов
 *    (`PS_FogComposite` в watertex.fxc) — только сквозь гладь сверху.
 *  • МЕСТНЫЕ ВИДЫ ПОД ВОДОЙ (задача 7 ТЗ 11.10.2026) — коробки модификаторов
 *    в картах игры (`CMapData.timeCycleModifiers`, разобрано по x64*.rpf,
 *    update.rpf и dlcpacks): `WATER_shore` — 523 коробки вдоль всего
 *    побережья (fog_density 400, спад 200 от высоты 2 м: на глубине 6 м
 *    видно ~12 м), `WATER_port` (порт, пирс Дель-Перро), `WATER_silty`
 *    (каналы Веспуччи, молочно-жёлтый туман), `WATER_muddy`, `WATER_river`,
 *    `WATER_salton(_bottom)` (Аламо-Си), `WATER_silverlake`, `WATER_resevoir`,
 *    `WATER_hills`, `WATER_cove`, `WATER_lab`, `WATER_militaryPOOP` — туман
 *    в 3…11 раз гуще открытого моря. Пока Astral пересчитывал только три
 *    общих модификатора, у берега, в порту, каналах, реках и озёрах вода
 *    оставалась мутной при любой прозрачности. Теперь слой «под водой»
 *    пересчитывает и их.
 *  • ПОДВОДНАЯ ДЫМКА — частицы `UNDERWATER_MIST` (weather.xml): пятна по
 *    8–10 м вокруг камеры от 1 до 40 м, `underwater_render_mist.xml`; с
 *    чистотой их альфа уходит (копия поверх в update.rpf).
 *
 * Работа — одна настройка на всю воду (задача 2 ТЗ 04.10.2026, владелец:
 * «объедини море и озёра (и реки)… редактирует один раз — меняется везде»):
 * цвет и прозрачность сверху — у моря, озёр и рек сразу; прежние работы со
 * «своими озёрами» открываются одним обликом моря. Цвет — общим полем
 * эффектов мастерской (`colour-effects.js`): направление «От берега в
 * глубину» идёт по самой воде, остальные — по карте. Ровный цвет и эффекты
 * по карте — одной яркостью от берега до глубины (см. выше). Одна арифметика
 * у кадра и у установщика: `waterFogTexel`.
 *
 * Под водой (`under`): «Как сверху» (по умолчанию) — видимость и цвет те же,
 * что сверху, а свой цвет снимает муть; «Своя» — своя видимость, цвет и
 * чистота; «Как в игре» — модификаторы не трогаются. Цвет под водой несёт
 * прежде всего СВЕТ модификатора (у Rockstar он целиком синий), туман —
 * только вдали: при прозрачности 100 % тумана почти нет, и прежний свет
 * «белый с оттенком 45 %» оставлял воду изнутри штатной (кадры 12.10).
 * Свой цвет красит свет под водой на 80 % при любой чистоте. В игру — подводные
 * модификаторы (три общих и местные, что есть в файле игрока) слоем
 * объединения `timecycle-modifier-v1` поверх файла игрока
 * (`waterUnderwaterModifier`): чужие модификаторы остаются; и подводная
 * дымка (`waterUnderwaterMist`).
 */

import { colourEffectAt, normalizeColourEffect } from "./colour-effects.js";
import { normalizeRecolourHex } from "./colour.js";

export const WATER_PROJECT_SCHEMA = 2;
const NAME_LIMIT = 60;

/* Группы воды: вкладки облика. */
export const WATER_GROUPS = Object.freeze(["sea", "inland"]);
export const WATER_GROUP_LABELS = Object.freeze({ sea: "Море", inland: "Озёра и реки" });

/* Туман: тексель — цвет экрана как есть (шейдер берёт его квадрат — свет в
   линейных долях), каналы 0…255; зелёный не ниже 4 — ноль у шейдера
   значит «здесь нет воды». */
export const WATER_FOG_LIMIT = 255;
export const WATER_FOG_MIN_GREEN = 4;
/* Опорные цвета Rockstar: глубина и отмель (по плиткам игры). */
export const WATER_FOG_DEEP = Object.freeze([1, 27, 33]);
export const WATER_FOG_SHALLOW = Object.freeze([50, 82, 82]);

/* Плитки тумана: сетка, начало (северо-западный угол) и имя семьи. */
export const WATER_FOG_TILE_METRES = 500;
export const WATER_FOG_GRIDS = Object.freeze({
  main: Object.freeze({ prefix: "waterfog", cols: 17, rows: 24, west: -4000, north: 8000 }),
  island: Object.freeze({ prefix: "waterfog_h4", cols: 8, rows: 8, west: 2700, north: -3150 }),
});
export const WATER_FOG_ARCHIVE = "x64/textures/waterfog_txds.rpf";
export const WATER_FOG_DX_ARCHIVE = "x64/textures/waterfog_txds_dx.rpf";

/** Записи плитки `index` семьи `grid` в update.rpf: полная и упрощённая. */
export function waterFogTileEntries(grid, index) {
  const { prefix } = WATER_FOG_GRIDS[grid];
  return {
    full: `${WATER_FOG_ARCHIVE}/${prefix}-${index}.ytd`,
    dx: `${WATER_FOG_DX_ARCHIVE}/${prefix}-${index}-dx.ytd`,
  };
}

/** Мировой прямоугольник плитки: `{ west, north, size }` (север — сверху). */
export function waterFogTileRect(grid, index) {
  const { cols, west, north } = WATER_FOG_GRIDS[grid];
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { west: west + col * WATER_FOG_TILE_METRES, north: north - row * WATER_FOG_TILE_METRES, size: WATER_FOG_TILE_METRES };
}

/* Где кончается карта для эффектов «по карте»: весь штат и Кайо-Перико. */
export const WATER_EFFECT_BOUNDS = Object.freeze({ west: -4000, east: 6700, south: -7150, north: 8000 });
/* Линия «От берега в глубину»: глубина в условных метрах от отмели. */
export const WATER_DEPTH_METRES = 200;

/* Подписи направлений у воды: по карте и по самой воде. */
export const WATER_DIRECTION_LABELS = Object.freeze({
  along: "С запада на восток",
  across: "С юга на север",
  height: "От берега в глубину",
});

/*
 * Прозрачность: видимость дна (м) ↔ альфа квадов. Шейдер гасит свет как
 * 2^(−78,433·(a/255)²·d): 10 % света — на d = log2(10)·255²/78,433 / a² =
 * 2754 / a² м (прежде считалось по e — 1909 / a², в 1,44 раза ближе). Все
 * три числа — прежние, делённые на ln 2: альфа при той же прозрачности не
 * меняется, правдивее только метры в подсказках.
 */
export const WATER_VISIBILITY = Object.freeze({ min: 0.25 / Math.LN2, max: 60 / Math.LN2, k: 1909 / Math.LN2, vanillaAlpha: 26 });

const round1 = (value) => Math.round(value * 10) / 10;

/** Видно дно (10 % света) до стольких метров при прозрачности 0…100 %. */
export function waterVisibility(transparency) {
  const t = Math.min(100, Math.max(0, Number(transparency) || 0)) / 100;
  return WATER_VISIBILITY.min * (WATER_VISIBILITY.max / WATER_VISIBILITY.min) ** t;
}

/* Прозрачность, при которой вода как у Rockstar (альфа 26). */
export const WATER_VANILLA_TRANSPARENCY = round1(
  (100 * Math.log(WATER_VISIBILITY.k / WATER_VISIBILITY.vanillaAlpha ** 2 / WATER_VISIBILITY.min)) /
    Math.log(WATER_VISIBILITY.max / WATER_VISIBILITY.min),
);

/** Во сколько раз альфа квада гуще штатной при прозрачности `transparency`. */
export function waterAlphaFactor(transparency) {
  if (Math.abs(Number(transparency) - WATER_VANILLA_TRANSPARENCY) < 0.05) return 1;
  return Math.sqrt(WATER_VISIBILITY.k / waterVisibility(transparency)) / WATER_VISIBILITY.vanillaAlpha;
}

/** Альфа квада: штатная `base`, пересчитанная под прозрачность (1…255). */
export function waterQuadAlpha(base, transparency) {
  const factor = waterAlphaFactor(transparency);
  if (factor === 1) return base;
  return Math.max(1, Math.min(255, Math.round(base * factor)));
}

/* ------------------------------------------------------------------ *
 * Туман
 * ------------------------------------------------------------------ */

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const LUMA_DEEP = luma(...WATER_FOG_DEEP);
const LUMA_SHALLOW = luma(...WATER_FOG_SHALLOW);

/** Отмель (1) или глубина (0) — по яркости тумана Rockstar в этом месте. */
export function waterShallowness(r, g, b) {
  const s = (luma(r, g, b) - LUMA_DEEP) / (LUMA_SHALLOW - LUMA_DEEP);
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

/* Доля эффекта в точке: по карте или от берега в глубину. */
function effectParameter(effect, { s, x, y }) {
  const { west, east, south, north } = WATER_EFFECT_BOUNDS;
  if (effect.mode === "line") {
    const metres =
      effect.direction === "height" ? (1 - s) * WATER_DEPTH_METRES : effect.direction === "across" ? y - south : x - west;
    const u = metres / (2 * effect.width);
    return u - Math.floor(u);
  }
  if (effect.direction === "height") return 1 - s;
  const t = effect.direction === "across" ? (y - south) / (north - south) : (x - west) / (east - west);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/* Ступеней в полосе эффекта: на плитку 256² — по ступени на тексель. */
const STRIP_STEPS = 256;

/**
 * Эффект, готовый к расчёту тумана: полоса цветов на 256 ступеней.
 * Разбор эффекта на каждый тексель (сорок миллионов на всю воду) стоил бы
 * минут — полоса считается один раз.
 */
export function compileWaterEffect(input) {
  const effect = normalizeColourEffect(input);
  const strip = new Float32Array(STRIP_STEPS * 3);
  for (let step = 0; step < STRIP_STEPS; step += 1) {
    const t = effect.mode === "line" ? (step + 0.5) / STRIP_STEPS : step / (STRIP_STEPS - 1);
    const rgb = colourEffectAt(effect, t);
    strip[step * 3] = rgb[0];
    strip[step * 3 + 1] = rgb[1];
    strip[step * 3 + 2] = rgb[2];
  }
  return { effect, strip };
}

/**
 * Цвет тумана в точке — байты `[r, g, b]` в пределах игры. `compiled` —
 * `compileWaterEffect(эффект)`, `point` — `{ s, x, y }`: отмель по туману
 * Rockstar и мировые координаты. Тексель — сам цвет работы: ровный цвет и
 * эффекты по карте — одной яркостью от берега до глубины (глубину темнит
 * сама толща, а прежняя «треть яркости» на глубине под квадратом шейдера
 * гасила цвет до 6 %); эффект «от берега в глубину» сам решает, какой цвет
 * где.
 */
export function waterFogTexel(compiled, point, out = [0, 0, 0]) {
  const { effect, strip } = compiled.strip ? compiled : compileWaterEffect(compiled);
  const t = effectParameter(effect, point);
  const step = effect.mode === "line" ? Math.min(STRIP_STEPS - 1, Math.floor(t * STRIP_STEPS)) : Math.round(t * (STRIP_STEPS - 1));
  return stripTexel(strip, step, out);
}

/* Цвет ступени полосы — байты в пределах игры. */
function stripTexel(strip, step, out) {
  for (let channel = 0; channel < 3; channel += 1) {
    const value = Math.round(strip[step * 3 + channel]);
    out[channel] = value > WATER_FOG_LIMIT ? WATER_FOG_LIMIT : value < 0 ? 0 : value;
  }
  if (out[1] < WATER_FOG_MIN_GREEN) out[1] = WATER_FOG_MIN_GREEN;
  return out;
}

/**
 * Облик тумана числами — для движка сборки (`water-build`, крейт `astral-recolor`; 14.11.2026, работа «Astral быстрее»). Что работа
 * значит, решается здесь: движку едут полоса цвета каждой группы уже байтами (256 ступеней, как их отдаёт `waterFogTexel`), вид и
 * направление эффекта, границы карты, опорная яркость глубины и отмели, озёра. Арифметика точки (`recolourWaterFogLevel`) у движка
 * своя и обязана совпадать с этой байт в байт — правка любой из двух проверяется сверкой (`scripts/probe-water-engine.mjs`).
 * `looks` — `compileWaterLooks`, `lakes` — прямоугольники озёр. `null` — облик не для движка: плитки красит прежний код.
 */
export function waterFogEngineLook(looks, lakes = []) {
  const group = (look) => {
    if (!look?.tint) return { tint: false, line: false, direction: "height", width: 1, table: [] };
    const { effect, strip } = look.compiled || {};
    if (!effect || !strip || strip.length !== STRIP_STEPS * 3) return null;
    const line = effect.mode === "line";
    if (line && !(Number.isFinite(effect.width) && effect.width > 0)) return null;
    const table = [];
    const texel = [0, 0, 0];
    for (let step = 0; step < STRIP_STEPS; step += 1) {
      stripTexel(strip, step, texel);
      if (!texel.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return null;
      table.push(texel[0], texel[1], texel[2]);
    }
    const direction = effect.direction === "height" ? "height" : effect.direction === "across" ? "across" : "along";
    return { tint: true, line, direction, width: Number(effect.width), table };
  };
  const [sea, inland] = [group(looks?.sea), group(looks?.inland)];
  if (!sea || !inland || !(sea.tint || inland.tint)) return null;
  const rects = [...lakes].map((lake) => [Number(lake[0]), Number(lake[1]), Number(lake[2]), Number(lake[3])]);
  if (!rects.every((lake) => lake.every(Number.isFinite))) return null;
  const { west, east, south, north } = WATER_EFFECT_BOUNDS;
  return { bounds: [west, east, south, north], depthMetres: WATER_DEPTH_METRES, lumaDeep: LUMA_DEEP, lumaShallow: LUMA_SHALLOW, minGreen: WATER_FOG_MIN_GREEN, sea, inland, lakes: rects };
}

/** Облик групп, готовый к расчёту: `{ sea, inland }` с `{ tint, compiled }`. */
export function compileWaterLooks(input) {
  const looks = waterLooks(input);
  const compile = (look) => ({ tint: look.tint, transparency: look.transparency, compiled: look.tint ? compileWaterEffect(look.effect) : null });
  return { sea: compile(looks.sea), inland: compile(looks.inland) };
}

/**
 * Один уровень плитки тумана в новом облике (RGBA на месте копии).
 * `rect` — мировой прямоугольник плитки, `looks` — `compileWaterLooks`,
 * `lakes` — прямоугольники озёр `[west, south, east, north]` (квады воды
 * выше нуля). Точки без воды (зелёный ниже 4) и группа «как в игре» не
 * трогаются; альфа тумана — как была.
 */
export function recolourWaterFogLevel(rgba, width, height, rect, looks, lakes = []) {
  const out = new Uint8ClampedArray(rgba);
  const texel = [0, 0, 0];
  const point = { s: 0, x: 0, y: 0 };
  for (let py = 0; py < height; py += 1) {
    const y = rect.north - ((py + 0.5) / height) * rect.size;
    for (let px = 0; px < width; px += 1) {
      const at = (py * width + px) * 4;
      if (rgba[at + 1] < WATER_FOG_MIN_GREEN) continue;
      const x = rect.west + ((px + 0.5) / width) * rect.size;
      let inland = false;
      for (const lake of lakes)
        if (x >= lake[0] && x <= lake[2] && y >= lake[1] && y <= lake[3]) {
          inland = true;
          break;
        }
      const look = inland ? looks.inland : looks.sea;
      if (!look.tint) continue;
      point.s = waterShallowness(rgba[at], rgba[at + 1], rgba[at + 2]);
      point.x = x;
      point.y = y;
      waterFogTexel(look.compiled, point, texel);
      out[at] = texel[0];
      out[at + 1] = texel[1];
      out[at + 2] = texel[2];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

function clampTransparency(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return round1(Math.min(100, Math.max(0, number)));
}

/* Облик группы по умолчанию: цвет Rockstar не трогается, прозрачность —
   штатная. Цвет поля — бирюза отмели, если человек включит свой. */
const DEFAULT_EFFECT = Object.freeze({ mode: "solid", colour: "#2a95b1", colour2: "#002d63", direction: "height", width: 2, shift: 0 });

function normalizeGroup(input, fallback = null) {
  const source = plain(input);
  const base = fallback || { tint: false, look: DEFAULT_EFFECT, transparency: WATER_VANILLA_TRANSPARENCY };
  return {
    tint: typeof source.tint === "boolean" ? source.tint : base.tint,
    look: normalizeColourEffect(source.look, base.look),
    transparency: clampTransparency(source.transparency, base.transparency),
  };
}

/* Под водой: как сверху, своя или как в игре. */
export const WATER_UNDER_MODES = Object.freeze(["same", "own", "game"]);
export const WATER_UNDER_MODE_LABELS = Object.freeze({ same: "Как сверху", own: "Своя", game: "Как в игре" });
const DEFAULT_UNDER = Object.freeze({ mode: "same", colour: "#2a95b1", transparency: 85, clarity: 100 });

function normalizeUnder(input) {
  const source = plain(input);
  const clarity = Number(source.clarity);
  return {
    mode: WATER_UNDER_MODES.includes(source.mode) ? source.mode : DEFAULT_UNDER.mode,
    colour: normalizeRecolourHex(source.colour, DEFAULT_UNDER.colour),
    transparency: clampTransparency(source.transparency, DEFAULT_UNDER.transparency),
    clarity: Number.isFinite(clarity) ? Math.round(Math.min(100, Math.max(0, clarity))) : DEFAULT_UNDER.clarity,
  };
}

export function normalizeWaterProject(input) {
  const source = plain(input);
  const sea = normalizeGroup(source.sea);
  return {
    schema: WATER_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    sea,
    /* Одна настройка на всю воду (задача 2): озёра и реки — облик моря. */
    inland: { ...sea },
    inlandOwn: false,
    under: normalizeUnder(source.under),
  };
}

export const createWaterProject = () => normalizeWaterProject({});
export const serializeWaterProject = (project) => JSON.stringify(normalizeWaterProject(project));

export function parseWaterProject(text) {
  try {
    return normalizeWaterProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createWaterProject();
  }
}

/** Действующий облик групп: озёра и реки без своего — как море. */
export function waterLooks(input) {
  const project = normalizeWaterProject(input);
  const group = (item) => ({ tint: item.tint, effect: item.look, transparency: item.transparency });
  return { sea: group(project.sea), inland: group(project.inlandOwn ? project.inland : project.sea) };
}

const groupIsVanilla = (look) => !look.tint && Math.abs(look.transparency - WATER_VANILLA_TRANSPARENCY) < 0.05;

/** Всё как у Rockstar: ставить нечего. */
export function waterProjectIsVanilla(input) {
  const looks = waterLooks(input);
  return groupIsVanilla(looks.sea) && groupIsVanilla(looks.inland) && waterUnderLook(input).vanilla;
}

/** Отпечаток для очереди «Применить»: тот же облик — тот же отпечаток. */
export function waterProjectSignature(input) {
  const looks = waterLooks(input);
  const plainLook = (look) => ({ tint: look.tint, effect: look.tint ? look.effect : null, transparency: look.transparency });
  const under = waterUnderLook(input);
  return JSON.stringify({
    sea: plainLook(looks.sea),
    inland: plainLook(looks.inland),
    ...(under.vanilla ? {} : { under: { colour: under.colour, visibility: round1(under.visibility), clarity: Math.round(under.clarity * 100) } }),
  });
}

/* ------------------------------------------------------------------ *
 * Под водой
 * ------------------------------------------------------------------ */

export const WATER_UNDERWATER_ENTRY = "common/data/timecycle/timecycle_mods_1.xml";
/* Общие: камера под водой (код игры) и глубже 90 м — без них слоя нет. */
export const WATER_UNDERWATER_MODIFIERS = Object.freeze(["underwater", "underwater_deep", "underwater_deep_clear"]);
/* Местные виды под водой — коробки в картах игры (задача 7 ТЗ 11.10.2026):
   берег, порт, каналы, реки, Аламо-Си, озёра и пруды. В слой идут те, что
   есть в файле игрока. */
export const WATER_UNDERWATER_REGION_MODIFIERS = Object.freeze([
  "WATER_shore",
  "WATER_port",
  "WATER_silty",
  "WATER_muddy",
  "WATER_cove",
  "WATER_river",
  "WATER_salton",
  "WATER_salton_bottom",
  "WATER_silverlake",
  "WATER_resevoir",
  "WATER_hills",
  "WATER_lab",
  "WATER_militaryPOOP",
]);
/* Все имена слоя «под водой» — в этом порядке и в документе, и в манифесте. */
export const WATER_UNDERWATER_LAYER = Object.freeze([...WATER_UNDERWATER_MODIFIERS, ...WATER_UNDERWATER_REGION_MODIFIERS]);
/* Подводная дымка: частицы UNDERWATER_MIST (weather.xml). Игра читает их с
   `common:/`, который update.rpf перекрывает, — копия кладётся поверх. */
export const WATER_UNDERWATER_MIST_ENTRY = "common/data/levels/gta5/weather/underwater_render_mist.xml";

/* Цвет #rrggbb → [r, g, b] в долях. */
const unitRgb = (hex) => {
  const value = parseInt(String(hex).slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

/**
 * Облик под водой: `{ vanilla, colour: [r, g, b] (доли) | null, visibility (м
 * — как дно сверху), clarity (0…1 — сколько мути снято) }`. «Как сверху» —
 * видимость прозрачности сверху и цвет воды (первый цвет эффекта); муть
 * уходит с прозрачностью выше штатной, а свой цвет снимает её почти всю
 * (владелец: «если море розовое — под водой оно чистое, кристальное, с
 * розоватым оттенком, а не стандартное мутное»).
 */
export function waterUnderLook(input) {
  const project = normalizeWaterProject(input);
  const under = project.under;
  if (under.mode === "game") return { vanilla: true, colour: null, visibility: waterVisibility(WATER_VANILLA_TRANSPARENCY), clarity: 0 };
  if (under.mode === "own")
    return { vanilla: false, colour: unitRgb(under.colour), visibility: waterVisibility(under.transparency), clarity: under.clarity / 100 };
  const sea = project.sea;
  const lift = Math.max(0, (sea.transparency - WATER_VANILLA_TRANSPARENCY) / (100 - WATER_VANILLA_TRANSPARENCY));
  const vanilla = groupIsVanilla(sea);
  return {
    vanilla,
    colour: sea.tint ? unitRgb(normalizeColourEffect(sea.look).colour) : null,
    visibility: waterVisibility(sea.transparency),
    clarity: vanilla ? 0 : Math.min(1, Math.max(lift, sea.tint ? 0.8 : 0)),
  };
}

/* Голубой оттенок Rockstar под водой (свет и туман штатного модификатора). */
const VANILLA_UNDER_HUE = Object.freeze([0.0, 0.33, 1.0]);
const lerp = (a, b, t) => a + (b - a) * t;
const round3 = (value) => Math.round(value * 1000) / 1000;
const COLOUR_FIELD = /^(.*)_([rgb])$/;
const CHANNEL = Object.freeze({ r: 0, g: 1, b: 2 });
/* Цвета тумана и света — к своему цвету; остальное — числом. */
const FOG_COLOURS = Object.freeze(["fog_col", "fog_near_col", "fog_moon_col", "fog_east_col", "fog_haze_col"]);
const LIGHT_COLOURS = Object.freeze([
  "light_dir_col",
  "light_directional_amb_col",
  "light_natural_amb_down_col",
  "light_natural_amb_up_col",
  "ped_light_col",
  "light_ray_col",
]);
/* Муть: что уходит со «чистотой» (доля от штатного). */
const MURK = Object.freeze({
  postfx_noise: 1,
  postfx_desaturation: 1,
  dof_blur_mid: 1,
  dof_blur_far: 1,
  environmental_blur_size: 1,
  hh_minIntensity: 1,
  hh_maxIntensity: 1,
  blur_vignetting_intensity: 1,
  lens_dist_coeff: 1,
  lens_dist_cube_coeff: 1,
  chrom_aberration_coeff: 1,
  chrom_aberration_coeff2: 1,
  postfx_vignetting_intensity: 0.8,
});

/* Спад тумана открытого моря (`underwater`): у местных видов он круче —
   у берега 200, и туман густеет с глубиной в разы. */
const OPEN_SEA_FALLOFF = 20;
/* Яркость подводной дали: тёмная толща (у Rockstar 0,17–0,22), не молоко. */
const UNDER_FOG_DARK = 0.2;
const UNDER_FOG_CLEAR = 0.3;
/* Свет под водой со своим цветом: доля оттенка воды. У Rockstar свет под
   водой целиком синий (light_dir_col 0,004/0,082/0,18 с весом 0,9) — так
   вода «цветная» изнутри при любой прозрачности; остаток белого — чтобы дно
   не чернело у тёмных цветов. Прежние 45 % с весом «чистоты» давали почти
   белый свет — под водой оставался штатный вид (кадры 12.10.2026). */
const UNDER_LIGHT_TINT = 0.8;
/* Без своего цвета (только прозрачность) свет светлеет к голубому Rockstar. */
const UNDER_LIGHT_PLAIN = 0.45;

/*
 * Оттенок толщи под водой: свой цвет воды, но белый и серый — «без цвета»:
 * чистая вода уходит вдаль синевой, а светлый туман читается мутью
 * (владелец 11.10: белая вода с прозрачностью 100 % под водой выглядела
 * мутной). Насыщенные цвета — как есть, бледные — между ними.
 */
export function waterUnderHue(colour) {
  if (!colour) return [...VANILLA_UNDER_HUE];
  const peak = Math.max(...colour, 0.001);
  const tint = colour.map((value) => value / peak);
  const weight = hueWeight(colour);
  return tint.map((value, channel) => lerp(VANILLA_UNDER_HUE[channel], value, weight));
}

/* Насколько цвет «цветной»: 0 — белый и серый, 1 — насыщенный (≥ 25 %). */
function hueWeight(colour) {
  if (!colour) return 0;
  const peak = Math.max(...colour, 0.001);
  return Math.min(1, (1 - Math.min(...colour) / peak) / 0.25);
}

/**
 * Поля подводного модификатора в облике работы: `fields` — `[[имя, v1, v2],
 * …]` штатного модификатора игрока (общего или местного), `look` —
 * `waterUnderLook`. Видимость `k` — во сколько раз дальше видно дно, чем у
 * Rockstar: плотность тумана делится на `k` (туман игры — плотность·10⁻⁴ на
 * метр, видимость обратна плотности), крутой спад местных видов с глубиной
 * сглаживается к открытому морю, начало тумана и дальность растут; муть —
 * долей `clarity`; цвет тумана — тёмная толща оттенка воды
 * (`waterUnderHue`), свет — оттенком воды (свой цвет — на 80 % при любой
 * чистоте, без цвета — светлее к голубому долей чистоты). Второе число
 * строки (`value2` формата) меняется вместе с первым, только если они были
 * равны.
 */
export function waterUnderwaterModifier(fields, look) {
  if (look.vanilla) return fields.map((field) => [...field]);
  const k = Math.max(0.1, look.visibility / waterVisibility(WATER_VANILLA_TRANSPARENCY));
  const c = Math.min(1, Math.max(0, look.clarity));
  /* Доля сглаживания спада: полная — при видимости в 8 раз дальше штатной. */
  const flatten = k > 1 ? Math.min(1, Math.log(k) / Math.log(8)) : 0;
  const fogTint = waterUnderHue(look.colour);
  /* Свет под водой: свой цвет — оттенком воды при любой чистоте (белый и
     серый — как без цвета: чистая вода с голубизной); без цвета — белее с
     чистотой, к голубому Rockstar. */
  const tintShare = lerp(UNDER_LIGHT_PLAIN, UNDER_LIGHT_TINT, hueWeight(look.colour));
  const lightTint = fogTint.map((value) => lerp(1, value, tintShare));
  const lightShare = look.colour ? Math.max(c, hueWeight(look.colour)) : c;
  return fields.map(([name, v1, v2]) => {
    const both = v1 === v2;
    const set = (value) => [name, round3(value), both ? round3(value) : v2];
    if (name === "fog_density") return v1 > 0 ? set(Math.min(4000, Math.max(0.5, v1 / k))) : [name, v1, v2];
    if (name === "fog_haze_density") return v1 > 0 ? set(Math.min(400, v1 / k)) : [name, v1, v2];
    if (name === "fog_falloff") return v1 > OPEN_SEA_FALLOFF && flatten > 0 ? set(lerp(v1, OPEN_SEA_FALLOFF, flatten)) : [name, v1, v2];
    if (name === "fog_start") return set(k > 1 ? Math.max(v1, Math.min(40, (look.visibility - waterVisibility(WATER_VANILLA_TRANSPARENCY)) * 0.5)) : v1);
    if (name === "far_clip") return set(Math.min(1500, Math.max(v1, v1 * Math.sqrt(k))));
    if (name === "dof_far") return set(lerp(v1, 300, c));
    if (Object.hasOwn(MURK, name)) return set(v1 * (1 - MURK[name] * c));
    const colour = COLOUR_FIELD.exec(name);
    if (colour && FOG_COLOURS.includes(colour[1])) {
      /* Туман — тёмная толща оттенка воды: чуть светлее у чистой. */
      const target = fogTint[CHANNEL[colour[2]]] * lerp(UNDER_FOG_DARK, UNDER_FOG_CLEAR, c);
      return [name, round3(look.colour ? lerp(v1, target, Math.max(c, 0.85)) : lerp(v1, target, c)), v2];
    }
    if (colour && LIGHT_COLOURS.includes(colour[1])) return [name, round3(lerp(v1, lightTint[CHANNEL[colour[2]]], lightShare)), v2];
    if (colour && colour[1] === "postfx_shift_col") return [name, round3(lerp(v1, fogTint[CHANNEL[colour[2]]], look.colour ? 1 : 0)), v2];
    if (name === "light_natural_amb_down_intensity" || name === "light_natural_amb_up_intensity") return set(lerp(v1, 1, c));
    return [name, v1, v2];
  });
}

/**
 * Сколько метров видно под водой по горизонтали (до 10 % света) с полями
 * модификатора `fields` на глубине `depth` м под гладью на нулевой высоте.
 * Туман игры (замер стендом `tools/ingame-qa`, `PS_DepthEffects`):
 * плотность·10⁻⁴·e^(−спад/1000·(высота − база)) на метр после `fog_start`;
 * со спадом 0 тумана нет; дальше `far_clip` мира нет.
 */
export function waterUnderwaterReach(fields, depth = 6) {
  const value = (name, fallback) => {
    const found = fields.find(([field]) => field === name);
    return found ? found[1] : fallback;
  };
  const far = value("far_clip", 1500);
  const falloff = value("fog_falloff", 0);
  const sigma = value("fog_density", 0) * 1e-4 * Math.exp((-falloff / 1000) * (-depth - value("fog_base_height", 0)));
  if (!(falloff > 0) || !(sigma > 0)) return far;
  return Math.min(far, Math.max(0, value("fog_start", 0)) + Math.log(10) / sigma);
}

/** Сколько подводной дымки остаётся: 1 — как у Rockstar, у чистой воды 0,15. */
export function waterUnderwaterMistShare(look) {
  if (look.vanilla) return 1;
  return round3(1 - 0.85 * Math.min(1, Math.max(0, look.clarity)));
}

/**
 * `underwater_render_mist.xml` игрока в облике работы: альфа частиц
 * подводной дымки (`<colour … w>`) — долей `waterUnderwaterMistShare`,
 * остальной текст байт в байт. Возвращает `{ xml, changed }`.
 */
export function waterUnderwaterMist(xml, look) {
  const text = String(xml || "");
  const share = waterUnderwaterMistShare(look);
  if (share >= 0.999) return { xml: text, changed: false };
  let changed = false;
  const out = text.replace(/(<colour\b[^>]*?\bw=")([-+]?\d*\.?\d+)(")/, (match, before, value, after) => {
    const alpha = Math.max(0, Number(value) * share);
    changed = alpha !== Number(value);
    return `${before}${alpha.toFixed(6)}${after}`;
  });
  return { xml: out, changed };
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

/* Цвета готовых видов — цвета экрана (тексель тумана тот же): отмель и глубь. */
const depth = (shore, deep) => ({ mode: "gradient", colour: shore, colour2: deep, direction: "height", width: 2, shift: 0 });

/* Готовый вид — одна настройка на всю воду; под водой — как сверху. */
const preset = (id, label, description, sea) =>
  Object.freeze({
    id,
    label,
    description,
    project: Object.freeze({
      sea: Object.freeze(sea),
      inland: Object.freeze(sea),
      inlandOwn: false,
      under: Object.freeze({ ...DEFAULT_UNDER }),
    }),
  });

export const WATER_PRESETS = Object.freeze([
  preset("game", "Как в игре", "Цвет и прозрачность Rockstar", {
    tint: false,
    look: DEFAULT_EFFECT,
    transparency: WATER_VANILLA_TRANSPARENCY,
  }),
  preset(
    "caribbean",
    "Карибское море",
    "Ярко-голубая вода, дно видно далеко",
    { tint: true, look: depth("#40f8f1", "#006387"), transparency: 83 },
  ),
  preset(
    "pacific",
    "Тихий океан",
    "Глубокий синий, бирюза у берега",
    { tint: true, look: depth("#2a95b1", "#002d63"), transparency: 62 },
  ),
  preset("mediterranean", "Средиземное море", "Лазурь у берега, густая синь вдали", {
    tint: true,
    look: depth("#32bfea", "#003987"),
    transparency: 76,
  }),
  preset("maldives", "Мальдивы", "Светлая бирюза лагуны", { tint: true, look: depth("#63fff1", "#00638e"), transparency: 90 }),
  preset("crystal", "Кристальная вода", "Почти прозрачная, видно глубоко", {
    tint: true,
    look: depth("#55e3e3", "#005578"),
    transparency: 97,
  }),
  preset("emerald", "Изумрудная лагуна", "Зелёная, как у тропического острова", {
    tint: true,
    look: depth("#39c687", "#004e3c"),
    transparency: 70,
  }),
  preset("glacier", "Ледниковое озеро", "Молочно-голубая, холодная", {
    tint: true,
    look: depth("#63d4d4", "#0e717f"),
    transparency: 66,
  }),
  preset("northsea", "Северное море", "Тёмная, серо-зелёная, мутная", {
    tint: true,
    look: depth("#39584e", "#0b302d"),
    transparency: 28,
  }),
  preset("swamp", "Болото", "Бурая стоячая вода, дна не видно", {
    tint: true,
    look: depth("#4e4f28", "#283017"),
    transparency: 12,
  }),
  preset("pearl", "Перламутр", "Переливы бирюзы и сирени", {
    tint: true,
    look: { mode: "shimmer", colour: "#3fb8d0", colour2: "#ffffff", direction: "along", width: 2, shift: 0 },
    transparency: 72,
  }),
  preset("rainbow", "Радужное море", "Радуга с запада на восток", {
    tint: true,
    look: { mode: "rainbow", colour: "#2a95b1", colour2: "#ffffff", direction: "along", width: 2, shift: 190 },
    transparency: 60,
  }),
]);

const PRESET_MAP = Object.freeze(Object.fromEntries(WATER_PRESETS.map((item) => [item.id, item])));

/** Работа с обликом готового вида; имя работы не трогается. */
export function applyWaterPreset(input, presetId) {
  const found = PRESET_MAP[presetId];
  const project = normalizeWaterProject(input);
  if (!found) return project;
  return normalizeWaterProject({ ...project, ...found.project });
}

/** Готовый вид, с которым работа совпадает, или `null`. */
export function matchingWaterPreset(input) {
  const signature = waterProjectSignature(input);
  for (const item of WATER_PRESETS) if (waterProjectSignature(item.project) === signature) return item.id;
  return null;
}

/** Цвет образца готового вида (для плитки): отмель моря или «как в игре». */
export function waterPresetSwatch(presetId) {
  const found = PRESET_MAP[presetId];
  if (!found || !found.project.sea.tint) return "#0b5266";
  return normalizeRecolourHex(found.project.sea.look.colour, "#0b5266");
}
