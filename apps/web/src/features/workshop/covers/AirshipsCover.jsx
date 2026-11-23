import { useMemo } from "react";
import { createAirshipsProject, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";
import { AirshipsSkyArt } from "../airships-editor/AirshipsArt.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Дирижаблей» — небо работы одним 3D-снимком (ТЗ 11.10.2026: «на
 * превью тоже» 3D дирижабль; вечер: «показывай не стандарт, а то, что
 * человек применил … вместо дирижабля — модель, которую выбрал»):
 * дирижабль из игры игрока с листом работы, если он есть в работе, и
 * выбранные в «Небе» модели Astral их цветами, лого и текстурой — главная
 * крупно, остальные рядом (`AirshipsSkyArt`). Работы нет — исходный вид
 * редактора: дирижабль с надписью «Это всё о’кей».
 *
 * В браузере без Astral Desktop листа игры нет: «как в игре» — оболочка
 * средним цветом листа (листов Rockstar в поставке нет).
 */
export default function AirshipsCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeAirshipsProject(stored) : createAirshipsProject();
  }, [state]);
  return (
    <span className="workshop-cover-canvas">
      <AirshipsSkyArt project={project} />
    </span>
  );
}
