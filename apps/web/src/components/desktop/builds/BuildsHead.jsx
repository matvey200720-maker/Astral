import { tr, useTr } from "../../../locales/ui.js";
import "./builds-poster.css";

/*
 * Шапка «Сборок» (дизайн 15.11.2026, макет builds-B-list): крупное «Сборки», рядом вкладки «Мои N» и «По коду N» — текстом, активная с чертой, —
 * справа «Новая сборка». «По коду» — сборки, прочитанные из кода друга (`features/builds/code-history.js`).
 */
export default function BuildsHead({
  title,
  tab,
  onTab,
  mineCount,
  codeCount,
  actions = null,
}) {
  useTr();
  const tabs = [
    { id: "mine", label: tr("Мои"), count: mineCount },
    { id: "code", label: tr("По коду"), count: codeCount },
  ];
  return (
    <header className="builds-head">
      <div className="builds-head-left">
        <h1>{title}</h1>
        <nav className="builds-head-tabs" aria-label={title}>
          {tabs.map(({ id, label, count }) => (
            <button
              key={id}
              type="button"
              className={
                id === tab ? "builds-head-tab is-active" : "builds-head-tab"
              }
              aria-current={id === tab ? "page" : undefined}
              onClick={() => onTab(id)}
            >
              {label}
              <em>{count}</em>
            </button>
          ))}
        </nav>
      </div>
      {actions}
    </header>
  );
}
