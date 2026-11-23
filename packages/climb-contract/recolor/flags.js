/*
 * «Флаги» — флаги на флагштоках всей карты (задача 7 ТЗ 10.10.2026, вечер):
 * свой флаг вместо флага игры — страна из шаблонов или своя картинка, — а
 * ткань и ветер остаются штатными.
 *
 * Флаг GTA V — фрагмент `prop_flag_<вид>.yft` с тканью (`inventory/flags.js`,
 * `scripts/prepare-flags.mjs`): модель и есть ткань, её развевает ветер
 * игры. Меняется только лист полотнища, зашитый в модель (и тот же лист в
 * общем словаре `prop_flags.ytd`), — на месте, той же длины: сетка, физика
 * и ткань остаются байт в байт. Поэтому флаг после замены развевается, как
 * штатный, а не висит картинкой.
 *
 * Лист — 256 × 128 DXT1 (Шотландия — 512 × 256), развёртка — весь лист:
 * от древка (слева) к свободному краю, сверху вниз. Полоса у древка в 1/64
 * ширины — рукав полотнища с люверсами — остаётся как в игре. Полотнище в
 * игре — 1,9 : 1: круги и звёзды шаблонов рисуются под эту пропорцию, своя
 * картинка подгоняется под неё же.
 *
 * Работа держит облик «Все флаги» (`all`) и, у вида, что правят по одному,
 * — свой (`kinds[id].own`). Облик:
 *   standard — «Как в игре» (можно тусклее, ярче, бледнее);
 *   country  — флаг страны из шаблонов (`flag-art.js`, векторно, кодом);
 *   image    — своя картинка: «Заполнить», «Вписать» или «Растянуть»,
 *              приближение и сдвиг — кадрирование под полотнище.
 * У каждого — яркость, насыщенность и складки ткани (тени складок поверх
 * своего рисунка: на листе игры они нарисованы, у своего — рисуются).
 *
 * Лист — одна арифметика у кадра окна и установщика (`paintFlagSheet`).
 * Исходный облик — «Как в игре»: ставить нечего, «Применить» снимает
 * установку.
 */

import { hexBytes, normalizeRecolourHex } from "./colour.js";
import { FLAG_COUNTRIES, FLAG_COUNTRY_IDS, createPicture, drawCountryFlag, flagCountry } from "./flag-art.js";
import FLAGS_INVENTORY from "./inventory/flags.js";

export { FLAGS_INVENTORY, FLAG_COUNTRIES, FLAG_COUNTRY_IDS, flagCountry };

export const FLAGS_PROJECT_SCHEMA = 1;
const NAME_LIMIT = 60;

/* ------------------------------------------------------------------ *
 * Опись
 * ------------------------------------------------------------------ */

export const FLAG_KINDS = Object.freeze(FLAGS_INVENTORY.kinds.map((kind) => Object.freeze(kind)));
export const FLAG_KIND_IDS = Object.freeze(FLAG_KINDS.map((kind) => kind.id));
const kindById = new Map(FLAG_KINDS.map((kind) => [kind.id, kind]));

/** Вид флага описи или `null`. */
export const flagKind = (id) => kindById.get(id) || null;

/** Флагов на карте всего (по описи мира). */
export const FLAG_TOTAL = FLAG_KINDS.reduce((sum, kind) => sum + kind.count, 0);

/* Ткань игры — длина к высоте: 2,966 × 1,558 м у большого флага, 1,779 × 0,935 у малого. */
export const FLAG_CLOTH_ASPECT = 1.9;

/** Рукав у древка: 1/64 ширины листа (4 пикселя у 256). */
export const flagHoistPixels = (width) => Math.max(1, Math.round(width / 64));

/** Пропорция полотнища без рукава — под неё рисуется флаг и подгоняется картинка. */
export const flagFieldAspect = (width) => FLAG_CLOTH_ASPECT * (1 - flagHoistPixels(width) / width);

/* ------------------------------------------------------------------ *
 * Облик флага
 * ------------------------------------------------------------------ */

