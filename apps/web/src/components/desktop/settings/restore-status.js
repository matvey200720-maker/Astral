import { useEffect, useRef, useState } from "react";
import { failureNotice, successNotice } from "../../../features/downloads/install-outcome.js";
import { useQueueProgress, withLiveProgress } from "../../../features/downloads/live-progress.js";
import { failureWords } from "../../../utils/installFailure.js";
import { gameLocationCopy } from "./game-copy.js";

const DONE_VISIBLE_MS = 8000;
const PERCENT_CEILING = 99;

// Вызывающий читает только эти три поля; tone у части состояний не задан, но ключ остаётся.
function status(state, line, tone) {
  return { state, line, tone };
}

// Нечисловое даёт 0, потолок 99: сотня значит «готово», а его показывает другое состояние.
function toPercent(progress) {
  const value = Number(progress);
  if (Number.isNaN(value)) return 0;
  const rounded = Math.round(value);
  return Math.min(PERCENT_CEILING, Math.max(0, rounded));
}

const wordsFor = (language) => gameLocationCopy[language] || gameLocationCopy.en;

// Правила идут по порядку, решает первое подошедшее: нет строки → отказ → очередь → ход.
const STATUS_RULES = [
  {
    matches: ({ item }) => !item,
    make: ({ doneShown, language }) =>
      doneShown ? status("done", successNotice({ operation: "reset" }, language), "positive") : status("idle", ""),
  },
  {
    matches: ({ item }) => item.failed,
    make: ({ item, language }) => {
      const failure = { ...item.failed, ...failureWords(item.failed, language) };
      return status("failed", failureNotice(item, failure, language), "attention");
    },
  },
  {
    matches: () => true,
    make: ({ item, live, language }) => {
      const words = wordsFor(language);
      if (!item.started) return status("queued", words.resetQueued);
      const percent = toPercent(withLiveProgress(item, live).progress);
      return status("running", words.resetRunning(percent));
    },
  },
];

function describeStatus(context) {
  return STATUS_RULES.find((rule) => rule.matches(context)).make(context);
}

// Показ «готово» на DONE_VISIBLE_MS; вернуть нужно функцию очистки таймера.
function showDoneBriefly(setDoneShown) {
  const hide = () => setDoneShown(false);
  setDoneShown(true);
  const timer = window.setTimeout(hide, DONE_VISIBLE_MS);
  return () => window.clearTimeout(timer);
}

// Признаки строки, от которых зависит эффект; читаются в порядке: есть ли строка, отказ, шаг.
function rowFacets(item) {
  return { present: Boolean(item), failed: Boolean(item?.failed), phase: item?.phase };
}

/**
 * Сводит строку сброса из очереди «Загрузок» к одному состоянию для «Настроек › GTA V».
 * После шага `components` и ухода строки без отказа «готово» держится 8 секунд.
 */
export function useRestoreStatus(item, language) {
  const [doneShown, setDoneShown] = useState(false);
  const reachedComponents = useRef(false);
  const live = useQueueProgress(item?.queueId || "");

  const { present, failed, phase } = rowFacets(item);

  // Реагирует на смену признаков строки, а не на новый объект с теми же признаками.
  useEffect(() => {
    if (!present) {
      if (!reachedComponents.current) return undefined;
      reachedComponents.current = false;
      return showDoneBriefly(setDoneShown);
    }
    setDoneShown(false);
    reachedComponents.current = failed ? false : phase === "components" || reachedComponents.current;
    return undefined;
  }, [present, failed, phase]);

  return describeStatus({ item, live, doneShown, language });
}
