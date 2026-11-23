/*
 * Укрытие на настоящем участке из игры (задача 24 ТЗ 19.10.2026).
 *
 * Кадр «Укрытие» показывает не нарисованную землю с человеком, а кусок карты вокруг первого места укрытия: дом и его
 * участок, забор, крышу с кондиционером, трансформатор, прицеп, бак — земля, соседние здания и мелочь из файлов GTA V
 * игрока (`scripts/prepare-wallbang-scenes.mjs`: геометрия в поставке, листы читаются у игрока). Подсветка поверх —
 * настоящая оболочка из мода, поставленная на ту же точку тем же поворотом и масштабом, что у сущности мода.
 *
 * Здесь — то, что кадру нужно от сцены и не зависит от React: оболочка как объект three.js со своим шейдером
 * (полупрозрачная модель с собственным свечением, как в игре — расчёт тот же, что у плиток, `wallbang-look.js`),
 * рамка кадра (откуда смотреть и как далеко лететь) и свет времени суток.
 */

import * as THREE from "three";
import { OVERLAY_EMISSION, OVERLAY_LIT, SCENE_LIGHT, SUN_DIRECTION, frameLook } from "./wallbang-look.js";
import { WALLBANG_PLOTS } from "./wallbang-plots.js";

/* Выше этого свечение оболочки выгорает в белое, и цвет работы теряется. */
const GAIN_MAX = 2;
const SCENE_ROOT = "/assets/workshop/wallbang/scenes";

/** Участок укрытия: `{ zone, origin, rotation, scale, centre, half, triangles, … }` или `null`. */
export const wallbangPlot = (id) => WALLBANG_PLOTS[id] || null;

/** Адрес сцены участка. */
export const wallbangPlotUrl = (id) => `${SCENE_ROOT}/${id}.bin`;

/**
 * Свет кадра по времени суток (`orbit-stage.js`, `setDaylight`): множители солнца, фона и экспозиции и цвета света.
 * День — свет студии; сумерки — низкое тёплое солнце; ночь — тёмная синева, при которой оболочка светится.
 */
export const PLOT_DAYLIGHT = Object.freeze({
  day: Object.freeze({ sun: 1, ambient: 1, environment: 1, exposure: 1 }),
  dusk: Object.freeze({
    sun: 0.32,
    ambient: 0.45,
    environment: 0.55,
    exposure: 1,
    sunColour: "#ff8f55",
    fillColour: "#8d7fb3",
    skyColour: "#8c7aa8",
    groundColour: "#3f302c",
  }),
  night: Object.freeze({
    sun: 0.04,
    ambient: 0.14,
    environment: 0.2,
    exposure: 1.15,
    sunColour: "#7f95ff",
    fillColour: "#4a5fa8",
    skyColour: "#3d4c88",
    groundColour: "#151a2a",
  }),
});

export const plotDaylight = (sceneId) => PLOT_DAYLIGHT[sceneId] || PLOT_DAYLIGHT.day;

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/*
 * Оболочка по грани плоская, как в игре: нормаль — из производных положения (вершины формы сварены и общие у соседних
 * граней). Цвет — тем же расчётом, что у плиток: цвет × (0,45 × свет + 0,55 × свечение); поверх укрытия она ложится
 * по альфе, а тон и цветовое пространство даёт кадр (`tonemapping_fragment`, `colorspace_fragment`) — вместе с
 * землёй и домом, на которых лежит.
 */
