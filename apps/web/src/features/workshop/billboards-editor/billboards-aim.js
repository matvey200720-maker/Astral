/*
 * «Щёлкнул по щиту — правишь его» в кадре «Билбордов» (ТЗ 18.10.2026,
 * Session 2, задача 2). В кадре сцена взятого щита: его лицо с листом рекламы
 * и всё, что рядом, — каркас, соседние лица того же здания. Материал листа
 * рекламы несёт `info.ad` (номер листа описи), а лицо щита — место на этом
 * листе (`faces[].clip`, прямоугольник развёртки): по развёртке в точке
 * попадания видно, чьё это лицо — взятого щита или соседнего.
 *
 * Чистые данные, без React и three: их берут кадр (что подсвечивать при
 * наведении), студия (что открыть) и тест.
 */

import { BILLBOARD_LIST, billboard, linkedBillboards } from "@modovik/climb-contract/recolor/billboards";

/* Запас на край лица: развёртка в точке попадания и край `clip` сходятся не до тысячной. */
const MARGIN = 0.004;
const wrap = (value) => value - Math.floor(value);
const within = (rect, [u, v]) => u >= rect[0] - MARGIN && u <= rect[2] + MARGIN && v >= rect[1] - MARGIN && v <= rect[3] + MARGIN;

/* Лица щитов вблизи по листам: лист → `[{ id, clip }]` (по описи, раз за жизнь окна). */
let facesBySheet = null;
function sheetFaces(sheet) {
  if (!facesBySheet) {
    facesBySheet = new Map();
    for (const board of BILLBOARD_LIST)
      for (const face of board.faces) {
        const list = facesBySheet.get(face.sheet) || [];
        list.push({ id: board.id, clip: face.clip });
        facesBySheet.set(face.sheet, list);
      }
  }
  return facesBySheet.get(sheet) || [];
}

/**
 * Что открыть по щелчку: `{ tool, board, sheet }` — инструмент «Один щит», щит,
 * чьё лицо под курсором, и лист рекламы, либо `null` — править нечего (каркас,
 * неклеймёный кусок листа). Лицо взятого щита (и щитов с той же картинкой,
 * `linkedBillboards`) — всегда взятый щит; иначе — соседний щит, чьё это
 * место на листе.
 */
export function billboardAimTarget(hit, currentId) {
  const sheet = hit?.info?.ad;
  if (!sheet || !Array.isArray(hit.uv)) return null;
  const at = [wrap(hit.uv[0]), wrap(hit.uv[1])];
  const found = sheetFaces(sheet).filter((face) => within(face.clip, at));
  if (!found.length) return null;
  const mine = currentId ? linkedBillboards(currentId) : [];
  const board = found.some((face) => mine.includes(face.id)) ? currentId : found[0].id;
  return { tool: "board", board, sheet };
}

/**
 * Что подсветить: лицо щита `id` на листе рекламы `sheet` (без листа — на
 * первом листе щита) — только место щита на листе, а не весь лист здания.
 */
export function billboardFaceSpec(id, sheet = null) {
  const faces = billboard(id)?.faces || [];
  const target = faces.some((face) => face.sheet === sheet) ? sheet : faces[0]?.sheet;
  if (!target) return null;
  return {
    where: (info) => info.ad === target,
    uvRects: faces.filter((face) => face.sheet === target).map((face) => face.clip),
  };
}
