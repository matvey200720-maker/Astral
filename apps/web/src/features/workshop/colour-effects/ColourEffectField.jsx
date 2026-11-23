/*
 * Цветовой эффект — одно поле у всех редакторов мастерской: зоны, вода,
 * растительность, арены. Словарь эффектов и арифметика — в договоре
 * (`@modovik/climb-contract/recolor/colour-effects`): кадр и установщик
 * берут одну и ту же полосу цветов.
 *
 * Органы — из словаря (`components/ui`): эффект — `Select`, цвета —
 * `ColorField`, направление — `SegmentedControl`, ширина полосы и сдвиг
 * радуги — `Slider`.
 */

import {
  COLOUR_EFFECT_DIRECTIONS,
  COLOUR_EFFECT_DIRECTION_LABELS,
  COLOUR_EFFECT_LABELS,
  COLOUR_EFFECT_MODES,
  COLOUR_EFFECT_WIDTH,
  normalizeColourEffect,
} from "@modovik/climb-contract/recolor/colour-effects";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/* Подписи направлений переводятся здесь: у договоров они русские константы
   уровня модуля (`CAPT_ZONES_DIRECTIONS`), и на de/pl сегменты стояли
   по-русски. Уже переведённая подпись словарём не найдётся и останется как
   есть (дизайн 12.10). */
const directionOptions = (labels) =>
  COLOUR_EFFECT_DIRECTIONS.map((value) => ({ value, label: tr(labels?.[value] || COLOUR_EFFECT_DIRECTION_LABELS[value]) }));

const HINTS = Object.freeze({
  solid: "",
  gradient: "Два цвета плавно переходят друг в друга вдоль выбранного направления.",
  rainbow: "Радуга вдоль направления; сдвиг — с какого цвета она начинается.",
  shimmer: "Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный: у этих моделей нет анимации развёртки, поэтому цвет не бежит.",
  line: "Полосы двумя цветами, как сигнальная лента; ширина — сколько метров у каждой полосы.",
});

const metres = (value) => `${String(Math.round(value * 10) / 10).replace(".", ",")} м`;
const degrees = (value) => `${Math.round(value)}°`;

/**
 * `value` — эффект (`normalizeColourEffect`), `onChange(next, label)`;
 * `label` — подпись поля; `modes` — какие эффекты предложить (у мест, где
 * эффект не ложится, — только часть); `swatches` — быстрые цвета; `note` —
 * своя подсказка под полем. У редактора бывают свои слова:
 * `directionLabels` — подписи направлений (у воды — «С запада на восток»),
 * `colourLabels(effect)` — подписи двух цветов (`{ first, second }`),
 * `hints` — свои подсказки эффектов поверх общих; `directions: false` —
 * без выбора направления (у следа на экране оно одно: низ и верх экрана).
 * `subject` — чей это цвет («Фасад», «Крыша») для шагов истории и чтения с
 * экрана, когда на виду подпись короче (`label="Цвет"`): предмет уже назван
 * заголовком раздела, и повторять его строкой ниже не нужно (дизайн 12.10).
 */
export default function ColourEffectField({
  label = "Цвет",
  value,
  onChange,
  modes = COLOUR_EFFECT_MODES,
  swatches = [],
  note = "",
  directionLabels = null,
  colourLabels = null,
  hints = null,
  directions = true,
  subject = "",
  /* Прозрачность цвета 0…1 и её правка — полосой в палитре (`ColorField`); нет `onAlphaChange` — нет полосы. */
  alpha = 1,
  onAlphaChange = null,
}) {
  useTr();
  const effect = normalizeColourEffect(value);
  const names = colourLabels?.(effect) || { first: tr("Первый цвет"), second: tr("Второй цвет") };
  /* Общие подсказки — константы модуля: переводом в месте вывода. */
  const hint = tr({ ...HINTS, ...(hints || {}) }[effect.mode] || "");
  const set = (values, step) => onChange(normalizeColourEffect({ ...effect, ...values }), step);
  /* Чей цвет — в шагах истории; на виду — `label`. */
  const who = subject || label;
  const options = modes.map((mode) => [mode, COLOUR_EFFECT_LABELS[mode]]);
  const twoColours = effect.mode === "gradient" || effect.mode === "line";
  const directed = directions && effect.mode !== "solid";
  return (
    /* Без абзаца под полем (слово владельца 29.10.2026, `design-qa.md`): что делает эффект и своя подсказка редактора (`note`) —
       подсказкой поля. */
    <div className="recolor-subsection colour-effect-field" title={[hint, note].filter(Boolean).join(" ") || undefined}>
      {modes.length > 1 && (
        <Select label={`${label}: эффект`} value={effect.mode} options={options} onChange={(mode) => set({ mode }, `${who}: ${COLOUR_EFFECT_LABELS[mode]}`)} />
      )}
      {effect.mode !== "rainbow" && (
        <ColorField
          label={twoColours ? names.first : label}
          value={effect.colour}
          swatches={swatches}
          editable
          alpha={alpha}
          onAlphaChange={onAlphaChange}
          onChange={(colour) => set({ colour }, `${who}: цвет`)}
        />
      )}
      {twoColours && (
        <ColorField label={names.second} value={effect.colour2} swatches={swatches} editable onChange={(colour2) => set({ colour2 }, `${who}: второй цвет`)} />
      )}
      {directed && (
        <SegmentedControl
          label={tr("Направление")}
          size="sm"
          options={directionOptions(directionLabels)}
          value={effect.direction}
          onChange={(direction) => set({ direction }, `${who}: направление`)}
        />
      )}
      {effect.mode === "line" && (
        <Slider
          label={tr("Ширина полосы")}
          value={effect.width}
          min={COLOUR_EFFECT_WIDTH[0]}
          max={COLOUR_EFFECT_WIDTH[1]}
          step={0.1}
          format={metres}
          onChange={(width) => set({ width }, `${who}: ширина полосы`)}
        />
      )}
      {effect.mode === "rainbow" && (
        <Slider label={tr("Сдвиг радуги")} value={effect.shift} min={0} max={359} step={1} format={degrees} onChange={(shift) => set({ shift }, `${who}: сдвиг радуги`)} />
      )}
    </div>
  );
}
