import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, DownloadSimple } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import { desktopHost, sanitizeDesktopErrorMessage } from "../../../api.js";
import { gameCrashCopyFor, reasonText } from "./game-crash-copy.js";

/*
 * «Последние падения игры» в «Настройках › Логи» (ТЗ владельца 11.11.2026): когда упало, где (GTA V, Majestic, GTA 5 RP),
 * причина одной строкой и единственное действие — «Скачать логи для тикета» (все журналы целиком). Догадку о виновном
 * моде человеку не показываем (владелец 14.11.2026): она остаётся в данных и уходит в полной выгрузке для поддержки.
 * Данные приходят из приложения (`listGameCrashes`): оно само смотрит журналы Windows и клиентов после выхода из игры.
 */
const EMPTY = { ready: false, crashes: [], unnoticed: [] };
const EXPORT_NAME = "astral-log.txt";

const pad2 = (value) => String(value).padStart(2, "0");

function formatStamp(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function saveInWindow(text) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = EXPORT_NAME;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CrashRow({ crash, copy, language, onDownload, busy }) {
  const where = copy.where[crash.where] ? crash.where : "unknown";
  const untrusted = ["missing", "too-big", "unreadable"].includes(crash.index);
  const evidence = crash.evidence || [];
  return (
    <li className="settings-crash" data-where={where} data-crash-id={crash.id}>
      <div className="settings-crash-top">
        <time dateTime={new Date(crash.t).toISOString()}>
          {formatStamp(crash.t)}
        </time>
        <b className="settings-crash-where">{copy.where[where]}</b>
        <span className="settings-crash-kind">
          {copy.kind[crash.event] || copy.kind.crash}
        </span>
      </div>
      <p className="settings-crash-reason">
        {reasonText(language, crash.reason)}
      </p>
      {(crash.foreign || []).length > 0 ? (
        <p className="settings-crash-note">
          {copy.foreign(crash.foreign.join(", "))}
        </p>
      ) : null}
      {untrusted && (crash.wanted || []).length > 0 ? (
        <p className="settings-crash-note">{copy.noMods}</p>
      ) : null}
      <details>
        <summary>{copy.details}</summary>
        <dl className="settings-crash-facts">
          {crash.process ? (
            <>
              <dt>{copy.process}</dt>
              <dd>
                {`${crash.process.name} ${crash.process.version || ""}`.trim()}
              </dd>
            </>
          ) : null}
          {crash.module ? (
            <>
              <dt>{copy.module}</dt>
              <dd>
                {`${crash.module.name} ${crash.module.version || ""}`.trim()}
              </dd>
            </>
          ) : null}
          {crash.exception ? (
            <>
              <dt>{copy.exception}</dt>
              <dd>{`0x${crash.exception}${crash.offset ? ` · ${crash.offset}` : ""}`}</dd>
            </>
          ) : null}
          {crash.modsTotal ? (
            <>
              <dt>Astral</dt>
              <dd>{copy.mods(crash.modsTotal)}</dd>
            </>
          ) : null}
        </dl>
        {evidence
          .filter((item) => item.lines?.length)
          .map((item) => (
            <div key={`${item.source}:${item.file}`}>
              <p className="settings-crash-evidence-title">{`${copy.evidence}: ${item.file}`}</p>
              <pre>{item.lines.join("\n")}</pre>
            </div>
          ))}
      </details>
      <div className="settings-crash-actions">
        <Button
          variant="primary"
          size="sm"
          icon={<DownloadSimple />}
          disabled={busy}
          onClick={onDownload}
        >
          {copy.download}
        </Button>
        <small className="settings-crash-hint">{copy.downloadHint}</small>
      </div>
    </li>
  );
}

export default function GameCrashSection({ language = "ru" }) {
  const copy = gameCrashCopyFor(language);
  const supported = typeof desktopHost()?.listGameCrashes === "function";
  const [state, setState] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const apply = useCallback((reply) => {
    setState({
      ready: reply?.ready !== false,
      crashes: reply?.crashes ?? [],
      unnoticed: reply?.unnoticed ?? [],
    });
    /* Раздел открыт — падения людям показаны: всплывашка оболочки их больше не повторит. */
    if (reply?.unnoticed?.length)
      void desktopHost().markGameCrashesNoticed?.(reply.unnoticed);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await desktopHost().listGameCrashes());
    } catch (error) {
      setStatus({ failed: true, text: sanitizeDesktopErrorMessage(error) });
    }
  }, [apply]);

  useEffect(() => {
    if (!supported) return undefined;
    void refresh();
    return desktopHost().onGameCrash?.(() => void refresh());
  }, [supported, refresh]);

  const scan = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const reply = await desktopHost().scanGameCrashes();
      apply(reply);
      if (reply?.busy) setStatus({ text: copy.scanBusy });
    } catch (error) {
      setStatus({ failed: true, text: sanitizeDesktopErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  /* Тот же путь, что у «Скачать для тикета» во вкладке «Логи»: все журналы целиком одним файлом, человек сам прикладывает его к тикету. */
  const downloadLogs = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const reply = await desktopHost().exportAppLog();
      if (reply?.saved) {
        setStatus({ text: copy.supportDone(reply.fileName) });
      } else if (reply?.canceled) setStatus({ text: copy.canceled });
      else if (reply?.text) {
        saveInWindow(reply.text);
        setStatus({ text: copy.supportDone(EXPORT_NAME) });
      }
    } catch (error) {
      setStatus({ failed: true, text: sanitizeDesktopErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const rows = state.crashes.map((crash) => (
    <CrashRow
      key={crash.id}
      crash={crash}
      copy={copy}
      language={language}
      busy={busy}
      onDownload={downloadLogs}
    />
  ));

  if (!supported) return null;
  return (
    <section
      className="settings-crashes"
      aria-label={copy.title}
      data-setting="game-crashes"
    >
      <header className="settings-crashes-head">
        <h3>{copy.title}</h3>
        <span className="settings-crashes-actions">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowClockwise />}
            disabled={busy}
            onClick={scan}
          >
            {busy ? copy.scanning : copy.scan}
          </Button>
        </span>
      </header>
      <p className="settings-crashes-lede">{copy.lede}</p>
      {status ? (
        <p
          className={`settings-logs-status${status.failed ? " is-error" : ""}`}
          role={status.failed ? "alert" : "status"}
        >
          {status.failed ? `${copy.failed}: ${status.text}` : status.text}
        </p>
      ) : null}
      {state.crashes.length ? (
        <ol className="settings-crashes-list" aria-label={copy.title}>
          {rows}
        </ol>
      ) : (
        <p className="settings-logs-empty">
          {state.ready ? copy.empty : copy.starting}
        </p>
      )}
    </section>
  );
}
