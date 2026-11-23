/*
 * Панель «Животных» — настройки взятого инструмента (мастерская «как в Photoshop»): цвет, свечение, метка над животным.
 * Органы — из словаря (`components/ui`), разделы — `ui-panel fx-section`, как у остальных редакторов. Размера животного нет
 * нарочно: модель без физики развела бы то, что видно, и то, во что попадает пуля (`docs/ANIMALS.md`).
 */

import { useState } from "react";
import { ANIMAL_LIMITS, ICON_IDS, ICON_NAMES, iconSvg } from "@modovik/climb-contract/animals";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { ANIMAL_EMBLEM_TYPES, EMBLEM_EDGE, importAnimalEmblem, useAnimalEmblem } from "./animal-emblem.js";

/* Образцы цвета: природные оттенки шерсти и перьев, затем яркие — для свечения и метки. */
const COLOUR_SWATCHES = Object.freeze(["#8a5a3b", "#3b2a20", "#d8c7a0", "#f2f2ee", "#c4562e", "#2f6f4e", "#2f5c8a", "#7a4fb5", "#d6336c"]);
const SIGNAL_SWATCHES = Object.freeze(["#ffd23f", "#5fe0ff", "#ff5a5f", "#7dff6b", "#ff8a1f", "#c77dff", "#ffffff", "#ff3df2", "#2f7bff"]);

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

const dataUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/*
 * Границы в договоре — доли (0,1…1, 0,6…1,4), а ползунок «Сила», «Яркость» и «Прозрачность» показывает проценты. Дорожке нужны
 * границы в тех же единицах, что и значение: иначе число 100 лежало бы за краем «0,1…1», шаг 5 не помещался бы в дорожку и бегунок
 * стоял бы у левого края при «100 %» на табло (замечание владельца 06.11.2026).
 */
const percentRange = (range) => ({ min: Math.round(range.min * 100), max: Math.round(range.max * 100) });
const STRENGTH_PERCENT = percentRange(ANIMAL_LIMITS.strength);
const BRIGHTNESS_PERCENT = percentRange(ANIMAL_LIMITS.brightness);
const GLOW_ALPHA_PERCENT = percentRange(ANIMAL_LIMITS.glowAlpha);
const EMBLEM_OPACITY_PERCENT = percentRange(ANIMAL_LIMITS.markerOpacity);

function Range({ range, label, value, unit, step, hint, disabled, onChange }) {
  return (
    <Slider editable label={label} hint={hint} value={value} min={range.min} max={range.max} step={step} unit={unit} disabled={disabled} onChange={onChange} />
  );
}

/* --- Цвет --- */

function ColourTool({ look, animal, onChange }) {
  const { colour } = look;
  return (
    <>
      <Section
        title={tr("Перекраска")}
        action={<Switch checked={colour.on} label={colour.on ? tr("Выключить перекраску") : tr("Включить перекраску")} onChange={(on) => onChange("colour", { on }, tr("Животные: перекраска"))} />}
      >
        <p className="fx-hint">
          {tr("Цвет красит все расцветки шерсти или перьев животного. Светотень, пятна и глаза остаются: средний тон листа становится выбранным цветом.")}
        </p>
        <ColorField
          label={tr("Цвет")}
          ariaLabel={tr("Цвет животного")}
          value={colour.hex}
          swatches={COLOUR_SWATCHES}
          editable
          disabled={!colour.on}
          onChange={(hex) => onChange("colour", { hex, on: true }, tr("Животные: цвет"))}
        />
        <Range
          range={STRENGTH_PERCENT}
          label={tr("Сила")}
          value={Math.round(colour.strength * 100)}
          unit="%"
          step={5}
          disabled={!colour.on}
          hint={tr("100 % — весь лист в выбранный тон, меньше — тон смешан со своей шерстью")}
          onChange={(value) => onChange("colour", { strength: value / 100 }, tr("Животные: сила цвета"))}
        />
        <Range
          range={BRIGHTNESS_PERCENT}
          label={tr("Яркость")}
          value={Math.round(colour.brightness * 100)}
          unit="%"
          step={5}
          disabled={!colour.on}
          onChange={(value) => onChange("colour", { brightness: value / 100 }, tr("Животные: яркость"))}
        />
      </Section>
      <Section title={tr("Что именно красится")} label={tr("Что красится")}>
        <p className="fx-hint">
          {animal?.layout === "streamed"
            ? tr("Листы цвета частей тела: голова, грудь, зад и ошейник. Игра сама выбирает расцветку животного — красятся все.")
            : tr("Листы цвета тела (все расцветки одного животного). Размер, формат и число уровней листа остаются как в игре.")}
        </p>
      </Section>
    </>
  );
}

