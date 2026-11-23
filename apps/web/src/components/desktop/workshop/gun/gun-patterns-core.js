// Процедурные узоры покраски и маска потёртости. Чистая арифметика: ни холста,
// ни времени, ни случайных чисел. Один вход даёт одни и те же байты везде,
// поэтому порядок действий в формулах (особенно сумм и произведений из трёх
// и более членов) менять нельзя: на границах ступеней расходится последний разряд.

const { abs, atan2, ceil, cos, floor, hypot, imul, max, min, pow, round, sin, sqrt, PI } = Math;

export function generatePattern(
  { pattern, colours, scale = 100, rotation = 0, seed = 0, contrast = 100 },
  width,
  height,
) {
  const paint = PAINTERS[pattern] || PAINTERS.woodland;
  const palette = readPalette(colours);
  const mean = [0, 1, 2].map((ch) => palette.reduce((sum, rgb) => sum + rgb[ch], 0) / 4);
  const gain = max(0, Number(contrast) || 0) / 100;
  const unit = min(width, height);
  const zoom = 100 / max(10, Number(scale) || 100);
  const turn = (PI * (Number(rotation) || 0)) / 180;
  const [cosT, sinT] = [cos(turn), sin(turn)];
  // Сырой сид двигает начало координат, а в сам узор идёт округлённый.
  const driftX = 97 * hash(seed, 1, 99);
  const driftY = 89 * hash(seed, 2, 99);
  const patternSeed = round(Number(seed) || 0);
  const halfW = width / 2;
  const halfH = height / 2;
  const pixels = new Uint8ClampedArray(width * height * 4);

  scan(width, height, (q, r, at) => {
    const u = (0.5 + q - halfW) / unit;
    const v = (0.5 + r - halfH) / unit;
    paint(
      driftX + zoom * (DENSITY * (cosT * u - sinT * v)),
      driftY + zoom * (DENSITY * (sinT * u + cosT * v)),
      patternSeed,
    );
    for (let ch = 0; ch < 3; ch++) {
      const mixed = palette[0][ch] * W[0] + palette[1][ch] * W[1] + palette[2][ch] * W[2] + palette[3][ch] * W[3];
      pixels[at + ch] = mean[ch] + gain * (mixed - mean[ch]);
    }
    pixels[at + 3] = 255;
  });
  return pixels;
}

export function patternKey(layer, width, height) {
  const { pattern, colours, scale, rotation, seed, contrast } = layer;
  const fields = [pattern, (colours || []).join(","), scale, rotation, seed, contrast ?? 100, width, height];
  return fields.join("|");
}

export function patternResolution(width, height, limit = 512) {
  const ratio = min(1, limit / max(width, height));
  const [fitW, fitH] = [width, height].map((side) => max(8, round(side * ratio)));
  return { width: fitW, height: fitH };
}

export function generateWearMask({ amount = 0, seed = 0 }, width, height) {
  const mask = new Uint8ClampedArray(width * height * 4);
  const level = clamp01((Number(amount) || 0) / 100);
  if (level <= 0) return mask;

  const unit = min(width, height);
  const salt = 500 + round(Number(seed) || 0);
  const cutoff = 0.78 - 0.46 * level;
  const scratchAbove = 0.985 - 0.05 * level;

  scan(width, height, (q, r, at) => {
    const x = 6 * (q / unit);
    const y = 6 * (r / unit);
    const hole = ramp(cutoff, cutoff + 0.05, fbm(x, y, salt, 5));
    const scratch = vnoise(0.6 * x, 22 * y, salt + 7) > scratchAbove ? 1 : 0;
    mask[at + 3] = 255 * max(hole, level * scratch);
  });
  return mask;
}

// ---------------------------------------------------------------- обход пикселей

// Строки сверху вниз, внутри строки столбцы; смещение растёт на 4 после каждого
// пикселя. Дробный размер идёт до округления вверх, лишние записи пропадают.
// Отрицательные и нечисловые размеры обхода не дают: массив уже создан.
function scan(width, height, visit) {
  const cols = ceil(Number(width));
  const rows = ceil(Number(height));
  if (!(cols > 0)) return;
  let at = 0;
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++, at += 4) visit(q, r, at);
  }
}

