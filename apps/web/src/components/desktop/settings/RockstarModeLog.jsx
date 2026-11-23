import { useCallback, useEffect, useState } from "react";
import Button from "../../ui/Button.jsx";
import { getRockstarModeLog } from "../../../api.js";
import { copyText } from "../../../clipboard.js";
import {
  renderModeLogLine,
  rockstarModeCopyFor,
} from "./rockstar-mode-copy.js";

/*
 * «Журнал режима» (05.11.2026) — что делали агент и окно: запуск, подмена,
 * возврат. Свёрнут и читается только раскрытым: журнал пишут агент и окно, а
 * фразы на языке человека подбирает `renderModeLogLine`. Живёт на вкладке
 * «Rockstar Games» (с 14.11.2026; раньше — внутри раздела «GTA V»).
 */

const LOG_REFRESH_MS = 3000;

export default function RockstarModeLog({ language }) {
  const text = rockstarModeCopyFor(language);
  const [logOpen, setLogOpen] = useState(false);
  const [records, setRecords] = useState([]);
  const [copied, setCopied] = useState(false);

  const loadLog = useCallback(async () => {
    const next = await getRockstarModeLog({ limit: 200 }).catch(() => []);
    setRecords(Array.isArray(next) ? next : []);
  }, []);

  useEffect(() => {
    if (!logOpen) return undefined;
    loadLog();
    const timer = setInterval(loadLog, LOG_REFRESH_MS);
    return () => clearInterval(timer);
  }, [logOpen, loadLog]);

  const lines = records.map((record) => ({
    key: `${record.at}-${record.scope}-${record.code}-${record.src}`,
    time: new Date(record.at).toLocaleTimeString(language),
    source: record.src === "agent" ? text.logAgent : text.logWindow,
    text: renderModeLogLine(record, language),
  }));

  const copyLog = async () => {
    if (
      await copyText(
        lines
          .map((line) => `${line.time} [${line.source}] ${line.text}`)
          .join("\n"),
      )
    ) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <details
      className="settings-delivery-other settings-delivery-log"
      data-setting="log"
      onToggle={(event) => setLogOpen(event.currentTarget.open)}
    >
      <summary>{text.logTitle}</summary>
      {lines.length === 0 ? (
        <div className="settings-row">
          <span className="settings-row-copy">
            <small>{text.logEmpty}</small>
          </span>
        </div>
      ) : (
        <>
          <ol className="settings-delivery-log-list" aria-label={text.logTitle}>
            {lines.map((line) => (
              <li key={line.key}>
                <time>{line.time}</time> <b>{line.source}</b> {line.text}
              </li>
            ))}
          </ol>
          <div className="settings-row">
            <span className="settings-row-control">
              <Button size="sm" onClick={copyLog}>
                {copied ? text.logCopied : text.logCopy}
              </Button>
            </span>
          </div>
        </>
      )}
    </details>
  );
}