export const FLAG_MODES = Object.freeze(["standard", "country", "image"]);
export const FLAG_MODE_LABELS = Object.freeze({ standard: "Как в игре", country: "Флаг страны", image: "Своя картинка" });
export const FLAG_FITS = Object.freeze(["cover", "contain", "stretch"]);
export const FLAG_FIT_LABELS = Object.freeze({ cover: "Заполнить", contain: "Вписать", stretch: "Растянуть" });
/* Яркость и насыщенность, % (100 — как есть); складки ткани, %; кадрирование: приближение и сдвиг. */
export const FLAG_BRIGHTNESS = Object.freeze({ min: 40, max: 160, standard: 100 });
export const FLAG_SATURATION = Object.freeze({ min: 0, max: 200, standard: 100 });
export const FLAG_FOLDS = Object.freeze({ min: 0, max: 100, standard: 45 });
export const FLAG_ZOOM = Object.freeze({ min: 100, max: 400, standard: 100 });
export const FLAG_OFFSET = Object.freeze({ min: -100, max: 100, standard: 0 });

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);
const clampInt = (value, { min, max, standard }) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : standard;
};

function normalizeImage(input) {
  const source = plain(input);
  const asset = typeof source.asset === "string" && source.asset.length <= 200 ? source.asset : "";
  return {
    asset,
    name: asset ? String(source.name ?? "").slice(0, 120) : "",
    width: asset ? Math.max(0, Math.round(Number(source.width) || 0)) : 0,
    height: asset ? Math.max(0, Math.round(Number(source.height) || 0)) : 0,
  };
}

/** Облик флага (или «Всех флагов»). */
export function normalizeFlagLook(input) {
  const source = plain(input);
  return {
    mode: choice(source.mode, FLAG_MODES, "standard"),
    country: choice(source.country, FLAG_COUNTRY_IDS, "ru"),
    image: normalizeImage(source.image),
    fit: choice(source.fit, FLAG_FITS, "cover"),
    zoom: clampInt(source.zoom, FLAG_ZOOM),
    offsetX: clampInt(source.offsetX, FLAG_OFFSET),
    offsetY: clampInt(source.offsetY, FLAG_OFFSET),
    background: normalizeRecolourHex(source.background, "#ffffff"),
    brightness: clampInt(source.brightness, FLAG_BRIGHTNESS),
    saturation: clampInt(source.saturation, FLAG_SATURATION),
    folds: clampInt(source.folds, FLAG_FOLDS),
  };
}

/* Облик рисует своё полотнище (а не лист игры). Своя картинка без картинки — нет. */
export const flagLookDraws = (look) => look.mode === "country" || (look.mode === "image" && Boolean(look.image.asset));

/* Облик, который ничего не меняет: лист игры той же яркости и насыщенности. */
export const flagLookIsStock = (look) =>
  !flagLookDraws(look) && look.brightness === FLAG_BRIGHTNESS.standard && look.saturation === FLAG_SATURATION.standard;

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

export function normalizeFlagsProject(input) {
  const source = plain(input);
  const kinds = plain(source.kinds);
  const own = {};
  for (const id of FLAG_KIND_IDS) {
    const item = plain(kinds[id]);
    if (item.own === true) own[id] = { own: true, ...normalizeFlagLook(item) };
  }
  return {
    schema: FLAGS_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    all: normalizeFlagLook(source.all),
    kinds: own,
  };
}

export const createFlagsProject = () => normalizeFlagsProject({});
export const serializeFlagsProject = (project) => JSON.stringify(normalizeFlagsProject(project));

export function parseFlagsProject(text) {
  try {
    return normalizeFlagsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createFlagsProject();
  }
}

/** Облик вида в игре: свой, если заведён, иначе — «Все флаги». */
export function flagLookOf(project, id) {
  const own = project.kinds?.[id];
  if (own?.own) {
    const { own: _own, ...look } = own;
    return look;
  }
  return project.all;
}

/** Вид правится по одному (свой облик). */
export const flagIsOwn = (project, id) => Boolean(project.kinds?.[id]?.own);

/** Виды, чей облик уходит в игру. */
export function changedFlagKinds(input) {
  const project = normalizeFlagsProject(input);
  return FLAG_KIND_IDS.filter((id) => !flagLookIsStock(flagLookOf(project, id)));
}

