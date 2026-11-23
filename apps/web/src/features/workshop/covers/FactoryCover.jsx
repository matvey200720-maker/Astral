import { useMemo } from "react";
import {
  createFactoryStartProject,
  normalizeFactoryProject,
} from "@modovik/climb-contract/recolor/factory";
import { FactoryArt } from "../factory-editor/FactoryPresets.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка завода — настоящий завод в облике работы: 3D-снимок той же сцены,
 * что в редакторе (корпуса, земля, контейнеры и реквизит на местах из карт
 * игры), на матовой плашке, как у всех карточек полки. Пока человек ничего
 * не ставил — «Стандарт GTA»: штатные листы из его игры, тот же вид, с
 * которого открывается редактор. Серый завод мода — это готовый вид, а не
 * исходный: в кадре он выходит почти чёрным (13.10.2026, владелец).
 */
export default function FactoryCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeFactoryProject(stored) : createFactoryStartProject();
  }, [state]);
  return (
    <span className="workshop-cover-canvas">
      <FactoryArt project={project} />
    </span>
  );
}
