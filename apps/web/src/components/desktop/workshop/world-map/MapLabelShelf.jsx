import { useEffect, useState } from "react";
import { ArrowsOutSimple } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import SetPreview from "./MapSetPreview.jsx";
import { LabelCard, LabelPager } from "./MapLabelParts.jsx";
import useProgressive from "./useProgressive.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Выбор набора подписей прямо в колонке «Подписи» (задача 12 ТЗ 18.10.2026,
 * слово владельца: «выбор — в панели, без окна»): сетка два столбца на пять рядов —
 * десять наборов на страницу — и страницы под ней. Щелчок по плитке ставит набор на
 * карту (набор один, как и был: выбор заменяет прежний — решает каталог,
 * `onPick`); выбранный правится ниже, в этой же колонке. Окно «Подписи локаций» с
 * большим видом осталось кнопкой «Крупно».
 */

/** Наборов на странице: два столбца на пять рядов. */
export const SHELF_PAGE_SIZE = 10;

const pageOf = (cards, id) => Math.max(0, Math.floor(cards.findIndex((card) => card.id === id) / SHELF_PAGE_SIZE));

/**
 * `cards` — «Без подписей» и наборы каталога, `appliedId` — что стоит на карте
 * (`"none"` — ничего), `onPick(card)` — поставить набор, `onZoom` — открыть окно.
 * Остальное — подложка образцов (`SetPreview`).
 */
export default function LabelShelf({ cards, appliedId, config, names, atlas, backdrop, baseLayers, ready, onPick, onZoom }) {
  useTr();
  const pages = Math.max(1, Math.ceil(cards.length / SHELF_PAGE_SIZE));
  const [page, setPage] = useState(() => pageOf(cards, appliedId));
  /* Набор выбрали в окне или он стоял в проекте — страница идёт за ним. */
  useEffect(() => setPage(pageOf(cards, appliedId)), [appliedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const safePage = Math.min(page, pages - 1);
  const shown = cards.slice(safePage * SHELF_PAGE_SIZE, (safePage + 1) * SHELF_PAGE_SIZE);
  /* Образцы появляются по одному: страница открывается сразу, а набор с сотнями подписей не замораживает окно. */
  const ready_ = useProgressive(shown.length);
  return (
    <>
      <div className="wmc-set-grid wmc-label-shelf" role="radiogroup" aria-label={tr("Набор подписей на карте")} data-page={safePage + 1}>
        {shown.map((card, index) => (
          <LabelCard
            key={card.id}
            card={card}
            withCount
            selected={card.id === appliedId}
            applied={card.id === appliedId}
            preview={index < ready_ ? <SetPreview baseLayers={baseLayers} config={config} card={card} names={names} atlas={atlas} backdrop={backdrop} ready={ready} /> : null}
            onClick={() => (card.id === appliedId ? undefined : onPick(card))}
          />
        ))}
      </div>
      <LabelPager page={safePage} pages={pages} onPage={setPage}>
        <Button size="sm" variant="ghost" icon={<ArrowsOutSimple aria-hidden="true" />} aria-haspopup="dialog" title={tr("Открыть подписи крупно")} onClick={onZoom}>
          {tr("Крупно")}
        </Button>
      </LabelPager>
    </>
  );
}
