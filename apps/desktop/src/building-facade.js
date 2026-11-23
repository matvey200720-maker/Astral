/*
 * Главный фасад здания по его же геометрии (владелец, 13.11.2026: «ты должен показывать главный фасад, то есть скриншот с главного фасада — там будет основная
 * картинка»; образцы — `ref/4` и `ref/5` первого ТЗ: здание целиком со стороны входа, вся стена в кадре).
 *
 * Модель здания не говорит, где у неё перед, и признаков, которые знал бы сам мод, нет. Поэтому фасад выбирается по тому, что видно в треугольниках (чистые
 * функции, без файлов и окна — тесты без игры):
 *
 *   1. Стены — почти вертикальные грани. Их нормали складываются «четвёркой» (угол × 4): так находится поворот здания, даже если оно стоит под углом к осям
 *      модели (Davis Mega Mall повёрнут на 40°). Здание, у которого стены не собираются в прямоугольник (круглое, развалины), фасада не имеет — ответ `null`.
 *   2. Четыре стороны: поворот + 0°, 90°, 180°, 270°. У каждой считается открытая стена — та, что видна снаружи по направлению стороны (глубина по сетке
 *      «поперёк × высота»): без стен, спрятанных за пристройками, ступенями и соседними корпусами.
 *   3. Фасад — самая большая целиком видимая плоская стена главного объёма здания, перед которой свободно. Считается только верхняя часть стен (выше трети
 *      высоты): низкие пристройки, подиумы и крыльца фасада не делают. Стена, к которой вплотную стоит пристройка, теряет закрытую часть, а доля длины, перед
 *      которой ничего не стоит на 30 м вперёд, умножает её площадь: у Davis Mega Mall крыло стоит у одной длинной стены — это тыл, чистая длинная стена —
 *      фасад. Стороны, у которых итог не меньше 90 % лучшего, — равные претенденты.
 *   4. Равных претендентов разводят признаки входа: навесы и ступени перед стеной на высоте входа, низкие горизонтальные поверхности самой модели вне контура
 *      здания (парковка, плита), вывески и свечение, остекление. Остаётся ничья — длиннее сторона, затем меньший номер.
 *
 * Проверено на двух зданиях с известной стороной входа: Davis Mega Mall из партии ALLIANCE V3 (модель в осях автора; главный фасад — стена с навесами и колоннами, ответ верный,
 * тыл — стена, к которой стоит крыло с ювелирной вывеской, он получает ноль) и штатная сцена You Tool из мастерской (выбрана сторона, где лежат остекление, вывески ENTRANCE/EXIT
 * и крупные буквы названия).
 *
 * Где это может ошибиться: у здания без главного объёма (все стены одной высоты и размера) решают только признаки входа, а если и их нет — сторона выбирается по
 * длине, а не по входу; у здания, где вход сделан на торце или в пристройке, выбор ляжет на длинную стену основного объёма. Поэтому `confident` — отдельный
 * признак, а в галерею попадают все стороны и вид сверху.
 */

