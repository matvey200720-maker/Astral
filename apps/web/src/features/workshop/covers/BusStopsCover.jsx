import { useMemo } from "react";
import { boothsAreStock } from "@modovik/climb-contract/recolor/busstop-booths";
import { busStopsOnlyAreStock, createBusStopsProject, normalizeBusStopsProject } from "@modovik/climb-contract/recolor/busstops";
import { BoothsArt } from "../busstops-editor/BoothsPresets.jsx";
import { BusStopsArt } from "../busstops-editor/BusStopsPresets.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Остановок» — настоящие остановки в облике работы: 3D-снимок той
 * же сцены, что в редакторе, все виды рядом, на матовой плашке, как у всех
 * карточек полки. Свои картинки отделки в снимок не входят: снимок обложки
 * делается без хранилища окна. Пока человек ничего не ставил — остановки
 * как в игре.
 *
 * Будки (задача 11 ТЗ 18.10.2026): работа, где перекрашены только будки, —
 * обложка из их кадра (обе будки рядом, та же сцена, что в редакторе), а не
 * нетронутые остановки.
 */
export default function BusStopsCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeBusStopsProject(stored) : createBusStopsProject();
  }, [state]);
  const booths = busStopsOnlyAreStock(project) && !boothsAreStock(project.booths);
  return <span className="workshop-cover-canvas">{booths ? <BoothsArt booths={project.booths} target="all" /> : <BusStopsArt project={project} target="all" />}</span>;
}
