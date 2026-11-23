/*
 * Кадр укрытия в 3D: настоящая форма оболочки из мода под подсветкой.
 *
 * Сетка — та самая, что встанет в игру (`wallbang-shapes.js`); под ней —
 * «укрытие»: та же форма в материале своего вида (бетон, штукатурка,
 * металл). Подсветка считается в одном проходе с укрытием тем же расчётом,
 * что у плиток (`LOOK_GLSL`): оболочка облегает укрытие, и смесь по альфе
 * здесь честнее, чем два прозрачных слоя с сортировкой. Земля с сеткой по
 * метру и человек в 1,8 м рядом — для масштаба: мусорный бак и дом в кадре
 * одного размера, а в игре — нет.
 *
 * Кадр рисуется только по делу — правка, поворот, смена размера, — а не
 * шестьдесят раз в секунду: редактор держат открытым рядом с игрой. Само
 * укрытие не вращается; цикл кадров живёт, только пока рука ведёт камеру —
 * инерция после протяжки и полёт, — и встаёт, когда окно отвернулось
 * (`setActive`, ворота внимания).
 *
 * Камера — общая на всю мастерскую (`stage-camera.js`, оси Z вверх, как у
 * моделей игры): ЛКМ — повернуть, щелчок ПКМ — полёт вокруг укрытия (W A S D,
 * Q и E), колесо — приблизить, двойной щелчок — вид по умолчанию.
 */

import * as THREE from "three";
import { createStageCamera } from "../model-stage/stage-camera.js";
import {
  createSceneWarmup,
  skipShaderChecks,
} from "../model-stage/shader-warmup.js";
import { qualityProfile } from "../model-stage/quality-profile.js";
import {
  LOOK_GLSL,
  SUN_DIRECTION,
  frameLook,
  hexLinear,
  sceneOf,
} from "./wallbang-look.js";

const FOV = 34;
const DEFAULT_VIEW = Object.freeze({ yaw: -0.62, pitch: 0.36, zoom: 1 });
const PITCH_RANGE = [0.04, 1.35];
const ZOOM_RANGE = [0.45, 2.6];
const PERSON_HEIGHT = 1.8;
/* Ниже стольких метров над землёй полёт не опускается: под землёй кадра
   смотреть не на что. */
const FLY_CLEARANCE = 0.4;

const SHELL_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/* Нормаль грани — из производных положения: сварные вершины формы общие у
   соседних граней, а в игре свет у оболочки плоский по граням. */
const SHELL_FRAGMENT = /* glsl */ `
  ${LOOK_GLSL}
  uniform vec3 uMaterial;
  uniform vec3 uOverlay;
  uniform float uAlpha;
  uniform float uEmission;
  varying vec3 vWorld;
  void main() {
    vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float lambert = max(dot(normal, uSunDirection), 0.0);
    gl_FragColor = vec4(wallbangShade(uMaterial, uOverlay, uAlpha, uEmission, lambert), 1.0);
  }
`;

/* Земля: свет сверху, сетка по метру и мягкая тень-пятно под укрытием. */
const GROUND_FRAGMENT = /* glsl */ `
  ${LOOK_GLSL}
  uniform vec3 uGround;
  uniform vec4 uFootprint;
  uniform float uShadow;
  varying vec3 vWorld;
  void main() {
    /* Линии сетки — у краёв клетки; вдали сетка гаснет, а не рябит. */
    vec2 cell = abs(fract(vWorld.xy) - 0.5);
    float width = clamp(length(fwidth(vWorld.xy)) * 1.2, 0.012, 0.25);
    float line = smoothstep(0.5 - width, 0.5, max(cell.x, cell.y));
    line *= 1.0 - smoothstep(18.0, 70.0, distance(vWorld, cameraPosition));
    vec2 inside = max(abs(vWorld.xy - uFootprint.xy) - uFootprint.zw, 0.0);
    float shadow = uShadow * exp(-length(inside) * 1.6);
    vec3 ground = uGround * (1.0 - 0.18 * line) * (1.0 - shadow);
    gl_FragColor = vec4(wallbangShade(ground, ground, 0.0, 0.0, max(uSunDirection.z, 0.0)), 1.0);
  }
`;

const lightUniforms = () => ({
  uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
  uSun: { value: 1 },
  uAmbient: { value: 0.4 },
  uExposure: { value: 1 },
});

function shellMaterial(light) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...light,
      uMaterial: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uOverlay: { value: new THREE.Vector3(0, 0, 1) },
      uAlpha: { value: 0 },
      uEmission: { value: 1 },
    },
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
  });
}

