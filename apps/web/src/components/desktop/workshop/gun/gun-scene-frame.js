// Зона Z1: каркас сцены — рендерер, сцена, камера, управление, свет, цикл кадров,
// прогрев, слой украшений, resize и освобождение дерева модели.
// createFrame собирает общий объект состояния ctx; перечень его полей и реестра ctx.ops — у createFrame внизу файла.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { trackOrbitView } from "../../../../features/hibernation/stage-views.js";
import {
  claimWindowRenderer,
  releaseWindowRenderer,
} from "../../../../features/workshop/engine/window-renderer.js";
import { createSceneWarmup, skipShaderChecks } from "../../../../features/workshop/model-stage/shader-warmup.js";
import {
  profilePixelRatio,
  qualityProfile,
} from "../../../../features/workshop/model-stage/quality-profile.js";
import { markWheel } from "../../../ui/wheel-mark.js";
import { STAGE_IDLE, startStageLoop } from "../stage-loop.js";

import { createDecalBaker } from "./gun-decals.js";
import { createDecorationLayer } from "./gun-decoration-layer.js";
import { perfMark } from "./gun-scene-pure.js";
import { createTextureCache, textureReusePlugin } from "./gun-texture-cache.js";
import { STAGE_LIGHTING, createStudioEnvironment } from "./lighting.js";
import { createPoseTempo, sceneFrameWait } from "./pose-tempo.js";
import { computeSkinnedBounds } from "./skinned-bounds.js";

// Объектив камеры и её начальное место: перед оружием, чуть выше его оси.
const CAMERA_LENS = { fov: 34, near: 0.01, far: 200 };
const CAMERA_HOME = [0, 0.35, 6];

// Пока модели нет, границы сцены — типичный ствол: половина размера по осям x, y, z.
const EMPTY_HALF_SIZE = [1, 0.2, 0.05];

// Студийный свет: ячейка пресета STAGE_LIGHTING.studio (оттуда сила), цвет и направление в осях
// камеры: x вправо, y вверх, z на зрителя.
const STUDIO_LIGHTS = [
  { slot: "key", colour: 0xffffff, direction: [0.6, 0.8, 0.7] },
  { slot: "fill", colour: 0xc8d6ff, direction: [-0.9, 0.1, 0.5] },
  { slot: "rim", colour: 0xffffff, direction: [-0.35, 0.6, -0.9] },
];
const LIGHT_DISTANCE = 10;

// Окружение наклоняется за подъёмом камеры: LOOK_LIFT — начальный подъём взгляда,
// ENV_FOLLOW — доля подъёма, которую окружение повторяет.
const LOOK_LIFT = 0.2;
const ENV_FOLLOW = 0.85;

// Общему рендереру окна нужен холст с 2d-контекстом: без него аренда тут же возвращается.
function claimSharedRenderer(ctx) {
  const lease = claimWindowRenderer(ctx.leaseOwner, { antialias: ctx.quality.antialias, strict: false });
  if (lease && !ctx.canvas.getContext("2d")) {
    releaseWindowRenderer(ctx.leaseOwner);
    return null;
  }
  return lease;
}

function setupRenderer(ctx) {
  ctx.leaseOwner = {};
  ctx.windowLease = ctx.shareAllowed ? claimSharedRenderer(ctx) : null;
  ctx.renderer =
    ctx.windowLease?.renderer ??
    new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: ctx.quality.antialias,
      alpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
  // Проверки шейдеров выключаются только у своего рендерера: общий принадлежит окну.
  if (!ctx.windowLease) skipShaderChecks(ctx.renderer);
  ctx.renderer.setPixelRatio(profilePixelRatio(ctx.quality));
  Object.assign(ctx.renderer, {
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.NeutralToneMapping,
    toneMappingExposure: 1,
  });
  ctx.renderer.setClearColor(0x000000, 0);
}

function createCamera() {
  const { fov, near, far } = CAMERA_LENS;
  // Пропорции 1 до первого resize.
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  camera.position.set(...CAMERA_HOME);
  return camera;
}

