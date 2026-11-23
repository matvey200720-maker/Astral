import { tr, useTr } from "../../../locales/ui.js";
import "./poster.css";

/*
 * Шапка мастерской (дизайн 15.11.2026): крупное «Мастерская», рядом вкладки разделов — текстом, активная с чертой, — справа органы
 * раздела (поиск редактора, «Мои работы»). Одна на все вкладки: «Редакторы», «Оружие», «Одежда», «Анимации», «Оптимизация».
 * Вкладки — ссылки на разделы (`aria-current`), как были: смена раздела — `onSectionChange(id)`.
 */
export default function WorkshopHead({
  sections,
  section,
  hints = {},
  counts = {},
  onSectionChange,
  actions = null,
  label,
}) {
  useTr();
  return (
    <header className="wsh">
      <div className="wsh-left">
        <h1>{tr("Мастерская")}</h1>
        <nav className="wsh-tabs" aria-label={label}>
          {sections.map(([id, name]) => (
            <button
              key={id}
              type="button"
              className={`wsh-tab${id === section ? " is-active" : ""}`}
              data-tab={id}
              aria-current={id === section ? "page" : undefined}
              title={hints[id] ? `${name} — ${tr(hints[id])}` : name}
              onClick={() => onSectionChange(id)}
            >
              {name}
              {counts[id] ? <em>{counts[id]}</em> : null}
            </button>
          ))}
        </nav>
      </div>
      {actions && <div className="wsh-actions">{actions}</div>}
    </header>
  );
}
