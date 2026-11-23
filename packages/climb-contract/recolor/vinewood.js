/*
 * «Вайнвуд» — своя надпись вместо VINEWOOD на холме: работа, пределы,
 * раскладка слова по склону и сетки (буквы, леса, дальние планы, ночное
 * свечение). Одна арифметика у кадра окна и у установщика.
 *
 * Буквы рисует окно шрифтом Windows (маска глифа), сетку строит договор
 * (`vinewood-geometry.js`): контур, треугольники, тонкий лист металла.
 * Раскладка повторяет штатную надпись: буквы высотой 19 м стоят вдоль
 * склона, у каждой своя глубина и высота низа (их дают штатные буквы,
 * между ними — по прямой), слово стоит посередине надписи. Длинное слово
 * не вылезает за штатный размах: буквы уменьшаются, низ остаётся на месте.
 */

import VINEWOOD_INVENTORY from "./inventory/vinewood.js";
import { hasPlaceModels, joinLostInCode, normalizePlaceModels, placeModelsLostInCode, placeModelsSignatureField } from "./place-models.js";
import { normalizeColourEffect } from "./colour-effects.js";
import { normalizeRecolourHex } from "./colour.js";
import { sideColourPixels } from "./building-images.js";
import { mergeMeshes, placeMesh, ringsToPolygons, sheetMesh, simplifyRing, traceMask } from "./vinewood-geometry.js";

export { VINEWOOD_INVENTORY };
const SIGN = VINEWOOD_INVENTORY.vinewood;

export const VINEWOOD_PROJECT_SCHEMA = 1;
const NAME_LIMIT = 60;

/* ------------------------------------------------------------------ *
 * Словари и пределы
 * ------------------------------------------------------------------ */

export const VINEWOOD_MODES = Object.freeze(["standard", "text", "logo", "hidden"]);
export const VINEWOOD_MODE_LABELS = Object.freeze({ standard: "Как в игре", text: "Своё слово", logo: "Свой логотип", hidden: "Убрать надпись" });

/** Длина слова — знаков с пробелами. Длиннее восьми буквы уменьшаются. */
export const VINEWOOD_TEXT_LIMIT = 16;
/** Сколько знаков встаёт в штатный размер букв (19 м) при штатной ширине. */
export const VINEWOOD_FULL_SIZE_LETTERS = 8;
/** Знаки: латиница, кириллица (с Ё), цифры, пробел и простая пунктуация. */
export const VINEWOOD_ALLOWED = /[A-Z0-9А-ЯЁ .,!?&'+-]/;
export const VINEWOOD_HEIGHT = Object.freeze([40, 100]);
export const VINEWOOD_WIDTH = Object.freeze([60, 160]);
export const VINEWOOD_SPACING = Object.freeze([0, 12]);
export const VINEWOOD_LOGO_HEIGHT = Object.freeze([6, 30]);

/*
 * Шрифты букв — системные шрифты Windows (Astral их не возит): маску глифа
 * рисует окно, установщик получает картинку. У всех есть кириллица.
 */
export const VINEWOOD_FONTS = Object.freeze([
  Object.freeze({ id: "classic", label: "Как у VINEWOOD", family: "Impact, 'Arial Narrow', sans-serif", weight: 400 }),
  Object.freeze({ id: "wide", label: "Широкий", family: "'Arial Black', 'Segoe UI Black', sans-serif", weight: 900 }),
  Object.freeze({ id: "modern", label: "Современный", family: "Bahnschrift, 'Segoe UI', sans-serif", weight: 700 }),
  Object.freeze({ id: "serif", label: "С засечками", family: "Georgia, 'Times New Roman', serif", weight: 700 }),
  Object.freeze({ id: "mono", label: "Моноширинный", family: "Consolas, 'Courier New', monospace", weight: 700 }),
]);
export const VINEWOOD_FONT_IDS = Object.freeze(VINEWOOD_FONTS.map((font) => font.id));
export const vinewoodFont = (id) => VINEWOOD_FONTS.find((font) => font.id === id) || VINEWOOD_FONTS[0];

/*
 * Свой шрифт человека (ТЗ 23.10.2026, п. F): `font: "custom"` и ключ файла в хранилище окна. Файла в работе нет — он
 * лежит на этом компьютере, как у эмблем-надписей; маски букв рисует окно, в игру едут картинки. Ключ остаётся в
 * работе и когда выбран шрифт набора: свой можно вернуть одним нажатием.
 */
export const VINEWOOD_FONT_CUSTOM = "custom";
const FONT_ASSET = /^workshop-font:[a-f0-9]{64}$/;

/** Цвет букв как в игре — белая краска по листу металла. */
export const VINEWOOD_WHITE = "#f1efe8";

/** Размах надписи в игре, м: от левого края V до правого края D. */
export const vinewoodSpan = () => SIGN.span[1] - SIGN.span[0];
export const vinewoodHeight = () => SIGN.height;

/** Рекомендуемый размер логотипа, px: во всю ширину надписи и квадрат. */
export function vinewoodLogoPixels() {
  const aspect = vinewoodSpan() / SIGN.height;
  return { wide: [2048, Math.max(64, Math.round(2048 / aspect / 8) * 8)], square: [1024, 1024] };
}

const IMAGE_ASSET = /^hangar-emblem:[a-f0-9]{64}$/;

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clampNumber = (value, [low, high], fallback, digits = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, number)) * factor) / factor;
};
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);

