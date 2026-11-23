import {
  OPTIMIZATION_CARDS,
  optimizationCardShotFiles,
} from "@modovik/optimizer/cards.js";
import { WorkshopVisualSlotCard } from "../../WorkshopLibraryComponents.jsx";
import { optimizationShotUrl } from "../workshop/OptimizationShots.jsx";
import { tr } from "../../locales/ui.js";

/*
 * Плитка «Оптимизация» в библиотеке v2 (14.11.2026, владелец): такая же карточка, как остальные, с кадром из игры и подписью «Оптимизация», без пояснений и ползунков.
 * Щелчок открывает раздел оптимизации в мастерской. Кадр — первый из снятых кадров «после» карточек оптимизации; нет ни одного — пустая плитка, нарисованного не ставим.
 * Файл грузится лениво вместе с полкой: кадры оптимизации в основной кусок не попадают.
 */

const firstShot = () => {
  for (const card of OPTIMIZATION_CARDS) {
    const url = optimizationShotUrl(optimizationCardShotFiles(card.id).after);
    if (url) return url;
  }
  return "";
};

/* `selection` — отметка корзины шапки (`librarySelectionFor`): в режиме выделения щелчок отмечает плитку, а не открывает мастерскую. */
export default function LibraryOptimizationTile({ onOpen, selection = null }) {
  const {
    selecting = false,
    selected = false,
    removing = false,
    onToggle,
  } = selection || {};
  return (
    <WorkshopVisualSlotCard
      className="redux-visual-card redux-visual-card-optimization is-installed"
      kind="catalog"
      preview={firstShot()}
      tone="blue"
      title={tr("Оптимизация")}
      selecting={selecting}
      selected={selected}
      removing={removing}
      onClick={onToggle || onOpen}
    />
  );
}
