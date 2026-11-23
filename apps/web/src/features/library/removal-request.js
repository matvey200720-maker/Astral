import { EFFECTS_SLOT_PARTS } from "../../workshop-library.js";
import { SOUND_HIT_SLOT_PARTS } from "../workshop/sound-kit-record.js";

/*
 * Что снять по отмеченным карточкам полки.
 *
 * Отмечается карточка, а снимается установка. Обычно это одно и то же: мод в
 * слоте, мини-карта, небо. Но набор эффектов уезжает в игру одним патчем и
 * стоит на полке тремя карточками — трейсеры, попадания, огонь. Раньше
 * отмеченные «Трейсеры» отмечали заодно и «Эффекты попадания», а удаление
 * уносило обе. Человек этого не просил (владелец, 24.09.2026): он видит две
 * вещи и выбирает одну.
 *
 * Поэтому отметка у каждой карточки своя, а набор эффектов не снимается, а
 * пересобирается без отмеченных частей: трейсеры уходят, попадания остаются.
 * Целиком он снимается, только когда отмечены все его части, — тогда это
 * обычное удаление точки отката.
 *
 * Так же устроены звуки попадания: голова и тело — один мод на двух
 * карточках, и снятая голова значит «поставить звук тела без головы».
 *
 * Установку, которую по частям не разобрать, так не спасти: она уходит
 * целиком. Карточки, которые уйдут вместе с отмеченной, в запросе названы
 * (`together`) — окно показывает их, а не прячет.
 */

/* Установки, которые снимаются по частям: карточка → часть. */
const SPLIT_SLOT_PARTS = Object.freeze({
  effects: EFFECTS_SLOT_PARTS,
  "sound-hits": SOUND_HIT_SLOT_PARTS,
});

const partsOfSlots = (split, slots) => [
  ...new Set(
    slots.map((slotId) => SPLIT_SLOT_PARTS[split]?.[slotId]).filter(Boolean),
  ),
];

/**
 * @param {{
 *   entries: Array<{ id: string, title: string, slots?: string[], units: object[] }>,
 *   selected: Iterable<string>,
 * }} input `entries` — карточки полки, `selected` — отмеченные (id карточек)
 * @returns {{
 *   entries: Array<{ id: string, title: string, units: object[], together?: boolean }>,
 *   units: object[],
 *   splits: Array<{
 *     key: string,
 *     kind: "effects"|"sound-hits",
 *     unit: object,
 *     parts: string[],
 *     keep: string[],
 *     titles: string[],
 *     kept: Array<{ id: string, title: string }>,
 *   }>,
 * }} карточки, что уйдут из игры; установки, что снимаются целиком; наборы,
 *   что пересобираются без частей `parts` (отмечены карточки `titles`, в игре
 *   остаются части `keep`, на полке — карточки `kept`)
 */
export function libraryRemovalRequest({ entries, selected }) {
  const chosen = new Set(selected);
  const picked = entries.filter((entry) => chosen.has(entry.id));
  const carries = (entry, unit) =>
    entry.units.some((item) => item.key === unit.key);

  const units = new Map();
  for (const entry of picked)
    for (const unit of entry.units) units.set(unit.key, unit);

  const whole = [];
  const splits = [];
  for (const unit of units.values()) {
    if (SPLIT_SLOT_PARTS[unit.split]) {
      const owners = picked.filter((entry) => carries(entry, unit));
      const parts = partsOfSlots(
        unit.split,
        owners.flatMap((entry) =>
          (entry.slots || [entry.id]).filter((slotId) =>
            unit.slots.includes(slotId),
          ),
        ),
      );
      const keep = partsOfSlots(unit.split, unit.slots).filter(
        (part) => !parts.includes(part),
      );
      if (parts.length && keep.length) {
        splits.push({
          key: `split:${unit.key}`,
          kind: unit.split,
          unit,
          parts,
          keep,
          titles: owners.map((entry) => entry.title),
          kept: entries
            .filter((entry) => !chosen.has(entry.id) && carries(entry, unit))
            .map(({ id, title }) => ({ id, title })),
        });
        continue;
      }
    }
    whole.push(unit);
  }

  const leaving = new Set(whole.map((unit) => unit.key));
  const together = entries
    .filter(
      (entry) =>
        !chosen.has(entry.id) &&
        entry.units.some((unit) => leaving.has(unit.key)),
    )
    .map((entry) => ({ ...entry, together: true }));

  return {
    entries: [...picked, ...together],
    units: whole,
    splits,
  };
}

/**
 * Карточки полки, на которых стоит установка, — чтобы отметить их все, когда
 * человек просит снять её целиком («Удалить весь набор эффектов»).
 */
export function entriesCarrying(entries, unit) {
  return entries
    .filter((entry) => entry.units.some((item) => item.key === unit.key))
    .map((entry) => entry.id);
}
