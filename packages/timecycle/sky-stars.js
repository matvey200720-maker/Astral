/*
 * Лист звёзд (21.11.2026).
 *
 * Звёзды в GTA V — картинка `starfield` из `skydome.ytd` (в Legacy 512×512, RGB, DXT1), которую купол повторяет по небу: цвет звезды берётся
 * из картинки, общая яркость — `sky_stars_iten`. Собственных параметров цвета, размера и мерцания у звёзд в таймцикле нет, поэтому качество
 * звёзд — это сама картинка. Этот модуль рисует её: плотность, величины звёзд (много слабых, мало ярких), цвет по классам спектра и лучи у ярких.
 *
 * Лист ПОВТОРЯЕТСЯ: звезда у края продолжается на противоположном, иначе на стыках повторов видна сетка. Мерцания у шейдера нет — лучи
 * и ореол нарисованы в листе и стоят неподвижно; честно называем это в окне.
 *
 * Штатный лист (замер 21.11: 638 звёзд на лист, медиана яркости 25 из 255, верхние ~230, цвет серо-белый) — единица шкалы: «плотность ×1»
 * даёт столько же звёзд, сколько у игры.
 */

/** Звёзд с лучами на лист при «Бликах» на максимуме. */
const GLARE_STARS = 14;

/** Звёзд на лист у игры. */
export const VANILLA_STAR_COUNT = 638;

export const STAR_LIMITS = Object.freeze({
  density: Object.freeze({ min: 0.2, max: 4 }),
  brightness: Object.freeze({ min: 0.4, max: 2 }),
  colour: Object.freeze({ min: 0, max: 1 }),
  glare: Object.freeze({ min: 0, max: 1 }),
});

const clamp = (value, { min, max }, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), max) : fallback;
};

/**
 * Лист звёзд в границах: `null` — штатный лист игры. Любой объект — свой лист:
 * `density` — во сколько раз звёзд больше, чем у игры; `brightness` — яркость звёзд; `colour` — разнообразие цветов
 * (0 — белые, как у игры; 1 — полный спектр от голубых до красных); `glare` — доля ярких звёзд с лучами и ореолом; `seed` — рисунок.
 */
export function normalizeStarSheet(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const seed = Number(raw.seed);
  return {
    density: clamp(raw.density, STAR_LIMITS.density, 1),
    brightness: clamp(raw.brightness, STAR_LIMITS.brightness, 1),
    colour: clamp(raw.colour, STAR_LIMITS.colour, 0),
    glare: clamp(raw.glare, STAR_LIMITS.glare, 0),
    seed: Number.isInteger(seed) ? Math.min(Math.max(seed, 0), 999999) : 7,
    /* Настоящее небо: вместо нарисованного листа — кусок звёздной карты NASA (`sky-assets.js`); тогда работает одна яркость, плотность и цвет у листа свои. */
    real: raw.real === true,
  };
}

/**
 * Порог густоты настоящего неба (из стенда 21.11: «поле как соль», «снег»): звёзды карты слабее порога пропадают. Плотность 1 — порог 60 из 255 (около 970 звёзд из 1590 на карте,
 * у штатного листа игры 530), вдвое реже — 148, вдвое гуще — 24; самые яркие звёзды остаются при любой плотности. Порог — в единицах пика звезды на карте, до яркости листа.
 */
export const realStarThreshold = (density) => Math.min(200, 60 * Math.max(density, 0.05) ** -1.3);

/**
 * Насыщенность цвета настоящих звёзд: 0,35 при «Цвета звёзд» 0 (мягкие, без цветной каймы) … 1 при 1 (цвета как у Gaia). Было 0,4: на листе пачки-1 (цвета Gaia целиком)
 * цветных точек было 34 % от светлых, у штатного листа игры — 2 %; при 0,35 и приглушении слабых звёзд (`weakStarShare`) после DXT1 — меньше 1 %.
 */
