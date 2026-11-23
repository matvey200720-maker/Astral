/*
 * Кадр модели по её видимой геометрии (24.10.2026, владелец: «половина моделей подпрыгивает вверх-вниз или вдруг
 * огромная», эталон — рубашка по центру с одинаковыми зазорами).
 *
 * Раньше кадр у каждого места был свой: живой просмотр брал `Box3.setFromObject` по всей сцене GLB, съёмщик одежды —
 * рамку по альфе снимка, обложки стволов — шар или проекцию рамки. Рамка по сцене считает всё, что в ней лежит:
 * уровни детализации (LOD), скрытые узлы, тени-заглушки, вершины без треугольников и вырожденные «иглы», что тянут
 * рамку в сторону — модель смещается, а камера отъезжает или въезжает.
 *
 * Здесь одно правило для всех:
 *  1. точки — только вершины, которые рисуются: видимые меши, высший уровень LOD, материал не скрыт, у индексной
 *     сетки — только вершины невырожденных треугольников;
 *  2. границы — робастные: единичные вершины-иглы далеко от основного тела (дальше целого размаха) в рамку не входят,
 *     а тонкие длинные детали — входят;
 *  3. камера вписывается по проекции самих точек, а не по углам рамки: центр проекции — в центре кадра, зазор с
 *     каждой стороны ограничивающей оси — один и тот же (`FRAME_PAD`); у вращающейся витрины — по шару (`sphereDistance`),
 *     чтобы модель не меняла размер при повороте.
 * Всё — арифметика без WebGL: проверяется в тестах (`model-framing.test.js`).
 */

import * as THREE from "three";

/** Зазор от края кадра до модели, доля стороны кадра с каждой стороны. */
export const FRAME_PAD = 0.1;
/** Сколько вершин с каждого конца считаем «краем» при поиске основного тела. */
const BODY_QUANTILE = 0.005;
/** На сколько размаха тела (в долях) за его краем ещё считается своей частью модели: ствол снайперки, антенна и ремень
    сумки — настоящая геометрия, она в кадр обязана войти. */
const BODY_SLACK = 1;
/** Выброс — только если вершин за этим пределом меньше этой доли (но не меньше `FAR_MIN`): целая деталь — не мусор. */
const FAR_SHARE = 0.001;
const FAR_MIN = 2;
/** Пол допуска у плоских осей (доля большего размаха): у пластины размах по тонкой оси равен нулю. */
const FLAT_SLACK = 0.02;
/** Больше точек для кадра не нужно: лишние прореживаются шагом. */
const MAX_POINTS = 60000;
/** Квадрат длины векторного произведения (удвоенная площадь), ниже которого треугольник вырожден. */
const DEGENERATE = 1e-20;
/** Имя узла или меша уровня детализации ниже первого: «x_lod1», «LOD2», «mesh_l3». */
const LOD_NAME = /(^|[^a-z0-9])lod[\s_-]?[1-9]|_l[1-9]$/i;

const hiddenMaterial = (material) =>
  !material || material.visible === false || (material.transparent && material.opacity === 0);

/** Меш рисуется: хотя бы один его материал не скрыт и не прозрачен целиком. */
const drawn = (mesh) => {
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return list.some((material) => !hiddenMaterial(material));
};

/** Точки меша в мировых осях: только вершины невырожденных треугольников (без индекса — все). */
function meshPoints(mesh) {
  const geometry = mesh.geometry;
  const position = geometry?.attributes?.position;
  if (!position) return [];
  const skinned = Boolean(mesh.isSkinnedMesh && mesh.skeleton);
  if (skinned) mesh.skeleton.update();
  const out = [];
  const point = new THREE.Vector3();
  const take = (index) => {
    if (skinned) mesh.getVertexPosition(index, point);
    else point.fromBufferAttribute(position, index);
    if (!Number.isFinite(point.x + point.y + point.z)) return false;
    point.applyMatrix4(mesh.matrixWorld);
    out.push(point.x, point.y, point.z);
    return true;
  };
  const index = geometry.index;
  if (!index) {
    for (let at = 0; at < position.count; at += 1) take(at);
    return out;
  }
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const used = new Uint8Array(position.count);
  for (let at = 0; at + 2 < index.count; at += 3) {
    const ia = index.getX(at);
    const ib = index.getX(at + 1);
    const ic = index.getX(at + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib).sub(a);
    c.fromBufferAttribute(position, ic).sub(a);
    if (b.cross(c).lengthSq() < DEGENERATE) continue;
    used[ia] = 1;
    used[ib] = 1;
    used[ic] = 1;
  }
  for (let at = 0; at < used.length; at += 1) if (used[at]) take(at);
  return out;
}

