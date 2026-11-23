import { Warning } from "../../../../ui/icons.jsx";
import useTabListKeys from "../../../../ui/useTabListKeys.js";
import { modPicture } from "../../../../../features/library/mod-picture.js";
import { tr, useTr } from "../../../../../locales/ui.js";

/*
 * «Вид из каталога» у обвеса (ТЗ 23.10.2026, п. C, часть 2): под плитками обвесов открытого места — плитки модов
 * каталога, что несут модель этого обвеса, и «Как в игре». Картинки — обложки модов; они ленивые, и мод скачивается,
 * только когда его выбрали (`attachment-looks.js`). Плитки — те же, что у обвесов (`gun-attach-option`).
 */

/** Плитка: обложка мода (или пустая заглушка), подпись. */
function LookTile({ look, selected, disabled, onPick }) {
  const picture = look ? modPicture(look.item) : "";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      className={`gun-attach-option${selected ? " is-selected" : ""}${look ? "" : " is-none"}`}
      onClick={onPick}
    >
      <span
        className={`gun-attach-icon gun-attach-option-art${picture ? " is-ready is-photo" : ""}${look ? "" : " is-none"}`}
        aria-hidden="true"
      >
        {picture && <img src={picture} alt="" loading="lazy" decoding="async" draggable={false} />}
      </span>
      <span className="gun-attach-option-name">{look ? look.name : tr("Как в игре")}</span>
    </button>
  );
}

/**
 * `options` — `[{ id, name, item }]` (`looksOfComponent`), `value` — выбранный мод или пусто, `stale` — выбранный мод
 * исчез из каталога, `onChange(id)` — `""` возвращает модель игры.
 */
export default function AttachmentLooks({ options, value, stale = false, disabled = false, onChange }) {
  useTr();
  const items = [{ value: "" }, ...options.map((option) => ({ value: option.id }))];
  const shown = stale ? "" : value;
  const { listRef, onKeyDown } = useTabListKeys({
    options: items,
    value: shown,
    onChange,
    enabled: !disabled,
    orientation: "both",
    itemSelector: '[role="radio"]',
  });
  return (
    <div className="gun-attach-looks">
      <div className="gun-attach-looks-head">
        <strong>{tr("Вид из каталога")}</strong>
        <span className="gun-hint">{tr("Модель обвеса — из выбранного мода. Скачивается только он.")}</span>
      </div>
      <div
        ref={listRef}
        className="gun-attach-options"
        role="radiogroup"
        aria-label={tr("Вид из каталога")}
        onKeyDown={onKeyDown}
      >
        <LookTile selected={!shown} disabled={disabled} onPick={() => onChange("")} />
        {options.map((look) => (
          <LookTile
            key={look.id}
            look={look}
            selected={look.id === shown}
            disabled={disabled}
            onPick={() => onChange(look.id)}
          />
        ))}
      </div>
      {stale && (
        <p className="gun-attach-warn" role="status">
          <Warning weight="fill" />
          <span>{tr("Выбранного мода больше нет в каталоге — стоит модель из игры.")}</span>
        </p>
      )}
    </div>
  );
}
