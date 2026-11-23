/*
 * МСЛ-зоны на земле (ТЗ 08.10.2026, задача 3): светящиеся линии границ
 * районов, уложенные по рельефу, — мод `mcl.rpf` (внутри подменённого
 * `patchday16ng/dlc.rpf`): десять моделей `adxnis_jokerci_<район>.ydr`,
 * шейдер `emissive`, ленты шириной 0,425 м из отдельных четырёхугольников,
 * цвет — клетка палитры 3×3 (`colors`, 64×64) по развёртке вершины. У границы
 * двух зон — две ленты рядом, каждая в цвет своей стороны.
 *
 * Работа человека: с какой дистанции линии видны, прозрачность, цвет —
 * у каждого из девяти цветов мода свой (ровный или с эффектом мастерской)
 * или один облик на все линии, — ширина ленты и высота: над каждой лентой
 * встаёт стенка заданной высоты.
 *
 * Здесь одна арифметика для кадра и установщика:
 *   `mslRibbon(source)` — разбор ленты мода: у каждого треугольника его
 *   сторона (ребро вдоль линии), поперечные рёбра, звено цепочки и место
 *   вдоль линии;
 *   `mslZonesMesh(source, project)` — лента нужной ширины и стенки нужной
 *   высоты, развёртка — в полосы цветов (`mslZonesTexture`);
 *   `mslZonesTiles` — модель района, разрезанная на плитки: дальность у
 *   игры считается от точки сущности. У плитки точка — её центр, а
 *   дальность — заданная плюс радиус плитки: линия видна с выбранной
 *   дистанции до самой дальней своей точки. Сторона плитки — по дальности
 *   (`mslZonesTilePlan`): на 25 м — мелкие куски, на 1,5 км — по 400 м.
 *
 * Стенка (исправление 10.10.2026, «стенка поднимается наискосок»). Прежде
 * направление ленты бралось у каждого треугольника отдельно: «ступенька» —
 * ребро, ближайшее к 0,425 м, а не нашлась — длиннейшее ребро. На коротких
 * звеньях (короче 0,2 м — склоны ветряков) и в углах длиннейшим оказывалась
 * диагональ, а «ступенькой» — сторона, и стенка вставала поперёк или наискось
 * линии отдельным «плавником»; расширение сдвигало вершины двух треугольников
 * одного четырёхугольника по разным осям, и лента перекашивалась. Теперь
 * сторона треугольника — ребро, которое он ни с кем из своей ленты не делит
 * (у ленты-цепочки поперечные рёбра общие с соседями, продольное — нет);
 * спорные места решают соседи. Стенка — средняя линия треугольника между
 * серединами его поперечных рёбер: она параллельна стороне, и стенки соседей
 * сходятся в общих серединах — одна сплошная стенка вдоль оси ленты.
 * Ширина — сдвиг вершины поперёк ленты, общий у всех треугольников её
 * звена (в углу — по биссектрисе, как стык под углом).
 */

import { hexBytes, normalizeRecolourHex } from "./colour.js";
import { colourEffectAt, lookOf, normalizeColourEffect } from "./colour-effects.js";
import MSL_ZONES_INVENTORY from "./inventory/msl-zones.js";

export { MSL_ZONES_INVENTORY };

/* 2 — свой цвет у каждого цвета палитры (`colours`), дальность от 25 м. */
export const MSL_ZONES_SCHEMA = 2;
export const MSL_ZONES_SLOT = "msl-zones";
const NAME_LIMIT = 60;

/* Ширина ленты у мода, м (медиана коротких рёбер всех моделей). */
export const MSL_MOD_WIDTH = 0.425;
/* Дальность у мода: сущности 1500 м (Ветряки — 2000, Виноградники — 1600). */
export const MSL_MOD_DISTANCE = 1500;

export const MSL_LIMITS = Object.freeze({
  drawDistance: Object.freeze([25, 4000]),
  opacity: Object.freeze([0, 100]),
  width: Object.freeze([0.1, 4]),
  height: Object.freeze([0, 30]),
});

/* Сторона плитки, м: наибольшая (дальность от 400 м) и наименьшая. */
export const MSL_TILE = 400;
export const MSL_TILE_MIN = 25;
/* Моделей на все районы — не больше (предел расстановки нативного хоста —
   2000 архетипов; каждая модель — ещё и место в хранилищах игры). */
export const MSL_TILE_BUDGET = 2000;
/* Имён моделей на район (`astral_msl_<район>_<NN>`, опись доверия). */
export const MSL_TILES_PER_DISTRICT = 400;

/*
 * Палитра мода — клетки 3×3 текстуры `colors` (24/24/16 px), слева направо,
 * сверху вниз. Подписи — как цвета читаются на карте сервера.
 */
export const MSL_PALETTE = Object.freeze([
  Object.freeze({ id: "blue", label: "Синяя", many: "Синие", colour: "#004dc2" }),
  Object.freeze({ id: "pink", label: "Розовая", many: "Розовые", colour: "#d5188e" }),
  Object.freeze({ id: "brown", label: "Коричневая", many: "Коричневые", colour: "#734200" }),
  Object.freeze({ id: "green", label: "Зелёная", many: "Зелёные", colour: "#00b205" }),
  Object.freeze({ id: "cyan", label: "Голубая", many: "Голубые", colour: "#008fbd" }),
  Object.freeze({ id: "red", label: "Красная", many: "Красные", colour: "#d51a1a" }),
  Object.freeze({ id: "violet", label: "Фиолетовая", many: "Фиолетовые", colour: "#8b18c5" }),
  Object.freeze({ id: "yellow", label: "Жёлтая", many: "Жёлтые", colour: "#dee300" }),
  Object.freeze({ id: "orange", label: "Оранжевая", many: "Оранжевые", colour: "#e36e26" }),
]);
export const findMslColour = (id) => MSL_PALETTE.find((item) => item.id === id) || null;
/* Границы клеток по U и V (доли 64 px: 24, 24, 16). */
const CELL_EDGES = Object.freeze([0, 24 / 64, 48 / 64, 1]);
const cellIndex = (value) => {
  const x = ((value % 1) + 1) % 1;
  return x < CELL_EDGES[1] ? 0 : x < CELL_EDGES[2] ? 1 : 2;
};
/** Клетка палитры по развёртке вершины. */
export const mslPaletteCell = (u, v) => cellIndex(v) * 3 + cellIndex(u);

/* Районы мода: модель и подпись; точка сущности, рамка и место в файле
   геометрии — в описи (`MSL_ZONES_INVENTORY.districts`, `mslDistrictPlace`). */
