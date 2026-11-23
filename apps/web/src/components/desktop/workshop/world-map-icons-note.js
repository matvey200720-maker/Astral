/*
 * Строка про значки карты игры — в итог установки большой карты (05.11.2026).
 *
 * Установка отдаёт `icons: { applied, restored, unchanged, failed, notes, counts }` (`installWorldMap` → `installBlipIcons`):
 * легли ли значки, вернулись ли игре, сколько правок не вышло и почему. Не просили (`icons` нет) — сказать нечего.
 */

import { mapText } from "./world-map/map-copy.js";
import { tr } from "../../../locales/ui.js";

/** Что сказать про значки; пусто — их не касались. */
export function blipIconsDoneNote(icons) {
  if (!icons) return "";
  if (icons.failed) return mapText("Значки карты не встали: {reason}", { reason: icons.failed });
  const skipped = Array.isArray(icons.notes) ? icons.notes.length : 0;
  const lead = icons.restored
    ? icons.applied
      ? tr("Значки карты возвращены игре")
      : ""
    : icons.applied
      ? mapText("Значки карты записаны в игру: изменено {count}", { count: icons.counts?.total ?? 0 })
      : icons.counts?.total
        ? tr("Значки карты у игры уже такие")
        : "";
  if (!lead) return "";
  return skipped ? `${lead}. ${mapText("Не поменялись значки: {count} — причины в разделе «Иконки»", { count: skipped })}` : lead;
}

/** Итоговая строка установки со значками в конце. */
export function withBlipIconsNote(text, icons) {
  const note = blipIconsDoneNote(icons);
  return note ? `${String(text).replace(/\.$/, "")}. ${note}` : text;
}