/** Грань — стена, если нормаль уходит от горизонтали не больше, чем на этот косинус вертикали. */
const WALL_SLOPE = 0.3;
/** Грань — пол или крыша, если нормаль почти вертикальна. */
const FLAT_SLOPE = 0.9;
/** Стены меньше этой площади (м²) — не здание, а вещь. */
const MIN_WALL_AREA = 200;
/** Больше стольких треугольников в модели — фасада не ищем. */
const MAX_TRIANGLES = 400_000;
/** Грани меньше этой площади (м²) в расчёт не идут (мусор модели). */
const MIN_FACE = 0.02;
/** Прямоугольность стен (0…1) ниже этой — здание не прямоугольное, фасада нет. */
const MIN_RECTILINEAR = 0.45;
/** Нормаль грани смотрит на сторону, если косинус угла не меньше этого. */
const FACING = 0.85;
/** Шаг выборки точек на стене и ячейка карты глубины, м; ячейка плоскости (по глубине), м. */
const SAMPLE_STEP = 1.5;
const DEPTH_CELL = 2;
const PLANE_CELL = 1.5;
/** Точка открыта, если она не глубже самой дальней поверхности в её ячейке больше, чем на эту долю метров. */
const EXPOSED_SLACK = 1.5;
/** Ячейка контура здания на земле, м. */
const FOOTPRINT_CELL = 2;
/** Предел сетки выборки на одну грань (n × n точек) и самая дальняя площадка вокруг здания, м. */
const SAMPLE_LIMIT = 16;
const GROUND_REACH = 90;
/** «Низ» здания — нижняя треть его высоты, но не выше этого предела над основанием, м. */
const LOW_SHARE = 0.35;
const LOW_LIMIT = 8;
/** Главный объём — стены выше этой доли высоты (от низа до верха стен). */
const TALL_SHARE = 0.3;
/** Равный претендент: большая плоская стена не меньше этой доли лучшей. */
const CONTENDER = 0.9;
/** Стена, перед которой всё занято, весит не ноль, а эту долю: в плотной застройке сторона всё равно выбирается по стене, а не по порядку номеров. */
const BLOCKED_SHARE = 0.05;
/** Свободная площадка перед стеной: от какой глубины перед ней (м) и до какой смотрим, сколько ячеек подряд — сплошное препятствие. */
const APRON = Object.freeze({ start: 3, length: 30, solid: 2 });
/** Навес: от стены вперёд (м) и по высоте над низом стены (м). */
const PORCH = Object.freeze({ reach: [0.3, 7], high: [0.3, 8] });
/** Веса признаков входа у равных претендентов (каждый берётся долей от лучшего среди них). */
const CUES = Object.freeze({ porch: 0.5, ground: 0.5, sign: 0.3, open: 0.3 });
/** Победа уверена: претендент один, или запас по признакам входа не меньше этой доли суммы весов. */
const CONFIDENT_GAP = 0.2;
/** Сколько метров впереди фасада попадает в кадр (парковка, ступени): доля длины стороны, в пределах. */
const FRONT_DEPTH = Object.freeze({ share: 0.2, min: 6, max: 18 });

const quantile = (sorted, share) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * (sorted.length - 1))))] : 0);

/** Треугольники частей в плоский список: вершины, нормаль, площадь, признаки материала. */
export function trianglesOf(parts) {
  const found = [];
  for (const part of parts) {
    const { positions, indices } = part;
    if (!positions || !indices) continue;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const [ia, ib, ic] = [indices[at] * 3, indices[at + 1] * 3, indices[at + 2] * 3];
      const ax = positions[ia];
      const ay = positions[ia + 1];
      const az = positions[ia + 2];
      const ux = positions[ib] - ax;
      const uy = positions[ib + 1] - ay;
      const uz = positions[ib + 2] - az;
      const vx = positions[ic] - ax;
      const vy = positions[ic + 1] - ay;
      const vz = positions[ic + 2] - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (!(length > 1e-9) || length / 2 < MIN_FACE) continue;
      found.push({
        a: [ax, ay, az],
        b: [positions[ib], positions[ib + 1], positions[ib + 2]],
        c: [positions[ic], positions[ic + 1], positions[ic + 2]],
        n: [nx / length, ny / length, nz / length],
        area: length / 2,
        open: part.open === true,
        sign: part.sign === true,
      });
    }
  }
  return found;
}

/** Точки на грани: центры `n × n` равных малых треугольников; каждая несёт `area / n²`. */
export function samplesOf(tri, step) {
  const n = Math.min(SAMPLE_LIMIT, Math.max(1, Math.ceil(Math.sqrt(tri.area) / step)));
  const weight = tri.area / (n * n);
  const points = [];
  const put = (u, v) => points.push([tri.a[0] + (tri.b[0] - tri.a[0]) * u + (tri.c[0] - tri.a[0]) * v, tri.a[1] + (tri.b[1] - tri.a[1]) * u + (tri.c[1] - tri.a[1]) * v, tri.a[2] + (tri.b[2] - tri.a[2]) * u + (tri.c[2] - tri.a[2]) * v]);
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n - i; j += 1) {
      put((i + 1 / 3) / n, (j + 1 / 3) / n);
      if (i + j < n - 1) put((i + 2 / 3) / n, (j + 2 / 3) / n);
    }
  return { points, weight };
}

