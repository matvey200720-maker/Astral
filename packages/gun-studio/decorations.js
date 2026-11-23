/*
 * Украшения на модели оружия (задача 13 ТЗ 10.10.2026): цветы, веточки,
 * звёздочки, брелоки и свой логотип — геометрией в самой модели ствола.
 * Объём (задача 6 ТЗ 11.10.2026, утро): лоза, что обвивает ствол, объёмные
 * цветы и своя голограмма.
 *
 * Владелец 11.10: «Та же лоза должна обвеивать ган. Цветочки должны быть
 * трёхмерными… голограмму какую-то человек свою может, хочет трёхмерную
 * добавить… чтобы люди могли настраивать свои ганпаки».
 *
 * Прежние брелоки мастерской были фигурами three.js на цепочке и в игру не
 * доезжали (убраны 06.10.2026). Украшение здесь — это треугольники: одна и
 * та же сетка рисуется в кадре и уходит в `<ствол>.ydr` и `<ствол>_hi.ydr`
 * (команда хоста `decorate-drawable`): вершины в осях модели, вес — на кость
 * ближайшей детали ствола, лист цветов — во встроенном словаре модели.
 *
 * МЕСТО. `anchor` и `normal` — точка и нормаль поверхности в осях модели
 * кадра (оси glTF модели игры: x — вдоль ствола, y — вверх, z — вбок), как
 * их даёт щелчок по модели. Свои оси украшения: z — нормаль, y — «вверх»
 * модели, спроецированный на плоскость поверхности и повёрнутый на
 * `rotation`, x = y × z. Размер — в сантиметрах: у модели игры метры.
 * Лоза — не у точки, а вокруг ствола: её форма — мерка модели (`wrap`,
 * `decoration-vine.js`), точка щелчка — где лоза проходит, `rotation` —
 * сдвиг витков по кругу.
 *
 * ЦВЕТ. У каждого украшения свой маленький лист (`decorationTexture`): слева
 * — основной цвет с переходом от тени к свету, справа сверху — второй цвет,
 * справа снизу — тёмный, зелень листьев, золото и белый
 * (`decoration-shapes.js`). Логотип — картинка с прозрачностью
 * (`default/alpha.sps`); голограмма — своя картинка или надпись
 * (`decoration-hologram.js`), светящаяся — `emissive_alpha.sps`.
 *
 * ТЗ 17.10.2026 (задача 6): гирлянды вокруг всей модели — цепь, цветы,
 * мишура, огоньки, бусы (`decoration-garland.js`, путь — тот же, что у
 * лозы), и новые украшения у точки — банты, ленты, шипы, снежинка,
 * колокольчик и ёлочный шар (`decoration-ornaments.js`). У каждого — свой
 * основной и второй цвет.
 *
 * ДЕТАЛИЗАЦИЯ. `lod: "high"` — модель в руках (`_hi`) и кадр мастерской,
 * `"low"` — обычная `.ydr` (ствол вдали, у других игроков): та же форма,
 * меньше граней.
 *
 * Модуль — чистые данные и арифметика: его читают окно, главный процесс и
 * тесты.
 */

import {
  ACCENT,
  DARK,
  GOLD_COLOUR,
  LEAF_GREEN,
  MAIN,
  SHAPES,
  builder,
  cross,
  facet,
  framed,
  pipe,
  prism,
  sheet,
  torus,
} from "./decoration-shapes.js";
import { flowerMesh } from "./decoration-flowers.js";
import { VINE_ZONES, normalizeWrap, vineMesh } from "./decoration-vine.js";
import { garlandMesh } from "./decoration-garland.js";
import { ballMesh, bellMesh, bowMesh, ribbonMesh, snowflakeMesh, spikeMesh } from "./decoration-ornaments.js";
import { hologramLocalMesh, hologramTexture } from "./decoration-hologram.js";
import { attachedModelLayout, attachedModelLocalMesh } from "./decoration-model.js";

export { VINE_BINS, VINE_ZONES, decorationWrap, normalizeWrap } from "./decoration-vine.js";
export { GARLAND_VARIANTS, GARLAND_VERTEX_BUDGET } from "./decoration-garland.js";
export { HOLOGRAM_PNG_SIZE, HOLOGRAM_TEXTURE_SIZE, fitRgba, hologramMask, hologramTexture } from "./decoration-hologram.js";
export {
  ATTACHED_ATLAS_SIZE,
  ATTACHED_CELL_SIZE,
  ATTACHED_MODEL_LIMITS,
  attachedModelAtlas,
  attachedModelLayout,
  attachedModelPlan,
} from "./decoration-model.js";

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const HEX = /^#[0-9a-f]{6}$/i;
const colourOf = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);

export const MAX_DECORATIONS = 12;
/* Лоза — крупная сетка: больше трёх на одном стволе не нужно и тяжело. */
export const MAX_VINES = 3;
/* Гирлянды вокруг ствола (задача 6 ТЗ 17.10.2026) — тоже крупные: до трёх. */
export const MAX_GARLANDS = 3;
/* Виды, что обвивают модель по её мерке (`wrap`), а не стоят у точки. */
export const WRAP_KINDS = Object.freeze(["vine", "garland"]);
export const isWrapKind = (kind) => WRAP_KINDS.includes(kind);
/* Сколько вершин бывает у одного украшения и у всех вместе (у модели в
   руках; обычная `.ydr` берёт облегчённые сетки). */
export const MAX_DECORATION_VERTICES = 6000;
export const MAX_DECORATIONS_VERTICES = 80000;
/* Сторона листа цветов и картинки логотипа. */
export const DECORATION_ATLAS_SIZE = 32;
export const DECORATION_LOGO_SIZE = 128;
/* Над поверхностью: украшение не утопает в детали и не мерцает с ней. */
export const DECORATION_LIFT = 0.0008;
export const DECORATION_LODS = Object.freeze(["high", "low"]);

