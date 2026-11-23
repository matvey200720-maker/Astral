/*
 * Кадр редактора МСЛ-зон (ТЗ 08.10.2026, задача 3).
 *
 * Над кадром — какой район показать. В кадре — линии зон района в облике
 * работы: та же сетка, что уедет в игру (`mslZonesMesh` договора) — лента
 * нужной ширины, стенка нужной высоты, цвет палитры мода или эффекта,
 * прозрачность. Земля с сеткой и человек в 1,8 м — для масштаба, на общей
 * матовой плашке редакторов (`ModelStage`), камера — общая на мастерскую:
 * ЛКМ — вращение, щелчок ПКМ — полёт, колесо — приближение.
 *
 * Щелчок ЛКМ по линии (18.10.2026) выбирает её цвет мода и открывает «Цвет»:
 * лента мода тоньше пикселя, поэтому целиться можно и в мишень шире неё
 * (`msl-zones-aim.js`). Линии выбранного цвета подсвечены штрихами по ленте
 * шире мода — иначе с высоты района подсветки не видно. Под курсором, как у
 * сеток сцены, линии не подсвечиваются: наведение видит только сетки сцены,
 * а здесь они спрятаны.
 */

import { useCallback, useRef, useState } from "react";
import {
  MSL_DISTRICTS,
  MSL_ZONES_INVENTORY,
  findMslDistrict,
  normalizeMslZonesProject,
} from "@modovik/climb-contract/recolor/msl-zones";
import Button from "../../../components/ui/Button.jsx";
import Select from "../../../components/ui/Select.jsx";
import { StageBar, StageBusy, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useStageSwitch } from "../../../components/ui/stage-switch.js";
import ModelStage from "../model-stage/ModelStage.jsx";
import { mslAimSpec, mslAimTarget } from "./msl-zones-aim.js";
import { findMslColour } from "@modovik/climb-contract/recolor/msl-zones";
/* Подпись у курсора — цвет линий под ним, как строка «Синие линии» в колонке. */
const mslAimLabelled = (hit) => {
  const colour = findMslColour(mslAimTarget(hit)?.colour);
  return labelled(mslAimSpec(hit), colour ? tr(`${colour.many} линии`) : "");
};
import { useMslZonesObjects } from "./msl-zones-art.js";
import { distanceText, metresText, percentText } from "./msl-zones-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";
import { trFill } from "../../../locales/tr-fill.js";

const DISTRICT_OPTIONS = MSL_DISTRICTS.map((district) => [district.id, district.label]);

export default function MslZonesStage({ project, districtId, onDistrict, onCamera = null, onAim = null, selected = null }) {
  useTr();
  const stageRef = useRef(null);
  const [asset, setAsset] = useState(null);
  /* Другой район — разбор его лент и новые сетки (до полсекунды на ПК слабее этого Mac): сперва «Обновляю…» (19.10.2026). */
  const asked = findMslDistrict(districtId).id;
  const districtSwitch = useStageSwitch(asked);
  const district = findMslDistrict(districtSwitch.value);
  const objects = useMslZonesObjects({ asset, districtId: district.id, project, selected });
  /* Щелчок по линии — её цвет мода; мимо линий (земля, человек) ничего не выбирается. */
  const onHit = useCallback(
    (hit) => {
      const aimed = mslAimTarget(hit);
      if (aimed) onAim?.(aimed.colour);
    },
    [onAim],
  );
  const normal = normalizeMslZonesProject(project);
  /* Свои линии рисует объект кадра — ленты сцены описи прячутся. */
  const look = useCallback(() => ({ visible: false }), []);
  const frame = useCallback(
    (loaded) => {
      const part = loaded.parts.find((item) => item.id === district.id);
      return { bounds: part?.bounds || loaded.bounds, ground: true, person: true, view: { pitch: 0.62, zoom: 0.9 } };
    },
    [district.id],
  );
  return (
    <div className="fx-stage recolor-stage is-studio">
      <ModelStage loadKit="zones"
        ref={stageRef}
        scene={MSL_ZONES_INVENTORY.scene.url}
        look={look}
        frame={frame}
        frameKey={district.id}
        onScene={setAsset}
        onCamera={onCamera}
        objects={objects}
        onAim={onAim ? onHit : null}
        aimTarget={mslAimLabelled}
        highlight={null}
        label={`Линии зон района «${district.label}» в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.`}
      />
      <StageBar>
        <Select className="recolor-stage-select" ariaLabel={tr("Район в кадре")} value={asked} options={DISTRICT_OPTIONS} onChange={onDistrict} />
        <Button size="sm" variant="ghost" title={tr("Камера один раз обходит район кругом")} onClick={() => stageRef.current?.orbitOnce()}>
          {tr("Облёт")}
        </Button>
      </StageBar>
      <StageBusy busy={districtSwitch.busy} />
      <StageNote>
        {normal.height > 0
          ? trFill(
              "В игре: лента {0}, стенка {1} по оси ленты, прозрачность {2}, видно с {3} — во всех десяти районах.",
              metresText(normal.width),
              metresText(normal.height),
              percentText(100 - normal.opacity),
              distanceText(normal.drawDistance),
            )
          : trFill(
              "В игре: лента {0}, прозрачность {1}, видно с {2} — во всех десяти районах.",
              metresText(normal.width),
              percentText(100 - normal.opacity),
              distanceText(normal.drawDistance),
            )}
      </StageNote>
    </div>
  );
}
