/*
 * Метки залазов на настоящих местах карты — расстановка и плашки (задача 26 ТЗ 19.10.2026).
 *
 * Файл места (`<место>.markers.json`, `scripts/prepare-climb-places.mjs`) — те места расстановки мода
 * (`climbs.ymap`), что попали в круг места: метка, точка, поворот и масштаб — как их ставит игра
 * (`placements.js`), и признак «стоит на стене или земле из игры» (`shown`): метки над постройками чужой
 * карты в кадре висели бы в воздухе, и их не рисуют. Здесь они разбираются и каждой метке выдаётся плашка: четырёхугольник лицевой
 * грани в мире — тот же, что соберёт установщик (`climbMarkerLayout(...).quad`: лицо в координатах
 * u вправо, v вверх, ось и сторона модели), поставленный на место поворотом и масштабом расстановки.
 *
 * Чистые данные и геометрия — без React; `three` только для матриц и буфера вершин.
 */

import * as THREE from "three";

/** Файл расстановки места → `{ origin, items: [{ model, position, rotation, scale }] }`. Бросает на чужом файле. */
export function parseClimbMarkers(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.items) || data.origin?.length !== 3) throw new Error("Файл расстановки — не залазов.");
  return {
    id: String(data.id || ""),
    origin: data.origin.map(Number),
    items: data.items.map((item) => {
      if (!Array.isArray(item) || item.length < 10) throw new Error("Запись расстановки обрезана.");
      return {
        model: String(item[0]),
        position: [item[1], item[2], item[3]],
        rotation: [item[4], item[5], item[6], item[7]],
        scale: [item[8], item[9]],
        shown: item[10] !== 0,
        lift: Number.isFinite(item[11]) ? item[11] : PLATE_LIFT,
      };
    }),
  };
}

/** Показываемые метки по моделям: `Map` модель → список (без тех, что в игре висят в воздухе). */
export function markersByModel(markers) {
  const out = new Map();
  for (const item of markers.items) {
    if (!item.shown) continue;
    if (!out.has(item.model)) out.set(item.model, []);
    out.get(item.model).push(item);
  }
  return out;
}

/*
 * Координаты лица → оси модели — как у хоста (`overlaps.js`): u вправо, v вверх перед лицом; для лица в +Z
 * и в −Y вправо — это +X, для лица в +Y и в −Z — −X.
 */
function faceToModel({ axis, facing }, u, v, depth, out) {
  const mirror = (axis === "z" && facing < 0) || (axis === "y" && facing > 0);
  const x = mirror ? -u : u;
  return axis === "z" ? out.set(x, v, depth) : out.set(x, depth, v);
}

/*
 * Плашка стоит чуть перед поверхностью (метры): стена в кадре — ужатая сетка игры, она расходится с настоящей
 * на сантиметры и дециметры. Сколько именно, снимает скрипт места у каждой метки (`lift`); это — запас, если
 * файл его не несёт.
 */
export const PLATE_LIFT = 0.06;

const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/**
 * Плашки меток одной модели в одном буфере: `quad` — лицевой четырёхугольник метки (`climbMarkerLayout`),
 * `items` — её места. Развёртка — по плашке: верх картинки у `maxY`. Лицо смотрит туда, куда у метки мода
 * (`facing` вдоль оси, повёрнутое расстановкой), — с другой стороны плашки не видно.
 */
