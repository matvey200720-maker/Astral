/*
 * Прострелы: подсветка простреливаемых укрытий на каптах.
 *
 * Мод прострелов кладёт поверх укрытий, которые пробивает пуля, оболочки в
 * их форму — синие и полупрозрачные. Форму оболочки задаёт сетка модели, а
 * облик — зашитая текстура 4×4 одного цвета (цвет и альфа) и множитель
 * свечения шейдера `emissive`. Поэтому правка здесь — не рисунок, а три
 * числа на оболочку: цвет, заливка (альфа текстуры) и свечение
 * (`emissiveMultiplier`). Их установщик и пишет в модели на месте
 * (`patchDrawable` из `@modovik/ypt`), геометрия и места остаются модовыми.
 *
 * Работа — общий облик и, по желанию, свой у отдельного укрытия («дома
 * синим, мусорки красным»); укрытие можно и скрыть — его модель уедет
 * прозрачной, место в расстановке останется.
 *
 * Отдельным пакетом воркспейса этот контракт не заведён намеренно: новый
 * пакет требует `npm install`, а ярлык «Астрал» подтягивает main без него —
 * и dev-запуск падал целиком «Cannot find package '@modovik/…'». Прострелы
 * живут рядом с залазами: это один мод одного автора, и ставились они
 * раньше одним архивом.
 */

import {
  WALLBANG_CONTAINER,
  WALLBANG_KINDS,
  WALLBANG_MAP_NAME,
  WALLBANG_OBJECTS,
  WALLBANG_TYPES_NAME,
  WALLBANG_ZONE_NAMES,
  wallbangAssetName,
} from "./objects.js";
import {
  WALLBANG_BOUNDS,
  WALLBANG_PLACEMENTS,
  WALLBANG_RESOURCES,
  WALLBANG_SHAPES,
  WALLBANG_SOURCE,
} from "./placements.js";

export {
  WALLBANG_BOUNDS,
  WALLBANG_CONTAINER,
  WALLBANG_KINDS,
  WALLBANG_MAP_NAME,
  WALLBANG_OBJECTS,
  WALLBANG_PLACEMENTS,
  WALLBANG_RESOURCES,
  WALLBANG_SHAPES,
  WALLBANG_SOURCE,
  WALLBANG_TYPES_NAME,
  WALLBANG_ZONE_NAMES,
  wallbangAssetName,
};

export const WALLBANG_PROJECT_SCHEMA = 1;

/* Имя зашитой текстуры оболочки: так её назвал автор мода («red», хотя
   цвет синий), и так её ищет правка на месте. */
export const WALLBANG_TEXTURE_NAME = "red";
/* 4×4 DXT5, три уровня: 4×4, 2×2, 1×1 — по блоку в 16 байт на уровень. */
export const WALLBANG_TEXTURE_BYTES = 48;
export const WALLBANG_EMISSIVE_PARAMETER = "emissiveMultiplier";

/*
 * Пределы. Заливка — проценты непрозрачности оболочки: ниже 5 % укрытие
 * в игре уже не различить, и такую «подсветку» честнее скрыть выключателем.
 * Свечение — ступень шкалы 0…100, середина — как у мода (множитель ×1).
 */
export const WALLBANG_LIMITS = Object.freeze({
  opacity: Object.freeze([5, 100]),
  glow: Object.freeze([0, 100]),
});
const NAME_LIMIT = 60;

/* Облик самого мода: чистый синий, альфа 100 из 255 (39,2 %), свечение ×1. */
export const WALLBANG_MOD_LOOK = Object.freeze({
  colour: "#0000ff",
  opacity: 39.2,
  glow: 50,
});

export const WALLBANG_PLACEMENT_COUNT = Object.values(
  WALLBANG_PLACEMENTS,
).reduce((sum, list) => sum + list.length, 0);

