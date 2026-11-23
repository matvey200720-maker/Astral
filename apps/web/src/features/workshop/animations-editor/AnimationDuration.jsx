import { useEffect, useMemo, useRef } from "react";
import { Check, Info, Warning } from "../../../components/ui/icons.jsx";
import { currentUiLanguage, tr, useTr } from "../../../locales/ui.js";
import {
  deltaText,
  durationVerdict,
  laneSegments,
  rulerLength,
  rulerTicks,
  secondsText,
} from "./animation-duration.js";
import { noteTexts } from "./animation-install-flow.js";

/*
 * Полоса длины под фигурами (дизайн 15.11.2026): шкала времени и две дорожки — «На сервере» и «У тебя» — с общей меткой проигрывания.
 * Длины приходят из данных клипа (`serverLength`, `mineLength` в секундах); у кого длины нет, у того дорожки нет, а без обеих нет и полосы.
 * Метка едет от часов сцены: `headRef.current(seconds)` зовёт кадр сцены, а здесь только `transform` метки — без перерисовки React.
 */

function Lane({ kind, name, length, end }) {
  return (
    <div className="animation-dur-row animation-dur-lane-row">
      <div className="animation-dur-label">
        <b>{kind === "server" ? tr("На сервере") : tr("У тебя")}</b>
        <span title={name}>{name}</span>
      </div>
      <div className="animation-dur-lane" data-lane={kind}>
        {laneSegments(length, end).map((segment) => (
          <i
            key={segment.left}
            className={`animation-dur-seg${segment.first ? " is-first" : " is-repeat"}`}
            style={{
              left: `${segment.left * 100}%`,
              width: `calc(${segment.width * 100}% - 3px)`,
            }}
          >
            {segment.first && (
              <em>{secondsText(length, currentUiLanguage())}</em>
            )}
          </i>
        ))}
      </div>
    </div>
  );
}

export default function AnimationDuration({
  serverLength = 0,
  serverName = "",
  mineLength = 0,
  mineName = "",
  headRef,
}) {
  useTr();
  const language = currentUiLanguage();
  const verdict = durationVerdict(serverLength, mineLength);
  const longest = Math.max(serverLength, mineLength);
  const end = useMemo(
    () => (longest > 0 ? rulerLength(serverLength, mineLength) : 0),
    [serverLength, mineLength, longest],
  );
  const overlay = useRef(null);
  const head = useRef(null);
  const label = useRef(null);

  /* Метка проигрывания: положение — `transform` по ширине шкалы, число — только когда сменилась десятая доля секунды. */
  useEffect(() => {
    if (!headRef || !overlay.current || !head.current || !(end > 0))
      return undefined;
    const area = overlay.current;
    let width = area.clientWidth;
    const watch =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => (width = area.clientWidth))
        : null;
    watch?.observe(area);
    let shown = "";
    headRef.current = (seconds) => {
      const cycle = (((seconds % end) + end) % end) / end;
      head.current.style.transform = `translate3d(${cycle * width}px, 0, 0)`;
      const text = secondsText(cycle * end, language);
      if (text !== shown && label.current) {
        shown = text;
        label.current.textContent = text;
      }
    };
    headRef.current(0);
    return () => {
      watch?.disconnect();
      headRef.current = null;
    };
  }, [headRef, end, language]);

  if (!(end > 0)) return null;
  const ticks = rulerTicks(end);
  const pair = serverLength > 0 && mineLength > 0;
  return (
    <section
      className="animation-dur"
      aria-label={tr("Длительность")}
      data-verdict={verdict}
    >
      <header className="animation-dur-head">
        <span className="animation-dur-title">{tr("Длительность")}</span>
        {pair && (
          <span className="animation-dur-delta">
            {deltaText(serverLength, mineLength, language)}
          </span>
        )}
        {verdict === "far" && (
          <span className="animation-dur-chip is-warn" role="status">
            <Warning aria-hidden="true" />
            {tr("длина сильно отличается")}
          </span>
        )}
        {verdict === "mid" && (
          <span className="animation-dur-chip">
            {tr("длина немного отличается")}
          </span>
        )}
        {verdict === "near" && (
          <span className="animation-dur-chip">
            <Check aria-hidden="true" />
            {tr("длина как на сервере")}
          </span>
        )}
      </header>
      <div className="animation-dur-rows">
        <div className="animation-dur-row">
          <div />
          <div className="animation-dur-ruler" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.at}
                className="animation-dur-tick"
                style={{ left: `${tick.left * 100}%` }}
              >
                {secondsText(tick.at, language)}
                <i />
              </span>
            ))}
          </div>
        </div>
        {serverLength > 0 && (
          <Lane
            kind="server"
            name={serverName}
            length={serverLength}
            end={end}
          />
        )}
        {mineLength > 0 && (
          <Lane kind="mine" name={mineName} length={mineLength} end={end} />
        )}
        <div className="animation-dur-overlay" ref={overlay} aria-hidden="true">
          {ticks.slice(1).map((tick) => (
            <span
              key={tick.at}
              className="animation-dur-grid"
              style={{ left: `${tick.left * 100}%` }}
            />
          ))}
          <div className="animation-dur-head-line" ref={head}>
            <b ref={label}>{secondsText(0, language)}</b>
          </div>
        </div>
      </div>
      {verdict === "far" && (
        <p className="animation-dur-note">
          <Info aria-hidden="true" />
          {noteTexts(["duration"])[0]}
        </p>
      )}
    </section>
  );
}