/** Сколько флагов на карте меняет работа. */
export const changedFlagCount = (input) => changedFlagKinds(input).reduce((sum, id) => sum + (flagKind(id)?.count || 0), 0);

/** Все флаги как в игре: ставить нечего. */
export const flagsProjectIsStock = (input) => changedFlagKinds(input).length === 0;

/* Что из облика меняет лист. */
function lookSignature(look) {
  if (flagLookIsStock(look)) return null;
  const tone = { brightness: look.brightness, saturation: look.saturation };
  if (look.mode === "country") return { mode: "country", country: look.country, folds: look.folds, ...tone };
  if (look.mode === "image" && look.image.asset)
    return {
      mode: "image",
      asset: look.image.asset,
      fit: look.fit,
      zoom: look.zoom,
      offsetX: look.offsetX,
      offsetY: look.offsetY,
      /* Поля фона видны только у «Вписать»: «Заполнить» и «Растянуть» покрывают полотнище целиком. */
      ...(look.fit === "contain" ? { background: look.background } : {}),
      folds: look.folds,
      ...tone,
    };
  return { mode: "standard", ...tone };
}

/** Что вид покажет на листе — строкой: тот же рисунок — та же строка (`"stock"` — как в игре). */
export const flagPaintKey = (look) => JSON.stringify(lookSignature(look) || "stock");

/** Отпечаток для очереди «Применить»: тот же облик флагов — тот же отпечаток. */
export function flagsProjectSignature(input) {
  const project = normalizeFlagsProject(input);
  return JSON.stringify({
    all: lookSignature(project.all),
    own: Object.fromEntries(Object.keys(project.kinds).map((id) => [id, lookSignature(flagLookOf(project, id))])),
  });
}

/** «Стандарт»: все флаги как в игре; страна, картинка и тон помнятся у «Всех флагов». */
export function applyFlagsStandard(input) {
  const project = normalizeFlagsProject(input);
  return { ...project, all: { ...project.all, mode: "standard", brightness: FLAG_BRIGHTNESS.standard, saturation: FLAG_SATURATION.standard }, kinds: {} };
}

export const resetFlagsProject = (input) => ({ ...createFlagsProject(), name: normalizeFlagsProject(input).name });

/*
 * Облик цели правки: `target` — `"all"` (все флаги) или вид. У вида правка
 * заводит свой облик поверх общего (`own`).
 */
export function updateFlagLook(input, target, patch) {
  const project = normalizeFlagsProject(input);
  if (target === "all" || !flagKind(target)) return normalizeFlagsProject({ ...project, all: { ...project.all, ...patch } });
  return normalizeFlagsProject({ ...project, kinds: { ...project.kinds, [target]: { ...flagLookOf(project, target), ...patch, own: true } } });
}

/** Вид снова «как у всех»: свой облик снят. */
export function clearFlagLook(input, target) {
  const project = normalizeFlagsProject(input);
  const kinds = { ...project.kinds };
  delete kinds[target];
  return { ...project, kinds };
}

/** Флаг страны на цель: тон и складки остаются, своя картинка помнится. */
export const applyFlagCountry = (input, target, country) => updateFlagLook(input, target, { mode: "country", country });

/* Картинки человека в код не едут: флаг со своей картинкой становится «Как в игре». */
export function shareableFlagsProject(input) {
  const project = normalizeFlagsProject(input);
  const strip = (look) => (look.mode === "image" ? { ...look, mode: "standard", image: { asset: "", name: "", width: 0, height: 0 } } : look);
  return { ...project, all: strip(project.all), kinds: Object.fromEntries(Object.entries(project.kinds).map(([id, look]) => [id, strip(look)])) };
}

export function flagsLostInCode(input) {
  const project = normalizeFlagsProject(input);
  return [project.all, ...Object.values(project.kinds)].some((look) => look.mode === "image" && look.image.asset) ? "свои картинки флагов (остаются на этом компьютере)" : "";
}

