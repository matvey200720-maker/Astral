import { useMemo } from "react";
import { createProjectInteriors, installedInteriors, interiorLookOf, normalizeProjectInteriors } from "@modovik/climb-contract/recolor/project-interiors";
import ShopRoomArt from "../shops-editor/ShopRoomArt.jsx";
import { parseCoverState } from "./cover-data.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Обложка «Интерьеров проектов» (задача 10 ТЗ 17.10.2026, вечер): схема угла
 * комнаты цветами работы — того интерьера, что отмечен «Поставить в игру»,
 * иначе первого с правками. Это схема, а не кадр из игры: интерьеры проектов
 * лежат у игрока, и снимка в поставке нет. Пока ничего не правили — комната в
 * цветах по умолчанию.
 */
export default function ProjectInteriorsCover({ state = null }) {
  useTr();
  const look = useMemo(() => {
    const stored = parseCoverState(state);
    const work = stored ? normalizeProjectInteriors(stored) : createProjectInteriors();
    const id = installedInteriors(work)[0] || Object.keys(work.interiors)[0] || "p00000000";
    const own = interiorLookOf(work, id);
    return { surfaces: { ...own.surfaces, shelves: own.surfaces.furniture } };
  }, [state]);
  return (
    <span className="workshop-cover-canvas">
      <ShopRoomArt look={look} label={tr("Схема интерьера")} />
    </span>
  );
}
