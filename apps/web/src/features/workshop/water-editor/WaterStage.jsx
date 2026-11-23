/*
 * Кадр редактора воды.
 *
 * С установленной игрой — кусок настоящего моря у Венис-Бич из неё (`WaterSeaStage`,
 * задача 20 ТЗ 18.10.2026): берег, мель, дно, кораллы и водоросли из игры, вода —
 * по работе; без игры, без Astral Desktop или без буфера с плавающей точкой — вот
 * эти постановочные виды.
 *
 * Вид — над кадром: «Вблизи» — блок воды на сетке, на матовой плашке, как
 * оболочка у «Зон» (`water-block.js`, общий кадр и камера мастерской),
 * «Под водой» — постановочный вид из-под воды (`WaterUnderView`: туман,
 * видимость, муть и свет — числа подводного модификатора). Карты паузы в
 * кадре нет (владелец, 14.10.2026): только вода и под водой. Вся вода — одна
 * настройка. Картинки считаются той же арифметикой, что у установщика;
 * блок и вид под водой постановочные, и подпись кадра говорит это прямо.
 *
 * Органы — поверх кадра (`StageBar`), подпись и то, что уйдёт в игру, —
 * в подписи кадра.
 */

import { useCallback, useRef, useState } from "react";
import { hasDesktopBridge } from "../../../api.js";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import WaterSeaStage from "./WaterSeaStage.jsx";
import WaterUnderView from "./WaterUnderView.jsx";
import { WATER_BLOCK_URL, useWaterBlockSheets, waterBlockFrame, waterBlockLook } from "./water-block.js";
import { WATER_LIGHT_NOTE, WATER_SEA_VIEW_OPTIONS, WATER_VIEW_OPTIONS, waterPlanText } from "./water-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/**
 * `project` — работа (вид «Под водой»), `looks` — `compileWaterLooks`,
 */
export default function WaterStage({ project, looks, under = null, view, onView, hour = 13, onHourChange = null, onCamera = null }) {
  useTr();
  const stageRef = useRef(null);
  const { sheets } = useWaterBlockSheets(looks.sea);
  const blockLook = useCallback((index, info) => waterBlockLook(sheets)(index, info), [sheets]);
  /* Море из игры собрать не вышло (игры нет, видеокарта без буфера с плавающей точкой) — остаются постановочные виды. */
  const [seaFailure, setSeaFailure] = useState("");
  if (hasDesktopBridge() && !seaFailure) {
    return (
      <WaterSeaStage
        project={project}
        looks={looks}
        view={view}
        hour={hour}
        onHourChange={onHourChange}
        onUnavailable={setSeaFailure}
        viewControl={<SegmentedControl label={tr("Вид кадра")} size="sm" options={WATER_SEA_VIEW_OPTIONS.map((option) => ({ ...option, label: tr(option.label) }))} value={view} onChange={onView} />}
      />
    );
  }
  return (
    /* Постановочный кадр (без игры): в обложку работы он не снимается (`works/work-covers.js`) — вместо плиты у работы штатная картинка. */
    <div className="fx-stage recolor-stage water-stage is-studio" data-frame-staged="">
      {view === "under" ? (
        <WaterUnderView project={project} label={tr("Вид из-под воды в облике работы: туман, видимость, муть и свет — как уйдут в игру")} />
      ) : (
        <ModelStage loadKit="terrain" softLoad
          ref={stageRef}
          scene={WATER_BLOCK_URL}
          look={blockLook}
          frame={waterBlockFrame}
          frameKey="water-block"
          onCamera={onCamera}
          label={tr("Блок воды в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}
        />
      )}
      <StageBar>
        <SegmentedControl label={tr("Вид кадра")} size="sm" options={WATER_VIEW_OPTIONS} value={view} onChange={onView} />
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      <StageNote>{view === "under" ? "" : tr(WATER_LIGHT_NOTE)}</StageNote>
      <StageNote>{waterPlanText(looks, under)}</StageNote>
    </div>
  );
}
