/*
 * Штатные метки игры поверх своего прицела — для превью.
 *
 * Сборка меняет только сетку. Отметки попадания и кратности остаются
 * клипами игры рядом с ней, и превью обязано их показать, иначе «точно как в
 * игре» — неправда: у снайперки под своим крестом в игре стоит белая
 * галочка, у хевика — зелёные дуги вокруг центра. Их можно убрать
 * (`hitMarker`, `zoomMarker`) — тогда их нет и здесь.
 */

import {
  arcBand,
  chevronStroke,
  rectangle,
  segment,
  snapShape,
} from "./geometry.js";
import { RETICLE_STOCK } from "./stage.js";

/* Отметка попадания обычного прицела: четыре косые чёрточки. */
function hitX() {
  const { from, to, width } = RETICLE_STOCK.hitX;
  const step = Math.SQRT1_2;
  return [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ].map(([sx, sy]) =>
    snapShape(
      segment(
        [sx * from * step, sy * from * step],
        [sx * to * step, sy * to * step],
        width / 2,
      ),
    ),
  );
}

function heavyRing() {
  const { inner, outer, halfSpan } = RETICLE_STOCK.heavyRing;
  return [
    arcBand(0, 0, inner, outer, -halfSpan, halfSpan),
    arcBand(0, 0, inner, outer, 180 - halfSpan, 180 + halfSpan),
  ].map((shape) => snapShape(shape));
}

function sniperChevron() {
  const { apex, halfWidth, height, thickness } = RETICLE_STOCK.sniperChevron;
  return chevronStroke(
    apex,
    [-halfWidth, apex[1] + height],
    [halfWidth, apex[1] + height],
    thickness / 2,
  ).map((shape) => snapShape(shape));
}

function zoomMarker(scope) {
  const { width } = RETICLE_STOCK.zoomMarker;
  const { x, y, length } =
    RETICLE_STOCK.zoomMarker[scope === "heavy" ? "heavy" : "sniper"];
  return [snapShape(rectangle(x - width / 2, y, x + width / 2, y + length))];
}

/**
 * Метки игры для превью: `[{id, shapes, colour}]`.
 *
 * @param {"ordinary"|"sniper"} kind прицел
 * @param {{scope?: "heavy"|"sniper", hit?: boolean, hitMarker?: boolean,
 *   zoomMarker?: boolean}} options какая оптика, момент попадания и что
 *   человек оставил
 */
export function stockReticleOverlays(kind, options = {}) {
  const { scope = "heavy", hit = false } = options;
  const overlays = [];
  if (kind === "ordinary") {
    if (options.hitMarker !== false && hit)
      overlays.push({
        id: "hit",
        shapes: hitX(),
        colour: RETICLE_STOCK.hitX.hit,
      });
    return overlays;
  }
  if (options.hitMarker !== false) {
    const stock =
      scope === "heavy" ? RETICLE_STOCK.heavyRing : RETICLE_STOCK.sniperChevron;
    overlays.push({
      id: "hit",
      shapes: scope === "heavy" ? heavyRing() : sniperChevron(),
      colour: hit ? stock.hit : stock.colour,
    });
  }
  if (options.zoomMarker !== false)
    overlays.push({
      id: "zoom",
      shapes: zoomMarker(scope),
      colour: RETICLE_STOCK.zoomMarker.colour,
    });
  return overlays;
}
