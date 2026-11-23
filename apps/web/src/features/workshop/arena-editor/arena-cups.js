// Кубки зала арены: «места» из описи сервера → экземпляры для кадра, коробки в мире
// и подмена сеток зала подробными сетками из сцены повторов.

// Плоская матрица 4×4 по столбцам: у выходной оси i вклады x, y, z лежат в числах i, i+4, i+8,
// а перенос — в числе i+12.
const STRIDE = 4;
const AXES = [0, 1, 2];

// Часть сцены повторов — объект с идентификатором либо просто строка идентификатора.
function partIs(part, model) {
  return (part?.id ?? part) === model;
}

// Слагаемые складываются слева направо: от порядка зависят последние знаки дробных чисел.
const warp = (m, axis, point, withShift) => {
  const sum = point.map((value, at) => m[axis + STRIDE * at] * value).reduce((left, right) => left + right);
  return withShift ? sum + m[axis + STRIDE * 3] : sum;
};

// Восемь углов коробки: декартово произведение пар «min, max» по трём осям.
function cornersOf(box) {
  let corners = [[]];
  for (const axis of AXES) {
    const pair = [box.min[axis], box.max[axis]];
    corners = corners.flatMap((head) => pair.map((value) => head.concat(value)));
  }
  return corners;
}

// Плоский массив троек, поставленных матрицей. Число троек не округляется:
// хвост «кривой» длины считается по пустым ячейкам.
const carry = (source, count, m, withShift) =>
  Float32Array.from({ length: count * 3 }, (_, at) => {
    const head = at - (at % 3);
    return warp(m, at % 3, [source[head], source[head + 1], source[head + 2]], withShift);
  });

// Копия сетки с положениями и нормалями, поставленными матрицей места.
function restage(mesh, matrix, key) {
  const count = mesh.positions.length / 3;
  const copy = { ...mesh };
  copy.positions = carry(mesh.positions, count, matrix, true);
  copy.normals = mesh.normals ? carry(mesh.normals, count, matrix, false) : null;
  copy.entity = key;
  copy.rayTree = undefined;
  return copy;
}

// Где в описи стоит вещь и какая часть сцены повторов ей соответствует.
const locate = (cups, places, key) => {
  let spot;
  if (cups && places) {
    for (const place of places) {
      if (place[0] === key) {
        spot = place;
        break;
      }
    }
  }
  const partNo = spot && cups.parts != null ? cups.parts.findIndex((part) => partIs(part, spot[1])) : -1;
  return partNo >= 0 ? { partNo, matrix: spot.slice(2) } : null;
};

// Сетки заменяемых вещей: их материалы сдвинуты на число материалов зала.
const stagedMeshes = (shift, cups, places, keys) => {
  const added = [];
  (places || []).forEach((place) => {
    if (!keys.has(place[0])) return;
    for (const mesh of cupMeshes(cups, places, place[0])) {
      mesh.material += shift;
      added.push(mesh);
    }
  });
  return added;
};

function withoutEntities(meshes, added) {
  const gone = added.reduce((seen, mesh) => seen.add(mesh.entity), new Set());
  const kept = [];
  for (const mesh of meshes) if (!gone.has(mesh.entity)) kept.push(mesh);
  return kept;
}

const cupHallKeys = (places) => {
  const found = [];
  if (places) {
    places.forEach((place) => {
      if (Number.isInteger(place[0])) found.push(place[0]);
    });
  }
  return found;
};

const cupInstanceList = (places, asset, hidden = new Set()) => {
  const bins = new Map();
  for (const place of places || []) {
    const [num, model, ...numbers] = place;
    const whole = Number.isInteger(num);
    const bin = bins.get(model) ?? { part: model, numbers: [], keys: [] };
    if (!(whole && hidden.has(num))) {
      numbers.forEach((value) => bin.numbers.push(value));
      bin.keys.push(whole ? num : null);
    }
    if (bin.keys.length) bins.set(model, bin);
  }
  return Array.from(bins, ([, bin]) => ({
    asset,
    part: bin.part,
    matrices: Float32Array.from(bin.numbers),
    keys: bin.keys,
  }));
};

const cupWorldBox = (bounds, matrix) => {
  const lows = [Infinity, Infinity, Infinity];
  const highs = [-Infinity, -Infinity, -Infinity];
  cornersOf(bounds).forEach((corner) => {
    for (const axis of AXES) {
      const value = warp(matrix, axis, corner, true);
      lows[axis] = Math.min(lows[axis], value);
      highs[axis] = Math.max(highs[axis], value);
    }
  });
  return { min: lows, max: highs };
};

const cupBoxes = (places, parts) => {
  const boxes = new Map();
  if (places && parts) {
    [...places].forEach(([num, model, ...matrix]) => {
      const bounds = Number.isInteger(num) ? parts.find((part) => partIs(part, model))?.bounds : undefined;
      if (bounds) boxes.set(num, cupWorldBox(bounds, matrix));
    });
  }
  return boxes;
};

const cupMeshes = (cups, places, key) => {
  const found = locate(cups, places, key);
  if (!found) return [];
  return cups.meshes.flatMap((mesh) => (mesh.part === found.partNo ? [restage(mesh, found.matrix, key)] : []));
};

const cupElementScene = (hall, cups, places, keys) => {
  const added = hall && cups && keys?.size ? stagedMeshes(hall.materials.length, cups, places, keys) : [];
  if (!added.length) return hall;
  return Object.assign({}, hall, {
    meshes: [...withoutEntities(hall.meshes, added), ...added],
    materials: [...hall.materials, ...cups.materials],
  });
};

export { cupHallKeys, cupInstanceList, cupWorldBox, cupBoxes, cupElementScene, cupMeshes };
