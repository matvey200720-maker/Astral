import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, FilmStrip } from "../../../ui/icons.jsx";
import {
  MINIMAP_FILL_DEFAULT_COLORS,
  MINIMAP_FILL_PRESETS,
  MINIMAP_TIER_FILL_COLORS,
  minimapFillActive,
  minimapFillPreset,
  normalizeMinimapFill,
} from "@modovik/minimap-contract";
import Button from "../../../ui/Button.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import FillCanvas from "./FillCanvas.jsx";
import { FILL_VIDEO_ACCEPT } from "./fill-video.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { useMinimapCopy } from "../minimap-lang.js";

/*
 * «Заливка полос» — инструмент «Цвета» (задача 8 ТЗ 05.10.2026; с задачи 15
 * ТЗ 10.10.2026 — без процентов: скорость тремя ступенями).
 *
 * У каждой полосы своя заливка: ровный цвет игры, готовая анимация
 * (два десятка видов, два своих цвета и скорость) или своё видео — оно
 * сжимается само (`fill-video.js`), пока не ляжет в мини-карту. Всё, что
 * здесь выбрано, уходит в игру: компилятор кладёт анимацию под маску
 * штатной полосы (`minimap-gfx-compiler.js`), и та открывается на долю HP,
 * не сжимаясь, а при малом HP краснеет цветом «Мало HP».
 *
 * Органы — общие: `SegmentedControl`, `ColorField`,
 * `Button` «Стандарт». Плитки видов рисует тот же холст, что полосу в кадре.
 */

const sides = () => [
  { value: "health", label: "HP" },
  { value: "armor", label: tr("Броня") },
];
const modes = () => [
  { value: "solid", label: tr("Цвет игры") },
  { value: "preset", label: tr("Анимация") },
  { value: "video", label: tr("Своё видео") },
];
const fits = () => [
  { value: "band", label: tr("Полоса из середины") },
  { value: "squeeze", label: tr("Кадр целиком") },
];
/*
 * Порог полосы (задача 8 ТЗ 10.10.2026): у полной полосы, ниже середины и
 * при малом запасе своя заливка. Середина HP — со ступенями («Цвет по
 * запасу»), малый порог HP — всегда (он у игры); у брони оба — со ступенями.
 * Своё видео — только у полной полосы.
 */
const TIER_FIELDS = Object.freeze({
  health: Object.freeze({ full: "healthFill", mid: "healthMidFill", low: "healthLowFill" }),
  armor: Object.freeze({ full: "armorFill", mid: "armorMidFill", low: "armorLowFill" }),
});
const TIER_COLORS = Object.freeze({
  health: Object.freeze({ mid: "healthMid", low: "healthLow" }),
  armor: Object.freeze({ mid: "armorMid", low: "armorLow" }),
});
const fieldOf = (side, tier = "full") => TIER_FIELDS[side === "health" ? "health" : "armor"][tier];
const defaultColorsOf = (side, tier) =>
  tier === "full"
    ? MINIMAP_FILL_DEFAULT_COLORS[side === "health" ? "health" : "armor"]
    : MINIMAP_TIER_FILL_COLORS[TIER_COLORS[side === "health" ? "health" : "armor"][tier]];

/*
 * Пороги этой полосы с подписями. «Цвет по запасу» снят (задача 15 ТЗ
 * 10.10.2026, вечер), и порогов середины больше нет: у HP — полная полоса и
 * малое HP игры, у брони — одна полная.
 */
function tiersOf(effects, side) {
  if (side === "health")
    return [
      { value: "full", label: tr("Полная") },
      ...(effects.healthTiers ? [{ value: "mid", label: `< ${effects.healthMidThreshold} %` }] : []),
      { value: "low", label: tr("Мало HP") },
    ];
  return [
    { value: "full", label: tr("Полная") },
    ...(effects.armorTiers
      ? [
          { value: "mid", label: `< ${effects.armorMidThreshold} %` },
          { value: "low", label: `< ${effects.armorLowThreshold} %` },
        ]
      : []),
  ];
}
/*
 * Скорость анимации — тремя ступенями, а не процентами (владелец: «убери
 * возможность выставлять проценты»). Числа — множители скорости вида; работа,
 * сохранённая с другим числом, показывает ближайшую ступень.
 */
