/*
 * «Студия» у флагов (ТЗ 18.10.2026, Session 1, задача 6): холст — полотнище
 * в его пропорции 1,9 : 1 (1900 × 1000), основа — лист этого флага из игры
 * игрока (как он лежит сейчас), без листа игры — ровный тон. Итог встаёт
 * «своей картинкой» флага тем же путём, что и загруженный файл.
 */

import { FLAG_CLOTH_ASPECT, flagKind } from "@modovik/climb-contract/recolor/flags";
import { gameSheet } from "./flags-art.js";
import { ALL_FLAGS, targetLabel } from "./flags-text.js";
import { tr } from "../../../locales/ui.js";

export const FLAG_STUDIO_SIZE = Object.freeze({ width: 1900, height: Math.round(1900 / FLAG_CLOTH_ASPECT) });

/** Холст флага `target` (`ALL_FLAGS` — общий облик всех флагов). */
export function flagStudioSurface(target) {
  const kind = target === ALL_FLAGS ? null : flagKind(target);
  return {
    id: `flags:${target}`,
    slug: `flag-${target}`,
    title: `${tr("Флаги")} · ${targetLabel(target)}`,
    ...FLAG_STUDIO_SIZE,
    /* Лист флага из игры игрока; у «Всех флагов» общего листа нет. */
    base: kind
      ? async () => {
          const sheet = await gameSheet(kind);
          return sheet ? createImageBitmap(new ImageData(sheet.rgba, sheet.width, sheet.height)) : null;
        }
      : null,
    baseColour: "#3b4a63",
    placeLabel: "Поставить на флаг",
  };
}
