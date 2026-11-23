/*
 * Оценка кадров обложки арены (27.10.2026, зал Majestic): у разных модов оболочка зала своя, и камера, годная одному, упирается в стену
 * другого (VEX REDUX) или смотрит в чёрную пустоту (Valorant V3, зал которого почти пуст). Поэтому окно снимает пул кандидатов мелко,
 * оценивает кадры по картинке и берёт лучшие — обложка и галерея не зависят от того, в какую стену мод поставил оболочку.
 *
 * Оценка — «в кадре есть что смотреть»: средняя резкость границ (стена вплотную и пустой фон дают почти ноль), разнообразие цветов
 * и достаточная яркость (чёрный кадр — ноль).
 */

const GRADIENT_CAP = 60;
/* Ниже этой средней яркости (0…255) кадр считается чёрным. */
const BLACK_MEAN = 6;
/* Сколько разных цветов (по 4 бита на канал) делает кадр «разнообразным» полностью. */
const FULL_COLOURS = 220;

/**
 * Оценка кадра `rgba` (`Uint8ClampedArray` RGBA, `width × height`): число ≥ 0, больше — богаче кадр.
 */
export function frameScore(rgba, width, height) {
  const count = width * height;
  if (!count || rgba.length < count * 4) return 0;
  const luma = new Float32Array(count);
  const colours = new Set();
  let sum = 0;
  for (let at = 0; at < count; at += 1) {
    const red = rgba[at * 4];
    const green = rgba[at * 4 + 1];
    const blue = rgba[at * 4 + 2];
    const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    luma[at] = value;
    sum += value;
    colours.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
  }
  if (sum / count < BLACK_MEAN) return 0;
  let edges = 0;
  for (let row = 0; row < height; row += 1)
    for (let column = 0; column < width; column += 1) {
      const at = row * width + column;
      if (column > 0) edges += Math.min(GRADIENT_CAP, Math.abs(luma[at] - luma[at - 1]));
      if (row > 0) edges += Math.min(GRADIENT_CAP, Math.abs(luma[at] - luma[at - width]));
    }
  const spread = 0.4 + 0.6 * Math.min(1, colours.size / FULL_COLOURS);
  return (edges / count) * spread;
}

/**
 * Насколько звезду видно в кадре: средняя по каналам разница между кадром с ней и тем же кадром без неё (`with`, `without` — RGBA одного размера), 0…255.
 * Белая табличка на белом полу (hatemod Blink x Skye) с любого ракурса даёт ноль — её в статике не видно, и кадр «на звезду» обложкой не годится.
 */
export function starVisibility(withStar, withoutStar) {
  const count = Math.min(withStar.length, withoutStar.length) >> 2;
  if (!count) return 0;
  let sum = 0;
  for (let at = 0; at < count; at += 1)
    sum += (Math.abs(withStar[at * 4] - withoutStar[at * 4]) + Math.abs(withStar[at * 4 + 1] - withoutStar[at * 4 + 1]) + Math.abs(withStar[at * 4 + 2] - withoutStar[at * 4 + 2])) / 3;
  return sum / count;
}

/**
 * Лучшие кадры пула без близнецов: `scored` — `[{ view: { eye, yaw }, score }]`, берётся до `take` кадров по убыванию оценки; кадр, повторяющий уже взятый
 * (глаз ближе `gap` м и поворот ближе `turn` рад), пропускается. Кадры с оценкой ниже `floor` не берутся.
 */
export function pickFrames(scored, { take = 6, gap = 4, turn = 0.7, floor = 0 } = {}) {
  const picked = [];
  for (const item of [...scored].sort((left, right) => right.score - left.score)) {
    if (picked.length >= take) break;
    if (item.score <= floor) break;
    const twin = picked.some((other) => {
      const [ax, ay, az] = other.view.eye;
      const [bx, by, bz] = item.view.eye;
      const apart = Math.hypot(ax - bx, ay - by, az - bz);
      const rotated = Math.abs(Math.atan2(Math.sin(other.view.yaw - item.view.yaw), Math.cos(other.view.yaw - item.view.yaw)));
      return apart < gap && rotated < turn;
    });
    if (!twin) picked.push(item);
  }
  return picked;
}
