import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from "react";

const EDGE = 6;
const OFFSET = { x: 14, y: 18 };
const NOT_HELD = false;
const CLASS_REST = "model-stage-hover-tip";
const CLASS_SHOWN = "is-shown";

// Одна ось: подпись лежит за остриём курсора, а у края кадра перелетает на другую сторону.
const fitAxis = ([at, gap, size, room]) => {
  const overflow = at + gap + size + EDGE > room;
  return overflow ? Math.max(at - gap - size, EDGE) : gap + at;
};

// Следит за курсором: помнит последнюю точку и двигает подпись стилем, минуя React.
class CursorFollower {
  constructor(tipRef) {
    this.tipRef = tipRef;
    this.point = null;
  }

  place(hostRef) {
    const tip = this.tipRef.current;
    const host = hostRef.current;
    const cursor = this.point;
    if (!tip || !host || !cursor) return;
    const frame = host.getBoundingClientRect();
    const shiftX = fitAxis([cursor.x - frame.left, OFFSET.x, tip.offsetWidth, frame.width]);
    const shiftY = fitAxis([cursor.y - frame.top, OFFSET.y, tip.offsetHeight, frame.height]);
    tip.style.transform = `translate(${Math.round(shiftX)}px, ${Math.round(shiftY)}px)`;
  }

  note(event, hostRef) {
    this.point = { x: event.clientX, y: event.clientY };
    const tip = this.tipRef.current;
    if (tip && tip.classList.contains(CLASS_SHOWN)) this.place(hostRef);
  }
}

const useFollowingTip = (hostRef, label) => {
  const tipRef = useRef(null);
  const [follower] = useState(() => new CursorFollower(tipRef));
  const [held, setHeld] = useState(NOT_HELD);
  const shown = Boolean(label) && !held;

  useEffect(() => {
    const { current: host } = hostRef;
    const press = () => setHeld(true);
    const release = () => setHeld(false);
    const groups = host
      ? [
          [host, { pointermove: (event) => follower.note(event, hostRef), pointerdown: press, pointerleave: release }],
          [window, { pointerup: release }],
        ]
      : [];
    const wires = groups.flatMap(([target, table]) => Object.entries(table).map(([type, fn]) => [target, type, fn]));
    wires.forEach(([target, type, fn]) => target.addEventListener(type, fn, { passive: true }));
    return () => wires.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
  // Слушатели вешаются один раз; следящий объект и ссылка на кадр стабильны.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Новая подпись другой ширины: место считаем раньше, чем её увидят.
  useLayoutEffect(() => {
    if (shown) follower.place(hostRef);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, label]);

  return { tipRef, shown };
};

const StageHoverTip = ({ hostRef, label = "" }) => {
  const { tipRef, shown } = useFollowingTip(hostRef, label);
  const tipProps = {
    ref: tipRef,
    className: [CLASS_REST, shown && CLASS_SHOWN].filter(Boolean).join(" "),
    role: "tooltip",
    "aria-hidden": !shown,
  };
  return h("div", tipProps, label);
};

export default StageHoverTip;
