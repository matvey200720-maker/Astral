/*
 * Ручки своей модели в 3D-кадре (ТЗ 11.10.2026, вечер, задача 1: «чтобы он
 * мог переставлять её так, как ему удобно … как в Блендере, но удобнее»).
 *
 * Главный род — «Ставить» (ТЗ 11.10.2026, ночь, задача 1: «облегчи … чтобы
 * было легче крутить»): одно кольцо вокруг нормали поверхности, к которой
 * модель прилипла (на полу — курс, на стене — поворот в плоскости стены), и
 * кубик размера на кольце. Двигают саму модель мышью (`place-models-layer.js`).
 *
 * Точные ручки, как в Blender, оси — мира кадра (Z вверх), клавиши G · R · S:
 *   move   — стрелки X (красная), Y (зелёная), Z (синяя): вдоль оси; квадраты
 *            между осями — в их плоскости; шар в середине — в плоскости
 *            экрана;
 *   rotate — кольца вокруг X, Y и Z: тянешь по кольцу — модель
 *            поворачивается вокруг его оси;
 *   scale  — кубики на концах осей и в середине: размер (у модели он один —
 *            длинная сторона, поэтому все кубики тянут его одинаково).
 * С Ctrl — шагами: 0,25 м, 15°, 0,1 м.
 *
 * item   — замена вещи (своя картинка или модель вместо неё, владелец 01.11.2026: «как в Блендере тулы: вращение, поднятие и
 *          опущение, перемещение»): стрелки и квадраты перемещения и кольцо с кубиком «Ставить» сразу — сдвиг, высота, поворот
 *          вокруг вертикали и размер без переключения.
 *
 * Ручки рисуются поверх сцены (без глубины) и держат один размер на экране,
 * как бы далеко ни была модель. Ловятся невидимыми толстыми двойниками —
 * тонкую стрелку мышью не поймать.
 *
 * Модуль не знает ни React, ни работы: ему дают место, поворот и размер
 * модели (`setTarget`), а он отвечает новыми, пока их тянут (`drag`).
 */

import * as THREE from "three";

export const GIZMO_MODES = Object.freeze(["place", "move", "rotate", "scale", "item"]);

const COLOURS = Object.freeze({
  x: 0xff4d5e,
  y: 0x6be37a,
  z: 0x4d8dff,
  free: 0xf2f4f8,
  spin: 0xf2f4f8,
  hover: 0xffd23a,
});
const Z = new THREE.Vector3(0, 0, 1);
const AXES = Object.freeze({
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
});
/* Высота ручек на экране, px. */
const SCREEN_SIZE = 110;
const SNAP = Object.freeze({ move: 0.25, rotate: 15, scale: 0.1 });
const SIZE_LIMIT = Object.freeze([0.1, 40]);

const round = (value, digits) =>
  Math.round(value * 10 ** digits) / 10 ** digits + 0;

function overlayMaterial(colour, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

const PICK_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

/* Поворот, что ставит ось +Y геометрии вдоль `axis`. */
function alongAxis(axis) {
  return new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    AXES[axis],
  );
}

/**
 * Ручки: `{ object, setTarget, setMode, update, hit, begin, drag, end,
 * setHover, dispose }`. `object` кладётся в сцену кадра.
 */
