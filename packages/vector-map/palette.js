/*
 * Цвета карты игрока: поиск, роли и правки ролей.
 *
 * Карта из игры — картинка, но нарисована она несколькими ровными цветами:
 * суша, дороги, застройка, вода. Этот модуль находит их в плитках и называет
 * по ролям, чтобы палитра проекта («суша — такая, дороги — такие») и шаблоны
 * ложились на любую карту — стоковый атлас или чёрную векторную.
 *
 * Модуль чистый: пиксели приходят массивом RGBA.
 */

import { colorDistance as distance, hexToRgb, rgbToHex } from "./color.js";

/* ------------------------------------------------------------------------ */
/* Роли цветов                                                               */
/* ------------------------------------------------------------------------ */

/*
 * Роль связывает найденный на карте цвет с ключом палитры проекта. Шаблон
 * говорит «суша — такая, дороги — такие», а карта у каждого своя: у одного
 * стоковый атлас, у другого чёрная векторная. Роль — то, что позволяет одному
 * шаблону лечь на обе.
 *
 * `keep` — цвет, который человек велел не трогать.
 */
export const MAP_COLOR_ROLES = Object.freeze([
  Object.freeze({ id: "land", label: "Суша" }),
  Object.freeze({ id: "terrain", label: "Рельеф" }),
  Object.freeze({ id: "buildings", label: "Застройка" }),
  Object.freeze({ id: "roads", label: "Дороги" }),
  Object.freeze({ id: "highways", label: "Магистрали" }),
  Object.freeze({ id: "water", label: "Вода" }),
  Object.freeze({ id: "sand", label: "Песок" }),
  Object.freeze({ id: "runway", label: "Полосы и площадки" }),
  Object.freeze({ id: "outline", label: "Контуры" }),
  Object.freeze({ id: "sea", label: "Океан" }),
  Object.freeze({ id: "keep", label: "Не менять" }),
]);

export const MAP_COLOR_ROLE_IDS = Object.freeze(
  MAP_COLOR_ROLES.map((role) => role.id),
);

/** Сколько цветов карты держит проект: больше человеку не разобрать глазами. */
export const MAP_PALETTE_LIMIT = 10;

/* ------------------------------------------------------------------------ */
/* Поиск цветов карты                                                        */
/* ------------------------------------------------------------------------ */

/* Гистограмма по 5 бит на канал: 32 768 корзин хватает, чтобы разделить
   соседние серые векторной карты, и мало, чтобы шум DXT размазал пик. */
const BIN_BITS = 5;
const BIN_SHIFT = 8 - BIN_BITS;
const BIN_SIDE = 1 << BIN_BITS;
const BIN_COUNT = BIN_SIDE ** 3;

/* Ближе этого расстояния два цвета считаются одним: это разброс, который
   блочное сжатие даёт ровной заливке, с запасом. */
const MERGE_DISTANCE = 24;
/* Цвет, занимающий меньше этой доли карты, — не элемент карты, а кромка
   сглаживания между двумя элементами. */
const MIN_SHARE = 0.004;
/* Столько выборок с одной картинки достаточно: доли цветов сходятся раньше. */
const SAMPLES_PER_IMAGE = 200_000;
/* Полупрозрачная кромка берега несёт цвет, смешанный с ничем: в палитру
   идут только плотные пиксели. */
const OPAQUE_ALPHA = 200;
/* Ниже этой плотности пиксель почти не виден, а его цвет — почти случайность
   сжатия: в поиск цветов он не идёт. */
const GLOW_ALPHA = 40;
/* Контраст с сушей (в уровнях яркости), с которого нейтральный цвет считается
   дорогой, а не застройкой. */
const ROAD_CONTRAST = 60;
/* Маска считается пустой, пока в ней нет и следа рисунка: ореол берега тянется
   далеко в море, и под ним запечённое море уже смешано с цветом ореола. */
const MASK_ALPHA = 4;
/* Кромка сглаживания: во сколько раз она меньше меньшего из двух цветов, между
   которыми лежит, и как близко к отрезку между ними. */
const EDGE_SHARE = 0.3;
const EDGE_RESIDUAL = 10;

/**
 * Цвета одного слоя карты.
 *
 * Векторные карты сообщества — несколько ровных заливок, стоковый атлас —
 * десяток. И те и другие дают в гистограмме острые пики, поэтому поиск —
 * жадное объединение корзин вокруг самых населённых, а не k-means со
 * случайным стартом: результат обязан быть одинаковым при каждом открытии
 * редактора, иначе роли цветов «прыгали» бы от запуска к запуску.
 *
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number,
 *   mask?: {data: Uint8ClampedArray, width: number, height: number}}[]} images
 *   `mask` — картинка того же места карты: пиксель идёт в поиск, только если
 *   в маске на его месте пусто. Так у плиток с запечённым морем находится
 *   именно море: маской служит плитка суши, у которой море вырезано.
 * @param {object} [options]
 * @param {number} [options.limit] сколько цветов вернуть
 * @param {"solid"|"glow"} [options.layer] плотные пиксели или полупрозрачные.
 *   Полупрозрачным на картах рисуют воду и ореол берега — длинный плавный
 *   градиент, поэтому его цвета сливаются вдвое охотнее: иначе он занял бы
 *   всю палитру ступеньками одного и того же.
 * @returns {{color: string, share: number}[]} по убыванию доли
 */