/* --- Свечение --- */

function GlowTool({ look, onChange }) {
  const { glow } = look;
  return (
    <>
      <Section
        title={tr("Подсветка")}
        action={<Switch checked={glow.on} label={glow.on ? tr("Выключить подсветку") : tr("Включить подсветку")} onChange={(on) => onChange("glow", { on }, tr("Животные: подсветка"))} />}
      >
        <p className="fx-hint">
          {tr("Тонкая светящаяся оболочка по форме тела — на сантиметры больше самого животного. Тело, кости и хитбокс те же, оболочка в них не попадает.")}
        </p>
        <ColorField
          label={tr("Цвет")}
          ariaLabel={tr("Цвет подсветки")}
          value={glow.hex}
          swatches={SIGNAL_SWATCHES}
          editable
          disabled={!glow.on}
          onChange={(hex) => onChange("glow", { hex, on: true }, tr("Животные: цвет подсветки"))}
        />
        <Range
          range={ANIMAL_LIMITS.glowPower}
          label={tr("Сила свечения")}
          value={glow.power}
          step={0.1}
          disabled={!glow.on}
          hint={tr("Ночью оболочка светится сильнее, чем днём")}
          onChange={(power) => onChange("glow", { power }, tr("Животные: сила свечения"))}
        />
        <Range
          range={ANIMAL_LIMITS.glowReach}
          label={tr("Толщина")}
          value={glow.reach}
          unit={tr("см")}
          step={0.5}
          disabled={!glow.on}
          onChange={(reach) => onChange("glow", { reach }, tr("Животные: толщина оболочки"))}
        />
        <Range
          range={GLOW_ALPHA_PERCENT}
          label={tr("Прозрачность")}
          value={Math.round(glow.alpha * 100)}
          unit="%"
          step={5}
          disabled={!glow.on}
          onChange={(value) => onChange("glow", { alpha: value / 100 }, tr("Животные: прозрачность оболочки"))}
        />
      </Section>
    </>
  );
}

/* --- Метка --- */

function IconPicker({ value, hex, disabled, onPick }) {
  return (
    <div className="animals-icons" role="radiogroup" aria-label={tr("Значок метки")}>
      {ICON_IDS.map((id) => (
        <button
          type="button"
          key={id}
          role="radio"
          aria-checked={value === id}
          aria-label={tr(ICON_NAMES[id])}
          title={tr(ICON_NAMES[id])}
          className={`animals-icon${value === id ? " is-on" : ""}`}
          disabled={disabled}
          onClick={() => onPick(id)}
        >
          <img src={dataUri(iconSvg(id, value === id ? hex : "#c9cdd6"))} alt="" draggable="false" />
        </button>
      ))}
    </div>
  );
}

/* Виды метки: готовый значок, своя картинка, копия самого животного. Подписи переводятся при показе. */
const markerKinds = () => [
  { value: "icon", label: tr("Значок"), title: tr("Готовый значок-силуэт") },
  { value: "emblem", label: tr("Своя эмблема"), title: tr("Своя картинка вместо значка") },
  { value: "model", label: tr("Модель"), title: tr("Модель животного в небе") },
];

