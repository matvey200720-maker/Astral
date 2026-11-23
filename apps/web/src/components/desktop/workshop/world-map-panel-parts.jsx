import { useState } from "react";
import { ArrowsOut, CaretDown, CaretRight, Copy, Eye, EyeSlash, Question, Trash } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import ColorField from "../../ui/ColorField.jsx";
import ColorSwatches from "../../ui/ColorSwatches.jsx";
import Select from "../../ui/Select.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Детали панелей большой карты: раздел, строка-переключатель, строка текста,
 * строка объекта в списке. Общие для всех инструментов карты — у «Зон»,
 * «Надписей» и «Картинок» списки и разделы выглядят одинаково.
 */

export function Section({ title, hint, children, actions = null }) {
  return (
    <section className="ui-panel wmc-section">
      <header>
        <h3>{title}</h3>
        {actions}
      </header>
      {hint && <small className="wmc-hint">{hint}</small>}
      {children}
    </section>
  );
}

/*
 * Мини-инструкция у загрузки (просьба владельца 04.10: «не понятно, какой
 * формат и как это работает»). Свёрнута в одну строку «Как это работает?»,
 * раскрывается по щелчку: что загрузить, какого размера, что получится и где
 * такое взять. `steps` — строки `[заголовок, текст]`.
 */
export const UPLOAD_GUIDES = Object.freeze({
  texture: [
    ["Что загрузить", "Картинку PNG, JPG или WebP — фактуру: бумагу, ткань, бетон, шум."],
    ["Какого размера", "512–1024 точки по стороне. Лучше бесшовная: она повторяется по карте без стыков."],
    ["Что получится", "Фактура ложится поверх всей карты, как слой в Photoshop. Наложение, прозрачность и число повторов — ползунками ниже."],
    ["Где взять", "Поиск «seamless paper texture» или «бесшовная текстура бумаги» — подойдёт любая квадратная картинка."],
  ],
  map: [
    ["Что загрузить", "Готовую карту штата картинкой — PNG, JPG или WebP."],
    ["Какого размера", "Вертикальную, в пропорции штата 2 : 3, например 2048 × 3072. Больше 4096 точек ужимается."],
    ["Что получится", "Картинка растягивается на весь штат: верхний край — Палето-Бэй, нижний — аэропорт. Зоны, подписи и картинки ложатся поверх."],
    ["Где взять", "Своя карта из Photoshop или карта сервера. Пак плиток (zip) берите кнопкой «Взять карту из пака»."],
  ],
  pack: [
    ["Что загрузить", "Архив .zip с паком большой карты из сообщества — например, паки Akio «Atlas» или «Satellite»."],
    ["Что внутри", "Плитки minimap_*.ytd (растр) — Astral склеит их в одну карту. Векторные .ydd из паков не берутся: они роняют игру."],
    ["Что получится", "Карта пака становится основой проекта как есть; зоны, подписи и картинки ложатся поверх."],
  ],
});

export function UploadGuide({ kind }) {
  const [open, setOpen] = useState(false);
  const steps = UPLOAD_GUIDES[kind];
  if (!steps) return null;
  const Caret = open ? CaretDown : CaretRight;
  return (
    <div className="wmc-guide">
      <Button
        className="wmc-guide-toggle"
        variant="ghost"
        size="sm"
        icon={<Question />}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Как это работает?
        <Caret aria-hidden="true" />
      </Button>
      {open && (
        <dl className="wmc-guide-steps">
          {steps.map(([title, text]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="ui-field wmc-toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button
        type="button"
        className={`ui-switch ${checked ? "is-on" : ""}`}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </label>
  );
}

/* Выбор цвета общий (`ui/ColorField`) — один вид во всех редакторах. Код
   цвета набирается руками: как у ползунков, где число — там и поле. */
export function ColorRow({ label, value, onChange }) {
  return (
    <ColorField
      className="wmc-color"
      label={label}
      value={value}
      editable
      onChange={onChange}
    />
  );
}

export function TextRow({
  label,
  value,
  onChange,
  placeholder = "",
  maxLength = 48,
}) {
  return (
    <label className="ui-field wmc-text">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/*
 * Строка выбора — общий орган словаря (`components/ui/Select.jsx`).
 * Обёртка осталась только ради имени класса, на которое написан местный лист.
 */
export function SelectRow({ label, value, options, onChange }) {
  return (
    <Select
      className="wmc-select"
      label={label}
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}

/* «Дублировать» и «Удалить» у выбранного объекта — справа в шапке раздела. */
export function ObjectActions({ onDuplicate, onRemove }) {
  useTr();
  return (
    <div className="wmc-section-actions">
      <button type="button" onClick={onDuplicate} title={tr("Дублировать")}>
        <Copy />
      </button>
      <button type="button" onClick={() => onRemove()} title={tr("Удалить")}>
        <Trash />
      </button>
    </div>
  );
}

export function ObjectRow({
  item,
  active,
  swatch,
  subtitle,
  onSelect,
  onToggle,
  onFocus,
  onRemove,
}) {
  useTr();
  return (
    <li className={`wmc-object ${active ? "is-active" : ""}`.trim()}>
      <button type="button" className="wmc-object-main" onClick={onSelect}>
        {swatch && <i style={{ background: swatch }} />}
        <span>
          <b>{item.name}</b>
          {subtitle && <small>{subtitle}</small>}
        </span>
      </button>
      <button
        type="button"
        className="wmc-object-action"
        aria-label={item.enabled ? tr("Скрыть") : tr("Показать")}
        title={item.enabled ? tr("Скрыть") : tr("Показать")}
        onClick={onToggle}
      >
        {item.enabled ? <Eye /> : <EyeSlash />}
      </button>
      <button
        type="button"
        className="wmc-object-action"
        aria-label={tr("Показать на карте")}
        title={tr("Показать на карте")}
        onClick={onFocus}
      >
        <ArrowsOut />
      </button>
      <button
        type="button"
        className="wmc-object-action is-danger"
        aria-label={tr("Удалить")}
        title={tr("Удалить")}
        onClick={onRemove}
      >
        <Trash />
      </button>
    </li>
  );
}

export const worldLabel = (item) =>
  `${Math.round(item.x)} · ${Math.round(item.y)}`;

/* Готовые цвета краски, зон и надписей — яркие, читаются на любой карте. */
export const BRUSH_SWATCHES = Object.freeze([
  "#ff5d72",
  "#ffb454",
  "#ffe066",
  "#5fd6a8",
  "#4fd8e8",
  "#6ea8ff",
  "#c69bff",
  "#ff7ad9",
  "#9aa3b2",
  "#ffffff",
  "#04060a",
]);

/*
 * Образцы цвета — общий ряд быстрых цветов (`ColorSwatches`, ТЗ 22.10.2026:
 * у карты были кружки по шесть, у неба и фонарей квадраты по семь, теперь
 * ряд один): одиннадцать готовых, недавние и «Свой цвет» — палитра Astral.
 * Пусто — «как у набора / как у всех»: ни один образец не выбран.
 */
export function Swatches({ value, onChange, label, colours = BRUSH_SWATCHES }) {
  useTr();
  return (
    <ColorSwatches
      label={label}
      value={value || ""}
      onChange={onChange}
      colours={colours}
      names={(colour) => `${tr("Цвет")} ${colour.toUpperCase()}`}
      ariaName={(name) => name}
    />
  );
}
