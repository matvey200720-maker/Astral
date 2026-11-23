import { useRef } from "react";
import Button from "../../../components/ui/Button.jsx";
import { Plus } from "../../../components/ui/icons.jsx";
import { useHiddenBelow } from "./ribbon-model.js";

/*
 * Списки «Ленты» (владелец, 16.11.2026, макет v2): слева «Дальше в очереди», справа библиотека (`features/downloads/DownloadsLibrary.jsx`). «Готово сегодня»,
 * «После установки» и полосы сводки между героем и списками больше нет. Строки очереди и отказов — `CatalogItems.jsx` и `WorkshopInstallRow.jsx`; здесь рамка
 * карточки и пустая очередь (и когда ничего не идёт: тогда слева та же карточка, а в ней дорога к корзине).
 */

/** Карточка списка: заголовок со счётом, справа слово, прокручиваемое тело; затухание внизу, когда строки не влезли.
    Плашки «ещё N» в шапке нет (владелец, 17.11.2026: «толку не несёт»): что список длиннее, говорят счёт в заголовке и затухание. */
export function Card({
  title,
  count,
  aside,
  className = "",
  bodyClassName = "",
  before = null,
  children,
  signal,
  auditIgnore = undefined,
}) {
  const body = useRef(null);
  const hidden = useHiddenBelow(body, signal);
  return (
    <section
      className={`dl-card ${className}`.trim()}
      aria-label={title}
      data-audit-ignore={auditIgnore}
    >
      <header className="dl-card-head">
        <span>{title}</span>
        {count == null ? null : <i className="dl-count">{count}</i>}
        {aside ? <span className="dl-card-aside">{aside}</span> : null}
      </header>
      {before}
      <div className={`dl-card-body ${bodyClassName}`.trim()} ref={body}>
        {children}
      </div>
      {hidden > 0 ? <div className="dl-card-fade" aria-hidden="true" /> : null}
    </section>
  );
}

/**
 * Пустая очередь. Рядом с идущей установкой — приглашение добавить из каталога; ничего не идёт (`idle`, владелец 17.11.2026: «пока ничего не качается») — та же карточка слева
 * и библиотека справа, как при загрузках, а в карточке дорога к корзине. Остановившаяся установка и пустая очередь — «Добавьте мод в каталоге».
 */
export function EmptyQueue({
  rc,
  onOpenCatalog,
  onOpenCart = null,
  running = true,
  idle = false,
}) {
  const title = idle ? rc.queueIdleTitle : rc.emptyQueueTitle;
  const text = idle
    ? rc.queueIdleText
    : running
      ? rc.emptyQueueText
      : rc.emptyQueueTextIdle;
  const action = idle ? onOpenCart : onOpenCatalog;
  return (
    <div className="dl-empty">
      <span className="dl-empty-mark" aria-hidden="true">
        <Plus />
      </span>
      <b>{title}</b>
      <span>{text}</span>
      {action ? (
        <Button variant="primary" size="sm" onClick={action}>
          {idle ? rc.openCart : rc.openCatalog}
        </Button>
      ) : null}
    </div>
  );
}
