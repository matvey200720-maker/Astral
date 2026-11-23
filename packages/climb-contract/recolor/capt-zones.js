/*
 * Зоны каптов (ТЗ 10.10.2026, вечер, задача 8: «Добавить зоны для каптов,
 * возможность редактировать цвет, прозрачность»).
 *
 * Мод `heix.rpf` ставит над районами каптов полупрозрачные «шайбы» —
 * тринадцать каптов и одну над ангаром арены в аэропорту. Форма у всех одна
 * (`inventory/capt-zones.js`, `scripts/prepare-capt-zones.mjs`): замкнутый
 * 64-угольный цилиндр — стенка от глубоко под землёй до верха над серединой
 * зоны, крыша и дно; каждая грань в обе стороны, чтобы зону было видно и
 * снаружи, и изнутри. Шейдер `emissive` (`emissive_alpha.sps`), лист — клетка
 * 4×4: оранжевый #ffb64a с альфой 64 из 255 (у Муравейника #ff8e4a и 77),
 * свечение ×2, дальность 200 м от середины.
 *
 * Работа человека: облик (цвет общим словарём эффектов мастерской — ровный,
 * градиент, радуга, перелив, линия двумя цветами) и прозрачность — у всех
 * зон сразу и у каждой своя; свечение; высота стенки и крыша; с какого
 * расстояния зону видно. «Стандарт» — зон Astral в игре нет (установка
 * снимается); «Как в моде» — облик автора.
 *
 * Сетку зоны строит одна функция (`captZoneMesh`) — и для кадра, и для
 * установщика: та же форма, что у мода, а развёртка — по эффекту (по кругу,
 * с запада на восток, снизу вверх). Модели в игру собирает нативный хост
 * своими именами (`astral_capt_<место>`): у человека может стоять и сам мод,
 * и чужие архетипы не перекрываются.
 */

import { bytesHex, hexBytes } from "./colour.js";
import { colourEffectAt, colourEffectStrip, normalizeColourEffect } from "./colour-effects.js";
import CAPT_ZONES_INVENTORY from "./inventory/capt-zones.js";

export { CAPT_ZONES_INVENTORY };

export const CAPT_ZONES_SCHEMA = 1;
export const CAPT_ZONES_SLOT = "capt-zones";
export const CAPT_ZONES_SEGMENTS = CAPT_ZONES_INVENTORY.segments;
/* Свои имена в игре: модель на зону, общие типы и карта. */
export const CAPT_ZONES_MODEL_PREFIX = "astral_capt_";
export const CAPT_ZONES_TYPES = "astral_captzones";
export const CAPT_ZONES_MAP = "astral_captzones";
const NAME_LIMIT = 60;

/*
 * Как зоны зовут на серверах (имена моделей мода) и где они на карте —
 * районы по зонам игры (`popzone.ipl`) в точке сущности.
 */
const ZONE_NAMES = Object.freeze({
  vetryaki: { label: "Ветряки", place: "ветряная электростанция Ron" },
  zavod: { label: "Завод", place: "Ранчо, у Сайпресс-Флэтс" },
  mirror: { label: "Миррор-Парк", place: "восток Лос-Сантоса" },
  muraveinik: { label: "Муравейник", place: "Ранчо" },
  osobnyak: { label: "Особняк", place: "Ричман" },
  paleto: { label: "Палето", place: "Палето-Бэй" },
  pirc: { label: "Пирс", place: "пляж Дель-Перро" },
  rockford: { label: "Рокфорд", place: "Рокфорд-Хиллз" },
  stroyka: { label: "Стройка", place: "у трассы Редвуд-Лайтс" },
  sandy: { label: "Сэнди", place: "Сэнди-Шорс" },
  tatu: { label: "Тату", place: "Эль-Бурро-Хайтс" },
  farm: { label: "Ферма", place: "Грейпсид" },
  cercov: { label: "Церковь", place: "Строберри" },
  angar: { label: "Арена", place: "ангар в аэропорту Лос-Сантоса" },
});

