/*
 * Светлый ствол в кадре каталога (11.11.2026, владелец: «белый предмет под светом в игре имеет форму, а не плоский белый силуэт»).
 *
 * Белое альбедо 1,0 под ключевым светом студии (+ рассеянный свет окружения и свечение 0,4) даёт на экране больше единицы: тонмаппинг сжимает всё это к 255, и грани,
 * которые должны различаться, сливаются (FlowerTouch: средняя светлота силуэта 246…248, p5…p95 = 232…255). Чинить надо свет кадра, а не картинку после съёмки
 * (ни контура, ни искусственной тени): кадр снимается, измеряется, и если силуэт в среднем слишком светлый, свет сдерживается — ниже экспозиция, слабее свечение
 * и рассеянный свет, чуть сильнее ключ, — после чего кадр снимается заново.
 *
 * Тёмная и цветная модель не затрагивается: сдерживание начинается со средней светлоты силуэта `BRIGHT_MEAN.from` и до неё равно нулю — кадр остаётся тем же байт в байт.
 */

/** Берётся силуэт: пиксели непрозрачнее этого. */
const OPAQUE_ALPHA = 200;
/** Ширина, до которой кадр сжимается для измерения. */
const MEASURE_WIDTH = 320;

/** Каким должен быть светлый кадр: верх силуэта не в потолке, и форма видна. */
export const LIGHT_LIMITS = Object.freeze({ p95: 248, spread: 35 });

/** Средняя светлота силуэта (0…255): с `from` сдерживание начинается, с `full` — полное. */
export const BRIGHT_MEAN = Object.freeze({ from: 215, full: 240 });

/** Свет, каким кадр снимается без сдерживания. */
export const NEUTRAL_LOOK = Object.freeze({ exposure: 1, key: 1, fill: 1, rim: 1, ambient: 1, environment: 1, emissive: 1 });

/** Свет полного сдерживания (замер 12.11.2026 на видеокарте, `scripts/gunpack-light-sweep-electron.js`: 8 белых стволов — p95 243…248, разброс p5…p95 81…166 против 232…255 и 16…104 без сдерживания). */
export const RESTRAINED_LOOK = Object.freeze({ exposure: 0.7, key: 1.2, fill: 0.6, rim: 1, ambient: 0.6, environment: 0.6, emissive: 0.5 });

/** Шаг усиления сдерживания между повторными кадрами и их предел (первый кадр не в счёт). */
const LEVEL_STEP = 0.3;
const RETAKES = 4;

const lerp = (from, to, amount) => from + (to - from) * amount;

/** Свет между нейтральным (0) и полным сдерживанием (1). */
export function restrainedLook(level) {
  const amount = Math.min(1, Math.max(0, Number(level) || 0));
  return Object.fromEntries(Object.keys(NEUTRAL_LOOK).map((name) => [name, lerp(NEUTRAL_LOOK[name], RESTRAINED_LOOK[name], amount)]));
}

/** Яркость внутри силуэта по сырым RGBA: среднее, p5, p50, p95 (0…255, как на экране), число точек; `null`, если силуэта нет. */
export function frameLight(rgba, width, height) {
  const values = [];
  const total = Math.min(rgba.length, width * height * 4);
  for (let at = 0; at < total; at += 4) {
    if (rgba[at + 3] <= OPAQUE_ALPHA) continue;
    values.push(0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]);
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const pick = (share) => values[Math.min(values.length - 1, Math.floor(values.length * share))];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { mean, p5: pick(0.05), p50: pick(0.5), p95: pick(0.95), count: values.length };
}

/** Насколько кадр нужно сдержать: 0 — не нужно (среднее ниже `from`), 1 — полностью. */
export function brightLevel(light) {
  if (!light) return 0;
  const share = (light.mean - BRIGHT_MEAN.from) / (BRIGHT_MEAN.full - BRIGHT_MEAN.from);
  return Math.min(1, Math.max(0, share));
}

/** Кадр светлого ствола годен: верх не в потолке и разброс p5…p95 достаточен для формы. */
export function lightIsFine(light) {
  return Boolean(light) && light.p95 <= LIGHT_LIMITS.p95 && light.p95 - light.p5 >= LIGHT_LIMITS.spread;
}

/** Измерение PNG-кадра в странице (декодер и холст окна). Не вышло — `null`: кадр остаётся как есть. */
export async function measureFrame(bytes) {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    try {
      const width = Math.min(MEASURE_WIDTH, bitmap.width);
      const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, width, height);
      return frameLight(context.getImageData(0, 0, width, height).data, width, height);
    } finally {
      if (typeof bitmap.close === "function") bitmap.close();
    }
  } catch {
    return null;
  }
}

/**
 * Первый кадр уже снят (`cut`). Силуэт в среднем светлее порога — свет сцены (`scene.setLook`) сдерживается и кадр снимается заново (`shoot`), пока верх
 * не уйдёт из потолка и форма не станет видна; предел — полное сдерживание. Возвращает итоговый кадр, его измерение и ход съёмки.
 */
export async function settleLight({ scene, cut, shoot, measure = measureFrame }) {
  const first = await measure(cut);
  const trace = [{ level: 0, light: first }];
  let level = brightLevel(first);
  if (level === 0) return { cut, light: first, level: 0, trace };
  let kept = { cut, light: first, level: 0 };
  for (let retake = 0; retake <= RETAKES; retake += 1) {
    scene.setLook(restrainedLook(level));
    const frame = shoot();
    const light = await measure(frame);
    trace.push({ level, light });
    /* Повторный кадр вышел пустым (потерян контекст, программа ещё не собрана) — остаётся прежний, лучше светлый, чем никакой. */
    if (!light) break;
    kept = { cut: frame, light, level };
    if (lightIsFine(light) || level >= 1) break;
    level = Math.min(1, level + LEVEL_STEP);
  }
  return { ...kept, trace };
}
