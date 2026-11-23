/*
 * Панель эффектов попадания на экране — настройки взятого инструмента
 * (мастерская «как в Photoshop»): картинка следа, цвет, вид, время и
 * готовые виды.
 *
 * Органы — из словаря (`components/ui`), разделы — `ui-panel fx-section`,
 * как у остальных редакторов; цвет — общее поле эффектов мастерской
 * (один цвет или два — низ и верх экрана: другие эффекты игра не умеет).
 */

import { memo, useEffect, useMemo, useRef } from "react";
import { UploadSimple } from "../../../components/ui/icons.jsx";
import {
  SCREEN_HITS_COUNT_LABELS,
  SCREEN_HITS_LIMITS,
  SCREEN_HITS_PRESETS,
  SCREEN_HITS_SHAPES,
  SCREEN_HITS_SHAPE_LABELS,
  SCREEN_HITS_STOCK_OPACITY,
  applyScreenHitsPreset,
  matchingScreenHitsPreset,
  screenHitsCounted,
  screenHitsIsVanilla,
} from "@modovik/kill-effects/screen-hits.js";
import Button from "../../../components/ui/Button.jsx";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import { context2d } from "../../../components/desktop/workshop/canvas-surface.js";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import { SCREEN_HIT_PICTURE_TYPES } from "./screen-hit-pictures.js";
import { paintScreenHitsTile, screenHitsMaskCanvas, screenHitsMaskPreview } from "./screen-hits-painter.js";
import { tr, useTr } from "../../../locales/ui.js";

const SWATCHES = Object.freeze(["#d4202a", "#8f0d14", "#ff3b3b", "#ff7a00", "#ffd400", "#e8eef5", "#00e5ff", "#7a5cff", "#ff2bd6", "#1f1f1f"]);
const COLOUR_MODES = Object.freeze(["solid", "gradient"]);
const SHAPE_NOTES = Object.freeze({
  game: "Капля Rockstar — как сейчас в игре",
  soft: "Ровное свечение без формы",
  splash: "Пятно и брызги к центру",
  drops: "Стекающие капли",
  scratches: "Следы когтей",
  cracks: "Трещины, как на стекле",
  haze: "Мягкая дымка",
  own: "Ваш файл PNG, JPG или WebP",
});

export const percentText = (value) => `${Math.round(value)} %`;
export const secondsText = (ms) => `${String(Math.round(ms / 10) / 100).replace(".", ",")} с`;

function Section({ title, label, action = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      {action ? (
        <header className="fx-section-head">
          <h3>{title}</h3>
          {action}
        </header>
      ) : (
        <h3>{title}</h3>
      )}
      {children}
    </section>
  );
}

/* Холст плитки: рисует `paint(context, width, height)` один раз на смену `deps`. */
function TileCanvas({ width, height, paint, deps, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = context2d(canvas);
    if (!context) return;
    canvas.width = width;
    canvas.height = height;
    paint(context, width, height);
    // Перерисовка — по зависимостям вызывающего.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <canvas ref={ref} className="screen-hits-tile" width={width} height={height} aria-label={label} role="img" />;
}

function ShapeArt({ project, shape, drop, picture }) {
  const preview = useMemo(() => {
    const look = { ...project, shape, count: shape === "own" ? project.count : Math.min(project.count, 5) };
    return screenHitsMaskPreview(look, { drop, picture });
  }, [project, shape, drop, picture]);
  return (
    <TileCanvas
      width={96}
      height={96}
      deps={[preview]}
      label={`Картинка следа: ${SCREEN_HITS_SHAPE_LABELS[shape]}`}
      paint={(context, width, height) => {
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);
        if (preview) context.drawImage(preview, 0, 0, width, height);
      }}
    />
  );
}