/** Зоны: капты по алфавиту, арена последней. */
export const CAPT_ZONES = Object.freeze(
  Object.keys(ZONE_NAMES).map((id) => {
    const zone = CAPT_ZONES_INVENTORY.zones.find((item) => item.id === id);
    if (!zone) throw new Error(`В описи зон каптов нет зоны ${id}.`);
    return Object.freeze({ ...zone, ...ZONE_NAMES[id] });
  }),
);
export const CAPT_ZONE_IDS = Object.freeze(CAPT_ZONES.map((zone) => zone.id));
export const findCaptZone = (id) => CAPT_ZONES.find((zone) => zone.id === id) || null;
export const captZoneModel = (zone) => `${CAPT_ZONES_MODEL_PREFIX}${zone.id}`;

/* Облик мода: общий — у двенадцати каптов и арены, свой — у Муравейника. */
const modZone = (id) => CAPT_ZONES_INVENTORY.zones.find((zone) => zone.id === id);
const opacityOfAlpha = (alpha) => Math.round((alpha / 255) * 1000) / 10;
export const CAPT_ZONES_MOD = Object.freeze({
  colour: modZone("cercov").colour,
  opacity: opacityOfAlpha(modZone("cercov").alpha),
  glow: modZone("cercov").glow,
  lodDist: modZone("cercov").lodDist,
});
const MOD_OVERRIDES = Object.freeze(
  Object.fromEntries(
    CAPT_ZONES_INVENTORY.zones
      .filter((zone) => zone.colour !== CAPT_ZONES_MOD.colour || opacityOfAlpha(zone.alpha) !== CAPT_ZONES_MOD.opacity)
      .map((zone) => [zone.id, Object.freeze({ look: Object.freeze({ mode: "solid", colour: zone.colour }), opacity: opacityOfAlpha(zone.alpha) })]),
  ),
);

export const CAPT_ZONES_LIMITS = Object.freeze({
  opacity: Object.freeze([0, 100]),
  glow: Object.freeze([0, 10]),
  /* Высота стенки над серединой зоны — доля высоты у мода. */
  height: Object.freeze([25, 300]),
  /* С какого расстояния до края зону видно, м. */
  distance: Object.freeze([0, 3000]),
});
/* Дальность у мода — 200 м от середины зоны: «как в моде». */
export const CAPT_ZONES_MOD_DISTANCE = "mod";
/* Предел дальности у нативного хоста (`compile-placements`). */
const MAX_LOD = 20000;

/* Направления эффектов на шайбе: по кругу, с запада на восток, снизу вверх. */
export const CAPT_ZONES_DIRECTIONS = Object.freeze({ along: "По кругу", across: "С запада на восток", height: "Снизу вверх" });

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
const solid = (colour) => ({ mode: "solid", colour });

function normalizeDistance(value) {
  if (value === CAPT_ZONES_MOD_DISTANCE || value === undefined || value === null) return CAPT_ZONES_MOD_DISTANCE;
  const number = Number(value);
  if (!Number.isFinite(number)) return CAPT_ZONES_MOD_DISTANCE;
  return Math.round(Math.min(CAPT_ZONES_LIMITS.distance[1], Math.max(CAPT_ZONES_LIMITS.distance[0], number)) / 5) * 5;
}

/* Своё у зоны поверх общего: облик и (или) прозрачность. */
function normalizeOwn(input, fallbackLook) {
  const source = plain(input);
  const out = {};
  if (source.look) out.look = normalizeColourEffect(source.look, fallbackLook);
  if (source.opacity !== undefined && source.opacity !== null) {
    const opacity = clamp(source.opacity, CAPT_ZONES_LIMITS.opacity, null, 1);
    if (opacity !== null) out.opacity = opacity;
  }
  return Object.keys(out).length ? out : null;
}

export function createCaptZonesProject() {
  return normalizeCaptZonesProject({});
}

/**
 * Работа в порядке; лишние поля отбрасываются молча. Без `zones` — свои
 * облики мода (у Муравейника клетка краснее и гуще остальных).
 */
