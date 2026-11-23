/*
 * «Сутки» на ленте времени неба (26.10.2026, владелец: «в предпросмотре таймциклов — как идут сутки, с 12 часов до 12 часов»).
 *
 * Кнопка прогоняет ползунок часа от полудня до полудня за 24 секунды тем же ходом времени, что ролик суток в карточке каталога
 * (`dayHourAt`, `sky-clip-plan.js`): рассвет и закат медленнее, ночь и полдень быстрее. Отдельного рисунка нет — живое небо мастерской и
 * так рисуется на каждый час, прогон просто листает ленту сам. Остановить — ещё один щелчок по кнопке или любая правка часа руками
 * (ползунок, часы, отметка): прогон не спорит с человеком за ленту.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DAY_CLIP, dayHourAt } from "../../../../features/catalog/part-covers/sky-clip-plan.js";
import { Pause, Play } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { useAttentionAllows } from "../../../../attention.js";

/* Ленту листаем 30 раз в секунду: небо с городом — тяжёлый кадр, а за 1/30 с час сдвигается меньше минуты суток даже в самом быстром месте. */
const TICK_MS = 1000 / 30;
/* Столько последних часов прогон помнит за собой: родитель перерисовывается с отставанием, и пришедший час — один из недавних — это он сам. */
const REMEMBERED = 12;
const SAME_HOUR = 0.01;
const gapOf = (left, right) => {
  const gap = Math.abs(left - right);
  return Math.min(gap, 24 - gap);
};

/* Спокойное движение: человек просил системой меньше анимации — сутки сами не идут (кнопкой запустить можно). */
const calmMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Прогон суток: `{ playing, toggle }`. `hour` и `onHourChange` — лента времени неба.
 * `autoStart` — сутки идут сами с открытия (предпросмотр таймцикла в каталоге, 14.11.2026), `loop` — по кругу, а не один раз. Окно скрыто или человек отошёл
 * (`useAttentionAllows`) — прогон стоит на месте и идёт дальше с того же часа; ползунок, часы и отметка останавливают его совсем, как и раньше.
 */
export function useDayPlay(hour, onHourChange, { autoStart = false, loop = false } = {}) {
  const [playing, setPlaying] = useState(() => autoStart && !calmMotion());
  const awake = useAttentionAllows("motion");
  const progress = useRef(0);
  const recent = useRef([]);
  const change = useRef(onHourChange);
  change.current = onHourChange;

  const put = useCallback((value) => {
    recent.current.push(value);
    if (recent.current.length > REMEMBERED) recent.current.shift();
    change.current(value);
  }, []);

  const stop = useCallback(() => {
    setPlaying(false);
    progress.current = 0;
    recent.current = [];
  }, []);

  useEffect(() => {
    if (!playing || !awake) return undefined;
    const total = DAY_CLIP.seconds * 1000;
    /* Пауза окна не сбрасывает прогон: время отсчитывается от уже пройденной доли. */
    let started = performance.now() - progress.current * total;
    let frame = 0;
    let shownAt = -Infinity;
    const tick = (now) => {
      let share = (now - started) / total;
      if (share >= 1) {
        if (!loop) {
          progress.current = 0;
          put(DAY_CLIP.startHour);
          setPlaying(false);
          return;
        }
        started = now;
        share = 0;
      }
      progress.current = share;
      if (now - shownAt >= TICK_MS) {
        shownAt = now;
        put(dayHourAt(share, DAY_CLIP.startHour));
      }
      frame = requestAnimationFrame(tick);
    };
    /* Первый кадр — ровно полдень (или час, на котором прогон встал): ролик в карточке начинается там же. */
    put(dayHourAt(progress.current, DAY_CLIP.startHour));
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, awake, loop, put]);

  /* Час стал не тем, что ставил прогон (ползунок, часы, отметка, инструмент, ставящий ленту сам) — прогон уступает. */
  const seen = useRef(hour);
  useEffect(() => {
    /* Смотрим только на смену часа: пуск прогона сам ничего не меняет, а первый его час придёт отдельной перерисовкой. */
    if (hour === seen.current) return;
    seen.current = hour;
    if (!playing || !recent.current.length) return;
    if (!recent.current.some((value) => gapOf(hour, value) < SAME_HOUR)) stop();
  }, [hour, playing, stop]);

  const toggle = useCallback(() => (playing ? stop() : setPlaying(true)), [playing, stop]);
  return { playing, toggle };
}

export default function DayPlayButton({ hour, onHourChange, dayPlay = null }) {
  useTr();
  const { playing, toggle } = useDayPlay(hour, onHourChange, dayPlay || undefined);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="sky-day-play"
      icon={playing ? <Pause weight="fill" /> : <Play weight="fill" />}
      active={playing}
      aria-pressed={playing}
      title={playing ? tr("Остановить прогон суток") : tr("Прогнать сутки с 12:00 до 12:00")}
      onClick={toggle}
    >
      {tr("Сутки")}
    </Button>
  );
}
