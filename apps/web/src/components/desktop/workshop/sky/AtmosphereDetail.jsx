import { memo, useCallback, useRef } from "react";
import {
  ATMOSPHERE_DETAIL_GROUPS,
  atmosphereDetailPatch,
  atmosphereDetailRows,
  atmosphereDetailValue,
} from "@modovik/timecycle";
import Button from "../../../ui/Button.jsx";
import ColorSwatches from "../../../ui/ColorSwatches.jsx";
import Slider from "../../../ui/Slider.jsx";
import { ArrowCounterClockwise } from "../../../ui/icons.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Атмосфера, подробный уровень (21.11.2026): группы и органы собираются ИЗ ТАБЛИЦЫ `ATMOSPHERE_DETAIL_ROWS`
 * (`packages/timecycle/atmosphere-detail.js`), вёрстки по полям нет: одна строка-ползунок на все пункты, один ряд цветов на цветовые.
 * Строка таблицы знает подпись, единицу, границы, шаг и значение «как в игре»; здесь она только рисуется.
 * Каждый ползунок: подпись, значение (набирается и с клавиатуры) и «Как в игре» — сброс этого пункта.
 */

const formatRatio = (value) => `${Math.round(value * 100)} %`;

/** Значение ползунка словами: проценты от игры, метры или метры со знаком. */
function formatDetail(row, value) {
  if (row.unit === "metre") return `${Math.round(value)} ${tr("м")}`;
  if (row.unit === "metre-offset") {
    const rounded = Math.round(value);
    return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)} ${tr("м")}`;
  }
  return formatRatio(value);
}

const DetailRow = memo(function DetailRow({ row, value, onChange }) {
  useTr();
  const label = tr(row.label);
  const name = tr(row.aria || row.label);
  if (row.kind === "colour") {
    return (
      <ColorSwatches
        label={label}
        value={value}
        onChange={(colour) => onChange(row, colour)}
        colours={row.swatches.filter(Boolean)}
        auto={row.swatches.includes(null) ? "Как в игре" : ""}
      />
    );
  }
  const reset = (
    <Button
      variant="ghost"
      size="sm"
      icon={<ArrowCounterClockwise />}
      ariaLabel={`${tr("Как в игре")}: ${name}`}
      title={tr("Как в игре")}
      disabled={value === row.default}
      onClick={() => onChange(row, row.default)}
    />
  );
  /* Своё число у «ставит число» пунктов: пока его нет, бегунок стоит на `rest`, а значение говорит «Как в игре». */
  const free = row.mode === "set" && value === null;
  return (
    <div className="sky-detail-row">
      <Slider
        label={label}
        ariaLabel={name}
        value={free ? row.rest : value}
        min={row.min}
        max={row.max}
        step={row.step}
        format={(shown) => (free ? tr("Как в игре") : formatDetail(row, shown))}
        onChange={(next) => onChange(row, next)}
      />
      {reset}
    </div>
  );
});

export default function AtmosphereDetail({ atmosphere, onAtmosphere, flares = true }) {
  useTr();
  /* Обработчик один на все строки: строка перерисовывается только когда меняется её собственное значение. */
  const latest = useRef({ atmosphere, onAtmosphere });
  latest.current = { atmosphere, onAtmosphere };
  const change = useCallback((row, value) => {
    const { atmosphere: current, onAtmosphere: commit } = latest.current;
    commit(atmosphereDetailPatch(current, row, value), `atmosphere:${row.id}`);
  }, []);
  return (
    <div className="sky-detail">
      {ATMOSPHERE_DETAIL_GROUPS.map((group) => (
        <div
          key={group.id}
          className="sky-detail-group"
          role="group"
          aria-label={tr(group.label)}
        >
          <h4>{tr(group.label)}</h4>
          {atmosphereDetailRows(group.id).map((row) => (
            <DetailRow
              key={row.id}
              row={row}
              value={atmosphereDetailValue(atmosphere, row)}
              onChange={change}
            />
          ))}
          <p className="fx-hint">{tr(group.hint)}</p>
          {/* «Блики выключены» сильнее лучей: light_ray_mult — ноль во всех срезах (слово владельца 22.11.2026), органы честно подписаны. */}
          {!flares && group.id === "rays" && <p className="fx-hint">{tr("Блики выключены: лучи от солнца погашены, эти пункты заработают, когда блики включены.")}</p>}
        </div>
      ))}
    </div>
  );
}
