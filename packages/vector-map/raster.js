/*
 * Растровая подложка: перекраска по цветам карты, тон, подкраска и текстура.
 *
 * Карта из игры — картинка, и палитра «суша, дороги, вода» на неё не
 * действовала: ползунки цвета работали только на схеме штата, а на настоящей
 * карте человеку оставалось открыть каждую плитку в Photoshop. Здесь это
 * делается на месте, по пикселям, и один и тот же код обслуживает окно
 * редактора и плитки, которые уезжают в игру, — расхождения «в редакторе
 * одно, в игре другое» здесь нет по построению.
 *
 * Конвейер одного пикселя:
 *
 *   перекраска по цветам → тон (яркость, контраст, насыщенность) →
 *   подкраска с режимом наложения → текстура с режимом наложения
 *
 * Первые три шага зависят только от цвета пикселя, поэтому сворачиваются в
 * одну трёхмерную таблицу (LUT): она пересчитывается на каждое движение
 * ползунка за миллисекунды, а карта в шесть миллионов точек проходит через
 * неё одним проходом с трилинейной интерполяцией. Текстура зависит от места
 * на карте и идёт отдельным проходом.
 *
 * Прозрачность пикселя не трогает ни один шаг: у плиток игры море вырезано,
 * и закрасить его значило бы отдать в игру карту, закрывающую воду.
 *
 * Формулы тона повторяют функции CSS `brightness()`, `contrast()` и
 * `saturate()`, формулы наложения — спецификацию W3C Compositing and
 * Blending: проекты, собранные до этого файла, выглядят так же, как
 * выглядели, когда те же операции выполнял фильтр SVG и режим канвы.
 *
 * Модуль чистый: ни DOM, ни канвы. Пиксели приходят массивом RGBA.
 */

import { clamp01, hexToRgb, isHexColor } from "./color.js";

/* ------------------------------------------------------------------------ */
/* Поле перекраски                                                           */
/* ------------------------------------------------------------------------ */

/*
 * Кому принадлежит цвет.
 *
 * Пиксель карты — либо один из её цветов (с шумом сжатия), либо переход между
 * двумя её цветами: кромка сглаживания дороги на суше, ступень градиента
 * мелководья. И то и другое — точка на отрезке между двумя цветами карты в
 * пространстве RGB. Поэтому для каждого цвета ищется пара цветов карты, чей
 * отрезок проходит к нему ближе всего: положение на отрезке даёт долю смеси,
 * расстояние до отрезка — уверенность. Кромка дороги на синей суше после
 * перекраски остаётся кромкой между новым цветом дороги и новым цветом суши,
 * а не серой каймой.
 *
 * Пары перебираются среди нескольких ближайших цветов карты, а не только с
 * самым ближним: серо-голубая вода проходит мимо серых дорог ближе, чем мимо
 * собственных ступеней, и правило «ближайший цвет и его сосед» красило бы её
 * полосами цвета дорог.
 *
 * Цвет, далёкий от всех отрезков, карте не принадлежит (чужая вставка) и
 * остаётся как был.
 *
 * Для серой векторной карты все цвета лежат на одной прямой, и правило
 * превращается в карту градиента (Gradient Map) с опорами в цветах карты —
 * ровно тот приём, которым такие карты перекрашивают в Photoshop.
 */
const CONFIDENCE_SIGMA = 16;
/*
 * Шум блочного сжатия. Ровная заливка после DXT — облачко в несколько уровней
 * вокруг своего цвета, и без поправки оно читалось бы как «немного смеси с
 * соседом» и «немного чужой цвет»: заливка после перекраски шла бы пятнами.
 * Поэтому вблизи цвета карты доля смеси равна нулю, а уверенность — единице.
 */
const FLAT_RADIUS = 6;
const SURE_RESIDUAL = 12;
/* Среди скольких ближайших цветов карты ищется пара. */
const NEAREST_POOL = 4;
/* При равном остатке выигрывает короткий отрезок: пиксель между двумя
   соседними серыми — их смесь, а не смесь крайних цветов той же прямой. */
