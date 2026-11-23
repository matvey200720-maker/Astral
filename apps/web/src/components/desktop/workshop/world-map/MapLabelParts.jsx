import { CaretLeft, CaretRight, Check, TextAa } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { counted } from "../../../../plural.js";
import { mapText, setTitle, trForms } from "./map-copy.js";

/*
 * Плитка набора подписей и переключатель страниц — общие у окна «Подписи
 * локаций» (`MapLabelsPicker.jsx`) и у полки в самой колонке «Подписи»
 * (`MapLabelShelf.jsx`, задача 12 ТЗ 18.10.2026): там и там одни и те же наборы с
 * образцом на карте человека.
 */

/* Подсказка плитки: «395 подписей: описание» на языке окна. */
export const cardHint = (card) =>
  card.count && card.note
    ? mapText("{count}: {note}", { count: counted(card.count, trForms(["подпись", "подписи", "подписей"])), note: tr(card.note) })
    : tr(card.hint);

/**
 * Плитка: образец (`preview`), имя, а у `withCount` — ещё и число подписей;
 * `selected` — выбрана (рамка), `applied` — стоит на карте (галочка).
 */
export function LabelCard({ card, preview = null, selected = false, applied = false, withCount = false, tabIndex = 0, onClick, onDoubleClick = undefined }) {
  useTr();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      className={`ui-choice wmc-set-card${selected ? " is-selected" : ""}`}
      title={cardHint(card)}
      data-set={card.id}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className="ui-choice-media wmc-set-media">
        {preview}
        {card.kind === "none" && (
          <i className="wmc-set-none" aria-hidden="true">
            <TextAa />
          </i>
        )}
        {applied && (
          <i className="ui-choice-mark" aria-hidden="true">
            <Check weight="bold" />
          </i>
        )}
      </span>
      <span className="ui-choice-copy">
        {/* Название карты-мода — имя собственное, как написал автор (ALLEGRI, DINERO). */}
        <b data-audit-ignore="caps">{setTitle(card.label || card.title)}</b>
        {withCount && card.count ? <small>{counted(card.count, trForms(["подпись", "подписи", "подписей"]))}</small> : null}
      </span>
    </button>
  );
}

/** Страницы под сеткой: «‹ 2 / 4 ›»; `children` — что стоит справа (кнопка «Крупно»). */
export function LabelPager({ page, pages, onPage, children = null }) {
  useTr();
  if (pages <= 1 && !children) return null;
  return (
    <nav className="wmc-pager" aria-label={tr("Страницы наборов")}>
      {pages > 1 && (
        <>
          <Button size="sm" variant="ghost" icon={<CaretLeft aria-hidden="true" />} ariaLabel={tr("Предыдущая страница")} disabled={page === 0} onClick={() => onPage(page - 1)} />
          <span className="wml-page" aria-live="polite">
            {page + 1} / {pages}
          </span>
          <Button size="sm" variant="ghost" icon={<CaretRight aria-hidden="true" />} ariaLabel={tr("Следующая страница")} disabled={page === pages - 1} onClick={() => onPage(page + 1)} />
        </>
      )}
      {children}
    </nav>
  );
}
