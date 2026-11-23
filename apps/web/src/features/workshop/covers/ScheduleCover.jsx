import { useEffect, useMemo, useState } from "react";
import { createScheduleProject, normalizeScheduleProject } from "@modovik/climb-contract/recolor/schedule";
import { loadWallSheet, paintScheduleTile, scheduleTileAssets } from "../schedule-editor/schedule-sheet.js";
import { useCoverPending } from "./cover-bake-context.js";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка «Расписания» — табло работы на серой бетонной стене, как оно
 * висит в игре (задача 14 ТЗ 18.10.2026): стена — штатный бетон GTA V
 * игрока (без игры — серая), тот же лист, что уедет в игру; пока человек
 * ничего не ставил — облик табло сервера (его табло, отрисованное по
 * сеткам его файла). Своя картинка строки на обложке — из хранилища окна,
 * если она там есть.
 */
export default function ScheduleCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeScheduleProject(stored) : createScheduleProject();
  }, [state]);
  const [assets, setAssets] = useState(null);
  /* Лист бетона стены: `undefined` — ещё грузится, `null` — игры нет (стена серая). */
  const [wall, setWall] = useState(undefined);
  /* Картинки плитки ещё едут — печь обложек ждёт их (`cover-bake-context.js`). */
  const [settled, setSettled] = useState(false);
  useCoverPending(!settled);
  useEffect(() => {
    let cancelled = false;
    setSettled(false);
    Promise.all([scheduleTileAssets(project), loadWallSheet()])
      .then(([value, image]) => {
        if (cancelled) return;
        setAssets(value);
        setWall(image);
        setSettled(true);
      })
      .catch(() => !cancelled && setSettled(true));
    return () => {
      cancelled = true;
    };
  }, [project]);
  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      /* Стена закрывает холст целиком; пока лист бетона ещё едет — холст прозрачный, под ним матовая плашка `.workshop-cover`. */
      paintScheduleTile(context, project, assets, { width, height, margin: 0.1, wall: wall === undefined ? null : { image: wall } });
    },
    [project, assets, wall],
  );
  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
