/*
 * «Студия» у щитов (ТЗ 18.10.2026, Session 1, задача 6): холст — лицо щита в
 * его пропорции (2048 по длинной стороне), основа — реклама игры на этом
 * щите, как она сейчас лежит на листе GTA V игрока (`stockPicture`); без
 * Astral Desktop листа игры нет — основа ровного тона. Итог встаёт «своей
 * картинкой» щита — тем же путём, что загруженный файл. Рисунок поверх облика
 * («Рисунок») остаётся отдельным инструментом редактора.
 */

import { billboardAspect, billboardLookOf, billboardRecommendedPixels, linkedBillboards, normalizeBillboardLook } from "@modovik/climb-contract/recolor/billboards";
import { finishView3d } from "../texture-studio/StudioLive.jsx";
import { stockPicture } from "./billboards-art.js";
import { tr } from "../../../locales/ui.js";

const LONGEST = 2048;
const BOARD_COLOUR = "#2a2c30";

/* Холст щита по пропорции: 2048 по длинной стороне. */
function canvasOf(aspect) {
  const ratio = aspect > 0 ? aspect : 1.5;
  return ratio >= 1 ? { width: LONGEST, height: Math.max(16, Math.round(LONGEST / ratio)) } : { width: Math.max(16, Math.round(LONGEST * ratio)), height: LONGEST };
}

/* Живая картинка студии вместо облика щита (и тех, что делят с ним лист): своя картинка «растянуть» на всё полотно. */
const liveImage = (asset, { width, height }) => ({ asset, name: "", width, height });

/** Работа, где у щита `id` (и связанных с ним) стоит живая картинка студии. */
function withBoardLive(project, id, asset, size) {
  const own = { ...normalizeBillboardLook(billboardLookOf(project, id)), mode: "image", fit: "stretch", image: liveImage(asset, size), own: true };
  const boards = { ...project.boards };
  for (const member of linkedBillboards(id)) boards[member] = own;
  return { ...project, boards };
}

/**
 * Холст щита `board` (`billboard(id)`): основа — его реклама из игры; `live` —
 * кадр редактора (`useStudioLive`): окно студии рисует то же место с этой
 * картинкой на щите (кадр собирает листы рекламы из картинки хранилища).
 */
export function billboardStudioSurface(board, { live = null } = {}) {
  const pixels = billboardRecommendedPixels(board);
  const size = canvasOf(pixels[0] / Math.max(1, pixels[1]) || billboardAspect(board));
  return {
    id: `billboards:${board.id}`,
    view3d: finishView3d(live, { id: `billboards:${board.id}`, patch: (project, asset, box) => withBoardLive(project, board.id, asset, box), ...size, kind: "hangar-emblem", reloads: true }),
    slug: `billboard-${board.id}`,
    title: `${tr("Щиты")} · ${board.label}`,
    ...size,
    /* Реклама игры с листа игрока (не крупнее 1024 px — лист и так меньше); без листа — основа ровного тона. */
    base: async () => {
      const width = Math.min(size.width, 1024);
      const height = Math.max(1, Math.round((width * size.height) / size.width));
      const stock = await stockPicture(board, width, height, 100);
      return stock?.real ? createImageBitmap(new ImageData(stock.rgba, width, height)) : null;
    },
    baseColour: BOARD_COLOUR,
    placeLabel: "Поставить на щит",
  };
}

/** Холст «Всех щитов»: общая пропорция щитов 1024 × 448, основа ровного тона (общей рекламы нет). */
export function billboardsAllSurface({ live = null } = {}) {
  const size = canvasOf(1024 / 448);
  return {
    id: "billboards:all",
    view3d: finishView3d(live, {
      id: "billboards:all",
      patch: (project, asset, box) => ({ ...project, all: { ...normalizeBillboardLook(project.all), mode: "image", fit: "stretch", image: liveImage(asset, box) } }),
      ...size,
      kind: "hangar-emblem",
      reloads: true,
    }),
    slug: "billboards-all",
    title: `${tr("Щиты")} · ${tr("Все щиты")}`,
    ...canvasOf(1024 / 448),
    baseColour: BOARD_COLOUR,
    placeLabel: "Поставить на щиты",
  };
}
