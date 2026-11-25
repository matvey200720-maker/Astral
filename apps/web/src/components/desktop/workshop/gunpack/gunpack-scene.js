// Фотостудия ганпака: показывает разобранный ствол и снимает ровный кадр 16:9.
// Кадры рисуются по требованию, стоящая сцена видеокарту не грузит.
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoColorSpace,
  PMREMGenerator,
  PerspectiveCamera,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EMISSIVE_STRENGTH } from "@modovik/gunpack/shader-colour";
import {
  STAGE_LIGHTING,
  STUDIO_FINISHES,
  STUDIO_LIGHTING,
  createStudioEnvironment,
  finishShader,
  reflectLayerShader,
} from "../gun/lighting.js";
import { NEUTRAL_LOOK } from "./frame-light.js";
import { seeThroughOf } from "./see-through.js";
import { tr } from "../../../../locales/ui.js";
import { trKey } from "../gun/gun-copy.js";
import {
  claimWindowRenderer,
  releaseGpu,
  releaseWindowRenderer,
} from "../../../../features/workshop/engine/window-renderer.js";
import {
  createSceneWarmup,
  skipShaderChecks,
} from "../../../../features/workshop/model-stage/shader-warmup.js";
import {
  profilePixelRatio,
  qualityProfile,
} from "../../../../features/workshop/model-stage/quality-profile.js";

// ---------------------------------------------------------------- данные

export const SHOT_ANGLES = Object.freeze(
  [
    ["profile", trKey("Профиль"), [0, 0.02, 1]],
    ["three-quarter", trKey("Три четверти"), [0.42, 0.24, 1]],
    ["top", trKey("Сверху"), [0.08, 1, 0.32]],
    ["muzzle", trKey("С дула"), [1, 0.22, 0.62]],
  ].map(([id, label, direction]) => ({ id, label, direction })),
);

export const SHOT_BACKGROUNDS = Object.freeze(
  [
    ["transparent", trKey("Прозрачный"), null],
    ["astral", "Astral", "#0c0c0c", true],
    ["grey", trKey("Серый"), "#b9bcc2"],
    ["dark", trKey("Тёмный"), "#15171b"],
    ["light", trKey("Светлый"), "#eef0f3"],
  ].map(([id, label, color, matte]) => (matte ? { id, label, color, matte } : { id, label, color })),
);

export const SHOT_LIGHTS = Object.freeze(
  [
    ["studio", trKey("Студия")],
    ["day", trKey("День")],
    ["night", trKey("Ночь")],
  ].map(([id, label]) => ({ id, label })),
);

export const SHOT_SIZE = Object.freeze({ width: 1600, height: 900 });

export const DARK_ALBEDO = Object.freeze({ visible: 0.16, black: 0.04 });
export const DARK_LIFT_MAX = 0.4;

const FOV = 30;
const FIT_MARGIN = 1.14;
const MIN_DISTANCE = 0.05;
const OVERHEAD_FROM = 0.92;
const WORLD_UP = { level: [0, 1, 0], overhead: [0, 0, -1] };
const MAX_ANISOTROPY = 8;
const REFLECT_ENV_SHARE = 0.25;

// Роль текстуры → её цветовой режим.
const TEXTURE_SPACES = {
  diffuse: SRGBColorSpace,
  normal: NoColorSpace,
  emissive: SRGBColorSpace,
  environment: SRGBColorSpace,
};

// Прямые лампы сцены: цвет, сила, положение при создании.
const DIRECTIONAL_LAMPS = {
  key: [0xffffff, 2, [2.4, 3.2, 2.8]],
  fill: [0xbfd4ff, 0.8, [-3, 1.2, -2.4]],
  rim: [0xffffff, 0.9, [-1.5, 2, -3.5]],
};

// Свет каталога: прибавка за единицу подъёма тёмной модели.
const STAGE_GAIN = {
  lamps: { key: 0.15, fill: 1.2, rim: 1.4 },
  ambient: 0.45,
  environment: 1.6,
  exposure: 0.2,
};

