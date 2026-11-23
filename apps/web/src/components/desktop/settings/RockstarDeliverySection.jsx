import { useEffect, useRef, useState } from "react";
import { Copy, Link } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import ChoiceRadioGroup from "../../ui/ChoiceRadioGroup.jsx";
import {
  chooseRockstarCopyFolder,
  createRockstarCopy,
  deleteRockstarCopy,
  onRockstarCopyProgress,
  syncRockstarCopy,
} from "../../../api.js";
import { copyText } from "../../../clipboard.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { formatBytes } from "./format-bytes.js";
import { middlePath } from "./middle-path.js";
import { rockstarDeliveryCopyFor } from "./rockstar-delivery-copy.js";
import { modeFailureText } from "./rockstar-mode-copy.js";

/*
 * «Другой способ: вторая папка игры» (задача 7, с 14.11.2026 — внутри вкладки
 * «Rockstar Games», свёрнут) — для копии из Rockstar Games Launcher.
 *
 * Лаунчер Rockstar проверяет только саму папку игры. Вторая папка (из жёстких
 * ссылок на оригинал или полная копия) ему не видна, поэтому моды в ней не
 * сбрасываются. Плитки способов — как выбор вида у трейсеров, под выбранной —
 * что делает, сколько места, какие минусы и действие. Подмена при запуске и
 * «прямо в папку» отсюда ушли: «подмену» заменил тумблер режима в шапке вкладки.
 *
 * У самой второй папки (`target.linkedCopy`) — свой короткий вид: откуда она,
 * путь для лаунчера сервера, «Обновить» и «Удалить».
 *
 * Состояние (`status`) приходит от вкладки: она спрашивает его раз в три
 * секунды, пока режим включён, и слушает события главного процесса.
 */

const ICONS = { linked: <Link />, copy: <Copy /> };
const ORDER = ["linked", "copy"];

