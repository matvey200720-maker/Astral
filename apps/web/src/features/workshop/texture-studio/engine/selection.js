/*
 * Выделения студии (ТЗ 18.10.2026, Session 1, задача 6): маска `0…255` на
 * весь холст. Прямоугольная и овальная область, лассо и прямолинейное лассо,
 * волшебная палочка (заливкой от точки по близости цвета), операции new / add
 * / sub / inter, растушёвка, инверсия. Чистые функции над `Uint8Array`: без
 * DOM — их зовут и окно, и рабочий поток тяжёлых операций.
 *
 * Маска — `{ width, height, data }`; `null` вместо маски — «выделено всё»
 * (у кисти и заливки это значит «без ограничения»).
 */

export const SELECTION_OPS = Object.freeze(["new", "add", "sub", "inter"]);

export const createMask = (width, height, value = 0) => ({ width, height, data: new Uint8Array(width * height).fill(value) });
export const selectAllMask = (width, height) => createMask(width, height, 255);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Пуста ли маска (нет ни одного выделенного пикселя). */
export function isEmptyMask(mask) {
  if (!mask) return false;
  for (let at = 0; at < mask.data.length; at += 1) if (mask.data[at]) return false;
  return true;
}

/** Рамка выделенного: `{ x, y, width, height }` или `null`, если пусто. */
export function maskBounds(mask) {
  if (!mask) return null;
  const { width, height, data } = mask;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!data[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Сколько пикселей выделено (с весом: полупрозрачные — долей). */
export function maskArea(mask) {
  let sum = 0;
  for (let at = 0; at < mask.data.length; at += 1) sum += mask.data[at];
  return sum / 255;
}

/* ------------------------------------------------------------------ *
 * Фигуры
 * ------------------------------------------------------------------ */

/** Прямоугольник `x, y, w, h` (в пикселях холста; края — с долей пикселя). */
export function rectMask(width, height, x, y, w, h) {
  const mask = createMask(width, height);
  const x0 = Math.min(x, x + w);
  const x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + h);
  const y1 = Math.max(y, y + h);
  for (let row = Math.max(0, Math.floor(y0)); row < Math.min(height, Math.ceil(y1)); row += 1) {
    const cover = Math.min(row + 1, y1) - Math.max(row, y0);
    for (let col = Math.max(0, Math.floor(x0)); col < Math.min(width, Math.ceil(x1)); col += 1) {
      const across = Math.min(col + 1, x1) - Math.max(col, x0);
      mask.data[row * width + col] = Math.round(255 * clamp(cover, 0, 1) * clamp(across, 0, 1));
    }
  }
  return mask;
}

/** Овал, вписанный в прямоугольник `x, y, w, h`; край сглажен 4×4 подвыборкой. */
export function ellipseMask(width, height, x, y, w, h) {
  const mask = createMask(width, height);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.abs(w) / 2;
  const ry = Math.abs(h) / 2;
  if (rx < 0.01 || ry < 0.01) return mask;
  const SUB = 4;
  for (let row = Math.max(0, Math.floor(cy - ry)); row < Math.min(height, Math.ceil(cy + ry)); row += 1) {
    for (let col = Math.max(0, Math.floor(cx - rx)); col < Math.min(width, Math.ceil(cx + rx)); col += 1) {
      let inside = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        const dy = (row + (sy + 0.5) / SUB - cy) / ry;
        for (let sx = 0; sx < SUB; sx += 1) {
          const dx = (col + (sx + 0.5) / SUB - cx) / rx;
          if (dx * dx + dy * dy <= 1) inside += 1;
        }
      }
      mask.data[row * width + col] = Math.round((inside / (SUB * SUB)) * 255);
    }
  }
  return mask;
}

/**
 * Многоугольник (лассо): чёт-нечет, сглаживание — 4 подстроки на пиксель и
 * точная доля по ширине. `points` — `[[x, y], …]` (не меньше трёх).
 */