const LENGTH_PENALTY = 1e-3;

function segmentSolver(colors) {
  const count = colors.length;
  const pool = Math.min(NEAREST_POOL, count);
  const gaps = new Float64Array(count);
  const order = new Int32Array(pool);
  const result = { a: 0, b: 0, t: 0, residual: Infinity };

  const solve = (r, g, b) => {
    for (let index = 0; index < count; index += 1) {
      const color = colors[index];
      gaps[index] =
        (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
    }
    /* Несколько ближайших — выбором, без сортировки всего списка. */
    for (let slot = 0; slot < pool; slot += 1) {
      let best = -1;
      for (let index = 0; index < count; index += 1) {
        let taken = false;
        for (let seen = 0; seen < slot; seen += 1)
          if (order[seen] === index) taken = true;
        if (taken) continue;
        if (best < 0 || gaps[index] < gaps[best]) best = index;
      }
      order[slot] = best;
    }

    const nearest = order[0];
    result.a = nearest;
    result.b = nearest;
    result.t = 0;
    result.residual = Math.sqrt(gaps[nearest]);
    let bestScore = result.residual;

    for (let i = 0; i < pool; i += 1) {
      for (let j = i + 1; j < pool; j += 1) {
        const from = colors[order[i]];
        const to = colors[order[j]];
        const sx = to[0] - from[0];
        const sy = to[1] - from[1];
        const sz = to[2] - from[2];
        const lengthSquared = sx * sx + sy * sy + sz * sz;
        if (!lengthSquared) continue;
        const px = r - from[0];
        const py = g - from[1];
        const pz = b - from[2];
        let t = (px * sx + py * sy + pz * sz) / lengthSquared;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const dx = px - sx * t;
        const dy = py - sy * t;
        const dz = pz - sz * t;
        const residual = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const length = Math.sqrt(lengthSquared);
        const score = residual + length * LENGTH_PENALTY;
        if (score >= bestScore) continue;
        bestScore = score;
        /* Доля смеси считается между краями ровных зон, а не между самими
           цветами: на середине отрезка она по-прежнему ровно половина. */
        const span = length - FLAT_RADIUS * 2;
        const along = t * length;
        result.a = order[i];
        result.b = order[j];
        result.t =
          span > 0
            ? Math.min(1, Math.max(0, along - FLAT_RADIUS) / span)
            : t < 0.5
              ? 0
              : 1;
        result.residual = residual;
      }
    }
    return result;
  };
  return solve;
}

/** Сторона таблицы цвета. 64 узла на канал: шаг в четыре уровня яркости. */
export const COLOR_MAP_SIDE = 64;

/**
 * Поле перекраски: для каждого узла таблицы — пара цветов карты, доля смеси
 * и уверенность.
 *
 * Поле зависит только от цветов самой карты, а не от того, во что их красят,
 * поэтому считается один раз на карту. Движение ползунка цвета пересобирает
 * лишь таблицу поверх готового поля — это и даёт живой отклик.
 *
 * @param {string[]} colors цвета карты (#rrggbb)
 */
export function createRecolorField(colors, side = COLOR_MAP_SIDE) {
  const list = (Array.isArray(colors) ? colors : []).map(hexToRgb);
  const nodes = side ** 3;
  const field = {
    side,
    count: list.length,
    a: new Uint8Array(nodes),
    b: new Uint8Array(nodes),
    /* Доля второго цвета и уверенность — в 1/255. */
    t: new Uint8Array(nodes),
    confidence: new Uint8Array(nodes),
  };
  if (!list.length) return field;
  const solve = segmentSolver(list);
  const scale = 255 / (side - 1);
  const falloff = -1 / (2 * CONFIDENCE_SIGMA * CONFIDENCE_SIGMA);
  let node = 0;
  for (let ri = 0; ri < side; ri += 1) {
    for (let gi = 0; gi < side; gi += 1) {
      for (let bi = 0; bi < side; bi += 1) {
        const found = solve(ri * scale, gi * scale, bi * scale);
        field.a[node] = found.a;
        field.b[node] = found.b;
        field.t[node] = Math.round(found.t * 255);
        const doubt = Math.max(0, found.residual - SURE_RESIDUAL);
        field.confidence[node] = Math.round(
          Math.exp(doubt * doubt * falloff) * 255,
        );
        node += 1;
      }
    }
  }
  return field;
}

/* ------------------------------------------------------------------------ */
/* Наложение (W3C Compositing and Blending Level 1)                          */
/* ------------------------------------------------------------------------ */

const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

function clipColor(out) {
  const l = lum(out[0], out[1], out[2]);
  const n = Math.min(out[0], out[1], out[2]);
  const x = Math.max(out[0], out[1], out[2]);
  if (n < 0)
    for (let c = 0; c < 3; c += 1) out[c] = l + ((out[c] - l) * l) / (l - n);
  if (x > 1)
    for (let c = 0; c < 3; c += 1)
      out[c] = l + ((out[c] - l) * (1 - l)) / (x - l);
}

function setLum(out, r, g, b, l) {
  const d = l - lum(r, g, b);
  out[0] = r + d;
  out[1] = g + d;
  out[2] = b + d;
  clipColor(out);
}

function setSat(out, r, g, b, s) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  const scale = s / (max - min);
  out[0] = (r - min) * scale;
  out[1] = (g - min) * scale;
  out[2] = (b - min) * scale;
}

