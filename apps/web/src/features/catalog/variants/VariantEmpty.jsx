import { CloudArrowDown, SquaresFour } from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";

/*
 * Пустое состояние вкладки «Каталог» в видах: тот же ответ, что и в прежнем виде (`emptyResult()` из `PublicCatalog.jsx` — причина одной фразой и одно
 * действие, которое меняет результат), тот же орган `EmptyState`. Загрузка каталога — тоже оно (`pending`): каркас с «Загружаю…», а не пустота.
 */
export default function VariantEmpty({ model }) {
  const { words, onNavigate } = model;
  const state = model.emptyResult();
  return (
    <EmptyState
      className="public-catalog-empty"
      icon={state.pending ? CloudArrowDown : SquaresFour}
      headingLevel={3}
      aria-busy={state.pending || undefined}
      data-pending={state.pending ? "true" : undefined}
      title={state.title}
      text={state.note}
      actions={
        state.action ? (
          <Button variant="secondary" className="public-catalog-empty-action" onClick={state.action.onClick}>
            {state.action.label}
          </Button>
        ) : null
      }
    >
      {state.routes?.length ? (
        <div className="public-catalog-routes" aria-label={words.buildInWorkshop}>
          {state.routes.map((route) => (
            <button type="button" key={route.slot} className="public-catalog-route" onClick={() => onNavigate("workshop", { slot: route.slot })}>
              <span className="public-catalog-route-media" aria-hidden="true">
                <img src={route.cover} alt="" loading="lazy" />
              </span>
              <b>{route.title}</b>
              <small>{route.description}</small>
              <em>{words.buildInWorkshop}</em>
            </button>
          ))}
        </div>
      ) : null}
    </EmptyState>
  );
}