export function createModelGizmo() {
  const root = new THREE.Group();
  root.name = "model-gizmo";
  root.renderOrder = 999;
  root.visible = false;
  const groups = {
    place: new THREE.Group(),
    move: new THREE.Group(),
    rotate: new THREE.Group(),
    scale: new THREE.Group(),
  };
  for (const group of Object.values(groups)) root.add(group);
  const handles = [];
  const disposables = [];

  /* Ручка: видимые сетки и невидимый двойник; `id` — что она делает. */
  function handle(group, id, colour, visible, pick, opacity = 1) {
    const material = overlayMaterial(colour, opacity);
    disposables.push(material);
    const meshes = visible.map((geometry) => {
      disposables.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 999;
      group.add(mesh);
      return mesh;
    });
    disposables.push(pick);
    const catcher = new THREE.Mesh(pick, PICK_MATERIAL);
    catcher.userData.gizmo = id;
    group.add(catcher);
    const entry = { id, material, colour, opacity, meshes, catcher, group };
    handles.push(entry);
    return entry;
  }

  /* --- Ставить: кольцо вокруг нормали поверхности и кубик размера на нём --- */
  {
    const ring = new THREE.TorusGeometry(0.95, 0.024, 8, 96);
    const pick = new THREE.TorusGeometry(0.95, 0.1, 6, 48);
    /* Засечки через 90° (четвёртая — кубик размера): видно, куда шагают 90°. */
    const ticks = [1, 2, 3].map((index) => {
      const angle = Math.PI / 4 + (index * Math.PI) / 2;
      return new THREE.BoxGeometry(0.07, 0.07, 0.07).translate(
        Math.cos(angle) * 0.95,
        Math.sin(angle) * 0.95,
        0,
      );
    });
    handle(groups.place, "spin:n", COLOURS.spin, [ring, ...ticks], pick, 0.9);
    const corner = Math.SQRT1_2 * 0.95;
    handle(
      groups.place,
      "scale:place",
      COLOURS.free,
      [new THREE.BoxGeometry(0.15, 0.15, 0.15).translate(corner, corner, 0)],
      new THREE.BoxGeometry(0.26, 0.26, 0.26).translate(corner, corner, 0),
      0.95,
    );
  }

  /* --- Перемещение --- */
  for (const axis of ["x", "y", "z"]) {
    const turn = alongAxis(axis);
    const shaft = new THREE.CylinderGeometry(0.018, 0.018, 0.78, 8)
      .translate(0, 0.39 + 0.1, 0)
      .applyQuaternion(turn);
    const tip = new THREE.ConeGeometry(0.07, 0.22, 16)
      .translate(0, 0.98, 0)
      .applyQuaternion(turn);
    const pick = new THREE.CylinderGeometry(0.09, 0.09, 1.05, 6)
      .translate(0, 0.6, 0)
      .applyQuaternion(turn);
    handle(groups.move, `move:${axis}`, COLOURS[axis], [shaft, tip], pick);
  }
  /* Плоскости: квадрат между двумя осями, цвет — третьей (нормали). */
  for (const [plane, normal] of [
    ["xy", "z"],
    ["xz", "y"],
    ["yz", "x"],
  ]) {
    const square = new THREE.PlaneGeometry(0.2, 0.2);
    const offset = new THREE.Vector3();
    for (const axis of plane)
      offset.add(AXES[axis].clone().multiplyScalar(0.32));
    const facing = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      AXES[normal],
    );
    square.applyQuaternion(facing).translate(offset.x, offset.y, offset.z);
    const pick = square.clone();
    handle(
      groups.move,
      `plane:${normal}`,
      COLOURS[normal],
      [square],
      pick,
      0.55,
    );
  }
  {
    const ball = new THREE.SphereGeometry(0.075, 16, 12);
    handle(
      groups.move,
      "free",
      COLOURS.free,
      [ball],
      new THREE.SphereGeometry(0.13, 8, 6),
      0.9,
    );
  }

  /* --- Поворот --- */
  for (const axis of ["x", "y", "z"]) {
    const facing = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      AXES[axis],
    );
    const ring = new THREE.TorusGeometry(0.9, 0.016, 8, 96).applyQuaternion(
      facing,
    );
    const pick = new THREE.TorusGeometry(0.9, 0.08, 6, 48).applyQuaternion(
      facing,
    );
    handle(groups.rotate, `rotate:${axis}`, COLOURS[axis], [ring], pick);
  }

  /* --- Размер --- */
  for (const axis of ["x", "y", "z"]) {
    const turn = alongAxis(axis);
    const shaft = new THREE.CylinderGeometry(0.016, 0.016, 0.72, 8)
      .translate(0, 0.36 + 0.1, 0)
      .applyQuaternion(turn);
    const cube = new THREE.BoxGeometry(0.13, 0.13, 0.13)
      .translate(0, 0.9, 0)
      .applyQuaternion(turn);
    const pick = new THREE.CylinderGeometry(0.1, 0.1, 1.0, 6)
      .translate(0, 0.55, 0)
      .applyQuaternion(turn);
    handle(groups.scale, `scale:${axis}`, COLOURS[axis], [shaft, cube], pick);
  }
  handle(
    groups.scale,
    "scale:all",
    COLOURS.free,
    [new THREE.BoxGeometry(0.16, 0.16, 0.16)],
    new THREE.BoxGeometry(0.24, 0.24, 0.24),
    0.9,
  );

  let mode = "place";
  let target = null;
  let hovered = null;
  let active = null;
  const raycaster = new THREE.Raycaster();
  /* Ось кольца «Ставить» — нормаль поверхности модели. */
  const normal = new THREE.Vector3(0, 0, 1);

  /* Ось ручки: у кольца «Ставить» — нормаль, у остальных — ось мира. */
  const axisOf = (kind, axis) =>
    kind === "spin" ? normal.clone() : AXES[axis];

  function showMode() {
    for (const [id, group] of Object.entries(groups))
      group.visible = id === mode || (mode === "item" && (id === "move" || id === "place"));
  }
  showMode();

  function paint() {
    for (const entry of handles) {
      const hot = entry.id === (active?.id || hovered);
      entry.material.color.setHex(hot ? COLOURS.hover : entry.colour);
      entry.material.opacity = hot ? 1 : entry.opacity;
    }
  }

  /**
   * Модель под ручками: `{ position, rotation (градусы), size, normal }` или
   * `null`; `normal` — поверхность, к которой она прилипла (ось кольца).
   */
  function setTarget(next) {
    target = next
      ? {
          position: [...next.position],
          rotation: [...next.rotation],
          size: next.size,
          normal: [...(next.normal || [0, 0, 1])],
        }
      : null;
    root.visible = Boolean(target);
    if (target && !active) {
      root.position.set(...target.position);
      normal.set(...target.normal).normalize();
      groups.place.quaternion.setFromUnitVectors(Z, normal);
    }
  }

  function setMode(next) {
    if (!GIZMO_MODES.includes(next) || next === mode) return;
    mode = next;
    hovered = null;
    showMode();
    paint();
  }

  /** Один размер на экране: от расстояния до камеры и угла объектива. */
  function update(camera, viewportHeight) {
    if (!root.visible) return;
    const distance = camera.position.distanceTo(root.position);
    const fov = THREE.MathUtils.degToRad(camera.fov || 50);
    const scale =
      (2 * distance * Math.tan(fov / 2) * SCREEN_SIZE) /
      Math.max(200, viewportHeight || 600);
    root.scale.setScalar(Math.max(1e-3, scale));
  }

  /** Ручка под лучом (`id`) или `null`. */
  function hit(ray) {
    if (!root.visible) return null;
    raycaster.ray.copy(ray);
    const catchers = handles
      .filter((entry) => entry.group.visible)
      .map((entry) => entry.catcher);
    root.updateMatrixWorld(true);
    const found = raycaster.intersectObjects(catchers, false)[0];
    return found?.object.userData.gizmo || null;
  }

  function setHover(id) {
    if (hovered === id) return;
    hovered = id;
    paint();
  }

  /* --- Протяжка --- */

  const plane = new THREE.Plane();
  const point = new THREE.Vector3();

  function onPlane(ray, normal, origin) {
    plane.setFromNormalAndCoplanarPoint(normal, origin);
    return ray.intersectPlane(plane, point) ? point.clone() : null;
  }

  /* Точка на оси, ближайшая к лучу: параметр вдоль оси. */
  function alongLine(ray, origin, axis) {
    const w0 = origin.clone().sub(ray.origin);
    const b = axis.dot(ray.direction);
    const denominator = 1 - b * b;
    if (Math.abs(denominator) < 1e-6) return null;
    return (b * ray.direction.dot(w0) - axis.dot(w0)) / denominator;
  }

  /**
   * Начало протяжки ручки `id` лучом `ray`; `view` — направление взгляда
   * камеры (для шара в середине), `screen` — `[x, y]` указателя и середины
   * ручек на экране (для размера).
   */
  function begin(id, ray, { view, pointer, centre } = {}) {
    if (!target) return false;
    const origin = new THREE.Vector3(...target.position);
    const [kind, axis] = id.split(":");
    const start = {
      id,
      kind,
      axis,
      origin,
      base: {
        position: [...target.position],
        rotation: [...target.rotation],
        size: target.size,
        normal: [...target.normal],
      },
    };
    if (kind === "move") start.t0 = alongLine(ray, origin, AXES[axis]);
    else if (kind === "plane") start.hit0 = onPlane(ray, AXES[axis], origin);
    else if (kind === "free") {
      start.normal = (view || new THREE.Vector3(0, 1, 0)).clone().normalize();
      start.hit0 = onPlane(ray, start.normal, origin);
    } else if (kind === "rotate" || kind === "spin") {
      start.turnAxis = axisOf(kind, axis);
      start.hit0 = onPlane(ray, start.turnAxis, origin);
      start.quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          ...target.rotation.map((value) => THREE.MathUtils.degToRad(value)),
          "ZYX",
        ),
      );
    } else if (kind === "scale") {
      start.pointer = pointer;
      start.centre = centre;
      start.distance =
        pointer && centre
          ? Math.max(
              4,
              Math.hypot(pointer[0] - centre[0], pointer[1] - centre[1]),
            )
          : 1;
    }
    if (
      (kind === "move" && start.t0 === null) ||
      ((kind === "plane" ||
        kind === "free" ||
        kind === "rotate" ||
        kind === "spin") &&
        !start.hit0)
    )
      return false;
    active = start;
    paint();
    return true;
  }

  /** Новые место, поворот и размер для луча `ray` или `null` (луч мимо). */
  function drag(ray, { snap = false, pointer = null } = {}) {
    if (!active || !target) return null;
    const { kind, axis, origin, base } = active;
    const next = {
      position: [...base.position],
      rotation: [...base.rotation],
      size: base.size,
      normal: [...base.normal],
    };
    if (kind === "move") {
      const t = alongLine(ray, origin, AXES[axis]);
      if (t === null) return null;
      let delta = t - active.t0;
      if (snap) delta = Math.round(delta / SNAP.move) * SNAP.move;
      const index = { x: 0, y: 1, z: 2 }[axis];
      next.position[index] = round(base.position[index] + delta, 2);
    } else if (kind === "plane" || kind === "free") {
      const hit = onPlane(
        ray,
        kind === "free" ? active.normal : AXES[axis],
        origin,
      );
      if (!hit) return null;
      const delta = hit.sub(active.hit0);
      for (let index = 0; index < 3; index += 1) {
        let value = delta.getComponent(index);
        if (snap) value = Math.round(value / SNAP.move) * SNAP.move;
        next.position[index] = round(base.position[index] + value, 2);
      }
    } else if (kind === "rotate" || kind === "spin") {
      const turnAxis = active.turnAxis;
      const hit = onPlane(ray, turnAxis, origin);
      if (!hit) return null;
      const v0 = active.hit0.clone().sub(origin);
      const v1 = hit.sub(origin);
      let angle = Math.atan2(v0.clone().cross(v1).dot(turnAxis), v0.dot(v1));
      if (snap)
        angle = THREE.MathUtils.degToRad(
          Math.round(THREE.MathUtils.radToDeg(angle) / SNAP.rotate) *
            SNAP.rotate,
        );
      active.angle = THREE.MathUtils.radToDeg(angle);
      const turned = new THREE.Quaternion()
        .setFromAxisAngle(turnAxis, angle)
        .multiply(active.quaternion);
      const euler = new THREE.Euler().setFromQuaternion(turned, "ZYX");
      next.rotation = [euler.x, euler.y, euler.z].map((value) =>
        round(THREE.MathUtils.radToDeg(value), 1),
      );
    } else if (kind === "scale") {
      if (!pointer || !active.centre) return null;
      const distance = Math.max(
        1,
        Math.hypot(
          pointer[0] - active.centre[0],
          pointer[1] - active.centre[1],
        ),
      );
      let size = base.size * (distance / active.distance);
      if (snap) size = Math.round(size / SNAP.scale) * SNAP.scale;
      next.size = round(
        Math.min(SIZE_LIMIT[1], Math.max(SIZE_LIMIT[0], size)),
        2,
      );
    }
    target = next;
    root.position.set(...next.position);
    return next;
  }

  function end() {
    active = null;
    if (target) root.position.set(...target.position);
    paint();
  }

  function dispose() {
    for (const item of disposables) item.dispose?.();
    root.removeFromParent();
  }

  return {
    object: root,
    setTarget,
    setMode,
    update,
    hit,
    begin,
    drag,
    end,
    setHover,
    dispose,
    get mode() {
      return mode;
    },
    get dragging() {
      return Boolean(active);
    },
    /** Что тянут сейчас: `move`, `plane`, `free`, `rotate`, `spin`, `scale` или `null`. */
    get kind() {
      return active?.kind || null;
    },
    /** На сколько градусов повёрнуто кольцом в этой протяжке (`null` — не кольцом). */
    get turned() {
      return active && (active.kind === "spin" || active.kind === "rotate")
        ? (active.angle ?? 0)
        : null;
    },
  };
}
