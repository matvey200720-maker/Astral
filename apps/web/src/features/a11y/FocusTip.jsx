import { createElement as h, useEffect, useState } from "react";

const TARGET = "button, [role='button'], [role='tab'], [role='menuitem'], a[href], summary";
const METRICS = Object.freeze({ gap: 8, delay: 500, edge: 140, margin: 80, tipHeight: 32, ink: 4 });

const clampBetween = (value, low, high) => Math.min(Math.max(value, low), high);

/* ---------- имя значка без подписи ---------- */

// Узел «видно», если его диапазон крупнее ink по обеим сторонам.
function paints(range, node) {
  if (node.nodeValue.trim() === "") return false;
  range.selectNodeContents(node);
  const rect = range.getBoundingClientRect();
  return Math.min(rect.width, rect.height) > METRICS.ink;
}

function showsText(el) {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (paints(range, node)) return true;
  }
  return false;
}

function bareIconName(el) {
  if (!(el instanceof HTMLElement) || !el.matches(TARGET)) return "";
  const source = el.getAttribute("aria-label") || el.getAttribute("title") || el.dataset.tip;
  const name = source ? source.trim() : "";
  if (name === "" || el.matches(":disabled")) return "";
  return showsText(el) ? "" : name;
}

/* ---------- где стоит значок и где рисовать подсказку ---------- */

function anchorOf(text, box) {
  const { left, top, right, bottom, width, height } = box;
  return {
    text,
    x: left + width / 2,
    top,
    bottom,
    right,
    mid: top + height / 2,
    side: right < METRICS.edge ? "right" : "",
  };
}

function placeBeside(tip) {
  return { className: "focus-tip is-right", style: { left: tip.right + METRICS.gap, top: tip.mid } };
}

function placeStacked(tip) {
  const { gap, margin, tipHeight } = METRICS;
  const left = clampBetween(tip.x, margin, window.innerWidth - margin);
  const roomBelow = window.innerHeight > tip.bottom + gap + tipHeight;
  const style = roomBelow ? { left, top: tip.bottom + gap } : { left, bottom: window.innerHeight - tip.top + gap };
  return { className: "focus-tip", style };
}

/* ---------- наблюдатель ---------- */

class TipWatcher {
  wired = [];
  waiting = null;

  constructor(receive) {
    this.receive = receive;
  }

  hide = () => {
    clearTimeout(this.waiting);
    this.receive(null);
  };

  show(el, name) {
    const box = el.getBoundingClientRect();
    if (!box.width && !box.height) return;
    this.receive(anchorOf(name, box));
  }

  reveal(el) {
    const name = el.isConnected ? bareIconName(el) : "";
    if (!name) return;
    this.show(el, name);
  }

  onFocusIn = (event) => {
    const el = event.target;
    const name = bareIconName(el);
    if (!name || !el.matches(":focus-visible")) {
      this.hide();
      return;
    }
    this.show(el, name);
  };

  onMouseOver = (event) => {
    clearTimeout(this.waiting);
    const origin = event.target;
    const el = origin instanceof Element ? origin.closest(TARGET) : null;
    if (!el || el.hasAttribute("title")) return;
    this.waiting = setTimeout(() => this.reveal(el), METRICS.delay);
  };

  onKeyDown = (event) => {
    if (event.key === "Escape") this.hide();
  };

  mount() {
    this.wired = [
      [document, "focusin", this.onFocusIn],
      [document, "focusout", this.hide],
      [document, "mouseover", this.onMouseOver],
      [document, "mouseout", this.hide],
      [document, "pointerdown", this.hide, true],
      [document, "keydown", this.onKeyDown, true],
      [window, "scroll", this.hide, true],
    ];
    this.wired.forEach(([target, ...args]) => target.addEventListener(...args));
  }

  unmount() {
    clearTimeout(this.waiting);
    this.wired
      .filter(([, type]) => type !== "keydown")
      .forEach(([target, ...args]) => target.removeEventListener(...args));
  }
}

/* ---------- компонент ---------- */

const drawTip = (tip) => {
  const { className, style } = tip.side === "right" ? placeBeside(tip) : placeStacked(tip);
  return h("div", { className, "aria-hidden": "true", style }, tip.text);
};

const FocusTip = () => {
  const [tip, setTip] = useState(null);

  useEffect(() => {
    const watcher = new TipWatcher(setTip);
    watcher.mount();
    return () => watcher.unmount();
  }, []);

  return tip && drawTip(tip);
};

export { FocusTip as default };
