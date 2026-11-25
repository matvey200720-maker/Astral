/*
 * Сцена экрана «Ганпак» (владелец, 02.11.2026): все стволы пака настоящими моделями в одном кадре — добавленный въезжает, остальные плавно расступаются, кадр можно крутить,
 * щелчок по стволу открывает его редактор.
 *
 * Сцена живёт дольше экрана: пока человек правит ствол, холст снят со страницы, кадров нет, а модели и текстуры ждут в видеопамяти, поэтому возврат к паку мгновенный. У неё свой контекст
 * WebGL: рендерер окна занят студией ствола, а делить его значило бы заливать модели заново при каждом переходе.
 *
 * ЧТОБЫ НЕ ЛАГАЛО
 *   • Кадр по требованию (`stage-loop.js`): стоящая сцена не рисует ничего; непрерывно — только пока что-то едет или крутится.
 *   • Модели читаются по одной. Текстуры ужимаются (цвет — `COLOUR_SIZE`, остальное — `DETAIL_SIZE`): двадцать стволов с листами 2048 не влезли бы в память слабой видеокарты.
 *     Цвет читается с видеочипа, а не холстом: у непрозрачных материалов игры в альфе лежит служебное, и холст испортил бы цвет (`opaqueColourAsync`).
 *   • Текстуры заливаются и шейдеры собираются до показа, по одному на кадр: ствол появляется, когда готов, и анимация соседей при этом не дёргается.
 *   • Щелчок и наведение — по рамкам стволов, а не по треугольникам.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { STAGE_IDLE, startStageLoop } from "../../stage-loop.js";
import { compileScene, skipShaderChecks } from "../../../../../features/workshop/model-stage/shader-warmup.js";
import { profilePixelRatio, qualityProfile } from "../../../../../features/workshop/model-stage/quality-profile.js";
import { STAGE_LIGHTING, STUDIO_FINISHES, createStudioEnvironment, finishOf, finishShader, isNeutralMaterial } from "../lighting.js";
import { materialName, opaqueColourAsync } from "../gun-scene.js";
import { applyDetached } from "./pack-detached.js";
import { familySize, layoutPack } from "./pack-layout.js";

/* Отметки загрузки ствола для стенда (`scripts/perf/baseline/gun-pick.mjs`): только в dev и сборке замера. */
const PACK_MARKS = Boolean(import.meta.env?.DEV || import.meta.env?.MODE === "perf");
const packMark = PACK_MARKS ? (name, slot) => performance.mark(name, { detail: { slot } }) : () => {};

const COLOUR_SIZE = 1024;
const DETAIL_SIZE = 512;
const DETAIL_MAPS = Object.freeze(["normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap"]);
/* Угол кадра по умолчанию: почти в лоб, чуть сбоку и сверху — раскладка читается, а модели всё же объёмные. */
const HOME_VIEW = Object.freeze([0.2, 0.1, 1]);
const FOV = 30;
/* Поле вокруг раскладки. */
const MARGIN = 1.12;
/* Сколько едет кадр к стволу перед открытием редактора. */
export const FOCUS_MS = 240;
/* Скорости сглаживания, 1/с: больше — быстрее. */
const SLIDE_RATE = 8;
const GROW_RATE = 9;
const CAMERA_RATE = 6;
const HOVER_SCALE = 1.05;
const CLICK_SLOP_PX = 5;

/* Сколько времени сцена берёт у кадра за раз, пока ствол собирается: больше — анимация соседей дёргается, меньше — загрузка ждёт лишних кадров. */
const SLICE_MS = 6;

const nextFrame = () =>
  new Promise((resolve) => {
    const fallback = setTimeout(resolve, 60);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      resolve();
    });
  });

/* Отдаёт кадр, только когда кусок времени выбран: мелкая работа подряд (материалы, заливка листов) укладывается в пару кадров, а не в кадр на каждый лист. */
const createSlicer = () => {
  let started = performance.now();
  return async () => {
    if (performance.now() - started < SLICE_MS) return;
    await nextFrame();
    started = performance.now();
  };
};

const copyPlacement = (from, to) => {
  to.colorSpace = from.colorSpace;
  to.flipY = from.flipY;
  to.wrapS = from.wrapS;
  to.wrapT = from.wrapT;
  to.offset.copy(from.offset);
  to.repeat.copy(from.repeat);
  to.center.copy(from.center);
  to.rotation = from.rotation;
  to.channel = from.channel;
  to.anisotropy = 4;
  to.needsUpdate = true;
};