/**
 * Слово для холма: заглавные, только разрешённые знаки, пробелы не
 * подряд и не по краям, не длиннее `VINEWOOD_TEXT_LIMIT`.
 */
/* Типографские тире и кавычки из скопированного текста — те же знаки шрифта. */
const SAME_CHARS = Object.freeze({ "−": "-", "–": "-", "—": "-", "‐": "-", "’": "'", "‘": "'", "ʼ": "'" });
const plainChars = (value) => String(value ?? "").toUpperCase().replace(/[−–—‐’‘ʼ]/g, (char) => SAME_CHARS[char]);

export function cleanVinewoodText(value) {
  const upper = plainChars(value);
  let out = "";
  for (const char of upper) {
    if (!VINEWOOD_ALLOWED.test(char)) continue;
    if (char === " " && (!out || out.endsWith(" "))) continue;
    out += char;
  }
  return out.trimEnd().slice(0, VINEWOOD_TEXT_LIMIT).trimEnd();
}

/** Знаки, что не встанут на холм, — для подсказки окна. */
export function rejectedVinewoodChars(value) {
  const rejected = new Set();
  for (const char of plainChars(value)) if (!VINEWOOD_ALLOWED.test(char) && char.trim()) rejected.add(char);
  return [...rejected];
}

function normalizeImage(input) {
  const source = plain(input);
  const asset = IMAGE_ASSET.test(String(source.asset || "")) ? source.asset : "";
  return {
    asset,
    name: asset ? String(source.name || "").slice(0, 80) : "",
    width: asset ? Math.round(Math.min(8192, Math.max(1, Number(source.width) || 1))) : 0,
    height: asset ? Math.round(Math.min(8192, Math.max(1, Number(source.height) || 1))) : 0,
  };
}

/*
 * Свой цвет отдельной буквы (задача 6 ТЗ 05.10.2026): по месту знака в
 * слове (с пробелами), `null` — буква в общем цвете надписи. Место, а не
 * буква: в слове «ASTRAL» две A, и красят каждую.
 */
function normalizeLetterColours(input) {
  const list = Array.isArray(input) ? input : [];
  return Array.from({ length: VINEWOOD_TEXT_LIMIT }, (_, index) => {
    const value = list[index];
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  });
}

/** Свой цвет буквы на месте `index` (или `null`) — новая работа. */
export function setVinewoodLetterColour(input, index, colour) {
  const project = normalizeVinewoodProject(input);
  const letters = [...project.letters];
  if (index >= 0 && index < letters.length) letters[index] = colour ? normalizeRecolourHex(colour, VINEWOOD_WHITE) : null;
  return { ...project, letters };
}

/** Есть ли у слова буквы своего цвета. */
export function vinewoodHasLetterColours(input) {
  const project = normalizeVinewoodProject(input);
  return project.letters.some((colour, index) => colour && index < project.text.length);
}

export function createVinewoodProject() {
  return normalizeVinewoodProject({});
}

