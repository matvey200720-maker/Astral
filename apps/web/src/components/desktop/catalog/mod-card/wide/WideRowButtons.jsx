import { useState } from "react";
import {
  ArrowCounterClockwise,
  PencilSimpleLine,
  Pause,
  Play,
} from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import { tr } from "../../../../../locales/ui.js";
import { humanFailure } from "../../../../../utils/installFailure.js";

/*
 * Кнопки в строке компонента карточки «Пульт» (чистовой набор 2, 15.11.2026): карандаш с подсказкой «что откроется» и ▶ «послушать». Подсказка — не окно, а плашка у кнопки
 * (`xw-tip`): название действия жирно и строка «куда это ведёт» под ним; показывается под курсором и при фокусе с клавиатуры, читается экранным чтением как описание кнопки.
 */

/** Карандаш. `tip` — `[название, пояснение]`; `onClick` может вернуть обещание: пока оно не кончилось, кнопка занята, отказ — слова под курсором. */
export function RowPen({ tip, onClick, label = "" }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const run = async (event) => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      await onClick(event);
    } catch (error) {
      setFailure(humanFailure(error) || String(error?.message || ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="xw-pen">
      <button
        type="button"
        className={`xw-pen-button${failure ? " is-failed" : ""}`}
        aria-label={label || tip[0]}
        aria-describedby={undefined}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={run}
      >
        <PencilSimpleLine aria-hidden="true" />
      </button>
      <span className="xw-tip" role="tooltip">
        <b>{failure || tip[0]}</b>
        {!failure && tip[1] && <small>{tip[1]}</small>}
      </span>
    </span>
  );
}

/** «Вернуть родную часть» у части, заменённой чужой. */
export function RowRestore({ label, onClick }) {
  return (
    <button
      type="button"
      className="xw-pen-button is-restore"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
    >
      <ArrowCounterClockwise aria-hidden="true" />
    </button>
  );
}

/** ▶ послушать: круглая кнопка в строке звука. */
export function RowPlay({ on, label, onToggle }) {
  const Glyph = on ? Pause : Play;
  return (
    <button
      type="button"
      className={`xw-row-play${on ? " is-on" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Glyph weight="fill" aria-hidden="true" />
    </button>
  );
}

/** «Изменить» словами (панель «Состав», макет 21.11.2026, слово владельца 22.11.2026: не «В студию»): открыть эту часть в её редакторе — у ствола студия оружия на этом стволе, у звука студия звука; `onClick` может вернуть обещание — пока оно не кончилось, кнопка занята, отказ — словами под рукой. */
export function RowStudio({ onClick, label = "", tip = "" }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const run = async (event) => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      await onClick(event);
    } catch (error) {
      setFailure(humanFailure(error) || String(error?.message || ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="xw-comp-btn"
        title={failure || tip || undefined}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={run}
      >
        {label || tr("Изменить")}
      </Button>
      {failure && (
        <small className="xw-comp-failure" role="alert">
          {failure}
        </small>
      )}
    </>
  );
}
