/*
 * Машина кадра «Дыма из-под колёс».
 *
 * Своя машина игрока — дрифт-версия из его GTA V (`readWheelSmokeCar`
 * главного процесса, `apps/desktop/src/wheel-smoke-car.js`): кузов, колесо с
 * диском и шиной и их листы — GLB в осях игры, его разбирает `gameCarAsset`.
 * Без игры кузова нет: в кадре четыре колеса, нарисованные Astral, а подпись
 * просит подключить игру. Запасной кузов из файлов игры убран из поставки
 * 18.10.2026 (владелец): моделей Rockstar в git нет.
 *
 * Сетки — в осях игры (метры, Z вверх, нос +Y, начало — посередине между
 * осями на земле). У материала — роль (`paint`, `trim`, `glass`, `lights`,
 * `interior`, `badge`, `decal`, `tyre`, `rim`), цвет и, у машины из игры,
 * лист. Колесо игры — одно, левое, в своих осях (ось вращения X): кадр
 * ставит его на четыре места, правым — зеркалом, как игра. Колёса крутятся
 * сами: пробуксовка и дрифт без крутящихся колёс выглядели бы стоящей
 * машиной в дыму.
 *
 * Рисует их рисовальщик частиц (`setSceneObjects`): после матового фона и до
 * частиц, с глубиной — дым за машиной ею и заслоняется. Цвет считается в
 * отображаемых долях (студийный свет сверху-сбоку и отражение светлого
 * «неба») и переводится в HDR обратной плёночной кривой, как фон
 * (`matte-floor.js`): экспозиция дыма машину не перекрашивает.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { INVERSE_FILMIC_GLSL } from "../../../components/desktop/workshop/ptfx/matte-floor.js";

/* Краска кузова — органы кадра: светлая, чёрная, красная, синяя. */
export const CAR_PAINTS = Object.freeze([
  Object.freeze({ id: "white", label: "Белая", colour: "#d9d9d5" }),
  Object.freeze({ id: "black", label: "Чёрная", colour: "#16171a" }),
  Object.freeze({ id: "red", label: "Красная", colour: "#a8141c" }),
  Object.freeze({ id: "blue", label: "Синяя", colour: "#1d4a9e" }),
]);
export const carPaint = (id) => CAR_PAINTS.find((item) => item.id === id) || CAR_PAINTS[0];

/** Колёса машины сцены: из её описи, а без машины игры — колёсная база по умолчанию. */
export const carWheels = (asset) => (asset?.parts?.[0]?.wheels?.length ? asset.parts[0].wheels : SPARE_WHEELS);

/*
 * Выхлопная труба: кость `exhaust` машины игры (`parts[0].exhaust`, метры
 * кадра). Без машины или у сборки главного процесса старше этой — сзади
 * слева у обычного купе, чтобы огонь и хлопки не пропадали из кадра.
 */
export const SPARE_EXHAUST = Object.freeze([0.301, -1.831, 0.405]);
export const carExhaust = (asset) => (asset?.parts?.[0]?.exhaust?.length === 3 ? asset.parts[0].exhaust : SPARE_EXHAUST);

/* Колёса без машины игры: база и размер обычной заднеприводной купе — дым
   встаёт там же, где встанет под машиной игрока. */
export const SPARE_WHEELS = Object.freeze([
  { id: "lf", position: [-0.695, 1.195, 0.295], radius: 0.295, width: 0.19 },
  { id: "rf", position: [0.695, 1.195, 0.295], radius: 0.295, width: 0.19 },
  { id: "lr", position: [-0.695, -1.195, 0.295], radius: 0.295, width: 0.19 },
  { id: "rr", position: [0.695, -1.195, 0.295], radius: 0.295, width: 0.19 },
]);

/*
 * Поверхности по роли: `x` — сколько света берёт, `y` — блик, `z` — его
 * узость, `w` — отражение по Френелю. Краска — лак (узкий блик, сильное
 * отражение), стекло — почти одно отражение, резина — матовая.
 */
