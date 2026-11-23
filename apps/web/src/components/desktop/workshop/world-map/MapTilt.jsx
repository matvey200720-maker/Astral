import { RADAR_TILT_STRENGTH } from "@modovik/vector-map";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { Cube } from "../../../ui/icons.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Наклон радара «как в машине» (21.11.2026): строка-выключатель первой страницы колонки «Карта» и под ней один ползунок — сила наклона.
 *
 * Это настоящая камера игры, а не картинка: штатный радар в машине лежит под углом 60°, центр сдвинут, стрелка игрока ниже. Ползунок —
 * доля от машины в процентах (`config.radar.tilt.strength`, `RADAR_TILT_STRENGTH`): 100 — как в машине, меньше — положе, угол
 * в градусах — 60 × сила / 100. Пешком и в машине вид один (`radarCarFields`); БОЛЬШОЙ радар остаётся как в игре (слово владельца
 * 22.11.2026: наклон на нём «неправильный»), поэтому рамки для него нет. Радар с 22.10 всегда векторный, поэтому строка стоит у любой
 * карты; закрыть её для карт-картинок можно одной константой (`tilt-gate.js`).
 *
 * Предпросмотр — две рамки с картинкой вида в перспективе CSS под одним и тем же углом: примерный вид, не кадр игры (подпись говорит
 * об этом).
 */

/** Угол штатного радара в машине, градусы: от него считается угол при любой силе. */
export const CAR_TILT_DEGREES = 60;

/** Угол наклона радара при силе в процентах: 100 → 60°, 40 → 24°. */
export const radarTiltAngle = (strength) => Math.round((CAR_TILT_DEGREES * strength) / 100);

/** Два режима мини-карты, которые наклоняются: ключ рамки и её подпись. Угол в обоих один. Большой радар не наш — штатный. */
const FRAMES = Object.freeze([
  { key: "foot", label: "Пешком" },
  { key: "vehicle", label: "В машине" },
]);

/** Строка «Наклон радара» с настройками под выключателем. `picture` — картинка вида для предпросмотра. */
export default function TiltLines({ tilt, patchTilt, picture = null }) {
  useTr();
  const angle = radarTiltAngle(tilt.strength);
  return (
    <>
      <label className="ui-field wmc-switch-line wmc-list-switch" data-map-tilt="switch">
        <span>
          <Cube aria-hidden="true" />
          {tr("Наклон радара")}
        </span>
        <Switch
          checked={tilt.on}
          label={tr("Наклон радара")}
          onChange={(on) =>
            patchTilt({ on }, on ? tr("Наклон радара включён") : tr("Наклон радара выключен"), "radar.tilt.on")
          }
        />
      </label>
      {tilt.on && (
        <div className="wmc-list-sub" data-map-tilt="settings">
          <small className="wmc-hint">
            {tr("Мини-карта в углу встаёт под углом, как в машине: дальний край меньше, значки и метка маршрута остаются прямо. Большой радар остаётся как в игре.")}
          </small>
          <Slider
            label={tr("Сила наклона")}
            hint={tr("100 % — как в машине")}
            value={tilt.strength}
            min={RADAR_TILT_STRENGTH[0]}
            max={RADAR_TILT_STRENGTH[1]}
            unit="%"
            onChange={(strength) => patchTilt({ strength }, tr("Сила наклона"), "radar.tilt.strength")}
          />
          <figure className="wmc-tilt-preview" data-map-tilt="preview" data-map-tilt-angle={angle}>
            <div className="wmc-tilt-frames">
              {FRAMES.map((frame) => (
                <div className="wmc-tilt-frame" key={frame.key} data-map-tilt-frame={frame.key}>
                  <div className="wmc-tilt-stage">
                    <div className="wmc-tilt-plane" style={{ "--wmc-tilt": `${angle}deg` }}>
                      {picture}
                    </div>
                  </div>
                  <span className="wmc-hint">
                    {tr(frame.label)} · {angle}°
                  </span>
                </div>
              ))}
            </div>
            <figcaption className="wmc-hint">
              {tr("Примерный вид радара под выбранным наклоном, не кадр игры. В игре он зависит от разрешения и скорости.")}
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
