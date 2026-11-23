import { useLayoutEffect, useRef } from "react";
import { VITAL_BLINK_SECONDS, contoursPath, vitalShapesOf, vitalIconView } from "./vital-icon-view.js";
import { minimapVitalFrame } from "@modovik/minimap-contract";

/*
 * Значок-шкала HP или брони (10.11.2026): та же фигура и тот же кадр, что игра ставит на этот запас (`vital-icon-view.js`, договор — `minimap-contract/vital-icons.js`).
 * Рисуется SVG в квадрате ±0,5: контуры заливаются по чётности, как в игре (у целого кольца внешний и внутренний), подложка — пустая шкала под ней.
 *
 * Цвет пустой части шкалы — `effects.vitalTrackColour` (21.11.2026, как у плашки с кольцами), прозрачность — прежняя `vitalTrackOpacity`.
 * «Плавное убывание заливки» (`effects.vitalFillSmooth`): заливка не прыгает по кадрам, а догоняет запас — значение ведёт `requestAnimationFrame`, фигуру и цвет
 * переписывает в узел напрямую, без перерисовки React на каждый кадр.
 */

const BOX = "-0.5 -0.5 1 1";

/** Время, за которое заливка догоняет запас (постоянная времени, секунды): одно с откликом интерфейса (`--astral-duration`, 180 мс). */
export const VITAL_SMOOTH_SECONDS = 0.18;

/** Ближе этого к запасу заливка считается дошедшей, процентов. */
const SMOOTH_REST = 0.2;

/**
 * Плавная заливка: путь шкалы пишется в узел. Не ведёт сама ничего, пока значение не двигается: с нового запаса идёт от того, где заливка была.
 * Без `requestAnimationFrame` (редкая среда) — сразу на запас.
 */
function useSmoothFill({ enabled, effects, side, percent, pathRef, svgRef }) {
  const shown = useRef(percent);
  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!enabled || !path) return undefined;
    const paint = (value) => {
      const view = vitalIconView(effects, side, value);
      if (!view) return;
      path.setAttribute("d", view.fill);
      path.setAttribute("fill", view.colour);
      svgRef.current?.setAttribute("data-frame", String(view.frame));
    };
    if (typeof requestAnimationFrame !== "function") {
      shown.current = percent;
      paint(percent);
      return undefined;
    }
    paint(shown.current);
    /* Скорость анимации (`effects.vitalAnimSpeed`, проценты): вдвое быстрее — вдвое короче постоянная времени. */
    const settle = (VITAL_SMOOTH_SECONDS * 100) / (effects.vitalAnimSpeed || 100);
    let frame = 0;
    let last = performance.now();
    const step = (now) => {
      const seconds = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const delta = percent - shown.current;
      if (Math.abs(delta) <= SMOOTH_REST) {
        shown.current = percent;
        paint(percent);
        return;
      }
      shown.current += delta * (1 - Math.exp(-seconds / settle));
      paint(shown.current);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [enabled, effects, side, percent, pathRef, svgRef]);
}

/**
 * Шкала по настройкам мини-карты.
 * @param {object} props
 * @param {object} props.effects `config.effects`
 * @param {"health" | "armour"} props.side
 * @param {number} props.percent запас, 0…100
 * @param {boolean} [props.still] обложка и неподвижный кадр: мигание не играет, заливка не плывёт
 */
export function VitalGauge({ effects, side, percent, still = false, className = "" }) {
  const view = vitalIconView(effects, side, percent);
  const smooth = Boolean(view) && effects.vitalFillSmooth === true && !still;
  const pathRef = useRef(null);
  const svgRef = useRef(null);
  useSmoothFill({ enabled: smooth, effects, side, percent, pathRef, svgRef });
  if (!view) return null;
  const trackOpacity = effects.vitalTrackOpacity / 100;
  const blinking = view.blinks && !still;
  return (
    <svg
      ref={svgRef}
      className={`mmc-vital-shape ${className}`.trim()}
      viewBox={BOX}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-style={view.styleId}
      data-frame={smooth ? undefined : view.frame}
      data-smooth={smooth ? "on" : undefined}
      data-tier-blink={blinking ? "on" : "off"}
    >
      {view.track && trackOpacity > 0 && <path d={view.track} fill={effects.vitalTrackColour} fillOpacity={trackOpacity} fillRule="evenodd" />}
      {/* При плавной заливке форму и цвет пути пишет `useSmoothFill`: React их не держит, иначе каждый его вывод прыгал бы на целевой кадр. */}
      <path
        ref={pathRef}
        className={blinking ? "mmc-vital-blink" : undefined}
        style={blinking ? { animationDuration: `${VITAL_BLINK_SECONDS}s` } : undefined}
        d={smooth ? undefined : view.fill}
        fill={smooth ? undefined : view.colour}
        fillRule="evenodd"
      />
    </svg>
  );
}

/**
 * Миниатюра вида в выборе: фигура вида на среднем запасе, цвет берёт у текста кнопки.
 * @param {{ styleId: string, side: "health" | "armour", percent?: number }} props
 */
export function VitalThumb({ styleId, side, percent = 65 }) {
  const shapes = vitalShapesOf(styleId, side, 0.16);
  const frame = minimapVitalFrame(styleId, percent);
  return (
    <svg className="mmc-vital-thumb" viewBox={BOX} aria-hidden="true" focusable="false">
      <path d={contoursPath(shapes.track)} fill="currentColor" fillOpacity="0.28" fillRule="evenodd" />
      <path d={contoursPath(shapes.frames[frame - 1])} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
