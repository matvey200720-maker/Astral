import { useMemo } from "react";
import { createBuildingProject, normalizeBuildingProject } from "@modovik/climb-contract/recolor/buildings";
import { BuildingArt } from "../building-editor/BuildingPresets.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка здания из игры («Мегамолл», «Ашан / Икея») — настоящее здание в
 * облике работы: 3D-снимок той же сцены, что в редакторе, со стороны
 * главного фасада, на матовой плашке, как у всех карточек полки. Стороны
 * цветом и надпись-плашка — на снимке; свои картинки (баннеры, логотипы) в
 * снимок не входят: снимок обложки делается без хранилища окна. Пока
 * человек ничего не ставил — здание как в игре.
 */
export default function BuildingCover({ kind = "megamall", state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeBuildingProject(kind, stored) : createBuildingProject(kind);
  }, [kind, state]);
  return (
    <span className="workshop-cover-canvas">
      <BuildingArt place={kind} project={project} />
    </span>
  );
}
