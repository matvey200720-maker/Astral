/*
 * Украшения в кадре мастерской (задача 13 ТЗ 10.10.2026; объём — задача 6
 * ТЗ 11.10.2026: лоза, объёмные цветы, своя голограмма).
 *
 * Сетки — те же, что Astral Desktop ставит геометрией в модель ствола игры
 * (`@modovik/gun-studio/decorations.js`): цветок в кадре и цветок в руках в
 * игре — одни и те же треугольники; кадр показывает полную детализацию —
 * ту, что у модели в руках (`_hi`). Группа украшений — ребёнок корня модели:
 * вершины лежат в осях модели, и украшение ездит с ней — в витрине, в руках
 * персонажа, с размером ствола.
 *
 * Голограмма считается по пикселям своей картинки в квадрате 256×256 — тем
 * же, что уедут PNG в игру (`decoration-images.js`). Светящаяся рисуется без
 * света сцены, сама по себе ярче и полупрозрачной — как `emissive_alpha` в
 * игре.
 *
 * Кисть, наклейка и мерки кадра украшений не видят (`astralOverlay`), щелчок
 * по украшению его выбирает (`pick`). Выбранное обведено кольцом поверх
 * всего — маленькое украшение иначе не найти взглядом; у лозы кольцо —
 * поперёк ствола.
 */

import * as THREE from "three";
import {
  DECORATION_LOGO_SIZE,
  attachedModelAtlas,
  decorationMesh,
  decorationTexture,
  isWrapKind,
} from "@modovik/gun-studio";
import { artworkKey, artworkPixels } from "./decoration-images.js";

/* Что меняет сетку и что — лист: по ним кэш не перестраивает лишнего. */
const shapeKey = (item) =>
  JSON.stringify([
    item.kind,
    item.variant,
    item.anchor,
    item.normal,
    item.size,
    item.rotation,
    item.zone,
    item.turns,
    item.thickness,
    item.density,
    item.blooms,
    item.gap,
    item.wrap,
    item.depth,
    item.lift,
    item.pose,
    item.glow,
    item.kind === "hologram" || item.kind === "model" ? artworkKey(item) : "",
  ]);
const sheetKey = (item) =>
  item.kind === "logo"
    ? `logo:${item.source || ""}`
    : item.kind === "model"
      ? `model:${item.source || ""}:${item.colour}`
    : item.kind === "hologram"
      ? `holo:${artworkKey(item)}:${item.variant}:${item.colour}:${item.accent}:${item.opacity}`
      : item.kind === "garland" && item.variant === "lights"
        ? `lights:${item.colour}:${item.accent}:${item.glow}`
        : `sheet:${item.kind}:${item.variant}:${item.colour}:${item.accent}`;
const pictured = (item) => item.kind === "logo" || item.kind === "hologram" || item.kind === "model";

