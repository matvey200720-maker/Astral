import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUUpLeft, Check, CircleNotch, MagnifyingGlass, ShieldCheck, Warning } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import Checkbox from "../../ui/Checkbox.jsx";
import Dialog from "../../ui/Dialog.jsx";
import {
  applyStockReset,
  listStockQuarantine,
  openStockVerify,
  restoreStockQuarantine,
  scanStockGame,
  stockResetAvailable,
  stockScanProgress,
} from "../../../api.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { formatBytes } from "./format-bytes.js";
import { stockResetCopyFor, stockResetFailure } from "./stock-reset-copy.js";

/*
 * «Сбросить GTA до стандартной» (Настройки → Игра, 03.11.2026).
 *
 * Как проверка файлов у платформы, только без раздачи файлов игры (их на
 * наш сервер не кладём): сверка с описью штатной сборки → Astral снимает свои
 * моды обычным «Вернуть GTA V без модов» → лишнее уезжает в карантин данных
 * Astral → штатные файлы, которых у Astral нет, возвращает проверка магазина
 * (Steam, Epic, Rockstar Games Launcher) → сверка ещё раз. Ничего не
 * удаляется: «Вернуть убранные файлы» кладёт отложенное обратно.
 *
 * Что уносить, решает главный процесс по своей сверке; окно присылает только
 * снятые с отметки строки (`skip`).
 */

const PROGRESS_MS = 400;
const LIST_PREVIEW = 8;