const softLightD = (cb) =>
  cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);

const SEPARABLE = Object.freeze({
  normal: (cb, cs) => cs,
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  overlay: (cb, cs) =>
    cb <= 0.5 ? cs * 2 * cb : cs + (2 * cb - 1) - cs * (2 * cb - 1),
  "soft-light": (cb, cs) =>
    cs <= 0.5
      ? cb - (1 - 2 * cs) * cb * (1 - cb)
      : cb + (2 * cs - 1) * (softLightD(cb) - cb),
  lighten: (cb, cs) => Math.max(cb, cs),
  darken: (cb, cs) => Math.min(cb, cs),
});

const scratch = [0, 0, 0];

/**
 * Смешивает цвет источника с подложкой. Все значения — 0..1.
 * Результат пишется в `out`, чтобы внутренний цикл не рождал массивы.
 */
export function blendColor(out, mode, br, bg, bb, sr, sg, sb) {
  if (mode === "color") {
    setLum(out, sr, sg, sb, lum(br, bg, bb));
    return out;
  }
  if (mode === "hue") {
    const max = Math.max(br, bg, bb);
    const min = Math.min(br, bg, bb);
    setSat(scratch, sr, sg, sb, max - min);
    setLum(out, scratch[0], scratch[1], scratch[2], lum(br, bg, bb));
    return out;
  }
  const blend = SEPARABLE[mode] || SEPARABLE.normal;
  out[0] = blend(br, sr);
  out[1] = blend(bg, sg);
  out[2] = blend(bb, sb);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Таблица цвета                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Цели перекраски: во что превращается каждый цвет карты.
 *
 * Палитра проекта задаёт цвет роли, а на карте у роли бывает несколько
 * оттенков (два серых квартала, три ступени мелководья). Главный оттенок роли
 * — самый большой по площади — получает цвет палитры точно, остальные
 * сдвигаются на ту же разницу: рельеф внутри роли сохраняется.
 *
 * Кроме одного случая: оттенок, лежащий на прямой между сушей и главным
 * цветом своей роли, — это смесь их двух (просёлок в точку шириной, кромка
 * сглаживания большой дороги). Он остаётся смесью и после перекраски — той
 * же долей между новой сушей и новым цветом роли. Сдвиг здесь ломал бы
 * соотношение: на белой карте с тёмными дорогами кромка стала бы темнее
 * самой дороги, и вокруг каждой дороги легла бы чёрная кайма.
 *
 * @param {{color: string, role: string, share?: number}[]} sources
 * @param {object} base палитра проекта (`config.base`)
 * @returns {number[][]} цель для каждого источника, RGB 0..255
 */
export function recolorTargets(sources, base) {
  const list = Array.isArray(sources) ? sources : [];
  const primary = new Map();
  for (const source of list) {
    const held = primary.get(source.role);
    if (!held || (Number(source.share) || 0) > (Number(held.share) || 0))
      primary.set(source.role, source);
  }
  const shifted = (source) => {
    const from = hexToRgb(source.color);
    const wanted = base?.[source.role];
    if (source.role === "keep" || !isHexColor(wanted)) return from;
    const lead = hexToRgb(primary.get(source.role).color);
    const to = hexToRgb(wanted);
    return from.map((value, channel) =>
      Math.max(0, Math.min(255, value + to[channel] - lead[channel])),
    );
  };
  const land = primary.get("land");
  const landFrom = land ? hexToRgb(land.color) : null;
  const landTo = land ? shifted(land) : null;
  return list.map((source) => {
    const lead = primary.get(source.role);
    if (!land || source === lead || source.role === "land")
      return shifted(source);
    if (source.role === "keep" || !isHexColor(base?.[source.role]))
      return hexToRgb(source.color);
    const t = alongSegment(
      hexToRgb(source.color),
      landFrom,
      hexToRgb(lead.color),
    );
    if (t === null) return shifted(source);
    const to = hexToRgb(base[source.role]);
    return landTo.map((value, channel) => value + (to[channel] - value) * t);
  });
}

/* Отклонение от прямой, в пределах которого цвет считается смесью двух. */
const BLEND_RESIDUAL = 12;

/** Доля `point` на отрезке `from → to` или `null`, если он не на отрезке. */
function alongSegment(point, from, to) {
  const sx = to[0] - from[0];
  const sy = to[1] - from[1];
  const sz = to[2] - from[2];
  const lengthSquared = sx * sx + sy * sy + sz * sz;
  if (!lengthSquared) return null;
  const px = point[0] - from[0];
  const py = point[1] - from[1];
  const pz = point[2] - from[2];
  const t = (px * sx + py * sy + pz * sz) / lengthSquared;
  if (t <= 0 || t >= 1) return null;
  const residual = Math.hypot(px - sx * t, py - sy * t, pz - sz * t);
  return residual < BLEND_RESIDUAL ? t : null;
}

/** Нужен ли подложке пиксельный проход: иначе плитки идут как есть. */
export function baseRasterActive(base, sources = []) {
  if (!base) return false;
  return Boolean(
    (base.recolor && sources.length) ||
    base.brightness !== 100 ||
    base.contrast !== 100 ||
    base.saturation !== 100 ||
    base.tintOpacity > 0 ||
    (base.textureId && base.textureId !== "none" && base.textureOpacity > 0),
  );
}

/** Нужна ли таблица цвета: текстура одна обходится без неё. */
export function baseColorMapActive(base, sources = []) {
  if (!base) return false;
  return Boolean(
    (base.recolor && sources.length) ||
    base.brightness !== 100 ||
    base.contrast !== 100 ||
    base.saturation !== 100 ||
    base.tintOpacity > 0,
  );
}

/**
 * Таблица цвета подложки: перекраска, тон и подкраска одним массивом.
 *
 * @param {object} base `config.base`
 * @param {{field: object, sources: object[]}|null} recolor поле и источники;
 *   без них (или при выключенной перекраске) таблица несёт только тон и
 *   подкраску
 * @returns {{side: number, data: Uint8Array}}
 */
export function buildBaseColorMap(base, recolor = null, side = COLOR_MAP_SIDE) {
  const field = base?.recolor && recolor?.field?.count ? recolor.field : null;
  const mapSide = field ? field.side : side;
  const data = new Uint8Array(mapSide ** 3 * 3);
  const scale = 1 / (mapSide - 1);

  let deltas = null;
  if (field) {
    const targets = recolorTargets(recolor.sources, base);
    deltas = recolor.sources.map((source, index) => {
      const from = hexToRgb(source.color);
      return [
        (targets[index][0] - from[0]) / 255,
        (targets[index][1] - from[1]) / 255,
        (targets[index][2] - from[2]) / 255,
      ];
    });
  }

  const brightness = (base?.brightness ?? 100) / 100;
  const contrast = (base?.contrast ?? 100) / 100;
  const saturation = (base?.saturation ?? 100) / 100;
  const toned = brightness !== 1 || contrast !== 1 || saturation !== 1;
  /* Матрица `saturate()` из Filter Effects. */
  const s = saturation;
  const m = [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s,
  ];

  const tintAlpha = Math.max(0, Math.min(1, (base?.tintOpacity || 0) / 100));
  const tint = hexToRgb(base?.tintColor).map((value) => value / 255);
  const tintMode = base?.tintBlend || "color";
  const blended = [0, 0, 0];

  let node = 0;
  let offset = 0;
  for (let ri = 0; ri < mapSide; ri += 1) {
    for (let gi = 0; gi < mapSide; gi += 1) {
      for (let bi = 0; bi < mapSide; bi += 1) {
        let r = ri * scale;
        let g = gi * scale;
        let b = bi * scale;

        if (field) {
          const confidence = field.confidence[node] / 255;
          if (confidence > 0) {
            const t = field.t[node] / 255;
            const da = deltas[field.a[node]];
            const db = deltas[field.b[node]];
            r = clamp01(r + confidence * (da[0] + (db[0] - da[0]) * t));
            g = clamp01(g + confidence * (da[1] + (db[1] - da[1]) * t));
            b = clamp01(b + confidence * (da[2] + (db[2] - da[2]) * t));
          }
        }

        if (toned) {
          /* Порядок как у `baseFilter`: яркость, контраст, насыщенность —
             и обрезка после каждой функции, как делает фильтр. */
          r = clamp01(r * brightness);
          g = clamp01(g * brightness);
          b = clamp01(b * brightness);
          r = clamp01((r - 0.5) * contrast + 0.5);
          g = clamp01((g - 0.5) * contrast + 0.5);
          b = clamp01((b - 0.5) * contrast + 0.5);
          if (saturation !== 1) {
            const nr = m[0] * r + m[1] * g + m[2] * b;
            const ng = m[3] * r + m[4] * g + m[5] * b;
            const nb = m[6] * r + m[7] * g + m[8] * b;
            r = clamp01(nr);
            g = clamp01(ng);
            b = clamp01(nb);
          }
        }

        if (tintAlpha > 0) {
          blendColor(blended, tintMode, r, g, b, tint[0], tint[1], tint[2]);
          r += (clamp01(blended[0]) - r) * tintAlpha;
          g += (clamp01(blended[1]) - g) * tintAlpha;
          b += (clamp01(blended[2]) - b) * tintAlpha;
        }

        data[offset] = Math.round(r * 255);
        data[offset + 1] = Math.round(g * 255);
        data[offset + 2] = Math.round(b * 255);
        offset += 3;
        node += 1;
      }
    }
  }
  return { side: mapSide, data };
}

/**
 * Пропускает пиксели через таблицу цвета, на месте. Альфа не меняется,
 * полностью прозрачные пиксели пропускаются.
 *
 * Интерполяция трилинейная, в целых числах: веса — 1/256. Подряд идущие
 * одинаковые пиксели (а на карте из ровных заливок таких большинство)
 * считаются один раз.
 */
export function applyColorMap(pixels, map) {
  const { side, data } = map;
  const last = side - 1;
  /* Узел и вес для каждого из 256 значений канала. */
  const cell = new Uint8Array(256);
  const weight = new Uint16Array(256);
  for (let value = 0; value < 256; value += 1) {
    const position = (value * last) / 255;
    const index = Math.min(last - 1, Math.floor(position));
    cell[value] = index;
    weight[value] = Math.round((position - index) * 256);
  }
  const strideR = side * side * 3;
  const strideG = side * 3;
  let previous = -1;
  let outR = 0;
  let outG = 0;
  let outB = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (!pixels[index + 3]) continue;
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const key = (r << 16) | (g << 8) | b;
    if (key !== previous) {
      previous = key;
      const wr = weight[r];
      const wg = weight[g];
      const wb = weight[b];
      const ir = 256 - wr;
      const ig = 256 - wg;
      const ib = 256 - wb;
      const o000 = cell[r] * strideR + cell[g] * strideG + cell[b] * 3;
      const o001 = o000 + 3;
      const o010 = o000 + strideG;
      const o011 = o010 + 3;
      const o100 = o000 + strideR;
      const o101 = o100 + 3;
      const o110 = o100 + strideG;
      const o111 = o110 + 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const c00 = data[o000 + channel] * ib + data[o001 + channel] * wb;
        const c01 = data[o010 + channel] * ib + data[o011 + channel] * wb;
        const c10 = data[o100 + channel] * ib + data[o101 + channel] * wb;
        const c11 = data[o110 + channel] * ib + data[o111 + channel] * wb;
        const c0 = (c00 * ig + c01 * wg) >> 8;
        const c1 = (c10 * ig + c11 * wg) >> 8;
        const value = (c0 * ir + c1 * wr + 32768) >> 16;
        if (channel === 0) outR = value;
        else if (channel === 1) outG = value;
        else outB = value;
      }
    }
    pixels[index] = outR;
    pixels[index + 1] = outG;
    pixels[index + 2] = outB;
  }
  return pixels;
}