export function detectMapPalette(images, options = {}) {
  const limit = Math.max(1, Math.min(MAP_PALETTE_LIMIT, options.limit || 8));
  const glow = options.layer === "glow";
  const merge = glow ? MERGE_DISTANCE * 2 : MERGE_DISTANCE;
  const counts = new Uint32Array(BIN_COUNT);
  const sums = new Float64Array(BIN_COUNT * 3);
  let total = 0;

  for (const image of Array.isArray(images) ? images : []) {
    const data = image?.data;
    const width = Number(image?.width) || 0;
    const height = Number(image?.height) || 0;
    if (!data || !width || !height) continue;
    const mask = image.mask?.data ? image.mask : null;
    const step = Math.max(
      1,
      Math.floor(Math.sqrt((width * height) / SAMPLES_PER_IMAGE)),
    );
    for (let y = step >> 1; y < height; y += step) {
      for (let x = step >> 1; x < width; x += step) {
        const index = (y * width + x) * 4;
        const alpha = data[index + 3];
        if (
          glow
            ? alpha < GLOW_ALPHA || alpha >= OPAQUE_ALPHA
            : alpha < OPAQUE_ALPHA
        )
          continue;
        if (mask) {
          const mx = Math.min(
            mask.width - 1,
            Math.floor(((x + 0.5) / width) * mask.width),
          );
          const my = Math.min(
            mask.height - 1,
            Math.floor(((y + 0.5) / height) * mask.height),
          );
          if (mask.data[(my * mask.width + mx) * 4 + 3] >= MASK_ALPHA) continue;
        }
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const bin =
          ((r >> BIN_SHIFT) * BIN_SIDE + (g >> BIN_SHIFT)) * BIN_SIDE +
          (b >> BIN_SHIFT);
        counts[bin] += 1;
        sums[bin * 3] += r;
        sums[bin * 3 + 1] += g;
        sums[bin * 3 + 2] += b;
        total += 1;
      }
    }
  }
  if (!total) return [];

  const bins = [];
  for (let bin = 0; bin < BIN_COUNT; bin += 1) {
    const count = counts[bin];
    if (!count) continue;
    bins.push({
      count,
      rgb: [
        sums[bin * 3] / count,
        sums[bin * 3 + 1] / count,
        sums[bin * 3 + 2] / count,
      ],
    });
  }
  /* Порядок фиксирован и при равных счётчиках: сортировка устойчива, а
     корзины собраны по возрастанию номера. */
  bins.sort((left, right) => right.count - left.count);

  /* Запас сверх предела: лишние мелкие группы отсеются по доле, зато ни один
     настоящий цвет не потеряется из-за того, что место заняла кромка. */
  const roomy = limit * 3;
  let clusters = [];
  const nearest = (rgb) => {
    let best = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < clusters.length; index += 1) {
      const gap = distance(clusters[index].rgb, rgb);
      if (gap < bestDistance) {
        bestDistance = gap;
        best = index;
      }
    }
    return { index: best, distance: bestDistance };
  };
  for (const bin of bins) {
    const near = nearest(bin.rgb);
    if (near.index >= 0 && near.distance < merge) continue;
    if (clusters.length >= roomy) continue;
    clusters.push({ rgb: [...bin.rgb], count: 0 });
  }

  /* Уточнение центров: каждая корзина голосует за ближайшую группу. */
  for (let pass = 0; pass < 3; pass += 1) {
    const next = clusters.map(() => ({ sum: [0, 0, 0], count: 0 }));
    for (const bin of bins) {
      const near = nearest(bin.rgb);
      const target = next[near.index];
      target.count += bin.count;
      target.sum[0] += bin.rgb[0] * bin.count;
      target.sum[1] += bin.rgb[1] * bin.count;
      target.sum[2] += bin.rgb[2] * bin.count;
    }
    clusters = next
      .filter((item) => item.count > 0)
      .map((item) => ({
        rgb: item.sum.map((value) => value / item.count),
        count: item.count,
      }));
  }

  /* Уточнение могло свести две группы вместе — сливаем, старшая поглощает. */
  clusters.sort((left, right) => right.count - left.count);
  const merged = [];
  for (const cluster of clusters) {
    const host = merged.find((item) => distance(item.rgb, cluster.rgb) < merge);
    if (!host) {
      merged.push({ rgb: [...cluster.rgb], count: cluster.count });
      continue;
    }
    const sum = host.count + cluster.count;
    host.rgb = host.rgb.map(
      (value, channel) =>
        (value * host.count + cluster.rgb[channel] * cluster.count) / sum,
    );
    host.count = sum;
  }

  /*
   * Кромки сглаживания. Вдоль каждой дороги идёт полоска пикселей, смешанных
   * из цвета дороги и цвета суши; вместе они набирают заметную долю и
   * выглядят как «ещё один цвет карты». Если дать такому цвету роль, он
   * раскрасит каймой каждую дорогу. Примета кромки: цвет лежит на отрезке
   * между двумя цветами покрупнее и сам много меньше обоих. У градиента
   * полупрозрачного слоя кромок нет — он весь переход, и правило к нему не
   * применяется.
   */
  const solid = glow
    ? merged
    : merged.filter((item, position) => {
        if (position === 0) return true;
        for (let i = 0; i < merged.length; i += 1) {
          for (let j = i + 1; j < merged.length; j += 1) {
            const from = merged[i];
            const to = merged[j];
            if (from === item || to === item) continue;
            if (item.count > Math.min(from.count, to.count) * EDGE_SHARE)
              continue;
            const sx = to.rgb[0] - from.rgb[0];
            const sy = to.rgb[1] - from.rgb[1];
            const sz = to.rgb[2] - from.rgb[2];
            const lengthSquared = sx * sx + sy * sy + sz * sz;
            if (!lengthSquared) continue;
            const px = item.rgb[0] - from.rgb[0];
            const py = item.rgb[1] - from.rgb[1];
            const pz = item.rgb[2] - from.rgb[2];
            const t = (px * sx + py * sy + pz * sz) / lengthSquared;
            if (t < 0.12 || t > 0.88) continue;
            const residual = Math.hypot(px - sx * t, py - sy * t, pz - sz * t);
            if (residual < EDGE_RESIDUAL) return false;
          }
        }
        return true;
      });

  const kept = solid.filter(
    (item, index) => index === 0 || item.count / total >= MIN_SHARE,
  );
  return kept.slice(0, limit).map((item) => ({
    color: rgbToHex(item.rgb),
    share: Math.round((item.count / total) * 10000) / 10000,
  }));
}

