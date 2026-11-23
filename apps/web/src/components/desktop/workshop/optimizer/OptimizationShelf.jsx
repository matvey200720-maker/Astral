import { createElement, Fragment } from "react";
import { readAppliedOptimizer } from "./optimizer-storage.js";
import { fillCopy, optimizerCopyFor } from "./optimizer-copy.js";
import OptimizationCard from "./OptimizationCard.jsx";
import { installedOptimizationLayerIds } from "../../../../features/workshop/optimization-layer-records.js";
import { optimizationCardState, OPTIMIZATION_CARDS } from "@modovik/optimizer/cards.js";

// Полка оптимизации в «Библиотеке»: те же карточки, что в мастерской, но только посмотреть.
// Что стоит в игре — по снимку применённого профиля и по записям слоёв;
// читаем при каждой отрисовке.

const doNothing = () => {};

// Что стоит сейчас: переключатели из применённого профиля, потом слои из записей
// (набор и прежние). Два набора считаются один раз за отрисовку.
function standingNow() {
  const enabled = readAppliedOptimizer()?.profile?.enabled;
  const tweaks = new Set(Array.isArray(enabled) ? enabled : []);
  const layers = new Set(installedOptimizationLayerIds());
  return { tweak: (id) => tweaks.has(id), layer: (id) => layers.has(id) };
}

// Карточка без тумблера: readOnly гасит переключатели и в окне «Что входит».
function cardView([card, state], locale, copy, partOn) {
  return (
    <OptimizationCard
      readOnly
      supported
      key={card.id}
      {...{ card, locale, copy, state, partOn }}
      pending=""
      failure=""
      onToggle={doNothing}
    />
  );
}

export default function OptimizationShelf({ locale = "ru" }) {
  const standing = standingNow();
  // стоит ли отдельная часть карточки: {kind, id}
  const partOn = ({ kind, id }) => (kind === "tweak" ? standing.tweak(id) : standing.layer(id));
  const rows = OPTIMIZATION_CARDS.map((card) => [card, optimizationCardState(card, standing)]);
  const shown = rows.filter(([, state]) => state.count > 0);
  if (shown.length < 1) return null;

  const copy = optimizerCopyFor(locale);
  const wholeCards = rows.reduce((sum, [, state]) => sum + Number(state.on), 0);
  const statusLine = fillCopy(copy.status, { count: wholeCards, total: rows.length });
  const section = createElement(
    "section",
    { className: "optimization-cards", "aria-label": copy.cards },
    shown.map((row) => cardView(row, locale, copy, partOn)),
  );

  return createElement(
    Fragment,
    null,
    createElement("p", { className: "library-optimization-status" }, statusLine),
    section,
  );
}