export const realStarSaturation = (colour) => 0.35 + 0.65 * Math.min(Math.max(colour, 0), 1);

const smoothstep = (low, high, value) => {
  const t = Math.min(Math.max((value - low) / (high - low), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Доля цвета у звезды по её яркости: слабая (пик до ~60 из 255) совсем серая, яркая (от ~160) — с полным цветом листа. DXT1 держит в блоке 4×4 два цвета и один разброс
 * между ними: одинокая слабая цветная точка рядом с другой цветной даёт цветную кайму. Цвет «Цвета звёзд» 1 сдвигает порог вниз: слабые звёзды тоже получают цвет.
 */
export const weakStarShare = (peak, colour) => smoothstep(60 * (1 - colour), 160 - 100 * colour, peak);

/*
 * Подготовка листа под DXT1 (RGB565: красный и синий — 5 бит, зелёный — 6). Серая точка в 565 не серая: красный и синий кладутся на сетку из 32 ступеней, зелёный — из 64,
 * и после сжатия слабая звезда уходит в зелёное или розовое. Здесь цвет каждой точки заранее кладётся на сетку 565: серое — ровно серое (красный и синий равны, зелёный
 * подобран под них), цветное — ближайшее на сетке, поэтому сжатие их не двигает. Малая разница каналов (до 6) считается серым. Лист правится на месте.
 */
const NEUTRAL_SPREAD = 6;
const expand5 = (level) => (level << 3) | (level >> 2);
const expand6 = (level) => (level << 2) | (level >> 4);
const level5 = (value) => Math.min(31, Math.max(0, Math.round((value / 255) * 31)));
const level6 = (value) => Math.min(63, Math.max(0, Math.round((value / 255) * 63)));
export function snapToDxt1Colours(rgba) {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) <= NEUTRAL_SPREAD) {
      const grey = expand5(level5((r + g + b) / 3));
      rgba[offset] = grey;
      rgba[offset + 1] = expand6(level6(grey));
      rgba[offset + 2] = grey;
    } else {
      rgba[offset] = expand5(level5(r));
      rgba[offset + 1] = expand6(level6(g));
      rgba[offset + 2] = expand5(level5(b));
    }
  }
  return rgba;
}

/*
 * Звёзды карты NASA: локальные максимумы пика (по восьми соседям, с заворотом через край: карта бесшовная). Ряд по «потоку» — сумме пика в 3×3 (у насыщенных звёзд пик
 * одинаков, поток их различает), `rank` — доля звёзд карты слабее этой. Кэш по карте: разбор один раз на процесс.
 */
const starCache = new WeakMap();
function tileStars(tile) {
  const cached = starCache.get(tile);
  if (cached) return cached;
  const width = tile.width;
  const peakAt = (x, y) => {
    const offset = ((((y % width) + width) % width) * width + (((x % width) + width) % width)) * 4;
    return Math.max(tile.rgba[offset], tile.rgba[offset + 1], tile.rgba[offset + 2]);
  };
  const list = [];
  for (let y = 0; y < width; y += 1)
    for (let x = 0; x < width; x += 1) {
      const peak = peakAt(x, y);
      if (peak < 16) continue;
      let top = true;
      for (let dy = -1; dy <= 1 && top; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const other = peakAt(x + dx, y + dy);
          if (other > peak || (other === peak && (dy < 0 || (dy === 0 && dx < 0)))) {
            top = false;
            break;
          }
        }
      if (!top) continue;
      let flux = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) flux += peakAt(x + dx, y + dy);
      const offset = (y * width + x) * 4;
      list.push({ x, y, peak, flux, tint: [tile.rgba[offset] / peak, tile.rgba[offset + 1] / peak, tile.rgba[offset + 2] / peak], rank: 0 });
    }
  list.sort((a, b) => a.flux - b.flux || a.peak - b.peak || a.y - b.y || a.x - b.x);
  list.forEach((star, index) => {
    star.rank = (index + 0.5) / list.length;
  });
  starCache.set(tile, list);
  return list;
}