function shellGeometry(shape) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(shape.positions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(shape.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/* Человек для масштаба: капсула тела и голова, 1,8 м. */
function personGeometry() {
  const body = new THREE.CapsuleGeometry(0.22, 1.05, 6, 14);
  body.rotateX(Math.PI / 2);
  body.translate(0, 0, 0.22 + 0.525 + 0.05);
  const head = new THREE.SphereGeometry(0.13, 16, 12);
  head.translate(0, 0, PERSON_HEIGHT - 0.13);
  const merged = new THREE.BufferGeometry();
  const parts = [body, head].map((part) => part.toNonIndexed());
  const count = parts.reduce(
    (sum, part) => sum + part.attributes.position.count,
    0,
  );
  const positions = new Float32Array(count * 3);
  let offset = 0;
  for (const part of parts) {
    positions.set(part.attributes.position.array, offset);
    offset += part.attributes.position.array.length;
    part.dispose();
  }
  body.dispose();
  head.dispose();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return merged;
}

/**
 * Кадр на холсте. `onContextLost` — видеокарта забрала контекст;
 * `onMode(mode, { speed })` — сменился род камеры (полёт после щелчка правой
 * кнопкой) или скорость полёта.
 */
export function createWallbangScene({
  canvas,
  onContextLost = null,
  onMode = null,
}) {
  const profile = qualityProfile();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: profile.antialias,
    alpha: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  skipShaderChecks(renderer);
  /* Цвет в sRGB считает шейдер сам — тем же расчётом, что у плиток. */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);

  const light = lightUniforms();
  const shell = new THREE.Mesh(
    new THREE.BufferGeometry(),
    shellMaterial(light),
  );
  const person = new THREE.Mesh(personGeometry(), shellMaterial(light));
  person.material.uniforms.uMaterial.value.set(0.34, 0.36, 0.4);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: {
        ...light,
        uGround: { value: new THREE.Vector3(0.2, 0.2, 0.2) },
        uFootprint: { value: new THREE.Vector4(0, 0, 1, 1) },
        uShadow: { value: 0.45 },
      },
      vertexShader: SHELL_VERTEX,
      fragmentShader: GROUND_FRAGMENT,
    }),
  );
  scene.add(ground, shell, person);

  let frame = { centre: new THREE.Vector3(), radius: 5 };
  let size = { width: 1, height: 1 };
  let pending = 0;
  let loop = 0;
  let last = 0;
  let active = true;
  let disposed = false;
  let lost = false;

  /*
   * Стоящий кадр рисуется только по правке, повороту и смене размера, а
   * нарисованное холст держит сам. Окно в фоне правок не шлёт — значит и не
   * рисует; окно рядом с игрой показывает последний облик, а не пустоту.
   */
  function render() {
    pending = 0;
    if (disposed || lost || !warmup.ready) return;
    eye.apply();
    renderer.render(scene, camera);
  }

  /* Три шейдера сцены (оболочка, фигура, земля) собираются параллельно с первого
     кадра; кадр рисуется по ответу, а не стоит окно на сборке. Материалы не
     меняются, меняется только геометрия — прогрева один. */
  const warmup = createSceneWarmup({
    renderer,
    scene,
    camera,
    alive: () => !disposed && !lost,
    onReady: () => invalidate(),
  });

  /* Одна перерисовка на кадр экрана, сколько бы правок ни пришло. */
  function invalidate() {
    if (disposed || pending || loop) return;
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 16);
    pending = schedule(render) || 1;
  }

  /* Цикл — пока камера движется сама: инерция после протяжки, полёт с
     зажатой клавишей. Встала — встаёт и цикл. */
  function tick(now) {
    loop = 0;
    if (disposed || lost || !active) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    eye.step(dt);
    render();
    if (eye.moving()) loop = requestAnimationFrame(tick);
  }

  function kick() {
    if (disposed || lost || loop) return;
    if (
      !active ||
      typeof requestAnimationFrame !== "function" ||
      !eye.moving()
    ) {
      invalidate();
      return;
    }
    if (pending && typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(pending);
    pending = 0;
    last = 0;
    loop = requestAnimationFrame(tick);
  }

  /* Камера — общая на всю мастерскую: мышь, клавиши и полёт — её, кадру
     остаются цикл, свет и сцена. */
  const eye = createStageCamera({
    camera,
    canvas,
    up: "z",
    /* Вид камеры переживает спячку окна (`features/hibernation/stage-views.js`). */
    memoryKey: "workshop:wallbang",
    onChange: invalidate,
    onKick: kick,
    onMode: (mode, info) => onMode?.(mode, info),
  });

  function setShape(shape, { material = null } = {}) {
    shell.geometry.dispose();
    shell.geometry = shape ? shellGeometry(shape) : new THREE.BufferGeometry();
    if (material) shell.material.uniforms.uMaterial.value.set(...material);
    const box = shape
      ? shell.geometry.boundingBox
      : new THREE.Box3(
          new THREE.Vector3(-1, -1, 0),
          new THREE.Vector3(1, 1, 1),
        );
    const extent = box.getSize(new THREE.Vector3());
    frame = {
      centre: box.getCenter(new THREE.Vector3()),
      radius: Math.max(1.2, extent.length() / 2),
    };
    /* Человек — справа от укрытия в виде по умолчанию (вдоль «вправо»
       камеры), на уровне низа рамки: так его не заслоняет само укрытие. */
    const right = new THREE.Vector3(
      Math.cos(DEFAULT_VIEW.yaw),
      Math.sin(DEFAULT_VIEW.yaw),
      0,
    );
    let reach = 0;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        reach = Math.max(
          reach,
          (x - frame.centre.x) * right.x + (y - frame.centre.y) * right.y,
        );
    person.position.set(
      frame.centre.x + right.x * (reach + 0.9),
      frame.centre.y + right.y * (reach + 0.9),
      box.min.z,
    );
    const span = Math.max(extent.x, extent.y) + 24;
    ground.scale.set(span * 2, span * 2, 1);
    ground.position.set(frame.centre.x, frame.centre.y, box.min.z - 0.005);
    ground.material.uniforms.uFootprint.value.set(
      frame.centre.x,
      frame.centre.y,
      extent.x / 2,
      extent.y / 2,
    );
    /* Новая форма — вид по умолчанию. Дальность — своя: сфера рамки целиком
       в кадре по высоте (в узком окне — по ширине); рамка шире самой формы,
       поэтому чуть ближе, чем «ровно влезает». Полёт — над землёй кадра и
       не ниже неё. */
    eye.setFrame({
      target: frame.centre.toArray(),
      radius: frame.radius,
      view: DEFAULT_VIEW,
      zoomRange: ZOOM_RANGE,
      pitchRange: PITCH_RANGE,
      distance: (zoom) =>
        (frame.radius / Math.sin(THREE.MathUtils.degToRad(FOV) / 2)) *
        (0.9 / Math.min(1, camera.aspect || 1)) *
        zoom,
      fov: FOV,
      bounds: {
        min: [
          frame.centre.x - span,
          frame.centre.y - span,
          box.min.z + FLY_CLEARANCE,
        ],
        max: [frame.centre.x + span, frame.centre.y + span, box.max.z + span],
      },
      floor: box.min.z + FLY_CLEARANCE,
    });
  }

  function setLook(project, id, sceneId = "day") {
    const look = frameLook(project, id);
    const light = sceneOf(sceneId);
    const uniforms = shell.material.uniforms;
    uniforms.uOverlay.value.set(...look.overlay);
    uniforms.uAlpha.value = look.alpha;
    uniforms.uEmission.value = look.emission;
    uniforms.uMaterial.value.set(...look.material);
    for (const material of [shell.material, person.material, ground.material]) {
      material.uniforms.uSun.value = light.sun;
      material.uniforms.uAmbient.value = light.ambient;
      material.uniforms.uExposure.value = light.exposure;
    }
    /* Цвет земли — тем же переводом sRGB → линейный, что у плиток: цвет
       three.js из строки уже переводится сам, и второй перевод темнил бы
       землю вдвое. */
    ground.material.uniforms.uGround.value.set(...hexLinear(light.ground));
    invalidate();
  }

  function resize(width, height, pixelRatio = 1) {
    size = { width: Math.max(1, width), height: Math.max(1, height) };
    renderer.setPixelRatio(Math.min(profile.pixelRatio, pixelRatio || 1));
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    invalidate();
  }

  const onLost = (event) => {
    event.preventDefault();
    lost = true;
    onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  /** Вид по умолчанию: из полёта — домой. */
  function resetView() {
    eye.reset();
  }

  /**
   * Ворота внимания: окно отвернулось — зажатые клавиши полёта отпущены,
   * цикл стоит. Правку кадр рисует и так — по одной перерисовке.
   */
  warmup.warm();

  function setActive(open) {
    active = Boolean(open);
    if (active) {
      kick();
      return;
    }
    eye.releaseKeys();
    if (loop) cancelAnimationFrame(loop);
    loop = 0;
  }

  function dispose() {
    disposed = true;
    warmup.stop();
    if (loop) cancelAnimationFrame(loop);
    loop = 0;
    eye.dispose();
    canvas.removeEventListener("webglcontextlost", onLost);
    for (const mesh of [shell, person, ground]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  return {
    setShape,
    setLook,
    resize,
    resetView,
    setActive,
    /* Полёт по щелчку правой кнопкой — и по кнопке «Выйти» плашки. */
    toggleFly: () => eye.toggleFly(),
    setSpeed: (speed) => eye.setSpeed(speed),
    render,
    dispose,
    get view() {
      return eye.view;
    },
    get mode() {
      return eye.mode;
    },
  };
}