const OBJECT_IDS = Object.freeze(WALLBANG_OBJECTS.map((item) => item.id));
const KIND_IDS = Object.freeze(WALLBANG_KINDS.map((item) => item.id));

export const findWallbangObject = (id) =>
  WALLBANG_OBJECTS.find((item) => item.id === id) || null;
export const findWallbangKind = (id) =>
  WALLBANG_KINDS.find((item) => item.id === id) || null;

/* ------------------------------------------------------------------ *
 * Числа
 * ------------------------------------------------------------------ */

const plain = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function normalizeWallbangColour(value, fallback = "#0000ff") {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text))
    return `#${[...text.slice(1)].map((char) => char + char).join("")}`.toLowerCase();
  return fallback;
}

/* Заливка — с точностью до десятой: иначе облик мода (альфа 100 = 39,2 %)
   нельзя было бы записать ровно. */
function clampOpacity(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const [low, high] = WALLBANG_LIMITS.opacity;
  return Math.round(Math.min(high, Math.max(low, number)) * 10) / 10;
}

function clampGlow(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const [low, high] = WALLBANG_LIMITS.glow;
  return Math.round(Math.min(high, Math.max(low, number)));
}

export const wallbangHexRgb = (hex) => {
  const value = normalizeWallbangColour(hex);
  return [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
};

/** Альфа текстуры оболочки из заливки в процентах. */
export const wallbangAlpha = (opacity) =>
  Math.round((clampOpacity(opacity, WALLBANG_MOD_LOOK.opacity) / 100) * 255);

/*
 * Свечение: ступень шкалы → `emissiveMultiplier`. Шкала логарифмическая —
 * три удвоения в каждую сторону от середины: 0 — ×⅛ (почти не светится,
 * ночью оболочку видно только под фонарём), 50 — ×1, как у мода, 100 — ×8
 * (ночью неон с ореолом). Равный шаг ползунка — равная разница на глаз.
 */
export function wallbangEmissive(glow) {
  const level = clampGlow(glow, WALLBANG_MOD_LOOK.glow);
  return Math.round(8 ** ((level - 50) / 50) * 10000) / 10000;
}

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

function createObjects(look) {
  return Object.fromEntries(
    OBJECT_IDS.map((id) => [
      id,
      { visible: true, own: false, colour: look.colour, opacity: look.opacity },
    ]),
  );
}

/** Новая работа — облик мода на всех укрытиях. */
export function createWallbangProject() {
  const look = { ...WALLBANG_MOD_LOOK };
  return {
    schema: WALLBANG_PROJECT_SCHEMA,
    name: "",
    look,
    objects: createObjects(look),
  };
}

/**
 * Приводит работу в порядок: пределы, известные укрытия. Лишние поля
 * отбрасываются молча — код из более новой версии Astral открывается в
 * старой тем, что она понимает, а не отказом. Своё значение у укрытия
 * хранится и тогда, когда «своя подсветка» выключена: включил обратно —
 * цвет вернулся.
 */
export function normalizeWallbangProject(input) {
  const source = plain(input);
  const rawLook = plain(source.look);
  const look = {
    colour: normalizeWallbangColour(rawLook.colour, WALLBANG_MOD_LOOK.colour),
    opacity: clampOpacity(rawLook.opacity, WALLBANG_MOD_LOOK.opacity),
    glow: clampGlow(rawLook.glow, WALLBANG_MOD_LOOK.glow),
  };
  const rawObjects = plain(source.objects);
  const objects = {};
  for (const id of OBJECT_IDS) {
    const item = plain(rawObjects[id]);
    objects[id] = {
      visible: item.visible !== false,
      own: item.own === true,
      colour: normalizeWallbangColour(item.colour, look.colour),
      opacity: clampOpacity(item.opacity, look.opacity),
    };
  }
  return {
    schema: WALLBANG_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    look,
    objects,
  };
}

export function serializeWallbangProject(project) {
  return JSON.stringify(normalizeWallbangProject(project));
}

export function parseWallbangProject(text) {
  try {
    return normalizeWallbangProject(
      typeof text === "string" ? JSON.parse(text) : text,
    );
  } catch {
    return createWallbangProject();
  }
}

/** Отпечаток для очереди «Применить»: та же работа — тот же отпечаток. */
export function wallbangProjectSignature(input) {
  const { name: _name, ...rest } = normalizeWallbangProject(input);
  return JSON.stringify(rest);
}

/**
 * Облик одного укрытия в игре: цвет, альфа и свечение его оболочки.
 *
 * Скрытое укрытие — не только альфа 0: цвет чёрный и свечение ноль. Шейдер
 * оболочки смешивает по альфе, но прозрачная модель, которая при этом
 * светится своим цветом, была бы невидимой только до первого шейдера,
 * складывающего свечение мимо альфы. Ноль во всём — ноль при любом.
 */
export function wallbangObjectLook(input, id) {
  const project = normalizeWallbangProject(input);
  const item = project.objects[id];
  if (!item) throw new RangeError(`Укрытия «${id}» в описи прострелов нет.`);
  const colour = item.own ? item.colour : project.look.colour;
  const opacity = item.own ? item.opacity : project.look.opacity;
  return {
    id,
    visible: item.visible,
    own: item.own,
    colour,
    rgb: item.visible ? wallbangHexRgb(colour) : [0, 0, 0],
    opacity,
    alpha: item.visible ? wallbangAlpha(opacity) : 0,
    emissive: item.visible ? wallbangEmissive(project.look.glow) : 0,
  };
}

export const wallbangVisibleObjects = (input) => {
  const project = normalizeWallbangProject(input);
  return OBJECT_IDS.filter((id) => project.objects[id].visible);
};

/** Все укрытия скрыты — в игру ставить нечего. */
export const wallbangProjectIsEmpty = (input) =>
  wallbangVisibleObjects(input).length === 0;

/* Облик совпадает с модом: тот же цвет, заливка и свечение, всё видно. */
export function wallbangProjectIsMod(input) {
  const project = normalizeWallbangProject(input);
  const same = (colour, opacity) =>
    colour === WALLBANG_MOD_LOOK.colour &&
    wallbangAlpha(opacity) === wallbangAlpha(WALLBANG_MOD_LOOK.opacity);
  return (
    project.look.glow === WALLBANG_MOD_LOOK.glow &&
    same(project.look.colour, project.look.opacity) &&
    OBJECT_IDS.every((id) => {
      const item = project.objects[id];
      return item.visible && (!item.own || same(item.colour, item.opacity));
    })
  );
}

/* ------------------------------------------------------------------ *
 * Текстура оболочки
 * ------------------------------------------------------------------ */

const expand5 = (value) => (value << 3) | (value >> 2);
const expand6 = (value) => (value << 2) | (value >> 4);

/*
 * Канал ровного цвета в блоке DXT: пара концов и индекс, дающие цвет
 * ближе всего к заказанному. Индекс общий на все каналы (блок ровный, у
 * всех шестнадцати точек он один), концы — у каждого канала свои. Поэтому
 * перебираются три варианта индекса целиком: 0 — точный конец, 2 — ⅔
 * первого и ⅓ второго, 3 — наоборот.
 */
function channelFor(target, bits) {
  const levels = 1 << bits;
  const expand = bits === 5 ? expand5 : expand6;
  const options = [];
  let exact = { error: Infinity };
  for (let a = 0; a < levels; a += 1) {
    const error = Math.abs(expand(a) - target);
    if (error < exact.error) exact = { error, c0: a, c1: a };
  }
  options[0] = exact;
  let third = { error: Infinity };
  for (let a = 0; a < levels; a += 1)
    for (let b = 0; b < levels; b += 1) {
      const value = (2 * expand(a) + expand(b)) / 3;
      const error = Math.abs(value - target);
      if (error < third.error) third = { error, c0: a, c1: b };
    }
  options[2] = third;
  return options;
}

/*
 * Блок DXT5 одного цвета: альфа точная (оба конца — альфа, индексы нули),
 * цвет — точный, если он есть в 5-6-5 (так записан синий мода, и облик мода
 * даёт его же байты), иначе ближайший из трети между концами. Концы при
 * интерполяции ставятся так, чтобы первый был больше второго: это
 * четырёхцветный режим и у декодеров, которые путают DXT5 с DXT1.
 */
export function wallbangDxt5Block(rgb, alpha) {
  const [r, g, b] = rgb.map((value) =>
    Math.max(0, Math.min(255, Math.round(value))),
  );
  const channels = [channelFor(r, 5), channelFor(g, 6), channelFor(b, 5)];
  const exactError =
    channels[0][0].error + channels[1][0].error + channels[2][0].error;
  const thirdError =
    channels[0][2].error + channels[1][2].error + channels[2][2].error;
  const useThird = thirdError < exactError;
  const pick = useThird ? 2 : 0;
  const pack = (end) =>
    (channels[0][pick][end] << 11) |
    (channels[1][pick][end] << 5) |
    channels[2][pick][end];
  let c0 = pack("c0");
  let c1 = pack("c1");
  let index = useThird ? 2 : 0;
  if (useThird && c0 < c1) {
    [c0, c1] = [c1, c0];
    index = 3;
  } else if (useThird && c0 === c1) index = 0;
  const block = new Uint8Array(16);
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  block[0] = a;
  block[1] = a;
  block[8] = c0 & 0xff;
  block[9] = c0 >> 8;
  block[10] = c1 & 0xff;
  block[11] = c1 >> 8;
  const indices = index * 0b01010101;
  block.fill(indices, 12, 16);
  return block;
}

/** Текстура оболочки целиком: три уровня одного и того же блока. */
export function wallbangTexturePayload(look) {
  const block = wallbangDxt5Block(look.rgb, look.alpha);
  const payload = new Uint8Array(WALLBANG_TEXTURE_BYTES);
  for (let level = 0; level < 3; level += 1) payload.set(block, level * 16);
  return payload;
}

/* ------------------------------------------------------------------ *
 * Районы
 * ------------------------------------------------------------------ */

/** Районы укрытия с числом мест: `[{ zone, label, places }]`, больше — раньше. */
export function wallbangObjectZones(id) {
  const counts = new Map();
  for (const place of WALLBANG_PLACEMENTS[id] || [])
    counts.set(place.zone, (counts.get(place.zone) || 0) + 1);
  return [...counts]
    .map(([zone, places]) => ({
      zone,
      label: WALLBANG_ZONE_NAMES[zone] || zone,
      places,
    }))
    .sort((a, b) => b.places - a.places || a.label.localeCompare(b.label));
}

export const wallbangObjectPlaces = (id) =>
  (WALLBANG_PLACEMENTS[id] || []).length;

/* ------------------------------------------------------------------ *
 * Готовые наборы
 * ------------------------------------------------------------------ */

/*
 * Готовый набор меняет облик, а не то, что человек скрыл: видимость
 * укрытий остаётся его. `kinds` — свой цвет у видов укрытий (набор «по
 * видам»): у их укрытий включается своя подсветка, у остальных — общая.
 */
export const WALLBANG_PRESETS = Object.freeze([
  Object.freeze({
    id: "mod",
    label: "Как в игре",
    description: "Синие полупрозрачные оболочки — как у автора мода.",
    look: WALLBANG_MOD_LOOK,
  }),
  Object.freeze({
    id: "soft",
    label: "Лёгкая подсветка",
    description: "Едва голубой отлив: текстуры укрытий видны целиком.",
    look: Object.freeze({ colour: "#5cc8ff", opacity: 18, glow: 44 }),
  }),
  Object.freeze({
    id: "solid",
    label: "Сплошная заливка",
    description: "Укрытия залиты цветом целиком — видно издалека.",
    look: Object.freeze({ colour: "#2f6bff", opacity: 100, glow: 50 }),
  }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    description: "Розовый неон, ночью светится с ореолом.",
    look: Object.freeze({ colour: "#ff2bd6", opacity: 42, glow: 80 }),
  }),
  Object.freeze({
    id: "acid",
    label: "Кислотный",
    description: "Кислотно-зелёный: не спутать ни с небом, ни с кирпичом.",
    look: Object.freeze({ colour: "#a6ff00", opacity: 40, glow: 64 }),
  }),
  Object.freeze({
    id: "signal",
    label: "Сигнальный",
    description: "Оранжевый, как дорожный знак: заметен и днём.",
    look: Object.freeze({ colour: "#ff8a1f", opacity: 48, glow: 56 }),
  }),
  Object.freeze({
    id: "danger",
    label: "Алый",
    description: "Красные укрытия — «сюда не прятаться».",
    look: Object.freeze({ colour: "#ff2a2a", opacity: 42, glow: 56 }),
  }),
  Object.freeze({
    id: "ghost",
    label: "Призрак",
    description: "Белая дымка без свечения — спокойно для глаз.",
    look: Object.freeze({ colour: "#f4f7ff", opacity: 22, glow: 30 }),
  }),
  Object.freeze({
    id: "colourblind",
    label: "Для дальтоников",
    description: "Жёлтый: различим при любой слепоте на красный и зелёный.",
    look: Object.freeze({ colour: "#ffd400", opacity: 50, glow: 56 }),
  }),
  Object.freeze({
    id: "night",
    label: "Ночной капт",
    description: "Фиолетовый, приглушённый днём и яркий ночью.",
    look: Object.freeze({ colour: "#8a5cff", opacity: 34, glow: 72 }),
  }),
  Object.freeze({
    id: "kinds",
    label: "Цвет по видам",
    description: "Дома синие, заборы зелёные, крыши оранжевые, баки красные.",
    look: Object.freeze({ colour: "#2f8bff", opacity: 40, glow: 56 }),
    kinds: Object.freeze({
      buildings: Object.freeze({ colour: "#2f8bff", opacity: 34 }),
      fences: Object.freeze({ colour: "#35e06f", opacity: 44 }),
      roofs: Object.freeze({ colour: "#ff9a1f", opacity: 48 }),
      cover: Object.freeze({ colour: "#ff3b3b", opacity: 48 }),
      power: Object.freeze({ colour: "#ffd400", opacity: 48 }),
    }),
  }),
]);