/**
 * Яркость звезды (пик листа, 0…255 до множителя листа) по её месту `rank` в ряду карты (0 — слабейшая, 1 — ярчайшая). Карта NASA после наших усилений была почти плоской
 * (медиана пика 90, четверть звёзд ярче 160) — небо «снег»; на кадре стенда (шаблоны 22.11) яркие звёзды оставались «горошинами»: их было 4 % (41 на лист), верх 230.
 * Теперь, как у штатного листа игры (медиана 25): слабых много и они тусклые (от 10, медиана ~25; видны с уровня 16 — около 710 звёзд на лист при плотности 1), средние от 62 до 95
 * — 3 % звёзд, яркие (от 110) — 0,7 %, около 11 на лист, верх 170. Порядок звёзд карты сохранён: ярче на карте — ярче на листе.
 * `density` растит только слабую часть (звёзды ярче ~70 не трогает): плотнее — больше видимых слабых звёзд, а не больше «горошин».
 */
export const realStarLevel = (rank, density = 1) => {
  const base =
    rank < 0.96 ? 10 + 52 * (rank / 0.96) ** 3.9 : rank < 0.993 ? 62 + 33 * ((rank - 0.96) / 0.033) ** 1.4 : 110 + 60 * ((rank - 0.993) / 0.007) ** 0.8;
  const boost = Math.max(density, 0.05) ** 0.8;
  return base * (1 + (boost - 1) * (1 - smoothstep(40, 70, base)));
};

/**
 * Радиус гауссова пятна звезды в текселях листа 512 по её яркости: слабая — около 0,75 (точка в 1–3 пикселя), самая яркая — 1,1 (мягкое круглое пятно без «горошины»).
 * Звезда в один тексель при увеличении билинейным фильтром даёт ромб, а пятно от 3×3 текселей — круг (изотропия по осям и диагоналям ~10 %).
 * Замер по кадру стенда (22.11): тексель листа на экране 1280×720 при угле обзора 60° — около 0,9 пикселя; видимый размер звезды растёт с яркостью сверх пятна.
 */
export const realStarSigma = (level) => 0.75 + (0.35 * Math.min(level, 255)) / 255;

/**
 * Доля цвета у яркой звезды: яркая звезда ближе к белому (кайма на DXT1 у ярких заметнее всего: блок держит два цвета, а звезда в нём самая яркая); «Цвета звёзд» 1 возвращает цвета.
 */
const brightStarTint = (level, colour) => 1 - (1 - colour) * 0.7 * smoothstep(70, 150, level);

/* Мягкое плечо яркости: до 160 как есть, выше плавно к 255 — звезда на ×2 яркости не становится плоской «таблеткой». */
const softKnee = (value) => (value <= 160 ? value : 160 + 95 * (1 - Math.exp(-(value - 160) / 95)));

/**
 * Лист настоящего неба: места, яркость по порядку и цвета звёзд — с карты NASA (`tileStars`), а рисуются они заново: каждая — круглое гауссово пятно (`realStarSigma`) с центром
 * в тексель, без лучей и ромбов. Густота — порог слабых звёзд (`realStarThreshold`), яркость звезды — `realStarLevel`, множитель листа — `brightness`, цвет — насыщенность
 * (`realStarSaturation`, слабым звёздам цвет убавляет `weakStarShare`); в конце цвета кладутся на сетку DXT1 (`snapToDxt1Colours`).
 */