const fitted = (image, most) => {
  const width = image?.width || 0;
  const height = image?.height || 0;
  const scale = Math.min(1, most / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
};

export function createGunPackScene({ onHover = () => {}, onPick = () => {}, onEmptyPick = () => {}, onStatus = () => {} } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "gun-pack-canvas";
  const quality = qualityProfile();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, alpha: true, powerPreference: "high-performance" });
  skipShaderChecks(renderer);
  /* Плотность ограничена: кадр на весь экран с десятками деталей дороже от каждого лишнего пикселя, а стволы здесь мельче, чем в редакторе. */
  renderer.setPixelRatio(Math.min(1.5, profilePixelRatio(quality)));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const environment = createStudioEnvironment(renderer);
  scene.environment = environment;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 200);
  camera.position.set(...HOME_VIEW).multiplyScalar(4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  /* Пак крутят целиком: с обычной скоростью он за короткий жест уходил ребром к кадру. */
  controls.rotateSpeed = 0.6;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

  /* Свет — у камеры, как в студии ствола: с какой стороны ни смотри, пак освещён. */
  const key = new THREE.DirectionalLight(0xffffff, STAGE_LIGHTING.studio.key[1]);
  const fill = new THREE.DirectionalLight(0xc8d6ff, STAGE_LIGHTING.studio.fill[1]);
  const rim = new THREE.DirectionalLight(0xffffff, STAGE_LIGHTING.studio.rim[1]);
  scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, STAGE_LIGHTING.studio.ambient));
  const LIGHT_AIMS = [
    [key, [0.6, 0.8, 0.7]],
    [fill, [-0.9, 0.1, 0.5]],
    [rim, [-0.35, 0.6, -0.9]],
  ];
  const axis = { right: new THREE.Vector3(), up: new THREE.Vector3(), back: new THREE.Vector3() };
  function aimLights() {
    camera.updateMatrixWorld();
    axis.right.setFromMatrixColumn(camera.matrixWorld, 0);
    axis.up.setFromMatrixColumn(camera.matrixWorld, 1);
    axis.back.setFromMatrixColumn(camera.matrixWorld, 2);
    for (const [light, [x, y, z]] of LIGHT_AIMS)
      light.position.set(0, 0, 0).addScaledVector(axis.right, x).addScaledVector(axis.up, y).addScaledVector(axis.back, z).normalize().multiplyScalar(10);
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  /* slot → { slot, family, group, inner, model, size, wanted, grow, leaving, key, stock, paint }; stock: деталь → { texture, placement, materials, meshes } */
  const entries = new Map();
  let order = [];
  let disposed = false;
  let aspect = 16 / 9;
  let extent = { width: 0, height: 0 };
  /* Куда едет кадр; `null` — никуда, камерой правит человек. */
  let flight = null;
  let hovered = "";
  let lastFrame = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const spare = new THREE.Vector3();
  const spareBox = new THREE.Box3();

  const fitDistance = (width, height, depth = 0.3) => {
    const tan = Math.tan((FOV * Math.PI) / 360);
    return Math.max((height * MARGIN) / (2 * tan), (width * MARGIN) / (2 * tan * aspect), 0.5) + depth / 2;
  };

  function homeFlight({ view = null } = {}) {
    if (!order.length) return;
    flight = {
      target: new THREE.Vector3(0, 0, 0),
      distance: fitDistance(extent.width, extent.height),
      direction: view ? new THREE.Vector3(...view).normalize() : null,
    };
  }

  function relayout({ refit = true } = {}) {
    const present = order.map((slot) => entries.get(slot)).filter(Boolean);
    const { placed, width, height } = layoutPack(
      present.map((entry) => entry.size || familySize(entry.family)),
      { aspect },
    );
    extent = { width, height };
    present.forEach((entry, index) => entry.wanted.set(placed[index].x, placed[index].y, 0));
    controls.minDistance = 0.3;
    controls.maxDistance = Math.max(8, fitDistance(width, height) * 4);
    if (refit) homeFlight();
    loop.invalidate();
  }

  function animate(dt) {
    let moving = false;
    const slide = 1 - Math.exp(-SLIDE_RATE * dt);
    const grow = 1 - Math.exp(-GROW_RATE * dt);
    for (const entry of [...entries.values()]) {
      if (!entry.model) continue;
      if (!entry.shown) {
        /* Первый кадр ствола: сразу на месте, чуть выше — въезжает сверху, как его описал владелец. */
        entry.shown = true;
        entry.group.position.copy(entry.wanted);
        entry.group.position.y += Math.max(0.12, (entry.size?.height || 0.2) * 0.8);
        entry.grow = 0.02;
      }
      const offset = spare.copy(entry.wanted).sub(entry.group.position);
      if (offset.lengthSq() > 1e-7) {
        entry.group.position.addScaledVector(offset, slide);
        moving = true;
      } else entry.group.position.copy(entry.wanted);
      const aim = entry.leaving ? 0 : hovered === entry.slot ? HOVER_SCALE : 1;
      if (Math.abs(aim - entry.grow) > 1e-3) {
        entry.grow += (aim - entry.grow) * grow;
        moving = true;
      } else entry.grow = aim;
      entry.inner.scale.setScalar(Math.max(entry.grow, 1e-3));
      if (entry.leaving && entry.grow < 0.03) removeEntry(entry);
    }
    if (flight) {
      const glide = 1 - Math.exp(-(flight.rate || CAMERA_RATE) * dt);
      const view = spare.copy(camera.position).sub(controls.target);
      const distance = view.length() || 1;
      controls.target.lerp(flight.target, glide);
      const next = distance + (flight.distance - distance) * glide;
      view.normalize();
      if (flight.direction) view.lerp(flight.direction, glide).normalize();
      camera.position.copy(controls.target).addScaledVector(view, next);
      const settled =
        Math.abs(next - flight.distance) < flight.distance * 0.002 &&
        controls.target.distanceToSquared(flight.target) < 1e-6 &&
        (!flight.direction || view.distanceToSquared(flight.direction) < 1e-6);
      if (settled) flight = null;
      moving = true;
    }
    return moving;
  }

  function frame(_time, { stopped, now }) {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    const moving = animate(dt);
    const orbiting = controls.update();
    aimLights();
    renderer.render(scene, camera);
    return (moving || orbiting) && !stopped ? 0 : STAGE_IDLE;
  }
  const loop = startStageLoop({ element: canvas, frame });
  controls.addEventListener("change", () => loop.invalidate());
  /* Человек взялся за кадр: дальше камерой правит он. */
  controls.addEventListener("start", () => {
    flight = null;
  });

  function resize() {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    renderer.setSize(Math.round(box.width), Math.round(box.height), false);
    camera.aspect = box.width / box.height;
    camera.updateProjectionMatrix();
    const before = aspect;
    aspect = camera.aspect;
    if (Math.abs(before - aspect) > 0.01) relayout();
    loop.invalidate();
  }
  const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;

  /* --- Попадание мышью --- */
  function slotAt(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    pointer.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    let best = "";
    let bestDistance = Infinity;
    for (const entry of entries.values()) {
      if (!entry.model || entry.leaving) continue;
      const size = entry.size;
      spareBox.min.set(-size.width / 2, -size.height / 2, -Math.max(size.depth, 0.06) / 2).add(entry.group.position);
      spareBox.max.set(size.width / 2, size.height / 2, Math.max(size.depth, 0.06) / 2).add(entry.group.position);
      const hit = raycaster.ray.intersectBox(spareBox, spare);
      if (!hit) continue;
      const distance = hit.distanceToSquared(camera.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry.slot;
      }
    }
    return best;
  }

  function setHovered(slot) {
    if (slot === hovered) return;
    hovered = slot;
    canvas.style.cursor = slot ? "pointer" : "";
    onHover(slot);
    loop.invalidate();
  }

  let press = null;
  const onPointerDown = (event) => {
    press = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  };
  const onPointerMove = (event) => {
    if (event.buttons) return;
    setHovered(slotAt(event.clientX, event.clientY));
  };
  const onPointerLeave = () => setHovered("");
  const onPointerUp = (event) => {
    const down = press;
    press = null;
    if (!down || event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP_PX) return;
    const slot = slotAt(event.clientX, event.clientY);
    if (slot) onPick(slot);
    else onEmptyPick();
  };
  const onDoubleClick = (event) => {
    if (slotAt(event.clientX, event.clientY)) return;
    homeFlight({ view: HOME_VIEW });
    loop.invalidate();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("dblclick", onDoubleClick);

  /* --- Стволы --- */
  function newEntry(slot, family) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    scene.add(group);
    return { slot, family, group, inner, model: null, size: null, wanted: new THREE.Vector3(), grow: 0, shown: false, leaving: false, key: "", stock: new Map(), paint: new Map() };
  }

  function disposeModel(entry) {
    entry.model?.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry?.dispose?.();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const name of ["map", ...DETAIL_MAPS]) material?.[name]?.dispose?.();
        material?.dispose?.();
      }
    });
    for (const texture of entry.stock.values()) texture.texture?.dispose?.();
    for (const texture of entry.paint.values()) texture.dispose?.();
    entry.stock.clear();
    entry.paint.clear();
    if (entry.model) entry.inner.remove(entry.model);
    entry.model = null;
  }

  function removeEntry(entry) {
    disposeModel(entry);
    scene.remove(entry.group);
    if (entries.get(entry.slot) === entry) entries.delete(entry.slot);
  }

  /** Какие стволы на сцене и в каком порядке: `[{ slot, family }]`. */
  function setSlots(list) {
    const next = list.map((item) => item.slot);
    for (const entry of entries.values()) if (!next.includes(entry.slot)) entry.leaving = true;
    for (const { slot, family } of list) {
      const entry = entries.get(slot);
      if (!entry) entries.set(slot, newEntry(slot, family));
      else entry.leaving = false;
    }
    order = next;
    relayout();
  }

  /* Ужатая карта деталей; одну текстуру несколько материалов делят, поэтому зовётся раз на текстуру (`once`). */
  async function shrinkDetail(texture) {
    const { width, height, scale } = fitted(texture.image, DETAIL_SIZE);
    if (scale >= 1 || typeof createImageBitmap !== "function" || !texture.image) return texture;
    try {
      const bitmap = await createImageBitmap(texture.image, { resizeWidth: width, resizeHeight: height, resizeQuality: "high", premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const next = new THREE.Texture(bitmap);
      copyPlacement(texture, next);
      texture.image.close?.();
      texture.dispose();
      return next;
    } catch {
      return texture;
    }
  }

  async function shrinkColour(texture, material) {
    const opaque = !material.transparent && !(material.alphaTest > 0);
    if (!opaque) return texture;
    const { width, height } = fitted(texture.image, COLOUR_SIZE);
    try {
      const image = await opaqueColourAsync(renderer, texture, width, height);
      const next = new THREE.CanvasTexture(image);
      copyPlacement(texture, next);
      texture.image?.close?.();
      texture.dispose();
      return next;
    } catch {
      return texture;
    }
  }

  /* Отделка и текстуры модели: тот же металл, что в студии ствола (`applyFinish` в `gun-scene.js`).
     Листы ужимаются разом (чтение с видеочипа идёт конвейером, а не кадр за листом), материалы и заливка — кусками по `SLICE_MS`, чтобы анимация соседей не дёргалась. */
  async function adoptMaterials(entry, root, alive) {
    /* Имена и порядок сеток — как в студии (`gun-scene.js`): по ним находятся покраска и отделённые куски. */
    const materials = new Set();
    root.traverse((node) => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      list.forEach((material, index) => {
        if (!material) return;
        const name = materialName(material, index);
        material.name = name;
        materials.add(material);
        if (!entry.stock.has(name)) entry.stock.set(name, { texture: null, placement: null, materials: [], meshes: [] });
        const stock = entry.stock.get(name);
        if (!stock.materials.includes(material)) stock.materials.push(material);
        stock.meshes.push({ mesh: node, groups: Array.isArray(node.material) ? node.geometry.groups.filter((group) => group.materialIndex === index) : null });
      });
    });
    const slice = createSlicer();
    const shrinking = new Map();
    const once = (texture, make) => {
      if (!shrinking.has(texture)) shrinking.set(texture, make());
      return shrinking.get(texture);
    };
    for (const material of materials) {
      if (!alive()) return;
      material.side = THREE.DoubleSide;
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        const map = material.map;
        await slice();
        once(map, () => shrinkColour(map, material));
      }
      for (const slot of DETAIL_MAPS) {
        const texture = material[slot];
        if (texture) once(texture, () => shrinkDetail(texture));
      }
    }
    const shrunk = new Map();
    for (const [texture, pending] of shrinking) shrunk.set(texture, await pending);
    for (const material of materials) {
      if (!alive()) return;
      await slice();
      const stock = entry.stock.get(material.name);
      if (material.map) {
        material.map = shrunk.get(material.map) || material.map;
        stock.texture ||= material.map;
      }
      for (const slot of DETAIL_MAPS) if (material[slot]) material[slot] = shrunk.get(material[slot]) || material[slot];
      /* Покраска ложится на развёртку той же картой, что и в студии: цвет, а если его нет — нормали. */
      stock.placement ||= material.map || material.normalMap || null;
      if ("roughness" in material) {
        const source = { roughness: material.roughness, metalness: material.metalness, envMapIntensity: material.envMapIntensity };
        Object.assign(material, finishOf(source, "metal"));
        const diffuse = isNeutralMaterial(source) ? STUDIO_FINISHES.metal?.iblDiffuse : undefined;
        const shader = diffuse === undefined ? null : finishShader(diffuse);
        if (shader) {
          material.onBeforeCompile = shader.patch;
          material.customProgramCacheKey = () => shader.key;
        }
      }
      material.needsUpdate = true;
    }
    for (const texture of new Set(shrunk.values())) {
      if (!alive()) return;
      await slice();
      renderer.initTexture(texture);
    }
  }

  function measure(entry, root, scale) {
    let box = new THREE.Box3().setFromObject(root);
    let size = box.getSize(new THREE.Vector3());
    /* Самая длинная сторона — вдоль кадра: свои модели .glb бывают повёрнуты как угодно. */
    if (size.z > size.x && size.z >= size.y) root.rotation.y = Math.PI / 2;
    else if (size.y > size.x) root.rotation.z = Math.PI / 2;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    root.position.sub(centre);
    entry.size = { width: size.x * scale, height: size.y * scale, depth: size.z * scale };
  }

  /* Покраска детали: новый холст — новая текстура; нет холста — лист игры. */
  function applyPaint(entry, paint) {
    for (const texture of entry.paint.values()) texture.dispose?.();
    entry.paint.clear();
    for (const [name, stock] of entry.stock) {
      const picture = paint?.get(name);
      let texture = stock.texture;
      if (picture && stock.placement) {
        texture = picture instanceof HTMLCanvasElement ? new THREE.CanvasTexture(picture) : new THREE.Texture(picture);
        copyPlacement(stock.placement, texture);
        texture.colorSpace = THREE.SRGBColorSpace;
        entry.paint.set(name, texture);
      }
      for (const material of stock.materials) {
        if (Boolean(material.map) !== Boolean(texture)) material.needsUpdate = true;
        material.map = texture;
      }
    }
    loop.invalidate();
  }

  /* Очередь загрузок: одна модель за раз, новая просьба о том же стволе заменяет прежнюю. */
  const queue = new Map();
  let draining = false;
  /* Чтение ствола у Desktop (IPC, у холодного кэша — секунды) идёт на два ствола вперёд, пока предыдущие разбираются: к своей очереди байты уже здесь. Дальше не заглядываем: у каждого чтения свой потолок ожидания. */
  const READ_AHEAD = 2;
  const warmed = new WeakSet();
  function warmAhead() {
    let ahead = 0;
    for (const job of queue.values()) {
      if (ahead++ >= READ_AHEAD) break;
      if (warmed.has(job) || typeof job.url !== "function") continue;
      warmed.add(job);
      try {
        Promise.resolve(job.url()).catch(() => {});
      } catch {
        /* отказ покажет сама загрузка ствола */
      }
    }
  }
  /* Разбор GLB — работа главного потока (сотни миллисекунд ×4), а сборка материалов и заливка листов по большей части ждут кадров и видеочип: разбор следующего ствола идёт в эти паузы.
     Начинается, когда предыдущий уже разобран (две разборки разом друг друга тормозят), и ничего не ломает: готовый разбор ждёт своей очереди в `parsing`. */
  const parsing = new WeakMap();
  function parseJob(job) {
    if (!parsing.has(job)) {
      const pending = Promise.resolve(job.url()).then((address) => loader.loadAsync(address));
      parsing.set(job, pending);
      pending.catch(() => {});
    }
    return parsing.get(job);
  }
  /* Разбор, которому не нашлось ствола (убрали, заменили просьбой), — освободить сетки: на видеочип они не заливались. */
  function discardParsed(job) {
    const pending = job && parsing.get(job);
    if (!pending) return;
    parsing.delete(job);
    pending.then((gltf) => gltf.scene.traverse((node) => node.geometry?.dispose?.())).catch(() => {});
  }
  function parseNext() {
    const next = queue.values().next().value;
    if (next && typeof next.url === "function") parseJob(next);
  }
  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.size && !disposed) {
      const [slot, job] = queue.entries().next().value;
      queue.delete(slot);
      warmAhead();
      await loadJob(slot, job);
      await nextFrame();
    }
    draining = false;
  }

  async function loadJob(slot, job) {
    const { key, scale = 1, paint = null, detached = {} } = job;
    const entry = entries.get(slot);
    if (!entry || entry.leaving) return;
    const alive = () => !disposed && entries.get(slot) === entry && !entry.leaving && !(queue.has(slot) && queue.get(slot).key !== key);
    /* Та же модель: сменилась только покраска. */
    if (entry.key === key && entry.model) {
      const picture = paint ? await paint(new Map([...entry.stock].map(([name, stock]) => [name, stock.texture?.image || null]))) : null;
      if (alive()) {
        applyDetached(entry.stock, detached);
        applyPaint(entry, picture);
      }
      onStatus(slot, { state: "ready" });
      return;
    }
    onStatus(slot, { state: "loading" });
    packMark("pack-load-start", slot);
    try {
      const gltf = await parseJob(job);
      parsing.delete(job);
      packMark("pack-parsed", slot);
      parseNext();
      if (!alive()) {
        gltf.scene.traverse((node) => node.geometry?.dispose?.());
        return;
      }
      const root = gltf.scene;
      const fresh = { ...entry, stock: new Map(), paint: new Map() };
      await adoptMaterials(fresh, root, alive);
      if (!alive()) return;
      packMark("pack-adopted", slot);
      measure(entry, root, scale);
      /* Своё ожидание, а не `renderer.compileAsync` three: его опрос читает программу освобождённого материала и роняет TypeError «reading 'isReady'» из таймера,
         когда экран закрыли посреди сборки (`dispose()` ниже: `renderer.dispose()` обнуляет записи материалов), а само обещание не завершается. */
      if (typeof renderer.compile === "function") await compileScene(renderer, root, camera, alive, scene);
      if (!alive()) return;
      packMark("pack-compiled", slot);
      const picture = paint ? await paint(new Map([...fresh.stock].map(([name, stock]) => [name, stock.texture?.image || null]))) : null;
      if (!alive()) return;
      packMark("pack-painted", slot);
      disposeModel(entry);
      entry.stock = fresh.stock;
      entry.paint = fresh.paint;
      entry.model = root;
      entry.key = key;
      entry.inner.scale.setScalar(1e-3);
      const sized = new THREE.Group();
      sized.scale.setScalar(scale);
      sized.add(root);
      entry.inner.add(sized);
      /* Для уборки сетки считаются от группы масштаба. */
      entry.model = sized;
      applyDetached(entry.stock, detached);
      applyPaint(entry, picture);
      entry.shown = false;
      relayout();
      packMark("pack-shown", slot);
      onStatus(slot, { state: "ready" });
    } catch (error) {
      if (alive()) onStatus(slot, { state: "failed", message: String(error?.message || error) });
    }
  }

  /**
   * Что показать на месте ствола. `key` — личность модели (новая — модель читается заново), `url()` — её адрес, `scale` — размер из проекта, `paint(bases)` — покраска поверх листов
   * игры: `bases` — `Map<деталь, картинка>`, ответ — `Map<деталь, картинка>` или `null`; `detached` — отделённые куски развёртки черновика.
   */
  function showModel(slot, job) {
    if (!entries.has(slot)) return;
    /* Вернувшемуся в конец очереди просьба не теряется: один ствол — одна запись. */
    discardParsed(queue.get(slot));
    queue.delete(slot);
    queue.set(slot, job);
    if (draining) warmAhead();
    void drain();
  }

  /** Кадр к стволу перед открытием редактора. */
  function focus(slot) {
    const entry = entries.get(slot);
    if (!entry?.size) return;
    flight = { target: entry.wanted.clone(), distance: fitDistance(entry.size.width, entry.size.height) * 0.92, rate: 14 };
    loop.invalidate();
  }

  return {
    canvas,
    setSlots,
    showModel,
    focus,
    /** Кадр обратно на весь пак: после редактора ствола. */
    home() {
      homeFlight();
      loop.invalidate();
    },
    attach(host) {
      host.appendChild(canvas);
      watcher?.observe(host);
      resize();
      loop.invalidate();
    },
    detach() {
      watcher?.disconnect();
      setHovered("");
      canvas.remove();
    },
    dispose() {
      disposed = true;
      watcher?.disconnect();
      loop.stop();
      for (const job of queue.values()) discardParsed(job);
      queue.clear();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("dblclick", onDoubleClick);
      controls.dispose();
      for (const entry of [...entries.values()]) removeEntry(entry);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