/* Своя эмблема: картинка человека вместо значка. Рамка — общий орган «Своя картинка»; что с файлом не так, говорит строка под ней. */
function EmblemPicker({ marker, disabled, onChange }) {
  const picture = useAnimalEmblem(marker.emblem);
  const [problem, setProblem] = useState("");
  const [picked, setPicked] = useState({ asset: "", name: "", transparent: true });

  async function take(file) {
    setProblem("");
    try {
      const result = await importAnimalEmblem(file);
      setPicked({ asset: result.asset, name: result.name, transparent: result.transparent });
      onChange("marker", { kind: "emblem", emblem: result.asset, on: true }, tr("Животные: своя эмблема"));
    } catch (error) {
      setProblem(String(error?.message || error));
    }
  }
  const named = picked.asset && picked.asset === marker.emblem ? picked.name : "";
  const caption = marker.emblem ? `${named || tr("Своя эмблема")} · ${EMBLEM_EDGE} × ${EMBLEM_EDGE}` : "";
  const flat = Boolean(marker.emblem) && picked.asset === marker.emblem && !picked.transparent;
  return (
    <>
      <SurfacePicture
        label={tr("Своя эмблема метки")}
        src={picture.url}
        aspect={2}
        fit="contain"
        caption={caption}
        hint={tr("PNG, JPG или WebP")}
        accept={ANIMAL_EMBLEM_TYPES.join(",")}
        dropLabel={tr("Отпустите — станет эмблемой метки")}
        disabled={disabled}
        onFile={take}
        onClear={marker.emblem ? () => onChange("marker", { emblem: "" }, tr("Животные: убрана эмблема")) : null}
        clearLabel={tr("убрать картинку")}
      />
      {problem && (
        <p className="fx-hint animals-problem" role="alert">
          {problem}
        </p>
      )}
      {!problem && marker.on && !marker.emblem && (
        <p className="fx-hint animals-problem" role="status">
          {tr("Картинка не выбрана — метка с эмблемой не появится")}
        </p>
      )}
      {!problem && marker.emblem && picture.status === "missing" && (
        <p className="fx-hint animals-problem" role="alert">
          {tr("Этой эмблемы нет на этом компьютере — выберите картинку заново")}
        </p>
      )}
      {!problem && flat && (
        <p className="fx-hint" role="status">
          {tr("Фон у картинки сплошной — метка будет прямоугольной плашкой. Нужна фигура — возьмите PNG или WebP с прозрачностью.")}
        </p>
      )}
      <p className="fx-hint">
        {tr("Файл до 16 МБ. Картинка вписывается в квадрат целиком, в игре её размер 128 × 128 точек. Прозрачность PNG и WebP остаётся, цвета картинки — свои; цвет ниже красит только «палочку».")}
      </p>
    </>
  );
}