/*
 * Уменьшенные копии текстуры. Окно редактора показывает карту мельче, чем
 * она уедет в игру; без них мелкая текстура в окне рябила бы муаром, которого
 * в игре нет.
 */
const mipCache = new WeakMap();

function textureLevels(texture) {
  const cached = mipCache.get(texture);
  if (cached) return cached;
  const levels = [texture];
  let current = texture;
  while (current.width > 8 && current.height > 8) {
    const width = current.width >> 1;
    const height = current.height >> 1;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let dy = 0; dy < 2; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const index = ((y * 2 + dy) * current.width + x * 2 + dx) * 4;
            const alpha = current.data[index + 3];
            r += current.data[index] * alpha;
            g += current.data[index + 1] * alpha;
            b += current.data[index + 2] * alpha;
            a += alpha;
          }
        }
        const index = (y * width + x) * 4;
        /* Цвет усредняется с весом альфы: прозрачный сосед не тянет к чёрному. */
        data[index] = a ? r / a : 0;
        data[index + 1] = a ? g / a : 0;
        data[index + 2] = a ? b / a : 0;
        data[index + 3] = a / 4;
      }
    }
    current = { ...current, width, height, data };
    levels.push(current);
  }
  mipCache.set(texture, levels);
  return levels;
}

/**
 * Кладёт текстуру на пиксели подложки, на месте.
 *
 * @param {Uint8ClampedArray} pixels RGBA участка карты
 * @param {number} width ширина участка в пикселях
 * @param {number} height высота участка в пикселях
 * @param {{u:number,v:number,width:number,height:number}} region место
 *   участка на атласе в долях (как `tile.rect`): раппорт считается от атласа,
 *   поэтому на стыках плиток рисунок не рвётся
 * @param {{width:number,height:number,data:Uint8ClampedArray,kind?:string}} texture
 * @param {{blend?:string, opacity?:number, scale?:number, color?:string,
 *   columns?:number, rows?:number}} options `scale` — повторов на ширину
 *   атласа; `columns`/`rows` — сетка атласа (она задаёт его пропорцию)
 */
