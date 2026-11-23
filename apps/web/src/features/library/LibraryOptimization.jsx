import { OPTIMIZER_ROW_ID } from "./optimization-units.js";
import { lazy, Suspense } from "react";
import { installedOptimizationLayers, installedOptimizationSet } from "../workshop/optimization-layer-records.js";
import Checkbox from "../../components/ui/Checkbox.jsx";
import { readAppliedOptimizerSummary } from "./libraryInstalled.js";

// Карточки и кадры «до/после» тянут каталог оптимизатора — полка грузится при первой отрисовке (docs/GAME-OPTIMIZATION.md).
const Shelf = lazy(() => import("../../components/desktop/workshop/optimizer/OptimizationShelf.jsx"));

// Следы оптимизации: применённая настройка, слой или набор слоёв (поправка 07.11.2026).
const traces = [readAppliedOptimizerSummary, (s) => installedOptimizationLayers(s).length, installedOptimizationSet];
export const libraryOptimizationInstalled = (storage = globalThis.localStorage) => traces.some((probe) => probe(storage));

// Атрибуты корня зависят только от описания выбора; undefined React не выводит.
function stateAttrs({ selecting, selected, removing }) {
  const busy = removing ? "true" : undefined;
  return {
    "data-selected": selecting ? String(Boolean(selected)) : undefined,
    "data-library-removing": busy,
    "aria-busy": busy,
  };
}

export default function LibraryOptimization(props) {
  const { copy, removalCopy, selectionFor, locale = "ru" } = props;
  const pick = selectionFor({ id: OPTIMIZER_ROW_ID });
  const title = copy.profile;
  const hint = copy.profileHint;
  const label = pick.selecting && removalCopy.cardToggle.replace("{name}", title);
  const mark = pick.selecting ? (
    <Checkbox
      checked={Boolean(pick.selected)}
      onChange={(on) => pick.onToggle?.(on)}
      ariaLabel={label}
      className="library-row-check"
    />
  ) : null;

  const shelf = (
    <Suspense fallback={null}>
      <Shelf {...{ locale }} />
    </Suspense>
  );

  return (
    <section
      className="library-optimization"
      {...stateAttrs(pick)}
      aria-label={title}
      data-library-section="optimization"
      data-library-item={OPTIMIZER_ROW_ID}
    >
      <header className="library-optimization-head">
        {mark}
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
      </header>
      {shelf}
    </section>
  );
}