function realSheet(tile, side, { density, colour, brightness }) {
  const stars = tileStars(tile);
  const buffer = new Float32Array(side * side * 3);
  const threshold = realStarThreshold(density);
  const saturation = realStarSaturation(colour);
  const scale = side / tile.width;
  for (const star of stars) {
    if (star.peak < threshold) continue;
    const level = realStarLevel(star.rank, density) * brightness;
    const sigma = Math.max(realStarSigma(level) * scale, 0.5);
    const reach = Math.ceil(sigma * 3);
    const own = saturation * weakStarShare(star.peak, colour) * brightStarTint(level, colour);
    const grey = 0.2126 * star.tint[0] + 0.7152 * star.tint[1] + 0.0722 * star.tint[2];
    const tint = star.tint.map((value) => grey + (value - grey) * own);
    const cx = Math.round(star.x * scale);
    const cy = Math.round(star.y * scale);
    for (let dy = -reach; dy <= reach; dy += 1)
      for (let dx = -reach; dx <= reach; dx += 1) {
        const weight = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        if (weight < 0.01) continue;
        const index = ((((cy + dy) % side) + side) % side * side + (((cx + dx) % side) + side) % side) * 3;
        for (let channel = 0; channel < 3; channel += 1) buffer[index + channel] += level * weight * tint[channel];
      }
  }
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let pixel = 0; pixel < side * side; pixel += 1) {
    const peak = Math.max(buffer[pixel * 3], buffer[pixel * 3 + 1], buffer[pixel * 3 + 2]);
    const gain = peak > 160 ? softKnee(peak) / peak : 1;
    for (let channel = 0; channel < 3; channel += 1) rgba[pixel * 4 + channel] = buffer[pixel * 3 + channel] * gain;
    rgba[pixel * 4 + 3] = 255;
  }
  return { width: side, height: side, rgba: snapToDxt1Colours(rgba) };
}

/* Малый детерминированный генератор: один рисунок на одно число `seed`. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (a, b, t) => a + (b - a) * t;

/* Цвет звезды по температуре 0 (голубая) … 1 (красная); середина — белая. */
function starColour(t) {
  const stops = [
    [0.7, 0.82, 1],
    [0.9, 0.94, 1],
    [1, 1, 1],
    [1, 0.93, 0.78],
    [1, 0.78, 0.55],
    [1, 0.6, 0.45],
  ];
  const scaled = Math.min(Math.max(t, 0), 0.9999) * (stops.length - 1);
  const index = Math.floor(scaled);
  const share = scaled - index;
  return [0, 1, 2].map((channel) => mix(stops[index][channel], stops[index + 1][channel], share));
}

/**
 * Рисует лист звёзд: `{ width, height, rgba }` (альфа 255), бесшовный по краям.
 * `size` — сторона (у игры 512).
 */
