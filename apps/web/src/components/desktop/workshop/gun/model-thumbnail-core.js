/*
 * Общая часть снимка модели для плитки (`model-thumbnail.js`, `model-thumbnail-worker.js`): кадр WebGL, свет и отражения студии, разбор GLB, отделка материалов, рамка камеры.
 * Без DOM — модуль грузится и в окне, и в потоке (`OffscreenCanvas`): так снимки плиток одежды рисует поток, а главный поток остаётся пользователю (31.10.2026, замер полки
 * на закрытой сборке ×4: плитка за ~150 мс главного потока, вся полка из 17 плиток — 4 секунды, пока человек ждёт и крутит колесо).
 *
 * Кадр, ракурс и свет — как у кадра студии (три четверти, сбоку-спереди, прозрачный фон). Один рендерер, одна сцена со светом и отражением на всю очередь: на плитку
 * добавляется только модель. Шейдеры — параллельным компилятором видеочипа (`shader-warmup.js`, `docs/3D.md`, правило 7).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { compileScene, skipShaderChecks } from "../../../../features/workshop/model-stage/shader-warmup.js";
import { STAGE_LIGHTING, STUDIO_FINISHES, createStudioEnvironment, finishOf, finishShader, isNeutralMaterial } from "./lighting.js";
import { fitCamera } from "./thumbnail-fit.js";

export const THUMBNAIL_SIZE = 320;

/** Отказ снимка по причине в модели, а не в окружении: `code` — `no-scene` (в файле нет сцены) или `empty` (нет видимой геометрии). Слова — у окна (`tr`). */
export class ThumbnailFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "ThumbnailFailure";
    this.code = code;
  }
}

/**
 * Рендерер снимков на холсте `canvas` (холст окна или `OffscreenCanvas` потока): сцена со светом и отражением студии уже собрана, модели добавляются на неё по одной.
 * `canvas.width`/`height` ставятся `THUMBNAIL_SIZE`.
 */
export function createThumbnailRenderer(canvas) {
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const gl = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  skipShaderChecks(gl);
  gl.setPixelRatio(1);
  gl.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  /* Свет и отражения — как у кадра студии (`lighting.js`): плитка в «Моделях»
     обязана показывать тот же ствол, что откроется в кадре. */
  gl.toneMapping = THREE.NeutralToneMapping;
  gl.toneMappingExposure = STAGE_LIGHTING.studio.exposure;
  gl.setClearColor(0x000000, 0);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const environment = createStudioEnvironment(gl);
  const light = STAGE_LIGHTING.studio;
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = light.environment;
  scene.add(new THREE.AmbientLight(0xffffff, light.ambient));
  const key = new THREE.DirectionalLight(light.key[0], light.key[1]);
  key.position.set(2.4, 3.2, 2.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(light.fill[0], light.fill[1]);
  fill.position.set(-3, 1.2, -2.4);
  scene.add(fill);
  return { gl, loader, canvas, environment, scene };
}

/** Освободить видеопамять и контекст рендерера снимков. */
export function disposeThumbnailRenderer(shared) {
  shared.environment.dispose();
  shared.gl.dispose();
  shared.gl.forceContextLoss();
}

function disposeTree(root) {
  root.traverse((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose?.();
    }
  });
}

function applyFinish(root, finish) {
  const iblDiffuse = STUDIO_FINISHES[finish]?.iblDiffuse;
  root.traverse((node) => {
    if (!node.isMesh) return;
    for (const material of [node.material].flat()) {
      if (!material || !("roughness" in material)) continue;
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      if (!isNeutralMaterial(material)) continue;
      Object.assign(material, finishOf(material, finish));
      if (iblDiffuse === undefined) continue;
      const shader = finishShader(iblDiffuse);
      material.onBeforeCompile = shader.patch;
      material.customProgramCacheKey = () => shader.key;
      material.needsUpdate = true;
    }
  });
}

/**
 * Модель по адресу (blob: или http) — на сцену рендерера и один кадр на холст. Возвращает `{ camera, release }`: `camera` — кадр, `release()` снимает модель со сцены и освобождает её
 * (звать, когда холст прочитан). `tight` — кадр по самой модели (картинки обвесов, `thumbnail-fit.js`). `alive()` — рендерер ещё жив: холст отпустили посреди сборки — дальше
 * рисовать нечем, обещание вернёт `null`. Бросает `ThumbnailFailure`, когда в файле нет сцены или геометрии.
 */
export async function shootModel(shared, url, finish, { tight = false, alive = () => true } = {}) {
  const { gl, loader, scene } = shared;
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene || gltf.scenes?.[0];
  if (!root) throw new ThumbnailFailure("no-scene");
  applyFinish(root, finish);
  scene.add(root);
  const release = () => {
    scene.remove(root);
    disposeTree(root);
  };
  try {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new ThumbnailFailure("empty");
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    let camera;
    if (tight) {
      /* Рамка модели — вокруг нуля (центр уже вычтен): камера по её проекции, модель сдвинута на недостающее. */
      const fitted = fitCamera(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(), size));
      camera = fitted.camera;
      root.position.add(fitted.shift);
    } else {
      const radius = Math.max(size.length() / 2, 0.01);
      camera = new THREE.PerspectiveCamera(32, 1, radius / 50, radius * 50);
      const distance = (radius / Math.sin(THREE.MathUtils.degToRad(16))) * 1.04;
      camera.position.set(0.35, 0.22, 1.05).normalize().multiplyScalar(distance);
      camera.lookAt(0, 0, 0);
    }
    if (!(await compileScene(gl, scene, camera, alive))) {
      release();
      return null;
    }
    gl.render(scene, camera);
    return { camera, release };
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Прогрев: первый снимок на холодном кэше шейдеров держал кадр 477 мс, а отражение студии (`createStudioEnvironment`) собирается один раз на рендерер. Рендерер создаётся заранее,
 * а на нём собирается программа простой ткани — тот же материал, что у вещи после отделки `cloth`.
 */
export async function warmThumbnailRenderer(shared, finish = "cloth", alive = () => true) {
  const material = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, metalness: 0 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const holder = new THREE.Group();
  holder.add(mesh);
  applyFinish(holder, finish);
  shared.scene.add(holder);
  try {
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 10);
    camera.position.set(0, 0, 4);
    await compileScene(shared.gl, shared.scene, camera, alive);
  } finally {
    shared.scene.remove(holder);
    mesh.geometry.dispose();
    material.dispose();
  }
}
