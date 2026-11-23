import { cardProjectsOf } from "../../../../../features/catalog/card-projects.js";

/*
 * Теги серверов под названием (страница-галерея, 21.11.2026). Версии по серверам (GTA 5 RP / Majestic) — переключатель: выбранная подсвечена, нажатие меняет версию страницы;
 * иначе — просто метки. Блоки «Что изменится в игре» (Было → Станет) и «откат в один клик · вес» прежней правой панели убраны вместе с панелью: вес теперь тег, откат — подсказка
 * к кнопке «Удалить».
 */

/** Чипы серверов. */
export function ServerChips({ view, servers }) {
  const choice = view.plan.variantChoice;
  if (servers && choice) {
    const locked = Boolean(choice.busy || view.plan.active);
    return (
      <div
        className="xw-chips is-switch"
        role="group"
        aria-label={view.actionCopy.variant}
        data-count={servers.length}
      >
        {servers.map(({ id, project }) => (
          <button
            key={id}
            type="button"
            className={`xw-chip is-button${choice.value === id ? " is-active" : ""}`}
            aria-pressed={choice.value === id}
            disabled={locked}
            onClick={() => choice.onChange(id)}
          >
            {project.label}
          </button>
        ))}
      </div>
    );
  }
  const projects = cardProjectsOf(view.mod);
  if (projects.length === 0) return null;
  return (
    <div className="xw-chips">
      {projects.map((project) => (
        <span key={project.id} className="xw-chip">
          {project.label}
        </span>
      ))}
    </div>
  );
}
