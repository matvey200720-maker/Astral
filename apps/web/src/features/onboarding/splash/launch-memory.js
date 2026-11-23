/*
 * Заставка «Контур»: память запусков (18.11.2026). Свет идёт по лучу с темпом, который задаёт ожидаемая длительность этапа
 * (`contour-model.js`, `levelTarget`). Ожидание — сглаженные длительности четырёх лучей из прошлых запусков окна, в
 * `localStorage` под своим ключом; хранение и сглаживание — общие с карточкой загрузки сцены (`features/pace/pace-memory.js`).
 */

import { readPace, rememberPace } from "../../pace/pace-memory.js";
import { EXPECT_DEFAULT, EXPECT_MAX, EXPECT_MIN } from "./contour-model.js";

export const MEMORY_KEY = "astral-startup-pace";
const LIMITS = Object.freeze({
  defaults: EXPECT_DEFAULT,
  min: EXPECT_MIN,
  max: EXPECT_MAX,
});

/** Ожидаемые длительности четырёх лучей (мс): то, что запомнено, иначе по умолчанию; каждое значение в пределах `EXPECT_MIN…EXPECT_MAX`. */
export function readExpect(storage) {
  return readPace(MEMORY_KEY, LIMITS, storage);
}

/** Запомнить запуск: `durations` — результат `launchDurations`. Вернёт, записалось ли; мусор и незавершённый запуск не записываются. */
export function rememberLaunch(durations, storage) {
  return rememberPace(MEMORY_KEY, durations, LIMITS, storage);
}
