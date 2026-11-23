/*
 * Программы студии ствола — заранее, пока читается модель, а не на её первом кадре (14.11.2026, «Astral быстрее»; `docs/3D.md`, правило 7).
 *
 * Вход в студию — около 1,4 с (замер 13.10: одна задача 555 мс на первом кадре), и значительная часть — сборка шейдеров: D3D11 собирает программу
 * при первом её использовании, а студия до прихода модели (чтение у Desktop — десятки мс при тёплом кэше, секунды при холодном) рисует пустую
 * сцену и собрать нечего. Программы ствола известны заранее: GLB оружия (`packages/rage-drawable/glb.js`) несёт `MeshStandardMaterial` с цветовым листом
 * (sRGB), необязательной картой нормалей, `metalness 0`, `roughness 0.85`, `doubleSided` (оболочка — нет) и режимом прозрачности (`OPAQUE` / `MASK` / `BLEND`),
 * светящееся — `emissiveMap` тем же листом. Здесь по этим описаниям делается набор безымянных материалов (на одном треугольнике), и студия отдаёт его
 * параллельному компилятору (`compileScene`, `shader-warmup.js`) на СВОЁМ рендерере и против СВОИХ света и окружения (`lightScene` — третий аргумент
 * `renderer.compile`: он берёт у сцены огни и `environment`, а материалы — у «образцовой»). Модель приходит — её материалы берут готовые программы из кэша
 * three (ключ программы один: тот же набор определений, число огней, окружение).
 *
 * Образцы живут, пока их держит студия (`dispose()`): освобождённый материал отпускает программу, и без закрепления окна (`keep` — `keepPrograms`
 * общего рендерера) она ушла бы, не дождавшись модели. Закрывать образцы можно, когда первая модель собрана или студия закрыта.
 *
 * Подключение (файлы студии ствола — зона других сессий, здесь не правились): в `gun-scene-frame.js: startLoop`, сразу после `ctx.warmup.warm()` —
 *   ctx.prewarm = prewarmStudioPrograms({ renderer: ctx.renderer, camera: ctx.camera, lightScene: ctx.scene, alive: () => !ctx.closed, keep: () => ctx.windowLease?.keepPrograms() });
 * и в `gun-scene-lifecycle.js: stopServices` — `ctx.prewarm?.dispose()` рядом с `warmup.stop()`.
 *
 * Не проверено на видеокарте: тест держит рецепты и порядок вызовов; что программы совпали с настоящими, показывает стенд `gun-pick.mjs` (число
 * программ, связанных на открытии, и ожидание `getProgramParameter`) — они обязаны упасть. Расхождение читается по `window.__astralGunModel.materials`.
 */

import * as THREE from "three";
import { compileScene } from "./shader-warmup.js";

/** Какие материалы бывают у ствола: оболочка (одна сторона) или двусторонняя, с картой нормалей или без, вырезная, прозрачная, светящаяся. */
export const STUDIO_RECIPES = Object.freeze([
  Object.freeze({ id: "opaque", normal: false, doubleSided: true, alpha: "opaque", glow: false }),
  Object.freeze({ id: "opaque-normal", normal: true, doubleSided: true, alpha: "opaque", glow: false }),
  Object.freeze({ id: "shell", normal: false, doubleSided: false, alpha: "opaque", glow: false }),
  Object.freeze({ id: "shell-normal", normal: true, doubleSided: false, alpha: "opaque", glow: false }),
  Object.freeze({ id: "mask", normal: false, doubleSided: true, alpha: "mask", glow: false }),
  Object.freeze({ id: "mask-normal", normal: true, doubleSided: true, alpha: "mask", glow: false }),
  Object.freeze({ id: "blend", normal: false, doubleSided: true, alpha: "blend", glow: false }),
  Object.freeze({ id: "glow", normal: false, doubleSided: true, alpha: "opaque", glow: true }),
]);

/* Порог вырезной прозрачности GLB по умолчанию (`alphaCutoff` glTF). */
const ALPHA_CUTOFF = 0.5;

function pixel(colorSpace) {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = colorSpace;
  return texture;
}

/** Материал по рецепту — так же, как его собирает `GLTFLoader` из материала GLB оружия. */
export function materialOfRecipe(recipe, pictures) {
  const material = new THREE.MeshStandardMaterial({
    map: pictures.colour,
    metalness: 0,
    roughness: 0.85,
    side: recipe.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (recipe.normal) material.normalMap = pictures.normal;
  if (recipe.glow) {
    material.emissive = new THREE.Color(1, 1, 1);
    material.emissiveMap = pictures.colour;
  }
  if (recipe.alpha === "mask") material.alphaTest = ALPHA_CUTOFF;
  if (recipe.alpha === "blend") {
    material.transparent = true;
    material.depthWrite = false;
  }
  return material;
}

/** Образцы: сцена с безымянными сетками (по одной на рецепт) и `dispose()`. Геометрия — как у модели игры: положение, нормаль, развёртка. */
export function createStudioStandIns(recipes = STUDIO_RECIPES) {
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  const pictures = { colour: pixel(THREE.SRGBColorSpace), normal: pixel(THREE.NoColorSpace) };
  const materials = recipes.map((recipe) => materialOfRecipe(recipe, pictures));
  for (const material of materials) scene.add(new THREE.Mesh(geometry, material));
  let released = false;
  return {
    scene,
    materials,
    dispose() {
      if (released) return;
      released = true;
      for (const material of materials) material.dispose();
      geometry.dispose();
      pictures.colour.dispose();
      pictures.normal.dispose();
    },
  };
}

/**
 * Собрать программы студии заранее. `renderer`, `camera` — студии; `lightScene` — её сцена (огни и окружение берутся оттуда); `alive` — студия жива;
 * `keep` — закрепить программы общего рендерера окна (`keepPrograms`) после сборки. Возвращает `{ ready, dispose }`: `ready` — обещание
 * (`true` — собрано, `false` — не вышло или студию закрыли; сбой не бросается: студия соберёт программы сама, как прежде); `dispose()` — отпустить образцы.
 */
export function prewarmStudioPrograms({ renderer, camera, lightScene, alive = () => true, keep = null, recipes = STUDIO_RECIPES } = {}) {
  const nothing = { ready: Promise.resolve(false), dispose() {} };
  if (typeof renderer?.compile !== "function" || !camera || !lightScene || !alive()) return nothing;
  const standIns = createStudioStandIns(recipes);
  let ready;
  try {
    ready = compileScene(renderer, standIns.scene, camera, alive, lightScene);
  } catch {
    standIns.dispose();
    return nothing;
  }
  return {
    ready: ready.then(
      (done) => {
        if (done && alive()) keep?.();
        return Boolean(done);
      },
      () => false,
    ),
    dispose: () => standIns.dispose(),
  };
}
