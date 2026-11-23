/*
 * Карты воды, нарисованные без игры.
 *
 * Набора `water` в `@modovik/gta-preview-assets` нет и заводить его не надо: всё
 * нужное здесь — рябь, пена, каустики — это не зерно поверхности, а рисунок,
 * который целиком считается формулой. Блеск воде даёт шейдер, а не картинка,
 * поэтому в git отсюда не уходит ни одного нового байта Rockstar (см. границу
 * лицензии в шапке `preview/preview-assets.js`).
 *
 * Единственное, что мы всё же спрашиваем у игры, — песок берега: у него разница
 * с настоящим как раз в зерне. Спрашивается он перебором имён уже извлекаемого
 * набора `vegetation` (`ground-dirt` и соседи), а не точечным запросом
 * несуществующего id, — иначе «текстура из игры» и «шум вместо неё» неотличимы.
 *
 * Рисуется всё в `Uint8Array`, а не на `canvas`: `getContext("2d")` в jsdom
 * отдаёт null и валит любой тест со сценой. Массив работает всюду одинаково.
 *
 * ГЛАВНОЕ ПРО ЭТИ КАРТЫ: они обязаны сходиться на швах. Вода — единственная
 * поверхность в мастерской, которую видно на сотни метров сразу, и повтор карты
 * на ней читается не зерном, а сеткой квадратов по всему кадру. Поэтому шум
 * здесь периодический: хеш берётся от координат, свёрнутых по размеру карты.
 */

/*
 * Цвета берега. Это АЛЬБЕДО, а не яркость: свет на них кладёт солнце
 * таймцикла, и подбирать их «посветлее для заката» было бы ошибкой того же
 * рода, что рисовать тени в текстуре.
 */
export const SHORE_PALETTE = Object.freeze({
  sandDry: Object.freeze([0.62, 0.53, 0.4]),
  sandWet: Object.freeze([0.29, 0.24, 0.19]),
  upland: Object.freeze([0.24, 0.24, 0.16]),
  rock: Object.freeze([0.18, 0.17, 0.16]),
});

/** Имена песка в наборе `vegetation`: первое найденное и берём. */
export const SAND_ASSETS = Object.freeze([
  "ground-dirt",
  "ground-steppe",
  "ground-meadow",
]);

const TAU = Math.PI * 2;

