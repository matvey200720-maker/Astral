/*
 * Знак на килле — панель одноимённого инструмента килл-эффекта.
 *
 * На убийство игра показывает над прицелом крестик; здесь вместо него
 * ставят свою картинку: значок, эмодзи, надпись или свой файл — картинку
 * или гифку, — и выбирают, как она появится, что будет делать и как уйдёт.
 * Сначала — готовое движение («Хлопок», «Вертушка», «Пульс»…), потом ручки
 * под ним: сила, скорость вращения, размер, место. Ручки, которых выбранное
 * движение не читает, не показываются: скорость вращения у «Пульса» была бы
 * ползунком без дела.
 *
 * Раздел честен о том, где знак не появится: пока не целишься (крестик игра
 * рисует только вместе с прицелом), в снайперской оптике (у неё свои
 * отметки) и когда «Отметка попадания» выключена в прицеле Astral.
 */

import { useRef } from "react";
import {
  KILL_MARKER_EMOJI,
  KILL_MARKER_ENTERS,
  KILL_MARKER_EXITS,
  KILL_MARKER_ICONS,
  KILL_MARKER_LIMITS,
  KILL_MARKER_PRESETS,
  applyKillMarkerPreset,
  createKillMarker,
} from "@modovik/kill-effects";
import Button from "../../ui/Button.jsx";
import ChoiceTile from "../../ui/ChoiceTile.jsx";
import ColorField from "../../ui/ColorField.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import Select from "../../ui/Select.jsx";
import Slider from "../../ui/Slider.jsx";
import Switch from "../../ui/Switch.jsx";
import TextField from "../../ui/TextField.jsx";
import {
  KILL_MARKER_FILE_TYPES,
  killMarkerIconSvg,
} from "./kill-marker-frames.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { killCopyFor } from "./kill-lang.js";

const kinds = () => [
  { value: "icon", label: tr("Значок") },
  { value: "emoji", label: tr("Эмодзи") },
  { value: "text", label: tr("Надпись") },
  { value: "image", label: tr("Файл") },
];

/* Восемь образцов, как у остальных цветов колонки: девятый уезжает строкой
   ниже в колонке 336 точек. */
const MARKER_SWATCHES = Object.freeze([
  "#ffffff",
  "#ff2d2d",
  "#ff7a1a",
  "#ffd400",
  "#7cff3d",
  "#22d3ee",
  "#a78bfa",
  "#ff3df0",
]);
const OUTLINE_SWATCHES = Object.freeze([
  "#000000",
  "#1f2937",
  "#7f1d1d",
  "#ffffff",
]);

const directions = () => [
  { value: "cw", label: tr("По часовой") },
  { value: "ccw", label: tr("Против") },
];

/* Что читает каждое движение — остальные ручки не показываются. */
const amountLabel = (motion) =>
  ({
    swing: tr("Размах"),
    pulse: tr("Сила удара"),
    float: tr("Высота подъёма"),
    shake: tr("Сила дрожи"),
  })[motion];
const RHYTHM_MOTIONS = new Set(["swing", "pulse", "shake", "flip"]);

