/*
 * Геометрия штатного ангара — общая у подготовки набора, кадра и установщика
 * (Ангар стандартный, ТЗ 12.10.2026, ночь).
 *
 * Модель нутра ограблений `hei_ap1_01_c_sthbld3_int` (и её сюжетный двойник
 * `ap1_01_c_sthbld3_int`) — одна модель на всё, что внутри: колонны со
 * связями, галерея с лестницами, комната, трубы, кран и 16 потолочных ламп.
 * Чтобы фермы и кран выключались переключателем, её треугольники делятся на
 * части по связным кускам сетки:
 *
 *   фермы    — куски листа балок (`gz_v_ah_metalbeams`), что целиком выше
 *              низа ферм (`trussFloor`, оси модели, Z вверх): пояса и
 *              раскосы пространственной фермы под крышей. Колонны и связи
 *              стен начинаются у пола или у галереи — они остаются;
 *   кран     — всё на листе крана (`gz_v_ah_crane`): пути под нижним поясом
 *              ферм, два моста, тележки, тросы и крюки. Кран висит на
 *              фермах — без ферм его нет;
 *   подвесы  — тонкие стойки на том же листе крана над каждой лампой: на них
 *              лампы висят под нижним поясом ферм. Без ферм они тянутся до
 *              крыши (`roof` описи), и лампы висят на крыше, а не в воздухе;
 *   остальное — нутро, остаётся всегда.
 *
 * Ангар стандартный (ТЗ 13.10.2026; владелец: «добавь функционал, чтобы
 * человек мог отключать те как бы железяки»): ещё четыре части.
 *
 *   вентиляция — короба под крышей (`gz_v_ct_ventpipe`, весь лист): висят
 *                на фермах, без ферм их нет — как крана;
 *   галерея    — настил, линолеум, ступени, пластина на настиле (листы
 *                `gallery` описи) и тонкие стойки под лестницами на листе
 *                балок (стоят в плане лестницы). Перила — отдельная модель
 *                (`ap1_01_c_sthbld3_intc`), она уходит целиком;
 *   связи      — косые связи между колоннами стен (куски листа балок ниже
 *                ферм: в плане длиннее 2 м, по высоте — 3 м) и пластины на
 *                их перекрестьях. Колонны остаются: на них фермы, галерея и
 *                трубы;
 *   трубы      — синие трубы на стенах (`gz_v_ah_pipeblue` детали) и их
 *                заглушки в нутре (`gz_ng_blue_ah_metalbeams`).
 *
 * Лампы убираются совсем (ТЗ 17.10.2026): плафоны и лампочки нутра
 * (`lampSheets` описи) и фонари на стенах детали (`wallLamps`: головы,
 * лампочки, стёкла и чёрные кронштейны) — своя часть; подвесы над лампами
 * уходят вместе с ними.
 *
 * Корпус (`hangarShellLabels`): каждая грань — снаружи, внутри или пол;
 * по этой метке накладки поверх стен (потёки ржавчины, светлые трапеции
 * гофры, грязь у земли, пятна пола и крыши) уходят с крашеной стороны.
 *
 * Точки — как их отдаёт `readDrawable` (Y вверх): точка игры `[x, −z, y]`.
 */

/* Метки треугольников модели нутра. */
export const HANGAR_INTERIOR_PART = Object.freeze({
  keep: 0,
  trusses: 1,
  crane: 2,
  rods: 3,
  /* Ангар стандартный (ТЗ 13.10.2026): железяки нутра переключателями. */
  vents: 4,
  gallery: 5,
  bracing: 6,
  pipes: 7,
  /* Лампы убираются совсем (ТЗ 17.10.2026; владелец: «чтобы лампы из
     ангара тоже можно было убирать»): плафоны и лампочки нутра, фонари на
     стенах детали с кронштейнами и стёклами. Подвесы над лампами — `rods`. */
  lamps: 8,
});
const PART_NAMES = Object.freeze(
  Object.entries(HANGAR_INTERIOR_PART)
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name),
);

/* Подвес — тонкая стойка: не толще 30 см, не короче метра. */
const ROD_WIDTH = 0.3;
const ROD_LENGTH = 1;
/* Насколько ось подвеса может разойтись с описью, м. */
const ROD_SLACK = 0.3;
/* Вершины ближе 1 см сводятся в одну: куски сетки Rockstar режет швами развёртки. */
const WELD = 100;
/* Лестница галереи — кусок её листа выше 5 м; стойка под ней — не толще 30 см. */
const STAIR_HEIGHT = 5;
const STAIR_POST = 0.3;
const STAIR_SLACK = 0.3;
/* Косая связь: в плане длиннее 2 м, по высоте — 3 м. */
const BRACE_SPAN = 2;
const BRACE_RISE = 3;
/* Пластина перекрестья: не больше 1,2 м, у середины связи (доля 0,2…0,8 её
   оси) и ближе 0,5 м к оси. */