export function normalizeCaptZonesProject(input) {
  const source = plain(input);
  const look = normalizeColourEffect(source.look, { mode: "solid", colour: CAPT_ZONES_MOD.colour, colour2: "#ffffff", direction: "along", width: 6 });
  const zones = {};
  const own = source.zones === undefined ? MOD_OVERRIDES : plain(source.zones);
  for (const id of CAPT_ZONE_IDS) {
    const item = normalizeOwn(own[id], look);
    if (item) zones[id] = item;
  }
  return {
    schema: CAPT_ZONES_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    /* «Стандарт» — зон Astral в игре нет. */
    enabled: source.enabled !== false,
    look,
    opacity: clamp(source.opacity, CAPT_ZONES_LIMITS.opacity, CAPT_ZONES_MOD.opacity, 1),
    zones,
    glow: clamp(source.glow, CAPT_ZONES_LIMITS.glow, CAPT_ZONES_MOD.glow, 1),
    height: clamp(source.height, CAPT_ZONES_LIMITS.height, 100),
    roof: source.roof !== false,
    distance: normalizeDistance(source.distance),
  };
}

export const serializeCaptZonesProject = (project) => JSON.stringify(normalizeCaptZonesProject(project));

export function parseCaptZonesProject(text) {
  try {
    return normalizeCaptZonesProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createCaptZonesProject();
  }
}

/** Отпечаток для очереди «Применить»: та же работа — тот же отпечаток. */
export function captZonesSignature(input) {
  const { name: _name, schema: _schema, ...rest } = normalizeCaptZonesProject(input);
  return JSON.stringify(rest);
}

/** Облик автора мода целиком (имя работы не в счёт). */
export const captZonesIsMod = (input) => captZonesSignature(input) === captZonesSignature(createCaptZonesProject());

/* Альфа текстуры (0…255) при плотности `opacity` %. */
export const captZonesAlpha = (opacity) => Math.round((clamp(opacity, CAPT_ZONES_LIMITS.opacity, 0, 1) / 100) * 255);

/**
 * Облик одной зоны: эффект (свой или общий), плотность, цвет для подписи
 * (у эффекта — середина полосы), альфа, свечение. Невидимая зона (альфа 0
 * или «Стандарт») в игру не едет вовсе.
 */
export function captZoneLook(input, zone) {
  const project = normalizeCaptZonesProject(input);
  const own = project.zones[zone.id] || {};
  const effect = own.look || project.look;
  const opacity = own.opacity ?? project.opacity;
  const alpha = captZonesAlpha(opacity);
  const hidden = !project.enabled || alpha === 0;
  const colour = effect.mode === "solid" ? effect.colour : bytesHex(colourEffectAt(effect, 0.5));
  return {
    id: zone.id,
    effect,
    colour,
    opacity,
    alpha: hidden ? 0 : alpha,
    glow: hidden ? 0 : project.glow,
    hidden,
    own: { look: Boolean(own.look), opacity: own.opacity !== undefined },
  };
}

/** «Стандарт»: зон нет — выключены или все прозрачны до конца. */
export const captZonesIsStock = (input) => {
  const project = normalizeCaptZonesProject(input);
  return !project.enabled || CAPT_ZONES.every((zone) => captZoneLook(project, zone).hidden);
};

/** Сколько зон со своим обликом или прозрачностью. */
export const captZonesOwnCount = (input) => Object.keys(normalizeCaptZonesProject(input).zones).length;

export const applyCaptZonesStandard = (input) => normalizeCaptZonesProject({ ...normalizeCaptZonesProject(input), enabled: false });
/** «Как в моде»: облик автора, имя работы остаётся. */
export const resetCaptZonesProject = (input) => normalizeCaptZonesProject({ name: normalizeCaptZonesProject(input).name });

/* ------------------------------------------------------------------ *
 * Форма и место
 * ------------------------------------------------------------------ */

/** Верх стенки над серединой зоны, м. */
export const captZoneTop = (zone, input) => Math.round(zone.top * (normalizeCaptZonesProject(input).height / 100) * 100) / 100;

