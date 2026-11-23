import { optimizationCardParts } from "@modovik/optimizer/cards.js";
import Button from "../../../ui/Button.jsx";
import { PickGrid } from "../../../ui/PickTile.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { fillCopy } from "./optimizer-copy.js";
import { optimizationCardView } from "./optimization-view.js";
import { PartTile } from "./OptimizationPartsDialog.jsx";
import "./optimizer-frame.css";

/*
 * Под сценой «Карточек» (дизайн 15.11.2026): слева «Что входит в «Погода»» — части выбранной карточки, каждая включается отдельно и сразу
 * уходит в игру; справа «Как это ставится» — честное время и подсказки. Логика прежняя (`toggle` страницы и `PartTile` окна «Что входит»).
 */

export function OptimizationParts({
  entry,
  locale,
  copy,
  supported,
  onToggle,
  focus = null,
}) {
  useTr();
  const { card, state, pending, failure, partOn } = entry;
  const { title, busy } = optimizationCardView({
    card,
    locale,
    copy,
    state,
    pending,
    failure,
    supported,
  });
  const parts = optimizationCardParts(card);
  const count = parts.filter((part) => partOn(part)).length;
  const locked = !supported || busy;
  const fromMod = (part) =>
    focus?.layers.includes(part.id) ? focus.source || " " : "";
  return (
    <section
      className="opf-card opf-parts"
      aria-label={fillCopy(copy.parts, { title })}
    >
      <header className="opf-card-head">
        <div>
          <h3>{fillCopy(copy.parts, { title })}</h3>
          <span>
            {fillCopy(copy.partsCount, { count, total: parts.length })}
          </span>
        </div>
        <div className="opf-card-buttons">
          <Button
            variant="secondary"
            size="sm"
            disabled={locked || count === parts.length}
            onClick={() => onToggle(card, true, parts)}
          >
            {copy.partsAllOn}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={locked || count === 0}
            onClick={() => onToggle(card, false, parts)}
          >
            {copy.partsAllOff}
          </Button>
        </div>
      </header>
      <PickGrid
        label={fillCopy(copy.parts, { title })}
        className="optimization-parts-grid opf-parts-grid"
      >
        {parts.map((part) => (
          <PartTile
            key={part.id}
            card={card}
            part={part}
            title={title}
            locale={locale}
            copy={copy}
            on={partOn(part)}
            disabled={locked}
            onToggle={onToggle}
            fromMod={fromMod(part)}
          />
        ))}
      </PickGrid>
      <p className="opf-note">{copy.partsHint}</p>
    </section>
  );
}

export function OptimizationHow({ copy }) {
  useTr();
  return (
    <section className="opf-card opf-how" aria-label={tr("Как это ставится")}>
      <h3>{tr("Как это ставится")}</h3>
      <p className="opf-how-lead">{copy.hint}</p>
      <dl className="opf-how-list">
        {copy.guide.map((item) => (
          <div key={Array.isArray(item.keys) ? item.keys.join("+") : item.keys}>
            <dt>
              {Array.isArray(item.keys) ? item.keys.join(" + ") : item.keys}
            </dt>
            <dd>{item.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