/** Работа в порядке; лишнее отбрасывается молча. */
export function normalizeVinewoodProject(input) {
  const source = plain(input);
  return {
    schema: VINEWOOD_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    mode: choice(source.mode, VINEWOOD_MODES, "standard"),
    text: cleanVinewoodText(source.text ?? SIGN.text),
    font: source.font === VINEWOOD_FONT_CUSTOM && FONT_ASSET.test(String(source.fontAsset || "")) ? VINEWOOD_FONT_CUSTOM : choice(source.font, VINEWOOD_FONT_IDS, "classic"),
    ...(FONT_ASSET.test(String(source.fontAsset || "")) ? { fontAsset: source.fontAsset, fontName: String(source.fontName ?? "").trim().slice(0, 60) } : {}),
    height: clampNumber(source.height, VINEWOOD_HEIGHT, 100, 0),
    width: clampNumber(source.width, VINEWOOD_WIDTH, 100, 0),
    spacing: clampNumber(source.spacing, VINEWOOD_SPACING, Math.round(SIGN.gap * 10) / 10, 1),
    look: normalizeColourEffect(source.look, { colour: VINEWOOD_WHITE, colour2: "#ffd34d", direction: "along" }),
    letters: normalizeLetterColours(source.letters),
    relief: source.relief !== false,
    lights: source.lights !== false,
    logo: normalizeImage(source.logo),
    logoHeight: clampNumber(source.logoHeight, VINEWOOD_LOGO_HEIGHT, Math.round(SIGN.height * 10) / 10, 1),
    /* Свои модели у холма (ТЗ 11.10.2026, вечер, задача 1). «Как в игре» надписи их не касается. */
    models: normalizePlaceModels(source.models),
  };
}

export const serializeVinewoodProject = (project) => JSON.stringify(normalizeVinewoodProject(project));

export function parseVinewoodProject(text) {
  try {
    return normalizeVinewoodProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createVinewoodProject();
  }
}

/** Ставить нечего: «Как в игре», пустое слово или логотип без картинки. */
export function vinewoodProjectIsStock(input) {
  const project = normalizeVinewoodProject(input);
  if (project.mode === "standard") return true;
  if (project.mode === "text") return !project.text.trim();
  if (project.mode === "logo") return !project.logo.asset;
  return false;
}

/** Отпечаток для очереди «Применить»: всё, что меняет файлы. */
export function vinewoodProjectSignature(input) {
  const project = normalizeVinewoodProject(input);
  if (vinewoodProjectIsStock(project)) return JSON.stringify({ mode: "standard" });
  if (project.mode === "hidden") return JSON.stringify({ mode: "hidden" });
  const common = { mode: project.mode, look: project.look, relief: project.relief, lights: project.lights };
  /* Свои цвета букв — только у букв слова: хвост за словом файлов не меняет. */
  const letters = project.letters.slice(0, project.text.length);
  if (project.mode === "logo") return JSON.stringify({ ...common, logo: project.logo.asset, logoHeight: project.logoHeight });
  return JSON.stringify({ ...common, text: project.text, font: project.font, ...(project.font === VINEWOOD_FONT_CUSTOM ? { fontAsset: project.fontAsset } : {}), height: project.height, width: project.width, spacing: project.spacing, ...(letters.some(Boolean) ? { letters } : {}) });
}

/** «Как было»: всё как в игре (имя работы остаётся). */
export function resetVinewoodProject(input) {
  const project = normalizeVinewoodProject(input);
  return { ...createVinewoodProject(), name: project.name };
}

/** Кнопка «Стандарт»: надпись как в игре, слово и цвета помнятся. */
export function applyVinewoodStandard(input) {
  return { ...normalizeVinewoodProject(input), mode: "standard" };
}

/* Свой шрифт — файл на компьютере автора: в код он не едет, у друга слово выйдет шрифтом набора. */
function withoutOwnFont(project) {
  const { fontAsset: _asset, fontName: _name, ...rest } = project;
  return project.font === VINEWOOD_FONT_CUSTOM ? { ...rest, font: "classic" } : rest;
}

/* Код для друга: свой логотип и свой шрифт живут в окне автора и в код не едут. */
export function shareableVinewoodProject(input) {
  const project = withoutOwnFont(normalizeVinewoodProject(input));
  if (project.mode !== "logo") return { ...project, logo: normalizeImage(null), models: [] };
  return { ...project, mode: "standard", logo: normalizeImage(null), models: [] };
}

export function vinewoodLostInCode(input) {
  const project = normalizeVinewoodProject(input);
  return joinLostInCode(
    project.logo.asset ? "свой логотип (остаётся на этом компьютере)" : "",
    project.font === VINEWOOD_FONT_CUSTOM && project.mode === "text" ? "свой шрифт (остаётся на этом компьютере)" : "",
    placeModelsLostInCode(project.models),
  );
}

/*
 * Договор работы целиком (`projects.js`): «как в игре» — надпись как в игре
 * и своих моделей нет; отпечаток — надписи и, если есть, моделей.
 */