export const MSL_DISTRICTS = Object.freeze([
  Object.freeze({ id: "city", label: "Центр", model: "adxnis_jokerci_city" }),
  Object.freeze({ id: "ghetto", label: "Гетто", model: "adxnis_jokerci_ghetto" }),
  Object.freeze({ id: "mirror", label: "Миррор-Парк", model: "adxnis_jokerci_mirror" }),
  Object.freeze({ id: "industrial", label: "Промзона", model: "adxnis_jokerci_industrial" }),
  Object.freeze({ id: "vinewood", label: "Вайнвуд", model: "adxnis_jokerci_vinewood" }),
  Object.freeze({ id: "venograd", label: "Виноградники", model: "adxnis_jokerci_venograd" }),
  Object.freeze({ id: "redwood", label: "Редвуд", model: "adxnis_jokerci_redwood" }),
  Object.freeze({ id: "windmill", label: "Ветряки", model: "adxnis_jokerci_windmill" }),
  Object.freeze({ id: "sandy", label: "Сэнди-Шорс", model: "adxnis_jokerci_sandy" }),
  Object.freeze({ id: "farm", label: "Ферма", model: "adxnis_jokerci_farm" }),
]);
export const findMslDistrict = (id) => MSL_DISTRICTS.find((district) => district.id === id) || MSL_DISTRICTS[0];
/** Место района в мире и в файле геометрии (опись). */
export const mslDistrictPlace = (id) => MSL_ZONES_INVENTORY.districts.find((district) => district.id === id) || null;

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
function clamp(value, [low, high], fallback, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, number)) * factor) / factor;
}

/* Облик цвета мода «как в моде» — его ровный цвет. */
const modLook = (item) => normalizeColourEffect({ mode: "solid", colour: item.colour }, { mode: "solid", colour: item.colour, colour2: "#ffffff" });
const sameLook = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/*
 * Свои цвета палитры: `{ <цвет мода>: эффект }` — только изменённые, в
 * порядке палитры. Цвет «как в моде» в работе не хранится: тот же облик —
 * та же запись.
 */
function normalizeColours(input) {
  const source = plain(input);
  const out = {};
  for (const item of MSL_PALETTE) {
    if (!Object.hasOwn(source, item.id)) continue;
    const raw = source[item.id];
    /* Короткая запись — просто цвет: «#ff00aa». */
    const look = normalizeColourEffect(typeof raw === "string" ? { mode: "solid", colour: raw } : raw, { mode: "solid", colour: item.colour, colour2: "#ffffff" });
    if (!sameLook(look, modLook(item))) out[item.id] = look;
  }
  return out;
}

/** Работа по умолчанию — как в моде. */
export function createMslZonesProject() {
  return normalizeMslZonesProject({});
}

export function normalizeMslZonesProject(input) {
  const source = plain(input);
  return {
    schema: MSL_ZONES_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    drawDistance: clamp(source.drawDistance, MSL_LIMITS.drawDistance, MSL_MOD_DISTANCE),
    opacity: clamp(source.opacity, MSL_LIMITS.opacity, 100),
    /* Один облик на все линии: выкл. — палитра мода, у каждого её цвета
       свой облик (`colours`), вкл. — эффект `look` на все линии. */
    ownColour: source.ownColour === true,
    look: normalizeColourEffect(lookOf(source), { mode: "solid", colour: "#00b205", colour2: "#ffffff" }),
    colours: normalizeColours(source.colours),
    width: clamp(source.width, MSL_LIMITS.width, MSL_MOD_WIDTH, 3),
    height: clamp(source.height, MSL_LIMITS.height, 0, 1),
  };
}

export const serializeMslZonesProject = (project) => JSON.stringify(normalizeMslZonesProject(project));

export function parseMslZonesProject(text) {
  try {
    return normalizeMslZonesProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createMslZonesProject();
  }
}

/** Облик линий цвета мода `id` в работе: свой, общий или как в моде. */
export function mslColourLook(input, id) {
  const project = normalizeMslZonesProject(input);
  const item = findMslColour(id) || MSL_PALETTE[0];
  if (project.ownColour) return project.look;
  return project.colours[item.id] || modLook(item);
}

/** Сколько цветов мода перекрашено своим обликом. */
export const mslChangedColours = (input) => {
  const project = normalizeMslZonesProject(input);
  return project.ownColour ? 0 : Object.keys(project.colours).length;
};

/** Отпечаток для очереди «Применить»: та же работа — тот же отпечаток. */
export function mslZonesSignature(input) {
  const project = normalizeMslZonesProject(input);
  return JSON.stringify({
    drawDistance: project.drawDistance,
    opacity: project.opacity,
    look: project.ownColour ? project.look : null,
    /* Свои цвета палитры — только пока линии в палитре мода. */
    ...(!project.ownColour && Object.keys(project.colours).length ? { colours: project.colours } : {}),
    width: project.width,
    height: project.height,
  });
}

/** Как в моде — ставить нечего, кроме самих линий мода. */
export function mslZonesIsMod(input) {
  const project = normalizeMslZonesProject(input);
  return (
    !project.ownColour &&
    !Object.keys(project.colours).length &&
    project.opacity === 100 &&
    Math.abs(project.width - MSL_MOD_WIDTH) < 0.001 &&
    project.height === 0 &&
    project.drawDistance === MSL_MOD_DISTANCE
  );
}

/** Линий не видно совсем. */
export const mslZonesIsHidden = (input) => normalizeMslZonesProject(input).opacity === 0;

/** Альфа линий (0…255). */
export const mslZonesAlpha = (input) => Math.round((normalizeMslZonesProject(input).opacity / 100) * 255);

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const solid = (colour) => Object.freeze({ mode: "solid", colour });

/* Пастельные оттенки девяти цветов мода — для готового вида. */
const PASTEL = Object.freeze({
  blue: "#7fa8ff",
  pink: "#ff9fd8",
  brown: "#d1a77c",
  green: "#8ff0a0",
  cyan: "#8fe3ff",
  red: "#ff9a9a",
  violet: "#cfa6ff",
  yellow: "#fff6a0",
  orange: "#ffc58f",
});

