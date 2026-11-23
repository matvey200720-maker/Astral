import { useEffect, useRef } from "react";

/*
 * Сцена вида нарисовала первый кадр (`PreviewWindow`: пока этого нет, на месте стоит фото кадра и загрузчик, потом сцена проявляется поверх). Векторные виды — мини-карта и
 * прицел — готовы, как только встали в документ: сообщаем после двух кадров экрана, чтобы проявление шло по уже отрисованному, а не по пустому месту. Небо (WebGL) своё слово
 * говорит само — `onReady` у `SkyStage` после первого кадра шейдера.
 */
export function useArrived(onReady) {
  const latest = useRef(onReady);
  latest.current = onReady;
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => latest.current?.());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
}
