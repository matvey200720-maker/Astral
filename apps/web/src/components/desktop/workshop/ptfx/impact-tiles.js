/*
 * Плитки выбора эффекта попадания (какая кровь, какой эффект игры, какая
 * картинка) — кадры того же движка, что и сцена: клон по рецепту установщика,
 * правила и листы игры игрока, её свет. Плитка — это миг выброса на чёрной
 * подложке без фигуры: так выбирают вид, а не место.
 *
 * Движок один на все плитки: один WebGL-контекст на невидимом холсте, кадр
 * снимается в data-URL и кэшируется. Пока листы грузятся, плитки нет (`null`),
 * а по готовности вызываются подписчики — окно перерисует плитки само. Без
 * WebGL или без базы игры — `undefined`: вызывающий рисует прежнюю схему.
 */

import {
  EffectInstance,
  buildEffectClone,
  effectFrame,
  loadModel,
  modelBatches,
  spriteBatches,
  trailBatches,
} from "@modovik/ptfx-runtime";
import {
  ASTRAL_BLOOD_SPRAY_TEXTURE,
  BLOOD_SHEET_GRID,
  BLOOD_SPRAY_TEXTURE,
  impactCloneRecipe,
} from "@modovik/ptfx-studio";
import { createPtfxRenderer } from "./ptfx-renderer.js";
import { sceneLighting } from "./ptfx-lighting.js";
import { createTextureBank } from "./ptfx-textures.js";
import { TOWARD_SHOOTER } from "./impact-scene.js";

const TILE_RULE = "astral_preview_tile";
const TILE_TEXTURE = "astral_preview_tile_art";
const PLATE = [0.027, 0.027, 0.031];
/* Миги, среди которых плитка ищет пик выброса, секунды. */
const TILE_MOMENTS = Object.freeze([0.03, 0.06, 0.1, 0.15, 0.22, 0.32, 0.45, 0.65]);

let engine = null;
let engineFailed = false;
let base = null;
let meshesKey = null;
const cache = new Map();
const listeners = new Set();

function announce() {
  cache.clear();
  for (const listener of [...listeners]) listener();
}

