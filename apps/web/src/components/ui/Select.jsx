import { createElement as h, Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal as Dom_createPortal } from "react-dom";
import { CaretDown, Check } from "./icons.jsx";
import { placeBelowAnchor, resolveOverlayHost } from "./overlay-anchor.js";


const IDLE = { open: false, active: -1, place: null };
const AWAY = { top: -9999, left: -9999 };
const OPENERS = ["ArrowDown", "ArrowUp", "Enter", " ", "F4"];
// Перемещение подсветки: шаг и откуда считать (от подсвеченной, от начала, от конца ряда).
const MOVES = { ArrowDown: [1, (at) => at], ArrowUp: [-1, (at) => at], Home: [1, () => -1], End: [-1, (at, n) => n] };

// Запись списка: пара или объект; value читается первым — у null именно оно и падает.
const rec = (e) =>
  Array.isArray(e) ? { value: e[0], label: e[1] } : { value: e.value, label: e.label, off: !!e.disabled, lang: e.lang };
// Подпись как текст: строка или число; узел текстом не становится.
const caption = (r) => (["string", "number"].includes(typeof r.label) ? String(r.label) : "");
const live = (r) => Boolean(r) && !r.head && !r.off;
// Слияние частей состояния; без перемен остаётся прежний объект и перерисовки нет.
const merge = (was, part) => (Object.entries(part).every(([k, v]) => Object.is(was[k], v)) ? was : { ...was, ...part });

