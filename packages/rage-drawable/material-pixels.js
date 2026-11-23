/*
 * Цвет материала модели ствола — «Стекло» и «Рентген» (задача 1 ТЗ
 * 06.10.2026) — без разбора файлов игры: им пользуются и запекание листа
 * детали (`ytd-bake.js`), и кадр мастерской — превью показывает тот же
 * рисунок, что встанет в игру. Шейдеры — `model-material.js`.
 */

/** Материалы модели: как в игре, стекло, рентген. */
export const MODEL_MATERIALS = Object.freeze(["standard", "glass", "xray"]);
/** Цвет материала по умолчанию: светлое голубое стекло и голубой рентген. */
export const MODEL_MATERIAL_TINT = Object.freeze({ glass: "#cfe8ff", xray: "#59d6ff" });
/** Сила свечения рентгена (`emissiveMultiplier`). */
export const MODEL_XRAY_GLOW = Object.freeze({ min: 0.5, max: 6, standard: 3 });

export const normalizeModelMaterial = (value) => (MODEL_MATERIALS.includes(value) ? value : "standard");

const HEX = /^#[0-9a-f]{6}$/i;
/** Цвет материала: `#rrggbb` или цвет материала по умолчанию. */
export const normalizeMaterialTint = (material, value) =>
  HEX.test(String(value || "")) ? String(value).toLowerCase() : MODEL_MATERIAL_TINT[material] || "#ffffff";

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const rgbOf = (hex) => [1, 3, 5].map((at) => parseInt(String(hex).slice(at, at + 2), 16));

/**
 * Пиксели текстуры цвета детали под материал (RGBA, на месте):
 *   • стекло — цвет стекла с лёгким рисунком детали (тени швов и надписей
 *     остаются), альфа — непрозрачность материала;
 *   • рентген — контуры деталей (перепады яркости, Собель) цветом рентгена
 *     поверх тёмного полупрозрачного тела, альфа — по контуру: края и
 *     надписи видны, плоскости просвечивают.
 * `opacity` — непрозрачность 0…1.
 */
export function materialPixels(rgba, width, height, { material, tint, opacity }) {
  const [tr, tg, tb] = rgbOf(normalizeMaterialTint(material, tint));
  const alpha = clamp01(Number(opacity));
  const count = width * height;
  const luma = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    luma[index] = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
  }
  if (material === "glass") {
    for (let index = 0; index < count; index += 1) {
      const at = index * 4;
      /* Рисунок детали — едва заметно: стекло, а не покраска. */
      const shade = 0.82 + 0.18 * luma[index];
      rgba[at] = Math.round(tr * shade);
      rgba[at + 1] = Math.round(tg * shade);
      rgba[at + 2] = Math.round(tb * shade);
      rgba[at + 3] = Math.round(alpha * 255);
    }
    return rgba;
  }
  if (material === "xray") {
    const at = (x, y) => luma[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
    /* Контур — перепад яркости шагом в 1/256 листа: на стволе в руках от
       третьего лица тонкая линия в пиксель пропадала. */
    const step = Math.max(1, Math.round(Math.max(width, height) / 256));
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const l = x - step;
        const r = x + step;
        const u = y - step;
        const d = y + step;
        const gx = -at(l, u) - 2 * at(l, y) - at(l, d) + at(r, u) + 2 * at(r, y) + at(r, d);
        const gy = -at(l, u) - 2 * at(x, u) - at(r, u) + at(l, d) + 2 * at(x, d) + at(r, d);
        const edge = clamp01(Math.hypot(gx, gy) * 3);
        const index = (y * width + x) * 4;
        /* Тело светится приглушённо и просвечивает, контур — ярко и плотно:
           ствол читается и в руках издалека, и вблизи от первого лица. */
        const glow = 0.45 + 0.55 * edge;
        rgba[index] = Math.round(tr * glow);
        rgba[index + 1] = Math.round(tg * glow);
        rgba[index + 2] = Math.round(tb * glow);
        rgba[index + 3] = Math.round(alpha * (0.55 + 0.45 * edge) * 255);
      }
    return rgba;
  }
  return rgba;
}
