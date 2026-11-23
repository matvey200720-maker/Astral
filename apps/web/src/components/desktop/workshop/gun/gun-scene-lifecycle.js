// Зона Z7, часть 2: переключатели управления, снимок, освобождение сцены
// и сборка объекта API, который отдаёт createGunScene.

import {
  releaseGpu,
  releaseWindowRenderer,
} from "../../../../features/workshop/engine/window-renderer.js";
import * as THREE from "three";

// Кадр рисуется сразу, в обход цикла кадров.
function snapshot(ctx, type) {
  const { ops, renderer, scene, camera, canvas, windowLease } = ctx;
  ops.aimLights();
  renderer.render(scene, camera);
  windowLease?.present(canvas);
  return canvas.toDataURL(type);
}

// Службы сцены гасятся по порядку: полёт, программы окна, таймер рентгена, прогрев, украшения, цикл, управление.
function stopServices(ctx) {
  const { ops, windowLease, warmup, decorations, loop, controls, viewMemory } = ctx;
  ops.cancelFlight();
  windowLease?.keepPrograms();
  clearTimeout(ctx.xrayTimer); // само значение не обнуляется
  warmup.stop();
  decorations.dispose();
  loop.stop();
  controls.removeEventListener("change", ctx.requestRender);
  controls.dispose();
  viewMemory.forget();
}

// Ресурсы видеопамяти: модель с её текстурами, кэш, запекание, текстуры наклеек, окружение.
function releaseAssets(ctx) {
  const { ops, textureCache, decalBaker, decalTextures, studioEnv } = ctx;
  ops.clearModel(true);
  textureCache.dispose();
  decalBaker.dispose();
  decalTextures.forEach((texture) => texture.dispose());
  decalTextures.clear();
  studioEnv.dispose();
}

// Общий рендерер принадлежит окну: сцена уходит из него, аренда возвращается.
function releaseShared(ctx) {
  releaseGpu(ctx.scene, null);
  ctx.renderer.renderLists.dispose();
  releaseWindowRenderer(ctx.leaseOwner);
  ctx.windowLease = null;
}

// Собственный рендерер закрывается; контекст теряется, если холст уже вне страницы.
function releaseOwn(renderer) {
  renderer.dispose();
  if (renderer.domElement?.isConnected) return;
  renderer.forceContextLoss?.();
}

function dispose(ctx) {
  ctx.closed = true;
  stopServices(ctx);
  releaseAssets(ctx);
  if (ctx.windowLease) releaseShared(ctx);
  else releaseOwn(ctx.renderer);
}

// Члены API по порядку (specs/gun-scene-api.md, раздел 2) и откуда каждый берётся:
// "op" — операция другой зоны без обёрток, "own" — собственная функция, "get" — геттер.
const API_MEMBERS = [
  ["load", "op"],
  ["unload", "own"],
  ["resize", "op"],
  ["frameModel", "op"],
  ["focusPart", "op"],
  ["outfitMaterials", "op"],
  ["paintOutfit", "op"],
  ["bindSurface", "op"],
  ["refreshSurface", "op"],
  ["setGlowShown", "op"],
  ["setModelShape", "op"],
  ["setOwnFit", "op"],
  ["setGhost", "op"],
  ["showGhost", "op"],
  ["pickSurface", "op"],
  ["pickMirror", "op"],
  ["islandClip", "op"],
  ["itemParts", "op"],
  ["itemPartKey", "op"],
  ["setDetachable", "op"],
  ["detachIsland", "op"],
  ["syncDetached", "op"],
  ["detachedPieces", "op"],
  ["pickPlacement", "op"],
  ["zoneMask", "op"],
  ["setLighting", "op"],
  ["viewFrom", "op"],
  ["viewState", "op"],
  ["zoomBy", "op"],
  ["onViewChange", "op"],
  ["previewSticker", "op"],
  ["bakeSticker", "op"],
  ["stickerSpill", "op"],
  ["setStickerParts", "op"],
  ["setFinish", "op"],
  ["setDecorations", "own"],
  ["previewDecoration", "own"],
  ["selectDecoration", "own"],
  ["pickDecoration", "op"],
  ["pickAlong", "op"],
  ["wrapProfile", "op"],
  ["screenOf", "op"],
  ["screenOfSticker", "op"],
  ["setControlsEnabled", "op"],
  ["setNavigationMode", "op"],
  ["setZoomEnabled", "op"],
  ["requestRender", "own"],
  ["snapshot", "op"],
  ["canvas", "get"],
  ["disposed", "get"],
  ["dispose", "op"],
];

export const buildApi = (ctx) => {
  const { ops } = ctx;
  const missing = [];
  for (const [name, source] of API_MEMBERS) {
    if (source === "op" && typeof ops[name] !== "function") missing.push(name);
  }
  if (missing.length > 0) throw new Error(`gun-scene: не подключены операции ${missing.join(", ")}`);

  const own = {
    unload() {
      ctx.loadSerial += 1;
      ops.clearModel(true);
      ctx.requestRender();
    },
    setDecorations: (list, images) => ctx.decorations.set(list, images),
    previewDecoration: (decoration, image) => ctx.decorations.preview(decoration, image),
    selectDecoration: (id) => ctx.decorations.select(id),
    requestRender: ctx.requestRender,
  };
  const getters = { canvas: () => ctx.canvas, disposed: () => ctx.closed };
  const api = {};
  for (const [name, source] of API_MEMBERS) {
    if (source === "get") {
      Object.defineProperty(api, name, { get: getters[name], enumerable: true, configurable: true });
    } else {
      api[name] = source === "own" ? own[name] : ops[name];
    }
  }
  return api;
};

export const attachLifecycleZone = (ctx) => {
  Object.assign(ctx.ops, {
    // значение кладётся как есть, без приведения к булеву
    setControlsEnabled: (enabled) => {
      ctx.controls.enabled = enabled;
    },
    setNavigationMode: (mode) => {
      ctx.controls.mouseButtons.LEFT = mode === "orbit" ? THREE.MOUSE.ROTATE : null;
    },
    setZoomEnabled: (enabled) => {
      ctx.controls.enableZoom = Boolean(enabled);
    },
    snapshot: (type = "image/png") => snapshot(ctx, type),
    dispose: () => dispose(ctx),
  });
  return ctx.ops;
};
