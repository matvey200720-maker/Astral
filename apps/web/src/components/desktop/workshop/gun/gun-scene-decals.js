// Зона Z7, часть 1: наклейки-проекторы на модели (предпросмотр, запекание, «расползание»).
// Состояние — в общем объекте ctx (имена полей — в gun-scene-frame.js, createFrame), чужие операции — в ctx.ops.

import * as THREE from "three";
import {
  assignDecalUniforms,
  buildBakeGeometry,
  createDecalOverlayMaterial,
  decalTouches,
  decalUniforms,
  stickerPartOf,
  stickerSpill,
} from "./gun-decals.js";

// Одна картинка — одна текстура на всю жизнь сцены.
const textureOf = (ctx, image) => {
  if (!image) return null;
  if (!ctx.decalTextures.has(image)) {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    ctx.decalTextures.set(image, texture);
  }
  return ctx.decalTextures.get(image);
};

const geometryOf = (ctx, entry) => {
  entry.bakeGeometry ||= buildBakeGeometry(entry.meshes, ctx.holder, entry.mapper.matrix);
  return entry.bakeGeometry;
};

const uniformsFor = (ctx, sticker, image) => {
  const uniforms = decalUniforms(sticker, textureOf(ctx, image), ctx.span);
  ctx.holder.updateMatrixWorld(true);
  if (ctx.stickerPartOnly) {
    // геометрии строятся для всех записей, даже не задетых наклейкой
    const geometries = ctx.entries.map((entry) => geometryOf(ctx, entry));
    uniforms.uPart.value = stickerPartOf(geometries, uniforms);
  }
  return uniforms;
};

// Прозрачная копия сетки с общим материалом проектора; помечена служебной меткой,
// поэтому обход, который видит и копии, их пропускает.
const overlayOf = (node, material) => {
  const copy = new THREE.Mesh(node.geometry, material);
  copy.userData.astralOverlay = true;
  copy.frustumCulled = false;
  copy.renderOrder = 2;
  return copy;
};

// Копия каждой «настоящей» сетки под корнем.
const addOverlays = (ctx, material) => {
  const hosts = [];
  ctx.root.traverse((node) => {
    if (node.isMesh && !node.userData.astralOverlay) hosts.push(node);
  });
  return hosts.map((node) => {
    const copy = overlayOf(node, material);
    node.add(copy);
    return copy;
  });
};

// Матрица «копия → держатель» пересчитывается в момент отрисовки каждой копии.
const followHolder = (ctx, copy) => {
  copy.onBeforeRender = () => {
    const live = ctx.stickerPreview;
    if (!live) return;
    const toRoot = live.material.uniforms.uToRoot.value;
    toRoot.copy(ctx.holder.matrixWorld);
    toRoot.invert();
    toRoot.multiply(copy.matrixWorld);
  };
};

const dropPreview = (ctx) => {
  const live = ctx.stickerPreview;
  if (!live) return;
  for (const copy of live.meshes) copy.removeFromParent();
  live.material.dispose();
  ctx.stickerPreview = null;
};

const previewSticker = (ctx, sticker, image) => {
  if (!(sticker && image && ctx.root)) {
    dropPreview(ctx);
    ctx.requestRender();
    return;
  }
  const uniforms = uniformsFor(ctx, sticker, image);
  if (!ctx.stickerPreview) {
    const material = createDecalOverlayMaterial(uniforms);
    ctx.stickerPreview = { material, meshes: addOverlays(ctx, material) };
  }
  const live = ctx.stickerPreview;
  assignDecalUniforms(live.material.uniforms, uniforms);
  for (const copy of live.meshes) followHolder(ctx, copy);
  ctx.requestRender();
};

const bakeSticker = (ctx, sticker, image) => {
  const baked = new Map();
  if (!ctx.root || !image) return baked;
  const uniforms = uniformsFor(ctx, sticker, image);
  for (const entry of ctx.entries) {
    const { width, height } = entry;
    const sheet = ctx.decalBaker.bake({ geometry: geometryOf(ctx, entry), width, height, uniforms });
    if (sheet) baked.set(entry.name, sheet);
  }
  return baked;
};

const spillSticker = (ctx, sticker, image) => {
  if (!ctx.root || !image) return { painted: 0, shared: 0 };
  const uniforms = uniformsFor(ctx, sticker, image);
  const total = { painted: 0, shared: 0 };
  for (const entry of ctx.entries) {
    const geometry = geometryOf(ctx, entry);
    if (!decalTouches(geometry, uniforms)) continue;
    const part = stickerSpill(geometry, uniforms);
    total.painted += part.painted;
    total.shared += part.shared;
  }
  return total;
};

export const attachDecalZone = (ctx) => {
  ctx.stickerPartOnly ??= true;
  ctx.stickerPreview ??= null;
  ctx.decalTextures = new Map();
  return Object.assign(ctx.ops, {
    dropStickerPreview() {
      dropPreview(ctx);
    },
    setStickerParts(on) {
      ctx.stickerPartOnly = on !== false;
    },
    previewSticker(sticker, image) {
      previewSticker(ctx, sticker, image);
    },
    bakeSticker(sticker, image) {
      return bakeSticker(ctx, sticker, image);
    },
    stickerSpill(sticker, image) {
      return spillSticker(ctx, sticker, image);
    },
  });
};