function geometryOf(decoration, image) {
  const pixels = decoration.kind === "hologram" ? artworkPixels(image) : null;
  if (decoration.kind === "hologram" && !pixels) return null;
  /* Своя модель на стволе — по разобранному .glb (`attachedModelArtwork`); тяжелее предела — пусто. */
  let mesh;
  try {
    mesh = decorationMesh(decoration, { pixels, model: decoration.kind === "model" ? image?.model || null : null });
  } catch {
    return null;
  }
  if (!mesh.vertices) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/* Лист цветов (у голограммы — её лист): строка 0 — верх, как у развёртки и у DDS в игре. */
function sheetTexture(decoration, image = null) {
  const sheet = decorationTexture(decoration, { pixels: decoration.kind === "hologram" ? artworkPixels(image) : null });
  const texture = new THREE.DataTexture(sheet.rgba, sheet.width, sheet.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/* Логотип — как его кладёт хост: картинка целиком в квадрат 128×128,
   прозрачные поля. */
function logoTexture(image) {
  const size = DECORATION_LOGO_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  const width = Number(image?.naturalWidth || image?.width) || size;
  const height = Number(image?.naturalHeight || image?.height) || size;
  const scale = Math.min(size / width, size / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (image) context?.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/* Лист своей модели: её картинки в клетках и клетка цветов, с оттенком украшения. */
function modelTexture(decoration, artwork) {
  const sheet = attachedModelAtlas(artwork.layout, artwork.pictures, decoration.colour);
  const texture = new THREE.DataTexture(sheet.rgba, sheet.width, sheet.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  texture.userData.astralAlpha = Boolean(artwork.layout.alpha);
  return texture;
}

const textureOf = (decoration, image) =>
  decoration.kind === "logo" ? logoTexture(image) : decoration.kind === "model" ? modelTexture(decoration, image) : sheetTexture(decoration, image);

function materialFor(decoration, map, { ghost = false } = {}) {
  /* Светящаяся голограмма: без света сцены, ярче на силу свечения,
     прозрачность — из листа. */
  if (decoration.kind === "hologram" && decoration.variant === "glow") {
    const material = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      opacity: ghost ? 0.6 : 1,
      depthWrite: false,
    });
    material.color.setScalar(1 + (Number(decoration.glow) || 0) * 0.12);
    return material;
  }
  /* Огоньки гирлянды (ТЗ 17.10.2026) светятся сами: лист — и цвет, и
     свечение (провод тёмный — тёмным и светится), как шейдер `emissive`. */
  if (decoration.kind === "garland" && decoration.variant === "lights") {
    const material = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: map,
      roughness: 0.4,
      metalness: 0,
      transparent: ghost,
      opacity: ghost ? 0.72 : 1,
      depthWrite: !ghost,
    });
    material.emissive.setScalar(Math.min(1.6, (Number(decoration.glow) || 0) * 0.3));
    return material;
  }
  const logo = decoration.kind === "logo" || (decoration.kind === "model" && Boolean(map?.userData?.astralAlpha));
  return new THREE.MeshStandardMaterial({
    map,
    roughness: logo ? 0.5 : 0.62,
    metalness: 0,
    transparent: logo || ghost,
    opacity: ghost ? 0.72 : 1,
    alphaTest: logo ? 0.04 : 0,
    depthWrite: !ghost,
  });
}

export function createDecorationLayer({ requestRender = () => {} } = {}) {
  const group = new THREE.Group();
  group.name = "astral-decorations";
  /* id → { mesh, shape, sheet, normal, axis } */
  const entries = new Map();
  /* ключ листа → { texture, users } */
  const sheets = new Map();
  let selectedId = "";
  let outline = null;
  let ghost = null;

  function textureFor(decoration, image) {
    const key = sheetKey(decoration);
    let sheet = sheets.get(key);
    if (!sheet) {
      if (pictured(decoration) && !image) return null;
      sheet = { texture: textureOf(decoration, image), users: 0 };
      sheets.set(key, sheet);
    }
    sheet.users += 1;
    return sheet.texture;
  }

  function releaseTexture(key) {
    const sheet = sheets.get(key);
    if (!sheet) return;
    sheet.users -= 1;
    if (sheet.users > 0) return;
    sheet.texture.dispose();
    sheets.delete(key);
  }

  function dropEntry(id) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.mesh.removeFromParent();
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    releaseTexture(entry.sheet);
    entries.delete(id);
  }

  function makeMesh(decoration, geometry, map, options) {
    const mesh = new THREE.Mesh(geometry, materialFor(decoration, map, options));
    mesh.userData.astralOverlay = true;
    mesh.userData.decorationId = decoration.id;
    mesh.frustumCulled = false;
    mesh.renderOrder = options?.ghost ? 3 : decoration.kind === "hologram" && decoration.variant === "glow" ? 2 : 1;
    return mesh;
  }

  /* Ось кольца выбранного: нормаль места, у лозы — ось ствола. */
  const outlineAxis = (decoration) => {
    if (isWrapKind(decoration.kind) && decoration.wrap) {
      const axis = [0, 0, 0];
      axis[decoration.wrap.axis] = 1;
      return { x: axis[0], y: axis[1], z: axis[2] };
    }
    return decoration.normal;
  };

  function drawOutline() {
    if (outline) {
      outline.removeFromParent();
      outline.geometry.dispose();
      outline.material.dispose();
      outline = null;
    }
    const entry = entries.get(selectedId);
    const sphere = entry?.mesh.geometry.boundingSphere;
    if (!sphere) return;
    /* Кольцо в плоскости под украшением, толщиной в долю своего радиуса —
       видно при любом приближении. */
    const radius = Math.max(sphere.radius * 1.12, 0.002);
    outline = new THREE.Mesh(
      new THREE.RingGeometry(radius * (isWrapKind(entry.kind) ? 0.95 : 0.86), radius, 64),
      new THREE.MeshBasicMaterial({ color: 0x7fdfff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }),
    );
    const normal = entry.axis;
    outline.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal.x, normal.y, normal.z).normalize());
    outline.position.copy(sphere.center);
    outline.renderOrder = 4;
    outline.userData.astralOverlay = true;
    group.add(outline);
  }

  /**
   * Украшения проекта в кадре. `images` — картинки логотипов и голограмм по
   * `id` украшения (без картинки в кадре ничего нет, как и в игре).
   */
  function set(list = [], images = new Map()) {
    const wanted = new Map(list.filter((item) => item.visible !== false).map((item) => [item.id, item]));
    for (const id of [...entries.keys()]) if (!wanted.has(id)) dropEntry(id);
    for (const decoration of wanted.values()) {
      const entry = entries.get(decoration.id);
      const shape = shapeKey(decoration);
      const sheet = sheetKey(decoration);
      if (entry && entry.shape === shape && entry.sheet === sheet) continue;
      const image = images.get(decoration.id) || null;
      if (pictured(decoration) && !image) {
        if (entry) dropEntry(decoration.id);
        continue;
      }
      if (entry && entry.sheet === sheet) {
        const geometry = geometryOf(decoration, image);
        if (!geometry) {
          dropEntry(decoration.id);
          continue;
        }
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = geometry;
        entry.shape = shape;
        entry.axis = outlineAxis(decoration);
        continue;
      }
      if (entry) dropEntry(decoration.id);
      const geometry = geometryOf(decoration, image);
      if (!geometry) continue;
      const map = textureFor(decoration, image);
      if (!map) {
        geometry.dispose();
        continue;
      }
      const mesh = makeMesh(decoration, geometry, map);
      group.add(mesh);
      entries.set(decoration.id, { mesh, shape, sheet, kind: decoration.kind, axis: outlineAxis(decoration) });
    }
    drawOutline();
    requestRender();
  }

  /** Украшение в руке у курсора — полупрозрачным; `null` убирает. */
  function preview(decoration, image = null) {
    if (ghost) {
      ghost.mesh.removeFromParent();
      ghost.mesh.geometry.dispose();
      ghost.mesh.material.dispose();
      if (ghost.own) ghost.own.dispose();
      ghost = null;
    }
    if (decoration && (!pictured(decoration) || image)) {
      const geometry = geometryOf(decoration, image);
      const shared = pictured(decoration) ? null : sheets.get(sheetKey(decoration))?.texture;
      const own = shared ? null : textureOf(decoration, image);
      if (geometry) {
        ghost = { mesh: makeMesh(decoration, geometry, shared || own, { ghost: true }), own };
        group.add(ghost.mesh);
      } else own?.dispose();
    }
    requestRender();
  }

  function select(id = "") {
    if (id === selectedId) return;
    selectedId = id;
    drawOutline();
    requestRender();
  }

  /** Украшение под лучом: `id` или пустая строка. */
  function pick(raycaster) {
    const meshes = [...entries.values()].map((entry) => entry.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit?.object.userData.decorationId || "";
  }

  return {
    group,
    attach(root) {
      if (root && group.parent !== root) root.add(group);
    },
    detach() {
      group.removeFromParent();
    },
    set,
    preview,
    select,
    pick,
    dispose() {
      preview(null);
      for (const id of [...entries.keys()]) dropEntry(id);
      for (const sheet of sheets.values()) sheet.texture.dispose();
      sheets.clear();
      selectedId = "";
      drawOutline();
      group.removeFromParent();
    },
  };
}
