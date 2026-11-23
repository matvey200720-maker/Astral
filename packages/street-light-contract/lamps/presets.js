/*
 * Готовые фонари — полка под кадром.
 *
 * Каждый вид — законченная ночь, а не один цвет: свет, его мягкость, луч,
 * блик и частицы подобраны вместе. Вид задаёт свет и частицы; какие группы
 * фонарей красить — выбор человека, и готовый вид его не трогает (так же
 * небо не трогает выключатели погоды).
 *
 * «Как в игре» здесь тоже вид: с бликами Rockstar — с него же начинается
 * свежая работа (задача 5 ТЗ 05.10.2026). Готовые виды собраны без бликов
 * (так их выбирал владелец 27.09), если вид сам не говорит иначе, а «Без
 * бликов» — отдельная плитка.
 */

import { LIGHT_RAINBOW, LIGHT_SWATCHES, normalizeHex } from "./palette.js";
import { createLampProject, normalizeLampProject, vanillaLampProject } from "./project.js";

const hex = (id) => LIGHT_SWATCHES.find((item) => item.id === id)?.hex || null;

function preset(id, label, description, build) {
  const project = createLampProject();
  /* Готовый вид — без бликов, если сам не включил их (облик видов прежний). */
  project.glare.on = false;
  /* Движение вида — родное для его частиц, если вид не заказал своё:
     сакура падает, светлячки парят. */
  delete project.particles.motion;
  build(project);
  return Object.freeze({ id, label, description, look: normalizeLampProject(project) });
}