export const MSL_ZONES_PRESETS = Object.freeze([
  Object.freeze({ id: "mod", label: "Облик мода", description: "Палитра мода, лента 0,4 м по земле, видно с 1,5 км.", values: { ownColour: false, colours: {}, opacity: 100, width: MSL_MOD_WIDTH, height: 0, drawDistance: MSL_MOD_DISTANCE } }),
  Object.freeze({ id: "walls", label: "Стены зон", description: "Над каждой линией — стенка 4 м в цвет зоны.", values: { ownColour: false, opacity: 70, width: 0.6, height: 4, drawDistance: 2000 } }),
  Object.freeze({ id: "near", label: "Только рядом", description: "Линия появляется, когда подъезжаешь: видно со 100 м.", values: { ownColour: false, opacity: 100, width: 0.6, height: 0, drawDistance: 100 } }),
  Object.freeze({ id: "far", label: "Видно издалека", description: "Широкие линии, видно с 3 км.", values: { ownColour: false, opacity: 100, width: 2, height: 0, drawDistance: 3000 } }),
  Object.freeze({ id: "thin", label: "Тонкие", description: "Узкие полупрозрачные линии — почти не мешают.", values: { ownColour: false, opacity: 55, width: 0.2, height: 0, drawDistance: 800 } }),
  Object.freeze({ id: "pastel", label: "Пастель", description: "Каждый цвет мода — своим мягким оттенком.", values: { ownColour: false, colours: PASTEL, opacity: 100, width: 0.5, height: 0, drawDistance: 1500 } }),
  Object.freeze({ id: "neon", label: "Неон", description: "Все линии одним бирюзовым неоном, стенка 1,5 м.", values: { ownColour: true, look: solid("#00ffd5"), opacity: 85, width: 0.5, height: 1.5, drawDistance: 2000 } }),
  Object.freeze({ id: "rainbow", label: "Радуга", description: "Радуга снизу вверх по стенке 3 м.", values: { ownColour: true, look: { mode: "rainbow", direction: "height" }, opacity: 80, width: 0.5, height: 3, drawDistance: 2000 } }),
  Object.freeze({ id: "tape", label: "Сигнальная лента", description: "Красно-белые полосы вдоль линии, стенка 1 м.", values: { ownColour: true, look: { mode: "line", colour: "#ff2a2a", colour2: "#f4f4f4", direction: "along", width: 1.5 }, opacity: 100, width: 0.4, height: 1, drawDistance: 1500 } }),
  Object.freeze({ id: "hidden", label: "Невидимые", description: "Линий не видно совсем.", values: { opacity: 0 } }),
]);

export function applyMslZonesPreset(input, presetId) {
  const project = normalizeMslZonesProject(input);
  const preset = MSL_ZONES_PRESETS.find((item) => item.id === presetId);
  return preset ? normalizeMslZonesProject({ ...project, ...preset.values, name: project.name }) : project;
}

export function matchingMslZonesPreset(input) {
  const own = mslZonesSignature(input);
  return MSL_ZONES_PRESETS.find((preset) => mslZonesSignature(applyMslZonesPreset(input, preset.id)) === own)?.id || null;
}

/* ------------------------------------------------------------------ *
 * Текстура: полоса на каждый цвет мода
 * ------------------------------------------------------------------ */

/* Высота полосы цвета, px: ровно ряд блоков DXT — соседние цвета не
   смешиваются ни в сжатии, ни в уровнях до третьего. */
export const MSL_BAND = 4;
const TEXTURE_HEIGHT = 64;
/** Развёртка V середины полосы цвета `index` (0…8). */
export const mslBandV = (index) => (index * MSL_BAND + MSL_BAND / 2) / TEXTURE_HEIGHT;

/*
 * Текстура линий: девять полос — по одной на цвет мода (своя, общая или как
 * в моде), сверху вниз в порядке палитры; вдоль полосы — эффект цвета (U).
 * Все полосы ровные — ширина 4 px, с эффектом — 64. Альфа — прозрачность.
 */
export function mslZonesTexture(input) {
  const project = normalizeMslZonesProject(input);
  const alpha = mslZonesAlpha(project);
  const looks = MSL_PALETTE.map((item) => mslColourLook(project, item.id));
  const flat = looks.every((look) => look.mode === "solid");
  const width = flat ? 4 : 64;
  const height = TEXTURE_HEIGHT;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const look = looks[Math.min(looks.length - 1, Math.floor(y / MSL_BAND))];
    for (let x = 0; x < width; x += 1) {
      const t = look.mode === "line" ? (x + 0.5) / width : width > 1 ? x / (width - 1) : 0;
      rgba.set([...colourEffectAt(look, t), alpha], (y * width + x) * 4);
    }
  }
  return { width, height, rgba, kind: flat ? "flat" : "effects", bands: looks.length };
}

/* ------------------------------------------------------------------ *
 * Лента: стороны, ячейки, ось
 * ------------------------------------------------------------------ */

/* Сварка вершин: 1 мм. */
const WELD = 1000;
const ribbons = new WeakMap();
/* Сторона треугольника: нет (вырожденный) и нет — внутренний (у веера). */
const DEGENERATE = -2;
const INTERIOR = -3;

function unionFind(size) {
  const parent = Int32Array.from({ length: size }, (_, at) => at);
  const find = (at) => {
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]];
      at = parent[at];
    }
    return at;
  };
  const join = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  return { find, join };
}

/*
 * Разбор ленты мода (кэш на источник — на его массив индексов).
 *
 * Лента мода — цепочка четырёхугольников вдоль границы района, по рельефу:
 * где-то два треугольника на звено, где-то веер из четырёх вокруг точки
 * посередине (так их режет склон), в углах — стык под углом. Разбор:
 *
 *   1. цвет треугольника — клетка палитры большинства его вершин; вершины
 *      свариваются по месту и цвету (ленты разных цветов у общей границы —
 *      разные);
 *   2. сторона — ребро вдоль края ленты: у чистого звена цепочки
 *      единственное ребро, которое треугольник не делит ни с кем из своей
 *      ленты; спорные (конец ленты, две ленты одного цвета вплотную) решают
 *      соседи — сторона параллельна их сторонам, а общее ребро с соседом, у
 *      которого оно поперечное, стороной быть не может; у треугольника веера
 *      без стороны (все рёбра — к соседям) её нет вовсе;
 *   3. края ленты — цепочки сторон; поперечное ребро — то, что соединяет
 *      два разных края: его середина лежит на оси ленты;
 *   4. ячейки — куски ленты между соседними поперечными рёбрами (звено,
 *      половина звена или весь веер); стенка ячейки — отрезок между
 *      серединами её поперечных рёбер. Стенки соседних ячеек сходятся в
 *      общих серединах — одна сплошная стенка по оси ленты;
 *   5. ширина: точка края сдвигается поперёк ленты — по нормали оси своей
 *      ячейки на столько, на сколько она от оси; где ячеек с разной осью
 *      несколько (угол), — стык по биссектрисе (наименьшие квадраты).
 */
