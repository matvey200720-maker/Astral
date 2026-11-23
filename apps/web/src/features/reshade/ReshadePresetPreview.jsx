/*
 * Превью пресета ReShade на карточке (ТЗ 17.10, задача 8): кадр 16:9, слева
 * без пресета, справа — с ним, ползунок двигает границу (те же органы, что у
 * «до/после» оптимизации и DLSS 5). Это один настоящий кадр GTA V без
 * эффектов, обработанный в окне формулами шейдера Astral.fx
 * (`reshade-preview.js`). Это не кадр игры с пресетом, и подпись над
 * карточками говорит об этом прямо. Кадра нет или холст недоступен — вместо
 * превью подписанная заглушка, нарисованного вместо кадра здесь нет.
 */

import { memo, useEffect, useRef, useState } from "react";
import { ImageSquare } from "../../components/ui/icons.jsx";

import { useUiLanguage } from "../../locales/ui.js";
import { presetPreview, previewFrameUrl } from "./reshade-preview.js";
import { reshadePresetsCopyFor } from "./reshade-presets-copy.js";

/* Размер холста миниатюры: с запасом на плотные экраны. */
const SHOT_WIDTH = 480;
const SHOT_HEIGHT = 270;

/* Холст пресета: `loading` — считается, `ready` — нарисован, `failed` — посчитать нечем. */
function usePresetCanvas(presetId, canvasRef) {
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    presetPreview(presetId).then((source) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!source || !canvas || !context) {
        setStatus("failed");
        return;
      }
      canvas.width = SHOT_WIDTH;
      canvas.height = SHOT_HEIGHT;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, SHOT_WIDTH, SHOT_HEIGHT);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [presetId, canvasRef]);
  return status;
}

function PresetShotBase({ presetId, name }) {
  const copy = reshadePresetsCopyFor(useUiLanguage());
  /* Кадр стоит «с пресетом» целиком (граница у левого края); граница идёт за курсором (`reshade-cinema.css`, `--reshade-hover-split`) или за
     ползунком с клавиатуры — он остаётся, но на плитке невидим и без мыши. */
  const [split, setSplit] = useState(0);
  const canvasRef = useRef(null);
  const status = usePresetCanvas(presetId, canvasRef);
  const url = previewFrameUrl();
  const failed = !url || status === "failed";
  return (
    <div className="reshade-preset-shot">
      <figure
        className="optimization-shots reshade-shots-mini"
        style={{ "--shot-split": `${split}%` }}
      >
        <div className="optimization-shots-frame">
          {failed ? (
            <span className="optimization-shot-placeholder" data-side="after">
              <ImageSquare aria-hidden="true" />
              <small>{url ? copy.previewFailed : copy.noFrame}</small>
            </span>
          ) : (
            <>
              <div className="optimization-shots-layer" data-side="after">
                <canvas
                  ref={canvasRef}
                  className="optimization-shot-image"
                  role="img"
                  aria-label={copy.previewTitle(name)}
                />
              </div>
              <div className="optimization-shots-layer" data-side="before">
                <img
                  className="optimization-shot-image"
                  src={url}
                  alt={copy.previewBefore}
                  loading="lazy"
                  draggable={false}
                />
              </div>
              <span className="optimization-shots-divider" aria-hidden="true" />
              <span className="optimization-shots-tag" data-side="before">
                {copy.previewBefore}
              </span>
              <span className="optimization-shots-tag" data-side="after">
                {copy.previewAfter}
              </span>
              <input
                type="range"
                className="optimization-shots-range"
                min="0"
                max="100"
                step="1"
                value={split}
                aria-label={copy.compareAria(name)}
                onChange={(event) => setSplit(Number(event.target.value))}
              />
            </>
          )}
        </div>
      </figure>
    </div>
  );
}

/** Карточное превью пресета: кадр «без пресета / с пресетом» с ползунком. */
export const PresetShot = memo(PresetShotBase);
