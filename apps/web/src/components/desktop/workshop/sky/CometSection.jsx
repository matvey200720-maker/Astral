import { COMET_LIMITS, createComet } from "@modovik/timecycle";
import ColorSwatches from "../../../ui/ColorSwatches.jsx";
import { Sparkle } from "../../../ui/icons.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Комета (21.11.2026): выключатель и четыре настройки — скорость пролёта (секунды), как часто пролетает (минуты), длина хвоста (градусы), цвет.
 * Ночью по небу пролетает тело с хвостом — моделью в мире (`comet.js`); по умолчанию выключена, настройки живут и у выключенной.
 * Раздел показывает `SkyInspector` и только когда `COMET_AVAILABLE`: пока сборщик файлов игры не готов, раздела в окне нет.
 */
const COMET_COLOURS = Object.freeze([
  "#bfe3ff",
  "#ffffff",
  "#ffd27a",
  "#9fffd0",
  "#ff9a7a",
  "#c9a8ff",
]);

export default function CometSection({ comet, onComet }) {
  useTr();
  const current = comet || createComet();
  return (
    <section
      className="ui-panel fx-section"
      aria-label={tr("Комета")}
      data-sky-focus="night"
    >
      <h3>{tr("Комета")}</h3>
      <div className="sky-weather-row">
        <Sparkle aria-hidden="true" />
        <span>
          <b>{tr("Комета на небе")}</b>
          <small>
            {tr("Комета пролетает по ночному небу; видна на открытом месте")}
          </small>
        </span>
        <Switch
          checked={current.enabled}
          label={tr("Комета на небе")}
          onChange={(next) => onComet({ enabled: next }, "comet:toggle")}
        />
      </div>
      {current.enabled && (
        <>
          <Slider
            label={tr("Скорость пролёта")}
            value={current.speed}
            min={COMET_LIMITS.speed.min}
            max={COMET_LIMITS.speed.max}
            step={1}
            format={(value) => `${Math.round(value)} ${tr("с")}`}
            onChange={(speed) => onComet({ speed }, "comet:speed")}
          />
          <Slider
            label={tr("Как часто пролетает")}
            value={current.period}
            min={COMET_LIMITS.period.min}
            max={COMET_LIMITS.period.max}
            step={1}
            format={(value) => `${Math.round(value)} ${tr("мин")}`}
            onChange={(period) => onComet({ period }, "comet:period")}
          />
          <Slider
            label={tr("Длина хвоста")}
            value={current.tailLength}
            min={COMET_LIMITS.tailLength.min}
            max={COMET_LIMITS.tailLength.max}
            step={0.5}
            format={(value) => `${Number(value.toFixed(1))}°`}
            onChange={(tailLength) => onComet({ tailLength }, "comet:tail")}
          />
          <ColorSwatches
            label={tr("Цвет кометы")}
            colours={COMET_COLOURS}
            value={current.colour}
            onChange={(colour) => onComet({ colour }, "comet:colour")}
          />
        </>
      )}
    </section>
  );
}