/** Подписка на готовность листов плиток. */
export function onTilesReady(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensureEngine() {
  if (engine || engineFailed) return engine;
  if (typeof document === "undefined") {
    engineFailed = true;
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    const bank = createTextureBank({ onReady: announce });
    const renderer = createPtfxRenderer({ canvas, lighting: sceneLighting({}) });
    engine = { canvas, bank, renderer, size: 0 };
  } catch {
    engineFailed = true;
    engine = null;
  }
  return engine;
}

/** База эффектов из игры игрока — та же, что у сцены. */
export function provideTileBase(next) {
  base = next || null;
  cache.clear();
  const current = ensureEngine();
  if (!current) return;
  current.bank.provideSheets(base?.impact?.sheets || null);
  current.renderer.setLighting(sceneLighting({ light: base?.light || null, hour: 13 }));
  const meshes = {};
  for (const exported of Object.values(base?.impact?.model || {})) Object.assign(meshes, exported?.meshes || {});
  const key = Object.keys(meshes).sort().join(",");
  if (key !== meshesKey) {
    meshesKey = key;
    current.renderer.setMeshes(meshes);
  }
}

/**
 * Кадр слоя для плитки: data-URL, `null` (листы ещё грузятся) или
 * `undefined` (движка нет — рисуйте схему).
 *
 * `art` — холст картинки слоя или своего листа брызг `{ canvas, columns,
 * rows }`; `time` — секунды от попадания; `extent` — сколько метров
 * помещается в плитку по высоте.
 */
export function engineTile(layer, { zoneId = "body", size = 96, time = 0.14, extent = 1.2, art = null, key = "" } = {}) {
  const exported = base?.impact?.model;
  if (!exported?.core) return undefined;
  const current = ensureEngine();
  if (!current) return undefined;
  const cacheKey = JSON.stringify([layer, zoneId, size, time, extent, key]);
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let clone;
  const textures = {};
  const own = new Map();
  if (art && (layer.kind === "custom" || layer.kind === "blood")) {
    textures[0] = TILE_TEXTURE;
    own.set(TILE_TEXTURE, art.canvas ? art : { canvas: art, columns: 1, rows: 1 });
  }
  try {
    const recipe = impactCloneRecipe(
      zoneId,
      { enabled: true, layers: [{ ...layer, placement: "front" }], distance: undefined },
      { rule: TILE_RULE, textures, placement: "front", rules: base?.impact?.rules || null },
    );
    if (!recipe) return undefined;
    clone = buildEffectClone(exported, recipe, { coreTextures: base?.core?.textures || [] });
  } catch {
    return undefined;
  }
  for (const item of clone.importedTextures) own.set(item.texture, { source: item.source });
  const model = loadModel(...Object.values(exported), clone);

  const lookup = (name) => {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    if (lower === ASTRAL_BLOOD_SPRAY_TEXTURE) return current.bank.game(BLOOD_SPRAY_TEXTURE, { neutral: true });
    const entry = own.get(lower) || own.get(name);
    if (entry?.canvas)
      return current.bank.canvas(`${key}:${lower}`, entry.canvas, {
        columns: entry.columns || BLOOD_SHEET_GRID.columns,
        rows: entry.rows || BLOOD_SHEET_GRID.rows,
      });
    if (entry?.source) return current.bank.game(entry.source);
    return current.bank.game(lower);
  };

  /*
   * Миг плитки — пик выброса: у каждого эффекта свой темп (вспышка живёт
   * сотые, дымка — секунды), и общая доля дала бы у одних пустую плитку, у
   * других — осевший след. Пик — наибольшая видимая площадь частиц.
   */
  const effectOptions = {
    frame: effectFrame({ origin: [0, 0, 0], z: TOWARD_SHOOTER, up: [0, 0, 1] }),
    seed: 0x7117,
    evolutions: { LOD: 0, angle: 0 },
  };
  const coverage = (instance) => {
    let area = 0;
    for (const slot of instance.slots())
      for (const particle of slot.particles)
        area += particle.size[0] * (particle.size[1] || particle.size[0]) * Math.min(1, Math.max(0, particle.colour[3]));
    return area;
  };
  let moment = time;
  let best = -1;
  for (const candidate of TILE_MOMENTS) {
    const probe = new EffectInstance(model, TILE_RULE, effectOptions);
    probe.step(candidate);
    const area = coverage(probe);
    if (area > best * 1.05) {
      best = area;
      moment = candidate;
    }
  }
  const instance = new EffectInstance(model, TILE_RULE, effectOptions);
  instance.step(moment);

  /* Кадр — по самим частицам (плоскость X–Z мира, камера смотрит по +Y). */
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const slot of instance.slots())
    for (const particle of slot.particles) {
      if (!(particle.colour[3] > 0.02)) continue;
      const half = Math.max(particle.size[0], particle.size[1] || 0) / 2;
      left = Math.min(left, particle.position[0] - half);
      right = Math.max(right, particle.position[0] + half);
      bottom = Math.min(bottom, particle.position[2] - half);
      top = Math.max(top, particle.position[2] + half);
    }
  const framed = Number.isFinite(left);
  const span = framed ? Math.max(right - left, top - bottom) * 1.25 : extent;
  const height = Math.min(Math.max(span, 0.14), 4);
  const centre = framed ? [(left + right) / 2, 0, (bottom + top) / 2] : [0, 0, extent * 0.2];

  const pixels = size * 2;
  if (current.size !== pixels) {
    current.renderer.resize(pixels, pixels, 1);
    current.size = pixels;
  }
  current.renderer.setPlate({ plate: PLATE, centre, metresTall: height, distance: 3 });
  const camera = current.renderer.camera;
  camera.updateMatrixWorld(true);
  const e = camera.matrixWorld.elements;
  const basis = {
    position: [camera.position.x, camera.position.y, camera.position.z],
    right: [e[0], e[1], e[2]],
    up: [e[4], e[5], e[6]],
  };
  /* Лист, которого ещё нет, — плитка подождёт: пустой кадр в кэш не идёт. */
  const needed = [];
  for (const slot of instance.slots()) {
    if (slot.rule.drawType !== 1 && slot.rule.textures.diffuse) needed.push(slot.rule.textures.diffuse);
  }
  const waiting = needed.some((name) => !lookup(name));
  current.renderer.render(
    spriteBatches(instance, basis, lookup, "tile"),
    modelBatches(instance, "tile"),
    lookup,
    trailBatches(instance, basis, lookup, "tile"),
  );
  if (waiting) return null;
  let url = null;
  try {
    url = current.canvas.toDataURL("image/png");
  } catch {
    url = null;
  }
  if (cache.size > 200) cache.clear();
  cache.set(cacheKey, url);
  return url;
}
