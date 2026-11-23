/*
 * Поле «Травы вблизи» — WebGL (ТЗ 06.10.2026, вечер, задача 4).
 *
 * Лист земли — плиткой на плоскости под камерой на высоте глаз: вблизи
 * видны травинки, вдаль — общий тон, к горизонту — дымка того же цвета, что
 * небо за полем (небо рисует CSS под прозрачным холстом). Mip-карты и
 * анизотропия — чтобы даль не рябила, а ближний край не мылился. Кадр
 * рисуется только когда что-то поменялось: новый лист, цвет или размер.
 */

import * as THREE from "three";
import { createSceneWarmup, skipShaderChecks } from "../model-stage/shader-warmup.js";
import { profilePixelRatio, qualityProfile } from "../model-stage/quality-profile.js";

/* Плитка листа — столько метров земли: травинки газона читаются с высоты
   глаз, повтор вдали тонет в дымке. */
const TILE_METRES = 2.4;
const FIELD_METRES = 600;
const HAZE = "#6f7c88";

export function createGrassField(canvas) {
  const profile = qualityProfile();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: profile.antialias, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  skipShaderChecks(renderer);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(profilePixelRatio(profile));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HAZE, 18, 150);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 800);
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 0.6, -12);
  scene.add(new THREE.HemisphereLight("#d8e4f0", "#4a4436", 1.1));
  const sun = new THREE.DirectionalLight("#fff4e0", 1.4);
  sun.position.set(-30, 60, -40);
  scene.add(sun);

  const material = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_METRES, FIELD_METRES), material);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  let texture = null;

  /* Один материал на всю сцену: программа уходит параллельному компилятору, кадр
     рисуется по его ответу. Пока не готово, прежний холст остаётся. */
  let disposed = false;
  const warmup = createSceneWarmup({
    renderer,
    scene,
    camera,
    alive: () => !disposed,
    onReady: () => renderer.render(scene, camera),
  });
  const render = () => {
    if (warmup.ready) renderer.render(scene, camera);
  };
  warmup.warm();

  return {
    /** Лист в облике работы (холст плитки) — на поле. */
    setTile(tile) {
      if (!tile) return;
      if (texture?.image !== tile) {
        texture?.dispose();
        texture = new THREE.CanvasTexture(tile);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(FIELD_METRES / TILE_METRES, FIELD_METRES / TILE_METRES);
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        material.map = texture;
        material.needsUpdate = true;
        /* Материал с листом — другая программа, чем голый: собираем её заранее. */
        warmup.warm();
      } else texture.needsUpdate = true;
      render();
    },
    resize(width, height) {
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    },
    dispose() {
      disposed = true;
      warmup.stop();
      texture?.dispose();
      material.dispose();
      ground.geometry.dispose();
      renderer.dispose();
      /* Контекст отпускаем, когда холст уже ушёл со страницы: в StrictMode тот же холст монтируется дважды. */
      if (!renderer.domElement?.isConnected) renderer.forceContextLoss?.();
    },
  };
}
