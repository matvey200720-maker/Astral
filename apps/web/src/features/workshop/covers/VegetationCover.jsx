import { useMemo } from "react";
import { createVegetationProject, normalizeVegetationProject } from "@modovik/climb-contract/recolor/vegetation";
import OakArt from "../vegetation-editor/OakArt.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка растительности — тот же дуб, что в кадре редактора: модель игры
 * игрока (или «Реалистичных деревьев», если они включены) в воздухе на
 * матовой плашке, листва в облике работы — 3D-снимок той же сцены. Пока
 * человек ничего не ставил — листва Rockstar.
 */
export default function VegetationCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeVegetationProject(stored) : createVegetationProject();
  }, [state]);
  return (
    <span className="workshop-cover-canvas">
      <OakArt project={project} />
    </span>
  );
}