export function createControls(camera, canvas) {
  const { PAN, ROTATE } = THREE.MOUSE;
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    enableDamping: true,
    dampingFactor: 0.08,
    enablePan: true,
    minDistance: 0.6,
    maxDistance: 40,
    // Левая кнопка отдана инструменту; «Осмотр» (Z7) возвращает её вращению.
    mouseButtons: { LEFT: null, MIDDLE: PAN, RIGHT: ROTATE },
  });
  /* `OrbitControls` держит на холсте слушатель колеса без `passive`: колесо над кадром — приближение, а не прокрутка страницы. Правило аудита `scroll` (`design-qa.md`) просит у такого холста метку
     `data-wheel="zoom"`; её ставили только руки с наклейкой и деталью (`useGunPointer`, `useDecorationPointer`), и пустой холст студии оставался без неё (аудит мастерской одежды 17.11.2026).
     Метка живёт, пока живёт управление: снимается вместе с `dispose`. Чужую метку не перетираем (`markWheel`). */
  const unmarkWheel = markWheel(canvas);
  const release = controls.dispose.bind(controls);
  controls.dispose = () => {
    release();
    unmarkWheel();
  };
  return controls;
}

function setupView(ctx) {
  ctx.scene = new THREE.Scene();
  ctx.studioEnv = createStudioEnvironment(ctx.renderer);
  ctx.scene.environment = ctx.studioEnv;
  ctx.camera = createCamera();
  ctx.controls = createControls(ctx.camera, ctx.canvas);
  ctx.viewMemory = trackOrbitView("workshop:gun", ctx.camera, ctx.controls);
}

// Три направленных света по таблице, затем общий; в сцену они идут одним вызовом, в этом порядке.
function setupLights(ctx) {
  const { studio } = STAGE_LIGHTING;
  ctx.lights = {};
  ctx.lightRig = [];
  for (const { slot, colour, direction } of STUDIO_LIGHTS) {
    ctx.lights[slot] = new THREE.DirectionalLight(colour, studio[slot][1]);
    ctx.lightRig.push([ctx.lights[slot], direction]);
  }
  ctx.lights.ambient = new THREE.AmbientLight(0xffffff, studio.ambient);
  ctx.scene.add(...Object.values(ctx.lights));
  ctx.cameraAxes = { right: new THREE.Vector3(), up: new THREE.Vector3(), back: new THREE.Vector3() };
}