const iconSources = new Map();
function iconSource(id, colour) {
  const key = `${id}:${colour}`;
  if (!iconSources.has(key))
    iconSources.set(
      key,
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(killMarkerIconSvg(id, colour, 96))}`,
    );
  return iconSources.get(key);
}

const percent = (value) => `${Math.round(value)} %`;
const turns = (value) =>
  `${(value / 100).toFixed(2).replace(/\.?0+$/, "")}${tr(" об/с")}`;
const milliseconds = (value) =>
  value >= 1000
    ? `${(value / 1000).toFixed(2)}${tr(" с")}`
    : `${Math.round(value)}${tr(" мс")}`;
/* Точка сцены прицела — полтора пикселя на 1080p. */
const points = (value) => `${Math.round(value)} · ≈${Math.round(value * 1.5)} px`;
const shift = (value) => (value === 0 ? "0" : `${value > 0 ? "+" : "−"}${Math.abs(Math.round(value))}`);

function SourceFields({ marker, change, missing, busy, onPickFile, fileRef }) {
  useTr();
  const copy = killCopyFor(useUiLanguage());
  const source = marker.source;
  if (source.kind === "emoji")
    return (
      <>
        <div className="ui-choice-grid kill-marker-grid">
          {KILL_MARKER_EMOJI.map((item) => (
            <ChoiceTile
              key={item.emoji}
              className="kill-marker-tile"
              media={<span className="kill-marker-glyph">{item.emoji}</span>}
              title={tr(item.label)}
              selected={source.emoji === item.emoji}
              onClick={() => change({ source: { kind: "emoji", emoji: item.emoji } })}
            />
          ))}
        </div>
        <TextField
          label={tr("Своё эмодзи")}
          value={source.emoji}
          maxLength={16}
          hint={tr("Вставь любое или открой набор клавишами Win + .")}
          onChange={(value) =>
            change({ source: { kind: "emoji", emoji: value } })
          }
        />
      </>
    );
  if (source.kind === "text")
    return (
      <>
        <TextField
          label={tr("Надпись")}
          value={source.text}
          maxLength={12}
          hint={tr("До 12 знаков: -1, EZ, GG, свой ник")}
          onChange={(value) => change({ source: { ...source, text: value } })}
        />
        <ColorField
          label={tr("Цвет")}
          value={source.colour}
          swatches={MARKER_SWATCHES}
          onChange={(colour) => change({ source: { ...source, colour } })}
          ariaLabel={tr("Надпись знака: цвет")}
        />
        <ColorField
          label={tr("Обводка")}
          value={source.outline}
          swatches={OUTLINE_SWATCHES}
          onChange={(outline) => change({ source: { ...source, outline } })}
          ariaLabel={tr("Надпись знака: обводка")}
        />
      </>
    );
  if (source.kind === "image")
    return (
      <>
        <div className="fx-stamp">
          <div>
            <b>{source.asset ? source.name : tr("Картинка не выбрана")}</b>
            <small>
              {source.asset
                ? source.animated
                  ? copy.gifHint(source.frames)
                  : tr("Картинка уедет в игру как есть, со своими цветами")
                : tr("PNG или GIF с прозрачным фоном, WebP, JPG. До 32 кадров")}
            </small>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? tr("Читаем…") : source.asset ? tr("Заменить") : tr("Выбрать")}
          </Button>
        </div>
        {missing && (
          <p className="fx-stamp-warning" role="note">
            {source.asset
              ? tr("Картинки этой работы нет на этом компьютере — выбери её заново.")
              : tr("Картинки пока нет — до неё знак в игру не уедет.")}
          </p>
        )}
        {source.animated && (
          <>
            <Slider
              label={tr("Скорость гифки")}
              value={marker.playback}
              min={KILL_MARKER_LIMITS.playback.min}
              max={KILL_MARKER_LIMITS.playback.max}
              step={KILL_MARKER_LIMITS.playback.step}
              format={percent}
              onChange={(playback) => change({ playback })}
            />
            <div className="kill-channel-head">
              <b>{tr("Гифка по кругу")}</b>
              <Switch
                checked={marker.loop}
                label={tr("Гифка по кругу")}
                onChange={(loop) => change({ loop })}
              />
            </div>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={KILL_MARKER_FILE_TYPES.join(",")}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onPickFile(file);
          }}
        />
      </>
    );
  return (
    <>
      <div className="ui-choice-grid kill-marker-grid">
        {KILL_MARKER_ICONS.map((item) => (
          <ChoiceTile
            key={item.id}
            className="kill-marker-tile"
            media={
              <img
                className="kill-marker-icon"
                src={iconSource(item.id, source.kind === "icon" ? source.colour : "#ffffff")}
                alt=""
                draggable={false}
              />
            }
            title={tr(item.label)}
            selected={source.icon === item.id}
            onClick={() => change({ source: { ...source, icon: item.id } })}
          />
        ))}
      </div>
      <ColorField
        label={tr("Цвет")}
        value={source.colour}
        swatches={MARKER_SWATCHES}
        onChange={(colour) => change({ source: { ...source, colour } })}
        ariaLabel={tr("Значок знака: цвет")}
      />
    </>
  );
}

export default function KillMarkerSection({
  marker,
  onChange,
  onPickFile,
  missing = false,
  busy = false,
  hidden = false,
}) {
  useTr();
  const fileRef = useRef(null);
  const change = (patch) =>
    onChange(
      createKillMarker({
        ...marker,
        ...patch,
        /* Своя ручка движения — уже не готовое движение. */
        ...(patch.preset === undefined &&
        ["enter", "motion", "exit", "duration", "spinTurns", "spinDirection", "motionAmount", "motionSpeed"].some(
          (key) => key in patch,
        )
          ? { preset: null }
          : {}),
      }),
    );
  const pickKind = (kind) => {
    if (kind === marker.source.kind) return;
    const defaults = {
      icon: { kind: "icon", icon: "skull", colour: "#ffffff" },
      emoji: { kind: "emoji", emoji: KILL_MARKER_EMOJI[0].emoji },
      text: { kind: "text", text: "-1", colour: "#ffffff", outline: "#000000" },
      image: { kind: "image", asset: "", name: "", frames: 1 },
    };
    change({ source: defaults[kind] });
  };
  const kind = marker.source.kind;

  /* Раздел — вся панель инструмента «Знак на килле»: имя и строка «что это»
     стоят над ней (каркас), здесь — выключатель и сам знак. */
  return (
    <section className="ui-panel fx-section kill-marker" aria-label={tr("Знак на килле")}>
      <header className="fx-section-head">
        <h3>{tr("Знак на каждом убийстве")}</h3>
        <Switch
          checked={marker.enabled}
          label={tr("Включить: знак на килле")}
          onChange={(enabled) => change({ enabled })}
        />
      </header>
      {marker.enabled && (
        <>
          <SegmentedControl
            options={kinds()}
            value={kind}
            label={tr("Что показать")}
            className="kill-marker-kinds"
            onChange={pickKind}
          />
          <SourceFields
            marker={marker}
            change={change}
            missing={missing}
            busy={busy}
            onPickFile={onPickFile}
            fileRef={fileRef}
          />

          <div className="kill-channel">
            <div className="kill-channel-head">
              <b>{tr("Движение")}</b>
            </div>
            <div className="kill-marker-motions" role="group" aria-label={tr("Готовое движение")}>
              {KILL_MARKER_PRESETS.map((preset) => (
                <ChoiceTile
                  key={preset.id}
                  title={tr(preset.label)}
                  description={tr(preset.description)}
                  selected={marker.preset === preset.id}
                  onClick={() => onChange(applyKillMarkerPreset(marker, preset.id))}
                />
              ))}
            </div>
            {marker.motion === "spin" && (
              <>
                <Slider
                  label={tr("Скорость вращения")}
                  value={marker.spinTurns}
                  min={KILL_MARKER_LIMITS.spinTurns.min}
                  max={KILL_MARKER_LIMITS.spinTurns.max}
                  step={KILL_MARKER_LIMITS.spinTurns.step}
                  format={turns}
                  onChange={(spinTurns) => change({ spinTurns })}
                />
                <SegmentedControl
                  options={directions()}
                  value={marker.spinDirection}
                  label={tr("Куда крутится")}
                  size="sm"
                  onChange={(spinDirection) => change({ spinDirection })}
                />
              </>
            )}
            {amountLabel(marker.motion) && (
              <Slider
                label={amountLabel(marker.motion)}
                value={marker.motionAmount}
                min={KILL_MARKER_LIMITS.motionAmount.min}
                max={KILL_MARKER_LIMITS.motionAmount.max}
                step={KILL_MARKER_LIMITS.motionAmount.step}
                format={percent}
                onChange={(motionAmount) => change({ motionAmount })}
              />
            )}
            {RHYTHM_MOTIONS.has(marker.motion) && (
              <Slider
                label={tr("Темп")}
                value={marker.motionSpeed}
                min={KILL_MARKER_LIMITS.motionSpeed.min}
                max={KILL_MARKER_LIMITS.motionSpeed.max}
                step={KILL_MARKER_LIMITS.motionSpeed.step}
                format={percent}
                onChange={(motionSpeed) => change({ motionSpeed })}
              />
            )}
            <Select
              label={tr("Появление")}
              value={marker.enter}
              options={KILL_MARKER_ENTERS.map((item) => [item.id, tr(item.label)])}
              onChange={(enter) => change({ enter })}
            />
            <Select
              label={tr("Уход")}
              value={marker.exit}
              options={KILL_MARKER_EXITS.map((item) => [item.id, tr(item.label)])}
              onChange={(exit) => change({ exit })}
            />
            <Slider
              label={tr("Длительность")}
              value={marker.duration}
              min={KILL_MARKER_LIMITS.duration.min}
              max={KILL_MARKER_LIMITS.duration.max}
              step={KILL_MARKER_LIMITS.duration.step}
              format={milliseconds}
              onChange={(duration) => change({ duration })}
            />
          </div>

          <div className="kill-channel">
            <div className="kill-channel-head">
              <b>{tr("Размер и место")}</b>
            </div>
            <Slider
              label={tr("Размер")}
              hint={tr("Точки прицела; в скобках — пиксели на экране 1080p")}
              value={marker.size}
              min={KILL_MARKER_LIMITS.size.min}
              max={KILL_MARKER_LIMITS.size.max}
              step={KILL_MARKER_LIMITS.size.step}
              format={points}
              onChange={(size) => change({ size })}
            />
            <Slider
              label={tr("Выше или ниже прицела")}
              value={-marker.offsetY}
              min={-KILL_MARKER_LIMITS.offsetY.max}
              max={-KILL_MARKER_LIMITS.offsetY.min}
              step={KILL_MARKER_LIMITS.offsetY.step}
              format={shift}
              onChange={(value) => change({ offsetY: -value })}
            />
            <Slider
              label={tr("Левее или правее")}
              value={marker.offsetX}
              min={KILL_MARKER_LIMITS.offsetX.min}
              max={KILL_MARKER_LIMITS.offsetX.max}
              step={KILL_MARKER_LIMITS.offsetX.step}
              format={shift}
              onChange={(offsetX) => change({ offsetX })}
            />
            <Slider
              label={tr("Непрозрачность")}
              value={marker.opacity}
              min={KILL_MARKER_LIMITS.opacity.min}
              max={KILL_MARKER_LIMITS.opacity.max}
              step={KILL_MARKER_LIMITS.opacity.step}
              format={percent}
              onChange={(opacity) => change({ opacity })}
            />
            <div className="kill-channel-head">
              <b>{tr("Крестик игры поверх знака")}</b>
              <Switch
                checked={marker.keepCross}
                label={tr("Крестик игры поверх знака")}
                onChange={(keepCross) => change({ keepCross })}
              />
            </div>
          </div>

          {hidden && (
            <p className="fx-stamp-warning" role="note">
              {tr("В прицеле Astral выключена «Отметка попадания» — на её месте пустой клип, и знак в игре не появится. Включи её в редакторе прицела.")}
            </p>
          )}
          <p className="fx-hint">
            {tr("Знак виден вместе с прицелом — пока целишься; в снайперской оптике у игры свои отметки, и знака там не будет.")}
          </p>
        </>
      )}
    </section>
  );
}