/* ------------------------------------------------------------------------ */
/* Роли по умолчанию                                                         */
/* ------------------------------------------------------------------------ */

const luma = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];

function hueOf(rgb) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (!delta) return 0;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

const isBluish = (rgb) => {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const hue = hueOf(rgb);
  return max > 0 && (max - min) / max >= 0.06 && hue >= 165 && hue <= 265;
};

/**
 * Назначает найденным цветам роли.
 *
 * Это догадка, и она обязана быть предсказуемой, а не умной: человек видит
 * её в панели и правит одним выбором. Правила читаются с карты: самая большая
 * заливка — суша; синеватое — вода; жёлтое — песок или магистрали (песка на
 * карте много, разметки магистралей мало); нейтральные цвета раскладываются
 * по контрасту с сушей — близкие к ней считаются рельефом и застройкой,
 * далёкие — дорогами. Слой подсказывает остальное: полупрозрачным рисуют
 * воду и ореол берега, а цвет, которого нет на суше, но много в плитках с
 * запечённым морем, — океан.
 *
 * @param {{color: string, share: number, layer?: "solid"|"glow"|"sea"}[]} palette
 */
export function guessPaletteRoles(palette) {
  const items = (Array.isArray(palette) ? palette : []).map((item) => ({
    color: item.color,
    share: Number(item.share) || 0,
    layer: item.layer || "solid",
    rgb: hexToRgb(item.color),
    role: "",
  }));
  const solid = items.filter((item) => item.layer === "solid");
  for (const item of items) {
    if (item.layer === "sea") item.role = "sea";
    else if (item.layer === "glow")
      item.role = isBluish(item.rgb) ? "water" : "outline";
  }
  if (solid.length) {
    const land = solid[0];
    land.role = "land";
    const landLuma = luma(land.rgb);
    const contrast = (item) => Math.abs(luma(item.rgb) - landLuma);

    const neutrals = [];
    for (const item of solid.slice(1)) {
      const max = Math.max(...item.rgb);
      const min = Math.min(...item.rgb);
      const chroma = max ? (max - min) / max : 0;
      const hue = hueOf(item.rgb);
      if (isBluish(item.rgb)) item.role = "water";
      else if (chroma >= 0.18 && hue >= 28 && hue <= 68)
        item.role = item.share >= 0.02 ? "sand" : "highways";
      else neutrals.push(item);
    }

    /* Нейтральные — по контрасту с сушей: от самого похожего к самому резкому. */
    neutrals.sort((left, right) => contrast(left) - contrast(right));
    const near = neutrals.filter((item) => contrast(item) < ROAD_CONTRAST);
    const far = neutrals.filter((item) => contrast(item) >= ROAD_CONTRAST);
    near.forEach((item, index) => {
      item.role = index === 0 ? "terrain" : "buildings";
    });
    /*
     * Среди резких главная по площади — обычные дороги. Цвет, лежащий на
     * прямой между сушей и дорогой, — та же дорога потоньше (просёлок в одну
     * точку шириной) и кромка сглаживания больших дорог: эти два случая по
     * цвету не различить. Отдельная роль раскрасила бы каймой каждую дорогу,
     * поэтому он красится вместе с дорогами. Магистрали — то, что ярче дорог
     * или лежит в стороне от этой прямой.
     */
    const mainRoad = [...far].sort(
      (left, right) => right.share - left.share,
    )[0];
    for (const item of far) {
      if (item === mainRoad) {
        item.role = "roads";
        continue;
      }
      const sx = mainRoad.rgb[0] - land.rgb[0];
      const sy = mainRoad.rgb[1] - land.rgb[1];
      const sz = mainRoad.rgb[2] - land.rgb[2];
      const px = item.rgb[0] - land.rgb[0];
      const py = item.rgb[1] - land.rgb[1];
      const pz = item.rgb[2] - land.rgb[2];
      const t = (px * sx + py * sy + pz * sz) / (sx * sx + sy * sy + sz * sz);
      const residual = Math.hypot(px - sx * t, py - sy * t, pz - sz * t);
      item.role = t < 0.95 && residual < EDGE_RESIDUAL ? "roads" : "highways";
    }
  }
  return items.map(({ color, share, layer, role }) => ({
    color,
    share,
    layer,
    role,
  }));
}

