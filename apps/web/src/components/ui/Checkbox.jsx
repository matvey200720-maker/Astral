import SelectionMark from "./SelectionMark.jsx";

/*
 * Флажок: выбрать один пункт из набора.
 *
 * Не путать с `Switch`. Тумблер отвечает на «включить или нет» — он меняет
 * поведение сразу и целиком: показывать полоски, зафиксировать элемент. Флажок
 * отвечает на «этот тоже» — им отмечают зоны попадания, группы оружия, места в
 * зале. Разные вопросы, разные знаки, и подменять один другим значит врать о
 * том, что произойдёт после нажатия.
 *
 * Знак выбора в продукте один — `SelectionMark`, тот же, что в настройках и в
 * списках сборки. Нативный чекбокс рядом с ним выглядит деталью чужой
 * программы: своя рамка, свой цвет, свой радиус, которых больше нигде нет.
 * Настоящий `input` при этом остаётся, просто невидимым: он держит фокус с
 * клавиатуры, пробел и роль для читалки экрана — рисованный квадратик всего
 * этого не умеет.
 *
 * Раскладка обычная — строка с подписью слева и знаком справа. Где флажок
 * стоит внутри карточки или плитки, подпись не передают: её уже сказала сама
 * карточка, и второй раз она была бы шумом.
 *
 * Третий случай — строка списка, которую целиком отмечают: проверка в
 * оптимизации, мод в сборке. Там подпись не помещается в `label`: у строки
 * заголовок, метка и объяснение под ними. Для этого есть `children` — они
 * встают после знака, внутри того же `<label>`, и мишенью становится вся
 * строка, а не квадратик в 22 пикселя. Раскладку такой строки задаёт место
 * вызова; здесь только порядок: знак, потом содержимое.
 */

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Checkbox({
  label,
  hint,
  checked = false,
  onChange,
  disabled = false,
  className = "",
  ariaLabel,
  children = null,
}) {
  const name = ariaLabel || (typeof label === "string" ? label : undefined);

  return (
    <label
      className={joinClassNames(
        "ui-checkbox",
        label && "ui-field",
        disabled && "is-disabled",
        className,
      )}
    >
      {label && (
        <span className="ui-checkbox-copy">
          {label}
          {hint && <small>{hint}</small>}
        </span>
      )}
      <input
        type="checkbox"
        className="ui-checkbox-input"
        checked={checked}
        disabled={disabled}
        aria-label={name}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <SelectionMark on={checked} />
      {children}
    </label>
  );
}
