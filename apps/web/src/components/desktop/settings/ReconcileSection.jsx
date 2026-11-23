import { useCallback, useEffect, useMemo, useState } from "react";
import { RECONCILE_KIND } from "@modovik/minimap-contract/reconcile";
import Button from "../../ui/Button.jsx";
import { ArrowClockwise } from "../../ui/icons.jsx";
import { useAttentionAllows } from "../../../attention.js";
import { desktopHost, sanitizeDesktopErrorMessage } from "../../../api.js";
import { copyText } from "../../../clipboard.js";
import { reconcileCopyFor, renderReconcile } from "./reconcile-copy.js";

/*
 * «Сверка с игрой» в «Настройках › Логи» (ТЗ H1, 14.11.2026): что Astral записал
 * в игру при каждом «Применить» экрана игры — мини-карты, прицела, счётчиков
 * патронов и урона — и при перестановке карты под новый экран. Записи читаются
 * из журнала приложения (`kind: "hud-reconcile"`, поле `data` — запись сверки,
 * формат в `@modovik/minimap-contract/reconcile`), строки подбирает
 * `renderReconcile`. «Скопировать» отдаёт запись целиком — для поддержки.
 */

const POLL_MS = 4000;
const MAX_RECORDS = 30;

export default function ReconcileSection({ language = "ru" }) {
  const copy = reconcileCopyFor(language);
  const supported = typeof desktopHost()?.listAppLog === "function";
  const attentive = useAttentionAllows("motion");
  const [entries, setEntries] = useState([]);
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    try {
      const reply = await desktopHost().listAppLog({});
      const found = (reply?.entries || []).filter(
        (entry) =>
          entry?.kind === RECONCILE_KIND &&
          entry.data &&
          typeof entry.data === "object",
      );
      setEntries(found.slice(-MAX_RECORDS).reverse());
      setProblem("");
    } catch (error) {
      setProblem(sanitizeDesktopErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    if (!supported || !attentive) return undefined;
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [supported, attentive, refresh]);

  const rendered = useMemo(
    () =>
      entries.map((entry) => ({
        key: entry.n ?? `${entry.t}${entry.message}`,
        ...renderReconcile(entry.data, language),
      })),
    [entries, language],
  );

  const copyOne = async (key, text) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied(""), 2000);
    }
  };

  if (!supported) return null;
  return (
    <section
      className="settings-crashes"
      aria-label={copy.title}
      data-setting="reconcile"
    >
      <header className="settings-crashes-head">
        <h3>{copy.title}</h3>
        <span className="settings-crashes-actions">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowClockwise />}
            onClick={refresh}
          >
            {copy.refresh}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={rendered.length === 0}
            onClick={() =>
              copyOne("all", rendered.map((item) => item.text).join("\n\n"))
            }
          >
            {copied === "all" ? copy.copied : copy.copyAll}
          </Button>
        </span>
      </header>
      <p className="settings-crashes-lede">{copy.intro}</p>
      {problem ? (
        <p className="settings-logs-status is-error" role="alert">
          {problem}
        </p>
      ) : null}
      {rendered.length ? (
        <ol className="settings-crashes-list" aria-label={copy.title}>
          {rendered.map((item) => (
            <li
              className="settings-crash"
              key={item.key}
              data-reconcile-record={item.key}
            >
              <div className="settings-crash-top">
                <b className="settings-crash-where">{item.title}</b>
              </div>
              {item.sections
                .filter(
                  (section) => section.id === "game" || section.id === "verify",
                )
                .map((section) => (
                  <p className="settings-crash-reason" key={section.id}>
                    {
                      section.rows[
                        section.id === "game" ? 0 : section.rows.length - 1
                      ]
                    }
                  </p>
                ))}
              <details>
                <summary>{copy.details}</summary>
                <pre>{item.text}</pre>
              </details>
              <div className="settings-crash-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyOne(item.key, item.text)}
                >
                  {copied === item.key ? copy.copied : copy.copyOne}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="settings-logs-empty">{copy.empty}</p>
      )}
    </section>
  );
}