/* `accentLabel` — как зовётся второй цвет у этого вида (нет — его не видно). */
const variant = (id, label, colour, accent, accentLabel = "") => Object.freeze({ id, label, colour, accent, accentLabel });

/* Пределы лозы и голограммы: витки, миллиметры, проценты. */
export const VINE_LIMITS = Object.freeze({
  turns: Object.freeze({ min: 0.5, max: 10, standard: 3 }),
  thickness: Object.freeze({ min: 1.5, max: 8, standard: 3 }),
  density: Object.freeze({ min: 0, max: 100, standard: 60 }),
  blooms: Object.freeze({ min: 0, max: 100, standard: 45 }),
  gap: Object.freeze({ min: 0, max: 10, standard: 1 }),
});
export const HOLOGRAM_LIMITS = Object.freeze({
  depth: Object.freeze({ min: 0.5, max: 12, standard: 3 }),
  lift: Object.freeze({ min: 0, max: 40, standard: 8 }),
  glow: Object.freeze({ min: 0, max: 8, standard: 3 }),
  opacity: Object.freeze({ min: 20, max: 100, standard: 75 }),
});
/* Пределы гирлянды: витки, миллиметры нити, проценты густоты, свечение огоньков. */
export const GARLAND_LIMITS = Object.freeze({
  turns: Object.freeze({ min: 0.5, max: 10, standard: 4 }),
  thickness: Object.freeze({ min: 1, max: 6, standard: 2 }),
  density: Object.freeze({ min: 0, max: 100, standard: 60 }),
  gap: Object.freeze({ min: 0, max: 10, standard: 1 }),
  glow: Object.freeze({ min: 0, max: 8, standard: 3 }),
});
export const HOLOGRAM_POSES = Object.freeze(["flat", "stand"]);
/* Шрифты надписи-голограммы — те же имена, что у надписей мастерской. */
export const HOLOGRAM_FONTS = Object.freeze(["sans", "serif", "mono", "stencil", "script", "gothic"]);
export const HOLOGRAM_TEXT_LIMIT = 24;

export const DECORATION_KINDS = Object.freeze([
  Object.freeze({
    id: "vine",
    label: "Лоза",
    note: "обвивает ствол, корпус или всю модель — стебель с листьями",
    size: Object.freeze({ min: 0.6, max: 3, standard: 1.4 }),
    variants: Object.freeze([
      variant("ivy", "Плющ", "#3f8f3a", "#3f8f3a"),
      variant("bloom", "В цвету", "#4f9a3a", "#ffb7d5", "Цветы"),
      variant("roses", "С розами", "#2f7d32", "#d61f3c", "Бутоны"),
      variant("holly", "Остролист", "#1f6b2a", "#d7192a", "Ягоды"),
    ]),
  }),
  Object.freeze({
    id: "garland",
    label: "Гирлянда",
    note: "вокруг всей модели или её участка: цепь, цветы, мишура, огоньки, бусы",
    /* Размер — звено, цветок, полоска мишуры, лампочка, бусина. */
    size: Object.freeze({ min: 0.4, max: 4, standard: 1.2 }),
    variants: Object.freeze([
      variant("chain", "Цепь", "#c9ced6", "#c9ced6", "Каждое второе звено"),
      variant("flowers", "Цветы", "#ffffff", "#ffc83d", "Середина"),
      variant("tinsel", "Мишура", "#ffd23f", "#ff3b6b", "Второй цвет"),
      variant("lights", "Огоньки", "#ffd86b", "#4fc3ff", "Каждый второй огонёк"),
      variant("beads", "Бусы", "#fff7ee", "#ffd23f", "Каждая вторая бусина"),
    ]),
  }),
  Object.freeze({
    id: "flower",
    label: "Цветок",
    note: "объёмный: лепестки, середина, стебель и листья",
    size: Object.freeze({ min: 1, max: 12, standard: 3 }),
    variants: Object.freeze([
      variant("daisy", "Ромашка", "#ffffff", "#ffc83d", "Середина"),
      variant("rose", "Роза", "#d61f3c", "#2f8a3a", "Листья и стебель"),
      variant("tulip", "Тюльпан", "#e8303f", "#3f8f3a", "Листья и стебель"),
      variant("lily", "Лилия", "#fff1ea", "#e2761b", "Тычинки"),
      variant("sakura", "Сакура", "#ffb7d5", "#ff6f9f", "Середина"),
    ]),
  }),
  Object.freeze({
    id: "hologram",
    label: "Голограмма",
    note: "своя картинка или надпись объёмной фигурой",
    size: Object.freeze({ min: 1, max: 12, standard: 4 }),
    variants: Object.freeze([
      variant("figure", "Объёмная фигура", "#ffffff", "#2b2f36"),
      variant("glow", "Светящаяся", "#38e8ff", "#1a2a36", "Излучатель"),
    ]),
  }),
  Object.freeze({
    id: "twig",
    label: "Веточка",
    note: "зелёная или в цвету",
    size: Object.freeze({ min: 2, max: 15, standard: 6 }),
    variants: Object.freeze([
      variant("leafy", "Зелёная", "#4caf50", "#6b4423", "Стебель"),
      variant("blossom", "В цвету", "#ffb7d5", "#5a3a22", "Стебель"),
    ]),
  }),
  Object.freeze({
    id: "star",
    label: "Звёздочка",
    note: "объёмная, с гранями",
    size: Object.freeze({ min: 1, max: 10, standard: 2.5 }),
    variants: Object.freeze([
      variant("star", "Звезда", "#ffd23f", "#ffffff"),
      variant("sparkle", "Искра", "#7fdfff", "#ffffff"),
      variant("snowflake", "Снежинка", "#e8f6ff", "#9fd8ff", "Середина"),
    ]),
  }),
  Object.freeze({
    id: "charm",
    label: "Брелок",
    note: "на колечке и цепочке, висит неподвижно",
    size: Object.freeze({ min: 2, max: 12, standard: 4.5 }),
    variants: Object.freeze([
      variant("heart", "Сердце", "#ff3b6b", "#c9ced6", "Колечко и цепочка"),
      variant("star", "Звезда", "#ffd23f", "#c9ced6", "Колечко и цепочка"),
      variant("dice", "Кубик", "#ffffff", "#c9ced6", "Колечко и цепочка"),
      variant("bell", "Колокольчик", "#ffcf4a", "#c9ced6", "Колечко и язычок"),
      variant("ball", "Ёлочный шар", "#d61f3c", "#ffd23f", "Колпачок и цепочка"),
      variant("snowflake", "Снежинка", "#e8f6ff", "#c9ced6", "Колечко и цепочка"),
    ]),
  }),
  Object.freeze({
    id: "bow",
    label: "Бант",
    note: "две петли, узелок и хвосты ласточкой",
    size: Object.freeze({ min: 1.5, max: 12, standard: 4 }),
    variants: Object.freeze([
      variant("satin", "Атласный", "#d61f3c", "#a8132b", "Узелок"),
      variant("gold", "Золотой", "#ffcf4a", "#d99a17", "Узелок"),
      variant("gift", "Подарочный", "#2f6bff", "#ffd23f", "Узелок"),
    ]),
  }),
  Object.freeze({
    id: "ribbon",
    label: "Лента",
    note: "серпантин свисает спиралью, волна лежит по стволу",
    size: Object.freeze({ min: 2, max: 15, standard: 5 }),
    variants: Object.freeze([
      variant("curl", "Серпантин", "#ff3b6b", "#ffd23f", "Кайма"),
      variant("wave", "Волна", "#2f6bff", "#ffffff", "Кайма"),
    ]),
  }),
  Object.freeze({
    id: "spike",
    label: "Шипы",
    note: "ряд шипов или заклёпок на ремешке",
    size: Object.freeze({ min: 1.5, max: 12, standard: 4 }),
    variants: Object.freeze([
      variant("cones", "Шипы", "#d9dde3", "#1b1b1e", "Ремешок"),
      variant("studs", "Заклёпки", "#ffcf4a", "#3a2618", "Ремешок"),
    ]),
  }),
  /* Своя модель на стволе (задача 6 ТЗ 17.10.2026): брелок, фигурка, декоративный прицел из .glb. */
  Object.freeze({
    id: "model",
    label: "Своя модель",
    note: "маленький .glb у точки ствола: брелок, фигурка, декоративный прицел",
    size: Object.freeze({ min: 1, max: 30, standard: 6 }),
    variants: Object.freeze([variant("own", "Своя модель", "#ffffff", "#ffffff")]),
  }),
  Object.freeze({
    id: "logo",
    label: "Свой логотип",
    note: "картинка с прозрачностью — значком на модели",
    size: Object.freeze({ min: 1, max: 12, standard: 4 }),
    variants: Object.freeze([variant("badge", "Значок", "#ffffff", "#ffffff")]),
  }),
]);

