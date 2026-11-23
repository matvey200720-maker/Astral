import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  referenceKeyframeDocument,
  resolveSkyState,
  weatherConditions,
} from "@modovik/timecycle";
import SkyStage from "../../../components/desktop/workshop/SkyStage.jsx";
import { previewBand } from "../../../components/desktop/workshop/sky/sky-preview.js";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Предпросмотр таймцикла (Каталог 2.0, часть 2, доска `Preview-tc`): небо мода тем же шейдером, что в мастерской (`SkyStage`), с лентой суток 00–24, бегунком часа и кнопкой
 * «Сутки» (▶ — сутки за 24 с; её рисует сама лента неба). Погода — Ясно, Облачно, Дождь, Снег: небо считается по эталонной погоде и правкам мода (`resolveSkyState`, как у обложки
 * неба), осадки и ветер — `weatherConditions`. Кадр — небо, нарисованное Astral: квартал из игры в каталоге не читается.
 */

const WEATHERS = Object.freeze(["CLEAR", "CLOUDS", "RAIN", "SNOW"]);
const REGION = "GLOBAL";
const DAY_PLAY = Object.freeze({ autoStart: true, loop: true });

export default function SkyView({ data, slot, onReady }) {
  useTr();
  const { project } = data;
  const [weather, setWeather] = useState("CLEAR");
  const [hour, setHour] = useState(12);
  const document = useMemo(() => referenceKeyframeDocument(weather), [weather]);
  const state = useMemo(
    () => resolveSkyState({ document, project, weather, region: REGION, hour }),
    [document, project, weather, hour],
  );
  const band = useMemo(
    () => previewBand(document, project, weather),
    [document, project, weather],
  );
  const conditions = useMemo(() => weatherConditions(weather), [weather]);
  const options = [
    { value: "CLEAR", label: tr("Ясно") },
    { value: "CLOUDS", label: tr("Облачно") },
    { value: "RAIN", label: tr("Дождь") },
    { value: "SNOW", label: tr("Снег") },
  ];
  const controls = (
    <SegmentedControl
      label={tr("Погода")}
      size="md"
      options={options}
      value={weather}
      onChange={(next) => WEATHERS.includes(next) && setWeather(next)}
    />
  );
  return (
    <>
      {slot && createPortal(controls, slot)}
      <div className="pv-sky">
        <SkyStage
          state={state}
          hour={hour}
          onHourChange={setHour}
          band={band}
          selected={[]}
          conditions={conditions}
          share
          /* Сутки идут сами с открытия и по кругу; бегунок и кнопка ставят на паузу, скрытое окно и «меньше анимации» — тоже (`useDayPlay`). */
          dayPlay={DAY_PLAY}
          /* Первый кадр неба нарисован — окно проявляет сцену поверх фото (`PreviewWindow`). */
          onReady={onReady}
        />
      </div>
    </>
  );
}
