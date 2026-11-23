/*
 * Набор отметок.
 *
 * «Отметь сколько угодно из многих коротких» — часы суток, в которые видна
 * радуга. Сегментированный орган отвечает «вот этот, один», флажок — «да или
 * нет» строкой на каждый вопрос. Здесь отмечают несколько из двадцати четырёх,
 * и подпись у отметки — два знака: двадцать четыре флажка столбцом заняли бы
 * всю колонку правок ради двузначных чисел.
 *
 * Каждая отметка — кнопка с `aria-pressed`: читалка экрана говорит «нажата»,
 * глаз видит заливку цветом выбора. Колонки задаёт место применения
 * (`grid-template-columns` у своего класса), как у сетки плиток выбора.
 *
 * ЧТО ВО ЧТО КЛАДУТ
 *   options — [{ value, label, ariaLabel?, tooltip?, disabled? }]; `ariaLabel`
 *             нужен, когда подпись сама не называет («07» — это «07:00»).
 *   values — отмеченные значения.
 *   onToggle(value, on) — отметку нажали; `on` — какой она станет.
 */

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function ToggleGrid({
  options = [],
  values = [],
  onToggle,
  label,
  className = "",
  disabled = false,
}) {
  const chosen = new Set(values);
  return (
    <div
      className={joinClassNames("ui-toggles", className)}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const on = chosen.has(option.value);
        return (
          <button
            type="button"
            key={option.value}
            className={joinClassNames("ui-toggle", on && "is-on")}
            aria-pressed={on}
            aria-label={option.ariaLabel || undefined}
            title={option.tooltip || undefined}
            disabled={disabled || option.disabled}
            onClick={() => onToggle?.(option.value, !on)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
