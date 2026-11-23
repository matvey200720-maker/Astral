/*
 * Подложка растровой большой карты (владелец 27.10.2026: «подложку убери у всех карт»).
 *
 * У векторной карты серый «рельеф моря» вокруг суши лежит отдельным слоем ниже суши и просто не рисуется (`mapWithoutUnderlay`, map-cover.js). У растровой он нарисован в самих
 * плитках пауза-карты, прямо поверх прозрачного моря, и отделить его от суши по цвету нельзя: рельеф — те же серые, что и тёмные горы, а чёрный контур берега
 * местами не нарисован. Поэтому два шага, оба без догадок по цвету суши:
 *
 *   1. прозрачность. Рельеф уходит в ноль ступенями (в плитках Halloween 2026 — 25 %, 45 %, 65 % кольцами вокруг берега), суша непрозрачна. Прозрачнее `solid` — убирается,
 *      а отдельные пятнышки (камни рельефа) меньше доли `speck` самого большого куска — тоже: это не суша;
 *   2. берег. Остаток рельефа, непрозрачный и тёмный, лежит между внешним краем и контуром берега. Берег — по карте высот штата, которую игра хранит для суши
 *      (`terrain-heights.json`, клетка 50 м, 0 м — море), в той же сетке, что у атласа: плитки лежат на атласе как есть. Отсекается нейтральный тёмный остаток дальше
 *      `margin` метров от суши, достижимый от внешнего края; цветные и яркие вещи автора (плашки, QR-коды) и внутренние озёра остаются.
 *
 * Работает на месте: `rgba` меняется, возвращается число убранных точек.
 */

import { DEFAULT_ATLAS, atlasSize, mapToWorld } from "./projection.js";
import { reliefHeightAt } from "./terrain.js";

const around = (index, width, size) => {
  const x = index % width;
  return [x < width - 1 ? index + 1 : -1, x > 0 ? index - 1 : -1, index + width < size ? index + width : -1, index - width >= 0 ? index - width : -1];
};

/* Шаг 1: ступенчатая прозрачность. */
function clearTranslucent(rgba, width, height, solid, speck) {
  const size = width * height;
  let full = 0;
  let semi = 0;
  for (let index = 0; index < size; index += 1) {
    const alpha = rgba[index * 4 + 3];
    if (alpha >= solid) full += 1;
    else if (alpha > 0) semi += 1;
  }
  if (!full || semi < full * 0.005) return 0;
  const label = new Int32Array(size);
  const queue = new Int32Array(size);
  const areas = [0];
  for (let first = 0; first < size; first += 1) {
    if (label[first] || rgba[first * 4 + 3] < solid) continue;
    const id = areas.length;
    let head = 0;
    let tail = 0;
    queue[tail] = first;
    tail += 1;
    label[first] = id;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      for (const next of around(index, width, size)) {
        if (next < 0 || label[next] || rgba[next * 4 + 3] < solid) continue;
        label[next] = id;
        queue[tail] = next;
        tail += 1;
      }
    }
    areas.push(tail);
  }
  const floor = Math.max(...areas) * speck;
  let cleared = 0;
  for (let index = 0; index < size; index += 1) {
    if (rgba[index * 4 + 3] === 0 || (label[index] && areas[label[index]] >= floor)) continue;
    rgba[index * 4 + 3] = 0;
    cleared += 1;
  }
  return cleared;
}

/** Клетки грубой сетки, лежащие в море дальше `margin` метров от суши и связанные с краем карты. */
function openSea(width, height, atlas, { cell, margin, level }) {
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const land = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const point = mapToWorld({ u: (column + 0.5) / columns, v: (row + 0.5) / rows }, atlas);
      land[row * columns + column] = reliefHeightAt(point.x, point.y) > level ? 1 : 0;
    }
  const { width: worldWidth } = atlasSize(atlas);
  const radius = Math.max(1, Math.ceil(margin / (worldWidth / columns)));
  /* Наращивание суши квадратом `radius`: проход по строкам, потом по столбцам. */
  const wide = new Uint8Array(land.length);
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      let value = 0;
      for (let step = -radius; step <= radius && !value; step += 1) {
        const at = column + step;
        if (at >= 0 && at < columns && land[row * columns + at]) value = 1;
      }
      wide[row * columns + column] = value;
    }
  const grown = new Uint8Array(land.length);
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      let value = 0;
      for (let step = -radius; step <= radius && !value; step += 1) {
        const at = row + step;
        if (at >= 0 && at < rows && wide[at * columns + column]) value = 1;
      }
      grown[row * columns + column] = value;
    }
  const sea = new Uint8Array(land.length);
  const queue = new Int32Array(land.length);
  let head = 0;
  let tail = 0;
  const seed = (index) => {
    if (grown[index] || sea[index]) return;
    sea[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let column = 0; column < columns; column += 1) {
    seed(column);
    seed((rows - 1) * columns + column);
  }
  for (let row = 0; row < rows; row += 1) {
    seed(row * columns);
    seed(row * columns + columns - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    for (const next of around(index, columns, land.length)) if (next >= 0) seed(next);
  }
  return { sea, columns };
}

/**
 * Убирает подложку растровой карты `width × height` (атлас по умолчанию — две плитки в ширину, три в высоту). Отвечает, сколько точек стало прозрачными.
 * Карта другой раскладки (иное отношение сторон) от берега по высотам не чистится — только по прозрачности.
 */
export function mapClearRim(rgba, width, height, { atlas = DEFAULT_ATLAS, solid = 240, speck = 0.005, margin = 60, cell = 3, level = 0.5 } = {}) {
  let cleared = clearTranslucent(rgba, width, height, solid, speck);
  const world = atlasSize(atlas);
  if (Math.abs(width / height - world.width / world.height) > 0.02) return cleared;
  const size = width * height;
  const { sea, columns } = openSea(width, height, atlas, { cell, margin, level });
  const halo = (index) => {
    const at = index * 4;
    const high = Math.max(rgba[at], rgba[at + 1], rgba[at + 2]);
    return high <= 150 && high - Math.min(rgba[at], rgba[at + 1], rgba[at + 2]) <= 24;
  };
  const inSea = (index) => sea[Math.floor(index / width / cell) * columns + Math.floor((index % width) / cell)] === 1;
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < size; index += 1)
    if (rgba[index * 4 + 3] === 0) {
      queue[tail] = index;
      tail += 1;
    }
  /* Рельеф, непрозрачный до самого края холста (моря-прозрачности нет), — тоже начало заливки. */
  const seedEdge = (index) => {
    if (rgba[index * 4 + 3] === 0 || !inSea(index) || !halo(index)) return;
    rgba[index * 4 + 3] = 0;
    cleared += 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    seedEdge(x);
    seedEdge((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    seedEdge(y * width);
    seedEdge(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    for (const next of around(index, width, size)) {
      if (next < 0 || rgba[next * 4 + 3] === 0 || !inSea(next) || !halo(next)) continue;
      rgba[next * 4 + 3] = 0;
      cleared += 1;
      queue[tail] = next;
      tail += 1;
    }
  }
  return cleared;
}
