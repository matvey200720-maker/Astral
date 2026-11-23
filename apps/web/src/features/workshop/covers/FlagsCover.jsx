import { useMemo } from "react";
import { FLAG_KINDS, changedFlagKinds, createFlagsProject, flagKind, flagLookIsStock, flagLookOf, normalizeFlagsProject } from "@modovik/climb-contract/recolor/flags";
import { drawWavingFlag, useFlagSheet } from "../flags-editor/flags-art.js";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка «Флагов» — полотнище на древке в облике работы: облик всех флагов
 * на флаге США (их на карте больше всех), а если он как в игре, — первый вид
 * со своим флагом. Та же функция листа, что у установщика; волна — один кадр
 * постановки. Пока человек ничего не ставил — флаг США, нарисованный кодом
 * (листа Rockstar в поставке нет); своя картинка видна, пока она есть в
 * хранилище окна.
 */
export default function FlagsCover({ state = null }) {
  const { kind, look } = useMemo(() => {
    const stored = parseCoverState(state);
    const project = stored ? normalizeFlagsProject(stored) : createFlagsProject();
    if (!flagLookIsStock(project.all)) return { kind: FLAG_KINDS[0], look: project.all };
    const first = changedFlagKinds(project)[0];
    return first ? { kind: flagKind(first), look: flagLookOf(project, first) } : { kind: FLAG_KINDS[0], look: project.all };
  }, [state]);
  const sheet = useFlagSheet(kind, look, { game: false });
  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      /* Холст прозрачный: под ним матовая плашка `.workshop-cover`. */
      /* Лист флага собирается асинхронно — до него кадр неокончательный. */
      if (!sheet.canvas) return false;
      drawWavingFlag(context, sheet.canvas, { width, height, time: 0.6 });
      return true;
    },
    [sheet],
  );
  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