export const vinewoodWorkIsStock = (input) => vinewoodProjectIsStock(input) && !hasPlaceModels(normalizeVinewoodProject(input).models);
export function vinewoodWorkSignature(input) {
  const sign = vinewoodProjectSignature(input);
  const models = placeModelsSignatureField(normalizeVinewoodProject(input).models);
  return models.models ? JSON.stringify({ sign: JSON.parse(sign), ...models }) : sign;
}

/** Строка того, что уедет в игру, — под кадром. */
export function vinewoodPlanText(input) {
  const project = normalizeVinewoodProject(input);
  if (vinewoodProjectIsStock(project)) return "Надпись как в игре — файлы Astral снимаются, ставить нечего.";
  if (project.mode === "hidden") return "Надписи на холме не будет: буквы, леса, лестницы, свет и дальние планы убираются.";
  if (project.mode === "logo") return `Свой логотип высотой ${project.logoHeight} м вместо букв, леса за ним и дальние планы того же вида.`;
  return `«${project.text}» вместо VINEWOOD: буквы, леса и дальние планы${project.lights ? ", ночная подсветка" : ""}.`;
}

/* ------------------------------------------------------------------ *
 * Раскладка по склону
 * ------------------------------------------------------------------ */

/* Значение по штатным буквам: между ними — по прямой, за краями — краевое. */
function alongLetters(along, key) {
  const list = SIGN.letters;
  if (along <= list[0].along) return list[0][key];
  for (let at = 1; at < list.length; at += 1)
    if (along <= list[at].along) {
      const t = (along - list[at - 1].along) / (list[at].along - list[at - 1].along);
      return list[at - 1][key] + (list[at][key] - list[at - 1][key]) * t;
    }
  return list.at(-1)[key];
}

/** Высота земли под надписью на `along` (профиль склона описи). */
export function vinewoodGround(along) {
  const profile = SIGN.ground;
  if (!profile.length) return alongLetters(along, "bottom") - 3;
  if (along <= profile[0][0]) return profile[0][1];
  for (let at = 1; at < profile.length; at += 1)
    if (along <= profile[at][0]) {
      const t = (along - profile[at - 1][0]) / (profile[at][0] - profile[at - 1][0]);
      return profile[at - 1][1] + (profile[at][1] - profile[at - 1][1]) * t;
    }
  return profile.at(-1)[1];
}

/**
 * Раскладка слова: `glyphs` — `[{ char, aspect }]` (ширина глифа к высоте
 * заглавных; у пробела — без формы), от окна или установщика по маскам.
 * Ответ: `{ scale, height, letters: [{ char, index, along, width, height,
 * depth, bottom }] }` — метры вдоль надписи от места модели букв, глубина
 * к городу (+) и от него (−), низ — высота мира.
 */
export function vinewoodLayout(input, glyphs) {
  const project = normalizeVinewoodProject(input);
  const base = (SIGN.height * project.height) / 100;
  const widthScale = project.width / 100;
  const widths = glyphs.map((glyph) => (glyph.char === " " ? base * 0.42 : Math.max(0.05, glyph.aspect) * base * widthScale));
  const gaps = Math.max(0, glyphs.length - 1) * project.spacing;
  const natural = widths.reduce((sum, value) => sum + value, 0) + gaps;
  const span = vinewoodSpan();
  const scale = natural > span ? span / natural : 1;
  const height = base * scale;
  const centre = (SIGN.span[0] + SIGN.span[1]) / 2;
  let cursor = centre - (natural * scale) / 2;
  const letters = [];
  glyphs.forEach((glyph, index) => {
    const width = widths[index] * scale;
    const along = cursor + width / 2;
    cursor += width + project.spacing * scale;
    if (glyph.char === " ") return;
    letters.push({
      char: glyph.char,
      index,
      along: round(along, 3),
      width: round(width, 3),
      height: round(height, 3),
      depth: round(alongLetters(along, "depth"), 3),
      bottom: round(alongLetters(along, "bottom"), 3),
    });
  });
  return { scale: round(scale, 4), height: round(height, 3), width: round(natural * scale, 3), letters };
}

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/* Поворот модели: местная X — «вправо» надписи, местная −Y — к городу. */
const YAW = Math.atan2(SIGN.right[1], SIGN.right[0]);

