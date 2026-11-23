import {
  ArrowLeft,
  ArrowUUpLeft,
  ArrowUUpRight,
  Check,
  Prohibit,
} from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import "./optimizer-frame.css";

/*
 * Рама «Оптимизации» (дизайн 15.11.2026, макеты r6/workshop/optimization-a и r6/opt2/opt2-a-*): под шапкой мастерской — ряд разделов
 * («Карточки», «Ухудшение текстур», «Дальность прорисовки», «ЧБ-мир», «Стиль мира») и итог справа («В игре 3 из 7», «Выключить всё»,
 * стрелки истории). Ниже — сцена выбранного раздела: у «Карточек» её рисует страница сама (`children`), у остальных четырёх — кадр слева
 * и панель справа, а под ними — полоса на всю ширину (плёнка шагов, `stripRef`); вкладка кладёт их порталом в гнёзда рамы (`stageRef`, `panelRef`, `stripRef`; прежний `OptimizerSlots`).
 *
 * Без шапки мастерской (`embedded` нет — библиотека открывает оптимизацию редактором) рама рисует свой заголовок со стрелкой «назад».
 */
export default function OptimizerFrame({
  tools,
  tool,
  onTool,
  counts = {},
  summary = "",
  summaryOn = false,
  history = null,
  onOffAll = null,
  offAllLabel = "",
  offAllDisabled = false,
  embedded = false,
  title = "",
  onBack = null,
  backLabel = "",
  stageRef,
  panelRef,
  stripRef,
  rebuildNote = null,
  children,
}) {
  useTr();
  return (
    <div className="opf" data-tool={tool} data-embedded={embedded || undefined}>
      {!embedded && (
        <header className="opf-top">
          {onBack && (
            <button
              type="button"
              className="opf-back"
              onClick={onBack}
              aria-label={backLabel}
              title={backLabel}
            >
              <ArrowLeft />
            </button>
          )}
          <h1>{title}</h1>
        </header>
      )}
      <div className="opf-row">
        <nav className="opf-tabs" aria-label={title || tr("Оптимизация")}>
          {tools.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`opf-tab${item.id === tool ? " is-active" : ""}`}
              data-tool={item.id}
              aria-current={item.id === tool ? "page" : undefined}
              title={item.hint || undefined}
              onClick={() => onTool(item.id)}
            >
              {item.label}
              {counts[item.id] ? <em>{counts[item.id]}</em> : null}
            </button>
          ))}
        </nav>
        <div className="opf-summary">
          {history && (
            <span className="opf-history">
              <button
                type="button"
                className="opf-icon"
                disabled={!history.canUndo}
                onClick={history.onUndo}
                aria-label={tr("Отменить действие")}
                title={tr("Отменить действие")}
              >
                <ArrowUUpLeft />
              </button>
              <button
                type="button"
                className="opf-icon"
                disabled={!history.canRedo}
                onClick={history.onRedo}
                aria-label={tr("Повторить действие")}
                title={tr("Повторить действие")}
              >
                <ArrowUUpRight />
              </button>
            </span>
          )}
          {summary && (
            <span className="opf-pill" data-on={summaryOn || undefined}>
              {summaryOn && (
                <i aria-hidden="true">
                  <Check weight="bold" />
                </i>
              )}
              {summary}
            </span>
          )}
          {onOffAll && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Prohibit />}
              disabled={offAllDisabled}
              onClick={onOffAll}
            >
              {offAllLabel}
            </Button>
          )}
        </div>
      </div>
      {tool === "cut" ? (
        children
      ) : (
        <div className="opf-work">
          <div className="opf-stage-host optimizer-stage-host" ref={stageRef} />
          <div className="opf-panel optimizer-panel-host">
            {rebuildNote}
            <div ref={panelRef} />
          </div>
          {/* Вкладка кладёт свой кадр и панель в гнёзда выше порталом: сама она на странице ничего не рисует. */}
          {children}
          <div className="opf-strip-host" ref={stripRef} />
        </div>
      )}
    </div>
  );
}