/** Поворот здания по «четвёрке» нормалей стен: `{ angle, rectilinear }` — угол первой стороны, рад, и доля стен, лежащих по осям поворота (0…1). */
function orientationOf(walls) {
  let [real, imaginary, total] = [0, 0, 0];
  for (const wall of walls) {
    const turn = Math.atan2(wall.n[1], wall.n[0]);
    real += wall.area * Math.cos(4 * turn);
    imaginary += wall.area * Math.sin(4 * turn);
    total += wall.area;
  }
  return { angle: Math.atan2(imaginary, real) / 4, rectilinear: total > 0 ? Math.hypot(real, imaginary) / total : 0 };
}

/** Высота, выше которой стена — главный объём: от низа до верха стен (2 % и 98 % по площади), плюс доля высоты. */
function tallFrom(walls) {
  const rows = walls.map((tri) => [(tri.a[2] + tri.b[2] + tri.c[2]) / 3, tri.area]).sort((left, right) => left[0] - right[0]);
  const total = rows.reduce((sum, [, area]) => sum + area, 0);
  const at = (share) => {
    let run = 0;
    for (const [z, area] of rows) {
      run += area;
      if (run >= share * total) return z;
    }
    return rows.at(-1)[0];
  };
  const [low, top] = [at(0.02), at(0.98)];
  return low + TALL_SHARE * (top - low);
}

/**
 * Самая большая плоскость: окно по глубине из трёх ячеек с наибольшей суммой площадей. Ответ — `{ area, at, across }`: м², глубина её середины и размах поперёк
 * (5 % и 95 % её точек).
 */
function bigPlane(rows) {
  const bins = new Map();
  for (const row of rows) {
    const cell = Math.floor(row.reach / PLANE_CELL);
    bins.set(cell, [...(bins.get(cell) || []), row]);
  }
  let best = { area: 0, at: 0, across: [0, 0] };
  for (const cell of bins.keys()) {
    const members = [cell - 1, cell, cell + 1].flatMap((key) => bins.get(key) || []);
    const area = members.reduce((sum, row) => sum + row.weight, 0);
    if (area <= best.area) continue;
    const across = members.map((row) => row.across).sort((left, right) => left - right);
    best = { area, at: (cell + 0.5) * PLANE_CELL, across: [quantile(across, 0.05), quantile(across, 0.95)] };
  }
  return best;
}

/** Что видно снаружи у одной стороны: открытая стена, её размах и плоскость, остекление и вывески. `from` — высота, с которой стена считается главным объёмом. */
function exposedSide(walls, occluders, direction, from) {
  const [dx, dy] = direction;
  const [tx, ty] = [-dy, dx];
  const depth = new Map();
  const cellOf = (across, height) => `${Math.floor(across / DEPTH_CELL)}|${Math.floor(height / DEPTH_CELL)}`;
  for (const tri of occluders) {
    for (const point of samplesOf(tri, SAMPLE_STEP).points) {
      const cell = cellOf(point[0] * tx + point[1] * ty, point[2]);
      const reach = point[0] * dx + point[1] * dy;
      if (!depth.has(cell) || reach > depth.get(cell)) depth.set(cell, reach);
    }
  }
  const seen = { wall: 0, open: 0, sign: 0, across: [], reach: [], height: [], tall: [] };
  for (const tri of walls) {
    if (tri.n[0] * dx + tri.n[1] * dy < FACING) continue;
    const { points, weight } = samplesOf(tri, SAMPLE_STEP);
    for (const point of points) {
      const across = point[0] * tx + point[1] * ty;
      const reach = point[0] * dx + point[1] * dy;
      if (reach < depth.get(cellOf(across, point[2])) - EXPOSED_SLACK) continue;
      seen.wall += weight;
      if (tri.open) seen.open += weight;
      if (tri.sign) seen.sign += weight;
      seen.across.push(across);
      seen.reach.push(reach);
      seen.height.push(point[2]);
      if (point[2] >= from) seen.tall.push({ reach, across, weight });
    }
  }
  for (const key of ["across", "reach", "height"]) seen[key].sort((left, right) => left - right);
  seen.plane = bigPlane(seen.tall);
  return seen;
}

