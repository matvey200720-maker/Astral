/*
 * Сцена редактора «Животные» (05.11.2026): модель животного из файлов игры игрока, перекраска листов, светящаяся оболочка и метка
 * над животным — так, как они лягут в игру.
 *
 * Модель приходит GLB (`apps/desktop/src/animals/animal-reads.js`): сетки и листы цвета — из `.ydd`/`.ytd` самой игры. Перекраска
 * считается теми же формулами, что у установщика (`@modovik/climb-contract/recolor`: `tintRgba`), поэтому цвет в кадре — тот
 * же, что в игре. Метка строится из той же сетки (`buildMarkerMesh`; у вида «модель» — `buildModelMarker` по вершинам тела),
 * что уйдёт в модель, оболочка свечения — копия сеток тела,
 * раздутая вдоль нормалей на столько же сантиметров, на сколько её раздует хост.
 *
 * Один контекст WebGL на окно (`docs/3D.md`, правило 1): рендерер берётся у окна (`claimWindowRenderer`), кадр подаётся копией в
 * обычный 2D-холст. Оси: сцена в осях glTF (Y вверх), метка — из осей RAGE (X, Y вперёд, Z вверх) переводится `(x, z, −y)`.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EMBLEM_ATLAS, EMBLEM_POLE_UV, buildMarkerMesh, buildModelMarker, iconSvg } from "@modovik/climb-contract/animals";
import { meanLuma } from "@modovik/climb-contract/recolor/colour";
import { tintRgba } from "@modovik/climb-contract/recolor/pixels";
import { claimWindowRenderer, releaseGpu, releaseWindowRenderer } from "../engine/window-renderer.js";
import { VIEW_FOV, VIEW_PITCH, VIEW_YAW, fitBodyView } from "./animal-framing.js";

const FOV = VIEW_FOV;
const MAX_RATIO = 2;
const MAX_STAGE_PIXELS = 2_600_000;
const screenRatio = () => Math.max(1, Math.min(MAX_RATIO, globalThis.devicePixelRatio || 1));
/* Листы цвета, которые красит перекраска, узнаются по тому же признаку, что в установщике. */
const DIFFUSE_NAME = /_diff_/i;
const SRGB = THREE.SRGBColorSpace;

