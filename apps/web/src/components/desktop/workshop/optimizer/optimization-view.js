/*
 * Что карточка оптимизации говорит о себе: подпись состояния, его тон и метка FPS.
 *
 * Одна и та же у большой карточки («Библиотека», `OptimizationCard`) и у строки инструмента «Убрать лишнее» в студии
 * (строка списка карточек прежней студии): состояние карточки — то, что стоит в игре, а не то, как её нарисовали.
 */

import { localizedText } from "@modovik/optimizer";
import { OPTIMIZATION_FPS } from "@modovik/optimizer/layers.js";
import { fillCopy } from "./optimizer-copy.js";

export function optimizationCardView({ card, locale, copy, state, pending, failure, supported, readOnly = false }) {
  const title = localizedText(card.title, locale);
  const shot = localizedText(card.shot, locale);
  const fps = card.fps ? localizedText(OPTIMIZATION_FPS[card.fps], locale) : "";
  const busy = Boolean(pending);
  const idle = !supported && !readOnly;
  const status = idle
    ? copy.desktopOnly
    : pending
      ? copy[pending]
      : failure ||
        /* Отдельная часть (`optional`) в «В игре» не входит: карточка стоит, когда стоит её основной состав. */
        (state.on ? copy.on : state.partial ? fillCopy(copy.partial, state) : copy.off);
  const tone = idle ? "off" : pending ? "busy" : failure ? "error" : state.on ? "on" : state.partial ? "partial" : "off";
  return { title, shot, fps, busy, status, tone, dataState: state.on ? "on" : state.partial ? "partial" : "off" };
}
