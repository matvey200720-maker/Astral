/*
 * Блеск и чистота поверхностей «Интерьеров» (ТЗ 12.10.2026, задача 2).
 *
 * Владелец: «текстурки менять не нужно, это получается плохо… добавь,
 * чтобы плитка была более яркая, как будто бы зеркалила, идеально чистая».
 * У поверхности помещения теперь, кроме цвета, — блеск:
 *
 *   game   — как в игре (на кнопке — «Нет»: «Как в игре» в узкой
 *            панели обрезалось);
 *   clean  — чистая: пятна, грязь и потёртости листа сглажены, лист чуть
 *            светлее, рисунок (швы плитки, доски) остаётся;
 *   gloss  — глянец: чистая и с ярким резким бликом;
 *   mirror — зеркало: чистая, блик во всю силу — пол отражает зал.
 *
 * Чистота — правка пикселей листа (`cleanSheetPixels`): яркость листа
 * делится на её размытую копию (в 8 раз меньше листа: пятна — низкие
 * частоты, шов плитки — высокие) и умножается на
 * среднюю яркость листа. Та же арифметика у кадра — шейдером по мип-уровням
 * листа (`recolor-material.js`, `uRcClean`).
 *
 * Блеск — параметры шейдеров материалов с этим листом в моделях помещения
 * (`@modovik/ypt` → `shineDrawable`): сила, резкость и френель блика,
 * у шейдеров `*_reflect` — сила отражения. Игра отражает в блике окружение,
 * и пол с сильным резким бликом выглядит зеркальным. В кадре блеск — гладкость
 * материала (`roughness`) и отражение самого зала (`reflection` — его сила,
 * снимок окружения из глаза в помещении, `orbit-stage.js`).
 */

export const SHOP_SHINES = Object.freeze(
  [
    {
      id: "game",
      label: "Как в игре",
      short: "Нет",
      note: "Лист и блик — как у Rockstar",
      clean: 0,
      lift: 1,
      shader: null,
      roughness: null,
    },
    {
      id: "clean",
      label: "Чистая",
      short: "Чистый",
      note: "Без пятен и грязи, чуть светлее; блик как в игре",
      clean: 0.85,
      lift: 1.05,
      shader: null,
      roughness: null,
    },
    {
      id: "gloss",
      label: "Глянец",
      short: "Глянец",
      note: "Чистая и блестит: яркий резкий блик",
      clean: 0.9,
      lift: 1.08,
      shader: Object.freeze({ intensity: 0.75, falloff: 240, fresnel: 0.96, reflect: 0.35 }),
      roughness: 0.28,
      reflection: 0.9,
    },
    {
      id: "mirror",
      label: "Зеркало",
      short: "Зеркало",
      note: "Идеально чистая, блик во всю силу — отражает зал",
      clean: 1,
      lift: 1.1,
      shader: Object.freeze({ intensity: 1, falloff: 600, fresnel: 0.98, reflect: 0.7 }),
      roughness: 0.07,
      reflection: 1.6,
    },
  ].map((item) => Object.freeze(item)),
);
export const SHOP_SHINE_IDS = Object.freeze(SHOP_SHINES.map((item) => item.id));
export const shopShine = (id) => SHOP_SHINES.find((item) => item.id === id) || SHOP_SHINES[0];

/* Во сколько раз размытая копия меньше листа: клетка — плитка-другая, пятна крупнее шва. Кадр берёт тот же мип (log2 листа − 3). */
export const CLEAN_DOWNSCALE = 8;

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/*
 * Яркость листа, ужатого в `CLEAN_DOWNSCALE` раз (среднее по клетке), и
 * средняя яркость всего листа. Ужатая копия растягивается обратно
 * билинейно, с повтором по краям — лист игры повторяется по развёртке.
 */
function lowPass(rgba, width, height) {
  const cw = Math.max(1, Math.round(width / CLEAN_DOWNSCALE));
  const ch = Math.max(1, Math.round(height / CLEAN_DOWNSCALE));
  const cells = new Float64Array(cw * ch);
  const counts = new Float64Array(cw * ch);
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    const cy = Math.min(ch - 1, Math.floor((y * ch) / height));
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const value = luma(rgba[at], rgba[at + 1], rgba[at + 2]);
      const cell = cy * cw + Math.min(cw - 1, Math.floor((x * cw) / width));
      cells[cell] += value;
      counts[cell] += 1;
      total += value;
    }
  }
  for (let index = 0; index < cells.length; index += 1) cells[index] /= Math.max(1, counts[index]);
  const sample = (x, y) => {
    const fx = ((x + 0.5) * cw) / width - 0.5;
    const fy = ((y + 0.5) * ch) / height - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (cx, cy) => cells[(((cy % ch) + ch) % ch) * cw + (((cx % cw) + cw) % cw)];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
  return { sample, mean: total / Math.max(1, width * height) };
}

/**
 * Чистый лист: `rgba` (Uint8ClampedArray, ширина × высота × 4) — новые
 * пиксели, альфа как была. `amount` 0…1 — сколько пятен убрать, `lift` —
 * во сколько раз светлее.
 */
export function cleanSheetPixels(rgba, width, height, amount, lift = 1) {
  const out = new Uint8ClampedArray(rgba);
  if (!(amount > 0) && lift === 1) return out;
  const { sample, mean } = lowPass(rgba, width, height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const low = Math.max(2, sample(x, y));
      const k = (1 - amount + (amount * mean) / low) * lift;
      out[at] = rgba[at] * k;
      out[at + 1] = rgba[at + 1] * k;
      out[at + 2] = rgba[at + 2] * k;
    }
  return out;
}