/** Свои картинки работы, что нужны установщику (`Map` ключ → имя): у видов, что уходят в игру. */
export function flagsImageAssets(input) {
  const project = normalizeFlagsProject(input);
  const out = new Map();
  for (const id of changedFlagKinds(project)) {
    const look = flagLookOf(project, id);
    if (look.mode === "image" && look.image.asset && !out.has(look.image.asset)) out.set(look.image.asset, look.image.name || "Своя картинка");
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Своя картинка под полотнище
 * ------------------------------------------------------------------ */

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

/* Уменьшение больше чем вдвое — средним по клеткам, без ряби. */
function reduceImage(image, width, height) {
  const kx = image.width / Math.max(1, width);
  const ky = image.height / Math.max(1, height);
  if (kx < 2 && ky < 2) return image;
  const stepX = Math.max(1, Math.floor(kx / 1.5));
  const stepY = Math.max(1, Math.floor(ky / 1.5));
  const w = Math.max(1, Math.floor(image.width / stepX));
  const h = Math.max(1, Math.floor(image.height / stepY));
  const out = new Uint8ClampedArray(w * h * 4);
  const sum = [0, 0, 0, 0];
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      sum.fill(0);
      for (let j = 0; j < stepY; j += 1)
        for (let i = 0; i < stepX; i += 1) {
          const at = ((y * stepY + j) * image.width + (x * stepX + i)) * 4;
          for (let channel = 0; channel < 4; channel += 1) sum[channel] += image.rgba[at + channel];
        }
      const at = (y * w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) out[at + channel] = sum[channel] / (stepX * stepY);
    }
  return { rgba: out, width: w, height: h };
}

function sampleImage(image, u, v, out) {
  const x = u * image.width - 0.5;
  const y = v * image.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (const [dx, dy, weight] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ]) {
    const at = (clamp(y0 + dy, 0, image.height - 1) * image.width + clamp(x0 + dx, 0, image.width - 1)) * 4;
    for (let channel = 0; channel < 4; channel += 1) out[channel] += image.rgba[at + channel] * weight;
  }
  return out;
}

/**
 * Где ложится картинка на полотнище `aspect : 1` (единицы полотнища):
 * `{ left, top, width, height }`. «Заполнить» — без полей, лишнее
 * обрезается; «Вписать» — целиком, поля цветом фона; «Растянуть» — по
 * полотнищу. Приближение увеличивает картинку, сдвиг (−100…100) выбирает,
 * какая её часть видна: −100 — левый (верхний) край, 100 — правый (нижний).
 */
export function flagImagePlacement(look, image, aspect) {
  const ratio = Math.max(1, image?.width || 1) / Math.max(1, image?.height || 1);
  let width;
  let height;
  if (look.fit === "stretch") {
    width = aspect;
    height = 1;
  } else {
    const cover = look.fit === "cover";
    height = cover ? Math.max(1, aspect / ratio) : Math.min(1, aspect / ratio);
    width = height * ratio;
  }
  const zoom = look.zoom / 100;
  width *= zoom;
  height *= zoom;
  /* `+ 0` — без «минус нуля» у края (сравнения и отпечатки не спотыкаются). */
  return {
    left: (aspect - width) * ((look.offsetX + 100) / 200) + 0,
    top: (1 - height) * ((look.offsetY + 100) / 200) + 0,
    width,
    height,
  };
}

/** Своя картинка на полотнище `width × height` (пиксели) пропорции `aspect`. */
export function fitFlagImage(look, image, width, height, aspect) {
  const out = new Uint8ClampedArray(width * height * 4);
  const fill = hexBytes(look.background);
  const place = flagImagePlacement(look, image, aspect);
  const source = reduceImage(image, Math.max(1, (place.width / aspect) * width), Math.max(1, place.height * height));
  const colour = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      out[at] = fill[0];
      out[at + 1] = fill[1];
      out[at + 2] = fill[2];
      out[at + 3] = 255;
      const u = (((x + 0.5) / width) * aspect - place.left) / place.width;
      const v = ((y + 0.5) / height - place.top) / place.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      sampleImage(source, u, v, colour);
      const alpha = colour[3] / 255;
      for (let channel = 0; channel < 3; channel += 1) out[at + channel] = colour[channel] * alpha + fill[channel] * (1 - alpha);
    }
  return out;
}

/* ------------------------------------------------------------------ *
 * Лист флага — одна арифметика у кадра и установщика
 * ------------------------------------------------------------------ */

