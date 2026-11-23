/*
 * Летающее лого над центром города (ТЗ 08.10.2026, задача 4).
 *
 * Мод `mapping_egorika.rpf` вешает над кварталом dt1_05, в 270 м к северу от
 * площади Легиона, буквы E, G, O, R: одна сущность `anim_letters` в
 * (189,10; −664,96; 49,24) с масштабом 56,3 (буквы ≈ 14 × 12 м), модель со
 * скелетом на четыре буквы, шейдер `normal_spec_emissive` (свечение 3,33),
 * клип на 5 с (буквы пульсируют и покачиваются) через `clipDictionary` и
 * флаги анимированного архетипа 0x80200. Ещё он подменяет штатные модели
 * площади — их Astral не возит.
 *
 * Работа человека: своё лого вместо букв — картинка или надпись (общая
 * система надписей: шрифт, свой шрифт, цвет, обводка), размер, высота над
 * землёй, движение (вращение, покачивание, левитация) и его скорость, цвет
 * (как на картинке или общим цветовым эффектом), свечение, прозрачность и
 * с какого расстояния видно. «Стандарт» — лого нет (установка снимается).
 *
 * Модель — объёмная фигура по контуру картинки (общий построитель звезды
 * арены `arenaStarModel`, без подставки): лицо и спинка с картинкой, бока
 * по контуру. Движение — клип кости фигуры (`compile-star-model`): поворот
 * вокруг вертикали и подъём. Одна сущность высокой детализации с большой
 * дальностью и без дальних копий — вблизи и вдали лого одно и то же.
 */

import { arenaStarModel } from "./arena-star.js";
import { hexBytes } from "./colour.js";
import { colourEffectAt, lookOf, normalizeColourEffect } from "./colour-effects.js";
import { normalizeEmblemText } from "./emblems.js";

export const FLOAT_LOGO_SCHEMA = 1;
export const FLOAT_LOGO_SLOT = "float-logo";
const NAME_LIMIT = 60;

/* Место мода: над кварталом dt1_05 — площадь у здания FIB. Пол площади —
   41,4 м над уровнем моря (замер по модели площади `dt1_05_ground` игры,
   11.10.2026; прежде землю принимали за 30,6 м на глаз — лого по умолчанию
   висело внутри статуи). Посреди площади — фонтан со статуей орла на
   глобусе: голова и тело — до 11 м над полом, кончики крыльев — до 13,9 м.
   Мод букв подменял модели площади, Astral их не трогает, и лого висит над
   статуей. Высота лого — над полом площади. */
export const FLOAT_LOGO_PLACE = Object.freeze({ x: 189.1, y: -664.96, ground: 41.4 });
/* Статуя под лого: верх крыльев орла над полом площади и размах по кругу, м. */
export const FLOAT_LOGO_STATUE = Object.freeze({ top: 13.9, radius: 9.6 });
export const FLOAT_LOGO_MOD = Object.freeze({ size: 12, height: 13, glow: 3.33 });

export const FLOAT_LOGO_LIMITS = Object.freeze({
  size: Object.freeze([2, 60]),
  height: Object.freeze([2, 150]),
  speed: Object.freeze([0.2, 4]),
  glow: Object.freeze([0, 16]),
  opacity: Object.freeze([5, 100]),
  drawDistance: Object.freeze([200, 5000]),
  depth: Object.freeze([2, 200]),
});

export const FLOAT_LOGO_MODES = Object.freeze(["none", "image", "text"]);
export const FLOAT_LOGO_MOTIONS = Object.freeze(["spin", "sway", "levitate", "none"]);
export const FLOAT_LOGO_MOTION_LABELS = Object.freeze({
  spin: "Вращение",
  sway: "Покачивание",
  levitate: "Левитация",
  none: "Без движения",
});

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
function clamp(value, [low, high], fallback, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, number)) * factor) / factor;
}

function normalizeImage(input) {
  const source = plain(input);
  const asset = String(source.asset || "");
  if (!/^hangar-emblem:[a-f0-9]{64}$/.test(asset)) return null;
  return {
    asset,
    name: String(source.name || "").slice(0, 120),
    width: clamp(source.width, [1, 16384], 512),
    height: clamp(source.height, [1, 16384], 512),
  };
}

export function createFloatLogoProject() {
  return normalizeFloatLogoProject({});
}

