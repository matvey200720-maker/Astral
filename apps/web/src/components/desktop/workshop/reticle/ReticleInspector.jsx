import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
} from "../../../ui/icons.jsx";
import {
  DOT_SHAPES,
  HOLDOVER_SHAPES,
  RETICLE_PIXELS_1080P,
  TICK_STYLES,
  VISIBILITY_MODES,
  ordinaryGameColours,
  reticleField,
} from "@modovik/reticle-contract";
import Button from "../../../ui/Button.jsx";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { armPatchLabel, lowerFor, pixelsAt1080 } from "../reticle-lang.js";
import { reticleReach } from "./ReticleArt.jsx";

/*
 * Панель инструмента прицела.
 *
 * Разделы — по частям прицела, как слои у эффектов: линии, точка, кольцо,
 * уголки, шеврон; затем то, что касается прицела целиком: цвет, обводка,
 * размер, видимость. В мастерской «как в Photoshop» (владелец, 03.10.2026)
 * каждый раздел — свой инструмент слева, и панель показывает только раздел
 * взятого (`tool`). Имя части — заголовок панели; в самом разделе остаётся
 * выключатель «В прицеле»: выключена часть — её полей нет.
 *
 * Границы ползунков берутся из контракта (`reticleField`): те же числа
 * проверяют проект и зажимают значения перед сборкой, и ползунок не может
 * обещать то, чего компилятор не примет.
 */

/* Быстрые цвета: то, чем красят прицелы на RP-серверах. Восемь — девятый
   переносится на вторую строку в колонке 336 px. */
export const RETICLE_SWATCHES = Object.freeze([
  "#ffffff",
  "#3dff5a",
  "#ffe600",
  "#38bdf8",
  "#ff4fd8",
  "#ff3b3b",
  "#b56cff",
  "#000000",
]);

const OUTLINE_SWATCHES = Object.freeze([
  "#000000",
  "#101419",
  "#1f2937",
  "#3b0a0a",
  "#ffffff",
]);

/* Шаг в полточки — но «14 px», а не «14.0 px»: дробь показывается, только
   когда она есть. */
const compactNumber = (value) => {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
};

/*
 * Ползунок поля. `min` сужает дорожку там, где ноль значит «части нет»: такую
 * часть убирает выключатель раздела, а ползунок, дотянутый до нуля, свернул
 * бы раздел прямо под рукой.
 */
/*
 * Непрозрачность прицела — и ползунком, и полосой палитры основного цвета
 * (ТЗ 22.10.2026, единый выбор цвета: «квадрат с прозрачностью»). Одно
 * значение, границы — из контракта.
 */
function opacityAlpha(kind, value, patch) {
  const item = reticleField(kind, "opacity");
  return {
    alpha: Math.min(1, Math.max(0, Number(value) / 100)),
    onAlphaChange: (alpha) => patch("opacity", Math.min(item.max, Math.max(item.min, Math.round(alpha * 100)))),
  };
}

function Field({ kind, name, value, onChange, label, hint, min }) {
  useTr();
  const item = reticleField(kind, name);
  return (
    <Slider
      editable
      label={tr(label || item.label)}
      hint={hint}
      value={value}
      min={min ?? item.min}
      max={item.max}
      step={item.step}
      unit={tr(item.unit)}
      format={item.step < 1 ? compactNumber : undefined}
      onChange={onChange}
    />
  );
}

/*
 * Раздел части прицела: выключатель «В прицеле», поля — только у включённой.
 * Заголовка нет: имя части стоит заголовком панели, второй такой же строкой
 * ниже он только отнимал бы место.
 */
function PartSection({ title, enabled, onToggle, hint, children }) {
  useTr();
  const language = useUiLanguage();
  return (
    <section className="ui-panel fx-section reticle-part" aria-label={title}>
      {onToggle && (
        <label className="ui-field reticle-toggle">
          <span>{tr("В прицеле")}</span>
          <Switch
            checked={enabled}
            label={`${enabled ? tr("Убрать") : tr("Добавить")}: ${lowerFor(language, title)}`}
            onChange={onToggle}
          />
        </label>
      )}
      {enabled && hint && <p className="fx-hint">{hint}</p>}
      {enabled && children}
    </section>
  );
}