function ShapeFields({ project, drop, picture, pictureBusy, pictureError, onPicture, onChange }) {
  useTr();
  const fileRef = useRef(null);
  const pickFile = () => fileRef.current?.click();
  const own = project.shape === "own";
  return (
    <Section title={tr("Картинка следа")} label={tr("Картинка следа")}>
      <div className="screen-hits-shapes" role="group" aria-label={tr("Картинка следа")}>
        {SCREEN_HITS_SHAPES.map((shape) => (
          <ChoiceTile
            key={shape}
            className="screen-hits-shape"
            media={<ShapeArt project={project} shape={shape} drop={drop} picture={picture} />}
            title={SCREEN_HITS_SHAPE_LABELS[shape]}
            tooltip={tr(SHAPE_NOTES[shape])}
            selected={project.shape === shape}
            onClick={() => {
              if (shape === "own" && !project.own.asset) {
                pickFile();
                return;
              }
              onChange({ shape }, `Картинка: ${SCREEN_HITS_SHAPE_LABELS[shape]}`);
            }}
          />
        ))}
      </div>
      <input
        ref={fileRef}
        className="lamp-picture-input"
        type="file"
        accept={SCREEN_HIT_PICTURE_TYPES.join(",")}
        aria-label={tr("Своя картинка следа")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPicture?.(file);
        }}
      />
      <div className="lamp-picture-row">
        <span className="lamp-note">
          {pictureError
            ? pictureError
            : project.own.asset
              ? picture
                ? `Своя картинка: «${project.own.name}»`
                : `Картинки «${project.own.name}» нет на этом компьютере — выберите файл заново`
              : tr("Своя картинка: PNG с прозрачностью ложится силуэтом, у фото видно светлое")}
        </span>
        <Button variant="ghost" size="sm" icon={<UploadSimple />} disabled={pictureBusy} onClick={pickFile}>
          {pictureBusy ? tr("Читаем…") : project.own.asset ? tr("Другая картинка") : tr("Загрузить картинку")}
        </Button>
      </div>
      {own && (
        <div className="lamp-picture-row">
          <span className="lamp-note">{tr("Видно тёмное, а не светлое")}</span>
          <Switch
            checked={project.own.invert}
            label={tr("Видно тёмное, а не светлое")}
            onChange={(invert) => onChange({ own: { ...project.own, invert } }, invert ? tr("Своя картинка: тёмное") : tr("Своя картинка: светлое"))}
          />
        </div>
      )}
      {screenHitsCounted(project.shape) ? (
        <Slider
          label={tr("Количество")}
          value={project.count}
          min={SCREEN_HITS_LIMITS.count[0]}
          max={SCREEN_HITS_LIMITS.count[1]}
          step={1}
          format={(value) => String(value)}
          editable
          onChange={(count) => onChange({ count }, "Количество")}
        />
      ) : null}
      <p className="fx-hint">
        Как часто след появляется, решает игра: он встаёт на каждое попадание по вам, со стороны выстрела. «Количество» —
        {screenHitsCounted(project.shape) ? ` ${SCREEN_HITS_COUNT_LABELS[project.shape]}` : tr(" пятна")} в одном следе; реже на
        экране — короче «Длительность» во «Времени». Цвета картинки в игру не едут: игра берёт у неё форму и яркость и красит
        «Цветом»; низ картинки — там, где капля игры ярче всего.
      </p>
    </Section>
  );
}

function ColourFields({ project, onChange }) {
  useTr();
  return (
    <Section
      title={tr("Свой цвет")}
      label={tr("Цвет следа")}
      action={<Switch checked={project.tint} label={tr("Свой цвет следа")} onChange={(tint) => onChange({ tint }, tint ? tr("Свой цвет следа") : tr("Цвет как в игре"))} />}
    >
      {project.tint ? (
        <ColourEffectField
          label={tr("Цвет следа")}
          value={project.look}
          modes={COLOUR_MODES}
          directions={false}
          swatches={SWATCHES}
          colourLabels={() => ({ first: tr("Внизу экрана"), second: tr("Вверху экрана") })}
          hints={{ gradient: tr("У игры у следа два цвета: для низа экрана и для верха — след между ними берёт смесь.") }}
          onChange={(look, step) => onChange({ look }, step)}
        />
      ) : (
        <p className="fx-hint">{tr("Цвет Rockstar: красный, внизу экрана светлее, вверху темнее.")}</p>
      )}
    </Section>
  );
}

