import { useRef, useState } from "react";
import { ArrowsIn, ArrowsOut, Pause, Play, SpeakerHigh, SpeakerLow } from "./icons.jsx";
import { tr } from "../../locales/ui.js";
import { SEEK_STEP, SEEK_STEP_BIG, clipClock, clipFraction, nudgeTime, seekTarget } from "./clip-time.js";
import "./clip-controls.css";

/*
 * Органы проигрывателя ролика (`ClipPlayer.jsx`, ТЗ владельца 29.10.2026: «как в YouTube», но в нашем стиле). Свои, не штатные: `controls` у `<video>` не ставится.
 *
 * Снизу кадра — затемнение-градиент, под ним тонкая полоса прогресса (в покое две точки, при наведении толще; щелчок и перетаскивание перематывают, над ней
 * подсказка со временем) и строка органов: слева ▶/❚❚ и «0:12 / 0:24» мелко, справа звук (только у ролика со звуком: значок, по наведению — ползунок громкости) и «во весь
 * экран». Пока ролик играет и мышь стоит, строка и затемнение прячутся, полоса остаётся тонкой чертой; двинул мышью или нажал клавишу — вернулись
 * (`shown`, решает `ClipPlayer`).
 *
 * Полоса — ползунок для клавиатуры и читалки: стрелки ±5 с, PageUp/PageDown ±10 с, Home и End — к краям.
 */

function Seek({ time, duration, onSeek, onHold }) {
  const track = useRef(null);
  /* Пока тянут — полоса показывает палец, а не ролик: ролик перематывается один раз, когда отпустили. */
  const [scrub, setScrub] = useState(null);
  const [hover, setHover] = useState(null);
  const ready = Number.isFinite(duration) && duration > 0;
  const fraction = scrub ?? clipFraction(time, duration);
  const at = (event) => {
    const box = track.current?.getBoundingClientRect();
    return box && box.width ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0;
  };
  const move = (delta) => onSeek(nudgeTime(time, delta, duration));
  const onKeyDown = (event) => {
    const steps = { ArrowLeft: -SEEK_STEP, ArrowDown: -SEEK_STEP, ArrowRight: SEEK_STEP, ArrowUp: SEEK_STEP, PageDown: -SEEK_STEP_BIG, PageUp: SEEK_STEP_BIG };
    if (event.key in steps) move(steps[event.key]);
    else if (event.key === "Home") onSeek(0);
    else if (event.key === "End") onSeek(duration);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      className="ui-clip-seek"
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label={tr("Перемотка")}
      aria-valuemin={0}
      aria-valuemax={ready ? Math.floor(duration) : 0}
      aria-valuenow={ready ? Math.floor(time) : 0}
      aria-valuetext={tr("{0} из {1}").replace("{0}", clipClock(time)).replace("{1}", clipClock(duration))}
      data-scrubbing={scrub === null ? undefined : ""}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (!ready || event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onHold(true);
        setScrub(at(event));
      }}
      onPointerMove={(event) => {
        if (!ready) return;
        setHover(at(event));
        if (scrub !== null) setScrub(at(event));
      }}
      onPointerUp={(event) => {
        if (scrub === null) return;
        const target = at(event);
        setScrub(null);
        onHold(false);
        onSeek(seekTarget(target, duration));
      }}
      onPointerCancel={() => {
        setScrub(null);
        onHold(false);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <span className="ui-clip-seek-track" aria-hidden="true">
        <i className="ui-clip-seek-fill" style={{ transform: `scaleX(${fraction})` }} />
        <i className="ui-clip-seek-thumb" style={{ left: `${fraction * 100}%` }} />
      </span>
      {ready && (hover !== null || scrub !== null) && (
        <span className="ui-clip-seek-tip" style={{ left: `clamp(24px, ${(scrub ?? hover) * 100}%, calc(100% - 24px))` }} aria-hidden="true">
          {clipClock(seekTarget(scrub ?? hover, duration))}
        </span>
      )}
    </div>
  );
}

export default function ClipControls({
  shown,
  playing,
  time,
  duration,
  silent,
  volume,
  muted,
  fullscreen,
  onToggle,
  onSeek,
  onVolume,
  onMute,
  onFullscreen,
  onHold,
}) {
  const quiet = muted || volume === 0;
  const SpeakerIcon = !quiet && volume < 0.5 ? SpeakerLow : SpeakerHigh;
  return (
    <div className="ui-clip-controls" data-shown={shown ? "" : undefined} onPointerEnter={() => onHold(true)} onPointerLeave={() => onHold(false)}>
      <span className="ui-clip-scrim" aria-hidden="true" />
      <Seek time={time} duration={duration} onSeek={onSeek} onHold={onHold} />
      <div className="ui-clip-row">
        <button type="button" className="ui-clip-button" aria-label={playing ? tr("Пауза") : tr("Воспроизвести")} onClick={onToggle}>
          {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <span className="ui-clip-time" aria-hidden="true">
          {clipClock(time)} <i>/</i> {clipClock(duration)}
        </span>
        <span className="ui-clip-gap" />
        {!silent && (
          <span className="ui-clip-volume">
            <button
              type="button"
              className={`ui-clip-button${quiet ? " is-muted" : ""}`}
              aria-label={quiet ? tr("Включить звук") : tr("Выключить звук")}
              aria-pressed={quiet}
              onClick={onMute}
            >
              <SpeakerIcon weight="fill" />
            </button>
            <input
              type="range"
              className="ui-clip-volume-range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label={tr("Громкость")}
              style={{ "--clip-volume": `${(muted ? 0 : volume) * 100}%` }}
              onChange={(event) => onVolume(Number(event.target.value))}
            />
          </span>
        )}
        <button
          type="button"
          className="ui-clip-button"
          aria-label={fullscreen ? tr("Выйти из полноэкранного режима") : tr("Во весь экран")}
          aria-pressed={fullscreen}
          onClick={onFullscreen}
        >
          {fullscreen ? <ArrowsIn weight="bold" /> : <ArrowsOut weight="bold" />}
        </button>
      </div>
    </div>
  );
}
