/*
 * Одна расцветка или две — по содержимому диффузной текстуры, а не по кадру превью (25.10.2026, владелец: «в карточке
 * “Свитер” среди пяти цветов один — тот же свитер, просто повёрнутый задом наперёд»).
 *
 * Прежде расцветки сводились только при ТОЧНО равных пикселях (`pixelKey` в `worker.js`). Одна и та же текстура, пересжатая
 * автором (другой размер, DXT1 вместо DXT5), или та же картинка, зеркально отражённая либо перевёрнутая (принт ложится на
 * спину вместо груди — вещь «задом наперёд»), считалась другим цветом. Здесь — одно правило для разбора новых модов
 * (`inspectTextures`) и для проверки уже опубликованных (`scripts/catalog-clothing-colours.js`).
 *
 * Сравнение (цвет и прозрачность, максимум по каналам): обе картинки сводятся к сетке 128 × 128 (среднее по клеткам — пересжатие и разный размер на ней уходят в
 * шум), дальше четыре положения второй: как есть, зеркало по горизонтали, зеркало по вертикали, поворот на 180°. Расцветки
 * одинаковые, если в каком-то положении средняя разница каналов невелика, а пикселей с заметной разницей почти нет — малый
 * принт другого цвета (3 % площади у кроссовок Balenciaga) под это не подпадает.
 *
 * Пороги сверены 25.10.2026 на 934 диффузных текстурах 207 опубликованных вещей с несколькими расцветками (2 834 пары):
 * ближайшая пара разных расцветок — средняя 1,75, заметно отличается 3,3 % пикселей; под правило не подпала ни одна.
 */

/** Сторона сетки сравнения. */
export const COMPARE_SIDE = 128;
/** Средняя разница (максимум по каналам, из 255) — не больше. */
export const SAME_MEAN = 1.5;
/** Разница крупнее этого порога считается «заметной». */
export const NOTICEABLE = 24;
/** Доля заметно отличающихся клеток сетки — не больше. */
export const SAME_SHARE = 0.002;

/** Положения второй картинки при сравнении. */
export const ARRANGEMENTS = Object.freeze(["same", "mirror", "flip", "turned"]);

/**
 * Сетка картинки: среднее по клеткам, четыре канала (цвет и прозрачность), `COMPARE_SIDE²` клеток; `null` у пустой
 * картинки. Прозрачность в счёт нужна: у тату и очков рисунок живёт в альфе, а цвет под ней у разных рисунков одинаков.
 */
export function textureGrid(picture) {
  const { width, height, rgba } = picture || {};
  if (!width || !height || !rgba?.length) return null;
  const side = COMPARE_SIDE;
  const grid = new Float32Array(side * side * 4);
  /* Клетка берёт свой диапазон пикселей: у большой текстуры это среднее по блоку, у крохотной (4 × 4 заглушка автора) —
     ближайший пиксель, а не пустая клетка. */
  for (let cy = 0; cy < side; cy += 1) {
    const y0 = Math.floor((cy * height) / side);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / side));
    for (let cx = 0; cx < side; cx += 1) {
      const x0 = Math.floor((cx * width) / side);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / side));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y += 1)
        for (let x = x0; x < x1; x += 1) {
          const at = (y * width + x) * 4;
          r += rgba[at];
          g += rgba[at + 1];
          b += rgba[at + 2];
          a += rgba[at + 3];
        }
      const count = (y1 - y0) * (x1 - x0);
      const cell = (cy * side + cx) * 4;
      grid[cell] = r / count;
      grid[cell + 1] = g / count;
      grid[cell + 2] = b / count;
      grid[cell + 3] = a / count;
    }
  }
  return { width, height, grid };
}

/** Клетка `(x, y)` второй картинки, как её видно в данном положении. */
function sourceCell(arrangement, x, y) {
  const last = COMPARE_SIDE - 1;
  if (arrangement === "mirror") return [last - x, y];
  if (arrangement === "flip") return [x, last - y];
  if (arrangement === "turned") return [last - x, last - y];
  return [x, y];
}

/** Разница сеток в одном положении: `{ mean, share }`. */
export function gridDifference(left, right, arrangement = "same") {
  const side = COMPARE_SIDE;
  let sum = 0;
  let noticeable = 0;
  for (let y = 0; y < side; y += 1)
    for (let x = 0; x < side; x += 1) {
      const [sx, sy] = sourceCell(arrangement, x, y);
      const a = (y * side + x) * 4;
      const b = (sy * side + sx) * 4;
      const delta = Math.max(
        Math.abs(left[a] - right[b]),
        Math.abs(left[a + 1] - right[b + 1]),
        Math.abs(left[a + 2] - right[b + 2]),
        Math.abs(left[a + 3] - right[b + 3]),
      );
      sum += delta;
      if (delta > NOTICEABLE) noticeable += 1;
    }
  return { mean: sum / (side * side), share: noticeable / (side * side) };
}

/** Картинки одного соотношения сторон — иначе это не одна текстура, а две. */
const sameShape = (a, b) =>
  Math.abs(a.width / a.height - b.width / b.height) < 0.01;

/**
 * Одна ли это расцветка. Принимает картинки (`{ width, height, rgba }`) или готовые сетки (`textureGrid`).
 * Возвращает `{ same, how }`: `how` — `"same"` (та же картинка, возможно пересжатая или другого размера), `"mirror"`
 * (отражена по горизонтали), `"flip"` (по вертикали), `"turned"` (перевёрнута на 180°); `null`, если разные.
 */
export function sameTexture(left, right) {
  const a = left?.grid ? left : textureGrid(left);
  const b = right?.grid ? right : textureGrid(right);
  if (!a || !b || !sameShape(a, b)) return { same: false, how: null };
  for (const arrangement of ARRANGEMENTS) {
    const { mean, share } = gridDifference(a.grid, b.grid, arrangement);
    if (mean <= SAME_MEAN && share <= SAME_SHARE)
      return { same: true, how: arrangement };
  }
  return { same: false, how: null };
}

/** Слова для человека: чем повтор отличается от первой расцветки. */
export const HOW_LABELS = Object.freeze({
  same: "та же картинка",
  mirror: "та же картинка, отражённая слева направо",
  flip: "та же картинка, отражённая сверху вниз",
  turned: "та же картинка, перевёрнутая",
});