// Файлы оружия сжаты meshopt: загрузчику нужен декодер.
function withMeshopt(loader) {
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function setupLoading(ctx) {
  ctx.ray = new THREE.Raycaster();
  ctx.pointer = new THREE.Vector2();
  ctx.glbLoader = withMeshopt(new GLTFLoader());
  const textureCache = createTextureCache();
  ctx.textureCache = textureCache;
  ctx.textureToken = null;
  ctx.markFirstFrame = false;
  ctx.makeLoader = (token) => withMeshopt(new GLTFLoader()).register(textureReusePlugin(textureCache, token));
  ctx.holder = new THREE.Group();
  ctx.scene.add(ctx.holder);
}

// Начальные значения полей каркаса; остальные зоны дописывают свои при подключении.
function initialState(renderer) {
  return {
    root: null,
    underlay: null,
    hand: null,
    mounted: null,
    zoneFrame: null,
    fitGroup: null,
    ghost: null,
    pose: null,
    stickerPreview: null,
    poseStartedAt: 0,
    ghostSerial: 0,
    fitDistance: 0,
    xrayTimer: 0,
    span: 1,
    closed: false,
    ghostShown: false,
    glowShown: false,
    detachable: false,
    stickerPartOnly: true,
    finish: "metal",
    bounds: new THREE.Box3(
      new THREE.Vector3(...EMPTY_HALF_SIZE).negate(),
      new THREE.Vector3(...EMPTY_HALF_SIZE),
    ),
    decalBaker: createDecalBaker(renderer),
    poseTempo: createPoseTempo(),
    clipCache: new Map(),
    layouts: new Map(),
    detached: new Map(),
    detachedVertices: new Map(),
    entries: [],
  };
}

function startLoop(ctx) {
  const stage = { renderer: ctx.renderer, scene: ctx.scene, camera: ctx.camera };
  ctx.warmup = createSceneWarmup({
    ...stage,
    alive: () => !ctx.closed,
    onReady: () => ctx.requestRender(),
  });
  ctx.loop = startStageLoop({ element: ctx.canvas, frame: (_time, info) => renderFrame(ctx, info) });
  ctx.requestRender = () => ctx.loop.invalidate();
  ctx.warmup.warm();
  ctx.controls.addEventListener("change", ctx.requestRender);
  ctx.decorations = createDecorationLayer({ requestRender: ctx.requestRender });
}

// Оси камеры в мировых координатах — столбцы её матрицы.
function readCameraAxes(camera, { right, up, back }) {
  camera.updateMatrixWorld();
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  up.setFromMatrixColumn(camera.matrixWorld, 1);
  back.setFromMatrixColumn(camera.matrixWorld, 2);
}

// Свет встаёт по направлению (x, y, z) в осях камеры на расстоянии LIGHT_DISTANCE от центра.
function placeLight(light, { right, up, back }, [x, y, z]) {
  const { position } = light;
  position.set(0, 0, 0);
  position.addScaledVector(right, x);
  position.addScaledVector(up, y);
  position.addScaledVector(back, z);
  position.normalize().multiplyScalar(LIGHT_DISTANCE);
}

// Окружение поворачивается вслед за камерой, смещённой от цели на (dx, dy, dz).
function tiltEnvironment(rotation, dx, dy, dz) {
  const horizontal = Math.hypot(dx, dz);
  const lift = Math.atan2(dy, horizontal);
  rotation.set(-(lift - LOOK_LIFT) * ENV_FOLLOW, -Math.atan2(dx, dz), 0, "YXZ");
}

// Свет следует за камерой: направления заданы в её осях, окружение поворачивается вслед за взглядом.
function aimLights(ctx) {
  const { camera, cameraAxes, lightRig, controls, scene } = ctx;
  readCameraAxes(camera, cameraAxes);
  for (const [light, direction] of lightRig) placeLight(light, cameraAxes, direction);

  const { position } = camera;
  const { target } = controls;
  tiltEnvironment(scene.environmentRotation, position.x - target.x, position.y - target.y, position.z - target.z);
}

// Персонаж в позе делает шаг по метке развёртки, а не по часам обработчика.
function advancePose(ctx, frameTime) {
  const seconds = Math.max(0, frameTime - ctx.poseStartedAt) / 1000;
  ctx.pose.apply(ctx.root, seconds);
  ctx.poseTempo.drawn(frameTime);
}

// Сам кадр: свет по камере, отрисовка, копия в холст студии, отметка первого кадра модели.
function drawFrame(ctx) {
  aimLights(ctx);
  ctx.renderer.render(ctx.scene, ctx.camera);
  ctx.windowLease?.present(ctx.canvas);
  if (!ctx.markFirstFrame) return;
  ctx.markFirstFrame = false;
  perfMark("gun-model-shown");
}

// Через сколько мс нужен следующий кадр. Живой персонаж на медленном темпе сообщает ещё и то,
// сколько кадр уже занял, и какие у темпа шаг и запас.
function nextFrameWait(poseTempo, wait, frameTime) {
  if (!poseTempo.lite || !wait.alive || wait.moving) return sceneFrameWait(wait);
  const { step, slack } = poseTempo;
  const spent = performance.now() - frameTime;
  return sceneFrameWait({ ...wait, spent, lite: true, step, slack });
}

// То, что рисует цикл кадров; ответ — через сколько мс нужен следующий кадр.
function renderFrame(ctx, { stopped, now, frameTime = now }) {
  if (!ctx.warmup.ready) return STAGE_IDLE;
  const moved = ctx.controls.update();
  // Персонаж в позе стоит в кадре, пока ворота внимания открыты.
  const posing = !stopped && Boolean(ctx.pose && ctx.root);
  if (posing) {
    // Шаг персонажа ещё не прошёл: кадр пропускается, следующий заказывается сразу.
    if (!moved && ctx.poseTempo.early(frameTime)) return 0;
    advancePose(ctx, frameTime);
  }
  drawFrame(ctx);
  return nextFrameWait(ctx.poseTempo, { moving: moved, alive: posing, stopped }, frameTime);
}

// Обмер без слоя украшений: брелок не должен сдвигать середину и камеру.
function withoutDecorations({ decorations }, measure) {
  const { group } = decorations;
  const { parent } = group;
  decorations.detach();
  try {
    return measure();
  } finally {
    parent?.add(group);
  }
}

// Границы скинованной сетки зависят от позы: после посадки костей они считаются заново.
function refreshBounds(mesh) {
  mesh.boundingBox = mesh.boundingSphere = null;
  // Если границы построил сосед, стандартный пересчёт не нужен.
  if (!computeSkinnedBounds(mesh)) {
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
}

// Скелеты встают в начальную позу, границы скинованных сеток пересчитываются.
function settleSkeletons(tree) {
  const skinned = [];
  tree.traverse((node) => {
    if (node.isSkinnedMesh) skinned.push(node);
  });
  tree.updateMatrixWorld(true);
  for (const mesh of skinned) {
    mesh.skeleton.update();
    refreshBounds(mesh);
  }
}

// Размер холста в целых пикселях страницы, не меньше 1×1.
function canvasPixels(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  return [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
}

function resize(ctx) {
  const [width, height] = canvasPixels(ctx.canvas);
  ctx.renderer.setSize(width, height, false);
  ctx.camera.aspect = width / height;
  ctx.camera.updateProjectionMatrix();
  ctx.requestRender();
}

// Холст покраски принадлежит редактору и при освобождении дерева остаётся.
const isPaintCanvas = (texture) => Boolean(texture.userData?.astralPaintSurface);

// Геометрия сетки, карты её материалов и сами материалы.
function releaseMesh(textureCache, mesh) {
  mesh.geometry?.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials.filter(Boolean)) {
    const { map, normalMap } = material;
    if (map && !isPaintCanvas(map)) textureCache.disposeTexture(map);
    textureCache.disposeTexture(normalMap);
    material.dispose?.();
  }
}

function releaseTree({ textureCache }, tree) {
  tree.traverse((node) => {
    if (node.isMesh) releaseMesh(textureCache, node);
  });
}

/*
 * Общий объект состояния ctx: его создаёт createFrame, остальные зоны получают его при подключении.
 * Зона пишет только свои поля, чужие читает; чужие операции зовёт через ctx.ops при вызове,
 * поэтому порядок подключения зон безразличен.
 *
 * Поля, которые заводит каркас (читают все зоны):
 *   canvas, shareAllowed, quality — из аргументов и профиля качества;
 *   leaseOwner, windowLease, renderer — рендерер окна (windowLease обнуляет dispose из lifecycle);
 *   scene, studioEnv, camera, controls, viewMemory — сцена, студийное окружение, камера, управление, память вида;
 *   lights { key, fill, rim, ambient }, lightRig (пары [свет, направление]), cameraAxes { right, up, back };
 *   ray, pointer — луч и точка указателя для pick; glbLoader, makeLoader(token), textureCache, textureToken;
 *   holder — группа с моделью; loop, warmup, requestRender, decorations; decalBaker, poseTempo;
 *   closed — true после dispose; markFirstFrame — load включает метку первого кадра модели.
 * Пустые в начале (null), заполняет и чистит работа с моделью:
 *   root, underlay, hand, mounted, pose, fitGroup, zoneFrame, ghost, stickerPreview;
 *   entries [] — записи материалов (load); bounds, span, fitDistance — размеры и дальность подгонки (model).
 * Карты, которые чистит clearModel: clipCache (islands), layouts, detached, detachedVertices (detach).
 * Поля зон, которые зона заводит при подключении или в работе:
 *   load — loadSerial (растит и unload), glowShown, poseStartedAt, textureToken (сбрасывает и model);
 *   model — flightFrame, ghostSerial, ghostShown;
 *   shape — shape, finish, xrayTimer;
 *   detach — detachable;
 *   decals — decalTextures, stickerPartOnly.
 *
 * ctx.ops — реестр операций между зонами: каркас кладёт свои, остальные зоны дописывают при подключении:
 *   frame — aimLights, resize, releaseTree, settleSkeletons, withoutDecorations;
 *   model — clearModel, cancelFlight, measureModel, setOwnFit, setGhost, showGhost, frameModel, fitModel, focusPart;
 *   load — load, surfaceTexture, applyEntryGlow, outfitMaterials, paintOutfit, bindSurface, refreshSurface, setGlowShown;
 *   shape — applyShape, applyFinish, setFinish, xraySheet, scheduleXray, setModelShape, stopXrayTimer;
 *   islands — describeHit, islandClip, itemParts, itemPartKey;
 *   detach — setDetachable, detachIsland, syncDetached, detachedPieces;
 *   pick — pickSurface, pickMirror, zoneMask, pickPlacement, pickDecoration, pickAlong, wrapProfile, screenOf, screenOfSticker;
 *   view — viewFrom, viewState, zoomBy, onViewChange, setLighting;
 *   decals — dropStickerPreview, setStickerParts, previewSticker, bakeSticker, stickerSpill;
 *   lifecycle — setControlsEnabled, setNavigationMode, setZoomEnabled, snapshot, dispose.
 * Члены возвращаемого API берутся из ctx.ops по имени (buildApi в gun-scene-lifecycle.js требует их все).
 */
export const createFrame = (canvas, share) => {
  const ctx = { canvas, shareAllowed: share, quality: qualityProfile() };
  setupRenderer(ctx);
  setupView(ctx);
  setupLights(ctx);
  setupLoading(ctx);
  Object.assign(ctx, initialState(ctx.renderer));
  startLoop(ctx);
  ctx.ops = {
    settleSkeletons,
    aimLights: () => aimLights(ctx),
    resize: () => resize(ctx),
    releaseTree: (tree) => releaseTree(ctx, tree),
    withoutDecorations: (measure) => withoutDecorations(ctx, measure),
  };
  return ctx;
};
