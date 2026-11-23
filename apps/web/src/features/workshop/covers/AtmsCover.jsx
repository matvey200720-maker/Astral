import { useMemo } from "react";
import { createAtmsProject, normalizeAtmsProject } from "@modovik/climb-contract/recolor/atms";
import { AtmsArt } from "../atms-editor/AtmsPresets.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Банкоматов» — настоящие банкоматы в облике работы: 3D-снимок той
 * же сцены, что в редакторе, все модели рядом, на матовой плашке, как у всех
 * карточек полки. Свои картинки в снимок не входят: снимок обложки делается
 * без хранилища окна. Пока человек ничего не ставил — банкоматы как в игре.
 */
export default function AtmsCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeAtmsProject(stored) : createAtmsProject();
  }, [state]);
  return (
    <span className="workshop-cover-canvas">
      <AtmsArt project={project} target="all" />
    </span>
  );
}