/** Ячейки земли, центры которых лежат внутри проекции грани (мелкая грань — своей ячейкой), по одному вызову на ячейку. */
function eachCell(tri, visit) {
  const xs = [tri.a[0], tri.b[0], tri.c[0]];
  const ys = [tri.a[1], tri.b[1], tri.c[1]];
  const [i0, i1] = [Math.floor(Math.min(...xs) / FOOTPRINT_CELL), Math.floor(Math.max(...xs) / FOOTPRINT_CELL)];
  const [j0, j1] = [Math.floor(Math.min(...ys) / FOOTPRINT_CELL), Math.floor(Math.max(...ys) / FOOTPRINT_CELL)];
  visit((xs[0] + xs[1] + xs[2]) / 3, (ys[0] + ys[1] + ys[2]) / 3);
  if (i0 === i1 && j0 === j1) return;
  const side = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
  for (let i = i0; i <= i1; i += 1)
    for (let j = j0; j <= j1; j += 1) {
      const px = (i + 0.5) * FOOTPRINT_CELL;
      const py = (j + 0.5) * FOOTPRINT_CELL;
      const d1 = side(px, py, xs[0], ys[0], xs[1], ys[1]);
      const d2 = side(px, py, xs[1], ys[1], xs[2], ys[2]);
      const d3 = side(px, py, xs[2], ys[2], xs[0], ys[0]);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) visit(px, py);
    }
}

const cellKey = (x, y) => `${Math.floor(x / FOOTPRINT_CELL)}|${Math.floor(y / FOOTPRINT_CELL)}`;

/** Растр контура: ячейки земли, над которыми что-то стоит выше «низа» здания. */
function footprintOf(triangles, low) {
  const covered = new Set();
  for (const tri of triangles) if (Math.max(tri.a[2], tri.b[2], tri.c[2]) > low) eachCell(tri, (x, y) => covered.add(cellKey(x, y)));
  return covered;
}

/** Сектор вокруг середины контура, повёрнутый на угол здания: 0 — вдоль первой стороны, затем против часовой. */
function sectorOf(vx, vy, cos, sin) {
  const along = vx * cos + vy * sin;
  const across = -vx * sin + vy * cos;
  return Math.abs(along) >= Math.abs(across) ? (along > 0 ? 0 : 2) : across > 0 ? 1 : 3;
}

/** Низкие горизонтальные поверхности вне контура здания и вывески — по сторонам, м². */
function surroundings(triangles, { covered, low, centre, angle }) {
  const ground = [0, 0, 0, 0];
  const sign = [0, 0, 0, 0];
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const cellArea = FOOTPRINT_CELL * FOOTPRINT_CELL;
  for (const tri of triangles) {
    if (tri.sign) {
      const [cx, cy] = [(tri.a[0] + tri.b[0] + tri.c[0]) / 3 - centre[0], (tri.a[1] + tri.b[1] + tri.c[1]) / 3 - centre[1]];
      if (Math.hypot(cx, cy) <= GROUND_REACH) sign[sectorOf(cx, cy, cos, sin)] += tri.area;
    }
    if (Math.abs(tri.n[2]) < FLAT_SLOPE || Math.max(tri.a[2], tri.b[2], tri.c[2]) > low) continue;
    const place = [];
    eachCell(tri, (x, y) => {
      if (covered.has(cellKey(x, y)) || Math.hypot(x - centre[0], y - centre[1]) > GROUND_REACH) return;
      place.push(sectorOf(x - centre[0], y - centre[1], cos, sin));
    });
    /* Площадь грани делится поровну между её ячейками, но не больше ячейки на ячейку: мелкая грань не весит больше своей площади. */
    const share = place.length ? Math.min(tri.area / place.length, cellArea) : 0;
    for (const sector of place) ground[sector] += share;
  }
  return { ground, sign };
}

/**
 * Свободная площадка перед стеной: доля колонок вдоль неё, где на `APRON.length` метров вперёд нет сплошного препятствия (больше ячейки подряд выше «низа» здания: пристройка,
 * соседний корпус). Одинокий столб, кромка навеса и ограждение препятствием не считаются (0…1).
 */