// Подписки живут, пока on истинно: список [цель, событие, обработчик, фаза] строится при включении.
const useListening = (on, build) => {
  useEffect(() => {
    if (!on) return undefined;
    const subs = build();
    subs.forEach(([target, ...args]) => target.addEventListener(...args));
    return () => subs.forEach(([target, ...args]) => target.removeEventListener(...args));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
};

// Слушатели открытого списка: нажатие и прокрутка мимо закрывают, Escape закрывает с возвратом фокуса.
const guards = ({ control, menu, finish, measure }) => {
  const inside = (box, node) => box.current?.contains(node);
  return [
    [document, "pointerdown", (e) => {
      if (!inside(control, e.target) && !inside(menu, e.target)) finish(false);
    }],
    [document, "keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      finish(true);
    }, true],
    [document, "scroll", (e) => {
      if (!inside(menu, e.target)) finish(false);
    }, true],
    [window, "resize", measure],
    [window, "blur", () => finish(false)],
  ];
};

export default function Select({ label, hint, value, options = [], onChange, disabled = false, className = "", ariaLabel }) {
  const [state, setState] = useState(IDLE);
  const { open, active, place } = state;
  const patch = (part) => setState((was) => merge(was, part));
  const id = useId();
  const [field, control, menu] = [useRef(null), useRef(null), useRef(null)];
  const typed = useRef({ text: "", at: 0 });

  const tree = [...options].map((e) => {
    const own = rec(e);
    return Array.isArray(e.options) ? { name: e.group, kids: e.options.map(rec) } : own;
  });
  const rows = tree.flatMap((node) => (node.kids ? [{ head: true, label: node.name }, ...node.kids] : node));
  const chosen = rows.findIndex((r) => !r.head && String(r.value) === String(value ?? ""));
  const walk = (from, step) => {
    let at = from + step;
    while (rows[at] && !live(rows[at])) at += step;
    return rows[at] ? at : from;
  };
  const finish = (refocus) => {
    patch({ open: false });
    if (refocus) field.current?.focus();
  };
  const choose = (i) => {
    if (!live(rows[i])) return;
    finish(true);
    if (String(rows[i].value) !== String(value ?? "")) onChange?.(String(rows[i].value));
  };
  const unfold = () => patch({ open: true, place: null, active: live(rows[chosen]) ? chosen : walk(-1, 1) });
  const measure = () => {
    const box = control.current?.getBoundingClientRect();
    const size = menu.current ?? {};
    const spot = box && placeBelowAnchor(box, "start", size.offsetHeight || 0, size.offsetWidth || 0);
    if (spot) patch({ place: { ...spot, minWidth: Math.round(box.width) } });
  };
  const recall = (key) => {
    const now = Date.now();
    const kept = now - typed.current.at < 700 ? typed.current.text : "";
    const word = (kept + key).toLowerCase();
    typed.current = { text: word, at: now };
    const ring = Array.from(rows, (_, k) => (active + 1 + k) % rows.length);
    const hit = ring.find((i) => live(rows[i]) && caption(rows[i]).toLowerCase().startsWith(word));
    if (hit !== undefined) patch({ active: hit });
  };

  // Что делает клавиша при открытом списке; Tab и чужие клавиши ничего не отменяют.
  const intent = (e) => {
    const { key } = e;
    if (Object.hasOwn(MOVES, key)) {
      const [step, origin] = MOVES[key];
      return () => patch({ active: walk(origin(active, rows.length), step) });
    }
    if (key === "Enter" || key === " ") return () => choose(active);
    if (key.length === 1 && !(e.ctrlKey || e.altKey || e.metaKey)) return () => recall(key);
    return undefined;
  };
  const onKeyDown = (e) => {
    if (disabled) return;
    let act;
    if (open) act = intent(e);
    else if (OPENERS.includes(e.key)) act = unfold;
    if (open && e.key === "Tab") {
      patch({ open: false });
      return;
    }
    if (!act) return;
    e.preventDefault();
    act();
  };
  const onMouseDown = (e) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    field.current.focus();
    if (open) patch({ open: false });
    else unfold();
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => (open ? measure() : undefined), [open, tree.length]);

  useListening(open, () => guards({ control, menu, finish, measure }));

  useEffect(() => {
    if (open && active >= 0) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const option = (r) => h("option", { key: r.value, value: r.value, disabled: r.off, lang: r.lang }, r.label);
  const line = (r, i) =>
    r.head
      ? h("div", { key: `heading-${i}`, role: "presentation", className: "ui-menu-heading" }, r.label)
      : h(
          "div",
          {
            key: `${r.value}-${i}`,
            id: `${id}-option-${i}`,
            "data-index": i,
            role: "option",
            "aria-selected": i === chosen,
            "aria-disabled": r.off || undefined,
            className: ["ui-menu-item", i === chosen && "is-active", i === active && "is-current", r.off && "is-disabled"].filter(Boolean).join(" "),
            title: caption(r) || undefined,
            lang: r.lang,
            onMouseDown: (e) => e.preventDefault(),
            onMouseMove: () => {
              if (live(r) && i !== active) patch({ active: i });
            },
            onClick: () => choose(i),
          },
          h("span", null, r.label),
          i === chosen && h(Check, { "aria-hidden": "true" }),
        );
  const choices = tree.map((node) => (node.kids ? h("optgroup", { key: `group:${node.name}`, label: node.name }, node.kids.map(option)) : option(node)));
  const classes = ["ui-field ui-select", hint && "is-stacked", open && "is-open", className].filter(Boolean).join(" ");
  const name = ariaLabel || (typeof label === "string" ? label : undefined);

  return h(
    Fragment,
    null,
    h(
      "label",
      { className: classes },
      label ? h("span", { className: "ui-select-copy" }, label, hint && h("small", null, hint)) : null,
      h(
        "span",
        { className: "ui-select-control", ref: control },
        h(
          "select",
          {
            ref: field,
            value: value ?? "",
            disabled,
            "aria-label": name,
            "aria-haspopup": "listbox",
            "aria-expanded": open ? "true" : "false",
            "aria-controls": open ? id : undefined,
            "aria-activedescendant": open && active >= 0 ? `${id}-option-${active}` : undefined,
            onChange: (e) => onChange?.(e.target.value),
            onKeyDown,
            onMouseDown,
          },
          choices,
        ),
        h(CaretDown, { "aria-hidden": "true" }),
      ),
    ),
    open
      ? Dom_createPortal(
          h("div", { id, className: "ui-menu ui-select-menu", role: "listbox", "aria-label": name, style: place ?? AWAY, ref: menu }, rows.map(line)),
          resolveOverlayHost(),
        )
      : null,
  );
}