const speeds = () => [
  { value: "0.5", label: tr("Медленно") },
  { value: "1", label: tr("Обычно") },
  { value: "2", label: tr("Быстро") },
];
const speedStep = (speed) =>
  ["0.5", "1", "2"].reduce((best, value) =>
    Math.abs(Number(value) - speed) < Math.abs(Number(best) - speed) ? value : best,
  );
const percent = (value) => `${Math.round(value * 100)}%`;

/* Тёмный и светлый тон цвета полосы — два цвета анимации по умолчанию. */
export function tonesOf(hex) {
  const channels = [1, 3, 5].map((at) => Number.parseInt(String(hex).slice(at, at + 2), 16) || 0);
  const mix = (target, share) =>
    `#${channels
      .map((channel) => Math.round(channel + (target - channel) * share).toString(16).padStart(2, "0"))
      .join("")}`;
  return [mix(0, 0.62), mix(255, 0.5)];
}

/**
 * Цвет полосы сменился: анимация, что шла за ним (её два цвета — тона прежнего цвета полосы, как их ставит первый выбор
 * вида), идёт за новым цветом. Белая полоса — и анимации красятся в белый (ТЗ 22.10). Цвета, тронутые руками, и виды со
 * своими цветами остаются. Возвращает правку полей заливки или `{}`.
 */
export function followBarColor(effects, side, nextColor) {
  const barSide = side === "health" ? "health" : "armor";
  const field = TIER_FIELDS[barSide].full;
  const defaults = MINIMAP_FILL_DEFAULT_COLORS[barSide];
  const fill = normalizeMinimapFill(effects[field], defaults);
  if (fill.mode !== "preset" || minimapFillPreset(fill.preset)?.colourful) return {};
  const previous = barSide === "health" ? effects.healthColor : effects.armorColor;
  if (fill.colors.join() !== tonesOf(previous).join()) return {};
  return { [field]: normalizeMinimapFill({ ...fill, colors: tonesOf(nextColor) }, defaults) };
}

function PresetTile({ item, fill, selected, onPick }) {
  const preview = { ...fill, mode: "preset", preset: item.id };
  return (
    <button
      type="button"
      className={`mmc-fill-preset${selected ? " is-active" : ""}`}
      aria-pressed={selected}
      onClick={() => onPick(item.id)}
    >
      <FillCanvas className="mmc-fill-swatch" fill={preview} aspect={7} still={!selected} />
      <span>{tr(item.label)}</span>
    </button>
  );
}