function LookFields({ project, onChange }) {
  useTr();
  return (
    <Section title={tr("Вид")} label={tr("Вид следа")}>
      {/* Как читать ползунки — у их имени, а не абзацами под ними
          (18.10.2026, владелец: панели «перегружены»). */}
      <Slider
        label={
          <span
            title={`${tr("В игре —")} ${SCREEN_HITS_STOCK_OPACITY} ${tr("% вверху экрана и вдвое прозрачнее внизу; 0 % — следа нет совсем. По умолчанию здесь прозрачнее игры, чтобы след не лез в глаза.")}`}
          >
            {tr("Непрозрачность")}
          </span>
        }
        ariaLabel={tr("Непрозрачность")}
        value={project.opacity}
        min={SCREEN_HITS_LIMITS.opacity[0]}
        max={SCREEN_HITS_LIMITS.opacity[1]}
        step={1}
        format={percentText}
        editable
        onChange={(opacity) => onChange({ opacity }, "Непрозрачность")}
      />
      <div className="screen-hits-size" title={tr("Размер — длина и ширина следа от края экрана к центру; разброс — насколько широко он расходится вдоль края. 100 % — как в игре.")}>
      <Slider
        label={tr("Размер")}
        value={project.size}
        min={SCREEN_HITS_LIMITS.size[0]}
        max={SCREEN_HITS_LIMITS.size[1]}
        step={5}
        format={percentText}
        editable
        onChange={(size) => onChange({ size }, "Размер")}
      />
      <Slider
        label={tr("Разброс по экрану")}
        value={project.spread}
        min={SCREEN_HITS_LIMITS.spread[0]}
        max={SCREEN_HITS_LIMITS.spread[1]}
        step={5}
        format={percentText}
        editable
        onChange={(spread) => onChange({ spread }, "Разброс по экрану")}
      />
      </div>
    </Section>
  );
}

function TimeFields({ project, onChange }) {
  useTr();
  return (
    <Section title={tr("Время")} label={tr("Время следа")}>
      <Slider
        label={tr("Появление")}
        value={project.appear}
        min={SCREEN_HITS_LIMITS.appear[0]}
        max={SCREEN_HITS_LIMITS.appear[1]}
        step={5}
        format={secondsText}
        editable
        onChange={(appear) => onChange({ appear }, "Появление")}
      />
      <Slider
        label={tr("Длительность")}
        value={project.hold}
        min={SCREEN_HITS_LIMITS.hold[0]}
        max={SCREEN_HITS_LIMITS.hold[1]}
        step={10}
        format={secondsText}
        editable
        onChange={(hold) => onChange({ hold }, "Длительность")}
      />
      <Slider
        label={tr("Затухание")}
        value={project.fade}
        min={SCREEN_HITS_LIMITS.fade[0]}
        max={SCREEN_HITS_LIMITS.fade[1]}
        step={10}
        format={secondsText}
        editable
        onChange={(fade) => onChange({ fade }, "Затухание")}
      />
      <p className="fx-hint">
        {tr("След нарастает за «Появление», держится «Длительность» и гаснет за «Затухание». В игре — 0,08 с, 0,4 с и 0,2 с.")}
      </p>
    </Section>
  );
}

/*
 * «Убрать совсем» (ТЗ 17.10.2026, вечер): следа по краю экрана нет ни от
 * третьего лица, ни от первого — в игру уходит прозрачность ноль. Картинка,
 * цвет, размер и время хранятся и вернутся. Подпись говорит, что остаётся:
 * красноватая виньетка, серость и пульс экрана при ранении — это таймцикл,
 * его выключает слой «Экран при ранении» в «Оптимизации».
 */
