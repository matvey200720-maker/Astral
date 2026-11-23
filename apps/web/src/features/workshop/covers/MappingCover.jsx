import { useMemo } from "react";
import {
  createMappingProject,
  normalizeMappingProject,
} from "@modovik/climb-contract/recolor/mapping";
import { MappingArt } from "../mapping-editor/MappingPresets.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка маппинга — настоящие здания фермы, главного места мода, в облике
 * работы: 3D-снимок той же сцены, что в редакторе, на матовой плашке, как у
 * всех карточек полки. Пока человек ничего не ставил — как в игре: штатные
 * здания фермы из игры игрока.
 */
export default function MappingCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeMappingProject(stored) : createMappingProject();
  }, [state]);
  return (
    <span className="workshop-cover-canvas">
      <MappingArt project={project} />
    </span>
  );
}
