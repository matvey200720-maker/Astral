/*
 * Геометрия метки над животным (05.11.2026).
 *
 * Метка — модель в осях RAGE (X вправо, Y вперёд, Z вверх; метры; начало — начало педа: у животных оно в середине тела, а не
 * у ног). Высота `height` отсчитывается от верха тела `base` (самая высокая точка сетки животного, Z модели):
 *   • значок — два взаимно перпендикулярных вертикальных квадрата со стороной `size`, центр на `base + height`: виден с любой
 *     стороны на уровне глаз; каждый квадрат двусторонний (игра рисует только лицевую грань, поэтому граней вдвое больше);
 *   • «палочка» — такие же два тонких вертикальных ленточных квадрата от верха тела (`POLE_GAP` над ним) до низа значка.
 * Лист метки — атлас 128×64: слева 64×64 — значок, справа — сплошной цвет палочки (`POLE_UV`). Окно рисует этот же набор
 * вершин на кадре, главный процесс отдаёт его нативному хосту, и в игре метка выглядит так же, как в окне.
 *
 * Два других вида метки (06.11.2026) — на том же листе-атласе и в той же команде хоста:
 *   • «своя эмблема» — картинка человека вместо значка: лист 256×128 — слева 128×128 (картинка, вписанная с полем 8 точек,
 *     со своими цветами и прозрачностью), дальше прозрачная полоса, у правого края сплошной цвет палочки (`EMBLEM_POLE_UV`).
 *     Сплошной цвет не примыкает к картинке: на краю метки билинейная фильтрация и ступени не дают цветной каймы. Сетка та
 *     же, что у значка (`buildMarkerMesh`);
 *   • «модель животного» — копия сетки тела самого животного (все его части), залитая одним цветом: `buildModelMarker`.
 *     Копия во всех пропорциях тела, масштаб один на все стороны: длинная сторона — `size` метров (1:1 не годится: кит —
 *     15 м, а метка обязана лежать в шаре видимости модели 17,7 м; курица — 40 см, и с земли она не читалась бы). Висит над
 *     серединой тела, середина копии по высоте — на `base + height`, палочка — от спины до низа копии.
 *
 * Все числа детерминированы: одинаковые настройки дают те же байты.
 */

export const MARKER_ATLAS = Object.freeze({ width: 128, height: 64 });
/*
 * Лист своей эмблемы: плитка картинки 128×128 слева (сама картинка — внутри, с полем `inset`), прозрачная полоса, сплошной цвет
 * палочки с `solid` и до края. Плитка занимает левую половину листа, как у значка (развёртка значка та же).
 */
export const EMBLEM_ATLAS = Object.freeze({ width: 256, height: 128, icon: 128, inset: 8, solid: 192 });
/* Точка сплошной зоны эмблемы: середина полосы 192…256. */
export const EMBLEM_POLE_UV = Object.freeze({ u: 0.875, v: 0.5 });
/* UV сплошной зоны листа (правая половина). */
export const POLE_UV = Object.freeze({ u: 0.75, v: 0.5 });
/* Ширина палочки (метры) и высота, с которой она начинается (над спиной животного). */
export const POLE_GAP = 0.15;
export const POLE_WIDTH = 0.07;

/* «+ 0» — минус-ноль не должен попадать в запрос хосту (одинаковые числа — одинаковый JSON). */
const round4 = (value) => Math.round(value * 10000) / 10000 + 0;

/* Одна вертикальная плоскость через (cx, cy) вдоль единичного направления (dx, dy): четыре вершины, две стороны. */
function planeInto(buffer, [cx, cy], dx, dy, halfWidth, z0, z1, uv) {
  const { positions, uvs, indices } = buffer;
  const first = positions.length / 3;
  const [u0, v0, u1, v1] = uv;
  positions.push(
    cx - dx * halfWidth, cy - dy * halfWidth, z0,
    cx + dx * halfWidth, cy + dy * halfWidth, z0,
    cx + dx * halfWidth, cy + dy * halfWidth, z1,
    cx - dx * halfWidth, cy - dy * halfWidth, z1,
  );
  uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
  /* Спереди и сзади: у обратной стороны порядок вершин развёрнут. */
  indices.push(first, first + 1, first + 2, first, first + 2, first + 3, first, first + 2, first + 1, first, first + 3, first + 2);
}