/**
 * Видимые точки модели в мировых осях: плоский `Float32Array` (x, y, z, …). Пустая модель — пустой массив.
 * `root` — любой `Object3D` (сцена GLB, группа одежды).
 */
export function visiblePoints(root) {
  root.updateMatrixWorld(true);
  const chunks = [];
  const visit = (object) => {
    if (!object.visible) return;
    if (object.isLOD) {
      /* У LOD первый уровень — самый подробный: остальные рисуются только издали. */
      const first = object.levels?.[0]?.object;
      if (first) visit(first);
      return;
    }
    if (LOD_NAME.test(object.name || "")) return;
    if (object.isMesh && !object.isInstancedMesh && drawn(object)) chunks.push(meshPoints(object));
    for (const child of object.children) visit(child);
  };
  visit(root);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const stride = Math.max(1, Math.ceil(total / 3 / MAX_POINTS));
  const points = new Float32Array(Math.ceil(total / 3 / stride) * 3);
  let at = 0;
  let seen = 0;
  for (const chunk of chunks)
    for (let i = 0; i < chunk.length; i += 3) {
      if (seen % stride === 0) {
        points[at] = chunk[i];
        points[at + 1] = chunk[i + 1];
        points[at + 2] = chunk[i + 2];
        at += 3;
      }
      seen += 1;
    }
  return points.subarray(0, at);
}

/**
 * Робастные границы точек: `{ box, center, size, radius, kept, dropped }` или `null`, если точек нет. Основное тело —
 * между краевыми квантилями; всё, что дальше целого размаха тела за его краем и состоит из считанных вершин (меньше
 * 0,1 %), — иглы-мусор, в рамку не входит. Длинная тонкая деталь (ствол, антенна, ремень) — настоящая геометрия:
 * она либо ближе целого размаха, либо вершин в ней больше, и тогда рамка берёт всё. `radius` — шар вокруг центра
 * рамки, вмещающий оставшиеся точки.
 */
export function robustBounds(points) {
  const count = Math.floor(points.length / 3);
  if (!count) return null;
  const low = [0, 0, 0];
  const high = [0, 0, 0];
  const spread = [0, 0, 0];
  const quantile = new Float32Array(count);
  for (let axis = 0; axis < 3; axis += 1) {
    for (let at = 0; at < count; at += 1) quantile[at] = points[at * 3 + axis];
    quantile.sort();
    low[axis] = quantile[Math.floor(BODY_QUANTILE * (count - 1))];
    high[axis] = quantile[Math.ceil((1 - BODY_QUANTILE) * (count - 1))];
    spread[axis] = high[axis] - low[axis];
  }
  const widest = Math.max(...spread, 1e-6);
  const slack = spread.map((value) => BODY_SLACK * value + FLAT_SLACK * widest);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const isFar = (at) => {
    point.fromArray(points, at * 3);
    return (
      point.x < low[0] - slack[0] || point.x > high[0] + slack[0] ||
      point.y < low[1] - slack[1] || point.y > high[1] + slack[1] ||
      point.z < low[2] - slack[2] || point.z > high[2] + slack[2]
    );
  };
  let far = 0;
  for (let at = 0; at < count; at += 1) if (isFar(at)) far += 1;
  /* Дальних вершин много — это целая деталь, а не иглы: берём всё. */
  const dropFar = far > 0 && far <= Math.max(FAR_MIN, Math.floor(FAR_SHARE * count));
  let kept = 0;
  for (let at = 0; at < count; at += 1) {
    if (dropFar && isFar(at)) continue;
    point.fromArray(points, at * 3);
    box.expandByPoint(point);
    kept += 1;
  }
  const center = box.getCenter(new THREE.Vector3());
  let radius = 0;
  for (let at = 0; at < count; at += 1) {
    point.fromArray(points, at * 3);
    if (!box.containsPoint(point)) continue;
    radius = Math.max(radius, point.distanceTo(center));
  }
  return { box, center, size: box.getSize(new THREE.Vector3()), radius, kept, dropped: count - kept };
}

/** Видимые границы модели одним вызовом: `visiblePoints` + `robustBounds`. */
export function visibleBounds(root) {
  const points = visiblePoints(root);
  const bounds = robustBounds(points);
  return bounds ? { ...bounds, points } : null;
}