// ---------------------------------------------------------------- цвет

// Первый знак всегда отбрасывается («#»), остаток читается как шестнадцатеричное
// целое без проверки формата: «#fff» это 0x0fff, «ff8000» теряет первую цифру.
function readColour(raw) {
  const packed = parseInt(String(raw || "#000000").slice(1), 16) || 0;
  return [16, 8, 0].map((shift) => (packed >> shift) & 255);
}

function readPalette(colours) {
  const given = (colours || []).slice(0, 4).map((raw) => readColour(raw));
  return [0, 1, 2, 3].map((k) => given[k] ?? [128, 128, 128]);
}

// ---------------------------------------------------------------- числа

function clamp01(v) {
  return v > 1 ? 1 : v < 0 ? 0 : v;
}

function lerp(a, b, t) {
  return a + t * (b - a);
}

function smooth(v) {
  return v * v * (3 - v * 2);
}

function ramp(from, to, v) {
  return smooth(clamp01((v - from) / (to - from)));
}

// Ступень вокруг центра: края считаются вычитанием и сложением, не литералами.
function edge(centre, half, v) {
  return ramp(centre - half, centre + half, v);
}

// Приведение к [0, 1) и к [0, 4) для отрицательных чисел тоже.
function wrap1(a) {
  return ((a % 1) + 1) % 1;
}

function wrap4(a) {
  return ((a % 4) + 4) % 4;
}

// Синус по оборотам: sin(2πa), период по аргументу равен единице.
function cycle(a) {
  return sin(2 * (PI * a));
}

