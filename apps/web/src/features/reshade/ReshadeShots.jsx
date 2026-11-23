/*
 * Кадры «до/после» DLSS 5 на странице ReShade — одна картинка с ползунком, как у
 * карточек оптимизации (те же органы и стиль, `optimization-shots`).
 *
 * Кадры лежат в `src/assets/reshade-shots/`: `<что>-before` и `<что>-after`.
 * Только настоящие кадры из игры: стенд «В игре», скриптовая камера, «до» —
 * та же сцена без DLSS 5 (как сняты — README в той же папке). Пока кадра нет
 * — подписанная заглушка, нарисованное вместо кадра не показывается.
 *
 * `crop` — крупный план того же кадра: `{ x, y, size }` в долях кадра
 * (левый верхний угол и сторона). Квадрат в долях держит пропорции кадра
 * 16:9 — увеличение без искажения; пиксели те же, что в полном кадре.
 */

import { memo, useState } from "react";
import { ImageSquare } from "../../components/ui/icons.jsx";

import { useUiLanguage } from "../../locales/ui.js";
import { reshadeCopyFor } from "./reshade-copy.js";

const SHOTS = import.meta.glob("../../assets/reshade-shots/*.{jpg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
});
const EXTENSIONS = Object.freeze(["webp", "jpg", "png"]);

export function reshadeShotUrl(file) {
  for (const extension of EXTENSIONS) {
    const url = SHOTS[`../../assets/reshade-shots/${file}.${extension}`];
    if (url) return url;
  }
  return null;
}

/* Кадр в 1/size раз больше рамки и сдвинут на угол участка: сдвиг в
   процентах — от размера самой картинки, то есть в долях кадра. */
function cropStyle(crop) {
  return crop
    ? {
        width: `${100 / crop.size}%`,
        height: `${100 / crop.size}%`,
        maxWidth: "none",
        transform: `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`,
      }
    : undefined;
}

function Shot({ file, label, caption, side, crop }) {
  const copy = reshadeCopyFor(useUiLanguage());
  const url = reshadeShotUrl(file);
  const [broken, setBroken] = useState(false);
  if (!url || broken)
    return (
      <span className="optimization-shot-placeholder" data-side={side}>
        <ImageSquare aria-hidden="true" />
        <b>{label}</b>
        <small>{copy.noShot}</small>
        <code>{`${file}.webp`}</code>
      </span>
    );
  return (
    <img
      className="optimization-shot-image"
      data-side={side}
      src={url}
      alt={`${label}: ${caption}`}
      loading="lazy"
      draggable={false}
      style={cropStyle(crop)}
      onError={() => setBroken(true)}
    />
  );
}

/**
 * Кадр-миниатюра для ленты под большим кадром (ТЗ 23.10, п. G): «после» того же снимка, целиком или участком `crop`.
 * Без ползунка — сравнивают в большом кадре.
 */
export function ReshadeShotThumb({ file, crop = null, alt = "" }) {
  const url = reshadeShotUrl(file);
  if (!url) return <span className="reshade-thumb-empty" aria-hidden="true" />;
  return (
    <img
      className="reshade-thumb-image"
      src={url}
      alt={alt}
      loading="lazy"
      draggable={false}
      style={cropStyle(crop)}
    />
  );
}

function ReshadeShots({
  id,
  title,
  caption,
  before,
  after,
  crop = null,
  className = "",
  state = null,
}) {
  const copy = reshadeCopyFor(useUiLanguage());
  const [split, setSplit] = useState(50);
  return (
    <div className={`reshade-shots-block${className ? ` ${className}` : ""}`}>
      <figure
        className={`optimization-shots reshade-shots${crop ? " is-crop" : ""}`}
        style={{ "--optimization-split": `${split}%` }}
      >
        <div className="optimization-shots-frame">
          <div className="optimization-shots-layer" data-side="after">
            <Shot
              file={`${id}-after`}
              label={after}
              caption={caption}
              side="after"
              crop={crop}
            />
          </div>
          <div className="optimization-shots-layer" data-side="before">
            <Shot
              file={`${id}-before`}
              label={before}
              caption={caption}
              side="before"
              crop={crop}
            />
          </div>
          <span className="optimization-shots-divider" aria-hidden="true" />
          {state?.text ? (
            <span
              className="reshade-shots-state"
              data-on={state.on ? "true" : "false"}
              aria-hidden="true"
            >
              <i />
              {state.text}
            </span>
          ) : null}
          <span className="optimization-shots-tag" data-side="before">
            {before}
          </span>
          <span className="optimization-shots-tag" data-side="after">
            {after}
          </span>
          <input
            type="range"
            className="optimization-shots-range"
            min="0"
            max="100"
            step="1"
            value={split}
            aria-label={copy.compareAria(title)}
            onChange={(event) => setSplit(Number(event.target.value))}
          />
        </div>
      </figure>
      {caption ? <p className="fx-hint">{caption}</p> : null}
    </div>
  );
}

export default memo(ReshadeShots);