export function mslRibbon(source) {
  const cached = ribbons.get(source.indices);
  if (cached && cached.positions === source.positions) return cached;
  const { positions, uvs, indices } = source;
  const count = Math.floor(indices.length / 3);

  /* 1. Цвет треугольника и сварка по месту и цвету. */
  const colour = new Uint8Array(count);
  for (let t = 0; t < count; t += 1) {
    const cells = [0, 1, 2].map((k) => {
      const i = indices[t * 3 + k];
      return uvs ? mslPaletteCell(uvs[i * 2], uvs[i * 2 + 1]) : 0;
    });
    colour[t] = cells[1] === cells[2] ? cells[1] : cells[0];
  }
  const corner = new Int32Array(count * 3);
  const keys = new Map();
  const welded = [];
  for (let t = 0; t < count; t += 1)
    for (let k = 0; k < 3; k += 1) {
      const i = indices[t * 3 + k];
      const key = `${Math.round(positions[i * 3] * WELD)},${Math.round(positions[i * 3 + 1] * WELD)},${Math.round(positions[i * 3 + 2] * WELD)},${colour[t]}`;
      let id = keys.get(key);
      if (id === undefined) {
        id = keys.size;
        keys.set(key, id);
        welded.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      }
      corner[t * 3 + k] = id;
    }
  const points = Float64Array.from(welded);
  const weldedCount = keys.size;
  const P = (id) => [points[id * 3], points[id * 3 + 1], points[id * 3 + 2]];
  const cornerOf = (t, e) => corner[t * 3 + (e % 3)];

  /* Рёбра по сваренным точкам: кто их делит. */
  const edgeKey = (a, b) => (a < b ? a * weldedCount + b : b * weldedCount + a);
  const keyOf = (t, e) => edgeKey(cornerOf(t, e), cornerOf(t, e + 1));
  const edges = new Map();
  const side = new Int8Array(count).fill(-1);
  const stats = { clean: 0, neighbours: 0, interior: 0, shape: 0, degenerate: 0 };
  for (let t = 0; t < count; t += 1) {
    const [a, b, c] = [cornerOf(t, 0), cornerOf(t, 1), cornerOf(t, 2)];
    const pa = P(a);
    const pb = P(b);
    const pc = P(c);
    const area = Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])) / 2;
    if (a === b || b === c || a === c || area < 1e-6) {
      side[t] = DEGENERATE;
      stats.degenerate += 1;
      continue;
    }
    for (let e = 0; e < 3; e += 1) {
      const key = keyOf(t, e);
      const list = edges.get(key);
      if (list) list.push(t * 3 + e);
      else edges.set(key, [t * 3 + e]);
    }
  }
  const sharers = (t, e) => (edges.get(keyOf(t, e)) || []).filter((item) => Math.floor(item / 3) !== t);
  const edgeDir = (t, e) => {
    const pa = P(cornerOf(t, e));
    const pb = P(cornerOf(t, e + 1));
    const dx = pb[0] - pa[0];
    const dy = pb[1] - pa[1];
    const length = Math.hypot(dx, dy) || 1;
    return [dx / length, dy / length];
  };

  /* 2. Сторона. Чистое звено цепочки: одно ребро ни с кем, два — с одним. */
  const clean = new Uint8Array(count);
  for (let t = 0; t < count; t += 1) {
    if (side[t] !== -1) continue;
    const counts = [0, 1, 2].map((e) => sharers(t, e).length);
    if (counts.filter((value) => value === 0).length === 1 && counts.filter((value) => value === 1).length === 2) {
      side[t] = counts.indexOf(0);
      clean[t] = 1;
      stats.clean += 1;
    }
  }
  /* Чистое звено, у которого оба чистых соседа идут поперёк его стороны, —
     ступенька веера на конце ленты, а не край: его решают соседи. */
  const suspicious = [];
  for (let t = 0; t < count; t += 1) {
    if (!clean[t]) continue;
    const own = edgeDir(t, side[t]);
    let checked = 0;
    let across = 0;
    for (const e of [(side[t] + 1) % 3, (side[t] + 2) % 3])
      for (const item of sharers(t, e)) {
        const other = Math.floor(item / 3);
        if (!clean[other]) continue;
        checked += 1;
        const [dx, dy] = edgeDir(other, side[other]);
        if (Math.abs(own[0] * dx + own[1] * dy) < 0.5) across += 1;
      }
    if (checked === 2 && across === 2) suspicious.push(t);
  }
  for (const t of suspicious) {
    side[t] = -1;
    clean[t] = 0;
    stats.clean -= 1;
  }
  /* Спорные — по решённым соседям; `force` — решать и с неизвестными. */
  const decide = (t, force) => {
    const crossing = new Set();
    const unknown = new Set();
    const free = [];
    let sx = 0;
    let sy = 0;
    let first = null;
    for (let e = 0; e < 3; e += 1) {
      const list = sharers(t, e);
      if (!list.length) free.push(e);
      for (const item of list) {
        const other = Math.floor(item / 3);
        const otherEdge = item % 3;
        if (side[other] === -1) {
          unknown.add(e);
          continue;
        }
        /* Общее ребро — сторона соседа: две ленты одного цвета вплотную. */
        if (side[other] === otherEdge) return e;
        crossing.add(e);
        if (side[other] < 0) continue;
        const [dx, dy] = edgeDir(other, side[other]);
        if (!first) first = [dx, dy];
        const sign = dx * first[0] + dy * first[1] < 0 ? -1 : 1;
        sx += dx * sign;
        sy += dy * sign;
      }
    }
    const candidates = [0, 1, 2].filter((e) => !crossing.has(e));
    /* Все рёбра — к соседям, ни одно не их сторона: треугольник веера. */
    if (!candidates.length) return INTERIOR;
    const sure = candidates.filter((e) => !unknown.has(e));
    if (!force && (!first || (unknown.size && !free.length))) return -1;
    const pool = sure.length ? sure : candidates;
    if (!first) return pool[0];
    let best = pool[0];
    let bestScore = -1;
    const length = Math.hypot(sx, sy) || 1;
    for (const e of pool) {
      const [dx, dy] = edgeDir(t, e);
      const score = Math.abs(dx * sx + dy * sy) / length;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = e;
      }
    }
    /* Свободна только ступенька поперёк соседей (веер на конце ленты):
       стороны у треугольника нет. */
    return bestScore < 0.5 ? INTERIOR : best;
  };
  const pass = (force) => {
    let changed = false;
    for (let t = 0; t < count; t += 1) {
      if (side[t] !== -1) continue;
      const result = decide(t, force);
      if (result === -1) continue;
      side[t] = result;
      if (result === INTERIOR) stats.interior += 1;
      else stats.neighbours += 1;
      changed = true;
      if (force) return true;
    }
    return changed;
  };
  const settle = () => {
    for (;;) {
      while (pass(false));
      if (!pass(true)) break;
    }
  };
  settle();
  /* Без решённых соседей (одинокий четырёхугольник) — по форме: сторона —
     ребро, от которого вершина напротив дальше всего на ширину ленты. */
  for (let t = 0; t < count; t += 1) {
    if (side[t] !== -1) continue;
    const pts = [0, 1, 2].map((k) => P(cornerOf(t, k)));
    const area2 = Math.abs((pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]));
    let best = 0;
    let bestMiss = Infinity;
    for (let e = 0; e < 3; e += 1) {
      if (sharers(t, e).length) continue;
      const a = pts[e];
      const b = pts[(e + 1) % 3];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      const miss = Math.abs(area2 / length - MSL_MOD_WIDTH) - length * 1e-3;
      if (miss < bestMiss) {
        bestMiss = miss;
        best = e;
      }
    }
    side[t] = best;
    stats.shape += 1;
    settle();
  }

  /* Звенья ленты: треугольники через общие рёбра, что не стороны. */
  const live = (t) => side[t] !== DEGENERATE;
  const isSide = (t, e) => side[t] >= 0 && side[t] === e % 3;
  const strips = unionFind(count);
  for (let t = 0; t < count; t += 1) {
    if (!live(t)) continue;
    for (let e = 0; e < 3; e += 1) {
      if (isSide(t, e)) continue;
      for (const item of sharers(t, e)) if (!isSide(Math.floor(item / 3), item % 3)) strips.join(t, Math.floor(item / 3));
    }
  }
  const component = new Int32Array(count);
  for (let t = 0; t < count; t += 1) component[t] = strips.find(t);

  /* Точки звена: сварка + звено (ленты одного цвета вплотную — порознь). */
  const groupKeys = new Map();
  const group = new Int32Array(count * 3).fill(-1);
  for (let t = 0; t < count; t += 1) {
    if (!live(t)) continue;
    for (let k = 0; k < 3; k += 1) {
      const key = cornerOf(t, k) * count + component[t];
      let id = groupKeys.get(key);
      if (id === undefined) {
        id = groupKeys.size;
        groupKeys.set(key, id);
      }
      group[t * 3 + k] = id;
    }
  }
  const groups = groupKeys.size;

  /*
   * 3. Края ленты — раскраска точек звена в два края: общее ребро двух
   * чистых звеньев цепочки (ступенька или диагональ) соединяет разные края,
   * сторона — точки одного края. Сначала ступеньки чистых звеньев, затем их
   * стороны, затем стороны спорных: что противоречит уже решённому, не
   * берётся (сторона, выбранная поперёк ленты, не сливает края). Поперечное
   * ребро — то, что соединяет точки разных краёв.
   */
  const rimParent = Int32Array.from({ length: groups }, (_, at) => at);
  const rimParity = new Uint8Array(groups);
  const rimFind = (at) => {
    let parity = 0;
    let root = at;
    while (rimParent[root] !== root) {
      parity ^= rimParity[root];
      root = rimParent[root];
    }
    /* Сжатие пути с пересчётом чётности. */
    let current = at;
    let along = parity;
    while (rimParent[current] !== current) {
      const next = rimParent[current];
      const own = rimParity[current];
      rimParent[current] = root;
      rimParity[current] = along;
      along ^= own;
      current = next;
    }
    return [root, parity];
  };
  const rimJoin = (a, b, differ) => {
    const [ra, pa] = rimFind(a);
    const [rb, pb] = rimFind(b);
    if (ra === rb) return (pa ^ pb) === differ;
    rimParent[Math.max(ra, rb)] = Math.min(ra, rb);
    rimParity[Math.max(ra, rb)] = pa ^ pb ^ differ;
    return true;
  };
  const groupOf = (t, e) => group[t * 3 + (e % 3)];
  for (let t = 0; t < count; t += 1) {
    if (!clean[t]) continue;
    for (let e = 0; e < 3; e += 1) {
      if (e === side[t]) continue;
      const other = sharers(t, e)[0];
      if (other !== undefined && clean[Math.floor(other / 3)] && !isSide(Math.floor(other / 3), other % 3)) rimJoin(groupOf(t, e), groupOf(t, e + 1), 1);
    }
  }
  const onRim = new Uint8Array(groups);
  for (const pick of [(t) => clean[t], (t) => !clean[t]])
    for (let t = 0; t < count; t += 1) {
      if (side[t] < 0 || !pick(t)) continue;
      const ga = groupOf(t, side[t]);
      const gb = groupOf(t, side[t] + 1);
      if (!rimJoin(ga, gb, 0)) continue;
      onRim[ga] = 1;
      onRim[gb] = 1;
    }
  const proper = (t, e) => {
    if (isSide(t, e)) return false;
    const ga = groupOf(t, e);
    const gb = groupOf(t, e + 1);
    if (!onRim[ga] || !onRim[gb]) return false;
    const [ra, pa] = rimFind(ga);
    const [rb, pb] = rimFind(gb);
    /* Края, ничем не связанные (короткая лента без чистых соседей), — тоже
       разные: один край связали бы его стороны. */
    return ra !== rb || pa !== pb;
  };

  /* 4. Ячейки: треугольники звена через общие рёбра, что не поперечные. */
  const cellsOf = unionFind(count);
  for (let t = 0; t < count; t += 1) {
    if (!live(t)) continue;
    for (let e = 0; e < 3; e += 1) {
      if (isSide(t, e) || proper(t, e)) continue;
      for (const item of sharers(t, e)) {
        const other = Math.floor(item / 3);
        if (component[other] === component[t] && !isSide(other, item % 3)) cellsOf.join(t, other);
      }
    }
  }
  const cell = new Int32Array(count).fill(-1);
  const cellEdges = new Map(); /* ячейка → Map(ключ ребра → середина) */
  for (let t = 0; t < count; t += 1) {
    if (!live(t)) continue;
    const id = cellsOf.find(t);
    cell[t] = id;
    if (!cellEdges.has(id)) cellEdges.set(id, new Map());
    for (let e = 0; e < 3; e += 1) {
      if (!proper(t, e)) continue;
      const key = keyOf(t, e);
      const list = cellEdges.get(id);
      if (list.has(key)) continue;
      const a = P(cornerOf(t, e));
      const b = P(cornerOf(t, e + 1));
      list.set(key, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    }
  }

  /*
   * Стенки — граф: узлы — середины поперечных рёбер (ключ ребра) и
   * середины ячеек-развилок, отрезки — внутри ячеек. Ячейка без двух
   * поперечных рёбер (край разбора не нашёлся) — средними линиями своих
   * треугольников со стороной: они параллельны стороне.
   */
  const nodes = new Map(); /* ключ → { point, colour, station } */
  const segments = []; /* { a, b, colour, cell } */
  const cellSegments = new Map(); /* ячейка → номера отрезков */
  const node = (key, point, nodeColour) => {
    if (!nodes.has(key)) nodes.set(key, { point, colour: nodeColour, station: NaN });
    return key;
  };
  const addSegment = (a, b, segmentColour, owner) => {
    const pa = nodes.get(a).point;
    const pb = nodes.get(b).point;
    if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < 0.01) return;
    const at = segments.push({ a, b, colour: segmentColour, cell: owner }) - 1;
    if (!cellSegments.has(owner)) cellSegments.set(owner, []);
    cellSegments.get(owner).push(at);
  };
  const firstOfCell = new Map();
  for (let t = 0; t < count; t += 1) if (live(t) && !firstOfCell.has(cell[t])) firstOfCell.set(cell[t], t);
  for (const [id, list] of cellEdges) {
    const owner = firstOfCell.get(id);
    const tint = colour[owner];
    const ends = [...list.entries()];
    if (ends.length === 2) {
      addSegment(node(`e${ends[0][0]}`, ends[0][1], tint), node(`e${ends[1][0]}`, ends[1][1], tint), tint, id);
    } else if (ends.length > 2) {
      const centre = [0, 1, 2].map((axis) => ends.reduce((sum, [, point]) => sum + point[axis], 0) / ends.length);
      const hub = node(`c${id}`, centre, tint);
      for (const [key, point] of ends) addSegment(hub, node(`e${key}`, point, tint), tint, id);
    }
  }
  for (let t = 0; t < count; t += 1) {
    if (side[t] < 0) continue;
    if ((cellEdges.get(cell[t])?.size || 0) >= 2) continue;
    const s = side[t];
    const a = P(cornerOf(t, s));
    const b = P(cornerOf(t, s + 1));
    const c = P(cornerOf(t, s + 2));
    const m0 = node(`e${keyOf(t, s + 2)}`, [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2], colour[t]);
    const m1 = node(`e${keyOf(t, s + 1)}`, [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2], colour[t]);
    addSegment(m0, m1, colour[t], cell[t]);
  }

  /* Место вдоль линии у узлов — расстояние по стенке от начала обхода. */
  const links = new Map();
  segments.forEach((segment, at) => {
    for (const key of [segment.a, segment.b]) {
      if (!links.has(key)) links.set(key, []);
      links.get(key).push(at);
    }
  });
  for (const [key, item] of nodes) {
    if (!Number.isNaN(item.station)) continue;
    item.station = 0;
    const queue = [key];
    for (let head = 0; head < queue.length; head += 1) {
      const current = nodes.get(queue[head]);
      for (const at of links.get(queue[head]) || []) {
        const segment = segments[at];
        const next = segment.a === queue[head] ? segment.b : segment.a;
        const target = nodes.get(next);
        if (!Number.isNaN(target.station)) continue;
        const [x0, y0, z0] = current.point;
        const [x1, y1, z1] = target.point;
        target.station = current.station + Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        queue.push(next);
      }
    }
  }

  /* Ось треугольника: ближний отрезок стенки его ячейки, а без них —
     средняя линия его стороны. `frame`: направление (x, y), точка оси (x, y). */
  const frame = new Float64Array(count * 4).fill(NaN);
  const axisSegment = new Int32Array(count).fill(-1);
  for (let t = 0; t < count; t += 1) {
    if (!live(t)) continue;
    const pts = [0, 1, 2].map((k) => P(cornerOf(t, k)));
    const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
    const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
    let best = -1;
    let bestDistance = Infinity;
    for (const at of cellSegments.get(cell[t]) || []) {
      const pa = nodes.get(segments[at].a).point;
      const pb = nodes.get(segments[at].b).point;
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      const along = Math.max(0, Math.min(1, ((cx - pa[0]) * dx + (cy - pa[1]) * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(pa[0] + dx * along - cx, pa[1] + dy * along - cy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = at;
      }
    }
    if (best >= 0) {
      const pa = nodes.get(segments[best].a).point;
      const pb = nodes.get(segments[best].b).point;
      const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
      frame.set([(pb[0] - pa[0]) / length, (pb[1] - pa[1]) / length, pa[0], pa[1]], t * 4);
      axisSegment[t] = best;
    } else if (side[t] >= 0) {
      const s = side[t];
      const a = pts[s];
      const b = pts[(s + 1) % 3];
      const c = pts[(s + 2) % 3];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      frame.set([(b[0] - a[0]) / length, (b[1] - a[1]) / length, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2], t * 4);
    }
  }

  /*
   * 5. Ширина: каждый треугольник говорит точке «по нормали моей оси — на
   * столько, на сколько ты от неё»; у прямой ленты это один ответ, в углу —
   * стык по биссектрисе (наименьшие квадраты; вдоль слабого направления — с
   * затуханием: почти параллельные нормали не уводят точку вдоль линии).
   */
  const sums = new Float64Array(groups * 6); /* axx, axy, ayy, bx, by, наибольшее |o| */
  for (let t = 0; t < count; t += 1) {
    if (!live(t) || Number.isNaN(frame[t * 4])) continue;
    const nx = -frame[t * 4 + 1];
    const ny = frame[t * 4];
    for (let k = 0; k < 3; k += 1) {
      const p = P(cornerOf(t, k));
      const offset = (p[0] - frame[t * 4 + 2]) * nx + (p[1] - frame[t * 4 + 3]) * ny;
      const g = group[t * 3 + k] * 6;
      sums[g] += nx * nx;
      sums[g + 1] += nx * ny;
      sums[g + 2] += ny * ny;
      sums[g + 3] += nx * offset;
      sums[g + 4] += ny * offset;
      sums[g + 5] = Math.max(sums[g + 5], Math.abs(offset));
    }
  }
  const shift = new Float64Array(groups * 2);
  for (let g = 0; g < groups; g += 1) {
    const [axx, axy, ayy, bx, by, limit] = sums.subarray(g * 6, g * 6 + 6);
    const half = (axx + ayy) / 2;
    const spread = Math.sqrt(Math.max(0, half * half - (axx * ayy - axy * axy)));
    const l1 = half + spread;
    const l2 = half - spread;
    if (l1 < 1e-9) continue;
    let ex = 1;
    let ey = 0;
    if (Math.abs(axy) > 1e-12) {
      ex = l1 - ayy;
      ey = axy;
    } else if (ayy > axx) {
      ex = 0;
      ey = 1;
    }
    const el = Math.hypot(ex, ey) || 1;
    ex /= el;
    ey /= el;
    const fx = -ey;
    const fy = ex;
    const strong = (ex * bx + ey * by) / l1;
    const weak = ((fx * bx + fy * by) * l2) / (l2 * l2 + (0.05 * l1) ** 2);
    let sx = ex * strong + fx * weak;
    let sy = ey * strong + fy * weak;
    const length = Math.hypot(sx, sy);
    if (length > limit * 3 && length > 0) {
      sx *= (limit * 3) / length;
      sy *= (limit * 3) / length;
    }
    shift[g * 2] = sx;
    shift[g * 2 + 1] = sy;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
  }

  const ribbon = {
    positions,
    count,
    colour,
    corner,
    points,
    side,
    component,
    cell,
    group,
    shift,
    frame,
    axisSegment,
    nodes,
    segments,
    span: [
      [minX, maxX],
      [minY, maxY],
    ],
    /* Край ленты у точки звена (−1 — не на краю): для проверок. */
    rim: Int32Array.from({ length: groups }, (_, g) => {
      if (!onRim[g]) return -1;
      const [root, parity] = rimFind(g);
      return root * 2 + parity;
    }),
    stats: { ...stats, cells: cellEdges.size, walls: segments.length },
  };
  ribbons.set(source.indices, ribbon);
  return ribbon;
}

/* Развёртка эффекта: доля вдоль полосы цвета (U). */
function effectU(look, point, height01, span) {
  if (look.mode === "solid") return 0.5;
  if (look.direction === "height") return look.mode === "line" ? 0 : height01;
  const axis = look.direction === "across" ? 1 : 0;
  return (point[axis] - span[axis][0]) / Math.max(0.01, span[axis][1] - span[axis][0]);
}

/**
 * Лента нужной ширины и стенки нужной высоты из геометрии мода.
 *
 * `source` — `{ positions: Float32Array (x,y,z), uvs: Float32Array (u,v),
 * indices: Uint32Array }` модели района (координаты — от точки сущности).
 * Ответ — одна сетка `{ positions, uvs, indices, ground, walls }`: сначала
 * лента (`ground` индексов), за ней стенки (`walls` — отрезков, у каждого
 * обе стороны). Развёртка — полоса своего цвета (`mslBandV`) и доля его
 * эффекта (U); у линии двумя цветами — место вдоль линии.
 */
export function mslZonesMesh(source, input) {
  const project = normalizeMslZonesProject(input);
  const ribbon = mslRibbon(source);
  const { count, colour, corner, points, side, group, shift, axisSegment, nodes, segments, span } = ribbon;
  const factor = project.width / MSL_MOD_WIDTH;
  const looks = MSL_PALETTE.map((item) => mslColourLook(project, item.id));
  const positions = [];
  const uvs = [];
  const indices = [];
  /* Общие точки — по номеру группы ленты и по узлу стенки с её уровнем. Ключи — числа, без склейки строк
     на каждую вершину: высоту стенки тянут ползунком, и сетка собирается на каждый шаг (19.10.2026). */
  const groundShared = new Map();
  const wallShared = [new Map(), new Map()];
  const vertex = (point, u, v) => {
    const id = positions.length / 3;
    positions.push(point[0], point[1], point[2]);
    uvs.push(u, v);
    return id;
  };
  const sharedVertex = (map, key, point, u, v) => {
    const known = map.get(key);
    if (known !== undefined) return known;
    const id = vertex(point, u, v);
    map.set(key, id);
    return id;
  };
  /* Место вдоль линии у точки: проекция на ось её треугольника. */
  const stationAt = (t, p) => {
    const at = axisSegment[t];
    if (at < 0) return 0;
    const a = nodes.get(segments[at].a);
    const b = nodes.get(segments[at].b);
    const dx = b.point[0] - a.point[0];
    const dy = b.point[1] - a.point[1];
    const share = ((p[0] - a.point[0]) * dx + (p[1] - a.point[1]) * dy) / (dx * dx + dy * dy || 1);
    return a.station + share * (b.station - a.station);
  };

  /* Лента: точки звена — общие, пока у них одна развёртка. */
  for (let t = 0; t < count; t += 1) {
    if (side[t] === DEGENERATE) continue;
    const look = looks[colour[t]];
    const v = mslBandV(colour[t]);
    const along = look.mode === "line" && look.direction !== "height";
    for (let k = 0; k < 3; k += 1) {
      const g = group[t * 3 + k];
      const id = corner[t * 3 + k];
      const p = [points[id * 3], points[id * 3 + 1], points[id * 3 + 2]];
      const moved = [p[0] + shift[g * 2] * (factor - 1), p[1] + shift[g * 2 + 1] * (factor - 1), p[2]];
      if (along) indices.push(vertex(moved, stationAt(t, p) / (2 * look.width), v));
      else {
        const known = groundShared.get(g);
        indices.push(known !== undefined ? known : sharedVertex(groundShared, g, moved, effectU(look, moved, 0, span), v));
      }
    }
  }
  const ground = indices.length;

  /* Стенки: отрезки оси, общие точки у соседних ячеек. */
  let walls = 0;
  if (project.height > 0) {
    const top = project.height;
    for (const segment of segments) {
      const look = looks[segment.colour];
      const v = mslBandV(segment.colour);
      const ids = [segment.a, segment.b].map((key) => {
        const item = nodes.get(key);
        return [0, 1].map((level) => {
          const point = [item.point[0], item.point[1], item.point[2] + level * top];
          let u;
          if (look.mode === "line") u = look.direction === "height" ? level * (top / (2 * look.width)) : item.station / (2 * look.width);
          else u = effectU(look, point, level, span);
          return sharedVertex(wallShared[level], key, point, u, v);
        });
      });
      const [[b0, t0], [b1, t1]] = ids;
      /* Двусторонняя: обе намотки. */
      indices.push(b0, b1, t1, b0, t1, t0, b0, t1, b1, b0, t0, t1);
      walls += 1;
    }
  }
  return {
    positions: Float32Array.from(positions),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
    ground,
    walls,
  };
}

/* ------------------------------------------------------------------ *
 * Плитки
 * ------------------------------------------------------------------ */

/** Сторона плитки для дальности, м: на 25 м — 25, от 400 м — 400. */
export function mslTileSide(drawDistance) {
  const value = Math.round(Number(drawDistance) / 5) * 5;
  return Math.min(MSL_TILE, Math.max(MSL_TILE_MIN, Number.isFinite(value) ? value : MSL_TILE));
}

/* Ключ плитки треугольника — по его середине (число: столбец и ряд). */
function tileKeys(mesh, tile) {
  const { positions, indices } = mesh;
  const keys = new Float64Array(Math.floor(indices.length / 3));
  for (let t = 0; t + 2 < indices.length; t += 3) {
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < 3; k += 1) {
      cx += positions[indices[t + k] * 3] / 3;
      cy += positions[indices[t + k] * 3 + 1] / 3;
    }
    keys[t / 3] = (Math.floor(cx / tile) + 50000) * 100000 + (Math.floor(cy / tile) + 50000);
  }
  return keys;
}
const tileName = (key) => `${Math.floor(key / 100000) - 50000},${(key % 100000) - 50000}`;

/** Сколько плиток у сетки при стороне `tile`. */
export const mslTileCount = (mesh, tile) => new Set(tileKeys(mesh, tile)).size;

/* Рамки плиток сетки: ключ → [минимум xyz, максимум xyz]. */
function tileBoxes(mesh, tile) {
  const { positions, indices } = mesh;
  const boxes = new Map();
  tileKeys(mesh, tile).forEach((key, at) => {
    let box = boxes.get(key);
    if (!box) {
      box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      boxes.set(key, box);
    }
    for (let k = 0; k < 3; k += 1) {
      const i = indices[at * 3 + k];
      for (let axis = 0; axis < 3; axis += 1) {
        box[axis] = Math.min(box[axis], positions[i * 3 + axis]);
        box[axis + 3] = Math.max(box[axis + 3], positions[i * 3 + axis]);
      }
    }
  });
  return boxes;
}

/**
 * Сторона плиток под работу для всех районов разом: по дальности, а если
 * моделей выходит больше бюджета (или больше имён на район) — крупнее,
 * шагами по 15 %. `meshes` — сетки районов (у кадра — ленты из сцены).
 * Ответ — `{ side, tiles, perDistrict }`.
 */
export function mslZonesTilePlan(meshes, input, { budget = MSL_TILE_BUDGET, perDistrict = MSL_TILES_PER_DISTRICT } = {}) {
  const project = normalizeMslZonesProject(input);
  let side = mslTileSide(project.drawDistance);
  for (;;) {
    const counts = meshes.map((mesh) => (mesh ? mslTileCount(mesh, side) : 0));
    const tiles = counts.reduce((sum, value) => sum + value, 0);
    if ((tiles <= budget && Math.max(0, ...counts) <= perDistrict) || side >= MSL_TILE) return { side, tiles, perDistrict: counts };
    side = Math.min(MSL_TILE, Math.ceil((side * 1.15) / 5) * 5);
  }
}

/**
 * Модель района плитками `tile` м: у каждой плитки своя сетка (точки — от
 * центра плитки), центр в мире и дальность «заданная + радиус плитки».
 * Треугольник уходит в плитку по своему центру.
 */
export function mslZonesTiles(mesh, origin, input, tile = MSL_TILE) {
  const project = normalizeMslZonesProject(input);
  const { positions, uvs, indices } = mesh;
  const keys = tileKeys(mesh, tile);
  const groups = new Map();
  keys.forEach((key, at) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(at * 3);
  });
  const tiles = [];
  for (const [key, triangles] of groups) {
    const remap = new Map();
    const local = [];
    const localUv = [];
    const localIndex = [];
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const t of triangles)
      for (let k = 0; k < 3; k += 1) {
        const i = indices[t + k];
        if (!remap.has(i)) {
          remap.set(i, remap.size);
          const x = positions[i * 3];
          const y = positions[i * 3 + 1];
          const z = positions[i * 3 + 2];
          local.push(x, y, z);
          localUv.push(uvs[i * 2], uvs[i * 2 + 1]);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          maxZ = Math.max(maxZ, z);
        }
        localIndex.push(remap.get(i));
      }
    const centre = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    for (let at = 0; at < local.length; at += 3) {
      local[at] -= centre[0];
      local[at + 1] -= centre[1];
      local[at + 2] -= centre[2];
    }
    const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    tiles.push({
      key: tileName(key),
      order: key,
      position: [origin[0] + centre[0], origin[1] + centre[1], origin[2] + centre[2]],
      positions: new Float32Array(local),
      uvs: new Float32Array(localUv),
      indices: new Uint32Array(localIndex),
      bounds: { min: [minX - centre[0], minY - centre[1], minZ - centre[2]], max: [maxX - centre[0], maxY - centre[1], maxZ - centre[2]] },
      radius,
      lodDist: Math.ceil(project.drawDistance + radius),
    });
  }
  return tiles.sort((a, b) => a.order - b.order);
}