/* «Палочка»: два тонких вертикальных ленточных квадрата от спины (`foot`) до низа метки; короче 5 см не рисуется. */
function poleInto(buffer, at, foot, bottom, point = POLE_UV) {
  if (bottom <= foot + 0.05) return;
  const poleUv = [point.u, point.v, point.u, point.v];
  planeInto(buffer, at, 1, 0, POLE_WIDTH / 2, foot, bottom, poleUv);
  planeInto(buffer, at, 0, 1, POLE_WIDTH / 2, foot, bottom, poleUv);
}

/**
 * Сетка метки.
 * `positions` — по три числа на вершину, `uvs` — по два (v вниз, как у DirectX), `indices` — тройки вершин; `parts` — сколько
 * вершин и граней у значка и палочки (для проверок и подписи).
 */
export function buildMarkerMesh({ height = 6, size = 1.4, pole = true, base = 0, poleUv = POLE_UV } = {}) {
  const buffer = { positions: [], uvs: [], indices: [] };
  const half = size / 2;
  const centre = base + height;
  const bottom = centre - half;
  const iconUv = [0, 0, 0.5, 1];
  planeInto(buffer, [0, 0], 1, 0, half, bottom, bottom + size, iconUv);
  planeInto(buffer, [0, 0], 0, 1, half, bottom, bottom + size, iconUv);
  const iconVertices = buffer.positions.length / 3;
  const iconTriangles = buffer.indices.length / 3;
  if (pole) poleInto(buffer, [0, 0], base + POLE_GAP, bottom, poleUv);
  const { positions, uvs, indices } = buffer;
  return {
    positions: positions.map(round4),
    uvs: uvs.map(round4),
    indices,
    parts: {
      icon: { vertices: iconVertices, triangles: iconTriangles },
      pole: { vertices: positions.length / 3 - iconVertices, triangles: indices.length / 3 - iconTriangles },
    },
  };
}

/** Больше вершин копии тела метка не берёт: у животных игры их до 9 тысяч, а хост принимает до 20 тысяч. */
export const MODEL_MARKER_MAX_VERTICES = 15000;

/**
 * Габарит частей тела (оси glTF, Y вверх) и масштаб копии: `size` метров на длинную сторону.
 * `parts` — `[{ positions, normals?, indices }]` (плоские массивы чисел). Возвращает `{ min, max, centre, extent, scale,
 * vertices, height }`, где `height` — высота копии в метрах; пустое тело — ошибка.
 */