function useQuarantine(targetId) {
  const [summary, setSummary] = useState({ files: 0, bytes: 0 });
  const refresh = useCallback(async () => {
    if (!targetId || !stockResetAvailable()) return;
    try {
      const sessions = await listStockQuarantine({ targetId });
      setSummary({
        files: sessions.reduce((sum, item) => sum + (item.files || 0), 0),
        bytes: sessions.reduce((sum, item) => sum + (item.bytes || 0), 0),
      });
    } catch {}
  }, [targetId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return [summary, refresh, setSummary];
}

function hasWork(result) {
  return Boolean(result && (result.totals.extraUnits || result.astral?.mods || result.verify?.needed));
}

function ScanLine({ result, copy }) {
  if (!result) return null;
  const { totals } = result;
  const lines = [];
  lines.push(
    result.manifest.status === "matched"
      ? `${copy.manifest.matched(result.manifest.exeVersion)}${result.mode === "quick" ? ` ${copy.quick}` : ""}`
      : copy.manifest[result.manifest.status] || copy.manifest.missing,
  );
  if (!hasWork(result)) return [<small key="m">{lines[0]}</small>, <small key="c" data-tone="positive">{copy.clean}</small>];
  if (totals.modified) lines.push(copy.modified(totals.modified));
  if (totals.missing) lines.push(copy.missing(totals.missing));
  if (totals.extraFiles) lines.push(copy.extras(totals.extraFiles, totals.extraBytes));
  if (result.astral?.mods) lines.push(copy.astral(result.astral.mods));
  return lines.map((line, index) => (
    <small key={index} data-tone={index ? "attention" : undefined}>
      {line}
    </small>
  ));
}

function PathList({ items, total, copy }) {
  if (!items?.length) return null;
  return (
    <ul className="stock-reset-list">
      {items.slice(0, LIST_PREVIEW).map((item) => (
        <li key={item.path} title={item.path}>
          {item.path}
        </li>
      ))}
      {total > LIST_PREVIEW && <li>{copy.more(total - LIST_PREVIEW)}</li>}
    </ul>
  );
}

export default function StockResetSection({ target, language, onReset, resetItem, onOpenDownloads }) {
  const copy = stockResetCopyFor(language);
  const targetId = target?.id || "";
  const [scan, setScan] = useState({ status: "idle", result: null, error: "", progress: null });
  const [flow, setFlow] = useState({ phase: "idle", outcome: null, error: "" });
  const [skip, setSkip] = useState(() => new Set());
  const [restoreState, setRestoreState] = useState({ status: "idle", text: "", tone: undefined });
  const [quarantine, refreshQuarantine, setQuarantine] = useQuarantine(targetId);
  const lastAstralItem = useRef(null);
  const available = stockResetAvailable();

  const failure = useCallback(
    (error) => stockResetFailure(error, copy) || humanFailure(error, language),
    [copy, language],
  );

  const runScan = useCallback(
    async (mode = "quick") => {
      if (!targetId) return null;
      if (!stockResetAvailable()) {
        setScan({ status: "error", result: null, error: copy.errors.desktopOnly, progress: null });
        return null;
      }
      setScan((current) => ({ ...current, status: "scanning", error: "", progress: null }));
      const timer = window.setInterval(async () => {
        const progress = await stockScanProgress({ targetId }).catch(() => null);
        if (progress) setScan((current) => (current.status === "scanning" ? { ...current, progress } : current));
      }, PROGRESS_MS);
      try {
        const result = await scanStockGame({ targetId, mode });
        setScan({ status: "done", result, error: "", progress: null });
        if (result?.quarantine) setQuarantine({ files: result.quarantine.files, bytes: result.quarantine.bytes });
        return result;
      } catch (error) {
        setScan({ status: "error", result: null, error: failure(error), progress: null });
        return null;
      } finally {
        window.clearInterval(timer);
      }
    },
    [targetId, copy, failure, setQuarantine],
  );

  /* Перенос и проверка магазином — после того, как Astral снял свои моды. */
  const moveAndVerify = useCallback(async () => {
    setFlow({ phase: "moving", outcome: null, error: "" });
    try {
      const outcome = await applyStockReset({ targetId, skip: [...skip] });
      if (outcome?.after) {
        setScan({ status: "done", result: outcome.after, error: "", progress: null });
        setQuarantine({ files: outcome.after.quarantine.files, bytes: outcome.after.quarantine.bytes });
      }
      setFlow({ phase: "result", outcome, error: "" });
    } catch (error) {
      setFlow({ phase: "result", outcome: null, error: failure(error) });
    }
  }, [targetId, skip, failure, setQuarantine]);

  /*
   * Шаг «Astral снимает свои моды» идёт очередью «Загрузок»: ждём, пока его
   * строка уйдёт из очереди. Готово — по шагу, как у `restore-status.js`:
   * строка, дошедшая до подготовки компонентов, восстановление сделала, а
   * ушедшая раньше (отмена) или упавшая — нет.
   */
  useEffect(() => {
    if (flow.phase !== "astral") {
      lastAstralItem.current = null;
      return;
    }
    if (resetItem) {
      if (resetItem.failed) {
        lastAstralItem.current = null;
        setFlow({ phase: "result", outcome: null, error: copy.errors.astralFailed });
      } else lastAstralItem.current = resetItem;
      return;
    }
    const last = lastAstralItem.current;
    if (!last) return;
    lastAstralItem.current = null;
    if (last.phase === "components") void moveAndVerify();
    else setFlow({ phase: "result", outcome: null, error: copy.errors.astralFailed });
  }, [flow.phase, resetItem, moveAndVerify, copy]);

  function confirm() {
    if (scan.result?.astral?.mods) {
      lastAstralItem.current = null;
      setFlow({ phase: "astral", outcome: null, error: "" });
      onReset?.();
      return;
    }
    void moveAndVerify();
  }

  async function reopenVerify() {
    try {
      const action = await openStockVerify({ targetId });
      setFlow((current) => ({
        ...current,
        outcome: current.outcome ? { ...current.outcome, verify: { ...current.outcome.verify, ...action, needed: true } } : current.outcome,
      }));
    } catch {}
  }

  async function bringBack() {
    setRestoreState({ status: "running", text: copy.restoring, tone: undefined });
    try {
      const result = await restoreStockQuarantine({ targetId });
      const text = [copy.restored(result?.returned || 0), result?.conflicts ? copy.conflicts(result.conflicts) : ""]
        .filter(Boolean)
        .join(" ");
      setRestoreState({ status: "done", text, tone: result?.conflicts || result?.failed ? "attention" : "positive" });
      await refreshQuarantine();
      if (scan.result) void runScan(scan.result.mode);
    } catch (error) {
      setRestoreState({ status: "done", text: failure(error), tone: "attention" });
    }
  }

  if (!target) return null;
  const result = scan.result;
  const scanning = scan.status === "scanning";
  const progress = scan.progress;
  const progressText = !progress
    ? copy.progress.walk
    : progress.phase === "hash"
      ? copy.progress.hash(progress.bytesTotal ? Math.min(99, Math.floor((progress.bytesDone / progress.bytesTotal) * 100)) : 0)
      : copy.progress[progress.phase] || copy.progress.walk;
  const dialogOpen = flow.phase !== "idle";
  const busyFlow = flow.phase === "astral" || flow.phase === "moving";
  const verify = result?.verify;
  /* Пока идёт перенос, окно не закрыть; ожидание очереди «Загрузок» — можно (очередь идёт и без окна). */
  const closeDialog = () => {
    if (flow.phase === "moving") return;
    setFlow({ phase: "idle", outcome: null, error: "" });
  };

  return (
    <section className="settings-group" data-setting="stock-reset">
      <span className="settings-group-title" data-audit-ignore="caps">{copy.title}</span>
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-copy">
            <b>{copy.title}</b>
            <small>{copy.intro}</small>
            <span className="settings-row-copy" role="status" aria-live="polite">
              {scanning ? (
                <small className="settings-restore-line">
                  <CircleNotch className="game-location-spinner" />
                  {progressText}
                </small>
              ) : scan.error ? (
                <small data-tone="attention">{scan.error}</small>
              ) : (
                <ScanLine result={result} copy={copy} />
              )}
            </span>
          </span>
          <span className="settings-row-control">
            {result && hasWork(result) && !scanning && (
              <Button size="sm" variant="danger" icon={<ShieldCheck />} onClick={() => setFlow({ phase: "confirm", outcome: null, error: "" })}>
                {copy.reset}
              </Button>
            )}
            <Button
              size="sm"
              icon={scanning ? <CircleNotch className="game-location-spinner" /> : <MagnifyingGlass />}
              disabled={scanning || busyFlow || !available}
              onClick={() => runScan(result?.mode || "quick")}
            >
              {result ? copy.rescan : copy.scan}
            </Button>
          </span>
        </div>
        {result && !scanning && result.mode === "quick" && (
          <div className="settings-row" data-setting="stock-full">
            <span className="settings-row-copy">
              <b>{copy.full}</b>
              <small>{copy.fullHint}</small>
            </span>
            <Button size="sm" disabled={busyFlow} onClick={() => runScan("full")}>
              {copy.full}
            </Button>
          </div>
        )}
        {(quarantine.files > 0 || restoreState.text) && (
          <div className="settings-row" data-setting="stock-quarantine">
            <span className="settings-row-copy">
              <b>{copy.restore}</b>
              <small data-tone={restoreState.tone} role="status">
                {restoreState.text || copy.quarantine(quarantine.files, quarantine.bytes)}
              </small>
            </span>
            {quarantine.files > 0 && (
              <Button
                size="sm"
                icon={restoreState.status === "running" ? <CircleNotch className="game-location-spinner" /> : <ArrowUUpLeft />}
                disabled={restoreState.status === "running" || busyFlow || scanning}
                onClick={bringBack}
              >
                {copy.restore}
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        role="alertdialog"
        title={flow.phase === "result" ? copy.resultTitle : copy.dialogTitle}
        titleId="stock-reset-title"
        className="stock-reset-dialog"
        closeLabel={copy.close}
        dismissible={flow.phase !== "moving"}
        showClose={flow.phase !== "moving"}
        actions={
          flow.phase === "confirm" ? (
            <>
              <Button onClick={closeDialog} autoFocus>
                {copy.cancel}
              </Button>
              <Button variant="danger" icon={<ShieldCheck />} onClick={confirm}>
                {copy.confirm}
              </Button>
            </>
          ) : flow.phase === "result" ? (
            <>
              {flow.outcome?.verify?.kind === "url" && flow.outcome.verify.needed && (
                <Button onClick={reopenVerify}>{copy.openVerify}</Button>
              )}
              <Button
                variant="primary"
                onClick={() => {
                  closeDialog();
                  void runScan(result?.mode || "quick");
                }}
              >
                {copy.rescan}
              </Button>
            </>
          ) : flow.phase === "astral" ? (
            <Button onClick={() => onOpenDownloads?.()}>{copy.openDownloads}</Button>
          ) : null
        }
      >
        {flow.phase === "confirm" && result && (
          <div className="stock-reset-body">
            {result.astral?.mods > 0 && <p className="stock-reset-step">{copy.stepAstral(result.astral.mods)}</p>}
            {result.extras.length > 0 && (
              <>
                <p className="stock-reset-step">
                  {copy.stepMove}
                  <small>{copy.keepHint}</small>
                </p>
                <div className="stock-reset-choices">
                  {result.extras.map((unit) => (
                    <Checkbox
                      key={unit.path}
                      label={unit.path}
                      hint={`${copy.kinds[unit.kind] || copy.kinds.other} · ${formatBytes(unit.bytes, language)}`}
                      checked={!skip.has(unit.path)}
                      onChange={(on) =>
                        setSkip((current) => {
                          const next = new Set(current);
                          if (on) next.delete(unit.path);
                          else next.add(unit.path);
                          return next;
                        })
                      }
                    />
                  ))}
                  {result.totals.extraUnits > result.extras.length && (
                    <small>{copy.more(result.totals.extraUnits - result.extras.length)}</small>
                  )}
                </div>
              </>
            )}
            {verify?.needed ? (
              <>
                <p className="stock-reset-step">
                  {copy.stepVerify[verify.steps] || copy.stepVerify.rockstar}
                  {copy.manual[verify.steps] && <small>{copy.manual[verify.steps]}</small>}
                </p>
                {result.modified.length > 0 && <p className="stock-reset-step">{copy.modifiedList}</p>}
                <PathList items={result.modified} total={result.totals.modified} copy={copy} />
                {result.missing.length > 0 && <p className="stock-reset-step">{copy.missingList}</p>}
                <PathList items={result.missing} total={result.totals.missing} copy={copy} />
              </>
            ) : (
              <p className="stock-reset-step">{copy.noVerify}</p>
            )}
          </div>
        )}
        {busyFlow && (
          <p className="stock-reset-step settings-restore-line" role="status" aria-live="polite">
            <CircleNotch className="game-location-spinner" />
            {flow.phase === "astral" ? copy.running.astral : copy.running.moving}
          </p>
        )}
        {flow.phase === "result" && <StockResetOutcome flow={flow} result={result} copy={copy} />}
      </Dialog>
    </section>
  );
}

function StockResetOutcome({ flow, result, copy }) {
  if (flow.error)
    return (
      <p className="stock-reset-step settings-restore-line" data-tone="attention" role="alert">
        <Warning weight="fill" />
        {flow.error}
      </p>
    );
  const outcome = flow.outcome || {};
  const verify = outcome.verify || {};
  const remaining = result?.totals?.modified || 0;
  return (
    <div className="stock-reset-body" role="status">
      <p className="stock-reset-step settings-restore-line" data-tone="positive">
        <Check weight="bold" />
        {outcome.moved ? copy.moved(outcome.movedFiles || outcome.moved, outcome.movedBytes || 0) : copy.nothingMoved}
      </p>
      {outcome.failed?.length > 0 && (
        <p className="stock-reset-step" data-tone="attention">
          {copy.failedMoves(outcome.failed.length)}
        </p>
      )}
      {verify.needed && verify.kind !== "none" && (
        <p className="stock-reset-step">
          {verify.kind === "url"
            ? verify.opened
              ? copy.verifyOpened(verify.store)
              : copy.verifyNotOpened(verify.store)
            : copy.verifyManual(verify.store)}
          {copy.manual[verify.steps] && <small>{copy.manual[verify.steps]}</small>}
        </p>
      )}
      {verify.kind === "none" && verify.needed && <p className="stock-reset-step">{copy.stepVerify.copy}</p>}
      {remaining > 0 && <p className="stock-reset-step">{copy.stillModified(remaining)}</p>}
      {!verify.needed && !result?.totals?.extraUnits && <p className="stock-reset-step" data-tone="positive">{copy.clean}</p>}
    </div>
  );
}