/** Точка надписи в мире: вдоль, глубина, высота мира. */
export function vinewoodWorldPoint(along, depth, z) {
  return [
    SIGN.position[0] + SIGN.right[0] * along + SIGN.front[0] * depth,
    SIGN.position[1] + SIGN.right[1] * along + SIGN.front[1] * depth,
    z,
  ];
}

/* ------------------------------------------------------------------ *
 * Сетки
 * ------------------------------------------------------------------ */

/*
 * Маска глифа: `{ alpha, width, height, cap, baseline, ink: [x0, x1] }` —
 * альфа по пикселю, высота заглавных и базовая линия в пикселях маски,
 * края чернил по X.
 */
export function maskAspect(mask) {
  return Math.max(0.05, (mask.ink[1] - mask.ink[0]) / Math.max(1, mask.cap));
}

/* Многоугольники глифа: контуры, упрощение, дырки; X — под ширину буквы. */
function glyphPolygons(mask, letter, simplify) {
  const rings = traceMask(mask).map((ring) => simplifyRing(ring, simplify));
  const polygons = ringsToPolygons(rings, { minArea: Math.max(2, (mask.cap * mask.cap) / 4000) });
  const unit = letter.height / Math.max(1, mask.cap);
  const inkWidth = Math.max(1, mask.ink[1] - mask.ink[0]);
  const stretch = letter.width / (inkWidth * unit);
  const originX = (mask.ink[0] + mask.ink[1]) / 2;
  const originY = -mask.baseline;
  const scaleRing = (ring) => {
    const out = new Array(ring.length);
    for (let at = 0; at < ring.length; at += 2) {
      out[at] = originX + (ring[at] - originX) * stretch;
      out[at + 1] = ring[at + 1];
    }
    return out;
  };
  return { polygons: polygons.map((polygon) => ({ outer: scaleRing(polygon.outer), holes: polygon.holes.map(scaleRing) })), unit, originX, originY };
}

/* Развёртка листа слова: u — вдоль всего размаха надписи, v — сверху вниз. */
function wordUvs(mesh, letter, local) {
  const uvs = new Float32Array((mesh.positions.length / 3) * 2);
  const span = vinewoodSpan();
  for (let at = 0, v = 0; at < local.positions.length; at += 3, v += 2) {
    uvs[v] = (letter.along + local.positions[at] - SIGN.span[0]) / span;
    uvs[v + 1] = 1 - local.positions[at + 2] / Math.max(0.01, letter.height);
  }
  return uvs;
}

/**
 * Сетка буквы в осях модели (`origin` — где стоит модель в мире): лист
 * металла толщиной `thickness` (`sides` — с торцами), развёртка — лист
 * слова. `simplify` — допуск упрощения контура в пикселях маски; `front`
 * — только лицо (дальний план со стороны города), `lift` — сдвиг к городу
 * (ночное свечение перед буквой).
 */
export function vinewoodLetterMesh(letter, mask, { origin = SIGN.position, simplify = 0.45, sides = true, thickness = 0.12, front = false, lift = 0 } = {}) {
  const { polygons, unit, originX, originY } = glyphPolygons(mask, letter, simplify);
  let local = sheetMesh(polygons, { unit, thickness, originX, originY, sides });
  if (front) local = frontOnly(local);
  const uvs = wordUvs(local, letter, local);
  const world = vinewoodWorldPoint(letter.along, letter.depth + lift, letter.bottom);
  const placed = placeMesh({ ...local, uvs }, { yaw: YAW, offset: [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]] });
  return placed;
}

/* Только лицо листа (нормаль к городу): дальним планам спинка не нужна. */
function frontOnly(mesh) {
  const keep = [];
  for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
    const vertex = mesh.indices[at];
    if (mesh.normals[vertex * 3 + 1] < -0.5) keep.push(mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]);
  }
  return { ...mesh, indices: new Uint32Array(keep) };
}

/** Буквы слова одной сеткой (кадр, установщик): `masks` — по знаку слова (пробелы — `null`). */
export function vinewoodWordMesh(layout, masks, options = {}) {
  const meshes = [];
  for (const letter of layout.letters) {
    const mask = masks[letter.index];
    if (mask) meshes.push(vinewoodLetterMesh(letter, mask, options));
  }
  return meshes.length ? mergeMeshes(meshes) : null;
}

