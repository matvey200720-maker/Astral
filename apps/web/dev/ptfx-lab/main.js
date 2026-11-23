/*
 * Стенд сцены попаданий: та же сцена, что в мастерской (`impact-scene.js`),
 * на базе игрока, которую запёк scripts/bake-impact-base.mjs. Настройки зон —
 * JSON редактора; время можно остановить, дальность — сменить. Для сверки с
 * кадрами игры и отладки шейдеров; в продуктовую сборку не входит.
 */

import { parseImpactZone, IMPACT_ZONES } from "@modovik/ptfx-studio";
import {
  createImpactScene,
  IMPACT_VIEW_DISTANCE,
} from "../../src/components/desktop/workshop/ptfx/impact-scene.js";

const CHARACTER = "/assets/workshop/fx-range/character-front.webp";
const FIGURE_METRES = 1.85;

const canvas = document.getElementById("canvas");
const stage = document.getElementById("stage");
const zonesInput = document.getElementById("zones");
const zoneSelect = document.getElementById("zone");
const distanceInput = document.getElementById("distance");
const timeInput = document.getElementById("time");
const info = document.getElementById("info");

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

const baked = await (await fetch("/__astral/qa/impact-base")).json();
const scene = createImpactScene({ canvas });
scene.setBase(baked?.base || null);
const character = await loadImage(CHARACTER);

function layout() {
  const box = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  scene.resize(width, height, Math.min(2, window.devicePixelRatio || 1));
  const figureHeight = height * 0.92;
  const figureWidth = figureHeight * (character.naturalWidth / character.naturalHeight);
  scene.setBackdrop({
    image: character,
    rect: { x: (width - figureWidth) / 2, y: height - figureHeight, width: figureWidth, height: figureHeight },
    metresTall: FIGURE_METRES,
    plate: [0.027, 0.027, 0.031],
  });
  scene.setDistance(Number(distanceInput.value));
}
layout();
new ResizeObserver(layout).observe(stage);

function applyZones() {
  let parsed = {};
  try {
    parsed = JSON.parse(zonesInput.value || "{}");
  } catch (error) {
    info.textContent = `JSON: ${error.message}`;
    return;
  }
  const zones = Object.fromEntries(IMPACT_ZONES.map((zone) => [zone.id, parseImpactZone(zone.id, parsed[zone.id])]));
  scene.setZones(zones, [zoneSelect.value]);
  info.textContent = [
    `клонов: ${[...(scene.model?.effects.keys() || [])].filter((name) => name.startsWith("astral_preview")).join(", ") || "нет"}`,
    ...scene.failures.map((line) => `ошибка: ${line}`),
  ].join("\n");
}

zonesInput.value = JSON.stringify(
  { head: { enabled: true, layers: [{ kind: "blood" }] }, body: { enabled: true, layers: [{ kind: "blood" }] } },
  null,
  1,
);
applyZones();
scene.start();

zonesInput.addEventListener("change", applyZones);
zoneSelect.addEventListener("change", applyZones);
distanceInput.addEventListener("input", () => scene.setDistance(Number(distanceInput.value)));
timeInput.addEventListener("input", () => {
  const fixed = Number(timeInput.value);
  scene.setPaused(fixed > 0);
  if (fixed > 0) scene.renderAt(fixed, 0);
});

window.__ptfxLab = { scene, baked, IMPACT_VIEW_DISTANCE, applyZones };