export function applyTextureLayer(
  pixels,
  width,
  height,
  region,
  texture,
  options = {},
) {
  const opacity = Math.max(0, Math.min(1, (options.opacity ?? 100) / 100));
  if (!texture?.data || !opacity || !width || !height) return pixels;
  const mode = options.blend || "overlay";
  const scale = Math.max(0.25, Number(options.scale) || 1);
  const columns = Math.max(1, Number(options.columns) || 2);
  const rows = Math.max(1, Number(options.rows) || 3);
  const tinted = texture.kind === "lines";
  const colour = hexToRgb(options.color || "#ffffff").map((v) => v / 255);

  /* Раппорт в долях атласа. Текстура квадратна в мире, а не в долях: атлас
     вытянут по вертикали, и доля по высоте пересчитывается через его сетку. */
  const repeatU = 1 / scale;
  const repeatV = (repeatU * columns * texture.height) / (rows * texture.width);

  /* Уровень уменьшения: сколько точек текстуры приходится на точку карты. */
  const texelsPerPixel = (region.width / width / repeatU) * texture.width;
  const levels = textureLevels(texture);
  const level =
    levels[
      Math.max(
        0,
        Math.min(levels.length - 1, Math.round(Math.log2(texelsPerPixel))),
      )
    ] || texture;
  const tw = level.width;
  const th = level.height;
  const source = level.data;

  /* Билинейная выборка с заворотом: индексы и веса — по столбцам и строкам. */
  const axis = (count, start, span, repeat, size) => {
    const i0 = new Int32Array(count);
    const i1 = new Int32Array(count);
    const w = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const place = (start + ((index + 0.5) / count) * span) / repeat;
      const texel = (place - Math.floor(place)) * size - 0.5;
      const floor = Math.floor(texel);
      i0[index] = ((floor % size) + size) % size;
      i1[index] = (i0[index] + 1) % size;
      w[index] = texel - floor;
    }
    return { i0, i1, w };
  };
  const ax = axis(width, region.u, region.width, repeatU, tw);
  const ay = axis(height, region.v, region.height, repeatV, th);

  const out = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    const row0 = ay.i0[y] * tw;
    const row1 = ay.i1[y] * tw;
    const wy = ay.w[y];
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!pixels[index + 3]) continue;
      const wx = ax.w[x];
      const p00 = (row0 + ax.i0[x]) * 4;
      const p01 = (row0 + ax.i1[x]) * 4;
      const p10 = (row1 + ax.i0[x]) * 4;
      const p11 = (row1 + ax.i1[x]) * 4;
      const w00 = (1 - wx) * (1 - wy);
      const w01 = wx * (1 - wy);
      const w10 = (1 - wx) * wy;
      const w11 = wx * wy;
      const sa =
        (source[p00 + 3] * w00 +
          source[p01 + 3] * w01 +
          source[p10 + 3] * w10 +
          source[p11 + 3] * w11) /
        255;
      const cover = sa * opacity;
      if (cover <= 0) continue;
      let sr;
      let sg;
      let sb;
      if (tinted) {
        [sr, sg, sb] = colour;
      } else {
        sr =
          (source[p00] * w00 +
            source[p01] * w01 +
            source[p10] * w10 +
            source[p11] * w11) /
          255;
        sg =
          (source[p00 + 1] * w00 +
            source[p01 + 1] * w01 +
            source[p10 + 1] * w10 +
            source[p11 + 1] * w11) /
          255;
        sb =
          (source[p00 + 2] * w00 +
            source[p01 + 2] * w01 +
            source[p10 + 2] * w10 +
            source[p11 + 2] * w11) /
          255;
      }
      const br = pixels[index] / 255;
      const bg = pixels[index + 1] / 255;
      const bb = pixels[index + 2] / 255;
      blendColor(out, mode, br, bg, bb, sr, sg, sb);
      pixels[index] = (br + (clamp01(out[0]) - br) * cover) * 255 + 0.5;
      pixels[index + 1] = (bg + (clamp01(out[1]) - bg) * cover) * 255 + 0.5;
      pixels[index + 2] = (bb + (clamp01(out[2]) - bb) * cover) * 255 + 0.5;
    }
  }
  return pixels;
}
