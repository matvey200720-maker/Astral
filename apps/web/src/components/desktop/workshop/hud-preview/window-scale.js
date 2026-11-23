import { useLayoutEffect, useState } from "react";

/*
 * Во сколько раз экран игры больше своего кадра в окне (ТЗ 02.11.2026: «в окне аккуратно, в игре очень крупно»).
 *
 * По долям экрана окно и игра совпадают, но окно меньше экрана игры: кадр шириной 889 точек при игре 1920 ужимает прицел,
 * цифры и карту в 2,2 раза. Мерка — ширина экрана игры (`ScreenWidth` из settings.xml); пока игра не прочиталась, это ширина
 * монитора ОС (ТЗ H1, 14.11.2026: раньше считалось всегда от монитора, а игра может идти в другом разрешении). Ни того, ни
 * другого (среда без экрана) или окно не меньше экрана — 1: ужимать нечего.
 */
export function gameZoom(
  frameWidth,
  gameWidth = null,
  monitorWidth = globalThis.screen?.width,
) {
  const frame = Number(frameWidth);
  const target =
    Number(gameWidth) > 0 ? Number(gameWidth) : Number(monitorWidth);
  return frame > 0 && target > frame ? target / frame : 1;
}

/**
 * От чего посчитан `gameZoom`: `"game"` — от разрешения игры, `"monitor"` — игра не прочиталась, взят монитор ОС,
 * `"none"` — нечего брать. Строка экрана (`GameScreenLine`) называет это человеку.
 */
export function gameZoomBasis(
  gameWidth = null,
  monitorWidth = globalThis.screen?.width,
) {
  if (Number(gameWidth) > 0) return "game";
  return Number(monitorWidth) > 0 ? "monitor" : "none";
}

/**
 * `gameZoom` для кадра формы `aspect`, вписанного в коробку `ref` целиком: `{ zoom, basis }`.
 * `aspect` — форма КАДРА В ОКНЕ: у растянутого экрана это форма монитора (`resolveScreenView().monitorAspect`).
 */
export function useGameZoom(ref, aspect, gameWidth = null) {
  const [frameWidth, setFrameWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const box = node.getBoundingClientRect();
      setFrameWidth(Math.min(box.width, box.height * aspect));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, aspect]);
  return {
    zoom: gameZoom(frameWidth, gameWidth),
    basis: gameZoomBasis(gameWidth),
  };
}
