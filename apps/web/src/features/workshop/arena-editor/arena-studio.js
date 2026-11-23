/*
 * «Студия» у арены (ТЗ 18.10.2026, Session 1, задача 6): картинка полотна,
 * экрана, таблички, плаката или баннера рисуется в студии на холсте в
 * пропорции этого места — физического полотна (`panel`, метры из описи) или
 * баннера у арки (`cloth`); «Все сразу» берёт пропорцию первого элемента
 * раздела. Основа — ровный тон: стандартная картинка полотна лежит на листе
 * модели (или клипом у живых плашек), отдельной картинки у неё нет.
 *
 * В игру итог идёт обычным путём картинки раздела (`saveHangarEmblem`, ≤ 2048
 * по длинной стороне).
 */

import { arenaSlotElements } from "@modovik/climb-contract/recolor/arenas";
import { finishView3d } from "../texture-studio/StudioLive.jsx";
import { tr } from "../../../locales/ui.js";

const LONGEST = 2048;
const DEFAULT_ASPECT = 16 / 9;
const BASE_COLOUR = "#2a2c30";

/* Пропорция места: полотно, баннер у арки или привычная 16 : 9. */
function aspectOf(element) {
  const box = element?.panel || element?.cloth;
  const width = Number(box?.width);
  const height = Number(box?.height);
  return width > 0 && height > 0 ? width / height : DEFAULT_ASPECT;
}

/** Холст по пропорции: 2048 по длинной стороне. */
export function arenaCanvasSize(aspect) {
  return aspect >= 1 ? { width: LONGEST, height: Math.max(16, Math.round(LONGEST / aspect)) } : { width: Math.max(16, Math.round(LONGEST * aspect)), height: LONGEST };
}

/**
 * Холст места раздела: `element` — элемент «По одному» (`arenaSlotElements`) или
 * `null` («Все сразу» — по первому элементу раздела); `title` — название раздела;
 * `live` — кадр редактора (`useStudioLive`): окно студии рисует арену с этой
 * картинкой на этом месте (кадр собирает листы из картинки — ключ обновляется с холстом).
 */
export function arenaStudioSurface({ server, id, element = null, title, live = null }) {
  const first = element || arenaSlotElements(server, id)[0] || null;
  const key = element?.key || "all";
  const size = arenaCanvasSize(aspectOf(first));
  const surfaceId = `arena:${server}:${id}:${key}`;
  return {
    id: surfaceId,
    slug: `arena-${server}-${id}-${key}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
    title: `${tr("Арена")} · ${element ? element.label : title}`,
    ...size,
    baseColour: BASE_COLOUR,
    placeLabel: element ? "Поставить на место" : "Поставить на все места",
    view3d: finishView3d(live, {
      id: surfaceId,
      /* Раздел — `<сервер>.<раздел>`, элемент «По одному» — в его `elements`. */
      path: element ? [server, id, "elements", element.key] : [server, id],
      ...size,
      kind: "hangar-emblem",
      reloads: true,
    }),
  };
}
