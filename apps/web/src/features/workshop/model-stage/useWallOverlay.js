import { useEffect, useMemo } from "react";
import { createWallOverlay } from "./wall-overlay.js";

/*
 * Стена под щелчком (3Б ТЗ 18.10.2026) как объекты кадра: `wall` — стена из
 * `texture-studio/wall-face.js` или `null`; ответ — список для `ModelStage` `objects`.
 * Ресурсы освобождаются, когда стена сменилась или кадр ушёл.
 */
export default function useWallOverlay(wall) {
  const overlay = useMemo(() => (wall ? createWallOverlay(wall) : null), [wall]);
  useEffect(() => () => overlay?.dispose(), [overlay]);
  return useMemo(() => (overlay ? [{ object: overlay.object }] : []), [overlay]);
}