/**
 * Расстояние до камеры для вращающейся витрины: шар радиуса `radius` с зазором `pad` вписан в кадр любого
 * соотношения сторон, модель не меняет размер при повороте.
 */
export function sphereDistance(radius, { fov = 26, aspect = 1, pad = FRAME_PAD } = {}) {
  const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * Math.min(1, aspect));
  return radius / Math.sin(half) / (1 - 2 * pad);
}

/** Подъём камеры живой витрины над целью: чуть сверху, как в `WeaponModelViewer`. */
const liftOf = (distance) => Math.min(0.38, distance * 0.055);
const TURNS = 24;

/*
 * Точки для проекции: прореженная выборка и, чтобы крайние точки (кончик ремня, дуло, шнурок) не пропали между шагами, —
 * самая дальняя точка по каждому из 74 направлений: 24 поворота вокруг вертикали на три высоты и вверх с вниз.
 */
const DIRECTIONS = [
  [0, 1, 0],
  [0, -1, 0],
  ...Array.from({ length: TURNS }, (_, at) => {
    const angle = (at * Math.PI * 2) / TURNS;
    return [-1, 0, 1].map((rise) => [Math.cos(angle), rise, Math.sin(angle)]);
  }).flat(),
];
function projectionSample(points, limit) {
  const count = Math.floor(points.length / 3);
  const stride = Math.max(1, Math.floor(count / limit));
  const keep = new Set();
  for (let at = 0; at < count; at += stride) keep.add(at);
  if (stride > 1)
    for (const [dx, dy, dz] of DIRECTIONS) {
      let best = -Infinity;
      let index = 0;
      for (let at = 0; at < count; at += 1) {
        const dot = points[at * 3] * dx + points[at * 3 + 1] * dy + points[at * 3 + 2] * dz;
        if (dot > best) {
          best = dot;
          index = at;
        }
      }
      keep.add(index);
    }
  const picked = new Float32Array(keep.size * 3);
  let at = 0;
  for (const index of keep) {
    picked[at] = points[index * 3];
    picked[at + 1] = points[index * 3 + 1];
    picked[at + 2] = points[index * 3 + 2];
    at += 3;
  }
  return picked;
}

/**
 * Камера для витрины, что вращается: `{ distance, targetY }` или `{ distance: 0, targetY: 0 }` без точек. На любом из 24
 * поворотов вокруг вертикали (`points` — вокруг начала координат) модель целиком в кадре и занимает не больше `1 − 2·pad`
 * полукадра; камера стоит на `(0, targetY + lift, distance)` и смотрит в `(0, targetY, 0)`. `targetY` сдвигает цель так, чтобы
 * центр проекции по вертикали ходил вокруг середины кадра поровну вверх и вниз (наклон камеры сверху иначе уводит высокие вещи —
 * сумку с ремнём — к нижнему краю). Размер не пульсирует сильнее, чем позволяет сама форма: длинный ствол анфас меньше, чем сбоку,
 * но сбоку он не вылезает. Шар (`sphereDistance`) для вытянутых моделей ужимает их втрое, поэтому считается проекция точек.
 */
