/*
 * Кадр редактора «Дороги».
 *
 * Кусок карты из игры игрока на матовой плашке редакторов (`ModelStage`), камера — общая на всю
 * мастерскую: ЛКМ — вращение, щелчок ПКМ — полёт, колесо — приближение. Два куска (задача 13 ТЗ
 * 18.10.2026, поздний вечер): «Город» — перекрёсток в Davis (улица, переходы, тротуар, бордюр, края
 * кварталов), «Грунтовка» — дорога за Сэнди-Шорс через землю и кустарник. Модели — настоящие модели игры
 * (`scripts/prepare-roads-scene.mjs`), листы дорог — настоящие листы игры игрока в облике работы
 * (`roads-scene.js`): та же арифметика, что у установщика. Земля непрозрачная, сетки поверх нет, фон
 * чёрный. Вид над кадром: «Вблизи» — листы, что видны у машины, «Вдали» — их дальние планы, камера
 * отъезжает. Подпись кадра говорит прямо: свет и тени нарисованы окном, это не кадр из игры.
 */

import { useCallback, useMemo, useRef } from "react";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { roadAimTarget, roadSurfaceSpec } from "./roads-aim.js";
import { useRoadScene } from "./roads-scene.js";
import { ROAD_SCENE_OPTIONS, ROAD_VIEW_OPTIONS, groupLabel, partLabel, roadsFrame, roadsPlanText, roadsSceneUrl } from "./roads-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Рамка кадра — в `roads-text.js`: ею снимает и окно-съёмщик обложек. */
export { roadsFrame };

/*
 * `scene` — кусок: `city` (улица) или `dirt` (грунтовка), `onScene` — переключатель над кадром;
 * `onAim(aim)` — щелчок по краске куска (`roadAimTarget`); `highlight` — выбранная краска (`roadSurfaceSpec`) или `null`.
 */
/* Рамка куска «Дорог» — прямоугольник 80×80 м (город) и 130×120 м (грунтовка): круг по короткой стороне, полоса затухания — 14 м. */
const ROADS_EDGE = Object.freeze({ shape: "disc", width: 14 });

export default function RoadsStage({ project, scene = "city", onScene = null, view = "near", onView, onCamera = null, onAim = null, highlight = null }) {
  useTr();
  const stageRef = useRef(null);
  const url = roadsSceneUrl(scene);
  const { look, missing } = useRoadScene(url, project, view);
  const frame = useMemo(() => roadsFrame(view, { scene }), [view, scene]);
  /* Под курсором подсвечивается то, что откроется по щелчку. */
  const aimTarget = useCallback((hit) => {
    const aim = roadAimTarget(hit);
    /* Подпись у курсора: покрытие («Асфальт», «Тротуары») или группа разметки («Стоп-линии и стрелки»). */
    return aim ? labelled(roadSurfaceSpec(aim), aim.tool === "markings" && aim.group !== "markings" ? groupLabel(aim.group) : tr(partLabel(aim.tool))) : null;
  }, []);
  const aim = useCallback(
    (hit) => {
      const found = roadAimTarget(hit);
      if (found) onAim(found);
    },
    [onAim],
  );
  const dirt = scene === "dirt";
  const place = dirt ? tr("грунтовка за Сэнди-Шорс") : tr("перекрёсток в Davis");
  /* Откуда модели и листы, кадру говорить незачем (обход кадров 29.10.2026): строка — только когда листов игры нет. */
  const caption = missing
    ? trFill("Кусок карты ({0}) — модели игры, но листов вашей GTA V сейчас нет (окно без Astral Desktop или игра не найдена), поэтому поверхности идут средними цветами.", place)
    : "";
  const options = (list) => list.map((option) => ({ ...option, label: tr(option.label) }));
  return (
    <div className="fx-stage recolor-stage is-studio roads-stage">
      <ModelStage loadKit="terrain"
        ref={stageRef}
        scene={url}
        look={look}
        frame={frame}
        frameKey={`roads-${scene}-${view}`}
        /* Кусок карты — круг, вписанный в рамку сцены: внутри всё целое, за ним чёрная пустота с мягким краем (20.10.2026). */
        edgeFade={ROADS_EDGE}
        onCamera={onCamera}
        onAim={onAim ? aim : null}
        aimTarget={aimTarget}
        highlight={highlight}
        label={dirt ? tr("Кусок карты — грунтовка за Сэнди-Шорс в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.") : tr("Кусок карты — перекрёсток в Davis в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}
      />
      <StageBar>
        {onScene && <SegmentedControl label={tr("Участок")} size="sm" className="roads-views roads-scenes" options={options(ROAD_SCENE_OPTIONS)} value={scene} onChange={onScene} />}
        <SegmentedControl label={tr("Вид кадра")} size="sm" className="roads-views" options={options(ROAD_VIEW_OPTIONS)} value={view} onChange={onView} />
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      {/* Служебная строка, а не то, что человек исправит, — не жёлтая (правило 14 `design-qa.md`, 30.10.2026). */}
      <StageNote>{missing ? caption : ""}</StageNote>
      <StageNote>{roadsPlanText(project)}</StageNote>
    </div>
  );
}
