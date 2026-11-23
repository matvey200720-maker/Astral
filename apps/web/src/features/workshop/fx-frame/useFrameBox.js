/*
 * Рамка кадра игры: ровно по пропорции кадра, вписанная в место, которое дал редактор (`docs/fx-scenes.md`). Кадр не растягивается:
 * холст другой пропорции растянул бы и фон, и частицы, и они разошлись бы с опорами сцены.
 */
import { useEffect, useRef, useState } from "react";

/**
 * @param {object} options
 * @param {boolean} options.ready — кадр на экране (пока его нет, мерить нечего)
 * @param {number} options.aspect — ширина / высота кадра
 * @returns {{ boxRef: object, size: { width: number, height: number } }} `boxRef` — на внешний блок, `size` — размер рамки в CSS-пикселях
 */
export function useFrameBox({ ready, aspect }) {
  const boxRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const box = boxRef.current;
    if (!ready || !box || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const { width, height } = box.getBoundingClientRect();
      if (!width || !height) return;
      const fitted = Math.min(width, height * aspect);
      setSize({ width: Math.round(fitted), height: Math.round(fitted / aspect) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [ready, aspect]);
  return { boxRef, size };
}