export function fitRotating(points, { fov = 34, aspect = 1, pad = FRAME_PAD, lift = liftOf } = {}) {
  if (!Math.floor(points.length / 3)) return { distance: 0, targetY: 0 };
  const picked = projectionSample(points, 1500);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanH = tanV * aspect;
  const turns = Array.from({ length: TURNS }, (_, at) => [Math.cos((at * Math.PI * 2) / TURNS), Math.sin((at * Math.PI * 2) / TURNS)]);
  /* Проекция всех поворотов при расстоянии `distance` и цели на высоте `shift`: самый дальний от центра край и вертикальный размах. */
  const measure = (distance, shift) => {
    const height = lift(distance);
    const length = Math.hypot(height, distance);
    /* Взгляд из (0, height, distance) в начало: вперёд (0, −height, −distance)/длина, вверх (0, distance, −height)/длина. */
    const forwardY = -height / length;
    const forwardZ = -distance / length;
    const upY = distance / length;
    const upZ = -height / length;
    let worst = 0;
    /* Центр проекции по вертикали на каждом повороте: пока модель вращается, он ходит вверх и вниз — «подпрыгивает». */
    let centreHigh = -Infinity;
    let centreLow = Infinity;
    for (const [cos, sin] of turns) {
      let top = -Infinity;
      let bottom = Infinity;
      for (let at = 0; at < picked.length; at += 3) {
        const x = picked[at] * cos + picked[at + 2] * sin;
        const z = -picked[at] * sin + picked[at + 2] * cos;
        const y = picked[at + 1] - shift - height;
        const zz = z - distance;
        const depth = y * forwardY + zz * forwardZ;
        if (depth <= 1e-6) return { worst: Infinity, centre: 0 };
        const up = (y * upY + zz * upZ) / (depth * tanV);
        worst = Math.max(worst, Math.abs(x) / (depth * tanH), Math.abs(up));
        top = Math.max(top, up);
        bottom = Math.min(bottom, up);
      }
      centreHigh = Math.max(centreHigh, (top + bottom) / 2);
      centreLow = Math.min(centreLow, (top + bottom) / 2);
    }
    return { worst, centre: (centreHigh + centreLow) / 2 };
  };
  const wanted = 1 - 2 * pad;
  let radius = 0;
  for (let at = 0; at < picked.length; at += 3) radius = Math.max(radius, Math.hypot(picked[at], picked[at + 1], picked[at + 2]));
  const solve = (shift) => {
    let near = Math.max(radius * 1.001, 1e-3);
    let far = Math.max(near * 2, 1e-3);
    while (measure(far, shift).worst > wanted && far < radius * 1e4) far *= 2;
    for (let step = 0; step < 22; step += 1) {
      const middle = (near + far) / 2;
      if (measure(middle, shift).worst > wanted) near = middle;
      else far = middle;
    }
    return far;
  };
  let targetY = 0;
  let distance = solve(targetY);
  for (let round = 0; round < 4; round += 1) {
    const middle = measure(distance, targetY).centre;
    if (!Number.isFinite(middle) || Math.abs(middle) < 0.004) break;
    targetY += middle * tanV * distance;
    distance = solve(targetY);
  }
  return { distance, targetY };
}

const ndcOf = (camera, points, bounds) => {
  camera.updateMatrixWorld(true);
  const view = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const point = new THREE.Vector3();
  for (let at = 0; at < points.length; at += 3) {
    point.fromArray(points, at);
    if (bounds && !bounds.box.containsPoint(point)) continue;
    point.project(camera);
    if (point.x < view.minX) view.minX = point.x;
    if (point.x > view.maxX) view.maxX = point.x;
    if (point.y < view.minY) view.minY = point.y;
    if (point.y > view.maxY) view.maxY = point.y;
  }
  return view;
};

/**
 * Камера для обложки: смотрит на модель вдоль `direction` (откуда смотрит), вписана по проекции самих точек.
 * Центр проекции — в центре кадра, большая сторона занимает `1 − 2·pad` кадра, зазор с обеих сторон этой оси один.
 * Ответ: `{ position, target, near, far, fov, aspect, view }`; `view` — проекция в долях полукадра (−1…1) для проверки.
 */
export function fitView(bounds, { direction, up = new THREE.Vector3(0, 1, 0), fov = 26, aspect = 1, pad = FRAME_PAD } = {}) {
  const heading = direction.clone().normalize();
  const target = bounds.center.clone();
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.001, 1000);
  camera.up.copy(up);
  const wanted = 1 - 2 * pad;
  let distance = sphereDistance(bounds.radius, { fov, aspect, pad });
  let view = null;
  for (let step = 0; step < 8; step += 1) {
    camera.position.copy(target).addScaledVector(heading, distance);
    camera.lookAt(target);
    camera.near = Math.max(0.001, distance - bounds.radius * 2);
    camera.far = distance + bounds.radius * 2;
    camera.updateProjectionMatrix();
    view = ndcOf(camera, bounds.points, bounds);
    const shiftX = (view.minX + view.maxX) / 2;
    const shiftY = (view.minY + view.maxY) / 2;
    const reach = Math.max((view.maxX - view.minX) / 2, (view.maxY - view.minY) / 2, 1e-6);
    if (Math.abs(shiftX) < 1e-3 && Math.abs(shiftY) < 1e-3 && Math.abs(reach - wanted) < 1e-3) break;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const above = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * distance;
    target.addScaledVector(right, shiftX * halfHeight * aspect).addScaledVector(above, shiftY * halfHeight);
    distance *= reach / wanted;
  }
  return { position: camera.position.clone(), target, near: camera.near, far: camera.far, fov, aspect, view };
}
