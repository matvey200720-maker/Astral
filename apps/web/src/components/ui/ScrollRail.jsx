import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { CaretRight, CaretLeft } from "./icons.jsx";
import { motionEnabled } from "../../motion-preference.js";

const SLACK = 2;
const STEP = { share: 0.85, least: 120 };
const NOTHING = { start: false, end: false, content: 0 };
const DEFAULTS = { className: "", trackClassName: "", gutters: false, previousLabel: "Прокрутить влево", nextLabel: "Прокрутить вправо" };

const joinClasses = (...names) => names.filter(Boolean).join(" ");
const sameView = (a, b) => ["start", "end", "content"].every((key) => a[key] === b[key]);

// Только названные свойства; undefined заменяется умолчанием, null остаётся.
function withDefaults({ label, children, ...props }) {
  const own = { label, children };
  for (const [name, fallback] of Object.entries(DEFAULTS)) own[name] = props[name] === undefined ? fallback : props[name];
  return own;
}

// Что показать по размерам дорожки: «место» — ширина самой ленты при gutters, иначе видимая ширина дорожки.
function readRail(root, track, gutters) {
  const room = gutters ? root.clientWidth : track.clientWidth;
  if (track.scrollWidth - room <= SLACK) return NOTHING;
  return {
    start: track.scrollLeft > SLACK,
    end: track.scrollLeft < track.scrollWidth - track.clientWidth - SLACK,
    content: gutters ? track.scrollWidth : 0,
  };
}

// Три источника замера: прокрутка, размер (ряд и каждый прямой ребёнок), состав (ушедших снять, новых взять, измерить).
function watchTrack(track, measure) {
  track.addEventListener("scroll", measure, { passive: true });

  const sizeWatcher = new ResizeObserver(measure);
  [track, ...track.children].forEach((node) => sizeWatcher.observe(node));

  const isElement = (node) => node.nodeType === 1;
  const membersWatcher = new MutationObserver((records) => {
    if (records.length === 0) return;
    for (const { addedNodes, removedNodes } of records) {
      [...removedNodes].filter(isElement).forEach((gone) => sizeWatcher.unobserve(gone));
      [...addedNodes].filter(isElement).forEach((fresh) => sizeWatcher.observe(fresh));
    }
    measure();
  });
  membersWatcher.observe(track, { childList: true });

  return () => {
    track.removeEventListener("scroll", measure);
    sizeWatcher.disconnect();
    membersWatcher.disconnect();
  };
}

export default function ScrollRail(props) {
  const { label, children, className, trackClassName, gutters, previousLabel, nextLabel } = withDefaults(props);
  const [view, setView] = useState(NOTHING);
  const trackRef = useRef(null);
  const rootRef = useRef(null);

  /* Наблюдатель размера и состава может позвать замер уже после того, как узел ушёл (карточка закрылась, а эффект ещё не снят): тогда замерять нечего. */
  const measure = useCallback(() => {
    const { current: root } = rootRef;
    const { current: track } = trackRef;
    if (!track || (gutters && !root)) return;
    const next = readRail(root, track, gutters);
    setView((prev) => (sameView(prev, next) ? prev : next));
  }, [gutters]);

  useEffect(() => {
    const { current: track } = trackRef;
    if (!track) return undefined;
    measure();
    return watchTrack(track, measure);
  }, [measure]);

  const slide = (direction) => () => {
    const { current: track } = trackRef;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(STEP.least, track.clientWidth * STEP.share), behavior: motionEnabled() ? "smooth" : "auto" });
  };
  const arrow = (className, text, Glyph, direction) =>
    createElement("button", { type: "button", className, "aria-label": text, title: text, onClick: slide(direction) }, createElement(Glyph));

  const padded = gutters && view.content > 0;
  const track = createElement("div", { ref: trackRef, className: joinClasses("ui-rail-track", trackClassName), role: label ? "group" : undefined, "aria-label": label }, children);
  return createElement(
    "div",
    { ref: rootRef, className: joinClasses("ui-rail", padded && "has-gutters", className), style: padded ? { "--ui-rail-basis": `${view.content}px` } : undefined },
    view.start ? arrow("ui-rail-arrow is-start", previousLabel, CaretLeft, -1) : null,
    track,
    view.end ? arrow("ui-rail-arrow is-end", nextLabel, CaretRight, 1) : null,
  );
}