export const LAMP_PRESETS = Object.freeze([
  Object.freeze({
    id: "vanilla",
    label: "Как в игре",
    description: "Натриевый свет и блики Rockstar",
    look: vanillaLampProject(),
  }),
  preset("no-glare", "Без бликов", "Свет игры, только фонари больше не слепят", () => {}),
  preset("sodium-evening", "Натриевый вечер", "Тёплый мягкий свет, лёгкий луч и мотыльки", (p) => {
    p.light = { ...p.light, colour: hex("sodium"), intensity: 110, range: 115, softness: 140 };
    p.beam = { on: true, density: 40, width: 110 };
    p.particles = { ...p.particles, on: true, template: "moths", density: 90 };
  }),
  preset("led-city", "Светодиодный город", "Белый LED, ровные яркие пятна", (p) => {
    p.light = { ...p.light, colour: hex("neutral"), intensity: 135, range: 115, softness: 90 };
  }),
  preset("butterflies", "Бабочки у фонарей", "Голубые морфо кружат у каждой лампы", (p) => {
    p.light = { ...p.light, colour: hex("warm"), intensity: 115, range: 110, softness: 120 };
    p.beam = { on: true, density: 45, width: 100 };
    p.particles = { ...p.particles, on: true, template: "morpho", size: 120, density: 120, night: false };
  }),
  preset("cold-moon", "Холодная луна", "Голубоватый свет и густые лучи", (p) => {
    p.light = { ...p.light, colour: hex("moon"), intensity: 95, range: 125, softness: 160 };
    p.beam = { on: true, density: 65, width: 120 };
    p.particles = { ...p.particles, on: true, template: "motes", colour: normalizeHex("#DDEBFF") };
  }),
  preset("neon-night", "Неоновая ночь", "Лиловые фонари и пёстрые бабочки", (p) => {
    p.light = { ...p.light, colour: hex("violet"), intensity: 125, range: 110, softness: 110 };
    p.beam = { on: true, density: 60, width: 105 };
    p.glare = { on: true, size: 80, strength: 55 };
    p.particles = { ...p.particles, on: true, template: "motley", density: 110 };
  }),
  preset("sakura", "Сакура", "Розовый свет и падающие лепестки", (p) => {
    p.light = { ...p.light, colour: hex("pink"), intensity: 105, range: 115, softness: 150 };
    p.beam = { on: true, density: 35, width: 115 };
    p.particles = { ...p.particles, on: true, template: "sakura", density: 130, night: false };
  }),
  preset("autumn", "Осенний бульвар", "Янтарные фонари и кружащие листья", (p) => {
    p.light = { ...p.light, colour: hex("amber"), intensity: 110, range: 120, softness: 150 };
    p.particles = { ...p.particles, on: true, template: "autumn", density: 120, night: false };
  }),
  preset("fireflies", "Светлячки", "Приглушённый тёплый свет и мерцание", (p) => {
    p.light = { ...p.light, colour: hex("warm"), intensity: 80, range: 95, softness: 170 };
    p.particles = { ...p.particles, on: true, template: "fireflies", density: 150 };
  }),
  preset("winter", "Зимняя сказка", "Холодный белый и снег у каждой лампы", (p) => {
    p.light = { ...p.light, colour: hex("cold"), intensity: 115, range: 120, softness: 130 };
    p.beam = { on: true, density: 50, width: 110 };
    p.particles = { ...p.particles, on: true, template: "snow", density: 140, night: false };
  }),
  preset("blizzard", "Метель у фонаря", "Снежинки кружат роем под холодной лампой", (p) => {
    p.light = { ...p.light, colour: hex("cold"), intensity: 110, range: 115, softness: 130 };
    p.particles = { ...p.particles, on: true, template: "snow", motion: "swarm", density: 160, speed: 130, night: false };
  }),
  preset("butterfly-fall", "Бабочкопад", "Монархи медленно осыпаются из-под ламп", (p) => {
    p.light = { ...p.light, colour: hex("warm"), intensity: 110, range: 115, softness: 140 };
    p.particles = { ...p.particles, on: true, template: "monarch", motion: "fall", density: 90, speed: 70, night: false };
  }),
  preset("noir", "Туманный нуар", "Тусклые фонари и плотные столбы света", (p) => {
    p.light = { ...p.light, colour: hex("neutral"), intensity: 85, range: 105, softness: 120 };
    p.beam = { on: true, density: 90, width: 140 };
  }),
  preset("blood-moon", "Кровавая луна", "Алый свет и алые бабочки", (p) => {
    p.light = { ...p.light, colour: hex("red"), intensity: 95, range: 110, softness: 140 };
    p.beam = { on: true, density: 55, width: 100 };
    p.particles = { ...p.particles, on: true, template: "scarlet" };
  }),
  preset("emerald", "Изумрудный город", "Зелёный неон и светлячки", (p) => {
    p.light = { ...p.light, colour: hex("emerald"), intensity: 110, range: 110, softness: 120 };
    p.beam = { on: true, density: 50, width: 100 };
    p.particles = { ...p.particles, on: true, template: "fireflies", colour: normalizeHex("#9DFF5C") };
  }),
  preset("rainbow", "Радужный город", "У каждого вида фонарей свой цвет спектра", (p) => {
    p.light = { ...p.light, colour: LIGHT_RAINBOW, intensity: 115, range: 110, softness: 110 };
    p.beam = { on: true, density: 40, width: 100 };
  }),
  preset("cyan-led", "Бирюзовый LED", "Бирюзовые фонари, как у модели 01b", (p) => {
    p.light = { ...p.light, colour: hex("cyan"), intensity: 120, range: 110, softness: 100 };
  }),
]);

export function lampPreset(id) {
  return LAMP_PRESETS.find((item) => item.id === id) || null;
}

/**
 * Готовый вид поверх работы: свет, луч, блик и частицы — от вида; группы
 * фонарей и имя — работы.
 */
export function applyLampPreset(project, presetId) {
  const current = normalizeLampProject(project);
  const found = lampPreset(presetId);
  if (!found) return current;
  const look = found.look;
  return normalizeLampProject({
    ...current,
    light: { ...look.light, groups: current.light.groups },
    beam: look.beam,
    glare: look.glare,
    particles: look.particles,
  });
}

/** Вид из полки, с которым совпадает работа, — чтобы плитка была отмечена. */
export function matchingLampPreset(project) {
  const current = normalizeLampProject(project);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return (
    LAMP_PRESETS.find(
      ({ look }) =>
        same({ ...look.light, groups: current.light.groups }, current.light) &&
        same(look.beam, current.beam) &&
        same(look.glare, current.glare) &&
        same(look.particles, current.particles),
    )?.id || null
  );
}
