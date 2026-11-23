import { useMemo } from "react";
import { createTargetHpProject, parseTargetHpProject, targetHealthIsStock } from "@modovik/reticle-contract";
import { TARGET_HP_COVER_BOX, TargetHealthScene, targetHealthExample } from "../target-hp-editor/target-hp-art.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Полоски HP» (задача 2 ТЗ 11.10.2026) — та же постановочная сцена,
 * что в кадре редактора, крупно на метке того, на кого навелись. Пока своей
 * полоски нет — штатная белая полоса полного HP, как в игре; поставил своё —
 * обложка показывает его, у кого есть броня — с полной бронёй (у «Одной
 * цифры» это 200). Цифры и имя — шрифтом окна: читать шрифты из игры ради
 * плитки незачем.
 *
 * Фон — матовая плашка обложки (`editor-covers.css`), как у соседних
 * плиток: своей заливки у рисунка нет (владелец, 11.10.2026, вечер).
 */
function coverProject(state) {
  const stored = parseCoverState(state);
  return stored && typeof stored === "object" && stored.schema ? parseTargetHpProject(stored) : createTargetHpProject();
}

export default function TargetHpCover({ state = null }) {
  useTr();
  const project = useMemo(() => coverProject(state), [state]);
  const example = targetHealthExample(!targetHealthIsStock(project) && project.armour ? "armour" : "full");
  return (
    <svg className="workshop-cover-canvas" viewBox={TARGET_HP_COVER_BOX} preserveAspectRatio="xMidYMid slice" role="img" aria-label={tr("Полоска HP над игроком")}>
      <TargetHealthScene config={project} example={example} />
    </svg>
  );
}