export function measureModelMarker(parts, size = 2.5) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  for (const part of parts)
    for (let at = 0; at + 2 < part.positions.length; at += 3) {
      vertices += 1;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = part.positions[at + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  if (!vertices) throw new RangeError("У животного нет вершин тела: копию в небо построить не из чего.");
  const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const { scale, height } = modelMarkerSpan(extent, size);
  return {
    min,
    max,
    centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    extent,
    scale,
    vertices,
    height,
  };
}

/**
 * Масштаб и высота копии по габариту тела `extent` (метры, оси glTF) и длинной стороне копии `size`. Окно считает высоту по
 * габариту ответа `readAnimal`, сборка — по вершинам: это одно и то же число (габарит — по тем же вершинам).
 */
export function modelMarkerSpan(extent, size) {
  const longest = Math.max(extent[0], extent[1], extent[2]);
  const scale = longest > 0 ? size / longest : 1;
  return { scale, height: extent[1] * scale };
}

/**
 * Модель животного в небе: копия сетки тела, залитая одним цветом листа (все развёртки — в сплошной цвет палочки).
 *
 * Вход — части тела в осях glTF, как их читает `readDrawable` (RAGE `(x, y, z)` → `(x, z, −y)`); выход — в осях RAGE, как
 * принимает хост. Поворот осей — без зеркала и масштаб положительный, поэтому порядок вершин граней тот же, что в файле игры:
 * копия рисуется так же, как само тело. Нормали — исходные. Копия стоит над серединой тела; её середина по высоте — на
 * `base + height`, палочка идёт от спины (`POLE_GAP` над ней) до низа копии под её серединой.
 */
export function buildModelMarker({ parts = [], height = 6, size = 2.5, pole = true, base = 0 } = {}) {
  const measured = measureModelMarker(parts, size);
  if (measured.vertices > MODEL_MARKER_MAX_VERTICES)
    throw new RangeError(`У тела ${measured.vertices} вершин — копия в небо берёт не больше ${MODEL_MARKER_MAX_VERTICES}.`);
  const { centre, scale } = measured;
  const centreZ = base + height;
  const positions = [];
  const normals = [];
  const indices = [];
  const uvs = [];
  let offset = 0;
  for (const part of parts) {
    const count = Math.floor(part.positions.length / 3);
    for (let vertex = 0; vertex < count; vertex += 1) {
      const gx = part.positions[vertex * 3];
      const gy = part.positions[vertex * 3 + 1];
      const gz = part.positions[vertex * 3 + 2];
      positions.push(round4(centre[0] + (gx - centre[0]) * scale), round4(-(centre[2] + (gz - centre[2]) * scale)), round4(centreZ + (gy - centre[1]) * scale));
      const nx = part.normals?.[vertex * 3] ?? 0;
      const ny = part.normals?.[vertex * 3 + 1] ?? 0;
      const nz = part.normals?.[vertex * 3 + 2] ?? 1;
      normals.push(round4(nx), round4(-nz), round4(ny));
      uvs.push(POLE_UV.u, POLE_UV.v);
    }
    for (let at = 0; at + 2 < part.indices.length; at += 3) indices.push(part.indices[at] + offset, part.indices[at + 1] + offset, part.indices[at + 2] + offset);
    offset += count;
  }
  const bodyVertices = positions.length / 3;
  const bodyTriangles = indices.length / 3;
  const bottom = centreZ - measured.height / 2;
  if (pole) poleInto({ positions, uvs, indices }, [round4(centre[0]), round4(-centre[2])], base + POLE_GAP, bottom);
  /* Нормали палочки — вертикальные плоскости, свет по ним не важен: единица по Y. */
  const poleVertices = positions.length / 3 - bodyVertices;
  for (let vertex = 0; vertex < poleVertices; vertex += 1) normals.push(0, 1, 0);
  return {
    positions: positions.map(round4),
    normals,
    uvs: uvs.map(round4),
    indices,
    scale,
    bottom: round4(bottom),
    top: round4(centreZ + measured.height / 2),
    parts: {
      model: { vertices: bodyVertices, triangles: bodyTriangles },
      pole: { vertices: poleVertices, triangles: indices.length / 3 - bodyTriangles },
    },
  };
}

/** Самая высокая точка метки над корнем — по ней растёт объём модели (рамка видимости). */
export const markerTop = ({ height = 6, size = 1.4, base = 0 } = {}) => base + height + size / 2;

/** Радиус шара видимости модели животного у Rockstar (`.yft`, 12,5·√2): метка за него не выходит. */
export const MODEL_CULL_RADIUS = 17.678;

/* Запас до края шара видимости: на размер значка и округления. */
export const MODEL_SAFE_RADIUS = MODEL_CULL_RADIUS - 1.2;

/**
 * Высота метки в границах шара видимости модели: `base` — верх тела над началом педа. Выше потолка метка пропадала бы из виду
 * вместе с моделью, поэтому высота подрезается; `clamped` говорит об этом окну и пакету.
 */
export function fitMarkerHeight({ height, size }, base, min = 2) {
  const room = MODEL_SAFE_RADIUS - base - size / 2;
  if (height <= room) return { height, clamped: false };
  return { height: Math.max(min, Math.round(room * 10) / 10), clamped: true };
}
