import { useId } from "react";

/*
 * Поле ввода текста.
 *
 * Строк для набора у лаунчера немного — название работы, код, поиск, — и
 * каждая до сих пор рисовалась по месту: своя рамка в «Моих работах», своя в
 * сборках, своя в публикации. Здесь одно поле на все: подпись сверху, поле,
 * подсказка или ошибка под ним. `multiline` — многострочное (код работы
 * бывает длинным и приходит с переносами).
 *
 * Ошибка говорится текстом под полем и `aria-invalid`, а не одной красной
 * рамкой: цвет без слов читалка экрана не произносит.
 */

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function TextField({
  label,
  value = "",
  onChange,
  placeholder = "",
  hint = null,
  error = null,
  multiline = false,
  rows = 4,
  maxLength = undefined,
  autoFocus = false,
  spellCheck = undefined,
  mono = false,
  className = "",
  inputRef = undefined,
  onKeyDown = undefined,
  onFocus = undefined,
  ...rest
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  const Control = multiline ? "textarea" : "input";
  return (
    <div
      className={joinClassNames(
        "ui-text-field",
        multiline && "is-multiline",
        mono && "is-mono",
        error && "is-invalid",
        className,
      )}
    >
      {label && (
        <label className="ui-text-field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <Control
        ref={inputRef}
        id={id}
        className="ui-text-field-control"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        spellCheck={spellCheck}
        rows={multiline ? rows : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        {...rest}
      />
      {note && (
        <p
          id={noteId}
          className="ui-text-field-note"
          role={error ? "alert" : undefined}
        >
          {note}
        </p>
      )}
    </div>
  );
}