const KIND_MAP = new Map(DECORATION_KINDS.map((kind) => [kind.id, kind]));

export const decorationKind = (id) => KIND_MAP.get(id) || KIND_MAP.get("flower");
export const decorationVariant = (kind, id) => {
  const entry = decorationKind(kind);
  return entry.variants.find((item) => item.id === id) || entry.variants[0];
};

/* Источник картинки логотипа и голограммы — как у наклеек (`imageSource` проекта). */
const IMAGE_SOURCE =
  /^(asset:[a-z0-9:_-]{1,160}|emblem:[a-z0-9-]{1,48}|data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*|blob:.{1,512}|https?:\/\/.{1,2048})$/;
const imageSource = (value) => (IMAGE_SOURCE.test(String(value || "")) ? String(value) : null);
/* Своя модель на стволе — файл .glb в хранилище мастерской по хешу. */
const MODEL_SOURCE = /^asset:gunattach:[a-f0-9]{64}$/;
const modelSource = (value) => (MODEL_SOURCE.test(String(value || "")) ? String(value) : null);

const round5 = (value) => Math.round(value * 1e5) / 1e5;
const point = (value) => ({
  x: round5(Number(value?.x) || 0),
  y: round5(Number(value?.y) || 0),
  z: round5(Number(value?.z) || 0),
});
const direction = (value) => {
  const vector = point(value);
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!length) return { x: 0, y: 0, z: 1 };
  return { x: round5(vector.x / length), y: round5(vector.y / length), z: round5(vector.z / length) };
};
const limited = (value, { min, max, standard }, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(clamp(value ?? standard, min, max) * factor) / factor;
};

/** Надпись голограммы: слова и шрифт; пустая — `null`. */
export function hologramText(input) {
  const value = String(input?.value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HOLOGRAM_TEXT_LIMIT);
  if (!value) return null;
  /* Свой шрифт человека (ТЗ 23.10.2026, п. F): `font: "custom"` и ключ файла в хранилище окна; ключ остаётся, когда выбран шрифт набора. */
  const fontAsset = /^workshop-font:[a-f0-9]{64}$/.test(String(input?.fontAsset || "")) ? input.fontAsset : "";
  return {
    value,
    font: HOLOGRAM_FONTS.includes(input?.font) ? input.font : input?.font === "custom" && fontAsset ? "custom" : "sans",
    ...(fontAsset ? { fontAsset, fontName: String(input?.fontName ?? "").trim().slice(0, 60) } : {}),
  };
}

let sequence = 0;
const SAFE_ID = /^deco-[0-9a-z]{1,12}$/;

