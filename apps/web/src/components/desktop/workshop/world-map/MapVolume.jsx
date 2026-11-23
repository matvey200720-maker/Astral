import { VOLUME_HEIGHT_RANGE, normalizeRadarTilt } from "@modovik/vector-map";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { Buildings } from "../../../ui/icons.jsx";
import { radarIsVector, tiltAvailable } from "./tilt-gate.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * «3D-здания» (21.11.2026): строка-выключатель первой страницы колонки «Карта» — как «Сетка координат».
 *
 * Здания настоящие и только в мини-карте (`radarBuildings` в `@modovik/vector-map`): стенки стопкой слоёв, крыша светлее, высоты по
 * районам, цвета из палитры карты. На большой карте паузы объёма нет — она остаётся плоской картинкой. Кварталы берутся из геометрии
 * радара игры, поэтому у карты-картинки (снимок, готовая карта-растр) рисовать нечего: строка говорит об этом, а не молчит.
 *
 * Здания без наклона читаются плоско, поэтому включение зданий включает и наклон радара — одной записью проекта.
 */

/**
 * Можно ли нарисовать здания: подложка — карта из игры или векторная готовая карта (пак Akio и подобные: у них кварталы лежат
 * отдельным слоем по высоте). То же правило, что у `radarBuildings` (`tilt-gate.js`).
 */
export const volumeBuildingsAvailable = radarIsVector;

/**
 * Строка «3D-здания» с высотой под выключателем. `onSection` — запись нескольких частей проекта разом (здания и наклон радара одной
 * отменой), `patchBase` — запись одной базы.
 */
export default function VolumeLines({ config, patchBase, onSection }) {
  useTr();
  const base = config.base;
  const available = volumeBuildingsAvailable(config);
  const buildings = Boolean(base.volumeBuildings);

  const setBuildings = (volumeBuildings) => {
    const label = volumeBuildings ? tr("3D-здания включены") : tr("3D-здания выключены");
    const tilt = normalizeRadarTilt(config.radar?.tilt);
    /* Включение зданий включает и наклон, если он доступен и выключен: сила — какая была. Выключение зданий наклон не трогает. */
    if (volumeBuildings && available && tiltAvailable(config) && !tilt.on)
      onSection(
        { base: { ...base, volumeBuildings }, radar: { ...config.radar, tilt: { ...tilt, on: true } } },
        label,
        "base.volumeBuildings",
      );
    else patchBase({ volumeBuildings }, label, "base.volumeBuildings");
  };

  return (
    <>
      <label className="ui-field wmc-switch-line wmc-list-switch" data-map-volume="buildings">
        <span>
          <Buildings aria-hidden="true" />
          {tr("3D-здания")}
        </span>
        <Switch checked={buildings} label={tr("3D-здания")} onChange={setBuildings} />
      </label>
      {buildings && !available && (
        <small className="wmc-hint wmc-list-sub" data-map-volume-note="unavailable">
          {tr("Здания рисуются у карты из игры и у векторных готовых карт. У снимка и карты-картинки кварталов нет.")}
        </small>
      )}
      {buildings && available && (
        <div className="wmc-list-sub">
          <Slider
            label={tr("Высота зданий")}
            value={base.volumeHeight}
            min={VOLUME_HEIGHT_RANGE[0]}
            max={VOLUME_HEIGHT_RANGE[1]}
            unit={tr("м")}
            onChange={(volumeHeight) => patchBase({ volumeHeight }, tr("Высота зданий"), "base.volumeHeight")}
          />
          <small className="wmc-hint" data-map-volume-note="where">
            {tr("В мини-карте здания настоящие (стенки, высоты по районам). На карте паузы объёма нет.")}
          </small>
        </div>
      )}
    </>
  );
}