export function renderStarfield(rawSheet, { size = 512, tile = null } = {}) {
  const sheet = normalizeStarSheet(rawSheet) || normalizeStarSheet({});
  const side = Math.max(16, Math.min(2048, Math.round(Number(size) || 512)));
  /* Настоящее небо: лист из `loadSkyAssets().starTile`; без него (не разобрался) — нарисованный лист ниже. */
  if (sheet.real && tile?.rgba && tile.width === tile.height && tile.rgba.length === tile.width * tile.height * 4) return realSheet(tile, side, sheet);
  const random = mulberry32(sheet.seed * 7919 + 13);
  const buffer = new Float32Array(side * side * 3);
  const scale = side / 512;
  const count = Math.round(VANILLA_STAR_COUNT * sheet.density * scale * scale);

  /* Один «мазок» с заворотом через край. Слабая звезда — точка между четырьмя пикселями (как у листа игры: почти один пиксель). */
  const splat = (cx, cy, radius, amount, colour) => {
    if (radius < 0.6) {
      /* Пик на месте: яркость точки та же, а соседям уходит доля сдвига — так слабая звезда остаётся почти одним пикселем. */
      const x = Math.round(cx);
      const y = Math.round(cy);
      const dx = cx - x;
      const dy = cy - y;
      const put = (px, py, weight) => {
        const index = (((((py % side) + side) % side) * side) + ((px % side) + side) % side) * 3;
        for (let channel = 0; channel < 3; channel += 1) buffer[index + channel] += amount * weight * colour[channel];
      };
      put(x, y, 1);
      put(x + Math.sign(dx), y, Math.abs(dx) * 0.4);
      put(x, y + Math.sign(dy), Math.abs(dy) * 0.4);
      return;
    }
    const reach = Math.ceil(radius * 3);
    const norm = 1 / (2 * radius * radius);
    for (let dy = -reach; dy <= reach; dy += 1)
      for (let dx = -reach; dx <= reach; dx += 1) {
        const weight = Math.exp(-(dx * dx + dy * dy) * norm);
        if (weight < 0.004) continue;
        const x = (((Math.round(cx) + dx) % side) + side) % side;
        const y = (((Math.round(cy) + dy) % side) + side) % side;
        const index = (y * side + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) buffer[index + channel] += amount * weight * colour[channel];
      }
  };
  /* Луч креста: вдоль оси, длина и яркость падают линейно. */
  const spike = (cx, cy, length, amount, colour, horizontal) => {
    for (let step = 1; step <= length; step += 1) {
      const fade = (1 - step / length) ** 1.5;
      for (const sign of [-1, 1]) {
        const x = (((Math.round(cx) + (horizontal ? sign * step : 0)) % side) + side) % side;
        const y = (((Math.round(cy) + (horizontal ? 0 : sign * step)) % side) + side) % side;
        const index = (y * side + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) buffer[index + channel] += amount * fade * colour[channel];
      }
    }
  };

  /* Лучи — у самых ярких звёзд листа, а не у каждой яркой: иначе небо похоже на гирлянду. */
  const stars = [];
  for (let index = 0; index < count; index += 1) {
    const cx = random() * side;
    const cy = random() * side;
    /* Величины: много слабых, мало ярких (замер штатного листа: медиана 25, верх ≈ 230). */
    const unit = random();
    /* Двумя частями: 97 % — слабые (медиана ≈ 25), 3 % — яркий хвост (110…230). */
    const base = unit < 0.975 ? 8 + 52 * (unit / 0.975) ** 1.6 : 110 + 120 * ((unit - 0.975) / 0.025) ** 0.8;
    const level = Math.min(base, 255) * sheet.brightness;
    const tint = starColour(0.4 + (random() - 0.5) * 2 * 0.6 * sheet.colour + (random() < 0.5 ? 0 : 0));
    const colour = sheet.colour === 0 ? [1, 1, 1] : tint;
    const amount = level / 255;
    const radius = level < 110 ? 0.5 : 1.05;
    splat(cx, cy, radius * (side >= 1024 ? 1.6 : 1), amount, colour);
    stars.push({ cx, cy, level, amount, colour, radius });
  }
  const glareCount = Math.round(sheet.glare * GLARE_STARS * scale * scale);
  stars.sort((a, b) => b.level - a.level);
  for (const star of stars.slice(0, glareCount)) {
    /* Яркая звезда: мягкий ореол и крест из двух коротких лучей. */
    splat(star.cx, star.cy, star.radius * 2.6, star.amount * 0.16, star.colour);
    const length = Math.max(3, Math.round(((star.level - 90) / 16) * scale));
    spike(star.cx, star.cy, length, star.amount * 0.4, star.colour, true);
    spike(star.cx, star.cy, length, star.amount * 0.4, star.colour, false);
  }

  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let pixel = 0; pixel < side * side; pixel += 1) {
    rgba[pixel * 4] = buffer[pixel * 3] * 255;
    rgba[pixel * 4 + 1] = buffer[pixel * 3 + 1] * 255;
    rgba[pixel * 4 + 2] = buffer[pixel * 3 + 2] * 255;
    rgba[pixel * 4 + 3] = 255;
  }
  return { width: side, height: side, rgba: snapToDxt1Colours(rgba) };
}