export function polygonMask(width, height, points) {
  const mask = createMask(width, height);
  if (!Array.isArray(points) || points.length < 3) return mask;
  const SUB = 4;
  const ys = points.map((point) => point[1]);
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const acc = new Float32Array(width);
  for (let row = top; row <= bottom; row += 1) {
    acc.fill(0);
    for (let sub = 0; sub < SUB; sub += 1) {
      const y = row + (sub + 0.5) / SUB;
      const crossings = [];
      for (let at = 0; at < points.length; at += 1) {
        const [ax, ay] = points[at];
        const [bx, by] = points[(at + 1) % points.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
      crossings.sort((a, b) => a - b);
      for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
        const from = clamp(crossings[pair], 0, width);
        const to = clamp(crossings[pair + 1], 0, width);
        if (to <= from) continue;
        const first = Math.floor(from);
        const last = Math.min(width - 1, Math.ceil(to) - 1);
        for (let col = first; col <= last; col += 1) acc[col] += (Math.min(col + 1, to) - Math.max(col, from)) / SUB;
      }
    }
    for (let col = 0; col < width; col += 1) if (acc[col] > 0) mask.data[row * width + col] = Math.round(clamp(acc[col], 0, 1) * 255);
  }
  return mask;
}

/* ------------------------------------------------------------------ *
 * Операции над масками
 * ------------------------------------------------------------------ */

/**
 * Новое выделение `next` с прежним `previous` по операции: `new` — только
 * новое, `add` — вместе, `sub` — прежнее без нового, `inter` — общее.
 */
export function combineMasks(previous, next, op = "new") {
  if (!previous || op === "new" || !SELECTION_OPS.includes(op)) return next;
  const out = createMask(next.width, next.height);
  const a = previous.data;
  const b = next.data;
  for (let at = 0; at < out.data.length; at += 1) {
    if (op === "add") out.data[at] = Math.max(a[at], b[at]);
    else if (op === "sub") out.data[at] = Math.round((a[at] * (255 - b[at])) / 255);
    else out.data[at] = Math.min(a[at], b[at]);
  }
  return out;
}

/**
 * Маска правок при замке поверхности (`lock` — прямоугольник холста `{ x, y, width, height }`
 * или `null`): только область замка, а с выделением — их пересечение. Без замка — само
 * выделение (может быть `null`).
 */
export function lockedSelection(width, height, lock, selection = null) {
  if (!lock) return selection;
  const area = rectMask(width, height, lock.x, lock.y, lock.width, lock.height);
  return selection ? combineMasks(area, selection, "inter") : area;
}

export function invertMask(mask) {
  const out = createMask(mask.width, mask.height);
  for (let at = 0; at < out.data.length; at += 1) out.data[at] = 255 - mask.data[at];
  return out;
}

/** Растушёвка: размытие маски радиусом `radius` px (три прохода «коробкой» ≈ гаусс). */
export function featherMask(mask, radius) {
  const r = Math.round(radius);
  if (r < 1) return mask;
  const { width, height } = mask;
  let source = Float32Array.from(mask.data);
  let target = new Float32Array(source.length);
  const box = Math.max(1, Math.round(r / 1.7));
  for (let pass = 0; pass < 3; pass += 1) {
    boxBlurLine(source, target, width, height, box, true);
    boxBlurLine(target, source, width, height, box, false);
  }
  const out = createMask(width, height);
  for (let at = 0; at < out.data.length; at += 1) out.data[at] = Math.round(clamp(source[at], 0, 255));
  target = null;
  return out;
}

/* Один проход «коробки» по строкам или столбцам с зажимом по краю. */
function boxBlurLine(from, to, width, height, radius, horizontal) {
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const stride = horizontal ? 1 : width;
  const lineStep = horizontal ? width : 1;
  const window = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const base = line * lineStep;
    let sum = 0;
    for (let at = -radius; at <= radius; at += 1) sum += from[base + clamp(at, 0, length - 1) * stride];
    for (let at = 0; at < length; at += 1) {
      to[base + at * stride] = sum / window;
      sum += from[base + clamp(at + radius + 1, 0, length - 1) * stride] - from[base + clamp(at - radius, 0, length - 1) * stride];
    }
  }
}

/**
 * Границы выделения отрезками для «бегущих муравьёв»: пиксель «внутри», если
 * маска в нём ≥ `threshold`; отрезок — сторона пикселя между «внутри» и «снаружи».
 * Ответ — `Int32Array` `[x1, y1, x2, y2, …]` в пикселях холста; не больше
 * `limit` отрезков (у «рваной» маски границ без счёта — пусто и `truncated`).
 */
export function maskSegments(mask, { threshold = 128, limit = 400000 } = {}) {
  const { width, height, data } = mask;
  const out = [];
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] >= threshold;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x] < threshold) {
        /* Снаружи: стороны, смежные с «внутри» соседом слева и сверху. */
        if (inside(x - 1, y)) out.push(x, y, x, y + 1);
        if (inside(x, y - 1)) out.push(x, y, x + 1, y);
      } else {
        if (!inside(x - 1, y)) out.push(x, y, x, y + 1);
        if (!inside(x, y - 1)) out.push(x, y, x + 1, y);
        if (x === width - 1) out.push(x + 1, y, x + 1, y + 1);
        if (y === height - 1) out.push(x, y + 1, x + 1, y + 1);
      }
      if (out.length / 4 > limit) return { segments: new Int32Array(0), truncated: true };
    }
  }
  return { segments: Int32Array.from(out), truncated: false };
}