const SURFACES = Object.freeze({
  paint: { surface: [1, 0.55, 90, 0.9] },
  trim: { surface: [0.9, 0.12, 30, 0.25] },
  glass: { surface: [0.6, 0.9, 160, 1], alpha: 0.62 },
  interior: { surface: [0.8, 0.02, 8, 0.05] },
  lights: { surface: [1, 0.6, 120, 0.6], lamps: true },
  badge: { surface: [1, 0.7, 60, 0.6], blend: true },
  decal: { surface: [1, 0.5, 80, 0.7], blend: true },
  tyre: { surface: [0.85, 0.05, 12, 0.08], colour: "#121213" },
  rim: { surface: [1, 0.9, 70, 0.75], colour: "#a9adb3" },
  hub: { surface: [0.9, 0.4, 40, 0.3], colour: "#3a3c40" },
});

const VERTEX = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec3 normal;
in vec2 uv;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
out vec2 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uEye;
uniform vec3 uColour;
uniform vec4 uSurface;
uniform float uAlpha;
uniform float uLamps;
uniform float uBrake;
uniform vec4 uFilmic0;
uniform vec4 uFilmic1;
uniform float uGamma;
uniform float uExposure;
uniform sampler2D uMap;
uniform float uHasMap;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
in vec2 vUv;
out vec4 outColour;
${INVERSE_FILMIC_GLSL}
/* Студия: верхний свет слева-спереди, слабый заполняющий справа-сзади. */
const vec3 KEY = vec3(-0.42, 0.33, 0.85);
const vec3 FILL = vec3(0.62, -0.52, 0.33);
const vec3 BOX = vec3(-0.18, 0.12, 0.98);

void main() {
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 v = normalize(uEye - vWorld);
  vec3 key = normalize(KEY);
  float hemi = 0.5 + 0.5 * n.z;
  /* Лист игры (sRGB, видеокарта отдаёт его линейным) — на цвет роли. */
  vec3 albedo = uColour;
  float alpha = uAlpha;
  if (uHasMap > 0.5) {
    vec4 texel = texture(uMap, vUv);
    albedo *= texel.rgb;
    alpha *= texel.a;
  }
  vec3 lit = albedo * (0.16 + 0.3 * hemi + 0.72 * max(dot(n, key), 0.0) + 0.22 * max(dot(n, normalize(FILL)), 0.0)) * uSurface.x;
  /* Отражение: тёмный пол снизу, светлое «небо» сверху и полоса софтбокса. */
  vec3 r = reflect(-v, n);
  vec3 env = mix(vec3(0.015), vec3(0.4), smoothstep(-0.1, 0.5, r.z));
  env += vec3(1.4) * smoothstep(0.86, 0.97, dot(r, normalize(BOX)));
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 spec = vec3(uSurface.y * pow(max(dot(n, normalize(key + v)), 0.0), uSurface.z));
  vec3 colour = lit + env * fresnel * uSurface.w + spec;
  /*
   * Мягкое плечо вместо обрезки в 1: белая краска на ключевом свете набирала
   * больше единицы, обратная плёночная кривая делала из неё огромную яркость, и
   * блум обводил машину белым ореолом и съедал светотень кузова. Плечо держит
   * краску ниже порога блума, тёмные краски почти не меняет. Огни — после плеча.
   */
  colour = 1.0 - exp(-colour * 1.1);
  /* Фары светят белым, задние огни — красным стоп-сигналом: на
     пробуксовке водитель держит тормоз. */
  if (uLamps > 0.5) {
    vec3 lamp = vLocal.y > 0.0 ? vec3(0.95, 0.93, 0.86) : mix(vec3(0.32, 0.02, 0.02), vec3(1.0, 0.05, 0.03), uBrake);
    colour = mix(colour, lamp, vLocal.y > 0.0 ? 0.55 : 0.85);
  }
  vec3 display = pow(clamp(colour, 0.0, 1.0), vec3(1.0 / 2.2));
  vec3 hdr = vec3(inverseFilmic(display.r), inverseFilmic(display.g), inverseFilmic(display.b)) / uExposure;
  outColour = vec4(hdr, alpha);
}
`;

/* Тень под машиной: мягкий прямоугольник, темнит пол (в HDR — множитель). */
const SHADOW_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec2 uHalf;
in vec3 vLocal;
out vec4 outColour;
void main() {
  vec2 edge = abs(vLocal.xy) / uHalf;
  float box = max(edge.x, edge.y * 0.92);
  float shade = (1.0 - smoothstep(0.55, 1.0, box)) * 0.78;
  outColour = vec4(0.0, 0.0, 0.0, shade);
}
`;

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/* Цвет материала — отображаемый (sRGB `#rrggbb`): в шейдер — линейным. */
function linearColour(hex) {
  const text = /^#[0-9a-f]{6}$/i.test(String(hex || "")) ? hex : "#808080";
  const channel = (at) => srgbToLinear(parseInt(text.slice(at, at + 2), 16) / 255);
  return new THREE.Vector3(channel(1), channel(3), channel(5));
}

