import { useCallback, useMemo } from "react";
import { bannerPlace, bannerSite, bannerSiteOfBoard } from "@modovik/climb-contract/recolor/banner-sites";
import {
  billboard,
  billboardIsCanvas,
  changedBillboards,
  createBillboardsProject,
  normalizeBillboardsProject,
} from "@modovik/climb-contract/recolor/billboards";
import { desktopHost } from "../../../api.js";
import { composeSheet, sheetLookKey } from "../billboards-editor/billboards-art.js";
import { yawOf } from "../banners-editor/banners-views.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Баннеров на зданиях» (задача 7 ТЗ 18.10.2026) — настоящее здание
 * из игры игрока с большим полотном в облике работы: 3D-снимок той же сцены
 * места, что в кадре редактора (здание и квартал из описи игры), на полотне —
 * лист рекламы той же функцией, что у установщика (`composeSheet`). Работа
 * та же, что у «Билбордов»: своё полотно здания, и оно — на обложке; пока
 * таких нет, витрина — Flow на банке Pacific Standard. Снимок — общим
 * невидимым кадром и из хранилища обложек (`SceneThumb`).
 *
 * Листы — из игры игрока (Astral Desktop): пока работы нет, на полотне
 * реклама вашей игры. В браузере без приложения листа игры нет — полотно и
 * здание средним цветом листа: листов Rockstar в поставке нет.
 */

/* Витрина: банк с тремя гигантскими полотнами Flow — видно и здание, и полотно. */
export const BANNER_COVER_SITE = "bank";
export const BANNER_COVER_BOARD = "hw1_02_flw02_232_229";

/**
 * Полотно обложки: свой облик у полотен на зданиях — самое большое из них (его
 * видно лучше всего); иначе — полотно витрины. «Все щиты» полотен не красят
 * (ТЗ 24.10.2026), поэтому на витрину они не влияют. Полотна района без сцены
 * здания обложкой не бывают: снимать нечего, кроме самого полотна.
 */
export function bannerCoverBoard(project) {
  const normal = normalizeBillboardsProject(project);
  const showcase = billboard(BANNER_COVER_BOARD) ? BANNER_COVER_BOARD : bannerSite(BANNER_COVER_SITE)?.boards[0];
  const area = (id) => (billboard(id)?.size?.[0] || 0) * (billboard(id)?.size?.[1] || 0);
  const changed = changedBillboards(normal).filter((id) => billboardIsCanvas(billboard(id)) && bannerSiteOfBoard(id)?.scene);
  return changed.sort((a, b) => area(b) - area(a))[0] || showcase;
}

/** Листы рекламы всех полотен места (вблизи). */
export const bannerCoverSheets = (siteId) =>
  [...new Set((bannerSite(siteId)?.boards || []).flatMap((id) => (billboard(id)?.faces || []).map((face) => face.sheet)))].sort();

/* Версия рамки снимка: поменялась рамка — старые снимки из хранилища не находятся. */
const COVER_FRAME = 4;

/*
 * Рамка снимка (18.10.2026, после «всё в кадре»): снимок сам садит кадр по тому, что нарисуется
 * внутри коробки рамки (`fittedFrame`), поэтому коробка — не вся сцена места (квартал в двести метров,
 * полотно на нём — точка), а окрестность полотна: ширина полотна с запасом и его высота. Взгляд — перед
 * полотном и чуть сбоку, как «Полотно» в редакторе.
 */
function coverFrame(boardId) {
  return (asset) => {
    const place = bannerPlace(boardId);
    if (!place) return { bounds: asset.bounds, ground: false, person: false };
    const [width, height] = place.size;
    const reach = Math.max(12, width * 0.9);
    const [x, y, z] = place.point;
    return {
      bounds: { min: [x - reach, y - reach, z - height * 0.75], max: [x + reach, y + reach, z + height * 0.75] },
      ground: false,
      person: false,
      /* Чуть сверху: низкий взгляд упирается в крышу соседнего дома (у банка перед Flow). */
      view: { yaw: yawOf(place.normal) + 0.45, pitch: 0.34, zoom: 1 },
    };
  };
}

const plainLook = (index, info) => ({ colour: info.colour });

export default function BannersCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeBillboardsProject(stored) : createBillboardsProject();
  }, [state]);
  const boardId = bannerCoverBoard(project);
  const site = bannerSiteOfBoard(boardId);
  const sheets = useMemo(() => bannerCoverSheets(site?.id), [site]);
  const lookKey = useMemo(() => JSON.stringify([COVER_FRAME, boardId, sheets.map((id) => sheetLookKey(project, id, boardId))]), [boardId, sheets, project]);
  const frame = useMemo(() => coverFrame(boardId), [boardId]);

  /* Листы — только когда снимка ещё нет: составлять их дорого (лист игры, своя картинка). */
  const prepare = useCallback(async () => {
    const textures = {};
    let real = true;
    for (const id of sheets) {
      const composed = await composeSheet(id, project, boardId).catch(() => null);
      if (!composed?.texture) continue;
      textures[id] = composed.texture;
      real &&= composed.real;
    }
    return {
      look: (index, info) => (info.ad && textures[info.ad] ? { colour: "#ffffff", texture: textures[info.ad] } : { colour: info.colour }),
      /* В окне Astral лист игры не прочитан (игра не подключена) — снимок не
         запоминается: подключат — снимется с листом. В браузере листа игры нет вовсе. */
      cache: real || !desktopHost(),
      release: () => Object.values(textures).forEach((texture) => texture.dispose?.()),
    };
  }, [sheets, project, boardId]);

  const url = site?.scene?.url || null;
  return (
    <span className="workshop-cover-canvas">
      {url && <SceneThumb scene={url} look={plainLook} lookKey={lookKey} frame={frame} prepare={prepare} />}
    </span>
  );
}