/** Украшение в границах договора. */
export function createDecoration(input = {}) {
  const kind = decorationKind(input.kind);
  const look = decorationVariant(kind.id, input.variant);
  const id = SAFE_ID.test(String(input.id || "")) ? String(input.id) : `deco-${(sequence += 1).toString(36)}`;
  const match = /-([0-9a-z]+)$/.exec(id);
  if (match) sequence = Math.max(sequence, Number.parseInt(match[1], 36) || 0);
  const normal = direction(input.normal);
  const decoration = {
    id,
    kind: kind.id,
    variant: look.id,
    anchor: point(input.anchor),
    normal,
    size: Math.round(clamp(input.size ?? kind.size.standard, kind.size.min, kind.size.max) * 10) / 10,
    rotation: Math.round(clamp(input.rotation ?? 0, -180, 180)),
    colour: colourOf(input.colour, look.colour),
    accent: colourOf(input.accent, look.accent),
    source: kind.id === "logo" || kind.id === "hologram" ? imageSource(input.source) : kind.id === "model" ? modelSource(input.source) : null,
    visible: input.visible !== false,
  };
  if (kind.id === "vine")
    Object.assign(decoration, {
      zone: VINE_ZONES.includes(input.zone) ? input.zone : "barrel",
      turns: Math.round(clamp(input.turns ?? VINE_LIMITS.turns.standard, VINE_LIMITS.turns.min, VINE_LIMITS.turns.max) * 2) / 2,
      thickness: limited(input.thickness, VINE_LIMITS.thickness),
      density: limited(input.density, VINE_LIMITS.density, 0),
      blooms: limited(input.blooms, VINE_LIMITS.blooms, 0),
      gap: limited(input.gap, VINE_LIMITS.gap),
      wrap: normalizeWrap(input.wrap),
    });
  /* Гирлянда — по умолчанию вокруг всей модели (ТЗ 17.10: «вокруг всего гана»). */
  if (kind.id === "garland")
    Object.assign(decoration, {
      zone: VINE_ZONES.includes(input.zone) ? input.zone : "whole",
      turns: Math.round(clamp(input.turns ?? GARLAND_LIMITS.turns.standard, GARLAND_LIMITS.turns.min, GARLAND_LIMITS.turns.max) * 2) / 2,
      thickness: limited(input.thickness, GARLAND_LIMITS.thickness),
      density: limited(input.density, GARLAND_LIMITS.density, 0),
      gap: limited(input.gap, GARLAND_LIMITS.gap),
      ...(look.id === "lights" ? { glow: limited(input.glow, GARLAND_LIMITS.glow) } : {}),
      wrap: normalizeWrap(input.wrap),
    });
  if (kind.id === "hologram") {
    const glow = look.id === "glow";
    Object.assign(decoration, {
      text: hologramText(input.text),
      depth: limited(input.depth, HOLOGRAM_LIMITS.depth),
      lift: limited(input.lift ?? (glow ? HOLOGRAM_LIMITS.lift.standard : 0), HOLOGRAM_LIMITS.lift),
      /* Без своего слова: на верху ствола фигура стоит, на боку — лежит. */
      pose: HOLOGRAM_POSES.includes(input.pose) ? input.pose : Math.abs(normal.y) > 0.7 ? "stand" : "flat",
      glow: limited(input.glow, HOLOGRAM_LIMITS.glow),
      opacity: limited(input.opacity, HOLOGRAM_LIMITS.opacity, 0),
    });
  }
  return decoration;
}

/* Чем украшение рисуется: у логотипа — картинка, у голограммы — картинка или надпись. */
const drawable = (item) =>
  item.kind === "logo" || item.kind === "model" ? Boolean(item.source) : item.kind === "hologram" ? Boolean(item.source || item.text) : true;

/** Украшения проекта: известные, не больше предела, логотип и голограмма — с картинкой или надписью. */
export function normalizeDecorations(list) {
  if (!Array.isArray(list)) return [];
  let vines = 0;
  let garlands = 0;
  return list
    .slice(0, MAX_DECORATIONS)
    .map((item) => createDecoration(item))
    .filter(drawable)
    .filter((item) => item.kind !== "vine" || (vines += 1) <= MAX_VINES)
    .filter((item) => item.kind !== "garland" || (garlands += 1) <= MAX_GARLANDS);
}

/* --------------------------- проект --------------------------- */

/** Есть ли на стволе видимые украшения — им есть что ставить в игру. */
export const projectTouchesDecorations = (project) =>
  normalizeDecorations(project?.decorations).some((item) => item.visible);

/** Ставит украшение в проект (правит его на месте) и отдаёт поставленное. */
export function addDecoration(project, input) {
  const list = normalizeDecorations(project.decorations);
  /* Отделённые кистью куски ствола едут в игру ещё одним украшением
     (`weapon-paint-pieces.js` лаунчера): их место занято. */
  const pieces = Object.values(project.detached || {}).some((records) => Array.isArray(records) && records.length);
  const limit = pieces ? MAX_DECORATIONS - 1 : MAX_DECORATIONS;
  if (list.length >= limit)
    throw new RangeError(`На стволе уже ${limit} украшений — сними одно, чтобы поставить новое.`);
  const decoration = createDecoration(input);
  if (decoration.kind === "vine" && list.filter((item) => item.kind === "vine").length >= MAX_VINES)
    throw new RangeError(`На стволе уже ${MAX_VINES} лозы — сними одну, чтобы обвить ещё.`);
  if (decoration.kind === "garland" && list.filter((item) => item.kind === "garland").length >= MAX_GARLANDS)
    throw new RangeError(`На стволе уже ${MAX_GARLANDS} гирлянды — сними одну, чтобы обвить ещё.`);
  const taken = new Set(list.map((item) => item.id));
  const placed = taken.has(decoration.id) ? createDecoration({ ...decoration, id: "" }) : decoration;
  project.decorations = [...list, placed];
  return placed;
}