function hash(i, j, c) {
  const mixed = imul(374761393, i) ^ imul(668265263, j);
  const sum = (mixed + imul(1442695041, c + 1)) | 0;
  const folded = imul(1274126177, sum ^ (sum >>> 13));
  return ((folded ^ (folded >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, c) {
  const i = floor(x),
    j = floor(y),
    sx = smooth(x - i),
    sy = smooth(y - j);
  const top = lerp(hash(i, j, c), hash(i + 1, j, c), sx);
  const bottom = lerp(hash(i, j + 1, c), hash(i + 1, j + 1, c), sx);
  return lerp(top, bottom, sy);
}

// Сумма октав: амплитуда вдвое меньше, частота в 2.03 раза выше на каждой.
// Число октав не проверяется (0 даёт 0 / 0, дробное повторяет цикл до o < k).
function fbm(x, y, c, k = 4) {
  let sum = 0,
    norm = 0;
  for (let o = 0, amp = 0.5, freq = 1; o < k; o++, amp *= 0.5, freq *= 2.03) {
    sum += vnoise(x * freq, y * freq, c + o) * amp;
    norm += amp;
  }
  return sum / norm;
}

// Тот же fbm, но обе координаты умножаются на один множитель.
function fbmK(x, y, factor, c, octaves) {
  return fbm(factor * x, factor * y, c, octaves);
}

// Ячейки Вороного. Ответ один общий и переписывается следующим вызовом, поэтому
// поля нужно забирать сразу. Метрика «шахматная» только при m строго равном 1.
function cells(x, y, c, m = 0) {
  const i = floor(x),
    j = floor(y);
  CELL.f1 = 9;
  CELL.f2 = 9;
  CELL.id = 0;
  CELL.cx = 0;
  CELL.cy = 0;
  for (let n = 0; n < 9; n++) {
    const gx = i + ((n % 3) - 1),
      gy = j + (floor(n / 3) - 1);
    const px = gx + hash(gx, gy, c),
      py = gy + hash(gx, gy, c + 17);
    const dx = px - x,
      dy = py - y;
    const dist = m === 1 ? max(abs(dx), abs(dy)) : sqrt(dy * dy + dx * dx);
    if (dist < CELL.f1) {
      CELL.f2 = CELL.f1;
      CELL.f1 = dist;
      CELL.id = hash(gx, gy, c + 31);
      CELL.cx = px;
      CELL.cy = py;
    } else if (dist < CELL.f2) {
      CELL.f2 = dist;
    }
  }
  return CELL;
}

// ---------------------------------------------------------------- веса цветов

// Общий массив из четырёх весов (Float32: каждая запись округляется).
// Узор переписывает его целиком; исключение — «узоры» из прототипа объекта.
function put(a, b = 0, c = 0, d = 0) {
  W[0] = a;
  W[1] = b;
  W[2] = c;
  W[3] = d;
}

// Весь вес на один цвет.
function solid(k) {
  W.fill(0);
  W[k] = 1;
}

// Смесь двух цветов: «из» получает 1 − t, «в» получает t.
function duo(from, to, t) {
  W.fill(0);
  W[from] += 1 - t;
  W[to] += t;
}

// Умножить первые n весов на множитель.
function damp(factor, n) {
  for (let k = 0; k < n; k++) W[k] *= factor;
}

// Первая ступень лестницы, у которой значение ниже порога, иначе запасное.
function pick(value, steps, fallback) {
  const hit = steps.find((step) => value < step[0]);
  return hit ? hit[1] : fallback;
}

// ---------------------------------------------------------------- узоры
// Каждый узор получает (x, y, сид) и записывает четыре веса в W. Порядок
// регистрации задаёт порядок названий в PATTERN_PAINTERS.

const registry = [];

function define(name, draw) {
  registry.push([name, draw]);
}

function sett(t) {
  return pick(t - floor(t), SETT_STEPS, 0);
}

define("woodland", (x, y, c) => {
  const px = x + 0.9 * (fbmK(x, y, 0.9, c + 5) - 0.5),
    py = y + 0.9 * (fbm(7 + x * 0.9, y * 0.9 - 3, c + 9) - 0.5);
  const b1 = edge(0.52, 0.02, fbmK(px, py, 1.4, c + 11)),
    b2 = edge(0.58, 0.02, fbm(3 + px * 1.9, py * 1.9, c + 23)),
    b3 = edge(0.62, 0.02, fbm(px * 2.6 - 5, py * 2.6, c + 37));
  put(1 - b1, (1 - b2) * b1, (1 - b3) * b2, b3);
  W[0] = max(0, W[0] - W[2] - W[3]);
});

// В первый вес пишется число, а не номер цвета: так узор вышел в работы.
define("digital", (x, y, c) => {
  const qx = 0.085 * (0.5 + floor(x / 0.085)),
    qy = 0.085 * (0.5 + floor(y / 0.085));
  const value = 0.75 * fbmK(qx, qy, 1.6, c + 3) + 0.25 * fbmK(qx, qy, 4.2, c + 13);
  put(pick(value, DIGITAL_STEPS, 2));
});

define("tiger", (x, y, c) => {
  const warp = 1.4 * fbm(x * 1.2, y * 2.4, c + 7),
    band = cycle(warp + 3.2 * x),
    gap = fbm(x * 6, y * 3, c + 19),
    stroke = ramp(0.35, 0.55, band + 0.9 * (gap - 0.5)),
    light = (1 - stroke) * ramp(0.1, 0.35, band);
  put((1 - stroke) - 0.5 * light, 0.85 * stroke, 0.5 * light, 0.15 * stroke);
});

// Швы между пятнами красятся «тройкой» в первом весе, а не четвёртым цветом.
define("urban", (x, y, c) => {
  const patch = floor(4 * cells(x * 2.2, y * 2.2, c + 1, 1).id) % 4;
  const { f1, f2 } = cells(x * 5.3, y * 5.3, c + 71, 1);
  solid(patch);
  if (f2 - f1 < 0.04) put(3);
});

define("carbon", (x, y) => {
  const a = floor(x / 0.09),
    b = floor(y / 0.09),
    fx = x / 0.09 - a,
    fy = y / 0.09 - b,
    across = (a + b) % 2 === 0,
    ridge = sin(PI * (across ? fy : fx)),
    sheen = pow(max(0, sin(PI * (across ? fx : fy))), 6);
  put(1 - ridge, (1 - sheen) * ridge, 0.7 * (sheen * ridge), 0.3 * (sheen * ridge));
});

define("damascus", (x, y, c) => {
  const warp = 2.2 * fbmK(x, y, 1.3, c + 3) + 0.35 * sin(3.1 * x),
    wave = 0.5 + 0.5 * cycle(warp + 5 * y),
    line = 1 - ramp(0, 0.06, abs(wave - 0.5));
  duo(0, wave < 0.5 ? 1 : 2, 2 * abs(wave - 0.5));
  damp(1 - line, 3);
  W[3] = line;
});

define("marble", (x, y, c) => {
  const turbulence = 5.5 * fbmK(x, y, 1.5, c + 2, 5),
    vein = abs(sin(turbulence + PI * (0.8 * y + 1.3 * x))),
    cloud = fbmK(x, y, 2.2, c + 17),
    thin = 1 - ramp(0, 0.07, vein),
    soft = 1 - ramp(0, 0.3, vein);
  duo(0, 1, clamp01(0.9 * cloud));
  damp(1 - soft, 2);
  W[2] = (1 - thin) * soft;
  W[3] = thin;
});

define("brushed", (x, y, c) => {
  const streak = fbm(x * 0.6, y * 90, c + 5, 3),
    fleck = vnoise(x * 180, y * 180, c + 9);
  duo(0, 1, streak);
  if (fleck > 0.93) solid(3);
  else if (fleck < 0.05) solid(2);
});

define("hex", (x, y, c) => {
  const qx = x / 0.16,
    qy = y / 0.16 / 0.8660254,
    row = floor(qy),
    col = floor(qx - (row % 2 === 0 ? 0 : 0.5));
  let best = 9,
    second = 9,
    bestId = 0;
  for (let n = 0; n < 9; n++) {
    const r = row + (floor(n / 3) - 1),
      k = col + ((n % 3) - 1);
    const centreX = (r % 2 === 0 ? 0 : 0.5) + (0.5 + k);
    const dist = hypot(qx - centreX, 0.8660254 * (qy - (0.5 + r)));
    if (dist < best) {
      second = best;
      best = dist;
      bestId = hash(k, r, c);
    } else if (dist < second) {
      second = dist;
    }
  }
  const gap = second - best,
    border = 1 - ramp(0.02, 0.09, gap),
    core = 1 - ramp(0, 0.025, gap),
    lit = bestId > 0.82 ? 1 : 0;
  put((1 - lit) * (1 - border), (1 - core) * border, lit * (1 - border), core);
});

define("stripes", (x, y, c) => {
  // Остаток со знаком делимого, без приведения: ниже нуля полоса отрицательна.
  const band = (0.3 * hash(c, 3, 7) + y) % 1,
    centre = abs(band - 0.5),
    main = centre < 0.09 ? 1 : 0,
    pin = centre >= 0.11 && centre < 0.13 ? 1 : 0,
    accent = abs(band - 0.2) < 0.015 || abs(band - 0.8) < 0.015 ? 1 : 0;
  put(((1 - main) - pin) - accent, main, pin, accent);
});

define("flag", (x, y, c) => {
  const phase = 2 * (PI * hash(c, 11, 3)),
    bend = 0.025 * sin(1.7 * phase + 4.7 * x) + 0.07 * sin(phase + 2.1 * x),
    band = 3 * wrap1(bend + y),
    stripe = floor(band),
    frac = band - stripe;
  put(0, 0, 0, 0);
  if (frac < FEATHER && stripe > 0) {
    const t = 0.5 + 0.5 * (frac / FEATHER);
    W[stripe] = t;
    W[stripe - 1] = 1 - t;
  } else if (frac > 1 - FEATHER && stripe < 2) {
    const t = 0.5 + 0.5 * ((1 - frac) / FEATHER);
    W[stripe] = t;
    W[stripe + 1] = 1 - t;
  } else {
    W[stripe] = 1;
  }
  const fold = 0.5 - cos(phase + 2.1 * x) * 0.5,
    shade = 0.28 * (fold * fold);
  damp(1 - shade, 3);
  W[3] = shade;
});

define("chevron", (x, y, c) => {
  const zig = 1.4 * abs(wrap1(0.5 * hash(c, 5, 1) + 0.9 * x) - 0.5);
  solid(pick(wrap1(zig + 1.2 * y), CHEVRON_STEPS, 2));
});

define("waves", (x, y, c) => {
  const warp = 0.6 * (fbmK(x, y, 0.6, c + 3) - 0.5),
    phase = 2 * (PI * hash(c, 6, 2)),
    band = wrap1(warp + (0.25 * sin(phase + (3 * warp + 2.2 * x)) + 1.4 * y));
  if (band < 0.42) solid(0);
  else if (band < 0.5) duo(0, 1, (band - 0.42) / 0.08);
  else if (band < 0.86) solid(1);
  else if (band < 0.94) duo(1, 2, (band - 0.86) / 0.08);
  else solid(3);
});

define("glitch", (x, y, c) => {
  const row = floor(5 * y),
    block = floor(2.5 * (2.4 * (hash(row, 7, c) - 0.5) + x));
  solid(pick(hash(block, row, c + 1), GLITCH_STEPS, 3));
  if (wrap1(36 * y) < 0.18) {
    damp(0.75, 3);
    W[3] += 0.25;
  }
});

define("stars", (x, y, c) => {
  const { f1, id, cx, cy } = cells(x * 1.6, y * 1.6, c + 51);
  solid(0);
  if (id < 0.35) return;
  const angle = 6.28 * id + atan2(1.6 * y - cy, 1.6 * x - cx),
    radius = (0.62 + 0.38 * cos(5 * angle)) * (0.22 * id + 0.12),
    glow = 1.9 * radius;
  if (f1 < radius) {
    put(0, 0, id > 0.8 ? 1 : 0, id > 0.8 ? 0 : 1);
  } else if (f1 < glow) {
    const t = 1 - (f1 - radius) / (glow - radius);
    put(1 - 0.6 * t, 0.6 * t);
  }
});

define("gradient", (x, y, c) => {
  const t = clamp01(0.25 * (fbmK(x, y, 0.8, c + 1) - 0.5) + x / 3);
  if (t < 0.5) duo(0, 1, 2 * t);
  else duo(1, 2, 2 * (t - 0.5));
});

define("splatter", (x, y, c) => {
  solid(0);
  for (let layer = 0; layer < 3; layer++) {
    const zoom = 1.7 * layer + 2.2;
    const { f1, id } = cells(zoom * x, zoom * y, layer * 13 + (c + 41));
    const wobble = 0.12 * (fbmK(x, y, 9, c + layer) - 0.5);
    if (id > 0.35 && f1 < wobble + (0.3 * id + 0.08)) {
      put(0, 0, 0, 0);
      W[1 + layer] = 1;
    }
  }
});

define("circuit", (x, y, c) => {
  const a = floor(x / 0.12),
    b = floor(y / 0.12),
    fx = x / 0.12 - a,
    fy = y / 0.12 - b,
    cell = hash(a, b, c),
    offset = 0.6 * hash(a, b, c + 5) + 0.2,
    dist = cell > 0.5 ? abs(fy - offset) : abs(fx - offset),
    track = cell > 0.18 && dist < 0.06 ? 1 : 0,
    glow = cell > 0.18 ? 1 - ramp(0.05, 0.22, dist) : 0,
    pad = hash(a, b, c + 9) > 0.8 && hypot(fx - 0.5, fy - 0.5) < 0.16 ? 1 : 0;
  put(1 - glow, (1 - track) * glow, (1 - pad) * track, pad);
});

define("topo", (x, y, c) => {
  const height = fbmK(x, y, 0.9, c + 3, 5),
    levels = 14 * height,
    frac = levels - floor(levels);
  duo(0, 1, clamp01(2 * (height - 0.3)));
  if (frac < 0.08 || frac > 0.92) {
    const index = floor(levels) % 5 === 0;
    put(0, 0, index ? 0 : 1, index ? 1 : 0);
  }
});

define("scales", (x, y, c) => {
  const row = floor(y / SCALE_R),
    shift = row % 2 === 0 ? 0 : 0.14 / 2,
    col = floor((shift + x) / 0.14),
    centreX = 0.14 / 2 + (0.14 * col - shift),
    centreY = 0.62 * (0.14 * (row + 1)),
    dx = (x - centreX) / SCALE_R,
    dy = (y - centreY) / SCALE_R,
    dist = sqrt(dy * dy + dx * dx),
    rim = ramp(0.78, 0.96, dist);
  duo(2, 1, clamp01(0.35 * hash(col, row, c) + 0.9 * dist));
  damp(1 - rim, 3);
  W[3] = (1 - rim) * (0.6 * (1 - ramp(0, 0.18, abs(dist - 0.35))));
  W[0] = rim;
  // Нормировка: итог один на все четыре веса; ноль или NaN заменяются единицей.
  const total = ((W[0] + W[1]) + W[2]) + W[3];
  const divisor = total || 1;
  W.forEach((w, k) => {
    W[k] = w / divisor;
  });
});

define("flames", (x, y, c) => {
  // «- 0.0 * y» нужен: при бесконечном y он даёт NaN, как и должно быть.
  const lift = fbm(2.2 * x - 0.0 * y, 5.5 * y, c + 3),
    tongue = 0.7 * (lift - 0.5) + 0.45 * x,
    heat = 1 - (tongue - floor(tongue));
  if (heat < 0.35) put(1 - heat / 0.35, heat / 0.35);
  else if (heat < 0.7) duo(1, 2, (heat - 0.35) / 0.35);
  else duo(2, 3, (heat - 0.7) / 0.3);
});

define("galaxy", (x, y, c) => {
  const light = ramp(0.45, 0.8, fbmK(x, y, 1.2, c + 3, 5)),
    tint = ramp(0.4, 0.75, fbm(11 + x * 2.5, y * 2.5, c + 9, 4)),
    star = hash(floor(140 * x), floor(140 * y), c + 21);
  put(1 - light, (1 - tint) * light, tint * light, 0);
  if (star > 0.992) {
    put(0, 0, 0, 1);
  } else if (star > 0.985) {
    W[3] = 0.6;
    damp(0.4, 3);
  }
});

define("lava", (x, y, c) => {
  const sway = 0.5 * (fbmK(x, y, 1.4, c + 3) - 0.5);
  const { f1, f2 } = cells(sway + 3 * x, 3 * y, c + 5);
  const crack = f2 - f1,
    fire = 1 - ramp(0, 0.12, crack),
    core = 1 - ramp(0, 0.04, crack);
  duo(0, 1, fbmK(x, y, 4, c + 13));
  damp(1 - fire, 2);
  W[2] = (1 - core) * fire;
  W[3] = core;
});

define("tartan", (x, y) => {
  const warp = sett(0.9 * x),
    weft = sett(0.9 * y),
    twill = (floor(60 * x) + floor(60 * y)) % 4 < 2;
  put(0);
  W[twill ? warp : weft] += 0.62;
  W[twill ? weft : warp] += 0.38;
});

define("polka", (x, y, c) => {
  const row = floor(y / 0.34),
    shift = row % 2 === 0 ? 0 : 0.34 / 2,
    col = floor((shift + x) / 0.34),
    dx = (((shift + x) / 0.34) - col) - 0.5,
    dy = ((y / 0.34) - row) - 0.5,
    dot = 1 - edge(0.26, 0.02, hypot(dx, dy)),
    other = hash(col, row, c) > 0.85 ? 1 : 0;
  put(1 - dot, (1 - other) * dot, other * dot, 0);
});

define("tiedye", (x, y, c) => {
  const cx = 97 * hash(c, 1, 99) + 0.6 * (hash(c, 5, 1) - 0.5),
    cy = 89 * hash(c, 2, 99) + 0.6 * (hash(c, 6, 1) - 0.5),
    dx = x - cx,
    dy = y - cy,
    angle = atan2(dy, dx) / (2 * PI),
    spread = 0.6 * (fbmK(x, y, 1.3, c + 7) - 0.5),
    scaled = 4 * wrap1(spread + (0.9 * hypot(dx, dy) + 3 * angle)),
    from = floor(scaled) % 4;
  duo(from, (from + 1) % 4, ramp(0.55, 1, scaled - floor(scaled)));
});

define("leopard", (x, y, c) => {
  const wx = 0.25 * (fbm(x * 2.4, y * 2.4, c + 3) - 0.5),
    wy = 0.25 * (fbm(5 + x * 2.4, y * 2.4, c + 4) - 0.5);
  const { f1, id } = cells(wx + 3 * x, wy + 3 * y, c + 11);
  const size = 0.12 * id + 0.22,
    inside = 1 - ramp(size - 0.03, size, f1),
    rim = (1 - ramp(size + 0.08, size + 0.12, f1)) * edge(size, 0.02, f1),
    ring = ramp(0.42, 0.55, fbmK(x, y, 7, c + 17)) * rim;
  put(0);
  W[1] = inside;
  W[2] = ring;
  W[0] = max(0, (1 - inside) - ring);
  if (id > 0.8 && inside > 0.5) {
    W[3] = W[1];
    W[1] = 0;
  }
});

define("zebra", (x, y, c) => {
  const warp = 2.4 * fbm(x * 0.8, y * 1.6, c + 5),
    stroke = ramp(-0.08, 0.08, cycle(warp + 2.4 * x));
  put(1 - stroke, stroke, 0, 0);
});

define("denim", (x, y, c) => {
  const thread = wrap4(70 * y + 70 * x) < 3,
    slack = vnoise(x * 3, y * 90, c + 3),
    fade = ramp(0.55, 0.85, fbmK(x, y, 0.9, c + 9));
  put(0);
  W[thread ? 0 : 1] = 1 - fade;
  W[2] = (0.4 * slack + 0.6) * fade;
  W[thread ? 1 : 0] += (0.4 - 0.4 * slack) * fade;
  if (vnoise(x * 30, y * 240, c + 13) > 0.985) put(0, 0, 0, 1);
});

define("houndstooth", (x, y) => {
  const fu = (((x / 0.22) % 2) + 2) % 2,
    fv = (((y / 0.22) % 2) + 2) % 2,
    left = fu < 1,
    top = fv < 1;
  let dark;
  if (left && top) dark = true;
  else if (!left && !top) dark = false;
  else dark = wrap1(fu - fv) < 0.5;
  put(dark ? 0 : 1, dark ? 1 : 0, 0, 0);
});

define("checker", (x, y, c) => {
  const dark = (floor(x / 0.32) + floor(y / 0.32)) % 2 === 0,
    grain = 0.06 * vnoise(x * 120, y * 120, c + 1);
  put(dark ? grain : 1 - grain, dark ? 1 - grain : grain, 0, 0);
});

// ---------------------------------------------------------------- таблицы

// Плотность: 2.2 единицы рисунка на короткую сторону листа при масштабе 100.
const DENSITY = 2.2;
const FEATHER = 0.03;
const SCALE_R = 0.14 * 0.62;

const W = new Float32Array(4);
const CELL = { f1: 9, f2: 9, id: 0, cx: 0, cy: 0 };

const DIGITAL_STEPS = [[0.42, 3], [0.5, 0], [0.58, 1]];
const CHEVRON_STEPS = [[0.42, 0], [0.5, 3], [0.9, 1]];
const GLITCH_STEPS = [[0.55, 0], [0.78, 1], [0.92, 2]];
const SETT_STEPS = [[0.34, 0], [0.5, 1], [0.56, 3], [0.62, 1], [0.88, 2]];

// Обычный объект с прототипом: название ищется как свойство, в том числе
// унаследованное («constructor» находится и вызывается как узор без весов).
const PAINTERS = Object.fromEntries(registry);

export const PATTERN_PAINTERS = Object.freeze(registry.map(([name]) => name));
