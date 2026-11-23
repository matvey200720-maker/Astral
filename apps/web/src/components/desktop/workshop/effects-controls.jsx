/*
 * Мелкие органы мастерской эффектов — общие для редакторов попаданий,
 * трассеров и огня: флажок, поле цвета с быстрыми цветами, подписи размера.
 */

import ColorField from "../../ui/ColorField.jsx";
import { effectsCopyFor, useEffectsCopy } from "./effects-lang.js";

export const percent = (value) => `${Math.round(value * 100)}%`;

/**
 * Флажок редактора.
 *
 * Знак выбора в продукте один — `SelectionMark`, тот же, что в настройках и в
 * списках сборки. Нативный чекбокс рядом с ним выглядит деталью чужой
 * программы: у него своя рамка, свой цвет и свой радиус, которых больше нигде
 * в Astral нет.
 *
 * Настоящий `input` при этом остаётся — просто невидимым. Он держит фокус с
 * клавиатуры, пробел и роль для читалки экрана; рисованный квадратик всего
 * этого не умеет.
 */
export function FxCheck({ checked, onChange, label, className = "" }) {
  return (
    <input
      type="checkbox"
      className={`ui-checkbox-input${className ? ` ${className}` : ""}`}
      checked={checked}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/*
 * Палитра быстрых цветов.
 *
 * Системный диалог цвета — это три щелчка и потеря контекста ради того, что в
 * девяти случаях из десяти оказывается «красный» или «бирюзовый». Ряд образцов
 * закрывает эти девять случаев одним нажатием, а диалог остаётся рядом для
 * десятого.
 */
export const TRACER_SWATCHES = Object.freeze([
  "#ff7a1a",
  "#ff2d16",
  "#ffd400",
  "#84cc16",
  "#22d3ee",
  "#3b82f6",
  "#a855f7",
  "#f472b6",
  "#ffffff",
]);

export const BLOOD_SWATCHES = Object.freeze([
  "#8a0b0b",
  "#b01212",
  "#6d0d0d",
  "#5d0a12",
  "#3f0d1a",
  "#65a30d",
  "#1d4ed8",
  "#111827",
  "#e2e8f0",
]);

/* Свой выбор цвета уехал в общий `ui/ColorField`: он выглядит одинаково во
   всех редакторах, а быстрые цвета остались — их придумали здесь. */
export function ColourField({ label, value, swatches, onChange }) {
  const copy = useEffectsCopy();
  return (
    <ColorField
      label={label}
      value={value}
      swatches={swatches}
      onChange={onChange}
      ariaLabel={copy.colourOf(label)}
    />
  );
}

/*
 * Размер следа словами игры.
 *
 * Проценты ползунка — это положение ручки, а не то, что увидит человек.
 * Подпись называет спрайт в метрах: те самые числа уйдут в правило слота.
 * Сантиметры до метра, дальше метры с одним знаком: «0,58 м» для следа
 * читается хуже, чем «58 см», а «182 см» хуже, чем «1,8 м».
 */
export const gameSize = (metres, copy = effectsCopyFor("ru")) =>
  copy.gameSize(metres);

/*
 * Имя правки для истории (`useSkyHistory`): подряд идущие правки одного поля
 * склеиваются в один шаг — иначе одно движение ползунка стоило бы тридцати
 * нажатий «Отменить». `enabled` в счёт не идёт: тронутый орган включает зону
 * или семейство сам, и это та же правка. Несколько полей разом — отдельный
 * шаг (`null`).
 */
export function historyLabel(scope, values) {
  const keys = Object.keys(values || {}).filter((key) => key !== "enabled");
  return keys.length === 1 ? `${scope}:${keys[0]}` : null;
}
