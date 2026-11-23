import { createElement as h, Fragment, useEffect as onMount, useRef, useState } from "react";
import Button from "../../../ui/Button.jsx";
import DesktopOverlayPortal from "../../overlays/DesktopOverlayPortal.jsx";
import { CaretLeft, CaretRight, X } from "../../../ui/icons.jsx";

// Две стрелки: класс кнопки, значок, слово из copy и шаг по кругу.
const ARROWS = {
  back: { className: "mod-frame-viewer-arrow is-left is-glass", Glyph: CaretLeft, word: "previous", shift: -1 },
  forward: { className: "mod-frame-viewer-arrow is-right is-glass", Glyph: CaretRight, word: "next", shift: 1 },
};

// Клавиши листания и их шаг.
const KEY_SHIFTS = new Map([
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
]);

const listen = (target, name, handler) => {
  target.addEventListener(name, handler);
  return () => target.removeEventListener(name, handler);
};

const arrowButton = (side, copy, step) => {
  const { className, Glyph, word, shift } = ARROWS[side];
  return h(Button, {
    className,
    icon: h(Glyph),
    ariaLabel: copy[word],
    onClick: () => {
      step(shift);
    },
  });
};

// Обработчик клавиш окна: Escape закрывает, стрелки листают, пока кадров больше одного.
const keyHandler = ({ total, step, onClose }) => (event) => {
  if (event.key === "Escape") onClose();
  else if (total > 1 && KEY_SHIFTS.has(event.key)) step(KEY_SHIFTS.get(event.key));
};

// Один раз за жизнь окна: опора фокуса, фокус на «Закрыть», подписка на клавиши; при уходе отписка и возврат фокуса.
function useDialogLife(closeRef, onKey) {
  onMount(() => {
    const returnTo = document.activeElement;
    closeRef.current?.focus();
    const stopKeys = listen(window, "keydown", onKey);
    return () => {
      stopKeys();
      returnTo?.focus?.({ preventScroll: true });
    };
  }, []);
}

export default function ModFrameViewer({ view, items, index = 0, onClose }) {
  const total = items.length;
  const state = useState(index);
  const at = state[0];
  const closeRef = useRef(null);
  const step = (shift) => {
    state[1]((value) => (value + shift + total) % total);
  };
  useDialogLife(closeRef, keyHandler({ total, step, onClose }));

  const frame = items[at] ? items[at] : items[0];
  const dialog = {
    className: "mod-frame-viewer",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": `${view.copy.openMedia} ${at + 1}`,
    onClick(event) {
      if (event.target === event.currentTarget) onClose();
    },
  };
  const media = view.renderMedia(frame, "mod-frame-viewer-media", { playing: true });

  return h(
    DesktopOverlayPortal,
    null,
    h(
      "div",
      dialog,
      h("figure", { className: "mod-frame-viewer-frame", title: view.captionOf(frame) || undefined }, media),
      h(Button, { className: "mod-frame-viewer-close is-glass", icon: h(X), ariaLabel: view.cardCopy.closeFrame, onClick: onClose, ref: closeRef }),
      total > 1
        ? h(Fragment, null, arrowButton("back", view.copy, step), arrowButton("forward", view.copy, step), h("p", { className: "mod-frame-viewer-count" }, `${at + 1} / ${total}`))
        : null,
    ),
  );
}
