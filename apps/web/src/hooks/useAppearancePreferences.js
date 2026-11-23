import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_APPEARANCE_SCENE,
  resolveAppearanceState,
} from "../appearance-scenes.js";
import {
  applyMotionChoice,
  MOTION_STORAGE_KEY,
  readMotionChoice,
  useMotionEnabled,
} from "../motion-preference.js";
import {
  geometryEdgeChannels,
  gradientPaletteFromHex,
  gradientPresetColors,
  gradientPresetEndColors,
  hexToRgbChannels,
} from "../utils/appearanceColors.js";

/*
 * Палитра сцены — нейтральный свет. Цвет её больше не выбирают: подсветку
 * читали только убранные фоны (`appearance-scenes.js`), а переменные
 * `--scene-*` держат правила, общие для оболочки.
 */
const SCENE_PALETTE = Object.freeze({
  a: hexToRgbChannels(gradientPresetColors.neutral),
  b: hexToRgbChannels(gradientPresetEndColors.neutral),
  c: gradientPaletteFromHex(gradientPresetEndColors.neutral).c,
  edge: geometryEdgeChannels(
    gradientPresetColors.neutral,
    gradientPresetEndColors.neutral,
  ),
});

/* Ключи убранных выборов: палитры сетки и звёздного поля, линий сетки; «Живой космос», декор матовой сцены и
   «Космические герои» (23.10.2026) — у людей, выбиравших их, остаётся чистая матовая поверхность.
   Тему и стекло стирает загрузочный скрипт — до первого кадра. */
const RETIRED_KEYS = [
  "modovik-gradient",
  "modovik-gradient-enabled",
  "modovik-gradient-strength",
  "modovik-gradient-strength-left",
  "modovik-gradient-strength-right",
  "modovik-grid-color",
  "modovik-grid-color-end",
  "modovik-grid-lines-v2",
  "modovik-ambient",
  "modovik-appearance-defaults-version",
  "modovik-matte-decoration",
  "modovik-matte-cubes",
  "modovik-matte-character",
];

export function useAppearancePreferences() {
  /* Выбор человека («как в системе» / включено / выключено) и то, чем этот
     выбор сейчас разрешился. Второе читается из атрибута на <html>, а не
     считается здесь: тот же атрибут ставит загрузочный скрипт до первого
     кадра, и два независимых вычисления разъехались бы на первом же рендере. */
  const [motionChoice, setMotionChoice] = useState(readMotionChoice);
  const motionEnabled = useMotionEnabled();

  useEffect(() => {
    for (const key of RETIRED_KEYS) localStorage.removeItem(key);
  }, []);
  useEffect(() => {
    localStorage.setItem(MOTION_STORAGE_KEY, motionChoice);
    return applyMotionChoice(motionChoice);
  }, [motionChoice]);

  const appearanceState = useMemo(
    () => resolveAppearanceState({ scene: DEFAULT_APPEARANCE_SCENE }),
    [],
  );

  return {
    motionChoice,
    setMotionChoice,
    motionEnabled,
    scenePalette: SCENE_PALETTE,
    appearanceState,
  };
}