export function plateGeometry(quad, items) {
  const positions = new Float32Array(items.length * 12);
  const uvs = new Float32Array(items.length * 8);
  const indices = new Uint32Array(items.length * 6);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const width = quad.maxX - quad.minX;
  const height = quad.maxY - quad.minY;
  items.forEach((item, index) => {
    position.set(...item.position);
    rotation.set(...item.rotation);
    scale.set(item.scale[0], item.scale[0], item.scale[1]);
    matrix.compose(position, rotation, scale);
    /* Нормаль лица — ось метки в мире; плашка сдвинута по ней на `lift`. */
    normal.set(0, quad.axis === "y" ? quad.facing : 0, quad.axis === "z" ? quad.facing : 0).applyQuaternion(rotation);
    CORNERS.forEach(([cu, cv], corner) => {
      const u = cu ? quad.maxX : quad.minX;
      const v = cv ? quad.maxY : quad.minY;
      faceToModel(quad, u, v, quad.front, point).applyMatrix4(matrix).addScaledVector(normal, item.lift ?? PLATE_LIFT);
      point.toArray(positions, index * 12 + corner * 3);
      uvs[index * 8 + corner * 2] = (u - quad.minX) / width;
      uvs[index * 8 + corner * 2 + 1] = (quad.maxY - v) / height;
    });
    /* Обход вершин — так, чтобы лицо глядело вдоль нормали. */
    a.fromArray(positions, index * 12);
    b.fromArray(positions, index * 12 + 3);
    c.fromArray(positions, index * 12 + 6);
    const front = b.clone().sub(a).cross(c.clone().sub(a)).dot(normal) >= 0;
    const base = index * 4;
    indices.set(front ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2], index * 6);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/* Поза глаза `{ eye, yaw, pitch, fov }` по точке и взгляду на цель — в осях кадра (метры от точки места). */
function poseLooking(eye, target, fov) {
  const look = new THREE.Vector3(...target).sub(new THREE.Vector3(...eye)).normalize();
  return { eye: [...eye], yaw: Math.atan2(look.x, look.y), pitch: Math.asin(Math.max(-1, Math.min(1, look.z))), fov };
}

/**
 * Взгляд по умолчанию: над крышами, на середину меток — так, как смотрела бы орбита с `view` места
 * (`yaw`, `pitch`) с расстояния по разбросу меток. Изнутри камера не вращается вокруг точки, а
 * стоит и поворачивается; полёт — щелчком правой кнопки, как везде.
 */
export function placeHomeView(place) {
  const { yaw, pitch } = place.view;
  const [fx, fy, fz] = place.focus || [0, 0, 0];
  const distance = Math.min(80, Math.max(30, (place.spread || 40) * 1.5));
  const eye = [fx + Math.sin(yaw) * Math.cos(pitch) * distance, fy - Math.cos(yaw) * Math.cos(pitch) * distance, fz + Math.sin(pitch) * distance];
  return poseLooking(eye, [fx, fy, fz], 62);
}

/**
 * Взгляд на метку вплотную — так, чтобы надпись читалась прямо, со стороны, откуда её читает игрок.
 *
 * Лицо метки — плоскость с осями u (вправо) и v (вверх надписи); глаз стоит перед лицом (по нормали) и смотрит
 * на середину плашки. Стоячая метка читается снизу вверх по вертикали — глаз прямо перед ней. Лежащая плашмя
 * (нормаль вверх) читается «от низа надписи»: глаз встаёт со стороны низа (против `v`, по горизонтали), приподнят
 * над плашкой, и верх надписи на экране — это её верх (камера изнутри не кренится, поэтому подход надо выбирать,
 * а не доворачивать). `yaw` — запасной взгляд, если `v` у лежащей метки не определяется.
 * `blocked(метка, глаз)` — загорожен ли взгляд стеной или крышей: тогда глаз подвигается ближе к плашке (до 0,35
 * расстояния), пока не станет виден.
 */
export function markerView(item, quad, yaw = 0, blocked = null) {
  const rotation = new THREE.Quaternion(...item.rotation);
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...item.position), rotation, new THREE.Vector3(item.scale[0], item.scale[0], item.scale[1]));
  const centre = faceToModel(quad, (quad.minX + quad.maxX) / 2, (quad.minY + quad.maxY) / 2, quad.front, new THREE.Vector3()).applyMatrix4(matrix);
  const normal = new THREE.Vector3(0, quad.axis === "y" ? quad.facing : 0, quad.axis === "z" ? quad.facing : 0).applyQuaternion(rotation);
  /* Верх надписи в мире: ось v лица, повёрнутая меткой. */
  const up = faceToModel(quad, 0, 1, 0, new THREE.Vector3()).sub(faceToModel(quad, 0, 0, 0, new THREE.Vector3())).applyQuaternion(rotation).normalize();
  const size = Math.max(quad.maxX - quad.minX, quad.maxY - quad.minY) * Math.max(item.scale[0], item.scale[1]);
  const away = Math.min(3.2, Math.max(1.5, size * 5));
  /* Насколько плашка лежит: 0 — стоит отвесно, 1 — плашмя (нормаль вверх или вниз); между — скат. */
  const lying = Math.min(1, Math.max(0, (Math.abs(normal.z) - 0.3) / 0.4));
  /* К низу надписи: против её верха (по плоскости плашки). Висящая лицом вниз (потолок, низ козырька) читается снизу —
     там глаз с другой стороны: смотрит вверх, и верх надписи на экране — только если глаз со стороны её верха. Лежащая
     без наклона и без верха — против взгляда места. */
  const foot = up.clone().multiplyScalar(normal.z < 0 ? 1 : -1);
  if (lying > 0 && Math.hypot(up.x, up.y) < 0.1) foot.set(Math.sin(yaw), -Math.cos(yaw), 0);
  const eyeAt = (share) => centre.clone().addScaledVector(normal, away * (1 - 0.1 * lying) * share).addScaledVector(foot, away * lying * share);
  let eye = eyeAt(1);
  if (blocked) {
    /* Лучи — от плашки (чуть вынесенной), чтобы не упереться в стену, на которой она стоит. */
    const from = centre.clone().addScaledVector(normal, 0.1);
    for (const share of [1, 0.7, 0.5, 0.35]) {
      eye = eyeAt(share);
      if (!blocked(from.toArray(), eye.toArray())) break;
    }
  }
  return { ...poseLooking(eye.toArray(), centre.toArray(), 62), up: up.toArray() };
}
