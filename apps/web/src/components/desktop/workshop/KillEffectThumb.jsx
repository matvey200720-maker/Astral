import { useMemo, useRef, useEffect } from "react";
import { paintKillEffect, killEffectPeakFrame } from "./kill-effect-painter.js";

// Один проход на всех: плитка рисует кадр пика тем же кодом, что и большой предпросмотр.
// Запасной размер 160×90 (раскладка могла быть не измерена), плотность не выше 2
// (docs/3D.md: буфер холста не раздувается), зерно на плитке неразличимо — выключено.
export default function KillEffectThumb({ className = "", project }) {
  const frame = useMemo(() => killEffectPeakFrame(project), [project]);
  const target = useRef();
  useEffect(() => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = target.current;
    let context;
    try {
      context = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!context) return;
    const [width, height] = [canvas.clientWidth || 160, canvas.clientHeight || 90];
    [canvas.width, canvas.height] = [width, height].map((side) => Math.round(side * ratio));
    context.setTransform(...[ratio, 0, 0, ratio, 0, 0]);
    paintKillEffect({ grain: false, frame, context, width, height });
  }, [frame]);
  return <canvas aria-hidden="true" className={`kill-effect-thumb ${className}`.trim()} ref={target} />;
}