/**
 * Рисунок полотнища `width × height` (без рукава) пропорции `aspect`: флаг
 * страны или своя картинка; у «Как в игре» рисунка нет — `null`.
 */
export function flagPicture(look, image, width, height, aspect = FLAG_CLOTH_ASPECT) {
  if (look.mode === "country") return drawCountryFlag(createPicture(width, height), look.country, [0, 0, width, height], aspect).rgba;
  if (look.mode === "image" && look.image.asset) {
    if (!image) return null;
    return fitFlagImage(look, image, width, height, aspect);
  }
  return null;
}

/*
 * Тени складок ткани (u — от древка, v — сверху): мягкие волны наискосок,
 * к свободному краю сильнее. Детерминированно — кадр и игра видят одни.
 */
export function flagFoldShade(u, v, folds) {
  if (!folds) return 1;
  const wave =
    0.55 * Math.sin(Math.PI * 2 * (1.6 * u + 0.3 * v) + 0.7) +
    0.3 * Math.sin(Math.PI * 2 * (2.9 * u - 0.55 * v) + 2.2) +
    0.15 * Math.sin(Math.PI * 2 * (5.1 * u + 1.3 * v) + 4.1);
  return 1 + (folds / 100) * 0.16 * wave * (0.35 + 0.65 * u);
}

function tone(rgba, from, look) {
  const brightness = look.brightness / 100;
  const saturation = look.saturation / 100;
  if (brightness === 1 && saturation === 1) return;
  for (let at = from; at < rgba.length; at += 4) {
    const luma = 0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2];
    for (let channel = 0; channel < 3; channel += 1) rgba[at + channel] = (luma + (rgba[at + channel] - luma) * saturation) * brightness;
  }
}

/* Рукав, когда листа игры нет (кадр без Astral Desktop): светлая ткань с двумя люверсами. */
function genericHoist(rgba, width, height, hoist) {
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < hoist; x += 1) {
      const at = (y * width + x) * 4;
      const grommet = (Math.abs(y - height * 0.08) < height * 0.03 || Math.abs(y - height * 0.92) < height * 0.03) && x >= hoist * 0.25 && x < hoist * 0.75;
      const shade = grommet ? 96 : 200 - (x % 2) * 10;
      rgba[at] = shade;
      rgba[at + 1] = shade;
      rgba[at + 2] = shade - 4;
      rgba[at + 3] = 255;
    }
}

/**
 * Лист флага `width × height` (RGBA) в облике `look`: `original` — лист игры
 * (RGBA того же размера) или `null`, `image` — своя картинка
 * (`{ rgba, width, height }`). У «Как в игре» — лист игры с тоном облика;
 * у своего рисунка — рисунок на полотнище с тенями складок, рукав у древка —
 * как в игре. Ответ — `null`, если рисовать нечем (своя картинка не пришла,
 * листа игры нет у «Как в игре»).
 */
export function paintFlagSheet({ original = null, width, height, look: input, image = null }) {
  const look = normalizeFlagLook(input);
  if (!flagLookDraws(look)) {
    if (!original) return null;
    const rgba = new Uint8ClampedArray(original);
    tone(rgba, 0, look);
    return rgba;
  }
  const hoist = flagHoistPixels(width);
  const fieldWidth = width - hoist;
  const picture = flagPicture(look, image, fieldWidth, height, flagFieldAspect(width));
  if (!picture) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < fieldWidth; x += 1) {
      const from = (y * fieldWidth + x) * 4;
      const at = (y * width + x + hoist) * 4;
      const shade = flagFoldShade((x + 0.5) / fieldWidth, (y + 0.5) / height, look.folds);
      rgba[at] = picture[from] * shade;
      rgba[at + 1] = picture[from + 1] * shade;
      rgba[at + 2] = picture[from + 2] * shade;
      rgba[at + 3] = 255;
    }
  tone(rgba, 0, look);
  /* Рукав у древка — пиксели листа игры как есть (у сжатого листа — те же блоки). */
  if (original)
    for (let y = 0; y < height; y += 1) {
      const at = y * width * 4;
      rgba.set(original.subarray(at, at + hoist * 4), at);
    }
  else genericHoist(rgba, width, height, hoist);
  return rgba;
}