function MarkerTool({ look, onChange }) {
  const { marker } = look;
  const kind = marker.kind;
  return (
    <>
      <Section
        title={tr("Метка над животным")}
        action={<Switch checked={marker.on} label={marker.on ? tr("Убрать метку") : tr("Поставить метку")} onChange={(on) => onChange("marker", { on }, tr("Животные: метка"))} />}
      >
        <p className="fx-hint">
          {tr("Значок горит над животным и виден издалека: посмотрел в небо — видишь, где оно. Видна, пока животное прогружено игрой, и только у вас на экране.")}
        </p>
        <SegmentedControl
          label={tr("Вид метки")}
          size="sm"
          options={markerKinds()}
          value={kind}
          disabled={!marker.on}
          onChange={(next) => onChange("marker", { kind: next, on: true }, tr("Животные: вид метки"))}
        />
        {kind === "icon" && (
          <IconPicker value={marker.icon} hex={marker.hex} disabled={!marker.on} onPick={(icon) => onChange("marker", { icon, on: true }, tr("Животные: значок"))} />
        )}
        {kind === "emblem" && <EmblemPicker marker={marker} disabled={!marker.on} onChange={onChange} />}
        {kind === "model" && (
          <p className="fx-hint">
            {tr("Копия самого животного: его же сетка тела, залитая одним цветом, парит над ним. Пропорции те же, размер — длинная сторона копии ниже; цвет общий для копии и «палочки».")}
          </p>
        )}
        <ColorField
          label={kind === "emblem" ? tr("Цвет палочки") : kind === "model" ? tr("Цвет копии") : tr("Цвет")}
          ariaLabel={kind === "emblem" ? tr("Цвет палочки метки") : kind === "model" ? tr("Цвет копии животного") : tr("Цвет метки")}
          value={marker.hex}
          swatches={SIGNAL_SWATCHES}
          editable
          disabled={!marker.on}
          onChange={(hex) => onChange("marker", { hex, on: true }, tr("Животные: цвет метки"))}
        />
      </Section>
      <Section title={tr("Положение и вид")} label={tr("Положение и вид метки")}>
        <Range
          range={ANIMAL_LIMITS.markerHeight}
          label={tr("Высота над спиной")}
          value={marker.height}
          unit={tr("м")}
          step={0.5}
          disabled={!marker.on}
          hint={tr("До 12 м: выше метка вышла бы за предел видимости модели и пропала вместе с животным")}
          onChange={(height) => onChange("marker", { height }, tr("Животные: высота метки"))}
        />
        {kind === "emblem" && (
          <Range
            range={EMBLEM_OPACITY_PERCENT}
            label={tr("Непрозрачность")}
            value={Math.round(marker.opacity * 100)}
            unit="%"
            step={5}
            disabled={!marker.on}
            onChange={(value) => onChange("marker", { opacity: value / 100 }, tr("Животные: непрозрачность эмблемы"))}
          />
        )}
        {kind === "model" ? (
          <Range
            range={ANIMAL_LIMITS.markerModelSize}
            label={tr("Размер копии")}
            value={marker.modelSize}
            unit={tr("м")}
            step={0.5}
            disabled={!marker.on}
            hint={tr("Длинная сторона копии. Один в один не годится: кит длиннее 15 м, а курицу с земли не разглядеть")}
            onChange={(modelSize) => onChange("marker", { modelSize }, tr("Животные: размер копии"))}
          />
        ) : (
          <Range
            range={ANIMAL_LIMITS.markerSize}
            label={kind === "emblem" ? tr("Размер эмблемы") : tr("Размер значка")}
            value={marker.size}
            unit={tr("м")}
            step={0.1}
            disabled={!marker.on}
            onChange={(size) => onChange("marker", { size }, tr("Животные: размер значка"))}
          />
        )}
        <Range
          range={ANIMAL_LIMITS.markerPower}
          label={tr("Яркость свечения")}
          value={marker.power}
          step={0.1}
          disabled={!marker.on}
          onChange={(power) => onChange("marker", { power }, tr("Животные: яркость метки"))}
        />
        <label className="ui-field animals-pole">
          <span>{tr("«Палочка» от животного до значка")}</span>
          <Switch checked={marker.pole} disabled={!marker.on} label={tr("Палочка")} onChange={(pole) => onChange("marker", { pole }, tr("Животные: палочка"))} />
        </label>
        <p className="fx-hint">
          {kind === "model"
            ? tr("Копия — объёмная, видна с любой стороны; без палочки она парит над животным.")
            : tr("Значок — два перекрещённых квадрата, поэтому виден с любой стороны; без палочки он парит над животным.")}
        </p>
      </Section>
    </>
  );
}

/* --- Где работает --- */

function Where() {
  return (
    <Section title={tr("Где работает")}>
      <p className="fx-hint">
        {tr("Меняются файлы животных в вашей GTA: цвет, подсветка и метка видны только вам, на любом сервере, где эти звери есть. Размер животного не меняется — модель без физики разошлась бы с хитбоксом.")}
      </p>
    </Section>
  );
}

export default function AnimalsInspector({ tool, look, animal, onChange }) {
  useTr();
  return (
    <>
      {tool === "glow" ? <GlowTool look={look} onChange={onChange} /> : tool === "marker" ? <MarkerTool look={look} onChange={onChange} /> : <ColourTool look={look} animal={animal} onChange={onChange} />}
      <Where />
    </>
  );
}