const GUSSET_SIZE = 1.2;
const GUSSET_REACH = 0.5;

/** Метка грани корпуса: снаружи 1, внутри 2, пол 3 (`normal` — нормаль, `middle` — середина грани от центра корпуса). */
export function hangarFaceLabel(normal, middle, halfHeight) {
  if (normal[0] * middle[0] + normal[1] * middle[1] + normal[2] * middle[2] > 0)
    return 1;
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  if (normal[2] / length > 0.9 && middle[2] < -halfHeight + 1.5) return 3;
  return 2;
}

/*
 * Связные куски сетки: вершины одного треугольника и вершины в одной точке
 * (с точностью до сантиметра) — один кусок. У каждого — рамка в осях игры
 * (Z вверх) и список своих треугольников.
 */
export function meshPieces(mesh) {
  const count = mesh.positions.length / 3;
  const parent = new Int32Array(count);
  for (let index = 0; index < count; index += 1) parent[index] = index;
  const find = (index) => {
    let at = index;
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]];
      at = parent[at];
    }
    return at;
  };
  const join = (a, b) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent[left] = right;
  };
  const seen = new Map();
  for (let index = 0; index < count; index += 1) {
    const key = `${Math.round(mesh.positions[index * 3] * WELD)},${Math.round(mesh.positions[index * 3 + 1] * WELD)},${Math.round(mesh.positions[index * 3 + 2] * WELD)}`;
    const other = seen.get(key);
    if (other === undefined) seen.set(key, index);
    else join(index, other);
  }
  for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
    join(mesh.indices[at], mesh.indices[at + 1]);
    join(mesh.indices[at], mesh.indices[at + 2]);
  }
  const pieces = new Map();
  for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
    const root = find(mesh.indices[at]);
    let piece = pieces.get(root);
    if (!piece)
      pieces.set(
        root,
        (piece = {
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
          triangles: [],
          vertices: new Set(),
        }),
      );
    piece.triangles.push(at / 3);
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[at + corner];
      piece.vertices.add(vertex);
      /* Y вверх → Z вверх: [x, −z, y]. */
      const point = [
        mesh.positions[vertex * 3],
        -mesh.positions[vertex * 3 + 2],
        mesh.positions[vertex * 3 + 1],
      ];
      for (let axis = 0; axis < 3; axis += 1) {
        if (point[axis] < piece.min[axis]) piece.min[axis] = point[axis];
        if (point[axis] > piece.max[axis]) piece.max[axis] = point[axis];
      }
    }
  }
  return [...pieces.values()];
}

/* Тонкая отвесная стойка (кусок сетки). */
export const isHangarRod = (piece) =>
  piece.max[0] - piece.min[0] <= ROD_WIDTH &&
  piece.max[1] - piece.min[1] <= ROD_WIDTH &&
  piece.max[2] - piece.min[2] >= ROD_LENGTH;

/* Подвес описи, к которому относится стойка, или `null`. */
function rodOf(piece, rods) {
  const x = (piece.min[0] + piece.max[0]) / 2;
  const y = (piece.min[1] + piece.max[1]) / 2;
  return (
    rods.find(
      (rod) =>
        Math.abs(rod.x - x) <= ROD_SLACK &&
        Math.abs(rod.y - y) <= ROD_SLACK &&
        Math.abs(rod.top - piece.max[2]) <= ROD_SLACK,
    ) || null
  );
}

/* Листы описи строчными: строка или список. */
const sheetSet = (value) =>
  new Set(
    (Array.isArray(value) ? value : value ? [value] : []).map((item) =>
      String(item).toLowerCase(),
    ),
  );

/* Точка вершины в осях игры (Z вверх). */
const pointOf = (mesh, vertex) => [
  mesh.positions[vertex * 3],
  -mesh.positions[vertex * 3 + 2],
  mesh.positions[vertex * 3 + 1],
];

/* Ось косой связи: самая низкая и самая высокая вершина куска. */
function braceAxis(mesh, piece) {
  let low = null;
  let high = null;
  for (const vertex of piece.vertices) {
    const point = pointOf(mesh, vertex);
    if (!low || point[2] < low[2]) low = point;
    if (!high || point[2] > high[2]) high = point;
  }
  return [low, high];
}

