/*
 * Готовые столбы — полка «Столбы» в «Шаблонах».
 *
 * Вид столба — законченный образ: краска, блеск, прозрачность и украшение,
 * а там, где это часть образа, — и свет лампы с частицами («Новогодний» —
 * тёплый свет и снег, «Неоновый» — лиловые лампы и луч). Вид без своего
 * света свет работы не трогает: золото или чёрный мат ложатся на любые
 * фонари.
 *
 * Готовый вид — начало: дальше «Столб», «Украшения» и любой другой
 * инструмент правят его.
 */

import { LIGHT_SWATCHES, normalizeHex } from "./palette.js";
import { createPoleSection, normalizePoleSection } from "./pole.js";
import { normalizeLampProject } from "./project.js";
import { nativeMotion, particleTemplate } from "./particles.js";

const light = (id) => LIGHT_SWATCHES.find((item) => item.id === id)?.hex || null;

function definePolePreset(id, label, description, { pole, light: lightPatch = null, beam = null, particles = null }) {
  const section = normalizePoleSection({ ...createPoleSection(), ...pole, decor: { ...createPoleSection().decor, ...(pole.decor || {}) } });
  return Object.freeze({
    id,
    label,
    description,
    pole: section,
    light: lightPatch,
    beam,
    particles,
  });
}

export const POLE_PRESETS = Object.freeze([
  definePolePreset("pole-stock", "Как в игре", "Столбы Rockstar без краски и украшений", { pole: {} }),
  definePolePreset("pole-newyear", "Новогодний", "Белые столбы, разноцветная гирлянда, тёплый свет и снег", {
    pole: {
      colour: "#E9EAEC",
      metal: 120,
      decor: { on: true, kind: "garland", colour: "#FF3B3B", accent: "#3BFF6B", rainbow: true, glow: 260, size: 110, turns: 7 },
    },
    light: { colour: light("warm"), intensity: 110 },
    particles: { on: true, template: "snow", density: 120, night: false },
  }),
  definePolePreset("pole-candy", "Леденец", "Красно-белая лента по белому столбу", {
    pole: {
      colour: "#F2F2F2",
      metal: 80,
      decor: { on: true, kind: "ribbon", colour: "#D3202C", accent: "#2E9E4F", glow: 0, size: 120, turns: 8 },
    },
  }),
  definePolePreset("pole-neon", "Неоновый", "Чёрные столбы и светящиеся кольца, лиловый свет", {
    pole: {
      colour: "#121317",
      metal: 170,
      decor: { on: true, kind: "rings", colour: "#FF2BD6", accent: "#2EE6FF", glow: 360, size: 100, turns: 7 },
    },
    light: { colour: light("violet"), intensity: 120 },
    beam: { on: true, density: 55, width: 105 },
  }),
  definePolePreset("pole-gold", "Золото", "Золотые столбы с коваными завитками", {
    pole: {
      colour: "#D4A33A",
      shade: 110,
      metal: 260,
      decor: { on: true, kind: "curls", colour: "#E8B84A", accent: "#FFF4D6", glow: 0, size: 110, turns: 5 },
    },
    light: { colour: light("warm") },
  }),
  definePolePreset("pole-matte", "Чёрный матовый", "Строгие чёрные столбы без блеска", {
    pole: { colour: "#16171A", metal: 10 },
  }),
  definePolePreset("pole-glass", "Стеклянный", "Полупрозрачные столбы с голубой спиралью", {
    pole: {
      colour: "#BFE6FF",
      metal: 240,
      opacity: 35,
      decor: { on: true, kind: "spiral", colour: "#2EE6FF", accent: "#FFFFFF", glow: 300, size: 80, turns: 5 },
    },
    light: { colour: light("cyan") },
  }),
  definePolePreset("pole-retro", "Ретро", "Зелёный чугун, латунные завитки, янтарный свет", {
    pole: {
      colour: "#2F4A3B",
      shade: 95,
      metal: 60,
      decor: { on: true, kind: "curls", colour: "#B8913E", accent: "#FFE7A8", glow: 0, size: 100, turns: 6 },
    },
    light: { colour: light("amber") },
  }),
  definePolePreset("pole-vine", "Цветущая лоза", "Бронзовые столбы в зелёной лозе с розовыми бутонами", {
    pole: {
      colour: "#8C6239",
      metal: 90,
      decor: { on: true, kind: "vine", colour: "#3E9B4A", accent: "#FF7AB0", glow: 120, size: 110, turns: 5 },
    },
    particles: { on: true, template: "sakura", density: 100, night: false },
  }),
  definePolePreset("pole-starry", "Звёздная ночь", "Тёмно-синие столбы и золотые звёзды, лунный свет", {
    pole: {
      colour: "#1F3260",
      metal: 150,
      decor: { on: true, kind: "stars", colour: "#FFD24A", accent: "#FFF4D6", glow: 300, size: 110, turns: 5 },
    },
    light: { colour: light("moon") },
  }),
  definePolePreset("pole-cyber", "Киберпанк", "Тёмные столбы, бирюзовая спираль, розовый свет", {
    pole: {
      colour: "#1A1A20",
      metal: 200,
      decor: { on: true, kind: "spiral", colour: "#00F0FF", accent: "#FF2BD6", glow: 400, size: 70, turns: 11 },
    },
    light: { colour: light("pink"), intensity: 115 },
    beam: { on: true, density: 45, width: 100 },
  }),
  definePolePreset("pole-copper", "Медь", "Медные столбы с медными обручами", {
    pole: {
      colour: "#B8693F",
      metal: 240,
      decor: { on: true, kind: "rings", colour: "#C77A4A", accent: "#E8A577", glow: 0, size: 120, turns: 5 },
    },
  }),
  definePolePreset("pole-ghost", "Призрак", "Почти невидимые столбы — фонари висят в воздухе", {
    pole: { colour: "#DCE6F0", metal: 150, opacity: 12 },
    light: { colour: light("cold") },
  }),
]);

export function polePreset(id) {
  return POLE_PRESETS.find((item) => item.id === id) || null;
}

/**
 * Готовый столб поверх работы: раздел `pole` — от вида целиком; свет, луч и
 * частицы — только те, что вид задаёт сам.
 */
export function applyPolePreset(project, presetId) {
  const current = normalizeLampProject(project);
  const found = polePreset(presetId);
  if (!found) return current;
  const next = { ...current, pole: found.pole };
  if (found.light) next.light = { ...current.light, ...found.light, colour: normalizeHex(found.light.colour) || current.light.colour };
  if (found.beam) next.beam = { ...current.beam, ...found.beam };
  if (found.particles)
    next.particles = {
      ...current.particles,
      motion: nativeMotion(particleTemplate(found.particles.template || current.particles.template)),
      ...found.particles,
      colour: null,
    };
  return normalizeLampProject(next);
}

/** Готовый столб, с которым совпадает раздел `pole` работы, — для отметки плитки. */
export function matchingPolePreset(project) {
  const current = normalizeLampProject(project);
  const same = JSON.stringify(current.pole);
  return POLE_PRESETS.find((preset) => JSON.stringify(preset.pole) === same)?.id || null;
}
