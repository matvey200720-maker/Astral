/*
 * Снятое проверкой файлов игры — в оболочке (задача 2 ТЗ 10.10.2026).
 *
 * Движок, увидев, что Astral ушёл из архива игры (проверка целостности в
 * Steam, Epic или Rockstar Games Launcher, обновление игры, лаунчер проекта со
 * своей копией), сам переносит свои моды в «снятые» и говорит об этом в
 * профиле (`profile.parked[targetId]`) и событием `restored-by-launcher`.
 * Здесь:
 *   • список снятых модов движка держится для библиотеки, а их записи
 *     мастерской перестают считаться стоящими в игре (`parked-installs.js`);
 *   • по событию — сверка точек работ хоста (`getLibraryStatus`):
 *     откреплённые тоже уходят в снятые;
 *   • «Установить снова» — одна операция главного процесса
 *     (`reinstallAfterRestore`), после неё записи работ получают новые точки.
 * Проекты, «Мои работы» и настройки работ при этом не трогаются.
 */

import { useCallback, useRef, useState } from "react";
import { getLibraryStatus, reinstallAfterRestore } from "../api.js";
import { tr } from "../locales/ui.js";
import { runBesideWorkshopInstalls } from "../features/workshop/install-queue/index.js";
import {
  detachedPoints,
  parkPoints,
  syncParkedMods,
  unparkPoints,
} from "../features/library/parked-installs.js";
import { applyLibraryRemovalResult, readParkedWorkshopUnits } from "../workshop-library.js";
import { humanFailure } from "../utils/installFailure.js";

const WORDS = {
  ru: {
    done: (count) => `Вернули в игру: ${count}.`,
    partial: (count, names) => `Вернули в игру: ${count}. Не встало: ${names} — откройте их редактор и нажмите «Применить».`,
    nothing: "Возвращать нечего — всё уже в игре.",
  },
  uk: {
    done: (count) => `Повернули в гру: ${count}.`,
    partial: (count, names) => `Повернули в гру: ${count}. Не стало: ${names} — відкрийте їхній редактор і натисніть «Застосувати».`,
    nothing: "Повертати нічого — все вже в грі.",
  },
  en: {
    done: (count) => `Back in the game: ${count}.`,
    partial: (count, names) => `Back in the game: ${count}. Not installed: ${names} — open their editor and press “Apply”.`,
    nothing: "Nothing to bring back — everything is in the game.",
  },
  de: {
    done: (count) => `Wieder im Spiel: ${count}.`,
    partial: (count, names) => `Wieder im Spiel: ${count}. Nicht installiert: ${names} — öffne ihren Editor und drücke „Anwenden“.`,
    nothing: "Nichts zurückzuholen — alles ist im Spiel.",
  },
  pl: {
    done: (count) => `Wróciło do gry: ${count}.`,
    partial: (count, names) => `Wróciło do gry: ${count}. Nie weszło: ${names} — otwórz ich edytor i naciśnij „Zastosuj”.`,
    nothing: "Nie ma czego przywracać — wszystko jest w grze.",
  },
  fr: {
    done: (count) => `Remis dans le jeu\u00a0: ${count}.`,
    partial: (count, names) => `Remis dans le jeu\u00a0: ${count}. Non installés\u00a0: ${names} — ouvrez leur éditeur et cliquez sur «\u00a0Appliquer\u00a0».`,
    nothing: "Rien à restaurer — tout est déjà dans le jeu.",
  },
};

export function useCheckRemoved({ gameId, language, notify, refreshProfile }) {
  const [removed, setRemoved] = useState([]);
  const [revision, setRevision] = useState(0);
  const latest = useRef(null);
  latest.current = { gameId, language, notify, refreshProfile };

  /* Профиль пришёл: снятые моды движка и, если проверка файлов только что
     была, — точки работ хоста. */
  const onProfile = useCallback(async (profile, targetId) => {
    const list = Array.isArray(profile?.parked?.[targetId]) ? profile.parked[targetId] : [];
    setRemoved(list);
    let changed = syncParkedMods(list.map((item) => item.modId));
    const events = profile?.reconcile?.[targetId] || [];
    if (list.length || events.some((event) => event?.kind === "restored-by-launcher")) {
      const status = await getLibraryStatus({ targetId }).catch(() => null);
      changed = parkPoints(detachedPoints(status)) || changed;
    }
    if (changed) setRevision((value) => value + 1);
  }, []);

  /* Пересверить точки работ хоста (библиотека и мастерская открылись). */
  const onLibraryStatus = useCallback((status) => {
    if (parkPoints(detachedPoints(status))) setRevision((value) => value + 1);
  }, []);

  const reinstall = useCallback(async () => {
    const { gameId: targetId, language: lang, notify: show, refreshProfile: refresh } = latest.current;
    const words = WORDS[lang] || WORDS.en;
    try {
      /* Возврат пишет в тот же update.rpf, что и очередь мастерской: он встаёт за её идущей записью (иначе замок
         главного процесса отвечал «Мастерская уже применяет изменения»), и работы хоста читаются уже после ожидания —
         пока он ждал, очередь могла поставить часть из них сама. */
      const result = await runBesideWorkshopInstalls("library-reinstall", tr("Библиотека"), () => {
        const natives = readParkedWorkshopUnits()
          .filter((unit) => unit.kind === "native")
          .map((unit) => ({ restorePointId: unit.restorePointId, patch: unit.patch, key: unit.key, name: unit.name || "" }));
        return reinstallAfterRestore({ targetId, natives });
      });
      applyLibraryRemovalResult(globalThis.localStorage, { remap: result?.natives?.remap || {} });
      unparkPoints(Object.keys(result?.natives?.remap || {}));
      await refresh?.();
      setRevision((value) => value + 1);
      const count = (result?.mods?.restored?.length || 0) + Object.keys(result?.natives?.remap || {}).length;
      const failed = [...(result?.natives?.failed || []), ...(result?.mods?.lost || []).map((modId) => ({ key: modId, name: "" }))];
      if (!count && !failed.length) show?.(words.nothing);
      else if (failed.length)
        show?.(words.partial(count, failed.map((item) => item.name || item.key).slice(0, 3).join(", ")), "error");
      else show?.(words.done(count));
      return result;
    } catch (error) {
      show?.(humanFailure(error, lang), "error");
      return null;
    }
  }, []);

  return { removed, revision, onProfile, onLibraryStatus, reinstall };
}