export function updateDecoration(project, id, patch) {
  project.decorations = normalizeDecorations(project.decorations).map((item) =>
    item.id === id ? createDecoration({ ...item, ...patch, id: item.id, kind: item.kind }) : item,
  );
}

export function removeDecoration(project, id) {
  project.decorations = normalizeDecorations(project.decorations).filter((item) => item.id !== id);
}

/* ------------------------- прежние виды ------------------------- */

/* Звезда с гранями: вершина над серединой, по две грани на луч. */
function facetedStar(mesh, { points = 5, outer = 0.5, inner = 0.21, apex = 0.16, edge = 0.04 }) {
  const corner = (index) => {
    const radius = index % 2 ? inner : outer;
    const a = Math.PI / 2 + (index * Math.PI) / points;
    return [Math.cos(a) * radius, Math.sin(a) * radius];
  };
  const count = points * 2;
  const top = [0, 0, apex];
  for (let index = 0; index < count; index += 1) {
    const [ax, ay] = corner(index);
    const [bx, by] = corner((index + 1) % count);
    const a = [ax, ay, edge];
    const b = [bx, by, edge];
    facet(mesh, top, a, b, [MAIN(1), MAIN(index % 2 ? 0.55 : 0.75), MAIN(index % 2 ? 0.75 : 0.55)]);
    facet(mesh, [ax, ay, 0], [bx, by, 0], b, MAIN(0.3));
    facet(mesh, [ax, ay, 0], b, a, MAIN(0.3));
    facet(mesh, [0, 0, 0], [bx, by, 0], [ax, ay, 0], MAIN(0.2));
  }
}

const heartOutline = (size, steps = 28) => {
  const points = [];
  for (let k = 0; k < steps; k += 1) {
    const t = (k / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points.push([(x / 34) * size, (y / 34) * size]);
  }
  return points.reverse();
};

const starOutline = (outer, inner, points = 5) =>
  Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 ? inner : outer;
    const a = Math.PI / 2 + (index * Math.PI) / points;
    return [Math.cos(a) * radius, Math.sin(a) * radius];
  });

/* Кубик брелока: белые грани и тёмные точки на каждой. */
function dice(mesh, { centre, side }) {
  const h = side / 2;
  const faces = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], pips: 1 },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], pips: 6 },
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], pips: 3 },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], pips: 4 },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], pips: 2 },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], pips: 5 },
  ];
  const PIPS = {
    1: [[0, 0]],
    2: [[-0.5, -0.5], [0.5, 0.5]],
    3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
    4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
    5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
    6: [[-0.5, -0.55], [0.5, -0.55], [-0.5, 0], [0.5, 0], [-0.5, 0.55], [0.5, 0.55]],
  };
  const at = (face, x, y, out) => [
    centre[0] + face.n[0] * out + face.u[0] * x + face.v[0] * y,
    centre[1] + face.n[1] * out + face.u[1] * x + face.v[1] * y,
    centre[2] + face.n[2] * out + face.u[2] * x + face.v[2] * y,
  ];
  for (const face of faces) {
    const corners = [at(face, -h, -h, h), at(face, h, -h, h), at(face, h, h, h), at(face, -h, h, h)];
    facet(mesh, corners[0], corners[1], corners[2], MAIN(0.8));
    facet(mesh, corners[0], corners[2], corners[3], MAIN(0.8));
    const pip = side * 0.09;
    for (const [px, py] of PIPS[face.pips]) {
      const x = px * h * 0.95;
      const y = py * h * 0.95;
      const quad = [at(face, x - pip, y - pip, h * 1.02), at(face, x + pip, y - pip, h * 1.02), at(face, x + pip, y + pip, h * 1.02), at(face, x - pip, y + pip, h * 1.02)];
      facet(mesh, quad[0], quad[1], quad[2], DARK);
      facet(mesh, quad[0], quad[2], quad[3], DARK);
    }
  }
}

/* Веточка: стебель по поверхности, листья — изогнутые, в цвету — сакуры. */
function twigMesh(mesh, look, lod) {
  const path = [];
  for (let k = 0; k <= 12; k += 1) {
    const t = k / 12;
    path.push([0.06 * Math.sin(t * Math.PI), -0.5 + t, 0.024]);
  }
  const low = lod === "low";
  pipe(mesh, path, { radius: (index) => 0.024 - (0.014 * index) / 12, sides: low ? 4 : 6, uv: ACCENT, caps: [true, true] });
  const leaf = (t, side, length = 0.24, width = 0.1) => {
    const at = path[Math.round(t * 12)];
    sheet(mesh, {
      base: [at[0], at[1], 0.022],
      forward: [side * Math.cos(0.65), Math.sin(0.65), 0],
      up: [0, 0, 1],
      length,
      width,
      rise: 0.3,
      bend: -0.35,
      fold: 0.25,
      shape: SHAPES.pointed,
      rows: low ? 2 : 4,
      cols: low ? 1 : 2,
      uv: (u) => MAIN(0.4 + 0.55 * u),
    });
  };
  if (look === "blossom") {
    leaf(0.2, 1, 0.16, 0.08);
    leaf(0.5, -1, 0.16, 0.08);
    for (const [t, side] of [[0.3, -1], [0.62, 1], [0.95, 0]]) {
      const at = path[Math.round(t * 12)];
      flowerMesh(framed(mesh, { origin: [at[0] + side * 0.1, at[1], 0.012], scale: 0.32 }), "sakura", "low");
    }
    return;
  }
  for (const [index, t] of [0.15, 0.3, 0.45, 0.6, 0.75, 0.88].entries()) leaf(t, index % 2 ? 1 : -1);
  leaf(1, 0, 0.18, 0.08);
}