// Свет каталога в осях взгляда: доли вправо, вверх, назад.
const AIM_RIG = {
  key: [0.6, 0.8, 0.7],
  fill: [-0.9, 0.1, 0.5],
  rim: [-0.35, 0.6, -0.9],
};
const AIM_DISTANCE = 10;

// Режим прозрачности → правка материала.
const ALPHA_RULES = new Map([
  ["mask", (material) => Object.assign(material, { alphaTest: 0.5 })],
  ["blend", (material) => Object.assign(material, { transparent: true, depthWrite: false })],
]);

// ---------------------------------------------------------------- светлота текстур

const LUMA = [0.2126, 0.7152, 0.0722];
const ALPHA_FLOOR = 128;
const SAMPLE_AREA = 4096;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

// Смещения выбранных пикселей в rgba: сетка с шагом по площади, строка за строкой.
function* gridOffsets(width, height) {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / SAMPLE_AREA)));
  for (let row = 0; row < height; row += step) {
    for (let col = 0; col < width; col += step) yield (row * width + col) * 4;
  }
}

function addImage(tally, { width, height, rgba }) {
  for (const at of gridOffsets(width, height)) {
    if (rgba[at + 3] < ALPHA_FLOOR) continue;
    tally.sum += LUMA.reduce((acc, weight, channel) => acc + weight * rgba[at + channel], 0) / 255;
    tally.count += 1;
  }
}

export function albedoLuminance(parsed) {
  const diffuseKeys = new Set(
    (parsed?.meshes || [])
      .filter((mesh) => !mesh.material?.textures?.environment)
      .map((mesh) => mesh.material?.textures?.diffuse)
      .filter(Boolean),
  );
  const tally = { sum: 0, count: 0 };
  for (const image of parsed?.images || []) {
    if (diffuseKeys.has(image.key) && image.rgba) addImage(tally, image);
  }
  return tally.count > 0 ? tally.sum / tally.count : null;
}

export function darkLift(luminance) {
  if ([null, undefined].includes(luminance)) return 0;
  const { visible, black } = DARK_ALBEDO;
  return clamp01((visible - luminance) / (visible - black));
}

// ---------------------------------------------------------------- вписывание камеры

const boxAround = (half, centre = [0, 0, 0]) =>
  new Box3(
    new Vector3(...centre.map((c, i) => c - half[i])),
    new Vector3(...centre.map((c, i) => c + half[i])),
  );

const defaultBox = () => new Box3(new Vector3(-0.5, -0.1, -0.03), new Vector3(0.5, 0.1, 0.03));
const fallbackBox = () => boxAround([0.05, 0.05, 0.05]);

// Дистанция, с которой весь габарит влезает в кадр с полем; direction — единичный.
function measureFrame(box, direction, aspect, fov) {
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  const forward = direction.clone().multiplyScalar(-1);
  const worldUp = new Vector3(...WORLD_UP[Math.abs(direction.y) > OVERHEAD_FROM ? "overhead" : "level"]);
  const right = new Vector3().crossVectors(forward, worldUp).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  const center = box.getCenter(new Vector3());
  const spans = [[box.min.x, box.max.x], [box.min.y, box.max.y], [box.min.z, box.max.z]];
  const corners = spans[0].flatMap((x) =>
    spans[1].flatMap((y) => spans[2].map((z) => new Vector3(x, y, z))),
  );
  const distance = corners.reduce((best, corner) => {
    const offset = corner.sub(center);
    const depth = offset.dot(forward);
    return Math.max(
      best,
      (FIT_MARGIN * Math.abs(offset.dot(right))) / (tanHalf * aspect) - depth,
      (FIT_MARGIN * Math.abs(offset.dot(up))) / tanHalf - depth,
    );
  }, MIN_DISTANCE);
  return { center, distance, worldUp };
}

const setClipRange = (camera, distance) =>
  Object.assign(camera, { near: Math.max(0.001, distance / 200), far: distance * 40 });

// Размер живого вида: родитель, иначе сам холст, иначе единица.
function hostSize(canvas) {
  const parent = canvas.parentElement;
  return ["clientWidth", "clientHeight"].map((side) =>
    Math.max(1, parent?.[side] || canvas[side] || 1),
  );
}