export default function RockstarDeliverySection({
  target,
  language,
  status,
  onRefresh,
  onSelectGame,
  onRefreshGames,
  expand = false,
}) {
  const text = rockstarDeliveryCopyFor(language);
  const [viewed, setViewed] = useState("linked");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(null);
  const [folders, setFolders] = useState({});
  const [armedDelete, setArmedDelete] = useState("");
  const targetId = target?.id || "";
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const stopProgress = onRockstarCopyProgress((step) => {
      if (alive.current && step?.targetId === targetId) setProgress(step);
    });
    return () => {
      alive.current = false;
      stopProgress();
    };
  }, [targetId]);

  const refresh = async () => {
    await onRefresh?.();
  };

  const run = async (key, task) => {
    setBusy(key);
    setError("");
    try {
      await task();
    } catch (failure) {
      setError(
        modeFailureText(failure, language) || humanFailure(failure, language),
      );
    } finally {
      if (alive.current) setBusy("");
      setProgress(null);
    }
  };

  const desktop = Boolean(status);
  /* Режим Rockstar включён: вторая папка ему не нужна, а сборка отказала бы (`ROCKSTAR_MODE_BLOCKS_COPY`). Удалить уже собранную можно. */
  const modeOn = status?.mode === "swap";
  const sizeOf = (mode) =>
    formatBytes(
      status?.plans?.[mode]?.copyBytes ||
        (mode === "copy" ? 120 * 1024 ** 3 : 3 * 1024 ** 3),
      language,
    );

  /* Вторая папка игры: откуда она и что с ней можно сделать. */
  if (target?.linkedCopy) {
    const copyPath = async () => {
      if (await copyText(target.path)) setNote(text.copied);
    };
    return (
      <section className="settings-group" data-setting="rockstar-delivery">
        <span className="settings-group-title" data-audit-ignore="caps">
          {text.copyTitle}
        </span>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-copy">
              <small>
                {text.copyIntro(middlePath(target.linkedCopy.source, 60))}
              </small>
              {note && (
                <small data-tone="positive" role="status">
                  {note}
                </small>
              )}
              {error && (
                <small data-tone="attention" role="alert">
                  {error}
                </small>
              )}
            </span>
            <span className="settings-row-control">
              <Button size="sm" onClick={copyPath}>
                {text.copyPath}
              </Button>
              <Button
                size="sm"
                disabled={Boolean(busy)}
                onClick={() =>
                  run("sync", () =>
                    syncRockstarCopy({ path: target.path }).then(() =>
                      setNote(text.copyFresh),
                    ),
                  )
                }
              >
                {busy === "sync" ? text.copySyncing : text.copySync}
              </Button>
            </span>
          </div>
        </div>
      </section>
    );
  }

  const options = ORDER.map((id) => ({
    value: id,
    media: ICONS[id],
    title: text.methods[id].title,
    description: text.methods[id].short,
    meta:
      id === "linked" && desktop && status?.copies?.length
        ? text.current
        : null,
  }));
  const method = text.methods[viewed];
  const planKey = viewed === "copy" ? "copy" : "link";
  const space =
    typeof method.space === "function"
      ? method.space(sizeOf(planKey))
      : method.space;
  const plan = status?.plans?.[planKey] || null;
  const chosen = folders[viewed] || plan?.destination || "";
  const problems = folders[viewed] ? [] : plan?.problems || [];

  const build = (mode) =>
    run(`build-${mode}`, async () => {
      const made = await createRockstarCopy({
        targetId,
        mode: mode === "copy" ? "copy" : "link",
        destination: folders[mode] || "",
      });
      setNote(text.built);
      await onRefreshGames?.(targetId);
      await refresh();
      return made;
    });

  const pickFolder = async (mode) => {
    const folder = await chooseRockstarCopyFolder();
    if (folder) setFolders((current) => ({ ...current, [mode]: folder }));
  };

  return (
    <details
      className="settings-delivery-other settings-rockstar-folder"
      data-setting="second-folder"
      open={expand || undefined}
    >
      <summary>{text.title}</summary>
      <div className="settings-row">
        <span className="settings-row-copy">
          <small>{text.intro}</small>
        </span>
      </div>
      <div className="settings-delivery-methods settings-rockstar-methods">
        <ChoiceRadioGroup
          label={text.methodsLabel}
          value={viewed}
          options={options}
          onChange={(mode) => !busy && setViewed(mode)}
          disabled={Boolean(busy)}
        />
      </div>
      <div className="settings-delivery-details" data-method={viewed}>
        {[
          ["what", method.what],
          ["space", space],
          ["cons", method.cons],
        ].map(([key, value]) => (
          <div className="settings-row" key={key}>
            <span className="settings-row-copy">
              <b>{text.rows[key]}</b>
              <small>{value}</small>
            </span>
          </div>
        ))}
        <div className="settings-row" data-setting="delivery-action">
          <span className="settings-row-copy">
            {chosen && <small>{text.folder(middlePath(chosen, 56))}</small>}
            {problems.map((code) => (
              <small data-tone="attention" key={code}>
                {text.problems[code] || code}
              </small>
            ))}
            {progress && (
              <small role="status">
                {text.building(progress.done, progress.total)}
              </small>
            )}
            {note && <small role="status">{note}</small>}
            {error && (
              <small data-tone="attention" role="alert">
                {error}
              </small>
            )}
            {modeOn && (
              <small data-setting="mode-on-note">{text.modeOnNoCopy}</small>
            )}
            {!desktop && <small>{text.desktopOnly}</small>}
          </span>
          <span className="settings-row-control">
            <Button
              size="sm"
              disabled={!desktop || Boolean(busy) || modeOn}
              onClick={() => pickFolder(viewed)}
            >
              {text.chooseFolder}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={
                !desktop || Boolean(busy) || modeOn || problems.length > 0
              }
              onClick={() => build(viewed)}
            >
              {method.build}
            </Button>
          </span>
        </div>
      </div>
      {status?.copies?.length > 0 && (
        <div className="settings-delivery-copies">
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{text.copies}</b>
            </span>
          </div>
          {status.copies.map((copy) => (
            <div
              className={`settings-row${armedDelete === copy.path ? " is-armed" : ""}`}
              key={copy.path}
            >
              <span className="settings-row-copy">
                <b className="settings-copy-path" title={copy.path}>
                  {middlePath(copy.path, 48)}
                </b>
                <small data-tone={copy.outdated ? "attention" : undefined}>
                  {armedDelete === copy.path
                    ? text.copyDeleteNote
                    : copy.outdated
                      ? text.copyOutdated
                      : text.copyFresh}
                </small>
              </span>
              <span className="settings-row-control">
                {armedDelete === copy.path ? (
                  <>
                    <Button size="sm" onClick={() => setArmedDelete("")}>
                      {text.copyCancel}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        run("delete", async () => {
                          setArmedDelete("");
                          await deleteRockstarCopy({ path: copy.path });
                          await onRefreshGames?.(targetId);
                          await refresh();
                        })
                      }
                    >
                      {text.copyDeleteConfirm}
                    </Button>
                  </>
                ) : (
                  <>
                    {copy.outdated && (
                      <Button
                        size="sm"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          run("sync", async () => {
                            await syncRockstarCopy({ path: copy.path });
                            await refresh();
                          })
                        }
                      >
                        {busy === "sync" ? text.copySyncing : text.copySync}
                      </Button>
                    )}
                    <Button size="sm" onClick={() => onSelectGame?.(copy.id)}>
                      {text.copyMain}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={Boolean(busy)}
                      onClick={() => setArmedDelete(copy.path)}
                    >
                      {text.copyDelete}
                    </Button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="settings-row">
        <span className="settings-row-copy">
          <small>{text.verified}</small>
        </span>
      </div>
      <details className="settings-delivery-other">
        <summary>{text.otherTitle}</summary>
        {text.other.map(([title, why]) => (
          <div className="settings-row" key={title}>
            <span className="settings-row-copy">
              <b>{title}</b>
              <small>{why}</small>
            </span>
          </div>
        ))}
      </details>
    </details>
  );
}