function charmMesh(mesh, look, lod = "high") {
  torus(mesh, { centre: [0, 0, 0.06], major: 0.09, minor: 0.018, axis: "x" });
  for (let k = 0; k < 3; k += 1)
    torus(mesh, { centre: [0, -0.17 - k * 0.1, 0.06], major: 0.05, minor: 0.012, axis: k % 2 ? "y" : "x", segments: 10, sides: 5 });
  const pendant = [0, -0.6, 0.06];
  if (look === "dice") {
    dice(mesh, { centre: pendant, side: 0.24 });
    return;
  }
  /* Ёлочные брелоки (ТЗ 17.10.2026). */
  if (look === "bell") {
    bellMesh(mesh, pendant, lod);
    return;
  }
  if (look === "ball") {
    ballMesh(mesh, add3(pendant, [0, -0.06, 0]), lod);
    return;
  }
  if (look === "snowflake") {
    snowflakeMesh(mesh, { centre: add3(pendant, [0, -0.02, 0]), radius: 0.24, depth: 0.04, lod });
    return;
  }
  const outline = look === "star" ? starOutline(0.22, 0.095) : heartOutline(0.34);
  prism(mesh, { outline, centre: pendant, depth: 0.09 });
}

function logoMesh(mesh) {
  const z = 0.002;
  const corners = [
    [[-0.5, -0.5, z], [0, 1]],
    [[0.5, -0.5, z], [1, 1]],
    [[0.5, 0.5, z], [1, 0]],
    [[-0.5, 0.5, z], [0, 0]],
  ];
  const front = corners.map(([p, uv]) => mesh.vertex(p, [0, 0, 1], uv));
  mesh.triangle(front[0], front[1], front[2]);
  mesh.triangle(front[0], front[2], front[3]);
  /* Изнанка читается не зеркально: развёртка перевёрнута по u. */
  const back = corners.map(([p, uv]) => mesh.vertex(p, [0, 0, -1], [1 - uv[0], uv[1]]));
  mesh.triangle(back[0], back[2], back[1]);
  mesh.triangle(back[0], back[3], back[2]);
}

/* ------------------------------ сетка ------------------------------ */

/**
 * Сетка украшения в его осях (единица — размер украшения). Лоза — не в
 * своих осях, а в осях модели (`decorationMesh`). `pixels` — картинка
 * голограммы (`{ rgba, width, height }`, PNG окна).
 */