/* Расстояние от точки до оси связи и доля вдоль неё (0 — низ, 1 — верх). */
function axisDistance(point, [a, b]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const t =
    ((point[0] - a[0]) * d[0] +
      (point[1] - a[1]) * d[1] +
      (point[2] - a[2]) * d[2]) /
    length;
  const near = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
  return {
    t,
    distance: Math.hypot(
      point[0] - near[0],
      point[1] - near[1],
      point[2] - near[2],
    ),
  };
}

const middleOf = (piece) => [
  (piece.min[0] + piece.max[0]) / 2,
  (piece.min[1] + piece.max[1]) / 2,
  (piece.min[2] + piece.max[2]) / 2,
];

/* Тонкая стойка под лестницей галереи: в плане лестницы и не выше её верха. */
function isStairPost(piece, stairs) {
  if (
    piece.max[0] - piece.min[0] > STAIR_POST ||
    piece.max[1] - piece.min[1] > STAIR_POST
  )
    return false;
  const [x, y] = middleOf(piece);
  return stairs.some(
    (stair) =>
      x >= stair.min[0] - STAIR_SLACK &&
      x <= stair.max[0] + STAIR_SLACK &&
      y >= stair.min[1] - STAIR_SLACK &&
      y <= stair.max[1] + STAIR_SLACK &&
      piece.max[2] <= stair.max[2] + STAIR_SLACK,
  );
}

const isBrace = (piece) =>
  Math.hypot(piece.max[0] - piece.min[0], piece.max[1] - piece.min[1]) >=
    BRACE_SPAN && piece.max[2] - piece.min[2] >= BRACE_RISE;

function isGusset(piece, axes) {
  if (
    piece.max[0] - piece.min[0] > GUSSET_SIZE ||
    piece.max[1] - piece.min[1] > GUSSET_SIZE ||
    piece.max[2] - piece.min[2] > GUSSET_SIZE
  )
    return false;
  const middle = middleOf(piece);
  return axes.some((axis) => {
    const { t, distance } = axisDistance(middle, axis);
    return t >= 0.2 && t <= 0.8 && distance <= GUSSET_REACH;
  });
}

/**
 * Части модели нутра (и детали со стенными трубами): `meshes` — сетки
 * `readDrawable`, `sheetOf(mesh)` — лист цвета сетки строчными, `interior`
 * — опись (`beams`, `crane`, `trussFloor`, `rods`, `vents`, `gallery`,
 * `pipes`, `lampSheets`, `wallLamps`). Ответ — `[{ labels: Uint8Array (метка треугольника), rods:
 * Map(вершина → подвес описи) }]` по сеткам; `counts` — треугольников по
 * частям (`HANGAR_INTERIOR_PART`).
 */
export function hangarInteriorParts(meshes, sheetOf, interior) {
  const counts = Object.fromEntries(PART_NAMES.map((name) => [name, 0]));
  const sheets = meshes.map((mesh) =>
    String(sheetOf(mesh) || "").toLowerCase(),
  );
  const vents = sheetSet(interior?.vents);
  const gallery = sheetSet(interior?.gallery);
  const pipes = sheetSet(interior?.pipes);
  const lamps = sheetSet([
    ...(interior?.lampSheets || []),
    ...(interior?.wallLamps || []),
  ]);
  const cache = new Map();
  const piecesOf = (index) => {
    if (!cache.has(index)) cache.set(index, meshPieces(meshes[index]));
    return cache.get(index);
  };
  /* Лестницы галереи — высокие куски её листов. */
  const stairs = [];
  sheets.forEach((sheet, index) => {
    if (gallery.has(sheet))
      for (const piece of piecesOf(index))
        if (piece.max[2] - piece.min[2] >= STAIR_HEIGHT) stairs.push(piece);
  });
  const out = meshes.map((mesh) => ({
    labels: new Uint8Array(mesh.indices.length / 3),
    rods: new Map(),
  }));
  const mark = (index, piece, label) => {
    for (const triangle of piece.triangles) out[index].labels[triangle] = label;
  };
  /* Балки: фермы, стойки лестниц, косые связи; пластины перекрестий — после
     всех связей (связь и её пластина бывают в разных сетках). */
  const braceAxes = [];
  const loose = [];
  sheets.forEach((sheet, index) => {
    const mesh = meshes[index];
    if (sheet === interior?.beams) {
      for (const piece of piecesOf(index)) {
        if (piece.min[2] >= interior.trussFloor)
          mark(index, piece, HANGAR_INTERIOR_PART.trusses);
        else if (isStairPost(piece, stairs))
          mark(index, piece, HANGAR_INTERIOR_PART.gallery);
        else if (isBrace(piece)) {
          mark(index, piece, HANGAR_INTERIOR_PART.bracing);
          braceAxes.push(braceAxis(mesh, piece));
        } else loose.push([index, piece]);
      }
    } else if (sheet === interior?.crane) {
      for (const piece of piecesOf(index)) {
        const rod = isHangarRod(piece)
          ? rodOf(piece, interior.rods || [])
          : null;
        mark(
          index,
          piece,
          rod ? HANGAR_INTERIOR_PART.rods : HANGAR_INTERIOR_PART.crane,
        );
        if (rod)
          for (const vertex of piece.vertices) out[index].rods.set(vertex, rod);
      }
    } else if (lamps.has(sheet))
      out[index].labels.fill(HANGAR_INTERIOR_PART.lamps);
    else if (vents.has(sheet))
      out[index].labels.fill(HANGAR_INTERIOR_PART.vents);
    else if (gallery.has(sheet))
      out[index].labels.fill(HANGAR_INTERIOR_PART.gallery);
    else if (pipes.has(sheet))
      out[index].labels.fill(HANGAR_INTERIOR_PART.pipes);
  });
  for (const [index, piece] of loose)
    if (isGusset(piece, braceAxes))
      mark(index, piece, HANGAR_INTERIOR_PART.bracing);
  for (const { labels } of out)
    for (const label of labels) counts[PART_NAMES[label]] += 1;
  return { meshes: out, counts };
}