/**
 * Дальность сущности (игра считает её от точки сущности — середины зоны):
 * «как в моде» — 200 м от середины, иначе — край зоны плюс заданное.
 */
export function captZoneLodDist(zone, input) {
  const { distance } = normalizeCaptZonesProject(input);
  if (distance === CAPT_ZONES_MOD_DISTANCE) return zone.lodDist;
  return Math.min(MAX_LOD, Math.round(zone.radius + distance));
}

/* Ширина полосы листа эффекта: ровный — клетка 4×4, линия — 8, остальные — 64. */
const stripWidth = (effect) => (effect.mode === "solid" ? 4 : effect.mode === "line" ? 8 : 64);

/**
 * Лист зоны: полоса цветов эффекта (четыре одинаковые строки — GTA и
 * CodeWalker не любят листов в строку) с альфой прозрачности.
 * `{ width, height, rgba }`.
 */
export function captZoneTexture(input, zone) {
  const look = captZoneLook(input, zone);
  const strip = colourEffectStrip(look.effect, 64);
  const width = strip.length / 4;
  const height = 4;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (row * width + x) * 4;
      rgba[at] = strip[x * 4];
      rgba[at + 1] = strip[x * 4 + 1];
      rgba[at + 2] = strip[x * 4 + 2];
      rgba[at + 3] = look.alpha;
    }
  return { width, height, rgba };
}

/*
 * Доля эффекта в точке шайбы. `f` — доля оборота (0…1) от востока против
 * часовой. У линии — номер полосы (дробный: лист повторяется), у остальных
 * — от 0 (первый цвет) до 1. Градиент по кругу идёт туда и обратно — без
 * шва на востоке; радуга и перелив по кругу замкнуты сами, линия ложится
 * целым числом полос. «Снизу вверх» — от земли в середине зоны до верха
 * стенки: под землёй лежит первый цвет, на склонах ниже середины полоса не
 * повторяется.
 */
function shareOf(effect, { radius, top }) {
  const turns = Math.max(1, Math.round((Math.PI * 2 * radius) / (2 * effect.width)));
  return (x, y, z, f) => {
    const above = Math.max(0, z);
    if (effect.mode === "line") {
      if (effect.direction === "along") return f * turns;
      if (effect.direction === "across") return (x + radius) / (2 * effect.width);
      return above / (2 * effect.width);
    }
    if (effect.direction === "along") return effect.mode === "gradient" ? 1 - Math.abs(2 * f - 1) : f;
    if (effect.direction === "across") return (x + radius) / (2 * radius);
    return above / Math.max(0.01, top);
  };
}

/* Развёртка точки: `u` — по полосе листа (у ровного — середина клетки, у
   градиентов — по центрам крайних текселей), `v` — середина строки. */
function uvOf(effect, shape) {
  const width = stripWidth(effect);
  const share = shareOf(effect, shape);
  const texel = (t) => (0.5 + Math.min(1, Math.max(0, t)) * (width - 1)) / width;
  return (x, y, z, f) => {
    if (effect.mode === "solid") return [0.5, 0.5];
    const t = share(x, y, z, f);
    return [effect.mode === "line" ? t : texel(t), 0.5];
  };
}

/**
 * Цвет облика зоны в точке шайбы `[r, g, b]` — для плиток и обложки (2D):
 * та же доля эффекта, что у развёртки модели.
 */
export function captZoneColourAt(input, zone) {
  const project = normalizeCaptZonesProject(input);
  const look = captZoneLook(project, zone);
  const share = shareOf(look.effect, { radius: zone.radius, top: captZoneTop(zone, project) });
  return (x, y, z) => {
    if (look.effect.mode === "solid") return hexBytes(look.effect.colour);
    const turn = Math.atan2(y, x) / (Math.PI * 2);
    const t = share(x, y, z, turn < 0 ? turn + 1 : turn);
    return colourEffectAt(look.effect, look.effect.mode === "line" ? t - Math.floor(t) : t);
  };
}