export function normalizeFloatLogoProject(input) {
  const source = plain(input);
  const image = normalizeImage(source.image);
  const text = normalizeEmblemText({ value: "ASTRAL", font: "wide", colour: "#ffffff", ...plain(source.text) });
  let mode = FLOAT_LOGO_MODES.includes(source.mode) ? source.mode : "none";
  if (mode === "image" && !image) mode = "none";
  if (mode === "text" && !text.value.trim()) mode = "none";
  return {
    schema: FLOAT_LOGO_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    mode,
    image,
    text,
    size: clamp(source.size, FLOAT_LOGO_LIMITS.size, FLOAT_LOGO_MOD.size, 1),
    height: clamp(source.height, FLOAT_LOGO_LIMITS.height, FLOAT_LOGO_MOD.height, 1),
    depth: clamp(source.depth, FLOAT_LOGO_LIMITS.depth, 30),
    motion: FLOAT_LOGO_MOTIONS.includes(source.motion) ? source.motion : "spin",
    speed: clamp(source.speed, FLOAT_LOGO_LIMITS.speed, 1, 2),
    /* Цвет: как на картинке (\`ownColour: false\`) или общий эффект поверх. */
    ownColour: source.ownColour === true,
    look: normalizeColourEffect(lookOf(source), { mode: "solid", colour: "#00e0ff", colour2: "#ff3df2", direction: "across" }),
    glow: clamp(source.glow, FLOAT_LOGO_LIMITS.glow, FLOAT_LOGO_MOD.glow, 2),
    opacity: clamp(source.opacity, FLOAT_LOGO_LIMITS.opacity, 100),
    drawDistance: clamp(source.drawDistance, FLOAT_LOGO_LIMITS.drawDistance, 3000),
  };
}

export const serializeFloatLogoProject = (project) => JSON.stringify(normalizeFloatLogoProject(project));

export function parseFloatLogoProject(text) {
  try {
    return normalizeFloatLogoProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createFloatLogoProject();
  }
}

/** Лого нет — «Стандарт»: ставить нечего, установка снимается. */
export const floatLogoIsStock = (input) => normalizeFloatLogoProject(input).mode === "none";

export function floatLogoSignature(input) {
  const project = normalizeFloatLogoProject(input);
  const { name: _name, schema: _schema, ...rest } = project;
  return JSON.stringify({ ...rest, image: project.mode === "image" ? project.image : null, text: project.mode === "text" ? project.text : null });
}

/** «Стандарт»: лого убирается, остальное — как было. */
export const applyFloatLogoStandard = (input) => normalizeFloatLogoProject({ ...normalizeFloatLogoProject(input), mode: "none" });
export const resetFloatLogoProject = () => createFloatLogoProject();
/** Своя картинка в код не едет; надпись — едет (она — слова и шрифт). */
export function shareableFloatLogoProject(input) {
  const project = normalizeFloatLogoProject(input);
  return project.mode === "image" ? normalizeFloatLogoProject({ ...project, mode: "none", image: null }) : project;
}
export const floatLogoLostInCode = (input) => normalizeFloatLogoProject(input).mode === "image";

/* ------------------------------------------------------------------ *
 * Движение
 * ------------------------------------------------------------------ */

/* Секунд на цикл при скорости 1. */
const PERIOD = Object.freeze({ spin: 8, sway: 4, levitate: 5 });
const FPS = 30;
const MAX_FRAMES = 480;
/* Покачивание — поворот туда-обратно на ±28° (у мода ≈ 35°) и лёгкий
   подъём; левитация — плавный подъём и спуск на 1,5 м. */
const SWAY = (28 / 180) * Math.PI;

/**
 * Движение лого: `{ kind, period, frames, at(t) → { lift, angle } }` —
 * `lift` — подъём, м (0…10), `angle` — поворот вокруг вертикали, рад.
 */
export function floatLogoMotion(input) {
  const project = normalizeFloatLogoProject(input);
  const kind = project.motion;
  if (kind === "none") return { kind, period: 0, frames: 0, at: () => ({ lift: 0, angle: 0 }) };
  const period = PERIOD[kind] / project.speed;
  const frames = Math.min(MAX_FRAMES, Math.max(2, Math.round(period * FPS))) + 1;
  const at = (time) => {
    const share = (((time / period) % 1) + 1) % 1;
    if (kind === "spin") return { lift: 0, angle: share * Math.PI * 2 };
    if (kind === "sway") return { lift: 0.4 * (1 + Math.sin(share * Math.PI * 4)), angle: SWAY * Math.sin(share * Math.PI * 2) };
    return { lift: 0.75 * (1 + Math.sin(share * Math.PI * 2)), angle: 0 };
  };
  return { kind, period, frames, at };
}

/** Кадры клипа на цикл (последний — снова начало: клип по кругу без стыка). */
export function floatLogoFrames(motion) {
  if (!motion.period) return null;
  const lift = [];
  const angle = [];
  for (let frame = 0; frame < motion.frames; frame += 1) {
    const sample = motion.at((frame / (motion.frames - 1)) * motion.period);
    lift.push(Math.round(sample.lift * 10000) / 10000);
    angle.push(Math.round(sample.angle * 100000) / 100000);
  }
  if (motion.kind === "spin") angle[angle.length - 1] = Math.round(Math.PI * 2 * 100000) / 100000;
  else {
    lift[lift.length - 1] = lift[0];
    angle[angle.length - 1] = angle[0];
  }
  return { duration: Math.round(motion.period * 10000) / 10000, lift, angle };
}

/* ------------------------------------------------------------------ *
 * Картинка лого
 * ------------------------------------------------------------------ */

/**
 * Пиксели лого в облике работы: свой цвет — эффект по ширине (или высоте)
 * картинки поверх, яркость картинки сохраняется как светлота; прозрачность
 * — альфой. `rgba` — исходная картинка (или нарисованная надпись).
 */