export const findWallbangPreset = (id) =>
  WALLBANG_PRESETS.find((preset) => preset.id === id) || null;

export function applyWallbangPreset(input, presetId) {
  const project = normalizeWallbangProject(input);
  const preset = findWallbangPreset(presetId);
  if (!preset) return project;
  const look = normalizeWallbangProject({ look: preset.look }).look;
  const objects = {};
  for (const item of WALLBANG_OBJECTS) {
    const own = preset.kinds?.[item.kind] || null;
    objects[item.id] = {
      visible: project.objects[item.id].visible,
      own: Boolean(own),
      colour: normalizeWallbangColour(own?.colour, look.colour),
      opacity: clampOpacity(own?.opacity, look.opacity),
    };
  }
  return normalizeWallbangProject({ ...project, look, objects });
}

/* Виды без укрытий в описи — ошибка описи, а не пустой раздел в окне. */
for (const item of WALLBANG_OBJECTS)
  if (!KIND_IDS.includes(item.kind))
    throw new Error(
      `Укрытие «${item.id}» отнесено к неизвестному виду ${item.kind}.`,
    );
for (const id of OBJECT_IDS)
  if (!WALLBANG_PLACEMENTS[id]?.length)
    throw new Error(
      `У укрытия «${id}» нет ни одного места — перегенерируйте placements.js.`,
    );
