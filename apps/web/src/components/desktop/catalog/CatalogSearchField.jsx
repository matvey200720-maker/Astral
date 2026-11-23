import { memo, useEffect, useState } from "react";
import { MagnifyingGlass, X } from "../../ui/icons.jsx";

/*
 * Поле поиска каталога — свой компонент со своим текстом (31.10.2026, набор в поиске).
 *
 * Текст лежал в состоянии страницы: каждая буква — срочная перерисовка всей `PublicCatalog` (навигация, шапка, сетка), 10–20 мс при ×4 и тот же коммит, на котором стоит эхо
 * буквы. Теперь поле держит набранное само — буква перерисовывает только его, — а страница получает запрос отдельной задачей сразу за ним (`setTimeout`): её рендер — не в кадре эха. Переход (`startTransition`) для этого оказался медленнее: рендер кусками по 5 мс с паузами на кадры
 * откладывал начало расчёта выдачи на ~50 мс (первые ряды +253 против +198 мс при ×4). `value` — запрос страницы (то, по чему показана выдача). Когда его меняет не поле (ссылка из другого раздела, «Сбросить поиск», «Искать везде»), страница прибавляет `epoch`,
 * и поле берёт `value` себе: по самому `value` этого не понять — он приходит с отставанием от набранного и не отличить от чужой правки.
 */
function CatalogSearchField({ value, epoch = 0, onCommit, inputRef, placeholder, label, clearLabel }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
    // Только чужая правка (`epoch`): `value` отстаёт от набранного, и его эхо затёрло бы буквы, набранные за это время.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  const commit = (next) => {
    setText(next);
    /* Тесты (`test/setup.js`) ждут запрос страницы в том же действии, как и выдачу в рендере (`useCatalogResults`). */
    if (globalThis.__ASTRAL_RESULTS_SYNC__ === true) onCommit(next);
    else globalThis.setTimeout(() => onCommit(next), 0);
  };
  return (
    <label className="catalog-search-field">
      <MagnifyingGlass aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && text) {
            event.stopPropagation();
            commit("");
          }
        }}
        placeholder={placeholder}
        aria-label={label}
      />
      {/* Кнопка очистки стоит в поле всегда и только гаснет: появление
          не меняет ширину поля и не двигает текст. */}
      <button
        type="button"
        className={`catalog-search-clear${text ? " is-visible" : ""}`}
        aria-label={clearLabel}
        tabIndex={text ? 0 : -1}
        aria-hidden={text ? undefined : "true"}
        onClick={() => {
          commit("");
          inputRef.current?.focus();
        }}
      >
        <X aria-hidden="true" />
      </button>
    </label>
  );
}

export default memo(CatalogSearchField);