/**
 * Сетка шайбы зоны — одна у кадра и установщика: 64-угольник радиуса мода,
 * стенка от низа мода (под землёй) до верха работы — с кольцом на уровне
 * середины зоны (там начинается «снизу вверх»), крыша (если она есть) и
 * дно; каждая грань — в обе стороны. Оси игры, от точки сущности.
 *
 * `aboveGround` — только то, что над землёй в середине зоны (кадр: земля
 * кадра ровная, а под ней в игре — склоны и низины, ради которых стенка у
 * мода уходит вниз на десятки метров). `floor` — до какой глубины (м от точки
 * зоны, отрицательное) стенку показать, если она уходит ниже: кадр с настоящей
 * местностью обрезает её чуть ниже самой низкой земли — установщик не передаёт.
 *
 * Возвращает `{ positions, normals, uvs, indices, bounds, top, bottom }`.
 */
export function captZoneMesh(zone, input, { aboveGround = false, floor = null } = {}) {
  const project = normalizeCaptZonesProject(input);
  const look = captZoneLook(project, zone);
  const segments = CAPT_ZONES_SEGMENTS;
  const radius = zone.radius;
  const top = captZoneTop(zone, project);
  const bottom = aboveGround ? 0 : floor === null ? zone.bottom : Math.max(zone.bottom, Math.min(0, floor));
  const uv = uvOf(look.effect, { radius, top });
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let count = 0;
  const vertex = (x, y, z, normal, f) => {
    positions.push(x, y, z);
    normals.push(...normal);
    uvs.push(...uv(x, y, z, f));
    count += 1;
    return count - 1;
  };
  const corner = (k) => {
    const angle = (k / segments) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  };
  /* Стенка: лицо наружу и лицо внутрь — у каждого свои вершины (нормали). */
  const sections = bottom < 0 ? [[bottom, 0], [0, top]] : [[bottom, top]];
  for (const [low, high] of sections)
    for (const outward of [true, false]) {
      const lower = [];
      const upper = [];
      for (let k = 0; k <= segments; k += 1) {
        const [c, s] = corner(k);
        const normal = outward ? [c, s, 0] : [-c, -s, 0];
        lower.push(vertex(radius * c, radius * s, low, normal, k / segments));
        upper.push(vertex(radius * c, radius * s, high, normal, k / segments));
      }
      for (let k = 0; k < segments; k += 1) {
        if (outward) indices.push(lower[k], lower[k + 1], upper[k + 1], lower[k], upper[k + 1], upper[k]);
        else indices.push(lower[k], upper[k + 1], lower[k + 1], lower[k], upper[k], upper[k + 1]);
      }
    }
  /* Крыша и дно — веером от середины: у каждого треугольника своя середина
     (развёртка «по кругу» — по середине его угла). */
  const cap = (z, up) => {
    for (const outward of [true, false]) {
      const facing = up === outward ? [0, 0, 1] : [0, 0, -1];
      const rim = [];
      for (let k = 0; k <= segments; k += 1) {
        const [c, s] = corner(k);
        rim.push(vertex(radius * c, radius * s, z, facing, k / segments));
      }
      for (let k = 0; k < segments; k += 1) {
        const middle = vertex(0, 0, z, facing, (k + 0.5) / segments);
        if (facing[2] > 0) indices.push(middle, rim[k], rim[k + 1]);
        else indices.push(middle, rim[k + 1], rim[k]);
      }
    }
  };
  if (project.roof) cap(top, true);
  if (!aboveGround) cap(bottom, false);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    bounds: { min: [-radius, -radius, bottom], max: [radius, radius, top] },
    top,
    bottom,
  };
}

/**
 * Что уходит в игру: видимые зоны — модель, лист, шейдер, свечение, точка и
 * дальность. Прозрачные до конца (и все — у «Стандарта») не едут.
 */