function carMaterial(role, hex, shared, map = null) {
  const spec = SURFACES[role] || SURFACES.trim;
  const alpha = spec.alpha ?? 1;
  /* Наклейки и значки — лист с прозрачностью: смешиваются, глубину не пишут. Булево целиком: у роли без `blend` выражение
     давало `undefined`, и three писал «parameter 'transparent' has value of undefined» на каждый материал. */
  const blend = alpha < 1 || Boolean(spec.blend && map);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...shared,
      /* С листом цвет роли — множитель: белый, лист сам знает свой цвет. */
      uColour: { value: linearColour(map ? "#ffffff" : spec.colour || hex || "#808080") },
      uSurface: { value: new THREE.Vector4(...spec.surface) },
      uAlpha: { value: alpha },
      uLamps: { value: spec.lamps ? 1 : 0 },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
    },
    transparent: blend,
    depthTest: true,
    depthWrite: !blend,
    side: alpha < 1 ? THREE.DoubleSide : THREE.FrontSide,
    blending: blend ? THREE.NormalBlending : THREE.NoBlending,
  });
  return material;
}

function assetGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  if (mesh.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  if (!mesh.normals) geometry.computeVertexNormals();
  return geometry;
}

/**
 * Машина игры из ответа главного процесса (`readWheelSmokeCar`): GLB и опись
 * → опись кадра — сетки кузова и колеса, материалы с листами, колёса,
 * рамка, труба.
 */
export async function gameCarAsset(glb, car) {
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(glb, "", resolve, reject));
  const materials = [];
  const index = new Map();
  const meshes = [];
  const wheelMeshes = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const source = object.material;
    let at = index.get(source);
    if (at === undefined) {
      at = materials.length;
      index.set(source, at);
      const extras = source.userData || {};
      if (source.map) source.map.anisotropy = 8;
      materials.push({ id: extras.role || "trim", colour: extras.colour || null, texture: source.map || null });
    }
    const attributes = object.geometry.attributes;
    const entry = {
      positions: attributes.position.array,
      normals: attributes.normal?.array || null,
      uvs: attributes.uv?.array || null,
      indices: object.geometry.index.array,
      material: at,
    };
    (/^wheel/.test(object.name) ? wheelMeshes : meshes).push(entry);
  });
  if (!meshes.length) throw new Error("в модели машины нет кузова");
  return {
    source: "game",
    model: car.model,
    name: car.name,
    bounds: car.bounds,
    parts: [{ id: "car", model: car.model, bounds: car.bounds, wheels: car.wheels, exhaust: car.exhaust }],
    materials,
    meshes,
    wheelMeshes,
  };
}

/*
 * Колесо вдоль оси X: шина — тело вращения со скруглённым профилем, диск —
 * обод и пять спиц с наружной стороны (`side` — +1 справа, −1 слева):
 * по спицам видно, что колесо крутится.
 */
