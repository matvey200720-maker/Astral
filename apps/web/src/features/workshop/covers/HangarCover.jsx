import { useMemo } from "react";
import {
  createHangarProject,
  normalizeHangarProject,
} from "@modovik/climb-contract/recolor/hangar";
import { HangarArt } from "../hangar-editor/HangarPresets.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка ангара — настоящий ангар в облике работы: 3D-снимок той же сцены,
 * что в редакторе, снаружи со стороны ворот, на матовой плашке, как у всех
 * карточек полки. Пока человек ничего не ставил — штатный ангар игры (Ангар
 * стандартный, ТЗ 12.10.2026, ночь).
 */
export default function HangarCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeHangarProject(stored) : createHangarProject();
  }, [state]);
  return (
    <span className="workshop-cover-canvas">
      <HangarArt project={project} />
    </span>
  );
}