// ---------------------------------------------------------------- рендерер, камера, окружение

// Общий рендерер окна, если его отдают и у холста есть 2D-контекст.
function borrowWindowRenderer(canvas, owner, profile) {
  const lease = claimWindowRenderer(owner, { antialias: profile.antialias, strict: false });
  if (!lease) return null;
  if (canvas.getContext("2d")) return lease;
  releaseWindowRenderer(owner);
  return null;
}

function openRenderer(canvas, owner, share, profile) {
  const lease = share ? borrowWindowRenderer(canvas, owner, profile) : null;
  if (lease) return { renderer: lease.renderer, lease };
  const renderer = new WebGLRenderer({
    canvas,
    antialias: profile.antialias,
    alpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  skipShaderChecks(renderer);
  return { renderer, lease: null };
}

function buildEnvironment(renderer, stage) {
  if (stage) return { generator: null, texture: createStudioEnvironment(renderer) };
  const generator = new PMREMGenerator(renderer);
  return { generator, texture: generator.fromScene(new RoomEnvironment(), 0.02).texture };
}

function createView(canvas) {
  const camera = new PerspectiveCamera(FOV, 1, 0.005, 60);
  const controls = Object.assign(new OrbitControls(camera, canvas), {
    enableDamping: true,
    dampingFactor: 0.1,
    enablePan: false,
  });
  return { camera, controls };
}

// ---------------------------------------------------------------- сборка модели

const VERTEX_SLOTS = [
  { name: "position", field: "positions", size: 3, always: true },
  { name: "normal", field: "normals", size: 3 },
  { name: "uv", field: "uvs", size: 2 },
];

function buildGeometry(source) {
  const geometry = new BufferGeometry();
  VERTEX_SLOTS.filter((slot) => slot.always || source[slot.field]).forEach((slot) =>
    geometry.setAttribute(slot.name, new BufferAttribute(source[slot.field], slot.size)),
  );
  geometry.setIndex(new BufferAttribute(source.indices, 1));
  if (!source.normals) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

const TEXTURE_SAMPLING = {
  flipY: false,
  wrapS: RepeatWrapping,
  wrapT: RepeatWrapping,
  generateMipmaps: true,
  minFilter: LinearMipmapLinearFilter,
  magFilter: LinearFilter,
};

function buildDataTexture(image, colorSpace, renderer) {
  const texture = new DataTexture(image.rgba, image.width, image.height, RGBAFormat, UnsignedByteType);
  return Object.assign(texture, {
    colorSpace,
    ...TEXTURE_SAMPLING,
    anisotropy: Math.min(MAX_ANISOTROPY, renderer.capabilities.getMaxAnisotropy()),
    needsUpdate: true,
  });
}

// Текстуры одной загрузки: пара «ключ + цветовой режим» строится один раз.
export class TextureBank {
  constructor(images, renderer) {
    this.renderer = renderer;
    this.byKey = images.reduce(
      (index, image) => (index.has(image.key) ? index : index.set(image.key, image)),
      new Map(),
    );
    this.made = new Map();
  }

  // Лист без прозрачных точек. Части без листа не считаются: у стёкол прозрачность может идти из материала.
  opaqueSheet(key) {
    const image = key ? this.byKey.get(key) : undefined;
    return Boolean(image) && !seeThroughOf(image);
  }

  take(key, role) {
    const image = key ? this.byKey.get(key) : undefined;
    if (!image) return null;
    const space = TEXTURE_SPACES[role];
    if (!this.made.has(space)) this.made.set(space, new Map());
    const perKey = this.made.get(space);
    if (!perKey.has(key)) perKey.set(key, buildDataTexture(image, space, this.renderer));
    return perKey.get(key);
  }
}

// Слои материала по порядку; job несёт описание сетки, банк текстур и накопленную правку шейдера.
const MATERIAL_LAYERS = [
  (material, job) => {
    if (!job.finish) return;
    const { roughness, metalness, envMapIntensity, iblDiffuse } = job.finish;
    Object.assign(material, { roughness, metalness, envMapIntensity });
    job.fix = finishShader(iblDiffuse);
  },
  (material, job) => {
    const sheet = job.bank.take(job.textures.environment, "environment");
    if (!sheet) return;
    job.fix = reflectLayerShader(sheet, job.spec.reflectivePower, job.fix);
    material.envMapIntensity *= REFLECT_ENV_SHARE;
    material.userData.reflectMap = sheet;
  },
  (material, job) => {
    const { fix } = job;
    if (!fix) return;
    Object.assign(material, {
      onBeforeCompile: (shader) => fix.patch(shader),
      customProgramCacheKey: () => fix.key,
    });
  },
  (material, job) => {
    const normalMap = job.bank.take(job.textures.normal, "normal");
    if (!normalMap) return;
    material.normalMap = normalMap;
    material.normalScale.set(1, -1);
  },
  (material, job) => {
    const { alphaMode } = job.spec;
    // «blend» с непрозрачным листом смешивать нечего: без записи глубины видно часть, нарисованную последней (белая вывернутая оболочка поверх ствола).
    if (alphaMode === "blend" && job.bank.opaqueSheet(job.textures.diffuse)) return;
    ALPHA_RULES.get(alphaMode)?.(material);
  },
  (material, job) => {
    if (!job.spec.emissive) return;
    material.emissive.set(0xffffff);
    Object.assign(material, {
      emissiveMap: job.bank.take(job.textures.emissive, "emissive") || job.map,
      emissiveIntensity: EMISSIVE_STRENGTH,
    });
  },
];

export function buildMaterial(source, bank, finish) {
  const spec = source.material;
  const { textures } = spec;
  const map = bank.take(textures.diffuse, "diffuse");
  const material = new MeshStandardMaterial({
    color: map ? 0xffffff : 0x8b9099,
    map,
    metalness: 0.45,
    roughness: 0.48,
    side: source.invertedHull ? FrontSide : DoubleSide,
  });
  const job = { spec, textures, bank, finish, map, fix: null };
  MATERIAL_LAYERS.forEach((layer) => layer(material, job));
  return material;
}

// Всё, что надо освободить у каждой сетки, по порядку: геометрия, карты, лист отражения, материал.
function releaseModel(group) {
  group.children
    .flatMap(({ geometry, material }) => [
      geometry,
      material.map,
      material.normalMap,
      material.emissiveMap,
      material.userData.reflectMap,
      material,
    ])
    .forEach((item) => item?.dispose());
}

// ---------------------------------------------------------------- свет

const presetOf = (table, id) => (Object.hasOwn(table, id) ? table[id] : table.studio);

function createLamps() {
  const directional = Object.entries(DIRECTIONAL_LAMPS).map(([name, [color, power, at]]) => {
    const light = new DirectionalLight(color, power);
    light.position.set(...at);
    return [name, light];
  });
  return Object.fromEntries([
    ...directional,
    ["ambient", new AmbientLight(0xffffff, 0.35)],
    ["holder", new Group()],
  ]);
}

// Красит названные лампы цветом пресета; силу даёт powerOf(имя, сила пресета).
function tintLamps(lamps, preset, names, powerOf) {
  names.forEach((name) => {
    const [color, base] = preset[name];
    lamps[name].color.set(color);
    lamps[name].intensity = powerOf(name, base);
  });
}

function settleScene({ scene, renderer, lamps }, ambient, environment, exposure) {
  lamps.ambient.intensity = ambient;
  scene.environmentIntensity = environment;
  renderer.toneMappingExposure = exposure;
}

// Свет студии ганпаков: пресет как есть, контровой зависит только от ночи.
function lightForStudio(rig, id) {
  const preset = presetOf(STUDIO_LIGHTING, id);
  tintLamps(rig.lamps, preset, ["key", "fill"], (name, base) => base);
  rig.lamps.rim.intensity = id === "night" ? 0.35 : 0.9;
  settleScene(rig, preset.ambient, preset.environment, preset.exposure);
}

// Свет каталога: пресет, подъём для тёмной модели и множители автора.
function lightForStage(rig, id, lift, look) {
  const preset = presetOf(STAGE_LIGHTING, id);
  tintLamps(
    rig.lamps,
    preset,
    ["key", "fill", "rim"],
    (name, base) => base * (1 + STAGE_GAIN.lamps[name] * lift) * look[name],
  );
  settleScene(
    rig,
    (preset.ambient + STAGE_GAIN.ambient * lift) * look.ambient,
    preset.environment * (1 + STAGE_GAIN.environment * lift) * look.environment,
    preset.exposure * (1 + STAGE_GAIN.exposure * lift) * look.exposure,
  );
}

// Углы поворота окружения по смещению камеры от цели.
function environmentAngles({ x, y, z }) {
  const elevation = Math.atan2(y, Math.hypot(x, z));
  return [-(elevation - 0.2) * 0.85, -Math.atan2(x, z), 0];
}

// Ставит свет каталога в оси взгляда камеры и поворачивает окружение вслед.
function aimStageLight(scene, lamps, camera, target) {
  camera.updateMatrixWorld();
  const axes = [new Vector3(), new Vector3(), new Vector3()];
  camera.matrixWorld.extractBasis(...axes);
  Object.entries(AIM_RIG).forEach(([name, shares]) => {
    const spot = shares.reduce((sum, share, i) => sum.addScaledVector(axes[i], share), new Vector3());
    lamps[name].position.copy(spot.normalize().multiplyScalar(AIM_DISTANCE));
  });
  const offset = new Vector3().subVectors(camera.position, target);
  scene.environmentRotation.set(...environmentAngles(offset), "YXZ");
}

// ---------------------------------------------------------------- кадр: холст и байты

// Сжимает рисунок в плотности профиля на новый холст точно в размер кадра.
function flattenCanvas(source, width, height) {
  const flat = Object.assign(document.createElement("canvas"), { width, height });
  const context = flat.getContext("2d");
  Object.assign(context, { imageSmoothingEnabled: true, imageSmoothingQuality: "high" });
  context.drawImage(source, 0, 0, width, height);
  return flat.toDataURL("image/png");
}

function decodePng(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const findById = (list, id, fallback) => list.find((item) => item.id === id) ?? fallback;

// ---------------------------------------------------------------- очередь кадров

class FrameLoop {
  constructor(isOpen, paint) {
    this.isOpen = isOpen;
    this.paint = paint;
    this.handle = null;
    this.queue = this.queue.bind(this);
  }

  queue() {
    if (!this.isOpen() || this.handle !== null) return;
    this.handle = requestAnimationFrame(() => {
      this.handle = null;
      this.paint();
    });
  }

  cancel() {
    if (this.handle === null) return;
    cancelAnimationFrame(this.handle);
    this.handle = null;
  }
}

// Закрытие сцены по шагам; последний выбирает рендерер окна или свой.
const SHUTDOWN = [
  (studio) => studio.lease?.keepPrograms(),
  (studio) => studio.warmup.stop(),
  (studio) => studio.loop.cancel(),
  (studio) => studio.observer?.disconnect(),
  (studio) => studio.controls.dispose(),
  (studio) => {
    if (studio.model) releaseModel(studio.model);
  },
  (studio) => studio.environment.dispose(),
  (studio) => studio.generator?.dispose(),
  (studio) => (studio.lease ? studio.releaseShared() : studio.releaseOwn()),
];

// ---------------------------------------------------------------- студия

class GunpackStudio {
  constructor(canvas, { stage, share, quality }) {
    this.canvas = canvas;
    this.stage = stage;
    this.profile = qualityProfile(stage ? quality : "auto");
    this.owner = {};
    const opened = openRenderer(canvas, this.owner, share, this.profile);
    this.renderer = opened.renderer;
    this.lease = opened.lease;
    this.renderer.setPixelRatio(profilePixelRatio(this.profile));
    Object.assign(this.renderer, {
      outputColorSpace: SRGBColorSpace,
      toneMapping: stage ? NeutralToneMapping : ACESFilmicToneMapping,
    });

    this.scene = new Scene();
    const environment = buildEnvironment(this.renderer, stage);
    this.generator = environment.generator;
    this.environment = environment.texture;
    this.scene.environment = this.environment;

    Object.assign(this, createView(canvas));
    this.lamps = createLamps();
    Object.values(this.lamps).forEach((item) => this.scene.add(item));
    this.holder = this.lamps.holder;

    Object.assign(this, {
      closed: false,
      parked: false,
      angle: SHOT_ANGLES[0],
      background: SHOT_BACKGROUNDS[0],
      lightId: "studio",
      model: null,
      box: defaultBox(),
      look: { ...NEUTRAL_LOOK },
      lift: 0,
    });

    this.loop = new FrameLoop(() => !this.closed, () => this.paintLive());
    this.queue = this.loop.queue;
    this.warmup = createSceneWarmup({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      alive: () => !this.closed,
      onReady: this.queue,
    });
    this.controls.addEventListener("change", this.queue);
    this.controls.addEventListener("start", () => {
      this.parked = false;
    });

    this.observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.observer?.observe(canvas.parentElement || canvas);
    this.resize();
    this.setBackground(SHOT_BACKGROUNDS[0].id);
    this.setLighting("studio");
    this.warmup.warm();
  }

  // --- вид

  show(camera) {
    this.renderer.render(this.scene, camera);
    this.lease?.present(this.canvas);
  }

  paintLive() {
    if (this.closed || !this.warmup.ready) return;
    const moved = this.controls.update();
    this.show(this.camera);
    if (moved) this.queue();
  }

  parkCamera() {
    const { camera, controls } = this;
    const direction = new Vector3(...this.angle.direction).normalize();
    const view = measureFrame(this.box, direction, camera.aspect, camera.fov);
    camera.position.copy(view.center).addScaledVector(direction, view.distance);
    camera.up.copy(view.worldUp);
    setClipRange(camera, view.distance);
    camera.updateProjectionMatrix();
    controls.target.copy(view.center);
    Object.assign(controls, { minDistance: view.distance * 0.3, maxDistance: view.distance * 6 });
    controls.update();
    this.parked = true;
  }

  paintClear(background) {
    const [color, alpha] = background.color ? [background.color, 1] : [0x000000, 0];
    this.renderer.setClearColor(color, alpha);
  }

  relight() {
    if (!this.stage) {
      lightForStudio(this, this.lightId);
      return;
    }
    lightForStage(this, this.lightId, this.lift, this.look);
    const glow = EMISSIVE_STRENGTH * this.look.emissive;
    (this.model?.children ?? [])
      .filter((mesh) => mesh.material.emissiveMap)
      .forEach((mesh) => {
        mesh.material.emissiveIntensity = glow;
      });
  }

  aimAt(camera) {
    if (this.stage) aimStageLight(this.scene, this.lamps, camera, this.controls.target);
  }

  // --- модель

  retire() {
    this.holder.remove(this.model);
    releaseModel(this.model);
  }

  assemble(parsed) {
    const bank = new TextureBank(parsed.images, this.renderer);
    const finish = this.stage ? STUDIO_FINISHES.metal : null;
    const totals = { positions: 0, indices: 0 };
    const group = new Group();
    parsed.meshes
      .map((source) => {
        totals.positions += source.positions.length;
        totals.indices += source.indices.length;
        const mesh = new Mesh(buildGeometry(source), buildMaterial(source, bank, finish));
        mesh.renderOrder = source.material.alphaMode === "blend" ? 1 : 0;
        return mesh;
      })
      .forEach((mesh) => group.add(mesh));
    return { group, totals };
  }

  setModel(parsed) {
    if (this.model) this.retire();
    const { group, totals } = this.assemble(parsed);
    this.model = group;
    this.holder.add(group);

    this.look = { ...NEUTRAL_LOOK };
    if (this.stage) {
      this.lift = darkLift(albedoLuminance(parsed)) * DARK_LIFT_MAX;
      this.relight();
    }
    const measured = new Box3().setFromObject(group);
    this.box = measured.isEmpty() ? fallbackBox() : measured;
    this.parkCamera();
    this.warmup.warm();
    this.queue();
    return {
      vertices: totals.positions / 3,
      triangles: totals.indices / 3,
      length: this.box.max.x - this.box.min.x,
      lift: this.lift,
    };
  }

  setLook(next) {
    this.look = { ...NEUTRAL_LOOK, ...next };
    if (!this.stage) return;
    this.relight();
    this.queue();
  }

  clear() {
    if (this.model) {
      this.retire();
      this.model = null;
    }
    this.queue();
  }

  // --- ракурс, фон, свет, размер

  setAngle(id) {
    this.angle = findById(SHOT_ANGLES, id, SHOT_ANGLES[0]);
    this.parkCamera();
    this.queue();
  }

  setBackground(id) {
    this.background = findById(SHOT_BACKGROUNDS, id, SHOT_BACKGROUNDS[0]);
    this.paintClear(this.background);
    this.queue();
  }

  setLighting(id) {
    this.lightId = id;
    this.relight();
    this.queue();
  }

  resize() {
    const [width, height] = hostSize(this.canvas);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.model && this.parked) this.parkCamera();
    this.queue();
  }

  // --- кадр

  // Камера кадра — копия живой, но с формой кадра и тем же направлением взгляда.
  createShotCamera(aspect) {
    const { camera, controls } = this;
    const shot = camera.clone();
    shot.aspect = aspect;
    const heading = new Vector3().subVectors(camera.position, controls.target).normalize();
    const view = measureFrame(this.box, heading, aspect, shot.fov);
    shot.up.copy(camera.up);
    shot.position.copy(view.center).addScaledVector(heading, view.distance);
    shot.lookAt(view.center);
    setClipRange(shot, view.distance);
    shot.updateProjectionMatrix();
    return shot;
  }

  snapshot({ width = SHOT_SIZE.width, height = SHOT_SIZE.height, backgroundId } = {}) {
    if (!this.model) throw new Error(tr("Нечего снимать: ствол ещё не открыт."));
    const { renderer, canvas } = this;
    const frameBackground = findById(SHOT_BACKGROUNDS, backgroundId, this.background);
    const live = { size: renderer.getSize(new Vector2()), ratio: renderer.getPixelRatio() };
    const shot = this.createShotCamera(width / height);
    const grabbed = [];

    // Шаги идут подряд; сбой посреди оставляет рендерер как есть.
    [
      () => this.aimAt(shot),
      () => renderer.setPixelRatio(this.stage ? this.profile.pixelRatio : 1),
      () => renderer.setSize(width, height, false),
      () => this.paintClear(frameBackground),
      () => this.show(shot),
      () => grabbed.push(this.stage ? flattenCanvas(canvas, width, height) : canvas.toDataURL("image/png")),
      () => renderer.setPixelRatio(live.ratio),
      () => renderer.setSize(live.size.x, live.size.y, false),
      () => this.paintClear(this.background),
      () => this.aimAt(this.camera),
      () => this.show(this.camera),
    ].forEach((step) => step());
    return decodePng(grabbed[0]);
  }

  // --- закрытие

  releaseShared() {
    releaseGpu(this.scene, null);
    this.renderer.renderLists.dispose();
    releaseWindowRenderer(this.owner);
    this.lease = null;
  }

  releaseOwn() {
    this.renderer.dispose();
    if (!this.renderer.domElement?.isConnected) this.renderer.forceContextLoss?.();
  }

  dispose() {
    this.closed = true;
    SHUTDOWN.forEach((step) => step(this));
  }
}

const SCENE_METHODS = [
  "setModel",
  "setLook",
  "clear",
  "setAngle",
  "setBackground",
  "setLighting",
  "resize",
  "snapshot",
  "dispose",
];

export function createGunpackScene(canvas, options = {}) {
  const { stage = false, share = !stage, quality = "high" } = options;
  const studio = new GunpackStudio(canvas, { stage, share, quality });
  return Object.fromEntries(SCENE_METHODS.map((name) => [name, studio[name].bind(studio)]));
}