function wheelParts(wheel, side) {
  const radius = wheel.radius;
  const width = wheel.width;
  const rim = radius * 0.68;
  const round = Math.min(width * 0.28, radius * 0.16);
  const half = width / 2;
  const profile = [
    new THREE.Vector2(rim, -half * 0.9),
    new THREE.Vector2(radius - round, -half),
    new THREE.Vector2(radius - round * 0.3, -half + round * 0.3),
    new THREE.Vector2(radius, -half + round),
    new THREE.Vector2(radius, half - round),
    new THREE.Vector2(radius - round * 0.3, half - round * 0.3),
    new THREE.Vector2(radius - round, half),
    new THREE.Vector2(rim, half * 0.9),
  ];
  /* Тело вращения three.js — вокруг Y; колесу нужна ось X. */
  const tyre = new THREE.LatheGeometry(profile, 40);
  tyre.rotateZ(-Math.PI / 2);
  const barrel = new THREE.CylinderGeometry(rim, rim, width * 0.86, 28, 1, true);
  barrel.rotateZ(Math.PI / 2);
  const face = side * (half * 0.62);
  const spokes = [];
  for (let index = 0; index < 5; index += 1) {
    const spoke = new THREE.BoxGeometry(width * 0.16, rim * 0.92, rim * 0.2);
    spoke.translate(0, rim * 0.48, 0);
    spoke.rotateX((index * Math.PI * 2) / 5);
    spoke.translate(face, 0, 0);
    spokes.push(spoke);
  }
  const lip = new THREE.TorusGeometry(rim * 0.97, rim * 0.05, 8, 32);
  lip.rotateY(Math.PI / 2);
  lip.translate(face, 0, 0);
  const hub = new THREE.CylinderGeometry(rim * 0.24, rim * 0.24, width * 0.3, 16);
  hub.rotateZ(Math.PI / 2);
  hub.translate(face - side * width * 0.08, 0, 0);
  return { tyre, rim: [barrel, lip, ...spokes], hub };
}

/**
 * Машина на сцене. `asset` — машина игры (`gameCarAsset`) или `null` (игры
 * нет — только колёса Astral, а подпись кадра просит подключить игру).
 * Возвращает объект сцены и ручки: краска, положение, колёса, свет кадра.
 */
