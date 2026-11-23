/*
 * Откат ствола в ганпаке: что стоит в игре и как это снять (владелец, 03.11.2026).
 *
 * «Откатить» в редакторе возвращает ствол к стандартному на экране и в черновике, а игру не трогает: скин, который этот ствол уже поставил, снимет следующая установка ганпака — той же очередью, что «Применить»
 * (`useSkinInstall.removeFromGame`). Здесь — какие ключи памяти установки у ствола и сама очередь снятия.
 */

import { applyWorkshopWork, workSignature } from "../../../../../features/workshop/install-queue/index.js";
import { tr } from "../../../../../locales/ui.js";
import { fill } from "../gun-copy.js";

/**
 * Ключи памяти установки, под которыми скин ствола может стоять в игре: цель открытой модели (ствол игры или ствол из «Моих паков») и заводской ствол полки.
 * Берутся при откате, пока модель ещё открыта: после него студия уже стоит на стандартной.
 */
export function resetKeysOf(slot, targetKey, profile) {
  return [...new Set([targetKey, profile.gameModel?.(slot)].filter(Boolean))];
}

/** Из откатанных стволов — те, чей скин ещё стоит в игре: `{ слот → [ключи] }`. */
export function resetsInGame(resets, profile) {
  const out = {};
  for (const [slot, keys] of Object.entries(resets || {})) {
    const standing = keys.filter((key) => profile.skin.installOf(key));
    if (standing.length) out[slot] = standing;
  }
  return out;
}

/**
 * Снять скины откатанных стволов. Каждый встаёт в очередь «Применить» под ключом своей установки; игра открыта — ждёт её закрытия.
 * Возвращает `{ queued: [имена], skipped: [{ name, reason }] }`.
 */
export async function removeResetSkins({ resets, profile, onNotice = () => {} }) {
  const queued = [];
  const skipped = [];
  for (const [slot, keys] of Object.entries(resetsInGame(resets, profile))) {
    const name = profile.slotName(slot) || slot;
    for (const key of keys) {
      let placed = false;
      try {
        placed = await applyWorkshopWork({
          key: `astral.gun-studio.install:${key}`,
          signature: workSignature({ slot, remove: key }),
          title: `${tr("Как в игре")} — ${name}`,
          editor: profile.workLabel,
          waitForGame: true,
          notify: (text, tone) => onNotice(text, tone),
          savedText: fill(tr("Снимаем {skin} из игры"), { skin: profile.noun.skin || tr("скин") }),
          run: () => profile.skin.uninstall(key),
          doneText: () => profile.skin.words.removed,
        });
      } catch (error) {
        skipped.push({ name, reason: String(error?.message || error) });
        continue;
      }
      if (placed) queued.push(name);
      else skipped.push({ name, reason: tr("не встала в очередь") });
    }
  }
  return { queued, skipped };
}