/* Мягкая тень под животным: круг с радиальным градиентом. */
function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,0.5)");
  gradient.addColorStop(0.6, "rgba(0,0,0,0.2)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/*
 * Лист метки: значок слева, сплошной цвет палочки справа — тот же атлас, что уйдёт в игру. У «своей эмблемы» лист вдвое
 * больше (256×128, картинка 128×128 слева); пока картинка читается, слева пусто.
 */
function markerTexture(marker) {
  const emblem = marker.kind === "emblem";
  const { width, height } = emblem ? EMBLEM_ATLAS : { width: 128, height: 64 };
  const half = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = marker.hex;
  /* Эмблема: сплошной цвет только у правого края (с 192-й точки), между ним и плиткой — прозрачная полоса, как в игре. */
  if (emblem) context.fillRect(EMBLEM_ATLAS.solid, 0, width - EMBLEM_ATLAS.solid, height);
  else context.fillRect(half, 0, half, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  /* Развёртка метки — как у DirectX (v вниз), как её пишет хост: холст без переворота. */
  texture.flipY = false;
  const image = new Image();
  image.onload = () => {
    context.clearRect(0, 0, half, height);
    /* Картинка эмблемы — с полем в 8 точек внутри плитки и со своей непрозрачностью, как её кладёт установщик. */
    if (emblem) {
      context.globalAlpha = Number.isFinite(marker.opacity) ? marker.opacity : 1;
      context.drawImage(image, EMBLEM_ATLAS.inset, EMBLEM_ATLAS.inset, half - EMBLEM_ATLAS.inset * 2, height - EMBLEM_ATLAS.inset * 2);
      context.globalAlpha = 1;
    } else context.drawImage(image, 0, 0, half, height);
    texture.needsUpdate = true;
    marker.onReady?.();
  };
  image.src = emblem ? marker.picture : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(marker.icon, marker.hex))}`;
  return texture;
}

/* Не больше стольких вершин на кадр: хватает силуэту, и пересчёт камеры при смене размера кадра остаётся мгновенным. */
const FRAME_POINTS = 4000;

/** Вершины тела в осях сцены (с учётом узлов glTF), прореженные до `FRAME_POINTS`: по ним камера ставит животное в кадр. */
function bodyPoints(meshes) {
  let total = 0;
  for (const mesh of meshes) total += mesh.geometry.getAttribute("position")?.count || 0;
  if (!total) return null;
  const stride = Math.max(1, Math.ceil(total / FRAME_POINTS));
  const out = [];
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    if (!position) continue;
    mesh.updateWorldMatrix(true, false);
    for (let index = 0; index < position.count; index += stride) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      out.push(point.x, point.y, point.z);
    }
  }
  return out;
}

/**
 * Части тела для копии в небе: вершины и нормали в осях сцены (с узлами glTF), индексы — как в сетке. Те же числа, что читает
 * установщик из файла игры (`readDrawable`): GLB собран из них же.
 */
function bodyParts(meshes) {
  const parts = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex();
    if (!position || !index) continue;
    const normals = mesh.geometry.getAttribute("normal");
    mesh.updateWorldMatrix(true, false);
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const positions = new Float32Array(position.count * 3);
    const outNormals = new Float32Array(position.count * 3);
    for (let at = 0; at < position.count; at += 1) {
      point.fromBufferAttribute(position, at).applyMatrix4(mesh.matrixWorld);
      positions.set([point.x, point.y, point.z], at * 3);
      if (normals) {
        normal.fromBufferAttribute(normals, at).applyMatrix3(normalMatrix).normalize();
        outNormals.set([normal.x, normal.y, normal.z], at * 3);
      }
    }
    parts.push({ positions, normals: normals ? outNormals : null, indices: Array.from(index.array) });
  }
  return parts;
}

/** Сцена или `null`, если рендерер окна занят другим кадром (или WebGL2 нет). */
export function createAnimalScene({ onChange = null } = {}) {
  const owner = {};
  const windowed = claimWindowRenderer(owner, { antialias: true, strict: false });
  if (!windowed) return null;
  const { renderer } = windowed;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = windowed.roomEnvironment();
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.4, 3.2, 2.6);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.7);
  fill.position.set(-2.6, 1.6, 1.8);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  rim.position.set(-0.8, 2.4, -2.8);
  scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.35));
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);

  const stage = new THREE.Group();
  const body = new THREE.Group();
  const decor = new THREE.Group();
  stage.add(body, decor);
  scene.add(stage);
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.visible = false;
  scene.add(shadow);

  /* Что на сцене сейчас. */
  const current = { id: "", bounds: null, points: null, parts: null, top: 0, bottom: 0, meshes: [], materials: [], look: null };
  /* Вид: орбита вокруг центра тела; `zoom` — множитель к расстоянию, при котором тело стоит «в меру» (`animal-framing.js`). */
  const view = { yaw: VIEW_YAW, pitch: VIEW_PITCH, zoom: 1, lift: 0, aspect: 1.6, target: new THREE.Vector3(), fit: 4 };
  let applied = null;
  let disposed = false;
  const holds = () => !disposed && windowed.held();

  /* Рамка тела: габарит в осях glTF → камера и тень. Камеру определяет только тело: метка и свечение её не двигают. */
  function frame(bounds) {
    const [minX, minY, minZ] = bounds.min;
    const [maxX, maxY, maxZ] = bounds.max;
    current.bottom = minY;
    current.top = maxY;
    const radius = Math.max(0.3, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
    refit();
    shadow.scale.set(radius * 3.2, radius * 3.2, 1);
    shadow.position.set((minX + maxX) / 2, minY + 0.01, (minZ + maxZ) / 2);
    shadow.visible = true;
  }

  /** Центр и расстояние по телу и по форме кадра; приближение человека (`zoom`) остаётся множителем. */
  function refit() {
    if (!current.bounds) return;
    const fitted = fitBodyView(current.points ? { points: current.points } : current.bounds, { aspect: view.aspect });
    view.target.set(...fitted.target);
    view.fit = fitted.distance;
  }

  function clearBody() {
    for (const group of [body, decor]) {
      for (const child of [...group.children]) {
        group.remove(child);
        child.traverse?.((node) => {
          node.geometry?.dispose?.();
        });
      }
    }
    for (const entry of current.materials) {
      entry.material.map?.dispose?.();
      entry.material.dispose?.();
    }
    current.meshes = [];
    current.materials = [];
  }

  /** Тело из GLB игры: листы цвета запоминаются, чтобы перекраску можно было менять без перечитывания. */
  async function load(glb, info) {
    clearBody();
    const gltf = await new GLTFLoader().parseAsync(glb.slice ? glb.slice(0) : glb, "");
    if (!holds()) return;
    gltf.scene.traverse((node) => {
      if (!node.isMesh) return;
      node.frustumCulled = false;
      const source = node.material;
      const image = source.map?.image;
      const material = new THREE.MeshStandardMaterial({
        map: source.map || null,
        normalMap: source.normalMap || null,
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      const entry = { material, name: String(source.name || ""), original: null, painted: null, canvas: null };
      if (image && DIFFUSE_NAME.test(entry.name)) {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(image, 0, 0);
          entry.canvas = canvas;
          entry.original = context.getImageData(0, 0, canvas.width, canvas.height);
          entry.mean = meanLuma(entry.original.data);
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = SRGB;
          texture.flipY = false;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = 4;
          material.map = texture;
        }
      }
      node.material = material;
      current.materials.push(entry);
      current.meshes.push(node);
    });
    body.add(gltf.scene);
    current.id = info.id;
    current.bounds = info.bounds;
    current.points = bodyPoints(current.meshes);
    current.parts = null;
    view.zoom = 1;
    frame(info.bounds);
    current.look = null;
    onChange?.();
  }

  /** Перекраска: пиксели каждого листа цвета заново из исходных (формулы установщика). `colour` — `{ on, hex, strength, brightness }`. */
  function paint(colour) {
    for (const entry of current.materials) {
      if (!entry.original || !entry.canvas) continue;
      const context = entry.canvas.getContext("2d");
      if (!colour?.on) {
        context.putImageData(entry.original, 0, 0);
      } else {
        const tinted = tintRgba(entry.original.data, entry.canvas.width, entry.canvas.height, {
          kind: "tint",
          colour: colour.hex,
          ref: entry.mean,
          brightness: colour.brightness,
          strength: colour.strength,
        });
        context.putImageData(new ImageData(tinted, entry.canvas.width, entry.canvas.height), 0, 0);
      }
      entry.material.map.needsUpdate = true;
    }
  }

  function clearDecor() {
    for (const child of [...decor.children]) {
      decor.remove(child);
      child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
  }

  /** Оболочка свечения: копии сеток тела, раздутые вдоль нормалей (в игре — шейдер `emissive_alpha` с тем же цветом и прозрачностью). */
  function glowShell(glow) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(glow.hex),
      transparent: true,
      opacity: Math.min(1, glow.alpha * (0.6 + glow.power * 0.25)),
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    const inflate = glow.reach / 100;
    for (const mesh of current.meshes) {
      const source = mesh.geometry;
      const position = source.getAttribute("position");
      const normal = source.getAttribute("normal");
      if (!position || !normal) continue;
      const geometry = source.clone();
      const moved = geometry.getAttribute("position");
      for (let index = 0; index < moved.count; index += 1)
        moved.setXYZ(index, position.getX(index) + normal.getX(index) * inflate, position.getY(index) + normal.getY(index) * inflate, position.getZ(index) + normal.getZ(index) * inflate);
      moved.needsUpdate = true;
      const shell = new THREE.Mesh(geometry, material);
      shell.matrixAutoUpdate = false;
      mesh.updateWorldMatrix(true, false);
      shell.matrix.copy(mesh.matrixWorld);
      shell.frustumCulled = false;
      shell.renderOrder = 2;
      decor.add(shell);
    }
  }

  /** Сетка метки RAGE → геометрия сцены: позиции и нормали `(x, y, z) → (x, z, −y)`. */
  function markerGeometry(raw) {
    const positions = new Float32Array(raw.positions.length);
    for (let index = 0; index < raw.positions.length; index += 3) {
      positions[index] = raw.positions[index];
      positions[index + 1] = raw.positions[index + 2];
      positions[index + 2] = -raw.positions[index + 1];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(raw.uvs), 2));
    if (raw.normals) {
      const normals = new Float32Array(raw.normals.length);
      for (let index = 0; index < raw.normals.length; index += 3) {
        normals[index] = raw.normals[index];
        normals[index + 1] = raw.normals[index + 2];
        normals[index + 2] = -raw.normals[index + 1];
      }
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }
    geometry.setIndex(raw.indices);
    return geometry;
  }

  /** Метка: тот же набор вершин, что уйдёт в модель (оси RAGE → glTF). Вид «эмблема» без картинки не рисуется — как и в игре. */
  function markerMesh(marker, base, height) {
    if (marker.kind === "model") {
      current.parts ||= bodyParts(current.meshes);
      if (!current.parts.length) return null;
      const raw = buildModelMarker({ parts: current.parts, height, size: marker.modelSize, pole: marker.pole, base });
      /* Копия — настоящий предмет: форма читается по свету, цвет и свечение — те же, что у листа в игре. Обе стороны граней
         рисуются: порядок вершин GLB и файла игры может быть обратным, а предпросмотр не должен выворачиваться. */
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(marker.hex),
        emissive: new THREE.Color(marker.hex),
        emissiveIntensity: Math.min(1.2, 0.3 + marker.power * 0.1),
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(markerGeometry(raw), material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      return mesh;
    }
    if (marker.kind === "emblem" && !marker.picture) return null;
    const raw = buildMarkerMesh({ height, size: marker.size, pole: marker.pole, base, ...(marker.kind === "emblem" ? { poleUv: EMBLEM_POLE_UV } : {}) });
    const geometry = markerGeometry(raw);
    const texture = markerTexture({ ...marker, onReady: () => onChange?.() });
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      /* Сила свечения: выше обычного — светится ярче белого значка; в кадре это насыщенность цвета. */
      color: new THREE.Color().setScalar(Math.min(1.6, 0.8 + marker.power * 0.12)),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return mesh;
  }

  /**
   * Украшения: свечение и метка. Высота метки уже подогнана под шар видимости (`fitMarkerHeight`); у «своей эмблемы»
   * `marker.picture` — адрес готовой картинки из хранилища окна (пока его нет, метки в кадре нет).
   */
  function decorate({ glow, marker, markerHeight }) {
    clearDecor();
    if (glow?.on) glowShell(glow);
    if (marker?.on && current.bounds) {
      const mesh = markerMesh(marker, current.top, markerHeight ?? marker.height);
      if (mesh) decor.add(mesh);
    }
    onChange?.();
  }

  /* Камера по орбите вокруг тела. */
  function aim(aspect) {
    if (Math.abs(aspect - view.aspect) > 0.001) {
      view.aspect = aspect;
      refit();
    }
    const distance = view.fit * view.zoom;
    const flat = Math.cos(view.pitch) * distance;
    /* `lift` — на сколько центр кадра поднят над центром тела: «показать метку целиком» поднимает его к середине между ногами и меткой. */
    const centre = { x: view.target.x, y: view.target.y + view.lift, z: view.target.z };
    camera.position.set(centre.x + Math.sin(view.yaw) * flat, centre.y + Math.sin(view.pitch) * distance, centre.z + Math.cos(view.yaw) * flat);
    camera.aspect = aspect;
    camera.lookAt(centre.x, centre.y, centre.z);
    camera.updateProjectionMatrix();
  }

  function render(target, [width, height]) {
    if (!holds()) return false;
    const ratio = (() => {
      const pixels = width * height * screenRatio() ** 2;
      return pixels > MAX_STAGE_PIXELS ? Math.max(0.5, screenRatio() * Math.sqrt(MAX_STAGE_PIXELS / pixels)) : screenRatio();
    })();
    if (!applied || applied.width !== width || applied.height !== height || applied.ratio !== ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      applied = { width, height, ratio };
    }
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    aim(width / height);
    renderer.render(scene, camera);
    windowed.present(target);
    return true;
  }

  /** Поворот и приближение: мышью. */
  function orbit(dx, dy) {
    view.yaw -= dx * 0.008;
    view.pitch = Math.max(-0.2, Math.min(1.2, view.pitch + dy * 0.006));
  }
  function zoom(factor) {
    view.zoom = Math.max(0.35, Math.min(16, view.zoom * factor));
  }
  function reset() {
    view.yaw = VIEW_YAW;
    view.pitch = VIEW_PITCH;
    view.zoom = 1;
    view.lift = 0;
  }
  /**
   * Показать метку целиком (кнопка под кадром): центр поднимается к середине между подошвой тела и верхом метки `topY` (в
   * осях сцены), камера отодвигается, чтобы влезли оба. Обычный кадр держит зверя крупным и по центру — метка может быть выше
   * его; «двойной щелчок» возвращает прежний вид.
   */
  function revealMarker(topY) {
    if (!current.bounds || !Number.isFinite(topY)) return;
    const low = current.bottom;
    const half = Math.max(0.5, (topY - low) / 2) * 1.2;
    const needed = half / Math.tan((FOV * Math.PI) / 360);
    view.lift = (topY + low) / 2 - view.target.y;
    view.zoom = Math.max(1, Math.min(16, needed / view.fit));
  }

  function dispose() {
    disposed = true;
    clearBody();
    clearDecor();
    shadowMaterial.map?.dispose();
    shadowMaterial.dispose();
    shadow.geometry.dispose();
    releaseGpu(scene, scene.environment);
    releaseWindowRenderer(owner);
  }

  return { load, paint, decorate, render, orbit, zoom, reset, revealMarker, dispose, hasBody: () => current.meshes.length > 0, bounds: () => current.bounds };
}