export function captZonesBuildPlan(input) {
  const project = normalizeCaptZonesProject(input);
  return CAPT_ZONES.map((zone) => ({ zone, look: captZoneLook(project, zone) }))
    .filter(({ look }) => !look.hidden)
    .map(({ zone, look }) => ({
      id: zone.id,
      model: captZoneModel(zone),
      look,
      mesh: captZoneMesh(zone, project),
      texture: captZoneTexture(project, zone),
      shaderFile: look.alpha < 255 ? "emissive_alpha.sps" : "emissive.sps",
      glow: look.glow,
      position: zone.position,
      lodDist: captZoneLodDist(zone, project),
      archetypeFlags: zone.archetypeFlags,
      entityFlags: zone.entityFlags,
    }));
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

/*
 * Готовый вид меняет облик всех зон разом — цвет, прозрачность и свечение;
 * свои облики зон сбрасываются, форма стенки и дальность остаются.
 */
export const CAPT_ZONES_PRESETS = Object.freeze([
  Object.freeze({
    id: "mod",
    label: "Облик мода",
    description: "Оранжевая дымка, у Муравейника гуще — как у автора мода.",
    look: solid(CAPT_ZONES_MOD.colour),
    opacity: CAPT_ZONES_MOD.opacity,
    glow: CAPT_ZONES_MOD.glow,
    zones: MOD_OVERRIDES,
  }),
  Object.freeze({ id: "hint", label: "Лёгкий отлив", description: "Едва заметные стенки: видно вблизи, стрелять не мешают.", look: solid("#ffc46b"), opacity: 12, glow: 1.5 }),
  Object.freeze({ id: "dense", label: "Плотные", description: "Гуще мода — границу видно издалека.", look: solid("#ff9d2e"), opacity: 55, glow: 2 }),
  Object.freeze({ id: "red", label: "Красные", description: "Тревожный красный: здесь идёт капт.", look: solid("#ff2f2f"), opacity: 30, glow: 2.5 }),
  Object.freeze({ id: "neon", label: "Неон", description: "Бирюзовое свечение — ярче ночью.", look: solid("#00ffd5"), opacity: 28, glow: 5 }),
  Object.freeze({
    id: "tape",
    label: "Сигнальная лента",
    description: "Жёлтые и чёрные полосы по кругу, как ограждение.",
    look: { mode: "line", colour: "#ffd400", colour2: "#1a1a1a", direction: "along", width: 6 },
    opacity: 45,
    glow: 2,
  }),
  Object.freeze({ id: "rainbow", label: "Радуга", description: "Радуга по кругу каждой зоны.", look: { mode: "rainbow", direction: "along" }, opacity: 35, glow: 2 }),
  Object.freeze({
    id: "sunset",
    label: "Закат",
    description: "У земли оранжевый, к верху фиолетовый.",
    look: { mode: "gradient", colour: "#ff8a1f", colour2: "#9b5cff", direction: "height" },
    opacity: 35,
    glow: 2,
  }),
  Object.freeze({ id: "colourblind", label: "Для дальтоников", description: "Жёлтый — различим при любой слепоте.", look: solid("#ffd400"), opacity: 30, glow: 2 }),
  Object.freeze({ id: "ghost", label: "Белая дымка", description: "Светлая дымка, спокойная для глаз.", look: solid("#f4f7ff"), opacity: 16, glow: 1 }),
]);

export const findCaptZonesPreset = (id) => CAPT_ZONES_PRESETS.find((preset) => preset.id === id) || null;

export function applyCaptZonesPreset(input, presetId) {
  const project = normalizeCaptZonesProject(input);
  const preset = findCaptZonesPreset(presetId);
  if (!preset) return project;
  return normalizeCaptZonesProject({ ...project, enabled: true, look: preset.look, opacity: preset.opacity, glow: preset.glow, zones: preset.zones || {} });
}

/** Готовый вид, с которым совпадает облик работы (форма и дальность не в счёт). */
export function matchingCaptZonesPreset(input) {
  const project = normalizeCaptZonesProject(input);
  if (!project.enabled) return null;
  const own = captZonesSignature(project);
  return CAPT_ZONES_PRESETS.find((preset) => captZonesSignature(applyCaptZonesPreset(project, preset.id)) === own)?.id || null;
}

/** Образец цвета зоны для списков и плиток: `[r, g, b]` середины облика. */
export const captZoneSwatch = (input, zone) => hexBytes(captZoneLook(input, zone).colour);
