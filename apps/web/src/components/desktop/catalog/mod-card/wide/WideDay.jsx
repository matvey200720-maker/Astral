import { useEffect, useRef, useState } from "react";
import { tr, useTr } from "../../../../../locales/ui.js";

/*
 * Сутки на сцене таймцикла (чистовой набор 2, 15.11.2026, `f-clock` и `f-skybar` макета): поверх ролика суток — время крупно («18:50»), под ним слово часа («Закат · идут сутки»)
 * и тонкая шкала 00 · 06 · 12 · 18 · 24 с названиями моментов и ручкой там, где ролик сейчас. Ролик суток снят от 12:00 до 12:00 (`qa-sky-clip.js`, `timecycle.cycle.startHour`), поэтому час —
 * это доля проигранного: `(начало + доля × 24) mod 24`. Время читается с самого `<video>` проигрывателя (`ClipPlayer`) раз в 200 мс, пока окно видно; шкала только показывает ход,
 * перематывает ролик по-прежнему его собственная полоса. Без CSS-анимаций: ручка встаёт на место шагами.
 */

const DAY = 24;
const START_HOUR = 12;

// Моменты суток: час начала и слово. Слово часа — последнее, чей час не позже текущего.
const MOMENTS = [
  [0, "Ночь"],
  [5, "Рассвет"],
  [8, "Утро"],
  [12, "День"],
  [17, "Закат"],
  [20, "Сумерки"],
];

const MARKS = [0, 6, 12, 18, 24];

const twoDigits = (value) => String(value).padStart(2, "0");

/** Час суток и слово момента для доли ролика `share` (0…1) и часа начала ролика. */
export function dayClockOf(share, startHour = START_HOUR) {
  const total = (((startHour + share * DAY) % DAY) + DAY) % DAY;
  const hours = Math.floor(total);
  const minutes = Math.floor((total - hours) * 60);
  const moment = [...MOMENTS].reverse().find(([from]) => hours >= from)[1];
  return {
    text: `${twoDigits(hours)}:${twoDigits(minutes)}`,
    moment,
    at: total / DAY,
  };
}

// Доля проигранного ролика сцены: ищет `<video>` рядом (в рамке кадра) и читает его раз в 200 мс, пока вкладка видна.
function useClipShare(rootRef) {
  const [share, setShare] = useState(0);
  useEffect(() => {
    const read = () => {
      const video = rootRef.current?.parentElement?.querySelector("video");
      if (!video || !(video.duration > 0) || !Number.isFinite(video.duration))
        return;
      const next = video.currentTime / video.duration;
      setShare((was) => (Math.abs(was - next) < 0.003 ? was : next));
    };
    const timer = setInterval(() => {
      if (!document.hidden) read();
    }, 200);
    return () => clearInterval(timer);
  }, [rootRef]);
  return share;
}

export default function WideDay({ startHour = START_HOUR }) {
  useTr();
  const root = useRef(null);
  const share = useClipShare(root);
  const clock = dayClockOf(share, startHour);
  return (
    <div className="xw-day" ref={root} aria-hidden="true">
      <p className="xw-day-clock">
        <b>{clock.text}</b>
        <small>{`${tr(clock.moment)} · ${tr("идут сутки")}`}</small>
      </p>
      <div className="xw-day-bar">
        <span className="xw-day-names">
          {MOMENTS.map(([from, name]) => (
            <span key={from} style={{ "--xw-at": from / DAY }}>
              {tr(name)}
            </span>
          ))}
        </span>
        <span className="xw-day-track">
          <i className="xw-day-handle" style={{ "--xw-at": clock.at }} />
        </span>
        <span className="xw-day-marks">
          {MARKS.map((hour) => (
            <span key={hour} style={{ "--xw-at": hour / DAY }}>
              {twoDigits(hour)}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
