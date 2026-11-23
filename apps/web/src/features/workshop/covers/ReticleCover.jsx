import { useMemo } from "react";
import { ORDINARY_RETICLE_DEFAULTS } from "@modovik/reticle-contract";
import { ReticleThumb } from "../../../components/desktop/workshop/reticle/ReticleArt.jsx";
import { readStudioModule } from "./cover-data.js";

/*
 * Обложка прицела — сам прицел теми же фигурами, что рисует редактор и что
 * уходят в `hud_reticle.gfx`. Стандартная обложка — прицел, с которого
 * редактор начинает; своя работа показывается своими линиями и цветом.
 *
 * В кадре — окно вокруг центра под размер самого прицела: на целом экране
 * 1280×720 прицел занимал бы пару процентов и читался точкой.
 */
export default function ReticleCover({ projectId = "", state = null }) {
  const config = useMemo(
    () => ({
      ...ORDINARY_RETICLE_DEFAULTS,
      ...(readStudioModule(projectId, "crosshair", state) || {}),
    }),
    [projectId, state],
  );
  return (
    <ReticleThumb
      kind="ordinary"
      config={config}
      aspect={2.35}
      zoom={1}
      className="workshop-cover-reticle"
    />
  );
}
