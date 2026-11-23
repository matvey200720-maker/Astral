import { useEffect, useMemo, useRef, useState } from "react";
import { createProjector } from "@modovik/vector-map";
import { Check } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import SetPreview from "./MapSetPreview.jsx";
import { LabelCard, LabelPager } from "./MapLabelParts.jsx";
import { VIEWS } from "./set-frames.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { setTitle } from "./map-copy.js";

/*
 * Окно «Подписи локаций» (ТЗ владельца 18.10.2026, задача 9): выбор подписей
 * карты окном, как в эталонном редакторе — слева сетка наборов с образцом на
 * карте самого человека, справа тот же набор большой, и три вида: вся карта,
 * город, Форт Занкудо. «Без подписей» — первым.
 *
 * Выбрать можно только один набор: выбор заменяет прежний (`onPick` — решает
 * каталог). Щелчок по карточке показывает набор справа, двойной щелчок, Enter
 * или «Выбрать набор» — ставит его и закрывает окно; стрелки перебирают наборы,
 * Esc закрывает без выбора.
 */

/* Карточек на странице: шесть рядов по две, как у эталона. */
export const PICKER_PAGE_SIZE = 12;

/* Три вида справа. «Город» — кадр карточек (`VIEWS.city`), «Форт Занкудо» — кусок
   карты вокруг базы на северо-западе, по мировым координатам игры. */
const FORT = Object.freeze({ x: -2100, y: 3150, width: 3600, height: 2400 });
const PICKER_VIEWS = Object.freeze([
  Object.freeze({ id: "full", label: "Вся карта" }),
  Object.freeze({ id: "city", label: "Город" }),
  Object.freeze({ id: "fort", label: "Форт Занкудо" }),
]);

/* Рамка вида в долях сцены. */
function viewRect(id, atlas) {
  if (id === "city") return VIEWS.city;
  if (id === "fort") {
    const projector = createProjector(atlas);
    const a = projector.point({ x: FORT.x - FORT.width / 2, y: FORT.y + FORT.height / 2 });
    const b = projector.point({ x: FORT.x + FORT.width / 2, y: FORT.y - FORT.height / 2 });
    return { u: a.x / projector.width, v: a.y / projector.height, width: (b.x - a.x) / projector.width, height: (b.y - a.y) / projector.height };
  }
  return { u: 0, v: 0, width: 1, height: 1 };
}

/**
 * `cards` — карточки каталога («Без подписей» первой), `appliedId` — что стоит на
 * карте (`"none"` — ничего), `onPick(card)` — поставить набор.
 */
export default function MapLabelsPicker({ cards, appliedId, config, names, atlas, backdrop, baseLayers, ready, onPick, onClose }) {
  useTr();
  const [chosenId, setChosenId] = useState(() => (cards.some((card) => card.id === appliedId) ? appliedId : cards[0]?.id));
  const [view, setView] = useState("full");
  const index = Math.max(0, cards.findIndex((card) => card.id === chosenId));
  const chosen = cards[index];
  const pages = Math.max(1, Math.ceil(cards.length / PICKER_PAGE_SIZE));
  const [page, setPage] = useState(() => Math.floor(index / PICKER_PAGE_SIZE));
  const gridRef = useRef(null);

  /* Выбор ушёл за границу страницы — страница идёт за ним. */
  useEffect(() => setPage(Math.floor(index / PICKER_PAGE_SIZE)), [index]);

  const rect = useMemo(() => viewRect(view, atlas), [view, atlas]);
  const shown = cards.slice(page * PICKER_PAGE_SIZE, (page + 1) * PICKER_PAGE_SIZE);
  const applied = chosen?.id === appliedId;
  const step = (delta) => setChosenId(cards[(index + delta + cards.length) % cards.length].id);
  const apply = () => {
    if (!chosen) return;
    if (!applied) onPick(chosen);
    onClose();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
  };

  const pager = pages > 1 && <LabelPager page={page} pages={pages} onPage={setPage} />;

  return (
    <Dialog
      open
      onClose={onClose}
      size="wide"
      className="wml-dialog"
      title={tr("Подписи локаций")}
      description={tr("Выбери, с какой карты взять подписи")}
      aside={
        <>
          <div ref={gridRef} className="wmc-set-grid wml-grid" role="radiogroup" aria-label={tr("Наборы подписей")} onKeyDown={onKeyDown}>
            {shown.map((card) => {
              const isChosen = card.id === chosen?.id;
              return (
                <LabelCard
                  key={card.id}
                  card={card}
                  selected={isChosen}
                  applied={card.id === appliedId}
                  tabIndex={isChosen ? 0 : -1}
                  preview={<SetPreview baseLayers={baseLayers} config={config} card={card} names={names} atlas={atlas} backdrop={backdrop} ready={ready} />}
                  onClick={() => setChosenId(card.id)}
                  onDoubleClick={() => {
                    if (card.id !== appliedId) onPick(card);
                    onClose();
                  }}
                />
              );
            })}
          </div>
          {pager}
        </>
      }
      asideClassName="wml-aside"
      asideLabel={tr("Наборы подписей")}
      actions={
        <Button variant="primary" icon={<Check />} disabled={applied} onClick={apply}>
          {applied ? tr("Набор выбран") : tr("Выбрать набор")}
        </Button>
      }
    >
      <div className="wml-stage">
        <div className="wml-stage-bar">
          <span className="wml-chip">
            {applied && <Check aria-hidden="true" weight="bold" />}
            <b data-audit-ignore="caps">{setTitle(chosen?.label || chosen?.title || "")}</b>
            <small>
              {index + 1} / {cards.length}
            </small>
          </span>
          <SegmentedControl
            label={tr("Где смотреть")}
            size="sm"
            options={PICKER_VIEWS.map((item) => ({ value: item.id, label: tr(item.label) }))}
            value={view}
            onChange={setView}
          />
        </div>
        <div className="wml-map" data-view={view}>
          {chosen && <SetPreview baseLayers={baseLayers} config={config} card={chosen} names={names} atlas={atlas} backdrop={backdrop} ready={ready} rect={rect} whole={view === "full"} live />}
        </div>
      </div>
    </Dialog>
  );
}
