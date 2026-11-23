/*
 * Маленький знак Astral на правой стороне груди персонажей сцены боя (просьба владельца,
 * 18.10.2026, задача 4В): наклейка на майку — рисуется в сам лист майки, а не плавает над ней,
 * поэтому следует за позой, ловит свет и тень и у стрелка, и у жертвы.
 *
 * Место на листе находится один раз по жертве в стойке: луч спереди на правую грудь даёт точку
 * листа (UV) и то, куда на листе смотрят «вправо» и «вверх» в метрах тела. У стрелка тот же
 * покрой майки и тот же лист — наклейка ложится на то же место, как бы он ни стоял. Знак — наш
 * `brand/astral-mark.png` (белый на прозрачном), перекрашенный в тёмный: на белой майке читается.
 *
 * Оси тела — glTF: у тела из игры лицо смотрит в +Z, поэтому правая грудь — на −X (зритель, глядя
 * на персонажа спереди, видит её слева). Майка — третья сетка тела после головы и рук (волосы с
 * вырезом в «кожные» не входят); не сошлось число сеток — наклейки нет, кадр остаётся без неё.
 */

import * as THREE from "three";

/* Знак — файл бренда рядом с приложением (так же его берёт плашка обновления). */
const MARK_URL = "/brand/astral-mark.png";
/* Тёмный сине-чёрный Astral (`Astral-mark.svg`): на белой ткани — не чисто чёрный. */
const MARK_COLOUR = "#0b0e14";
/* Сторона листа знака на майке, м: сам знак занимает чуть больше половины — примерно 5,5 см. */
export const MARK_SIZE = 0.1;
/* Правая грудь от сустава верха груди: в сторону руки и чуть выше, м (оси glTF). */
export const MARK_OFFSET = Object.freeze({ right: 0.085, up: 0.06 });
/* Откуда спереди пускается луч, м от сустава. */
const REACH = 0.7;
const TEE_INDEX = 2;
const MESHES_WITH_TEE = 5;

/* Сколько ждать файл знака, мс: сцена не должна висеть из-за наклейки. */
const LOAD_LIMIT = 5000;

let pending = null;

/** Знак Astral тёмным на прозрачном (холст); `null`, если файла нет. Удачная загрузка — одна на окно. */
export function loadAstralMark(url = MARK_URL) {
  if (pending) return pending;
  const attempt = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), LOAD_LIMIT);
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const image = new Image();
    image.onload = () => {
      try {
        const side = 512;
        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, side, side);
        /* Знак белый, нужна его форма: заливаем цветом только там, где он есть. */
        context.globalCompositeOperation = "source-in";
        context.fillStyle = MARK_COLOUR;
        context.fillRect(0, 0, side, side);
        done(canvas);
      } catch {
        done(null);
      }
    };
    image.onerror = () => done(null);
    image.src = url;
  });
  pending = attempt;
  /* Не вышло — следующий заход пробует снова. */
  attempt.then((value) => {
    if (!value && pending === attempt) pending = null;
  });
  return attempt;
}

/** Майка тела: сетка со своим листом, если тело собрано как ждём. */
export function teeMesh(actor) {
  const meshes = actor?.skinMeshes || [];
  if (meshes.length !== MESHES_WITH_TEE) return null;
  const tee = meshes[TEE_INDEX];
  return tee?.geometry?.attributes?.uv && tee.material?.map?.image ? tee : null;
}

