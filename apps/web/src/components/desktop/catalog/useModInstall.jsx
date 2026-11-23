import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  Check,
  DownloadSimple,
  Trash,
} from "../../ui/icons.jsx";
import { useTattooPackAllowed } from "../../../features/clothing/useServerClothing.js";
import { catalogModWithoutPackage } from "../../../catalog-utils.js";
import { useQueueProgress } from "../../../features/downloads/live-progress.js";
import { failureWords } from "../../../utils/installFailure.js";

/*
 * Главная кнопка страницы мода — что на ней написано и можно ли её нажать.
 *
 * Жила внутри плана установки (`ModActionMenu`), а теперь кнопку рисуют и
 * раскладки карточки на выбор (`mod-card/`): правила одни на всех — витрина
 * без пакета серая, пак тату без флага ждёт проверки, поставленный мод
 * снимается. Возвращает пропсы `Button` и пояснение под ней (пустая строка —
 * пояснять нечего).
 *
 * Статус установки — на самой кнопке (задача 1 ТЗ 08.10, вечер): «Загрузки»
 * больше не открываются, человек остаётся на странице, и кнопка — то место,
 * где он видит ход:
 *
 *   «Установить» → «Идёт установка… 42 %» (заливка слева, у ждущей — «в
 *   очереди») → «Установлено» на три секунды → обычная («Удалить»);
 *   отказ — «Повторить» и причина словами под кнопкой.
 *
 * Проценты читаются из склада хода (`live-progress.js`) только здесь: на
 * каждый шаг загрузки перерисовывается кнопка, а не вся страница.
 */

/* Сколько кнопка говорит «Установлено», прежде чем стать «Удалить». */
export const JUST_INSTALLED_MS = 3000;

export function useModInstall({
  active,
  actionCopy,
  installMod,
  ready,
  reduxCopy,
  removing,
  waiting = false,
  language = "ru",
}) {
  const live = useQueueProgress(active?.queueId || "");
  const failure = active?.failed || null;
  const progress = Math.max(
    0,
    Math.min(99, Number(live?.progress ?? active?.progress) || 0),
  );
  /* Только что встал: строка ушла из очереди, мод в игре. */
  const [justInstalled, setJustInstalled] = useState(false);
  const wasInstalling = useRef(false);
  const installing =
    Boolean(active) && !failure && !removing && active.operation !== "remove";
  useEffect(() => {
    if (installing) {
      wasInstalling.current = true;
      setJustInstalled(false);
      return undefined;
    }
    if (!wasInstalling.current) return undefined;
    wasInstalling.current = false;
    if (!ready) return undefined;
    setJustInstalled(true);
    const timer = setTimeout(() => setJustInstalled(false), JUST_INSTALLED_MS);
    return () => clearTimeout(timer);
  }, [installing, ready]);

  /* Витрина без пакета: «Установить» кончилось бы ошибкой облака. */
  const withoutPackage =
    !ready && !active && catalogModWithoutPackage(installMod);
  /* Пак тату без флага (Т-101): серо и словами, а не отказ после нажатия.
     Снять уже поставленный можно всегда. */
  const tattooAllowed = useTattooPackAllowed(installMod);
  const tattooPending = !ready && !active && !withoutPackage && !tattooAllowed;
  const running = Boolean(active) && !failure && !waiting;
  const words = failure ? failureWords(failure, language) : null;

  if (failure)
    return {
      state: "failed",
      button: {
        /* Пак звука не помещается и один (`sound-pack-slot-alone`): повтор ничего не изменит — не главное действие. */
        variant: failure.kind === "sound-pack-slot-alone" ? "secondary" : "primary",
        disabled: false,
        progress: null,
        caption: null,
        icon: <ArrowClockwise />,
        children: actionCopy.retry || actionCopy.install,
      },
      note: [words?.reason, words?.advice]
        .filter(Boolean)
        .map((part) => (/[.!?…]$/.test(part) ? part : `${part}.`))
        .join(" "),
    };

  if (justInstalled && ready && !active)
    return {
      state: "done",
      button: {
        variant: "primary",
        disabled: true,
        progress: null,
        caption: null,
        icon: <Check weight="bold" />,
        children: actionCopy.justInstalled || actionCopy.installed,
      },
      note: "",
    };

  return {
    state: active ? (waiting ? "queued" : "running") : ready ? "ready" : "idle",
    button: {
      variant: ready && !active ? "danger" : "primary",
      /* Занятая кнопка не «нельзя», а «идёт»: нажатие на неё открывает
         «Загрузки» с подробностями (`ModCardActions`). */
      disabled: (!active && (withoutPackage || tattooPending)) || removing,
      progress: running ? progress : active && waiting ? 0 : null,
      caption: running
        ? `${progress}%`
        : active && waiting && !removing
          ? actionCopy.queuedCaption || null
          : null,
      icon:
        ready && !active ? (
          <Trash />
        ) : withoutPackage || tattooPending ? null : (
          <DownloadSimple />
        ),
      children: active
        ? removing
          ? reduxCopy.removing
          : actionCopy.installingButton || reduxCopy.installing
        : ready
          ? actionCopy.remove
          : withoutPackage
            ? actionCopy.noPackage
            : tattooPending
              ? actionCopy.tattooPending
              : actionCopy.install,
    },
    note: withoutPackage
      ? actionCopy.noPackageNote
      : tattooPending
        ? actionCopy.tattooPendingNote
        : "",
  };
}
