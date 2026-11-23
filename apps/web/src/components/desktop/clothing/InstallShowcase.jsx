import { ArrowCounterClockwise, X } from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Раскладка окна «Сделать заменёнку» по макету «Витрина» (16.11.2026): слева сцена на ~60 % окна — надстрочник, крупное название, строка «автор · вид · пол» и вещь мода во всю высоту без пустого поля;
 * справа выбор (вкладки, поиск, разделы, список) и свой низ — «Встанет на …», «Отмена», широкая «Установить». Закрытие — крестиком в правом верхнем углу.
 *
 * Окно вокруг — общий `Dialog` (подложка, фокус, Esc): он без шапки и подвала, всё лежит здесь. Происхождение кадра — подсказкой на сцене, а не подписью (решение владельца 25.10.2026: «эти надписи убери»).
 */
export default function InstallShowcase({
  kicker,
  title,
  byline = "",
  via = null,
  stage,
  stageNote = "",
  side,
  foot,
  onClose,
}) {
  useTr();
  return (
    <div className="showcase">
      <aside className="showcase-scene" aria-label={title}>
        <header className="showcase-head">
          <span className="showcase-kicker">{kicker}</span>
          <h2 className="showcase-title">{title}</h2>
          {byline ? <p className="showcase-byline">{byline}</p> : null}
          {via}
        </header>
        <div className="showcase-stage" title={stageNote || undefined}>
          {stage}
        </div>
        <p className="showcase-rollback">
          <ArrowCounterClockwise aria-hidden="true" />
          <span>{tr("Откат в один клик")}</span>
          <i aria-hidden="true" />
          <span>{tr("оригинал вещи сохранится")}</span>
        </p>
      </aside>
      <section className="showcase-side">
        <button
          type="button"
          className="showcase-close"
          aria-label={tr("Закрыть")}
          title={tr("Закрыть")}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
        <div className="showcase-pick">{side}</div>
        <footer className="showcase-foot">{foot}</footer>
      </section>
    </div>
  );
}
