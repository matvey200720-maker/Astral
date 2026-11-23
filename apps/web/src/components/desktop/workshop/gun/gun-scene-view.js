// Зона Z6, часть 2: вид камеры (азимут, подъём, масштаб) и пресеты света.
//
// Особенность, которая оставлена как есть: viewFrom и zoomBy двигают позицию камеры,
// но матрицу её мира не пересчитывают — это делает отрисовка кадра.

import { STAGE_LIGHTING } from "./lighting.js";
import * as THREE from "three";

// Смещение камеры от точки, на которую смотрит управление.
function cameraOffset({ camera, controls }) {
  return camera.position.clone().sub(controls.target);
}

// Управление пересчитывает вид, сцена просится в кадр.
function commitView(ctx) {
  ctx.controls.update();
  ctx.requestRender();
}

function viewFrom(ctx, azimuth, elevation) {
  const { camera, controls } = ctx;
  const { target } = controls;
  const distance = camera.position.distanceTo(target);
  // подъём не доходит до полюсов: больше 85 градусов в обе стороны камера не уходит
  const lift = THREE.MathUtils.degToRad(Math.min(85, Math.max(-85, Number(elevation))));
  const turn = THREE.MathUtils.degToRad(Number(azimuth));
  const flat = distance * Math.cos(lift);
  camera.position.set(
    target.x + flat * Math.sin(turn),
    target.y + distance * Math.sin(lift),
    target.z + flat * Math.cos(turn),
  );
  commitView(ctx);
}

function viewState(ctx) {
  const offset = cameraOffset(ctx);
  const distance = offset.length() || 1;
  const sine = Math.min(1, Math.max(-1, offset.y / distance));
  const zoom = ctx.fitDistance > 0 ? Math.round((ctx.fitDistance / distance) * 100) : 100;
  return {
    azimuth: THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z)),
    elevation: THREE.MathUtils.radToDeg(Math.asin(sine)),
    zoom,
  };
}

function zoomBy(ctx, factor) {
  const { minDistance, maxDistance, target } = ctx.controls;
  const offset = cameraOffset(ctx);
  const distance = offset.length();
  if (!distance || !(factor > 0)) return viewState(ctx).zoom;
  const next = Math.min(maxDistance, Math.max(minDistance, distance / factor));
  ctx.camera.position.copy(target).addScaledVector(offset.normalize(), next);
  commitView(ctx);
  return viewState(ctx).zoom;
}

function onViewChange(ctx, listener) {
  ctx.controls.addEventListener("change", listener);
  return () => ctx.controls.removeEventListener("change", listener);
}

// Имя вне таблицы даёт студию; имена из прототипа таблицей не отсеиваются.
function setLighting(ctx, mode) {
  const preset = STAGE_LIGHTING[mode] || STAGE_LIGHTING.studio;
  for (const slot of ["key", "fill", "rim"]) {
    const [colour, power] = preset[slot];
    ctx.lights[slot].color.set(colour);
    ctx.lights[slot].intensity = power;
  }
  ctx.lights.ambient.intensity = preset.ambient;
  ctx.scene.environmentIntensity = preset.environment;
  ctx.renderer.toneMappingExposure = preset.exposure;
  ctx.requestRender();
}

export const attachViewZone = (ctx) =>
  Object.assign(ctx.ops, {
    viewFrom: (azimuth, elevation) => viewFrom(ctx, azimuth, elevation),
    viewState: () => viewState(ctx),
    zoomBy: (factor) => zoomBy(ctx, factor),
    onViewChange: (listener) => onViewChange(ctx, listener),
    setLighting: (mode) => setLighting(ctx, mode),
  });
