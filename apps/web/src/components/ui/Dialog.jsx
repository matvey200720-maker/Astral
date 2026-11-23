import { Activity, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "./icons.jsx";
import { createPortal } from "react-dom";

// Хосты по порядку: оверлей оболочки, затем приложение, затем body.
const HOST_SELECTORS = ["[data-desktop-overlay-host]", ".desktop-app"];
const TAB_STOPS =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable]:not([contenteditable='false']), [tabindex]";

const cx = (...names) => names.filter(Boolean).join(" ");

// Подписка на документ, которая сама себя снимает.
const listen = (type, handler) => {
  document.addEventListener(type, handler);
  return () => document.removeEventListener(type, handler);
};

// Куда Tab/Shift+Tab должен увести фокус, чтобы он не покинул панель; null — пусть идёт сам.
const wrapTarget = (panel, backwards) => {
  const ring = [...panel.querySelectorAll(TAB_STOPS)].filter(
    (node) => node.tabIndex >= 0 && node.getAttribute("aria-hidden") !== "true" && !node.closest("[hidden]"),
  );
  if (!ring.length) return panel;
  const edges = backwards ? [ring[0], panel] : [ring[ring.length - 1]];
  return edges.includes(document.activeElement) ? ring[backwards ? ring.length - 1 : 0] : null;
};

// Хост выбирается заново при каждом открытии, а открытое окно запоминает, откуда пришёл фокус.
const useOverlayHost = (open, keep, backRef) => {
  const [host, setHost] = useState(null);
  useLayoutEffect(() => {
    if (!open && !keep) return;
    if (open) backRef.current = document.activeElement;
    setHost(HOST_SELECTORS.map((selector) => document.querySelector(selector)).find(Boolean) ?? document.body);
  }, [open, keep, backRef]);
  return host;
};

// Блокировка прокрутки и клавиши на документе, пока окно открыто.
const useLockAndKeys = (open, panelRef, { onClose, dismissible, scrollLockClass: lockClass, scrollSurfaceClass: surfaceClass }) => {
  useEffect(() => {
    if (!open) return undefined;
    const undo = [];
    const app = document.querySelector(".desktop-app");
    [[document.body, lockClass], [app, lockClass], [app?.querySelector(".desktop-main"), surfaceClass]].forEach(([node, name]) => {
      if (!node) return;
      node.classList.add(name);
      undo.push(() => node.classList.remove(name));
    });
    const keyRules = {
      Tab(event, panel) {
        const target = panel.contains(document.activeElement) ? wrapTarget(panel, event.shiftKey) : null;
        if (!target) return;
        event.preventDefault();
        target.focus();
      },
      Escape(event, panel) {
        const stack = document.querySelectorAll(".ui-dialog-backdrop:not(.is-kept) > .ui-dialog");
        if (dismissible && !event.defaultPrevented && stack[stack.length - 1] === panel) onClose?.();
      },
    };
    undo.push(
      listen("keydown", (event) => {
        if (Object.hasOwn(keyRules, event.key) && panelRef.current) keyRules[event.key](event, panelRef.current);
      }),
    );
    return () => undo.reverse().forEach((release) => release());
  }, [open, onClose, dismissible, lockClass, surfaceClass, panelRef]);
};

// Фокус на панель (сразу или в ближайшем кадре); при уходе — обратно туда, откуда пришли.
const useFocusCapture = (open, host, deferFocus, panelRef, backRef) => {
  useEffect(() => {
    if (!open || !host) return undefined;
    let frame = null;
    const grab = () => {
      const panel = panelRef.current;
      if (panel?.isConnected && !panel.contains(document.activeElement)) panel.focus();
    };
    if (deferFocus) frame = requestAnimationFrame(grab);
    else grab();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      const back = backRef.current;
      backRef.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [open, host, deferFocus, panelRef, backRef]);
};

// Умолчания: только там, где undefined и «не задано» различаются; остальные свойства читаются как есть.
const withDefaults = ({
  dismissible = true,
  open = true,
  showClose = true,
  size = "md",
  copyTag = "div",
  kickerTag = "span",
  closeLabel = "Закрыть",
  scrollLockClass = "ui-dialog-open",
  scrollSurfaceClass = "ui-dialog-scroll-locked",
  ...rest
}) => ({ ...rest, open, dismissible, showClose, size, copyTag, kickerTag, closeLabel, scrollLockClass, scrollSurfaceClass });

export default function Dialog(props) {
  const p = withDefaults(props);
  const { open, keep, role = "dialog", copyTag: CopyTag, kickerTag: KickerTag } = p;
  const panelRef = useRef(null);
  const backRef = useRef(null);
  const frozen = useRef(p.children);
  const host = useOverlayHost(open, keep, backRef);
  useLockAndKeys(open, panelRef, p);
  useFocusCapture(open, host, p.deferFocus, panelRef, backRef);

  if (!host || (!open && !keep)) return null;
  const parked = keep && !open;
  if (open) frozen.current = p.children;

  const naming = p.titleId || (p.title ? "ui-dialog-title" : undefined);
  const head =
    p.title || p.kicker || p.description || p.showClose ? (
      <header className={p.headerClassName || undefined}>
        <CopyTag>
          {p.kicker && <KickerTag>{p.kicker}</KickerTag>}
          {p.title && <h2 id={naming}>{p.title}</h2>}
          {p.description && <p>{p.description}</p>}
        </CopyTag>
        {p.showClose && (
          <button type="button" disabled={!p.dismissible} aria-label={p.closeLabel} title={p.closeLabel} onClick={() => p.onClose?.()}>
            <X />
          </button>
        )}
      </header>
    ) : null;
  const strip = p.subheader != null && p.subheader !== false && <div className={cx("ui-dialog-subheader", p.subheaderClassName)}>{p.subheader}</div>;
  const body = p.children != null && p.children !== false && (
    <div className={cx("ui-dialog-body", p.bodyClassName)}>
      <Activity mode={parked ? "hidden" : "visible"}>{frozen.current}</Activity>
    </div>
  );
  const split = p.aside && (
    <div className="ui-dialog-split">
      <aside className={cx("ui-dialog-aside", p.asideClassName)} aria-label={p.asideLabel || undefined}>
        {p.aside}
      </aside>
      {body}
    </div>
  );
  const names = {
    /* `nameLabel` — имя окна задано словами отдельно от заголовка: у окна заменёнки заголовок — название мода, а окно зовётся «Сделать заменёнку». */
    "aria-labelledby": p.nameLabel ? undefined : naming,
    "aria-label":
      p.nameLabel || (naming ? undefined : p.ariaLabel || undefined),
    "aria-describedby": p.descriptionId || undefined,
  };
  const foot = p.footer ?? (p.status || p.actions ? <footer>{p.status && <span>{p.status}</span>}{p.actions}</footer> : null);

  return createPortal(
    <div
      className={cx("ui-dialog-backdrop", p.backdropClassName, parked && "is-kept")}
      {...(parked ? { style: { pointerEvents: "none" }, "aria-hidden": "true" } : { role: "presentation" })}
      onMouseDown={(event) => p.dismissible && event.target === event.currentTarget && p.onClose?.()}
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className={cx("ui-dialog", `is-${p.size}`, p.className)}
        role={parked ? undefined : role}
        aria-modal={parked ? undefined : "true"}
        {...names}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          if (p.dismissible) p.onClose?.();
        }}
      >
        {head}
        {strip}
        {split || body}
        {foot}
      </section>
    </div>,
    host,
  );
}