/**
 * Когда линия появится в игре при стороне плиток `tile`: `{ tiles, near,
 * typical, far }` — линию видно наверняка с `near` м (дальность работы);
 * кусок появляется, когда до его середины остаётся «дальность + радиус», —
 * до ближней своей точки это обычно `typical` м и не дальше `far` м.
 */
export function mslAppearance(meshes, input, tile) {
  const project = normalizeMslZonesProject(input);
  let tiles = 0;
  let far = project.drawDistance;
  let sum = 0;
  for (const mesh of meshes) {
    if (!mesh) continue;
    for (const box of tileBoxes(mesh, tile).values()) {
      const radius = Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2]) / 2;
      /* Ближняя точка куска — в среднем на радиус ближе середины. */
      const appear = Math.ceil(project.drawDistance + radius);
      tiles += 1;
      sum += appear;
      far = Math.max(far, appear + radius);
    }
  }
  return { tiles, near: project.drawDistance, typical: tiles ? Math.round(sum / tiles) : project.drawDistance, far: Math.round(far) };
}

/** Цвета линий для подписи и обложки. */
export function mslZonesSwatch(input) {
  const project = normalizeMslZonesProject(input);
  if (!project.ownColour) return MSL_PALETTE.map((item) => normalizeRecolourHex(`#${colourEffectAt(mslColourLook(project, item.id), 0).map((value) => value.toString(16).padStart(2, "0")).join("")}`));
  const effect = project.look;
  return [0, 0.5, 1].map((t) => normalizeRecolourHex(`#${colourEffectAt(effect, t).map((value) => value.toString(16).padStart(2, "0")).join("")}`));
}

/* Цвет облика (hex) в доле `t` — для схем и строк списка. */
export const mslLookHex = (look, t = 0) => normalizeRecolourHex(`#${colourEffectAt(look, t).map((value) => value.toString(16).padStart(2, "0")).join("")}`);
export { hexBytes };
