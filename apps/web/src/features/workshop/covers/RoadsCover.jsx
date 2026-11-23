import { useCallback, useMemo } from "react";
import { createRoadsProject, normalizeRoadsProject, roadsProjectSignature } from "@modovik/climb-contract/recolor/roads";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { nativeRoadLook, prepareRoadSceneLook } from "../roads-editor/roads-scene.js";
import { ROADS_SCENE_URL, roadsFrame } from "../roads-editor/roads-text.js";
import { parseCoverState } from "./cover-data.js";

/* Размер листов обложки: плитке полки хватает 256 px. */
const COVER_SHEET = 256;
/* Версия снимка: поменялась сборка обложки — старые снимки не находятся. */
const COVER_FRAME = 6;
/* То же для постановочных листов обложки каталога (`road-stand-in.js`): поменялся их рисунок — прежние снимки не находятся. */
const STAND_IN_FRAME = 3;

/*
 * Обложка «Дорог» — перекрёсток в Davis в облике работы (с 18.10 — настоящий кусок карты из игры): 3D-снимок той же
 * сцены, что в редакторе, с настоящими листами игры игрока, на чёрной плашке, как у всех карточек полки. Свои текстуры в
 * снимок не входят: снимок обложки делается без хранилища окна. Пока человек ничего не ставил — дороги как в игре.
 *
 * Листы и их перекраска — только когда снимка ещё нет (оптимизация ночи
 * 12.10.2026): прежде каждый заход в мастерскую читал пять листов игры,
 * перекрашивал их в главном потоке и снимал обложку дважды — до листов и
 * после, хотя готовый снимок уже лежал в хранилище.
 */
export default function RoadsCover({ state = null }) {
  const stored = useMemo(() => parseCoverState(state), [state]);
  const project = useMemo(() => (stored ? normalizeRoadsProject(stored) : createRoadsProject()), [stored]);
  /* Обложку каталога снимает окно без игры и просит свои постановочные листы (`standIn`, `road-stand-in.js`):
     в мастерской игрока этого флага в снимке нет, и кадр читает листы его игры. */
  const standIn = stored?.standIn === true;
  const frame = useMemo(() => roadsFrame("near", { thumb: true }), []);
  const lookKey = `roads|${COVER_FRAME}|${standIn ? `stand${STAND_IN_FRAME}|` : ""}${roadsProjectSignature(project)}`;

  /* Листы-дороги сцены в облике работы; листов игры нет (браузер без Astral) — снимок не ложится в хранилище. */
  const prepare = useCallback(() => prepareRoadSceneLook(ROADS_SCENE_URL, project, { size: COVER_SHEET, standIn }), [project, standIn]);

  return (
    <span className="workshop-cover-canvas">
      <SceneThumb scene={ROADS_SCENE_URL} look={nativeRoadLook} lookKey={lookKey} frame={frame} prepare={prepare} />
    </span>
  );
}