const FRAGMENT = /* glsl */ `
  uniform vec3 uSunDirection;
  uniform float uSun;
  uniform float uAmbient;
  uniform vec3 uOverlay;
  uniform float uAlpha;
  uniform float uEmission;
  uniform float uGain;
  varying vec3 vWorld;
  void main() {
    vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float lambert = max(dot(normal, uSunDirection), 0.0);
    float lit = uAmbient + uSun * lambert;
    vec3 shell = uOverlay * (${OVERLAY_LIT.toFixed(2)} * lit + ${OVERLAY_EMISSION.toFixed(2)} * uEmission) * uGain;
    gl_FragColor = vec4(shell, uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function shellMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSun: { value: 1 },
      uAmbient: { value: SCENE_LIGHT.day.ambient },
      uOverlay: { value: new THREE.Vector3(0, 0, 1) },
      uAlpha: { value: 0.5 },
      uEmission: { value: 1 },
      uGain: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    /* Оболочка чуть шире самого укрытия, но на плоских стенах граней касается — без сдвига рябит. */
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/**
 * Оболочка укрытия на своём месте участка: форма мода, поставленная поворотом и масштабом сущности мода (игра
 * хранит обратный кватернион: `@modovik/climb-contract/recolor/placement`) в начале сцены.
 * Возвращает `{ object, material, box, dispose }`; `box` — рамка оболочки в метрах сцены.
 */
export function plotShellObject(shape, plot) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(shape.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(shape.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = shellMaterial();
  const object = new THREE.Mesh(geometry, material);
  object.name = "wallbang-shell";
  object.renderOrder = 10;
  const [x, y, z, w] = plot.rotation;
  if (!(x === 0 && y === 0 && z === 0 && w === 1)) object.quaternion.set(-x, -y, -z, w).normalize();
  object.scale.set(plot.scale[0], plot.scale[0], plot.scale[1]);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  return {
    object,
    material,
    box,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Облик работы и время суток → числа шейдера оболочки; скрытое укрытие — без оболочки. */
export function applyShellLook(shell, project, id, sceneId = "day") {
  const look = frameLook(project, id);
  const light = SCENE_LIGHT[sceneId] || SCENE_LIGHT.day;
  const uniforms = shell.material.uniforms;
  uniforms.uOverlay.value.set(...look.overlay);
  uniforms.uAlpha.value = look.alpha;
  uniforms.uEmission.value = look.emission;
  uniforms.uSun.value = light.sun;
  uniforms.uAmbient.value = light.ambient;
  /* Глаз привыкает: кадр темнее (экспозиция света кадра), а оболочка с собственным свечением — на привычной яркости времени суток. */
  uniforms.uGain.value = Math.min(GAIN_MAX, light.exposure / plotDaylight(sceneId).exposure);
  shell.object.visible = look.visible && look.alpha > 0;
}

/* Направление, перпендикулярное длинной стороне оболочки на плоскости (главная ось точек), — откуда смотреть. */
function longAxis(positions, stride = 3) {
  let mx = 0;
  let my = 0;
  const count = positions.length / stride;
  for (let at = 0; at < positions.length; at += stride) {
    mx += positions[at];
    my += positions[at + 1];
  }
  mx /= count;
  my /= count;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let at = 0; at < positions.length; at += stride) {
    const dx = positions[at] - mx;
    const dy = positions[at + 1] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [Math.cos(angle), Math.sin(angle)];
}

/** Откуда камера смотрит по умолчанию: поперёк длинной стороны оболочки, на стороне солнца, чуть сбоку (оборот, радианы). */
export function plotYaw(shell) {
  const geometry = shell.object.geometry;
  const world = Float32Array.from(geometry.attributes.position.array);
  const point = new THREE.Vector3();
  for (let at = 0; at < world.length; at += 3) {
    point.set(world[at], world[at + 1], world[at + 2]).applyMatrix4(shell.object.matrixWorld);
    world[at] = point.x;
    world[at + 1] = point.y;
    world[at + 2] = point.z;
  }
  const [dx, dy] = longAxis(world);
  /* Камера стоит на (sin yaw, −cos yaw) от цели: берём ту из двух сторон, что ближе к солнцу. */
  const sun = [SUN_DIRECTION[0], SUN_DIRECTION[1]];
  const side = [-dy, dx];
  const flip = side[0] * sun[0] + side[1] * sun[1] >= 0 ? 1 : -1;
  const nx = side[0] * flip;
  const ny = side[1] * flip;
  return Math.atan2(nx, -ny) + 0.35;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Рамка кадра (`orbit-stage.js`, `setFrame`): оболочка с запасом местности вокруг — камера садится так, чтобы влезла она и
 * соседство; полёт уходит на весь участок и дальше его краёв не пускает. Фона и человека нет — под ногами настоящая земля.
 * Сторона и высота первого вида — из подготовки сцены (`plot.view`): та, с которой оболочку не закрывает дерево или дом;
 * без неё — поперёк длинной стороны оболочки.
 */
export function plotFrame(shell, plot) {
  const { box } = shell;
  const extent = box.getSize(new THREE.Vector3());
  const longest = Math.max(extent.x, extent.y);
  const pad = clamp(longest * 0.18, 1.2, 4);
  return {
    bounds: {
      min: [box.min.x - pad, box.min.y - pad, box.min.z - 0.4],
      max: [box.max.x + pad, box.max.y + pad, box.max.z + pad * 0.7],
    },
    view: plot.view ? { yaw: plot.view.yaw, pitch: plot.view.pitch, zoom: 1 } : { yaw: plotYaw(shell), pitch: 0.3, zoom: 1 },
    zoomRange: [0.3, 12],
    ground: false,
    person: false,
    fit: 0.06,
    reach: plot.half,
    arrive: true,
  };
}
