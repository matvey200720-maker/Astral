import { useEffect, useRef } from "react";
import { MagnifyingGlass } from "../../../components/ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import "./poster.css";

const TYPING = /^(?:INPUT|TEXTAREA|SELECT)$/;

/*
 * Поиск редактора в шапке мастерской: фильтрует плитки афиши по названию и описанию (`WorkshopPoster`).
 * «/» с любого места вкладки ставит курсор в поле, «Esc» очищает набранное.
 */
export default function EditorSearch({ value, onChange }) {
  useTr();
  const field = useRef(null);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || TYPING.test(target.tagName))
      )
        return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <label className="wsh-search">
      <MagnifyingGlass aria-hidden="true" />
      <input
        ref={field}
        type="search"
        value={value}
        placeholder={tr("Найти редактор")}
        aria-label={tr("Найти редактор")}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onChange("");
            event.currentTarget.blur();
          }
        }}
      />
      <kbd aria-hidden="true">/</kbd>
    </label>
  );
}