/** Решить 2×2: во что в листе превращается мера вдоль направления на плоскости треугольника. */
function planeUv(face, geometry, mesh, direction) {
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const p = [face.a, face.b, face.c].map((index) => new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
  const t = [face.a, face.b, face.c].map((index) => new THREE.Vector2().fromBufferAttribute(uv, index));
  const e1 = p[1].clone().sub(p[0]);
  const e2 = p[2].clone().sub(p[0]);
  const normal = e1.clone().cross(e2).normalize();
  /* Направление — в плоскости треугольника. */
  const w = direction.clone().addScaledVector(normal, -direction.dot(normal));
  if (w.lengthSq() < 1e-9) return null;
  w.normalize();
  const a = e1.dot(e1);
  const b = e1.dot(e2);
  const c = e2.dot(e2);
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-12) return null;
  const x = w.dot(e1);
  const y = w.dot(e2);
  const alpha = (x * c - y * b) / det;
  const beta = (y * a - x * b) / det;
  const a1 = t[1].clone().sub(t[0]);
  const a2 = t[2].clone().sub(t[0]);
  return a1.multiplyScalar(alpha).add(a2.multiplyScalar(beta));
}

/**
 * Где на листе майки правая грудь: `{ u, v, right: [du, dv], up: [du, dv] }` — точка листа и то, на
 * сколько лист сдвигается за метр тела вправо (глазами зрителя спереди) и вверх. По телу в стойке:
 * у него известно, где лицо.
 */
export function chestMarkSpot(actor, joints = actor?.joints) {
  const tee = teeMesh(actor);
  const spine = joints?.spine3;
  if (!tee || !Array.isArray(spine)) return null;
  actor.placement.updateMatrixWorld(true);
  const local = new THREE.Vector3(spine[0] - MARK_OFFSET.right, spine[1] + MARK_OFFSET.up, spine[2] + REACH);
  /* Сетки лежат в системе тела (glTF): в мир — их матрицей. */
  const origin = local.clone().applyMatrix4(tee.matrixWorld);
  const through = new THREE.Vector3(0, 0, -1).transformDirection(tee.matrixWorld);
  const caster = new THREE.Raycaster(origin, through, 0, REACH * 2);
  const hit = caster.intersectObject(tee, false)[0];
  if (!hit?.uv || !hit.face) return null;
  /* Зритель спереди: «вправо» — +X тела, «вверх» — +Y; в мир — той же матрицей. */
  const right = new THREE.Vector3(1, 0, 0).transformDirection(tee.matrixWorld);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(tee.matrixWorld);
  const du = planeUv(hit.face, tee.geometry, tee, right);
  const dv = planeUv(hit.face, tee.geometry, tee, up);
  if (!du || !dv) return null;
  return { u: hit.uv.x, v: hit.uv.y, right: [du.x, du.y], up: [dv.x, dv.y] };
}

/**
 * Нарисовать знак в лист майки этого тела. Лист заменяется копией на холсте — исходный лист игры
 * не меняется (он общий с другими телами сцены только по ссылке на картинку).
 */
export function paintChestMark(actor, mark, spot, { size = MARK_SIZE } = {}) {
  const tee = teeMesh(actor);
  if (!tee || !mark || !spot) return false;
  const map = tee.material.map;
  const image = map.image;
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  if (!width || !height) return false;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  /* Единичный квадрат знака → лист: x вправо по телу, y вниз = вниз по телу. */
  const rx = spot.right[0] * width * size;
  const ry = spot.right[1] * height * size;
  const ux = spot.up[0] * width * size;
  const uy = spot.up[1] * height * size;
  context.setTransform(rx, ry, -ux, -uy, spot.u * width, spot.v * height);
  context.globalAlpha = 0.92;
  context.drawImage(mark, -0.5, -0.5, 1, 1);
  context.setTransform(1, 0, 0, 1, 0, 0);
  map.image = canvas;
  map.needsUpdate = true;
  return true;
}

/**
 * Знак на правую грудь жертвы и стрелка. Не вышло — тихо: кадр без наклейки ничем не хуже.
 *
 * @returns {Promise<boolean>}
 */
export async function stampChestMark({ victim, shooter }) {
  try {
    const mark = await loadAstralMark();
    const spot = chestMarkSpot(victim);
    if (!mark || !spot) return false;
    const done = [paintChestMark(victim, mark, spot), paintChestMark(shooter, mark, spot)];
    return done.some(Boolean);
  } catch {
    return false;
  }
}