export function createWheelSmokeCar(asset, { paint = CAR_PAINTS[0].colour } = {}) {
  const shared = {
    uEye: { value: new THREE.Vector3() },
    uBrake: { value: 1 },
    uFilmic0: { value: new THREE.Vector4(0.22, 0.3, 0.1, 0.2) },
    uFilmic1: { value: new THREE.Vector4(0.01, 0.3, 4, 0) },
    uGamma: { value: 2.2 },
    uExposure: { value: 1 },
  };
  const disposables = [];
  const root = new THREE.Group();
  root.name = "wheel-smoke-car";
  /* Кузов чуть «дышит» на пробуксовке: свой узел, колёса стоят на земле. */
  const body = new THREE.Group();
  root.add(body);
  const paints = [];

  /* Материалы — по номеру описи: кузов и колесо делят их, как в игре. */
  const materials = new Map();
  const materialOf = (at) => {
    if (!materials.has(at)) {
      const info = asset.materials[at] || {};
      const role = SURFACES[info.id] ? info.id : "trim";
      const material = carMaterial(role, info.colour, shared, info.texture || null);
      if (role === "paint") {
        material.uniforms.uColour.value = linearColour(paint);
        paints.push(material);
      }
      if (info.texture) disposables.push(info.texture);
      disposables.push(material);
      materials.set(at, material);
    }
    return materials.get(at);
  };

  for (const mesh of asset?.meshes || []) {
    const geometry = assetGeometry(mesh);
    const material = materialOf(mesh.material);
    const object = new THREE.Mesh(geometry, material);
    object.frustumCulled = false;
    /* Стекло и наклейки — после кузова и до частиц (прозрачное идёт по порядку). */
    if (material.transparent) object.renderOrder = -1;
    body.add(object);
    disposables.push(geometry);
  }

  /* Колесо игры: одна сетка на четыре места. */
  const wheelModel = (asset?.wheelMeshes || []).map((mesh) => {
    const geometry = assetGeometry(mesh);
    disposables.push(geometry);
    return { geometry, material: materialOf(mesh.material) };
  });

  const wheelsSpec = carWheels(asset);
  const wheels = new Map();
  /* Без машины игры колёса рисует Astral. */
  const drawn = wheelModel.length
    ? null
    : {
        tyre: carMaterial("tyre", null, shared),
        rim: carMaterial("rim", null, shared),
        hub: carMaterial("hub", null, shared),
      };
  if (drawn) disposables.push(drawn.tyre, drawn.rim, drawn.hub);
  for (const wheel of wheelsSpec) {
    const side = wheel.position[0] >= 0 ? 1 : -1;
    const pivot = new THREE.Group();
    pivot.position.set(...wheel.position);
    pivot.rotation.order = "ZYX";
    const add = (parent, geometry, material) => {
      const object = new THREE.Mesh(geometry, material);
      object.frustumCulled = false;
      parent.add(object);
    };
    if (drawn) {
      const parts = wheelParts(wheel, side);
      add(pivot, parts.tyre, drawn.tyre);
      for (const geometry of parts.rim) add(pivot, geometry, drawn.rim);
      add(pivot, parts.hub, drawn.hub);
      disposables.push(parts.tyre, ...parts.rim, parts.hub);
    } else {
      /* Колесо игры — левое: правые — его зеркало по оси вращения. */
      const mirror = new THREE.Group();
      if (side > 0) mirror.scale.x = -1;
      for (const part of wheelModel) add(mirror, part.geometry, part.material);
      pivot.add(mirror);
    }
    root.add(pivot);
    wheels.set(wheel.id, { spec: wheel, pivot, spin: 0 });
  }

  /* Тень — под всей машиной, на 2 мм выше пола. */
  const bounds = asset?.bounds || { min: [-0.92, -2.17, 0], max: [0.92, 2.04, 1.3] };
  const halfX = (bounds.max[0] - bounds.min[0]) / 2 + 0.22;
  const halfY = (bounds.max[1] - bounds.min[1]) / 2 + 0.2;
  const shadowGeometry = new THREE.PlaneGeometry(halfX * 2, halfY * 2);
  const shadowMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: SHADOW_FRAGMENT,
    uniforms: { uHalf: { value: new THREE.Vector2(halfX, halfY) } },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  /* Узлом, а не сдвигом сетки: шейдер меряет край от середины тени. */
  shadow.position.set(0, (bounds.max[1] + bounds.min[1]) / 2, 0.002);
  shadow.frustumCulled = false;
  shadow.renderOrder = -2;
  root.add(shadow);
  disposables.push(shadowGeometry, shadowMaterial);

  return {
    object: root,
    wheels: [...wheels.values()].map((item) => item.spec),
    /** Краска кузова — отображаемый цвет `#rrggbb`. */
    setPaint(hex) {
      const value = linearColour(hex);
      for (const material of paints) material.uniforms.uColour.value.copy(value);
    },
    /** Где машина: точка начала на земле и курс (радианы от +Y к −X). */
    setPose(position, heading) {
      root.position.set(position[0], position[1], 0);
      root.rotation.set(0, 0, heading);
    },
    /** Кузов над колёсами: дрожь пробуксовки, метры. */
    setBodyOffset(z, pitch = 0) {
      body.position.z = z;
      body.rotation.x = pitch;
    },
    /* Колёса: поворот вокруг оси (`spin`, рад) и руль у передних. */
    setWheel(id, spin, steer = 0) {
      const wheel = wheels.get(id);
      if (!wheel) return;
      wheel.pivot.rotation.set(spin, 0, steer);
    },
    /** Стоп-сигнал: 0 — погашен, 1 — горит. */
    setBrake(value) {
      shared.uBrake.value = value;
    },
    /** Кривая и экспозиция кадра (`filmicUniforms`) и глаз камеры. */
    setLighting(uniforms) {
      if (uniforms.uFilmic0) shared.uFilmic0.value.set(...uniforms.uFilmic0);
      if (uniforms.uFilmic1) shared.uFilmic1.value.set(...uniforms.uFilmic1);
      if (Number.isFinite(uniforms.uGamma)) shared.uGamma.value = uniforms.uGamma;
      if (Number.isFinite(uniforms.uExposure)) shared.uExposure.value = uniforms.uExposure;
    },
    setEye(position) {
      shared.uEye.value.set(position.x, position.y, position.z);
    },
    dispose() {
      for (const item of disposables) item.dispose();
      disposables.length = 0;
    },
  };
}