/**
 * Все цвета карты с ролями — то, что видит панель «Цвета карты».
 *
 * Три прохода: плотные пиксели плиток суши, их полупрозрачный слой (вода и
 * ореол берега) и — по плиткам второй семьи, где море запечено в картинку, —
 * океан: цвет этих плиток там, где у плитки суши пусто.
 *
 * @param {{base: object[], underlay?: object[]}} images пиксели плиток.
 *   Плитка второй семьи несёт `mask` — плитку суши того же места (см.
 *   `detectMapPalette`); без маски океан не ищется — отличить его не от чего.
 * @returns {{color: string, share: number, layer: string, role: string}[]}
 */
export function detectMapSources(images) {
  const base = Array.isArray(images?.base) ? images.base : [];
  const underlay = (
    Array.isArray(images?.underlay) ? images.underlay : []
  ).filter((image) => image?.mask?.data);
  const solid = detectMapPalette(base, { limit: 7, layer: "solid" }).map(
    (item) => ({ ...item, layer: "solid" }),
  );
  /* Полупрозрачный цвет, совпавший с плотным, — тот же элемент карты: вторая
     строка с тем же цветом человеку ничего не даёт. */
  const glow = detectMapPalette(base, { limit: 3, layer: "glow" })
    .filter((item) =>
      solid.every(
        (known) =>
          distance(hexToRgb(known.color), hexToRgb(item.color)) >=
          MERGE_DISTANCE,
      ),
    )
    .map((item) => ({ ...item, layer: "glow" }));
  const sea = detectMapPalette(underlay, { limit: 1, layer: "solid" }).map(
    (item) => ({ ...item, layer: "sea" }),
  );
  return guessPaletteRoles([...solid, ...glow, ...sea]);
}

/**
 * Накладывает на найденные цвета роли, которые человек выбрал сам.
 *
 * Правка хранится в проекте парой «цвет → роль», а не номером строки: после
 * смены карты в игре цвета находятся заново, и правка должна лечь на тот же
 * цвет, а не на ту же позицию в списке. Цвет считается тем же с точностью до
 * шума сжатия.
 */
export function applyRoleOverrides(sources, overrides) {
  const list = Array.isArray(overrides) ? overrides : [];
  if (!list.length) return Array.isArray(sources) ? sources : [];
  return (Array.isArray(sources) ? sources : []).map((source) => {
    const rgb = hexToRgb(source.color);
    let best = null;
    let bestDistance = MERGE_DISTANCE / 2;
    for (const item of list) {
      if (!MAP_COLOR_ROLE_IDS.includes(item?.role)) continue;
      const gap = distance(rgb, hexToRgb(item.color));
      if (gap < bestDistance) {
        bestDistance = gap;
        best = item;
      }
    }
    return best ? { ...source, role: best.role } : source;
  });
}