function clearApron(covered, side) {
  const [dx, dy] = side.normal;
  const [tx, ty] = [-dy, dx];
  const [from, to] = side.flat.across;
  let [free, columns] = [0, 0];
  for (let along = from; along <= to; along += FOOTPRINT_CELL) {
    columns += 1;
    let [run, blocked] = [0, false];
    for (let ahead = side.flat.at + APRON.start; ahead <= side.flat.at + APRON.length && !blocked; ahead += FOOTPRINT_CELL) {
      run = covered.has(cellKey(dx * ahead + tx * along, dy * ahead + ty * along)) ? run + 1 : 0;
      blocked = run >= APRON.solid;
    }
    if (!blocked) free += 1;
  }
  return columns ? free / columns : 0;
}

/** Навесы и ступени: поверхности перед стеной на высоте входа (над низом стены), в её размахе, м². */
function porchOf(triangles, side) {
  const [dx, dy] = side.normal;
  const [tx, ty] = [-dy, dx];
  const base = side.height[0];
  let area = 0;
  for (const tri of triangles) {
    if (Math.abs(tri.n[2]) < WALL_SLOPE) continue;
    if (Math.min(tri.a[2], tri.b[2], tri.c[2]) > base + PORCH.high[1] || Math.max(tri.a[2], tri.b[2], tri.c[2]) < base + PORCH.high[0]) continue;
    const { points, weight } = samplesOf(tri, SAMPLE_STEP);
    for (const point of points) {
      const reach = point[0] * dx + point[1] * dy - side.flat.at;
      const across = point[0] * tx + point[1] * ty;
      if (reach < PORCH.reach[0] || reach > PORCH.reach[1] || across < side.flat.across[0] - 2 || across > side.flat.across[1] + 2) continue;
      if (point[2] >= base + PORCH.high[0] && point[2] <= base + PORCH.high[1]) area += weight;
    }
  }
  return area;
}

/** Главная сторона: среди равных претендентов — по признакам входа, затем по длине и номеру. Возвращает `{ main, confident, order }`. */
function pickMain(sides) {
  const lead = Math.max(...sides.map((side) => side.fit));
  const contenders = sides.filter((side) => side.fit >= CONTENDER * lead);
  const peaks = Object.fromEntries(Object.keys(CUES).map((key) => [key, Math.max(...contenders.map((side) => side[key]))]));
  for (const side of sides) side.cue = Object.entries(CUES).reduce((sum, [key, weight]) => sum + (peaks[key] > 0 && contenders.includes(side) ? (weight * side[key]) / peaks[key] : 0), 0);
  const byCue = [...contenders].sort((left, right) => right.cue - left.cue || right.fit - left.fit || right.span - left.span || left.index - right.index);
  const [first, second] = byCue;
  const others = sides.filter((side) => side !== first).sort((left, right) => right.fit - left.fit || right.span - left.span || left.index - right.index);
  const total = Object.values(CUES).reduce((sum, weight) => sum + weight, 0);
  return { main: first.index, confident: !second || first.cue - second.cue >= CONFIDENT_GAP * total, order: [first, ...others].map((side) => side.index) };
}

/**
 * Фасады здания: `{ angle, rectilinear, sides, main, confident, order }` или `null`, если стен мало или они не складываются в прямоугольник.
 *   `sides[k]` — `{ index, normal: [x, y], wall, flat: { area, at, across }, clear, fit, span, height: [от, до], porch, ground, sign, open, cue }` (метры и м²; оси модели:
 *   x, y — по земле, z — вверх); `flat` — самая большая видимая плоская стена главного объёма (площадь, глубина вдоль нормали, размах поперёк), `clear` — доля её длины со
 *   свободной площадкой впереди, `fit` — `flat.area × clear`; `main` — индекс главной стороны, `order` — стороны от главной по убыванию `fit`, `confident` — выбор не на ничьей.
 * @param {{ positions: ArrayLike<number>, indices: ArrayLike<number>, open?: boolean, sign?: boolean }[]} parts сетки в осях игры (x, y — по земле, z — вверх)
 */