/* Квадратная труба между двумя точками (4 грани, без торцов), развёртка в метрах. */
function tube(from, to, size) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  const axis = [dx / length, dy / length, dz / length];
  const helper = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => {
    const l = Math.hypot(...v) || 1;
    return v.map((value) => value / l);
  };
  const u = norm(cross(axis, helper));
  const w = norm(cross(axis, u));
  const half = size / 2;
  const corners = [
    [u, w],
    [w, u.map((value) => -value)],
    [u.map((value) => -value), w.map((value) => -value)],
    [w.map((value) => -value), u],
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const [n, side] of corners) {
    const base = positions.length / 3;
    for (const end of [from, to])
      for (const sign of [-1, 1]) {
        const point = [0, 1, 2].map((k) => end[k] + n[k] * half + side[k] * half * sign);
        positions.push(...point);
        normals.push(...n);
        uvs.push(end === from ? 0 : length, sign > 0 ? size : 0);
      }
    /* Лицевая грань — против часовой, если смотреть снаружи (по нормали). */
    indices.push(base, base + 3, base + 2, base, base + 1, base + 3);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

/**
 * Леса за буквами (или за логотипом): у каждой буквы стойки через ~3 м от
 * земли до верха, три пояса и раскосы к земле за надписью — как штатные
 * фермы. `full: false` — одни стойки (дальний план). Оси модели лесов —
 * от `origin`.
 */
export function vinewoodScaffold(layout, { origin = SIGN.position, full = true, back = 0.9 } = {}) {
  const meshes = [];
  const toLocal = (point) => [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  for (const letter of layout.letters) {
    const count = Math.max(2, Math.ceil(letter.width / 3.2) + 1);
    const top = letter.bottom + letter.height * 0.94;
    const depth = letter.depth - back;
    const posts = [];
    for (let at = 0; at < count; at += 1) {
      const along = letter.along - letter.width / 2 + 0.35 + ((letter.width - 0.7) * at) / Math.max(1, count - 1);
      const ground = vinewoodGround(along) - 0.6;
      posts.push({ along, ground });
      meshes.push(tube(toLocal(vinewoodWorldPoint(along, depth, ground)), toLocal(vinewoodWorldPoint(along, depth, top)), 0.2));
    }
    if (!full) continue;
    for (const share of [0.16, 0.52, 0.88]) {
      const z = letter.bottom + letter.height * share;
      meshes.push(tube(toLocal(vinewoodWorldPoint(posts[0].along, depth, z)), toLocal(vinewoodWorldPoint(posts.at(-1).along, depth, z)), 0.14));
    }
    posts.forEach((post, at) => {
      if (at % 2) return;
      const from = vinewoodWorldPoint(post.along, depth, letter.bottom + letter.height * 0.7);
      const to = vinewoodWorldPoint(post.along, depth - 5, vinewoodGround(post.along) - 0.8);
      meshes.push(tube(toLocal(from), toLocal(to), 0.14));
    });
  }
  return meshes.length ? mergeMeshes(meshes) : null;
}

/**
 * Логотип вместо букв: «буква» шириной по картинке посередине надписи —
 * раскладка для лесов и место плашки.
 */
export function vinewoodLogoLayout(input) {
  const project = normalizeVinewoodProject(input);
  const aspect = project.logo.width / Math.max(1, project.logo.height) || 1;
  let height = project.logoHeight;
  let width = height * aspect;
  const span = vinewoodSpan();
  if (width > span) {
    width = span;
    height = width / aspect;
  }
  const along = (SIGN.span[0] + SIGN.span[1]) / 2;
  return {
    scale: 1,
    height: round(height, 3),
    width: round(width, 3),
    letters: [{ char: "logo", index: 0, along, width: round(width, 3), height: round(height, 3), depth: round(alongLetters(along, "depth"), 3), bottom: round(alongLetters(along, "bottom"), 3) }],
  };
}

/** Плашка логотипа: двусторонний лист картинки, развёртка — вся картинка. */
export function vinewoodLogoMesh(layout, { origin = SIGN.position, front = false, lift = 0 } = {}) {
  const letter = layout.letters[0];
  const half = letter.width / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const corners = [
    [-half, 0, 0, 1],
    [half, 0, 1, 1],
    [half, letter.height, 1, 0],
    [-half, letter.height, 0, 0],
  ];
  for (const side of front ? [-1] : [-1, 1]) {
    const base = positions.length / 3;
    for (const [x, z, u, v] of corners) {
      positions.push(x, side * 0.02, z);
      normals.push(0, side, 0);
      uvs.push(u, v);
    }
    if (side < 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const world = vinewoodWorldPoint(letter.along, letter.depth + lift, letter.bottom);
  return placeMesh(
    { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) },
    { yaw: YAW, offset: [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]] },
  );
}

/**
 * Маска логотипа: альфа картинки, сжатая до `side` px по длинной стороне
 * (средним по блоку). Устроена как маска глифа: `cap` — вся высота, `ink` —
 * вся ширина, поэтому сетка по контуру встаёт ровно в рамку логотипа.
 */
export function vinewoodLogoMask(logo, { side = 512 } = {}) {
  const sourceWidth = Math.max(1, Math.floor(logo.width));
  const sourceHeight = Math.max(1, Math.floor(logo.height));
  const scale = Math.min(1, side / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const from = Math.floor((y * sourceHeight) / height);
    const to = Math.max(from + 1, Math.floor(((y + 1) * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor((x * sourceWidth) / width);
      const right = Math.max(left + 1, Math.floor(((x + 1) * sourceWidth) / width));
      let sum = 0;
      for (let row = from; row < to; row += 1) for (let column = left; column < right; column += 1) sum += logo.rgba[(row * sourceWidth + column) * 4 + 3];
      alpha[y * width + x] = Math.round(sum / ((to - from) * (right - left)));
    }
  }
  return { alpha, width, height, cap: height, baseline: height, ink: [0, width] };
}

/**
 * Логотип дальних планов без прозрачности: лист картинки на сетке по
 * контуру её альфы (порог 50 %). Дальние планы игры — словари `_children.ydd`
 * — у всех штатных моделей надписи непрозрачные (`default.sps`, корзина 0),
 * лес в том же словаре, собранный так же, виден, а прозрачный лист
 * (`alpha.sps`, корзина 1) пропадал. Прозрачный фон здесь — дыра в сетке, а
 * не альфа листа. `null` — видимого нет (вся картинка прозрачна).
 * Развёртка — вся картинка: спинка зеркальна, чтобы читалась и сзади.
 */
export function vinewoodLogoCutMesh(layout, logo, { origin = SIGN.position, simplify = 1.2, front = false, lift = 0, thickness = 0.04, side = 512 } = {}) {
  const letter = layout.letters[0];
  const { polygons, unit, originX, originY } = glyphPolygons(vinewoodLogoMask(logo, { side }), letter, simplify);
  if (!polygons.length) return null;
  let local = sheetMesh(polygons, { unit, thickness, originX, originY, sides: false });
  if (front) local = frontOnly(local);
  const uvs = new Float32Array((local.positions.length / 3) * 2);
  for (let at = 0, uv = 0; at < local.positions.length; at += 3, uv += 2) {
    const u = local.positions[at] / Math.max(0.01, letter.width) + 0.5;
    uvs[uv] = local.normals[at + 1] > 0 ? 1 - u : u;
    uvs[uv + 1] = 1 - local.positions[at + 2] / Math.max(0.01, letter.height);
  }
  const world = vinewoodWorldPoint(letter.along, letter.depth + lift, letter.bottom);
  return placeMesh({ ...local, uvs }, { yaw: YAW, offset: [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]] });
}

/**
 * Пустая модель вместо убранной: треугольник в сантиметр глубоко в склоне.
 * Игра получает целую модель (без пустых буферов), а видно её не будет.
 */
export function vinewoodEmptyMesh() {
  return {
    positions: new Float32Array([0, 0, -40, 0.01, 0, -40, 0, 0, -39.99]),
    normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

/**
 * Сетка по частям не больше `limit` вершин (у игры индексы 16 бит):
 * треугольники идут подряд, вершины каждой части — свои.
 */
export function splitMesh(mesh, limit = 60000) {
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount <= limit) return [mesh];
  const parts = [];
  let remap = new Map();
  let positions = [];
  let normals = [];
  let uvs = [];
  let indices = [];
  const flush = () => {
    if (indices.length)
      parts.push({ positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) });
    remap = new Map();
    positions = [];
    normals = [];
    uvs = [];
    indices = [];
  };
  for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
    if (remap.size + 3 > limit) flush();
    for (let k = 0; k < 3; k += 1) {
      const vertex = mesh.indices[at + k];
      let local = remap.get(vertex);
      if (local === undefined) {
        local = remap.size;
        remap.set(vertex, local);
        positions.push(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
        normals.push(mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2]);
        uvs.push(mesh.uvs[vertex * 2], mesh.uvs[vertex * 2 + 1]);
      }
      indices.push(local);
    }
  }
  flush();
  return parts;
}

/* ------------------------------------------------------------------ *
 * Лист слова
 * ------------------------------------------------------------------ */

/** Сколько метров надписи на один лист металла (как у штатных букв). */
export const VINEWOOD_METAL_TILE = 5;

/**
 * Лист слова `width × height` (RGBA, непрозрачный): цвет работы с
 * эффектом вдоль надписи (или снизу вверх) по рисунку листа металла игры
 * (`metal` — `{ rgba, width, height }` или `null` — ровная краска).
 *
 * Буквы своего цвета (`project.letters`) красятся по своей полосе листа:
 * развёртка буквы — `u` вдоль всего размаха надписи (`wordUvs`), и полоса
 * буквы — от её левого до правого края. Для этого нужна раскладка
 * (`layout`, та же, по которой строятся сетки); без неё — общий цвет.
 */
export function vinewoodWordPixels(input, { width = 4096, height = 512, metal = null, layout = null } = {}) {
  const project = normalizeVinewoodProject(input);
  const look = { ...project.look, colour: normalizeRecolourHex(project.look.colour, VINEWOOD_WHITE) };
  const relief = project.relief && metal ? { ...metal, repeat: vinewoodSpan() / VINEWOOD_METAL_TILE, vertical: [SIGN.height / VINEWOOD_METAL_TILE, 0], swap: false } : null;
  const pixels = sideColourPixels(look, width, height, { relief });
  const own = (layout?.letters || []).filter((letter) => project.letters[letter.index]);
  if (!own.length) return pixels;
  const span = vinewoodSpan();
  const sheets = new Map();
  for (const letter of own) {
    const colour = project.letters[letter.index];
    if (!sheets.has(colour)) sheets.set(colour, sideColourPixels({ mode: "solid", colour }, width, height, { relief }));
    const sheet = sheets.get(colour);
    /* Полоса буквы с запасом в столбец: на краю буквы нет общего цвета. */
    const from = Math.max(0, Math.floor(((letter.along - letter.width / 2 - SIGN.span[0]) / span) * width) - 1);
    const to = Math.min(width, Math.ceil(((letter.along + letter.width / 2 - SIGN.span[0]) / span) * width) + 1);
    for (let row = 0; row < height; row += 1) {
      const start = (row * width + from) * 4;
      pixels.set(sheet.subarray(start, start + (to - from) * 4), start);
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const PRESETS = Object.freeze([
  Object.freeze({ id: "standard", label: "Как в игре", description: "Штатная надпись VINEWOOD", project: { mode: "standard" } }),
  Object.freeze({ id: "los-santos", label: "LOS SANTOS", description: "Название города белыми буквами", project: { mode: "text", text: "LOS SANTOS" } }),
  Object.freeze({ id: "astral", label: "ASTRAL", description: "Золотые буквы", project: { mode: "text", text: "ASTRAL", look: { mode: "solid", colour: "#e8c25a" } } }),
  Object.freeze({
    id: "russian",
    label: "ВАЙНВУД",
    description: "По-русски, белым по металлу",
    project: { mode: "text", text: "ВАЙНВУД" },
  }),
  Object.freeze({
    id: "rainbow",
    label: "Радуга",
    description: "VINEWOOD радугой вдоль надписи",
    project: { mode: "text", text: "VINEWOOD", look: { mode: "rainbow", colour: "#ff3b3b", direction: "along" } },
  }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    description: "Розовое в фиолетовое, подсветка ночью",
    project: { mode: "text", text: "VINEWOOD", look: { mode: "gradient", colour: "#ff3fa4", colour2: "#7a5cff", direction: "along" }, relief: false },
  }),
  Object.freeze({ id: "hidden", label: "Без надписи", description: "Чистый склон", project: { mode: "hidden" } }),
]);

export const vinewoodPresets = () => PRESETS;

/** Работа в облике вида: вид кладётся на чистую работу, имя и логотип остаются. */
export function applyVinewoodPreset(input, presetId) {
  const project = normalizeVinewoodProject(input);
  const preset = PRESETS.find((item) => item.id === presetId);
  if (!preset) return project;
  return normalizeVinewoodProject({ ...createVinewoodProject(), ...preset.project, name: project.name, logo: project.logo, logoHeight: project.logoHeight });
}

/** Вид, с которым работа совпадает, или `null`. */
export function matchingVinewoodPreset(input) {
  const signature = vinewoodProjectSignature(input);
  return PRESETS.find((preset) => vinewoodProjectSignature(applyVinewoodPreset(input, preset.id)) === signature)?.id || null;
}