/* Хеш от целочисленной решётки. Свёрнутой — иначе карта не сойдётся на шве. */
function hash(x, y, period, seed) {
  const ix = ((x % period) + period) % period;
  const iy = ((y % period) + period) % period;
  const value = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Значение периодического шума с гладкой интерполяцией. */
function noise(x, y, period, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, period, seed);
  const b = hash(ix + 1, iy, period, seed);
  const c = hash(ix, iy + 1, period, seed);
  const d = hash(ix + 1, iy + 1, period, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Несколько октав того же шума. Каждая со своим периодом — шов держат все. */
function fbm(u, v, size, octaves, seed) {
  let sum = 0;
  let weight = 0;
  for (let level = 0; level < octaves; level += 1) {
    const period = 4 * 2 ** level;
    const amplitude = 1 / 2 ** level;
    sum += noise(u * period, v * period, period, seed + level * 17) * amplitude;
    weight += amplitude;
  }
  return sum / weight;
}

const blank = (size) => ({
  data: new Uint8Array(size * size * 4),
  width: size,
  height: size,
});

const byte = (value) => Math.round(Math.min(Math.max(value, 0), 1) * 255);

/*
 * В цветную текстуру уходит sRGB — three вернёт её в линейный свет по
 * `colorSpace`. Карты нормалей и маски идут как есть: гамма на них означала бы
 * рельеф, наклонённый не туда, и пену, которая появляется не там.
 */
const encodeColour = (linear) =>
  byte(Math.min(Math.max(linear, 0), 1) ** (1 / 2.2));

/**
 * Карта мелкой ряби — нормаль, а не высота.
 *
 * Именно она дробит дорожку солнца: геометрия сетки до такой мелочи не
 * доходит и дойти не может — шаг колец у горизонта измеряется метрами.
 *
 * Ориентация здесь МИРОВАЯ, а не касательная: R — уклон по X, G — вверх,
 * B — уклон по Z. Своя договорённость вместо общепринятой сделана нарочно —
 * поверхность горизонтальна всегда, и гонять её через касательный базис
 * значило бы считать этот базис в шейдере ради заведомо известного ответа.
 */
export function ripplePixels({ size = 256, seed = 7, relief = 2.6 } = {}) {
  const pixels = blank(size);
  const { data } = pixels;
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      /*
       * Рябь ветра не изотропна: она вытянута поперёк ветра. Растяжение по
       * одной оси делает из круглых пятен настоящую рябь — без него карта даёт
       * пузырчатую фактуру, по которой солнце размазывается пятном.
       */
      height[y * size + x] =
        fbm(u * 1.9, v * 0.7, size, 4, seed) * 0.7 +
        fbm(u * 5.3, v * 2.1, size, 3, seed + 41) * 0.3;
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = height[y * size + ((x - 1 + size) % size)];
      const right = height[y * size + ((x + 1) % size)];
      const down = height[((y - 1 + size) % size) * size + x];
      const up = height[((y + 1) % size) * size + x];
      const dx = (right - left) * relief;
      const dz = (up - down) * relief;
      const length = Math.hypot(dx, 1, dz) || 1;
      const index = (y * size + x) * 4;
      data[index] = byte((-dx / length) * 0.5 + 0.5);
      data[index + 1] = byte((1 / length) * 0.5 + 0.5);
      data[index + 2] = byte((-dz / length) * 0.5 + 0.5);
      data[index + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Пена: клочья, а не ровный шум.
 *
 * Ровный шум даёт серую вуаль по всей кромке — прибой так не выглядит.
 * Барашек рвётся на пятна, поэтому шум здесь возводится в степень: середина
 * уходит в ноль, остаются края, то есть клочья.
 */
export function foamPixels({ size = 256, seed = 19 } = {}) {
  const pixels = blank(size);
  const { data } = pixels;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const base = fbm(u, v, size, 5, seed);
      const clumps = Math.min(Math.max((base - 0.36) / 0.44, 0), 1) ** 0.7;
      const index = (y * size + x) * 4;
      const value = byte(clumps);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Каустики: сетка света на дне.
 *
 * Считается расстоянием до ближайшей точки решётки, сдвинутой шумом, — то есть
 * клетками Вороного. Это ровно то, что делает свет, преломлённый рябью:
 * сходится в линии по границам ячеек. Обычный шум дал бы пятна, а не сетку, и
 * дно выглядело бы грязным, а не освещённым сквозь воду.
 */
export function causticPixels({ size = 256, seed = 31, cells = 6 } = {}) {
  const pixels = blank(size);
  const { data } = pixels;
  const step = size / cells;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = x / step;
      const cy = y / step;
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      let nearest = 4;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const gx = ix + ox;
          const gy = iy + oy;
          const jitterX = hash(gx, gy, cells, seed);
          const jitterY = hash(gx, gy, cells, seed + 91);
          const dx = gx + jitterX - cx;
          const dy = gy + jitterY - cy;
          nearest = Math.min(nearest, Math.hypot(dx, dy));
        }
      }
      /* Свет живёт на ГРАНИЦАХ ячеек, а не в их серединах: там, куда сходятся
         лучи. Поэтому яркая линия — это край, и берётся он обратной степенью. */
      const light = Math.min(Math.max(1 - nearest * 1.35, 0), 1) ** 2.4;
      const index = (y * size + x) * 4;
      const value = byte(light);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Песок — только если игра его не дала.
 *
 * Зерно, а не рисунок: силуэта у песка нет, разница с настоящим здесь именно в
 * шуме. Поэтому замена честная и в кадре почти не отличается — в отличие от
 * листвы, где без альфы получилось бы поле зелёных карточек.
 */
export function sandPixels({ size = 256, seed = 53 } = {}) {
  const pixels = blank(size);
  const { data } = pixels;
  const [red, green, blue] = SHORE_PALETTE.sandDry;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const grain = fbm(u, v, size, 5, seed) * 0.5 + 0.75;
      /* Редкие тёмные крупинки: ровное зерно читается как бумага. */
      const speck = fbm(u * 3.1, v * 3.1, size, 2, seed + 13) > 0.72 ? 0.62 : 1;
      const index = (y * size + x) * 4;
      data[index] = encodeColour(red * grain * speck);
      data[index + 1] = encodeColour(green * grain * speck);
      data[index + 2] = encodeColour(blue * grain * speck);
      data[index + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Направление и скорость бега карт.
 *
 * Одно место на рябь, пену и каустики: разъедься они, и пена побежала бы
 * поперёк волны. Скорость растёт с ветром, но не линейно — в штиль рябь тоже
 * живёт, иначе зеркало выглядит замороженным кадром, а не водой.
 */
export function flowVector(directionDegrees, wind) {
  const radians = (directionDegrees * Math.PI) / 180;
  const speed = 0.012 + wind * 0.05;
  return [Math.sin(radians) * speed, Math.cos(radians) * speed];
}

/**
 * Раскладка волн Гершнера по одному числу ветра.
 *
 * Пять поездов: две длинные волны почти по ветру, три коротких и разбросанных.
 * Разброс растёт с ветром — штилевая зыбь идёт ровными грядами, штормовая
 * толчея приходит со всех румбов сразу. Крутизна зажата так, чтобы сумма
 * никогда не дала петлю: `Q * A * k` по всем волнам не должна перевалить за
 * единицу, иначе гребень заворачивается сам в себя и поверхность рвётся.
 */
export function waveTrains(directionDegrees, amplitude, windScale, count) {
  const base = (directionDegrees * Math.PI) / 180;
  const wind = Math.min(Math.max(windScale, 0), 1);
  const trains = [];
  /* Длины волн: от длинной зыби к короткой ряби, геометрической прогрессией.
     Ровный шаг дал бы биения — сумма читалась бы как одна пульсирующая волна. */
  const lengths = [61, 37, 23, 13, 7.5];
  const weights = [1, 0.72, 0.46, 0.27, 0.15];
  for (let index = 0; index < count; index += 1) {
    const length = lengths[index % lengths.length];
    const weight = weights[index % weights.length];
    const spread =
      (index % 2 === 0 ? 1 : -1) * (0.18 + index * 0.14) * (0.35 + wind);
    const angle = base + spread;
    const k = TAU / length;
    /* Дисперсия глубокой воды: длинная волна идёт быстрее короткой. Без неё
       все поезда движутся синхронно и сумма выглядит одной волной. */
    const omega = Math.sqrt(9.81 * k);
    const waveAmplitude = amplitude * weight * 2.6;
    /*
     * Крутизна выводится, а не задаётся.
     *
     * Устойчивость Гершнера держится на сумме `Q*A*k` по всем волнам: перевалит
     * за единицу — гребень заворачивается сам в себя, и поверхность рвётся
     * дырами. Поэтому каждой волне выдаётся РАВНАЯ доля общего запаса, а
     * крутизна из неё выводится обратно. При полном ветре сумма выходит 0.55 —
     * гребни уже острые, но петли не будет ни при каком раскладе длин.
     */
    const share = (0.55 * wind) / count;
    const steepness =
      waveAmplitude > 1e-6 ? Math.min(share / (k * waveAmplitude), 1) : 0;
    trains.push({
      dirX: Math.sin(angle),
      dirZ: Math.cos(angle),
      amplitude: waveAmplitude,
      wavenumber: k,
      steepness,
      omega,
      /* Дальность видимости волны — от её длины: волна короче шага сетки на
         дальнем кольце превращается в муар, а не в рябь. */
      range: 34 + length * 11,
    });
  }
  return trains;
}
