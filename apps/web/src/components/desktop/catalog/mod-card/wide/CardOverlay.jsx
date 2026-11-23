import { useEffect, useRef } from "react";
import DesktopOverlayPortal from "../../../overlays/DesktopOverlayPortal.jsx";
import Button from "../../../../ui/Button.jsx";
import { X } from "../../../../ui/icons.jsx";
import { tr } from "../../../../../locales/ui.js";

/*
 * Два слоя поверх страницы мода (страница-галерея, 21.11.2026): предпросмотр по клику на кадр (`PreviewFrame`) и панель справа «Состав» (`SideDrawer`).
 *
 * Общее у обоих: клавиатура и фокус. Esc закрывает слой и дальше не идёт (страница под ним по Esc не уходит «назад»); щелчок по фону — закрывает; Tab ходит по кругу внутри
 * слоя, фокус не убегает за окно; при закрытии он возвращается на то, чем слой открыли. Крестик — один, в правом углу самой карточки слоя. У предпросмотра он голый (владелец,
 * 22.11.2026): ни плиты, ни рамки, ни тени вокруг — только значок с тонкой тенью на нём самом, мишень шире значка и невидимая, кольцо фокуса только с клавиатуры. У панели «Состав»
 * крестик — квадрат шапки, как в макете. Предпросмотр внутри не листается: другой кадр — только после закрытия.
 */

const FOCUSABLE =
  "button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";

// Tab ходит по кругу между органами слоя.
function trapTab(event, root) {
  const nodes = [...root.querySelectorAll(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const outside = !root.contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

// Esc, Tab и возврат фокуса. Крестик получает фокус при открытии.
function useOverlayLife(rootRef, closeRef, onClose) {
  const closing = useRef(onClose);
  closing.current = onClose;
  useEffect(() => {
    const returnTo = document.activeElement;
    closeRef.current?.focus?.({ preventScroll: true });
    const onKey = (event) => {
      /* Поверх слоя может стоять другое окно (3D, «Компоненты», предпросмотр над панелью): клавиши — верхнему, а не обоим. */
      const stack = document.querySelectorAll("[role='dialog']");
      if (stack.length && stack[stack.length - 1] !== rootRef.current) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        closing.current();
      } else if (event.key === "Tab" && rootRef.current) {
        trapTab(event, rootRef.current);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      returnTo?.focus?.({ preventScroll: true });
    };
  }, [closeRef, rootRef]);
}

const CloseButton = ({ closeRef, label, onClose, bare = false }) =>
  bare ? (
    <button
      ref={closeRef}
      type="button"
      className="xw-overlay-x"
      aria-label={label}
      title={label}
      onClick={onClose}
    >
      <X aria-hidden="true" />
    </button>
  ) : (
    <Button
      ref={closeRef}
      variant="secondary"
      size="sm"
      className="xw-overlay-close"
      icon={<X />}
      ariaLabel={label}
      title={label}
      onClick={onClose}
    />
  );

/** Предпросмотр: карточка по центру, крестик в её правом верхнем углу; `label` — имя окна для чтения с экрана. */
export function PreviewFrame({ label, onClose, className = "", children }) {
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  useOverlayLife(rootRef, closeRef, onClose);
  return (
    <DesktopOverlayPortal>
      <div
        ref={rootRef}
        className="xw-overlay is-preview"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className={`xw-preview-card${className ? ` ${className}` : ""}`}>
          {children}
          <CloseButton
            bare
            closeRef={closeRef}
            label={tr("Закрыть предпросмотр")}
            onClose={onClose}
          />
        </div>
      </div>
    </DesktopOverlayPortal>
  );
}

/** Панель справа: заголовок и подпись, тело листается, низ (`footer`) стоит на месте. */
export function SideDrawer({
  label,
  title,
  hint = "",
  onClose,
  extra = null,
  footer = null,
  children,
}) {
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  useOverlayLife(rootRef, closeRef, onClose);
  return (
    <DesktopOverlayPortal>
      <div
        ref={rootRef}
        className="xw-overlay is-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <aside className="xw-drawer">
          <header className="xw-drawer-head">
            <div className="xw-drawer-copy">
              <h2>{title}</h2>
              {hint && <p>{hint}</p>}
            </div>
            <div className="xw-drawer-tools">
              {extra}
              <CloseButton
                closeRef={closeRef}
                label={tr("Закрыть состав")}
                onClose={onClose}
              />
            </div>
          </header>
          <div className="xw-drawer-body">{children}</div>
          {footer && <footer className="xw-drawer-foot">{footer}</footer>}
        </aside>
      </div>
    </DesktopOverlayPortal>
  );
}