export function facadeOf(parts) {
  /* Модель-город (сотни тысяч треугольников) здание не называет: обложка по ней — прежний общий вид, а разбор не держит окно секундами. */
  if (parts.reduce((sum, part) => sum + (part.indices?.length || 0) / 3, 0) > MAX_TRIANGLES) return null;
  const triangles = trianglesOf(parts);
  const walls = triangles.filter((tri) => Math.abs(tri.n[2]) < WALL_SLOPE);
  if (walls.reduce((sum, tri) => sum + tri.area, 0) < MIN_WALL_AREA) return null;
  const { angle, rectilinear } = orientationOf(walls);
  if (rectilinear < MIN_RECTILINEAR) return null;

  const zs = triangles.flatMap((tri) => [tri.a[2], tri.b[2], tri.c[2]]);
  const [zMin, zMax] = [zs.reduce((least, z) => Math.min(least, z), Infinity), zs.reduce((most, z) => Math.max(most, z), -Infinity)];
  const low = zMin + Math.min(LOW_LIMIT, LOW_SHARE * (zMax - zMin));
  const covered = footprintOf(triangles, low);
  if (!covered.size) return null;
  let [sumX, sumY] = [0, 0];
  for (const cell of covered) {
    const [i, j] = cell.split("|").map(Number);
    sumX += (i + 0.5) * FOOTPRINT_CELL;
    sumY += (j + 0.5) * FOOTPRINT_CELL;
  }
  const around = surroundings(triangles, { covered, low, centre: [sumX / covered.size, sumY / covered.size], angle });
  const occluders = triangles.filter((tri) => Math.abs(tri.n[2]) <= FLAT_SLOPE);
  const from = tallFrom(walls);

  const sides = [0, 1, 2, 3].map((index) => {
    const turn = angle + (index * Math.PI) / 2;
    const normal = [Math.cos(turn), Math.sin(turn)];
    const seen = exposedSide(walls, occluders, normal, from);
    return {
      index,
      normal,
      wall: seen.wall,
      flat: seen.plane,
      clear: 1,
      span: quantile(seen.across, 0.95) - quantile(seen.across, 0.05),
      plane: quantile(seen.reach, 0.5),
      reach: [quantile(seen.reach, 0.1), quantile(seen.reach, 0.9)],
      across: [quantile(seen.across, 0.03), quantile(seen.across, 0.97)],
      height: [quantile(seen.height, 0.02), quantile(seen.height, 0.98)],
      ground: around.ground[index],
      sign: around.sign[index],
      open: seen.open,
      porch: 0,
    };
  });
  if (!sides.some((side) => side.flat.area > 0)) return null;
  for (const side of sides) {
    side.clear = clearApron(covered, side);
    side.fit = side.flat.area * (BLOCKED_SHARE + (1 - BLOCKED_SHARE) * side.clear);
    side.porch = porchOf(triangles, side);
  }
  return { angle, rectilinear, sides, ...pickMain(sides) };
}

/**
 * Коробка кадра у стороны `side`: главная плоская стена целиком (от низа до верха) и полоса перед ней для парковки и ступеней — по ней окно садит камеру (`fitCloud`:
 * вершины внутри коробки), а `centre` — середина стены, куда она смотрит. Оси модели; `min`/`max`/`centre` — по x, y, z.
 */
export function facadeBox(side) {
  const { normal, flat, height } = side;
  const depth = Math.min(FRONT_DEPTH.max, Math.max(FRONT_DEPTH.min, FRONT_DEPTH.share * (flat.across[1] - flat.across[0])));
  const [tx, ty] = [-normal[1], normal[0]];
  const point = (forward, along) => [normal[0] * forward + tx * along, normal[1] * forward + ty * along];
  const corners = [flat.at - 2, flat.at + depth].flatMap((forward) => flat.across.map((along) => point(forward, along)));
  const middle = point(flat.at, (flat.across[0] + flat.across[1]) / 2);
  return {
    min: [Math.min(...corners.map(([x]) => x)), Math.min(...corners.map(([, y]) => y)), height[0] - 0.5],
    max: [Math.max(...corners.map(([x]) => x)), Math.max(...corners.map(([, y]) => y)), height[1] + 1],
    centre: [middle[0], middle[1], (height[0] + height[1]) / 2],
  };
}

/** Курс камеры (рад, как у кадра мастерской), с которого смотрит на сторону с нормалью `normal`; `bias` — сколько довернуть вбок (фасад «в три четверти»). */
export const yawFacing = (normal, bias = 0) => Math.atan2(normal[0], -normal[1]) + bias;
