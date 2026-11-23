import { useCallback, useMemo } from "react";
import {
  BILLBOARD_IDS,
  billboard,
  billboardIsShield,
  billboardLookIsStock,
  billboardLookOf,
  changedBillboards,
  createBillboardsProject,
  normalizeBillboardsProject,
} from "@modovik/climb-contract/recolor/billboards";
import { desktopHost } from "../../../api.js";
import {
  composeSheet,
  sheetLookKey,
} from "../billboards-editor/billboards-art.js";
import { sceneUrlOf } from "../billboards-editor/billboards-text.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Билбордов» (задача 3 ТЗ 11.10.2026, утро: «поставь модельку, как
 * в Ашан / Икея») — настоящий щит в облике работы: 3D-снимок той же сцены,
 * что в кадре редактора (модель щита и каркас из описи игры), на полотне —
 * лист рекламы той же функцией, что у установщика (`composeSheet`): своя
 * картинка, цвет или градиент работы. Снимок — общим невидимым кадром и из
 * хранилища обложек, как у зданий (`SceneThumb`).
 *
 * Листы — из игры игрока (Astral Desktop): пока работы нет, на щите реклама
 * вашей игры, «как в игре». В браузере без приложения листа игры нет —
 * полотно и каркас средним цветом листа: листов Rockstar в поставке нет.
 */

/* Щит витрины: отдельно стоящий щит у дороги на опорах (Аламо-Си) — его
   видно целиком, а не кусок фасада. На нём — облик всех щитов работы. */
export const BILLBOARD_COVER_SHOWCASE = "cs4_11_billb_uniteas_2343_3854";

/**
 * Щит обложки — всегда щит витрины на опорах (ТЗ 41-А, 20.10.2026: «верни
 * обычный билборд»). Прежде при правке одного щита обложка брала его самого, и
 * им мог оказаться кусок здания с крыши — «странное здание с синим».
 */
export const billboardCoverBoard = () =>
  BILLBOARD_IDS.includes(BILLBOARD_COVER_SHOWCASE)
    ? BILLBOARD_COVER_SHOWCASE
    : BILLBOARD_IDS[0];

/**
 * Работа в облике щита витрины: облик всех щитов — как есть; свой облик только
 * у части щитов — на витрине облик первого из них (сам щит остаётся обычным).
 */
export function billboardCoverProject(input) {
  const project = normalizeBillboardsProject(input);
  const showcase = billboardCoverBoard();
  if (!billboardLookIsStock(project.all)) return project;
  /* Витрина — щит: свой облик полотна здания (баннера) на ней не показывается. */
  const first = changedBillboards(project).find((id) => billboardIsShield(billboard(id)));
  if (!first || first === showcase) return project;
  return {
    ...project,
    boards: {
      ...project.boards,
      [showcase]: { ...billboardLookOf(project, first), own: true },
    },
  };
}

/** Листы рекламы щита (вблизи). */
export const billboardCoverSheets = (board) =>
  [...new Set((board?.faces || []).map((face) => face.sheet))].sort();

/* Версия рамки снимка: поменялась рамка — старые снимки из хранилища не находятся. */
const COVER_FRAME = 7;

/*
 * Рамка снимка: щит с опорами целиком, спереди-сбоку и чуть снизу — как с
 * дороги. Сцена — в осях щита: начало — середина полотна, щит смотрит на −Y.
 */
function coverFrame(board) {
  return (asset) => {
    const part = asset.parts[board?.scene?.part ?? -1];
    const box = part?.bounds || asset.bounds;
    return {
      bounds: box,
      centre: [0, 0, box.min[2] * 0.35],
      ground: true,
      person: false,
      view: { yaw: -0.34, pitch: 0.12 },
    };
  };
}

const plainLook = (index, info) => ({ colour: info.colour });

export default function BillboardsCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return billboardCoverProject(stored || createBillboardsProject());
  }, [state]);
  const board = billboard(billboardCoverBoard());
  const sheets = useMemo(() => billboardCoverSheets(board), [board]);
  const lookKey = useMemo(
    () =>
      JSON.stringify([
        COVER_FRAME,
        board?.id,
        sheets.map((id) => sheetLookKey(project, id, board?.id)),
      ]),
    [board, sheets, project],
  );
  const frame = useMemo(() => coverFrame(board), [board]);
  const parts = useMemo(
    () => (board?.scene ? [board.scene.part] : null),
    [board],
  );

  /* Листы щита — только когда снимка ещё нет: составлять их дорого (лист игры, своя картинка). */
  const prepare = useCallback(async () => {
    const textures = {};
    let real = true;
    for (const id of sheets) {
      const composed = await composeSheet(id, project, board?.id).catch(
        () => null,
      );
      if (!composed?.texture) continue;
      textures[id] = composed.texture;
      real &&= composed.real;
    }
    return {
      look: (index, info) =>
        info.ad && textures[info.ad]
          ? { colour: "#ffffff", texture: textures[info.ad] }
          : { colour: info.colour },
      /* В окне Astral лист игры не прочитан (игра не подключена) — снимок не
         запоминается: подключат — снимется с листом. В браузере листа игры нет вовсе. */
      cache: real || !desktopHost(),
      release: () =>
        Object.values(textures).forEach((texture) => texture.dispose?.()),
    };
  }, [sheets, project, board]);

  const url = sceneUrlOf(board);
  return (
    <span className="workshop-cover-canvas">
      {url && (
        <SceneThumb
          scene={url}
          look={plainLook}
          lookKey={lookKey}
          frame={frame}
          parts={parts}
          prepare={prepare}
        />
      )}
    </span>
  );
}