export function floatLogoPixels(rgba, width, height, input) {
  const project = normalizeFloatLogoProject(input);
  const out = new Uint8ClampedArray(rgba);
  const opacity = project.opacity / 100;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (project.ownColour) {
        const t = project.look.direction === "height" ? y / Math.max(1, height - 1) : x / Math.max(1, width - 1);
        const [r, g, b] = colourEffectAt(project.look, project.look.mode === "line" ? (x / Math.max(1, width - 1)) * 6 % 1 : t);
        /* Светлота картинки — множителем: тёмные штрихи остаются тёмными. */
        const light = Math.max(out[at], out[at + 1], out[at + 2]) / 255;
        const keep = 0.35 + 0.65 * light;
        out[at] = r * keep;
        out[at + 1] = g * keep;
        out[at + 2] = b * keep;
      }
      out[at + 3] = Math.round(out[at + 3] * opacity);
    }
  return out;
}

/** Средний цвет лого для подписи и обложки. */
export function floatLogoSwatch(input) {
  const project = normalizeFloatLogoProject(input);
  if (project.ownColour) return colourEffectAt(project.look, 0.5);
  return project.mode === "text" ? hexBytes(project.text.colour) : [255, 255, 255];
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

export const FLOAT_LOGO_PRESETS = Object.freeze([
  Object.freeze({ id: "mod", label: "Как у мода", description: "12 м над землёй на 13 м, свечение 3,3, покачивание.", values: { size: 12, height: 13, motion: "sway", speed: 1, glow: 3.33, opacity: 100, ownColour: false } }),
  Object.freeze({ id: "spin", label: "Вращение", description: "Медленно крутится вокруг оси.", values: { motion: "spin", speed: 0.6, glow: 4 } }),
  Object.freeze({ id: "levitate", label: "Левитация", description: "Плавно поднимается и опускается.", values: { motion: "levitate", speed: 0.8, glow: 3 } }),
  Object.freeze({ id: "giant", label: "Огромное", description: "40 м, высоко — видно через весь город.", values: { size: 40, height: 60, drawDistance: 5000, glow: 6, motion: "spin", speed: 0.4 } }),
  Object.freeze({ id: "neon", label: "Неон", description: "Бирюзово-розовый градиент и яркое свечение.", values: { ownColour: true, look: { mode: "gradient", colour: "#00e0ff", colour2: "#ff3df2", direction: "across" }, glow: 8 } }),
  Object.freeze({ id: "rainbow", label: "Радуга", description: "Радуга по лого, вращение.", values: { ownColour: true, look: { mode: "rainbow", direction: "across" }, glow: 5, motion: "spin" } }),
  Object.freeze({ id: "ghost", label: "Призрак", description: "Полупрозрачное, мягкое свечение.", values: { opacity: 45, glow: 2, motion: "levitate" } }),
]);

export function applyFloatLogoPreset(input, presetId) {
  const project = normalizeFloatLogoProject(input);
  const preset = FLOAT_LOGO_PRESETS.find((item) => item.id === presetId);
  return preset ? normalizeFloatLogoProject({ ...project, ...preset.values }) : project;
}

export function matchingFloatLogoPreset(input) {
  const project = normalizeFloatLogoProject(input);
  return (
    FLOAT_LOGO_PRESETS.find((preset) => {
      const applied = applyFloatLogoPreset(project, preset.id);
      return floatLogoSignature(applied) === floatLogoSignature(project);
    })?.id || null
  );
}

/* ------------------------------------------------------------------ *
 * Модель
 * ------------------------------------------------------------------ */

/**
 * Объёмное лого по контуру картинки (`arenaStarModel` без подставки):
 * `size` — длинная сторона лого, м (у широкой надписи — ширина, у высокой
 * картинки — высота), толщина — `depth` см. Лицо — в −Y, верх — Z, середина
 * лого — в начале координат (у хоста координаты модели — до ±40 м: лого в
 * 60 м стоя от нуля не влезло бы), ось — вертикаль через середину.
 * `null` — в картинке нет фигуры.
 */
export function floatLogoMesh(rgba, width, height, input) {
  const project = normalizeFloatLogoProject(input);
  const built = arenaStarModel(rgba, width, height, { size: project.size, depth: project.depth, stand: "none" });
  if (!built) return null;
  const mesh = built.mesh;
  const [minX, , minZ] = mesh.bounds.min;
  const [maxX, , maxZ] = mesh.bounds.max;
  const scale = project.size / Math.max(1e-3, maxX - minX, maxZ - minZ);
  const half = ((maxZ - minZ) * scale) / 2;
  const positions = new Float32Array(mesh.positions.length);
  for (let at = 0; at < positions.length; at += 3) {
    positions[at] = mesh.positions[at] * scale;
    positions[at + 1] = mesh.positions[at + 1];
    positions[at + 2] = (mesh.positions[at + 2] - minZ) * scale - half;
  }
  const bounds = {
    min: [minX * scale, mesh.bounds.min[1], -half],
    max: [maxX * scale, mesh.bounds.max[1], half],
  };
  return { ...mesh, positions, bounds, half };
}