export default function MinimapFillPanel({
  effects,
  /* Длина полосы к толщине — у HP и у брони свои. */
  aspects,
  onFill,
  onVideo,
}) {
  useTr();
  const copy = useMinimapCopy();
  const [side, setSide] = useState("health");
  const [pickedTier, setTier] = useState("full");
  const tiers = tiersOf(effects, side);
  /* Порог, которого больше нет (ступени выключили), — снова полная полоса. */
  const tier = tiers.some((item) => item.value === pickedTier) ? pickedTier : "full";
  const field = fieldOf(side, tier);
  const fill = normalizeMinimapFill(effects[field], defaultColorsOf(side, tier));
  const barColor =
    side === "health"
      ? { full: effects.healthColor, mid: effects.healthMidColor, low: effects.lowHealthColor }[tier]
      : { full: effects.armorColor, mid: effects.armorMidColor, low: effects.armorLowColor }[tier];
  const label = `${side === "health" ? "HP" : tr("брони")}${tier === "full" ? "" : ` (${tiers.find((item) => item.value === tier).label})`}`;
  const modeOptions = tier === "full" ? modes() : modes().filter((mode) => mode.value !== "video");
  /* Вкладку «Своё видео» можно открыть до загрузки: пока листа нет, полоса
     остаётся прежней. */
  const [view, setView] = useState(fill.mode);
  const [fit, setFit] = useState("band");
  const [work, setWork] = useState({ state: "idle", share: 0, error: "", noteParts: [] });
  const lastFile = useRef(null);
  useEffect(() => {
    setView(fill.mode);
    setWork({ state: "idle", share: 0, error: "", noteParts: [] });
    lastFile.current = null;
    // Новая полоса или порог — своя вкладка заливки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, tier]);

  const set = (patch, step) =>
    onFill(field, normalizeMinimapFill({ ...fill, ...patch }, defaultColorsOf(side, tier)), step);
  const pickMode = (mode) => {
    setView(mode);
    if (mode === "solid") set({ mode }, `${tr("Заливка")} ${label}: ${tr("цвет игры")}`);
    if (mode === "preset") {
      /* Первая анимация берёт тона цвета полосы, а не чужие по умолчанию. */
      const untouched = fill.mode === "solid" && fill.colors.join() === defaultColorsOf(side, tier).join();
      set({ mode, ...(untouched ? { colors: tonesOf(barColor) } : {}) }, `${tr("Заливка")} ${label}: ${tr("анимация")}`);
    }
    if (mode === "video" && fill.video) set({ mode }, `${tr("Заливка")} ${label}: ${tr("своё видео")}`);
  };
  const runVideo = async (file, nextFit = fit) => {
    if (!file) return;
    lastFile.current = file;
    setWork({ state: "busy", share: 0, error: "", noteParts: [] });
    try {
      const result = await onVideo(side, file, {
        fit: nextFit,
        aspect: aspects[side],
        onProgress: (share) => setWork((current) => ({ ...current, share })),
      });
      setWork({ state: "done", share: 1, error: "", noteParts: result?.noteParts || [] });
    } catch (error) {
      setWork({ state: "error", share: 0, error: error?.message || tr("Видео не получилось сжать."), noteParts: [] });
    }
  };

  /* Что значит «ровный цвет» у этого порога. */
  const solidHint =
    tier === "full"
      ? side === "health"
        ? tr("Ровный цвет — «Цвет HP» выше, как у игры.")
        : tr("Ровный цвет — «Цвет брони» выше, как у игры.")
      : side === "health" && tier === "low"
        ? minimapFillActive(effects.healthFill)
          ? tr("Ровный цвет — анимация полной полосы краснеет цветом малого HP, как в игре.")
          : tr("Ровный цвет — «Цвет малого HP» выше, с миганием игры.")
        : tr("Ровный цвет — цвет полосы.");

  const item = minimapFillPreset(fill.preset);
  const colourful = Boolean(item?.colourful);
  const colourNames = item?.kind === "static" ? [tr("Начало"), tr("Конец")] : [tr("Тёмный тон"), tr("Светлый тон")];

  return (
    <section className="ui-panel mmc-panel-section mmc-fill-panel" aria-label={tr("Заливка полос")}>
      <div className="mmc-fill-head">
        <h3>{tr("Заливка полос")}</h3>
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowCounterClockwise />}
          disabled={fill.mode === "solid" && view === "solid"}
          onClick={() => {
            setView("solid");
            onFill(
              field,
              normalizeMinimapFill(null, defaultColorsOf(side, tier)),
              `${tr("Заливка")} ${label}: ${tr("стандарт")}`,
            );
          }}
        >
          {tr("Стандарт")}
        </Button>
      </div>
      <SegmentedControl label={tr("Полоса")} size="sm" value={side} onChange={setSide} options={sides()} />
      {tiers.length > 1 && (
        <SegmentedControl label={tr("Порог")} size="sm" value={tier} onChange={setTier} options={tiers} />
      )}
      <SegmentedControl
        className="mmc-fill-modes"
        label={`${tr("Заливка")} ${label}`}
        size="sm"
        value={view}
        onChange={pickMode}
        options={modeOptions}
      />

      {view === "solid" && (
        <p className="mmc-section-hint">
          {solidHint}
        </p>
      )}

      {view === "preset" && (
        <>
          <div className="mmc-fill-presets" role="group" aria-label={tr("Готовые анимации")}>
            {MINIMAP_FILL_PRESETS.map((preset) => (
              <PresetTile
                key={preset.id}
                item={preset}
                fill={fill}
                selected={fill.mode === "preset" && fill.preset === preset.id}
                onPick={(id) => set({ mode: "preset", preset: id }, `${tr("Заливка")} ${label}: ${tr(minimapFillPreset(id).label)}`)}
              />
            ))}
          </div>
          {colourful ? (
            <p className="mmc-section-hint">{tr("Цвета у этого вида свои — меняется скорость.")}</p>
          ) : (
            <>
              <ColorField
                label={colourNames[0]}
                value={fill.colors[0]}
                editable
                onChange={(value) => set({ colors: [value, fill.colors[1]] }, `${tr("Заливка")} ${label}: ${colourNames[0].toLowerCase()}`)}
              />
              <ColorField
                label={colourNames[1]}
                value={fill.colors[1]}
                editable
                onChange={(value) => set({ colors: [fill.colors[0], value] }, `${tr("Заливка")} ${label}: ${colourNames[1].toLowerCase()}`)}
              />
            </>
          )}
          {item?.kind !== "static" && (
            <div className="mmc-choice-row">
              <span>{tr("Скорость")}</span>
              <SegmentedControl
                label={tr("Скорость")}
                size="sm"
                value={speedStep(fill.speed)}
                onChange={(value) => set({ speed: Number(value) }, `${tr("Заливка")} ${label}: ${tr("скорость")}`)}
                options={speeds()}
              />
            </div>
          )}
        </>
      )}

      {view === "video" && (
        <>
          <SegmentedControl
            label={tr("Что взять из кадра")}
            size="sm"
            value={fit}
            onChange={(next) => {
              setFit(next);
              if (lastFile.current) runVideo(lastFile.current, next);
            }}
            options={fits()}
          />
          <label className={`mmc-asset-upload${work.state === "busy" ? " is-busy" : ""}`}>
            <span>
              <FilmStrip />
              {fill.video ? fill.video.name || tr("Видео") : tr("Видео, GIF или WebP")}
            </span>
            <input
              type="file"
              accept={FILL_VIDEO_ACCEPT}
              disabled={work.state === "busy"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                runVideo(file);
              }}
            />
            <b>{work.state === "busy" ? `${tr("Сжимаю…")} ${percent(work.share)}` : fill.video ? tr("Заменить") : tr("Загрузить")}</b>
          </label>
          {fill.video && work.state !== "busy" && (
            <p className="mmc-section-hint" data-testid="fill-video-info">
              {copy.videoInfo({
                frames: fill.video.frames,
                fps: fill.video.fps,
                seconds: String(Math.round((fill.video.frames / fill.video.fps) * 10) / 10).replace(".", copy.decimal),
                width: fill.video.width,
                height: fill.video.height,
                notes: work.noteParts.length ? work.noteParts
                      .map((part) =>
                        copy[part.kind](part.kind === "noteSeconds" ? String(part.value).replace(".", copy.decimal) : part.value),
                      )
                      .join(", ") : "",
              })}
            </p>
          )}
          {work.state === "error" && (
            <p className="mmc-section-hint is-error" role="alert">
              {work.error}
            </p>
          )}
          {!fill.video && work.state !== "error" && (
            <p className="mmc-section-hint">
              {tr("Ролик сожмётся сам до мини-карты: до трёх секунд и девяноста кадров, полосой 900 КБ и меньше.")}
            </p>
          )}
        </>
      )}

      {view !== "solid" && (
        <p className="mmc-section-hint">
          {side === "health"
            ? tr("В игре анимация открывается на долю HP и не сжимается")
            : tr("В игре анимация открывается на долю брони и не сжимается")}
          {side === "health" && tier === "full" && !minimapFillActive(effects.healthLowFill)
            ? tr("; при малом HP она краснеет цветом «Мало HP»")
            : ""}
          .
        </p>
      )}
    </section>
  );
}