/** Выделенное сдвинуто на `dx, dy` (за край уходит). */
export function offsetMask(mask, dx, dy) {
  const out = createMask(mask.width, mask.height);
  const { width, height } = mask;
  for (let y = 0; y < height; y += 1) {
    const sy = y - dy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx;
      if (sx >= 0 && sx < width) out.data[y * width + x] = mask.data[sy * width + sx];
    }
  }
  return out;
}

/** Доля выделения в пикселе (0…1); без маски — весь холст. */
export const maskAt = (mask, x, y) => (mask ? mask.data[y * mask.width + x] / 255 : 1);

/* ------------------------------------------------------------------ *
 * Волшебная палочка и заливка по близости цвета
 * ------------------------------------------------------------------ */

/* Расстояние двух пикселей: наибольшая из разниц каналов (0…255). */
function distance(data, at, r, g, b, a) {
  const dr = Math.abs(data[at] - r);
  const dg = Math.abs(data[at + 1] - g);
  const db = Math.abs(data[at + 2] - b);
  const da = Math.abs(data[at + 3] - a);
  return Math.max(dr, dg, db, da);
}

/**
 * Пиксели, близкие по цвету к точке `seed`: `tolerance` — 0…255 (наибольшая
 * разница канала); `contiguous` — только связная с точкой область (иначе —
 * по всему холсту). Ответ — маска `0/255`.
 */
export function magicWand(rgba, width, height, seedX, seedY, { tolerance = 32, contiguous = true } = {}) {
  const mask = createMask(width, height);
  const sx = Math.round(seedX);
  const sy = Math.round(seedY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask;
  const from = (sy * width + sx) * 4;
  const [r, g, b, a] = [rgba[from], rgba[from + 1], rgba[from + 2], rgba[from + 3]];
  const near = (x, y) => distance(rgba, (y * width + x) * 4, r, g, b, a) <= tolerance;
  if (!contiguous) {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (near(x, y)) mask.data[y * width + x] = 255;
    return mask;
  }
  /* Заливка отрезками: стек пар (x, y), строка заполняется целиком вправо и влево. */
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (mask.data[y * width + x] || !near(x, y)) continue;
    let left = x;
    let right = x;
    while (left > 0 && !mask.data[y * width + left - 1] && near(left - 1, y)) left -= 1;
    while (right < width - 1 && !mask.data[y * width + right + 1] && near(right + 1, y)) right += 1;
    for (let at = left; at <= right; at += 1) mask.data[y * width + at] = 255;
    for (const next of [y - 1, y + 1]) {
      if (next < 0 || next >= height) continue;
      let open = false;
      for (let at = left; at <= right; at += 1) {
        const free = !mask.data[next * width + at] && near(at, next);
        if (free && !open) stack.push(at, next);
        open = free;
      }
    }
  }
  return mask;
}

/**
 * «Убрать фон»: краевые пиксели берутся за фон, фоном считается всё близкое к
 * ним и связанное с краем. Ответ — маска ФОНА (`255` — убрать); растушёвка —
 * мягкий край. Цвет фона — медианный по краю; картинка без чёткого фона
 * (край пёстрый) уберёт мало — это честнее, чем стереть лишнее.
 */
export function backgroundMask(rgba, width, height, { tolerance = 40, feather = 1 } = {}) {
  const edge = [];
  for (let x = 0; x < width; x += 1) edge.push([x, 0], [x, height - 1]);
  for (let y = 1; y < height - 1; y += 1) edge.push([0, y], [width - 1, y]);
  const channel = (index) => {
    const values = edge.map(([x, y]) => rgba[(y * width + x) * 4 + index]).sort((a, b) => a - b);
    return values[values.length >> 1];
  };
  const colour = [channel(0), channel(1), channel(2), channel(3)];
  const out = createMask(width, height);
  const near = (x, y) => distance(rgba, (y * width + x) * 4, colour[0], colour[1], colour[2], colour[3]) <= tolerance;
  const stack = [];
  for (const [x, y] of edge) if (near(x, y)) stack.push(x, y);
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (out.data[y * width + x]) continue;
    out.data[y * width + x] = 255;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!out.data[ny * width + nx] && near(nx, ny)) stack.push(nx, ny);
    }
  }
  return feather >= 1 ? featherMask(out, feather) : out;
}