/* Сторона по метке грани корпуса: 1 снаружи, 2 внутри, 3 пол. */
export const HANGAR_FACE_SURFACES = Object.freeze([
  null,
  "outside",
  "inside",
  "floor",
]);

/**
 * Стороны граней корпуса по всей модели (Ангар стандартный, ТЗ 13.10.2026):
 * центр и полувысота — по рамке всех её сеток (оси игры, Z вверх), как у
 * подготовки набора и установщика. `[Uint8Array]` по сеткам — метка
 * `hangarFaceLabel` у каждой грани; вырожденная грань — 0.
 */
export function hangarShellLabels(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes)
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
      const point = pointOf(mesh, vertex);
      for (let axis = 0; axis < 3; axis += 1) {
        if (point[axis] < min[axis]) min[axis] = point[axis];
        if (point[axis] > max[axis]) max[axis] = point[axis];
      }
    }
  const centre = min.map((value, axis) => (value + max[axis]) / 2);
  const halfHeight = (max[2] - min[2]) / 2;
  return meshes.map((mesh) => {
    const labels = new Uint8Array(mesh.indices.length / 3);
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const p = [0, 1, 2].map((k) => pointOf(mesh, mesh.indices[at + k]));
      const e1 = p[1].map((value, axis) => value - p[0][axis]);
      const e2 = p[2].map((value, axis) => value - p[0][axis]);
      const normal = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      if (!Math.hypot(...normal)) continue;
      const middle = [0, 1, 2].map(
        (axis) => (p[0][axis] + p[1][axis] + p[2][axis]) / 3 - centre[axis],
      );
      labels[at / 3] = hangarFaceLabel(normal, middle, halfHeight);
    }
    return labels;
  });
}

/*
 * Модель разметки пола (`*_sthbld3_lines`, ТЗ 17.10.2026): плоские наклейки
 * у самого пола — линии и знаки и (у сетевой карты) грязь с разводами.
 * Рамка модели плоская, и стороны корпуса по ней не понять: грань, что
 * смотрит вверх, — пол (3), остальное — стены изнутри (2).
 */
export function hangarLinesLabels(meshes) {
  return meshes.map((mesh) => {
    const labels = new Uint8Array(mesh.indices.length / 3);
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const p = [0, 1, 2].map((k) => pointOf(mesh, mesh.indices[at + k]));
      const e1 = p[1].map((value, axis) => value - p[0][axis]);
      const e2 = p[2].map((value, axis) => value - p[0][axis]);
      const normal = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const length = Math.hypot(...normal);
      if (!length) continue;
      labels[at / 3] = Math.abs(normal[2]) / length > 0.7 ? 3 : 2;
    }
    return labels;
  });
}

/* Лист линий и знаков разметки (а не грязи той же модели). */
export const isHangarMarking = (sheet) =>
  /^gz_v_(ah|cf)_(line|marking)/.test(String(sheet || "").toLowerCase());

/**
 * Высота вершины подвеса без ферм (оси модели, Z вверх): верх стойки
 * тянется до крыши, низ (у лампы) остаётся. `z` — высота вершины.
 */
export const hangarRodHeight = (rod, z) => (z >= rod.top - 0.02 ? rod.roof : z);