export function decorationLocalMesh(input, { lod = "high", pixels = null, model = null } = {}) {
  const decoration = createDecoration(input);
  const mesh = builder();
  /* Своя модель — разобранный .glb (`readGlb`); без него — пусто, как голограмма без картинки. */
  if (decoration.kind === "model") {
    if (!model) return mesh;
    const local = attachedModelLocalMesh(model, lod);
    for (let index = 0; index < local.positions.length / 3; index += 1)
      mesh.vertex(local.positions.slice(index * 3, index * 3 + 3), local.normals.slice(index * 3, index * 3 + 3), local.uvs.slice(index * 2, index * 2 + 2));
    for (let index = 0; index < local.indices.length; index += 3) mesh.triangle(local.indices[index], local.indices[index + 1], local.indices[index + 2]);
    return mesh;
  }
  if (decoration.kind === "flower") flowerMesh(mesh, decoration.variant, lod);
  else if (decoration.kind === "twig") twigMesh(mesh, decoration.variant, lod);
  else if (decoration.kind === "star" && decoration.variant === "snowflake") snowflakeMesh(mesh, { lod });
  else if (decoration.kind === "star")
    facetedStar(mesh, decoration.variant === "sparkle" ? { points: 4, outer: 0.5, inner: 0.13, apex: 0.15 } : {});
  else if (decoration.kind === "charm") charmMesh(mesh, decoration.variant, lod);
  else if (decoration.kind === "bow") bowMesh(mesh, lod);
  else if (decoration.kind === "ribbon") ribbonMesh(mesh, decoration.variant, lod);
  else if (decoration.kind === "spike") spikeMesh(mesh, decoration.variant, lod);
  else if (decoration.kind === "hologram") hologramLocalMesh(mesh, decoration, pixels, lod);
  else logoMesh(mesh);
  return mesh;
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/*
 * Оси украшения в осях модели: z — нормаль, y — «вверх» модели (glTF +y) в
 * плоскости поверхности, повёрнутый на `rotation`, x = y × z. На верху и
 * снизу ствола, где нормаль сама смотрит вверх, «вверх» — ось ствола.
 */
export function decorationFrame(input) {
  const decoration = createDecoration(input);
  const n = [decoration.normal.x, decoration.normal.y, decoration.normal.z];
  const reference = Math.abs(n[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const dot = reference[0] * n[0] + reference[1] * n[1] + reference[2] * n[2];
  let y = [reference[0] - dot * n[0], reference[1] - dot * n[1], reference[2] - dot * n[2]];
  const length = Math.hypot(...y) || 1;
  y = y.map((value) => value / length);
  const angle = (decoration.rotation * Math.PI) / 180;
  const side = cross(n, y);
  y = [y[0] * Math.cos(angle) + side[0] * Math.sin(angle), y[1] * Math.cos(angle) + side[1] * Math.sin(angle), y[2] * Math.cos(angle) + side[2] * Math.sin(angle)];
  const x = cross(y, n);
  const scale = decoration.size / 100;
  const origin = [
    decoration.anchor.x + n[0] * DECORATION_LIFT,
    decoration.anchor.y + n[1] * DECORATION_LIFT,
    decoration.anchor.z + n[2] * DECORATION_LIFT,
  ];
  return { x, y, z: n, origin, scale };
}

/**
 * Сетка украшения в осях модели кадра (glTF): `{ positions, normals, uvs,
 * indices, vertices, alpha, emissive, parts }`. Та же сетка уходит в модель
 * игры — в осях RAGE (`toRageAxes`). `parts` — у лозы: куски сетки со своей
 * точкой крепления (`{ anchor: [x, y, z], vertex, vertices, index, indices }`),
 * у остальных — `null` (крепление — `anchor` украшения). `emissive` —
 * множитель свечения у светящейся голограммы, иначе 0. Голограмма без
 * `pixels` или с пустой картинкой — сетка без вершин.
 */
export function decorationMesh(input, { lod = "high", pixels = null, model = null } = {}) {
  const decoration = createDecoration(input);
  const quality = DECORATION_LODS.includes(lod) ? lod : "high";
  let positions;
  let normals;
  let source;
  let parts = null;
  if (isWrapKind(decoration.kind)) {
    source = decoration.kind === "garland" ? garlandMesh(decoration, quality) : vineMesh(decoration, quality);
    positions = Float32Array.from(source.positions);
    normals = Float32Array.from(source.normals);
    parts = source.parts().filter((part) => part.vertices > 0 && part.indices > 0);
  } else {
    source = decorationLocalMesh(decoration, { lod: quality, pixels, model });
    const { x, y, z, origin, scale } = decorationFrame(decoration);
    const count = source.positions.length / 3;
    positions = new Float32Array(count * 3);
    normals = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const [lx, ly, lz] = source.positions.slice(index * 3, index * 3 + 3);
      const [nx, ny, nz] = source.normals.slice(index * 3, index * 3 + 3);
      for (let axis = 0; axis < 3; axis += 1) {
        positions[index * 3 + axis] = origin[axis] + scale * (lx * x[axis] + ly * y[axis] + lz * z[axis]);
        normals[index * 3 + axis] = nx * x[axis] + ny * y[axis] + nz * z[axis];
      }
    }
  }
  const count = positions.length / 3;
  if (count > MAX_DECORATION_VERTICES)
    throw new RangeError(`У украшения ${count} вершин — больше ${MAX_DECORATION_VERTICES}.`);
  const glow = decoration.kind === "hologram" && decoration.variant === "glow";
  /* Огоньки гирлянды светятся сами — непрозрачным шейдером свечения игры. */
  const lights = decoration.kind === "garland" && decoration.variant === "lights";
  return {
    id: decoration.id,
    positions,
    normals,
    uvs: Float32Array.from(source.uvs),
    indices: count > 65535 ? Uint32Array.from(source.indices) : Uint16Array.from(source.indices),
    vertices: count,
    alpha: decoration.kind === "logo" || glow || (decoration.kind === "model" && Boolean(model) && attachedModelLayout(model).alpha),
    emissive: glow || lights ? decoration.glow : 0,
    parts,
  };
}

/** Оси кадра (glTF) → оси модели игры (RAGE): (x, −z, y). */
export function toRageAxes(values) {
  const out = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 3) {
    out[index] = values[index];
    out[index + 1] = -values[index + 2];
    out[index + 2] = values[index + 1];
  }
  return out;
}

/* ------------------------------ лист ------------------------------ */

const rgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
const shadeOf = (colour, factor) => colour.map((value) => Math.round(clamp(value * factor, 0, 255)));
const LEAF_RGB = rgb(LEAF_GREEN);
const GOLD_RGB = rgb(GOLD_COLOUR);

/**
 * Лист цветов украшения: `{ width, height, rgba }` (строка 0 — верх, как у
 * развёртки). Основной цвет — от 0,62 до 1,12 своей яркости по высоте;
 * справа сверху — второй цвет; справа снизу — тёмный, зелень (с тенью),
 * золото и белый. У голограммы — свой лист по её картинке (`pixels`).
 */
export function decorationTexture(input, { pixels = null, atlas = null } = {}) {
  const decoration = createDecoration(input);
  if (decoration.kind === "hologram") return hologramTexture(pixels, decoration);
  /* Своя модель — свой лист (`attachedModelAtlas`), его собирает тот, у кого картинки модели. */
  if (decoration.kind === "model" && atlas) return atlas;
  const size = DECORATION_ATLAS_SIZE;
  const rgba = new Uint8Array(size * size * 4);
  const main = rgb(decoration.colour);
  const accent = rgb(decoration.accent);
  const dark = [27, 27, 30];
  const half = size / 2;
  const quarter = (size * 3) / 4;
  for (let row = 0; row < size; row += 1)
    for (let column = 0; column < size; column += 1) {
      let value;
      if (column < half) value = shadeOf(main, 0.62 + 0.5 * clamp(((row + 0.5) / size - 0.06) / 0.88, 0, 1));
      else if (row < half) value = accent;
      else if (row < quarter) value = column < quarter ? dark : shadeOf(LEAF_RGB, 0.7 + 0.5 * ((row - half + 0.5) / (quarter - half)));
      else value = column < quarter ? GOLD_RGB : [255, 255, 255];
      const at = (row * size + column) * 4;
      rgba[at] = value[0];
      rgba[at + 1] = value[1];
      rgba[at + 2] = value[2];
      rgba[at + 3] = 255;
    }
  return { width: size, height: size, rgba };
}

/* ----------------------------- шаблоны ----------------------------- */

/*
 * Готовые наборы украшений. Место — доля длины ствола (`along`, 0 — тыл,
 * 1 — дуло), сторона (`side`: бок к камере — `side`, верх — `top`) и
 * высота на боку (`height`, доля высоты габарита): окно находит точку
 * лучом снаружи, как место наклейки шаблона. Где на этой высоте ствола нет,
 * окно берёт ближайшую, где он есть. Лоза обвивает свой участок (`zone`):
 * окно меряет его по модели в кадре.
 */
const item = (kind, variantId, along, height, extra = {}) =>
  Object.freeze({ kind, variant: variantId, along, height, side: "side", ...extra });

export const DECORATION_SETS = Object.freeze([
  Object.freeze({
    id: "spring",
    label: "Весна",
    note: "плющ вокруг ствола, ромашки и тюльпан",
    items: Object.freeze([
      item("vine", "ivy", 0.72, 0.78, { zone: "barrel", turns: 2.5, density: 55, size: 1.3 }),
      item("flower", "daisy", 0.3, 0.76, { size: 2.6 }),
      item("flower", "tulip", 0.45, 0.82, { size: 2.4 }),
      item("flower", "daisy", 0.58, 0.7, { size: 2 }),
    ]),
  }),
  Object.freeze({
    id: "sakura",
    label: "Сакура",
    note: "цветущая лоза и цветы сакуры",
    items: Object.freeze([
      item("vine", "bloom", 0.72, 0.78, { zone: "barrel", turns: 3, colour: "#5a8f3a", accent: "#ffb7d5", blooms: 70 }),
      item("twig", "blossom", 0.45, 0.64, { rotation: -80, size: 7 }),
      item("flower", "sakura", 0.25, 0.76, { size: 2.2 }),
      item("flower", "sakura", 0.6, 0.82, { size: 1.8 }),
    ]),
  }),
  Object.freeze({
    id: "roses",
    label: "Розы",
    note: "лоза с бутонами и две розы",
    items: Object.freeze([
      item("vine", "roses", 0.7, 0.78, { zone: "barrel", turns: 3, blooms: 60 }),
      item("flower", "rose", 0.32, 0.72, { size: 2.8 }),
      item("flower", "rose", 0.5, 0.78, { size: 3.2 }),
    ]),
  }),
  Object.freeze({
    id: "newyear",
    label: "Новогодний",
    note: "остролист с ягодами по всей модели и звёзды",
    items: Object.freeze([
      item("vine", "holly", 0.5, 0.78, { zone: "whole", turns: 4, density: 50, blooms: 60 }),
      item("star", "star", 0.3, 0.84, { size: 2.2 }),
      item("star", "sparkle", 0.62, 0.8, { size: 1.6, rotation: 20 }),
    ]),
  }),
  Object.freeze({
    id: "lilies",
    label: "Лилии",
    note: "белые лилии и лоза в цвету",
    items: Object.freeze([
      item("vine", "bloom", 0.7, 0.78, { zone: "barrel", turns: 2, accent: "#ffffff", blooms: 50 }),
      item("flower", "lily", 0.32, 0.8, { size: 3 }),
      item("flower", "lily", 0.52, 0.74, { size: 2.4, rotation: 40 }),
    ]),
  }),
  Object.freeze({
    id: "stardust",
    label: "Звёздная пыль",
    note: "золотые звёздочки и искры",
    items: Object.freeze([
      item("star", "star", 0.2, 0.8, { size: 2 }),
      item("star", "sparkle", 0.35, 0.66, { size: 1.6, rotation: 20 }),
      item("star", "star", 0.5, 0.78, { size: 2.6, rotation: -12 }),
      item("star", "sparkle", 0.65, 0.64, { size: 1.4 }),
      item("star", "star", 0.8, 0.8, { size: 1.8, rotation: 30 }),
    ]),
  }),
  Object.freeze({
    id: "talisman",
    label: "Талисман",
    note: "брелок-сердце и две звёздочки",
    items: Object.freeze([
      item("charm", "heart", 0.25, 0.45, { size: 4 }),
      item("star", "star", 0.45, 0.76, { size: 1.6 }),
      item("star", "sparkle", 0.6, 0.68, { size: 1.4 }),
    ]),
  }),
  Object.freeze({
    id: "lucky",
    label: "На удачу",
    note: "кубик на цепочке и роза",
    items: Object.freeze([item("charm", "dice", 0.3, 0.45, { size: 4 }), item("flower", "rose", 0.6, 0.74, { size: 2.4 })]),
  }),
  /* Наборы ТЗ 17.10.2026: гирлянды вокруг всей модели и новые украшения. */
  Object.freeze({
    id: "christmas",
    label: "Ёлка",
    note: "огоньки вокруг всей модели, бант, шар и снежинка",
    items: Object.freeze([
      item("garland", "lights", 0.5, 0.78, { zone: "whole", turns: 4, density: 60 }),
      item("bow", "satin", 0.32, 0.8, { size: 3.5 }),
      item("charm", "ball", 0.22, 0.45, { size: 4 }),
      item("star", "snowflake", 0.66, 0.78, { size: 2.2 }),
    ]),
  }),
  Object.freeze({
    id: "biker",
    label: "Байкер",
    note: "цепь вокруг всей модели и шипы",
    items: Object.freeze([
      item("garland", "chain", 0.5, 0.78, { zone: "whole", turns: 3, size: 1.4 }),
      item("spike", "cones", 0.36, 0.82, { size: 4 }),
      item("spike", "studs", 0.6, 0.6, { size: 3.5 }),
    ]),
  }),
  Object.freeze({
    id: "gift",
    label: "Подарок",
    note: "мишура вокруг ствола, золотой бант и серпантин",
    items: Object.freeze([
      item("garland", "tinsel", 0.72, 0.78, { zone: "barrel", turns: 3, density: 70 }),
      item("bow", "gold", 0.4, 0.82, { size: 4 }),
      item("ribbon", "curl", 0.28, 0.5, { size: 5 }),
    ]),
  }),
  Object.freeze({
    id: "garden",
    label: "Цветочная",
    note: "цветы вокруг всей модели и бусы на стволе",
    items: Object.freeze([
      item("garland", "flowers", 0.5, 0.78, { zone: "whole", turns: 3.5, colour: "#ffb7d5", accent: "#ffd23f" }),
      item("garland", "beads", 0.75, 0.78, { zone: "barrel", turns: 2, size: 0.7 }),
      item("flower", "rose", 0.36, 0.76, { size: 2.6 }),
    ]),
  }),
]);

export const decorationSet = (id) => DECORATION_SETS.find((set) => set.id === id) || null;