/* Раздел прицела целиком (цвет, размер, видимость, оптика): заголовок у
   него — заголовок панели, имя остаётся читалке экрана. */
function WholeSection({ title, children }) {
  return (
    <section className="ui-panel fx-section" aria-label={title}>
      {children}
    </section>
  );
}

const ARM_ICONS = Object.freeze({
  armTop: ArrowUp,
  armRight: ArrowRight,
  armBottom: ArrowDown,
  armLeft: ArrowLeft,
});

/* Какие линии креста стоят: T-образный — без верхней. */
function ArmsControl({ config, onPatch }) {
  useTr();
  const language = useUiLanguage();
  const buttons = [
    ["armTop", tr("Сверху")],
    ["armRight", tr("Справа")],
    ["armBottom", tr("Снизу")],
    ["armLeft", tr("Слева")],
  ];
  return (
    <div className="reticle-arms" role="group" aria-label={tr("Какие линии стоят")}>
      {buttons.map(([key, label]) => {
        const Icon = ARM_ICONS[key];
        return (
          <Button
            key={key}
            variant="secondary"
            size="sm"
            block
            icon={<Icon />}
            active={config[key]}
            aria-pressed={config[key]}
            onClick={() =>
              onPatch(
                { [key]: !config[key] },
                armPatchLabel(language, key, !config[key]),
                key,
              )
            }
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}

function RingFields({ kind, config, patch }) {
  useTr();
  const segments = Math.round(config.ringSegments);
  return (
    <>
      <Field
        kind={kind}
        name="circleSize"
        value={config.circleSize}
        onChange={(v) => patch("circleSize", v)}
        label={tr("Диаметр")}
      />
      <Field
        kind={kind}
        name="ringThickness"
        value={config.ringThickness}
        onChange={(v) => patch("ringThickness", v)}
        label={tr("Толщина")}
      />
      <div className="reticle-choice-row">
        <span>{tr("Части")}</span>
        <SegmentedControl
          label={tr("Из скольких частей кольцо")}
          size="sm"
          value={String(segments)}
          onChange={(value) => patch("ringSegments", Number(value))}
          options={[
            { value: "1", label: tr("Целое") },
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "4", label: "4" },
            { value: "6", label: "6" },
            { value: "8", label: "8" },
          ]}
        />
      </div>
      {segments > 1 && (
        <>
          <Field
            kind={kind}
            name="ringGap"
            value={config.ringGap}
            onChange={(v) => patch("ringGap", v)}
            label={tr("Промежуток")}
          />
          <Field
            kind={kind}
            name="ringRotation"
            value={config.ringRotation}
            onChange={(v) => patch("ringRotation", v)}
            label={tr("Поворот частей")}
          />
        </>
      )}
    </>
  );
}

/* Отметка попадания в кадре: подпись постоянная, состояние — в `aria-pressed`: подпись, которая меняется вместе с
   ним, читалка произносит как обратное правде. */
function HitPreview({ config, hit, onHit }) {
  useTr();
  const off = config?.hitMarker === false;
  return (
    <Button
      variant="secondary"
      size="sm"
      block
      icon={<Crosshair />}
      active={hit && !off}
      aria-pressed={hit && !off}
      disabled={off}
      title={off ? tr("Отметка попадания убрана") : tr("Показать, как игра отмечает попадание")}
      onClick={() => onHit?.(!hit)}
    >
      {tr("Попадание")}
    </Button>
  );
}

/** Правка одного поля с подписью для журнала. */
const patcher = (kind, onPatch, language) => (name, value) => {
  const field = reticleField(kind, name);
  return onPatch(
    { [name]: value },
    `${tr("Изменено")}: ${field ? lowerFor(language, tr(field.label)) : name}`,
    name,
  );
};

/*
 * Обычный прицел: раздел взятого инструмента. Инструменты и их порядок —
 * `ORDINARY_TOOLS` в `ReticleCustomizer.jsx`; «Вид» и «Шаблоны» рисует сам
 * редактор.
 */
export function OrdinaryInspector({ tool, config, onPatch, hit = false, onHit = null }) {
  useTr();
  const language = useUiLanguage();
  const patch = patcher("ordinary", onPatch, language);
  const toggle = (name, on, extra = {}) =>
    onPatch(
      { [name]: on, ...extra },
      `${on ? tr("Добавлено") : tr("Убрано")}: ${lowerFor(language, tr(reticleField("ordinary", name).label))}`,
      name,
    );
  const colours = ordinaryGameColours(config);
  const lines =
    config.linesEnabled && config.length > 0 && config.thickness > 0;
  const dot = config.showCenterDot && config.dotSize > 0;
  switch (tool) {
    case "lines":
      return (
        <PartSection
          title={tr("Линии")}
          enabled={lines}
          onToggle={(on) =>
            toggle(
              "linesEnabled",
              on,
              on && !(config.length > 0 && config.thickness > 0)
                ? { length: 8, thickness: 2 }
                : {},
            )
          }
        >
          <Field
            kind="ordinary"
            name="length"
            value={config.length}
            onChange={(v) => patch("length", v)}
            label={tr("Длина")}
            min={0.5}
          />
          <Field
            kind="ordinary"
            name="thickness"
            value={config.thickness}
            onChange={(v) => patch("thickness", v)}
            label={tr("Толщина")}
            min={0.5}
          />
          <Field
            kind="ordinary"
            name="gap"
            value={config.gap}
            onChange={(v) => patch("gap", v)}
          />
          <ArmsControl config={config} onPatch={onPatch} />
        </PartSection>
      );
    case "dot":
      return (
        <PartSection
          title={tr("Точка")}
          enabled={dot}
          onToggle={(on) =>
            toggle(
              "showCenterDot",
              on,
              on && !(config.dotSize > 0) ? { dotSize: 3 } : {},
            )
          }
        >
          <Field
            kind="ordinary"
            name="dotSize"
            value={config.dotSize}
            onChange={(v) => patch("dotSize", v)}
            label={tr("Размер")}
            min={0.5}
          />
          <div className="reticle-choice-row">
            <span>{tr("Форма")}</span>
            <SegmentedControl
              label={tr("Форма точки")}
              size="sm"
              value={config.dotShape}
              onChange={(value) => patch("dotShape", value)}
              options={DOT_SHAPES.map((item) => ({
                value: item.id,
                label: tr(item.label),
              }))}
            />
          </div>
        </PartSection>
      );
    case "ring":
      return (
        <PartSection
          title={tr("Кольцо")}
          enabled={config.ring}
          onToggle={(on) => toggle("ring", on)}
        >
          <RingFields kind="ordinary" config={config} patch={patch} />
        </PartSection>
      );
    case "brackets":
      return (
        <PartSection
          title={tr("Уголки")}
          enabled={config.bracketsEnabled}
          onToggle={(on) => toggle("bracketsEnabled", on)}
          hint={tr("Длина от двух размеров рамки смыкает уголки в квадрат.")}
        >
          <Field
            kind="ordinary"
            name="bracketSize"
            value={config.bracketSize}
            onChange={(v) => patch("bracketSize", v)}
            label={tr("Размер рамки")}
          />
          <Field
            kind="ordinary"
            name="bracketLength"
            value={config.bracketLength}
            onChange={(v) => patch("bracketLength", v)}
            label={tr("Длина уголка")}
          />
          <Field
            kind="ordinary"
            name="bracketThickness"
            value={config.bracketThickness}
            onChange={(v) => patch("bracketThickness", v)}
            label={tr("Толщина")}
          />
        </PartSection>
      );
    case "chevron":
      return (
        <PartSection
          title={tr("Шеврон")}
          enabled={config.chevronEnabled}
          onToggle={(on) => toggle("chevronEnabled", on)}
          hint={tr("Вершина галочки — точка прицеливания.")}
        >
          <Field
            kind="ordinary"
            name="chevronWidth"
            value={config.chevronWidth}
            onChange={(v) => patch("chevronWidth", v)}
            label={tr("Ширина")}
          />
          <Field
            kind="ordinary"
            name="chevronHeight"
            value={config.chevronHeight}
            onChange={(v) => patch("chevronHeight", v)}
            label={tr("Высота")}
          />
          <Field
            kind="ordinary"
            name="chevronThickness"
            value={config.chevronThickness}
            onChange={(v) => patch("chevronThickness", v)}
            label={tr("Толщина")}
          />
          <Field
            kind="ordinary"
            name="chevronOffset"
            value={config.chevronOffset}
            onChange={(v) => patch("chevronOffset", v)}
            label={tr("Сдвиг вниз")}
          />
        </PartSection>
      );
    case "colour":
      return (
        <WholeSection title={tr("Цвет")}>
          <ColorField
            label={tr("Основной цвет")}
            value={config.color}
            swatches={RETICLE_SWATCHES}
            editable
            {...opacityAlpha("ordinary", config.opacity, patch)}
            onChange={(value) => patch("color", value)}
          />
          <Field
            kind="ordinary"
            name="opacity"
            value={config.opacity}
            onChange={(v) => patch("opacity", v)}
          />
          <label className="ui-field reticle-toggle">
            <span>{tr("Свой цвет на цели")}</span>
            <Switch
              checked={config.targetColorEnabled}
              label={tr("Свой цвет на цели")}
              onChange={(on) => patch("targetColorEnabled", on)}
            />
          </label>
          {config.targetColorEnabled && (
            <ColorField
              label={tr("Цвет цели")}
              value={config.targetColor}
              editable
              onChange={(value) => patch("targetColor", value)}
            />
          )}
        </WholeSection>
      );
    case "outline":
      return (
        <PartSection
          title={tr("Обводка")}
          enabled={config.outlineEnabled && config.outlineWidth > 0}
          onToggle={(on) =>
            toggle(
              "outlineEnabled",
              on,
              on && !(config.outlineWidth > 0) ? { outlineWidth: 1 } : {},
            )
          }
        >
          <Field
            kind="ordinary"
            name="outlineWidth"
            value={config.outlineWidth}
            onChange={(v) => patch("outlineWidth", v)}
            label={tr("Толщина")}
            min={0.5}
          />
          <ColorField
            label={tr("Цвет обводки")}
            value={config.outlineColor}
            swatches={OUTLINE_SWATCHES}
            editable
            onChange={(value) => patch("outlineColor", value)}
          />
          {/* Игра красит прицел одним сдвигом цвета, и обводка не бывает
              светлее прицела. Не скрываем: говорим, какой она выйдет. */}
          {!colours.outlineExact && (
            <p className="fx-hint reticle-outline-note">
              {tr("В игре обводка выйдет")}{" "}
              <i
                style={{ background: colours.plainOutline }}
                aria-hidden="true"
              />
              <code>{colours.plainOutline.toUpperCase()}</code>
              {": "}
              {tr("GTA красит прицел одной краской, и обводка не бывает светлее него.")}
            </p>
          )}
          <Field
            kind="ordinary"
            name="outlineOpacity"
            value={config.outlineOpacity}
            onChange={(v) => patch("outlineOpacity", v)}
            label={tr("Непрозрачность")}
          />
        </PartSection>
      );
    case "size":
      return (
        <WholeSection title={tr("Размер и поворот")}>
          <Field
            kind="ordinary"
            name="scale"
            value={config.scale}
            onChange={(v) => patch("scale", v)}
          />
          <Field
            kind="ordinary"
            name="rotation"
            value={config.rotation}
            onChange={(v) => patch("rotation", v)}
          />
          <p className="fx-hint reticle-size-note">
            {pixelsAt1080(language, Math.round(reticleReach("ordinary", config) * 2 * RETICLE_PIXELS_1080P))}
          </p>
          <p className="fx-hint">
            {tr("Размеры — в точках интерфейса GTA: на 1920×1080 точка — полтора пикселя, на 2560×1440 — два.")}
          </p>
        </WholeSection>
      );
    case "visibility":
      return (
        <WholeSection title={tr("Видимость")}>
          <div
            className="ui-choice-grid reticle-visibility"
            role="radiogroup"
            aria-label={tr("Когда прицел гаснет")}
          >
            {VISIBILITY_MODES.map((mode) => (
              <ChoiceTile
                key={mode.id}
                role="radio"
                aria-checked={config.visibilityMode === mode.id}
                selected={config.visibilityMode === mode.id}
                title={tr(mode.label)}
                description={tr(mode.description)}
                onClick={() => patch("visibilityMode", mode.id)}
              />
            ))}
          </div>
          {config.visibilityMode === "delayed" && (
            <Field
              kind="ordinary"
              name="fadeDelaySeconds"
              value={config.fadeDelaySeconds}
              onChange={(v) => patch("fadeDelaySeconds", v)}
            />
          )}
          <label className="ui-field reticle-toggle">
            <span>{tr("Отметка попадания игры")}</span>
            <Switch
              checked={config.hitMarker}
              label={tr("Отметка попадания игры")}
              onChange={(on) => patch("hitMarker", on)}
            />
          </label>
          <HitPreview config={config} hit={hit} onHit={onHit} />
          <p className="fx-hint">
            {tr("Меню, пустые руки и снайперский режим остаются за игрой. Отметка попадания — крестик вокруг центра, когда пуля попала.")}
          </p>
        </WholeSection>
      );
    default:
      return null;
  }
}

/*
 * Снайперская оптика: раздел взятого инструмента. «Толстые края» и
 * «Деления» живут на линиях перекрестия — без него этих инструментов в
 * колонке нет вовсе (`SNIPER_TOOLS` в `ReticleCustomizer.jsx`), а не
 * выключателей, которые ничего не включат.
 */
export function SniperInspector({ tool, config, onPatch, hit = false, onHit = null }) {
  useTr();
  const language = useUiLanguage();
  const patch = patcher("sniper", onPatch, language);
  const toggle = (name, on, extra = {}) =>
    onPatch(
      { [name]: on, ...extra },
      `${on ? tr("Добавлено") : tr("Убрано")}: ${lowerFor(language, tr(reticleField("sniper", name).label))}`,
      name,
    );
  /* Части, у которых выключатель — само число: ноль значит «нет». */
  const amount = (name, on, fallback, label) =>
    onPatch(
      { [name]: on ? fallback : 0 },
      `${on ? tr("Добавлено") : tr("Убрано")}: ${label}`,
      name,
    );
  switch (tool) {
    case "lines":
      return (
        <PartSection
          title={tr("Перекрестие")}
          enabled={config.linesEnabled}
          onToggle={(on) => toggle("linesEnabled", on)}
          hint={tr("Длина — доля пути до края экрана; горизонталь за 85 % уходит под край линзы.")}
        >
          <Field
            kind="sniper"
            name="horizontalLength"
            value={config.horizontalLength}
            onChange={(v) => patch("horizontalLength", v)}
            label={tr("По горизонтали")}
          />
          <Field
            kind="sniper"
            name="verticalLength"
            value={config.verticalLength}
            onChange={(v) => patch("verticalLength", v)}
            label={tr("По вертикали")}
          />
          <Field
            kind="sniper"
            name="thickness"
            value={config.thickness}
            onChange={(v) => patch("thickness", v)}
            label={tr("Толщина")}
          />
          <Field
            kind="sniper"
            name="centerGap"
            value={config.centerGap}
            onChange={(v) => patch("centerGap", v)}
          />
          <ArmsControl config={config} onPatch={onPatch} />
        </PartSection>
      );
    case "posts":
      return (
        <PartSection
          title={tr("Толстые края")}
          enabled={config.postsEnabled}
          onToggle={(on) => toggle("postsEnabled", on)}
          hint={tr("Как у дуплекса: толстые столбики у краёв ведут взгляд к центру.")}
        >
          <Field
            kind="sniper"
            name="postThickness"
            value={config.postThickness}
            onChange={(v) => patch("postThickness", v)}
            label={tr("Толщина")}
          />
          <Field
            kind="sniper"
            name="postStart"
            value={config.postStart}
            onChange={(v) => patch("postStart", v)}
            label={tr("Начало от центра")}
          />
        </PartSection>
      );
    case "divisions":
      return (
        <PartSection
          title={tr("Деления")}
          enabled={config.divisions > 0}
          onToggle={(on) => amount("divisions", on, 8, tr("деления"))}
        >
          <Field
            kind="sniper"
            name="divisions"
            value={config.divisions}
            onChange={(v) => patch("divisions", v)}
            label={tr("Количество")}
            min={1}
          />
          <Field
            kind="sniper"
            name="tickSize"
            value={config.tickSize}
            onChange={(v) => patch("tickSize", v)}
            label={tr("Размер")}
          />
          <div className="reticle-choice-row">
            <span>{tr("Вид")}</span>
            <SegmentedControl
              label={tr("Вид делений")}
              size="sm"
              value={config.tickStyle}
              onChange={(value) => patch("tickStyle", value)}
              options={TICK_STYLES.map((item) => ({
                value: item.id,
                label: tr(item.label),
              }))}
            />
          </div>
        </PartSection>
      );
    case "dot":
      return (
        <PartSection
          title={tr("Точка")}
          enabled={config.dotSize > 0}
          onToggle={(on) => amount("dotSize", on, 2, tr("центральная точка"))}
        >
          <Field
            kind="sniper"
            name="dotSize"
            value={config.dotSize}
            onChange={(v) => patch("dotSize", v)}
            label={tr("Размер")}
            min={0.5}
          />
        </PartSection>
      );
    case "ring":
      return (
        <PartSection
          title={tr("Кольцо")}
          enabled={config.showCircle}
          onToggle={(on) => toggle("showCircle", on)}
        >
          <RingFields kind="sniper" config={config} patch={patch} />
        </PartSection>
      );
    case "chevron":
      return (
        <PartSection
          title={tr("Шеврон")}
          enabled={config.chevronEnabled}
          onToggle={(on) => toggle("chevronEnabled", on)}
          hint={tr("Галочка под центром, как у ACOG и ПСО.")}
        >
          <Field
            kind="sniper"
            name="chevronWidth"
            value={config.chevronWidth}
            onChange={(v) => patch("chevronWidth", v)}
            label={tr("Ширина")}
          />
          <Field
            kind="sniper"
            name="chevronHeight"
            value={config.chevronHeight}
            onChange={(v) => patch("chevronHeight", v)}
            label={tr("Высота")}
          />
          <Field
            kind="sniper"
            name="chevronThickness"
            value={config.chevronThickness}
            onChange={(v) => patch("chevronThickness", v)}
            label={tr("Толщина")}
          />
        </PartSection>
      );
    case "holdover":
      return (
        <PartSection
          title={tr("Шкала поправок")}
          enabled={config.holdoverEnabled}
          onToggle={(on) => toggle("holdoverEnabled", on)}
          hint={tr("Отметки под центром — куда целиться на дальней дистанции.")}
        >
          <Field
            kind="sniper"
            name="holdoverCount"
            value={config.holdoverCount}
            onChange={(v) => patch("holdoverCount", v)}
            label={tr("Отметок")}
          />
          <Field
            kind="sniper"
            name="holdoverSpacing"
            value={config.holdoverSpacing}
            onChange={(v) => patch("holdoverSpacing", v)}
            label={tr("Шаг")}
          />
          <Field
            kind="sniper"
            name="holdoverWidth"
            value={config.holdoverWidth}
            onChange={(v) => patch("holdoverWidth", v)}
            label={tr("Ширина")}
          />
          <Field
            kind="sniper"
            name="holdoverGrowth"
            value={config.holdoverGrowth}
            onChange={(v) => patch("holdoverGrowth", v)}
            label={tr("Прирост ширины")}
          />
          <div className="reticle-choice-row">
            <span>{tr("Вид")}</span>
            <SegmentedControl
              label={tr("Вид отметок шкалы")}
              size="sm"
              value={config.holdoverShape}
              onChange={(value) => patch("holdoverShape", value)}
              options={HOLDOVER_SHAPES.map((item) => ({
                value: item.id,
                label: tr(item.label),
              }))}
            />
          </div>
        </PartSection>
      );
    case "colour":
      return (
        <WholeSection title={tr("Цвет")}>
          <ColorField
            label={tr("Цвет сетки")}
            value={config.reticle}
            swatches={RETICLE_SWATCHES}
            editable
            {...opacityAlpha("sniper", config.opacity, patch)}
            onChange={(value) => patch("reticle", value)}
          />
          <Field
            kind="sniper"
            name="opacity"
            value={config.opacity}
            onChange={(v) => patch("opacity", v)}
          />
          <label className="ui-field reticle-toggle">
            <span>{tr("Свой цвет центра")}</span>
            <Switch
              checked={config.centerColorEnabled}
              label={tr("Свой цвет центра")}
              onChange={(on) => patch("centerColorEnabled", on)}
            />
          </label>
          {config.centerColorEnabled && (
            <ColorField
              label={tr("Цвет центра")}
              hint={tr("Точка, кольцо и шевроны")}
              value={config.centerColor}
              swatches={RETICLE_SWATCHES}
              editable
              onChange={(value) => patch("centerColor", value)}
            />
          )}
        </WholeSection>
      );
    case "outline":
      return (
        <PartSection
          title={tr("Обводка")}
          enabled={config.glowWidth > 0}
          onToggle={(on) => amount("glowWidth", on, 1, tr("обводка"))}
        >
          <Field
            kind="sniper"
            name="glowWidth"
            value={config.glowWidth}
            onChange={(v) => patch("glowWidth", v)}
            label={tr("Толщина")}
            min={0.5}
          />
          <ColorField
            label={tr("Цвет обводки")}
            value={config.glowColor}
            swatches={OUTLINE_SWATCHES}
            editable
            onChange={(value) => patch("glowColor", value)}
          />
          <Field
            kind="sniper"
            name="glowOpacity"
            value={config.glowOpacity}
            onChange={(v) => patch("glowOpacity", v)}
            label={tr("Непрозрачность")}
          />
        </PartSection>
      );
    case "optics":
      return (
        <WholeSection title={tr("Оптика")}>
          <label className="ui-field reticle-toggle">
            <span>{tr("Чёрные края линзы")}</span>
            <Switch
              checked={config.lensEnabled}
              label={tr("Чёрные края линзы")}
              onChange={(on) => patch("lensEnabled", on)}
            />
          </label>
          <label className="ui-field reticle-toggle">
            <span>{tr("Отметка попадания игры")}</span>
            <Switch
              checked={config.hitMarker}
              label={tr("Отметка попадания игры")}
              onChange={(on) => patch("hitMarker", on)}
            />
          </label>
          <HitPreview config={config} hit={hit} onHit={onHit} />
          <label className="ui-field reticle-toggle">
            <span>{tr("Отметка кратности")}</span>
            <Switch
              checked={config.zoomMarker}
              label={tr("Отметка кратности")}
              onChange={(on) => patch("zoomMarker", on)}
            />
          </label>
          <Field
            kind="sniper"
            name="rotation"
            value={config.rotation}
            onChange={(v) => patch("rotation", v)}
          />
          <p className="fx-hint">
            {tr("Отметка попадания — зелёные дуги у хевика и белая галочка у снайперки. Отметка кратности — красная риска справа.")}
          </p>
        </WholeSection>
      );
    default:
      return null;
  }
}
