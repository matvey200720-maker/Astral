import { useCallback, useEffect, useRef, useState } from "react";
import { RETICLE_ANIMATION_LIMITS, shimmerColourAt } from "@modovik/reticle-contract";

/*
 * Предпросмотр анимации прицела (10.11.2026; данные — Хелпер 28, `reticle-contract/animation.js`).
 *
 * Кадр рисует то же, что собирает компилятор: затухание и появление — линейный твин прозрачности прицела, пульс — просадка прозрачности всего ролика и возврат за заданное время,
 * перелив — цвет по тем же кадрам (`shimmerColourAt`), что компилятор кладёт в клип. Своего расчёта цветов и пределов здесь нет: границы — из `RETICLE_ANIMATION_LIMITS`.
 * Сколько прозрачности остаётся в конце затухания, решает игра (она сама просит «притушить» с нужным числом), поэтому в кадре стоит условное значение — и подпись это говорит.
 */

/** Прозрачность прицела в конце затухания в кадре, %: условная — настоящее число присылает игра. */
export const FADE_PREVIEW_ALPHA = 20;
/** Сколько прицел стоит целым до затухания и после него, с: чтобы глаз успел увидеть и начало, и конец. */
export const FADE_PREVIEW_HOLD = 0.4;

const FADE_INSTANT = RETICLE_ANIMATION_LIMITS.fadeSeconds.min;

/**
 * Ключи показа затухания и появления: `{ t, v }` — секунда и прозрачность в процентах, между ключами линейно.
 * Затухание на пределе (0,01 с) — одним шагом, как в игре; появление 0 — сразу.
 */
export function fadeTimeline(animation) {
  const fade = Math.max(FADE_INSTANT, Number(animation?.fadeSeconds) || FADE_INSTANT);
  const appear = Math.max(0, Number(animation?.appearSeconds) || 0);
  const hold = FADE_PREVIEW_HOLD;
  const keys = [
    { t: 0, v: 100 },
    { t: hold, v: 100 },
    { t: hold + fade, v: FADE_PREVIEW_ALPHA },
    { t: hold + fade + hold, v: FADE_PREVIEW_ALPHA },
  ];
  const back = hold + fade + hold;
  keys.push({ t: back + Math.max(appear, 0.001), v: 100 });
  return keys;
}

/** Ключи показа пульса: сразу просадка на силу пульса, дальше линейно обратно к целому за заданное время. */
export function pulseTimeline(animation) {
  const strength = Math.min(100, Math.max(0, Number(animation?.hitPulseStrength) || 0));
  const seconds = Math.max(0.001, Number(animation?.hitPulseSeconds) || RETICLE_ANIMATION_LIMITS.hitPulseSeconds.min);
  return [
    { t: 0, v: 100 },
    { t: 0.12, v: 100 },
    { t: 0.12 + 0.001, v: 100 - strength },
    { t: 0.12 + seconds, v: 100 },
  ];
}

/** Значение между ключами в момент `time` (секунды): до первого — первое, после последнего — последнее. */
export function valueAt(keys, time) {
  if (!keys.length) return 100;
  if (time <= keys[0].t) return keys[0].v;
  for (let at = 1; at < keys.length; at += 1) {
    const before = keys[at - 1];
    const after = keys[at];
    if (time <= after.t) {
      const span = after.t - before.t;
      return span <= 0 ? after.v : before.v + ((after.v - before.v) * (time - before.t)) / span;
    }
  }
  return keys[keys.length - 1].v;
}

/** Длина показа, секунды. */
export const timelineLength = (keys) => (keys.length ? keys[keys.length - 1].t : 0);

/** Цвет перелива `#rrggbb` на секунде `seconds`: тот же расчёт, что кадры клипа в игре. */
export function shimmerHexAt(animation, seconds) {
  const turn = Math.max(0.001, Number(animation?.shimmerSeconds) || RETICLE_ANIMATION_LIMITS.shimmerSeconds.min);
  const [r, g, b] = shimmerColourAt(animation?.shimmerColours, (seconds / turn) % 1);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Система просит без анимации: перелив стоит на первом цвете, показы затухания и пульса пропускаются. */
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

/**
 * Предпросмотр кадра: прозрачность (затухание, появление, пульс) и цвет перелива.
 * @param {object} props
 * @param {object} props.animation `normalizeReticleAnimation(...)`
 * @param {boolean} props.shimmer перелив крутится в кадре сейчас (включён и открыт его инструмент)
 * @returns {{ opacity: number, tint: string | null, play: (kind: "fade" | "pulse") => void, playing: "fade" | "pulse" | null }}
 */
export function useReticleAnimationPreview({ animation, shimmer }) {
  const [opacity, setOpacity] = useState(100);
  const [tint, setTint] = useState(null);
  const [playing, setPlaying] = useState(null);
  const animationRef = useRef(animation);
  animationRef.current = animation;
  const frameRef = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  /* Показ затухания или пульса: ключи считаются на старте (правка ползунка во время показа берётся со следующего). */
  const play = useCallback(
    (kind) => {
      stop();
      const keys = kind === "fade" ? fadeTimeline(animationRef.current) : pulseTimeline(animationRef.current);
      if (prefersReducedMotion()) {
        setOpacity(100);
        setPlaying(null);
        return;
      }
      const length = timelineLength(keys);
      const started = performance.now();
      setPlaying(kind);
      const step = (now) => {
        const time = (now - started) / 1000;
        if (time >= length) {
          setOpacity(100);
          setPlaying(null);
          frameRef.current = 0;
          return;
        }
        setOpacity(valueAt(keys, time));
        frameRef.current = requestAnimationFrame(step);
      };
      frameRef.current = requestAnimationFrame(step);
    },
    [stop],
  );

  /* Перелив: цвет кадра идёт по тем же кадрам, что и в игре, 30 раз в секунду (частота фильма). */
  useEffect(() => {
    if (!shimmer) {
      setTint(null);
      return undefined;
    }
    if (prefersReducedMotion()) {
      setTint(shimmerHexAt(animationRef.current, 0));
      return undefined;
    }
    const started = performance.now();
    const timer = window.setInterval(() => setTint(shimmerHexAt(animationRef.current, (performance.now() - started) / 1000)), 1000 / 30);
    setTint(shimmerHexAt(animationRef.current, 0));
    return () => window.clearInterval(timer);
  }, [shimmer]);

  useEffect(() => stop, [stop]);

  return { opacity, tint, play, playing };
}
