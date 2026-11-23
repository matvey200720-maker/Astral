/*
 * Кадры «до/после» карточки оптимизации — одна картинка с ползунком.
 *
 * Кадры кладутся в `src/assets/optimization-shots/`: `<карточка>-before` и
 * `<карточка>-after`, в `.jpg`, `.png` или `.webp`. Какие есть, сборка знает
 * сама (`import.meta.glob`): окно не стучится за файлами, которых нет, и
 * консоль не сыплет 404. Пока кадра нет, на его месте матовая заглушка с
 * подписью «кадр из игры ещё не снят» и именем файла: нарисованное вместо
 * кадра из игры не показывается (что и откуда снимать — `README.md` в той
 * же папке).
 *
 * Ползунок — настоящий `input type="range"`: двигается мышью, пальцем и
 * стрелками, и читается экранным диктором.
 */

import { memo, useState } from "react";
import { ImageSquare } from "../../components/ui/icons.jsx";

const SHOTS = import.meta.glob("../../assets/optimization-shots/*.{jpg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
});
const EXTENSIONS = Object.freeze(["jpg", "png", "webp"]);

/** Адрес кадра или `null`, если его пока не положили. */
export function optimizationShotUrl(file) {
  for (const extension of EXTENSIONS) {
    const url = SHOTS[`../../assets/optimization-shots/${file}.${extension}`];
    if (url) return url;
  }
  return null;
}

/* Кадр или подписанная заглушка; битый файл — тоже заглушка. */
function Shot({ file, label, caption, missing, side }) {
  const url = optimizationShotUrl(file);
  const [broken, setBroken] = useState(false);
  if (!url || broken)
    return (
      <span className="optimization-shot-placeholder" data-side={side}>
        <ImageSquare aria-hidden="true" />
        <b>{label}</b>
        <small>{missing}</small>
        <code>{`${file}.jpg`}</code>
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
      onError={() => setBroken(true)}
    />
  );
}

/**
 * @param {{
 *   files: { before: string, after: string },
 *   title: string,
 *   caption: string,
 *   copy: { before: string, after: string, compare: string, shotMissing: string },
 * }} props
 */
function OptimizationShots({ files, caption, title, copy }) {
  const [split, setSplit] = useState(50);
  return (
    <figure
      className="optimization-shots"
      style={{ "--optimization-split": `${split}%` }}
    >
      <div className="optimization-shots-frame">
        <div className="optimization-shots-layer" data-side="after">
          <Shot file={files.after} label={copy.after} caption={caption} missing={copy.shotMissing} side="after" />
        </div>
        <div className="optimization-shots-layer" data-side="before">
          <Shot file={files.before} label={copy.before} caption={caption} missing={copy.shotMissing} side="before" />
        </div>
        <span className="optimization-shots-divider" aria-hidden="true" />
        <span className="optimization-shots-tag" data-side="before">
          {copy.before}
        </span>
        <span className="optimization-shots-tag" data-side="after">
          {copy.after}
        </span>
        <input
          type="range"
          className="optimization-shots-range"
          min="0"
          max="100"
          step="1"
          value={split}
          aria-label={`${copy.compare}: ${title}`}
          onChange={(event) => setSplit(Number(event.target.value))}
        />
      </div>
    </figure>
  );
}

export default memo(OptimizationShots);
