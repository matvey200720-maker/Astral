/*
 * Мастерская ангара — цвета, часть А: свет ламп в кадре.
 *
 * Потолочные лампы в кадре — прожекторы вниз у 16 ламп нутра (из описи: потолочные прожекторы с силой не меньше 5). Кадру хватает прожекторов: ближние сводятся в общий огонь (`setPointLights`).
 * «Свой цвет» работы (`hangar-lights.js`) красит их огонь в цвет работы, сила кадра — штатная кадра × процент работы. Это приближение: сила, дальность и конус в кадре — константы кадра, а не числа игры,
 * поэтому панель говорит, что точная яркость — в игре. Свечение плафонов (штатный лист) кадр не красит — как и установщик.
 *
 * Крючок облика материала (общий у частей А, Б, В): `(project, info, look) → look` — у света ламп облик материала не меняется, крючок отдаёт его как есть.
 */

import { HANGAR_LIGHTS } from "@modovik/climb-contract/recolor/hangar";
import { hangarLightLook } from "@modovik/climb-contract/recolor/hangar-lights";

/* Штатные огни кадра: сила 120, дальность 30, конус 80 — прежние числа кадра. */
const STOCK_LAMP_LIGHTS = Object.freeze(
  HANGAR_LIGHTS.filter((light) => light.kind === "ceiling" && light.type === "spot" && light.intensity >= 5).map((light) =>
    Object.freeze({ position: light.position, colour: light.colour, intensity: 120, distance: 30, cone: 80 }),
  ),
);

const painted = new Map();
const PAINTED_LIMIT = 24;

/** Огни кадра для света ламп работы: штатные или цвета и силы работы (список один на цвет и силу — кадр не пересобирает огни без причины). */
export function hangarLampLights(lights) {
  const look = hangarLightLook(lights);
  if (!look) return STOCK_LAMP_LIGHTS;
  const key = `${look.colour}|${look.factor}`;
  if (!painted.has(key)) {
    if (painted.size >= PAINTED_LIMIT) painted.delete(painted.keys().next().value);
    painted.set(
      key,
      Object.freeze(STOCK_LAMP_LIGHTS.map((light) => Object.freeze({ ...light, colour: look.colour, intensity: Math.round(light.intensity * look.factor * 100) / 100 }))),
    );
  }
  return painted.get(key);
}

export function hangarLightsFrameLook(project, info, look) {
  return look;
}
