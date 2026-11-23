import { useCallback, useMemo } from "react";
import {
  arenaScene,
  arenaServerInventory,
  arenasProjectSignature,
  createArenasProject,
  normalizeArenasProject,
} from "@modovik/climb-contract/recolor/arenas";
import { finishTextureNow } from "../finish/finish-textures.js";
import { arenaFrameLook } from "../arena-editor/arena-text.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка арены — настоящая Maze Bank Arena сервера работы в её облике:
 * 3D-снимок той же сцены «снаружи», что в редакторе, на матовой плашке, как
 * у всех карточек полки. Пока человек ничего не ставил — стандартная арена.
 * Свои картинки (эмблема, отделка картинкой) в снимок не входят: снимок
 * обложки делается без хранилища окна.
 */
export default function ArenaCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeArenasProject(stored) : createArenasProject();
  }, [state]);
  const server = project.server;
  const finishes = useMemo(
    () => ({
      facade: finishTextureNow(project[server].facade),
      floor: finishTextureNow(project[server].floor),
      walls: finishTextureNow(project[server].walls),
      ceiling: finishTextureNow(project[server].ceiling),
    }),
    [project, server],
  );
  const look = useCallback((index, info) => arenaFrameLook(project, server, info, { finishes }), [project, server, finishes]);
  const frame = useCallback(
    (asset) => {
      const facade = asset.parts.find((item) => item.id === "facade");
      const normal = arenaServerInventory(server)?.decal?.normal || [0, -1, 0];
      return { bounds: facade?.bounds || asset.bounds, ground: true, view: { yaw: Math.atan2(normal[0], -normal[1]) + 0.35, pitch: 0.3 } };
    },
    [server],
  );
  const scene = arenaScene(server, "outside");
  return (
    <span className="workshop-cover-canvas">
      {scene && <SceneThumb scene={scene.url} look={look} lookKey={arenasProjectSignature({ ...project, [server]: { ...project[server], emblems: [] } })} frame={frame} />}
    </span>
  );
}
