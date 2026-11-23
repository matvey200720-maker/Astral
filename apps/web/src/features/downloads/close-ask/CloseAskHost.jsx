import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { desktopHost } from "../../../api.js";
import { getUpdatesSnapshot } from "../../updates/store.js";
import { closeAskSummary } from "./close-ask-summary.js";

// Окно с вопросом и его слова едут отдельным куском: в стартовом куске остаётся только хост (бюджет verify-web-architecture).
const CloseAskDialog = lazy(() => import("./CloseAskDialog.jsx"));

/*
 * Вопрос при закрытии окна, пока идёт скачивание (макет В1, 16.11.2026). Главный процесс (`app-presence.js`), увидев, что скачивание идёт, не закрывает
 * окно, а просит спросить: сюда приходит `{ id }`. Хост собирает названия и проценты из очереди окна и состояния обновления Astral и показывает
 * окно. «Показал» уходит, когда окно уже на экране: не дождавшись его, главный процесс спрашивает системным окном (интерфейс завис — закрыть
 * всё равно можно). Скачивать нечего — хост отвечает «закрыть» сам, без окна.
 */
export function CloseAskHost({ queue, language }) {
  const latest = useRef({ queue });
  latest.current = { queue };
  const [ask, setAsk] = useState(null);

  useEffect(() => {
    const host = desktopHost();
    if (typeof host?.onCloseAsk !== "function") return undefined;
    return host.onCloseAsk((request) => {
      if (!request || !Number.isInteger(request.id)) return;
      if (request.dismiss) {
        setAsk((current) => (current?.id === request.id ? null : current));
        return;
      }
      // `qaSummary` — только песочница разработки (`window.__astralQaCloseAsk(итог)`): окно без настоящей очереди загрузок; в боевой сборке ветка вырезается.
      const summary = (import.meta.env.DEV && request.qaSummary) || closeAskSummary({ queue: latest.current.queue, updateState: getUpdatesSnapshot()?.state ?? null });
      if (!summary) {
        void host.answerCloseAsk?.({ id: request.id, action: "quit", dontAsk: false });
        return;
      }
      setAsk({ id: request.id, summary });
    });
  }, []);

  const shown = useCallback(() => {
    if (ask) void desktopHost()?.closeAskShown?.(ask.id);
  }, [ask]);

  const answer = useCallback(
    (action, dontAsk) => {
      if (!ask) return;
      void desktopHost()?.answerCloseAsk?.({ id: ask.id, action, dontAsk });
      setAsk(null);
    },
    [ask],
  );

  if (!ask) return null;
  return (
    <Suspense fallback={null}>
      <CloseAskDialog language={language} summary={ask.summary} onShown={shown} onAnswer={answer} />
    </Suspense>
  );
}

export default CloseAskHost;