function OffFields({ project, onChange }) {
  useTr();
  const off = project.off === true;
  return (
    <Section title={tr("Убрать совсем")} label={tr("Убрать совсем")}>
      <div className="fx-switch-row">
        <Switch
          checked={off}
          label={off ? tr("Вернуть след на экране") : tr("Убрать след на экране совсем")}
          onChange={(next) => onChange({ off: next }, null)}
        />
        <span>{tr("Убрать след на экране совсем")}</span>
      </div>
      {/* Одна подсказка: в две строки, щелчок раскрывает целиком. */}
      <p className="fx-hint">
        {off
          ? tr("Следа по краю экрана нет — ни от третьего лица, ни от первого. Картинка, цвет, размер и время сохранены и вернутся вместе со следом.")
          : tr("Уберёт красный след по краям экрана, когда попадают по вам: прозрачность в игре станет нулём. Настройки останутся.")}{" "}
        {tr("Остаются: красноватая виньетка, серость и пульс экрана при ранении — их выключает слой «Экран при ранении» в «Оптимизации»; размытие и тряска камеры; эффекты, которые рисует сервер, файлом игры не отключаются.")}
      </p>
    </Section>
  );
}

/* След убран: картинку, цвет и время настраивать нечего. */
function OffNote({ onRestore }) {
  useTr();
  return (
    <Section title={tr("След убран")} label={tr("След убран")}>
      <p className="fx-hint">{tr("След на экране убран совсем. Верните его, чтобы настроить картинку, цвет и время.")}</p>
      <Button size="sm" variant="secondary" onClick={onRestore}>
        {tr("Вернуть след на экране")}
      </Button>
    </Section>
  );
}

function PresetArt({ project, presetId, drop, picture }) {
  useTr();
  const look = useMemo(() => applyScreenHitsPreset(project, presetId), [project, presetId]);
  const mask = useMemo(() => screenHitsMaskCanvas(look, { drop, picture }), [look, drop, picture]);
  return (
    <TileCanvas
      width={192}
      height={108}
      deps={[look, mask]}
      label={tr("Готовый вид: след крупно")}
      paint={(context, width, height) => paintScreenHitsTile({ context, width, height, project: look, mask })}
    />
  );
}

const ScreenHitsPresets = memo(function ScreenHitsPresets({ project, drop, picture, onPreset }) {
  useTr();
  const current = matchingScreenHitsPreset(project);
  return (
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды следа")} count={SCREEN_HITS_PRESETS.length} className="recolor-presets" collapsible={false}>
      {SCREEN_HITS_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<PresetArt project={project} presetId={preset.id} drop={drop} picture={picture} />}
          title={preset.label}
          tooltip={tr(preset.description)}
          onClick={() => onPreset(preset)}
        />
      ))}
    </PresetShelf>
  );
});

/* «Стандарт GTA» — след Rockstar целиком: капля, цвет, прозрачность и время. */
function StandardSection({ project, onStandard }) {
  useTr();
  const standard = screenHitsIsVanilla(project);
  return (
    <Section
      title={tr("Стандарт GTA")}
      action={
        <Button size="sm" variant="secondary" disabled={standard} onClick={onStandard}>
          {standard ? tr("Уже как в игре") : tr("Вернуть как в игре")}
        </Button>
      }
    >
      <p className="fx-hint">{tr("Капля Rockstar, её красный цвет, прозрачность и время — как в ванильной GTA V.")}</p>
    </Section>
  );
}

export default function ScreenHitsInspector({ tool, project, presetProject = project, drop, picture, pictureBusy, pictureError, onPicture, onChange, onPreset, onStandard }) {
  const off = project.off === true;
  const restore = () => onChange({ off: false }, null);
  return (
    <div className="fx-inspector recolor-inspector screen-hits-inspector">
      {off && (tool === "shape" || tool === "colour" || tool === "time") && <OffNote onRestore={restore} />}
      {tool === "look" && <OffFields project={project} onChange={onChange} />}
      {!off && tool === "shape" && (
        <ShapeFields project={project} drop={drop} picture={picture} pictureBusy={pictureBusy} pictureError={pictureError} onPicture={onPicture} onChange={onChange} />
      )}
      {!off && tool === "colour" && <ColourFields project={project} onChange={onChange} />}
      {!off && tool === "look" && <LookFields project={project} onChange={onChange} />}
      {!off && tool === "time" && <TimeFields project={project} onChange={onChange} />}
      {tool === "templates" && (
        <>
          <StandardSection project={project} onStandard={onStandard} />
          <ScreenHitsPresets project={presetProject} drop={drop} picture={picture} onPreset={onPreset} />
        </>
      )}
    </div>
  );
}
