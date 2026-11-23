/*
 * Кадр «Летающего лого» (ТЗ 08.10.2026, задача 4): лого работы над
 * площадкой — та же объёмная фигура, что уедет в игру, на заданной высоте и
 * с тем же движением (вращение, покачивание, левитация), на общей матовой
 * плашке редакторов (`ModelStage`). Камера — общая на мастерскую: ЛКМ —
 * вращение, щелчок ПКМ — полёт, колесо — приближение. Человек в 1,8 м — для
 * масштаба. С 11.10.2026 под лого — статуя орла посреди площади, как в
 * игре (`prepare-float-logo-scene.mjs`): видно, на какой высоте лого над ней.
 */

import { useCallback, useRef, useState } from "react";
import { FLOAT_LOGO_STATUE, normalizeFloatLogoProject } from "@modovik/climb-contract/recolor/float-logo";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { ringDisc, ringEdgeFade } from "../model-stage/ring-fade.js";
import { floatLogoAimTarget } from "./float-logo-aim.js";
import { FLOAT_LOGO_HIGHLIGHT, FLOAT_LOGO_SCENE, floatLogoSceneLook, useFloatLogoObjects } from "./float-logo-art.js";
import { distanceText, metresText } from "./float-logo-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";
import { trFill } from "../../../locales/tr-fill.js";

/* `onAim(hit)` — щелчок по лого; `selected` — лого выбрано (вокруг него рамка). */
export default function FloatLogoStage({ project, pixels, onCamera = null, onAim = null, selected = false }) {
  useTr();
  const stageRef = useRef(null);
  /* Сцена кадра: площадь у FIB и улицы вокруг — круг настоящего мира (`prepare-world-ring.mjs`). */
  const [asset, setAsset] = useState(null);
  const normal = normalizeFloatLogoProject(project);
  const objects = useFloatLogoObjects(normal, pixels);
  const reach = objects[0]?.reach || { size: normal.size, top: normal.height + normal.size };
  const look = useCallback(floatLogoSceneLook, []);
  /* Лого — не сетка сцены, его обводят по объектам кадра (`FLOAT_LOGO_HIGHLIGHT`); при наведении сам редактор ничего не рисует (`none`); площадка и статуя под ним правке не поддаются. */
  /* Подпись у курсора — «Летающее лого». */
  const aimTarget = useCallback((hit) => (floatLogoAimTarget(hit) ? labelled({ none: true }, tr("Летающее лого")) : null), []);
  const aim = useCallback(
    (hit) => {
      if (floatLogoAimTarget(hit)) onAim(hit);
    },
    [onAim],
  );
  /* В рамке — и лого, и статуя под ним. */
  const side = Math.max(reach.size, FLOAT_LOGO_STATUE.radius * 2);
  const top = Math.max(reach.top, FLOAT_LOGO_STATUE.top);
  const frameKey = `${Math.round(side)}:${Math.round(top)}`;
  const frame = useCallback(
    () => ({
      bounds: { min: [-side / 2, -side / 2, 0], max: [side / 2, side / 2, top] },
      ground: !ringDisc(asset),
      person: true,
      view: { pitch: 0.18, zoom: 0.95 },
    }),
    [side, top, asset],
  );
  return (
    <div className="fx-stage recolor-stage is-studio">
      <ModelStage loadKit="props"
        ref={stageRef}
        scene={FLOAT_LOGO_SCENE}
        look={look}
        frame={frame}
        frameKey={frameKey}
        edgeFade={ringEdgeFade(asset)}
        onScene={setAsset}
        onCamera={onCamera}
        objects={objects}
        onAim={onAim ? aim : null}
        aimTarget={aimTarget}
        highlight={selected ? FLOAT_LOGO_HIGHLIGHT : null}
        label={tr("Летающее лого над городом в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}
      />
      {/* Строки «Лого нет — загрузите…» на кадре нет: пустая рамка картинки в колонке говорит то же (критики 30–31.10.2026). */}
      <StageNote>
        {normal.mode === "none"
          ? tr("Сейчас лого нет — в игре над городом будет пусто.")
          : trFill("В игре: {0} на высоте {1}, видно с {2}.", metresText(normal.size), metresText(normal.height), distanceText(normal.drawDistance))}
      </StageNote>
    </div>
  );
}
