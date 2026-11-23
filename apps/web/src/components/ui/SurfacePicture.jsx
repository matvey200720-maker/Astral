import { tr, useTr } from "../../locales/ui.js";
import Button from "./Button.jsx";
import ListGroup from "./ListGroup.jsx";
import NavRow from "./NavRow.jsx";
import { useFileDrop } from "./file-drop.js";
import { UploadSimple, X } from "./icons.jsx";
import { useEffect, useRef, useState } from "react";

const DEFAULT_ASPECT = 16 / 9;
// Рамка не выше половины ширины и не уже ленты 4 к 1.
const MIN_FRAME_ASPECT = 2;
const MAX_FRAME_ASPECT = 4;
const MIN_CROP_SPAN = 0.001;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|avif|apng)$/;

const isImageKind = (kind) => kind.startsWith("image/") || IMAGE_EXTENSION.test(kind);

// Подпись форматов пустой строки: по `accept`; не картинки -- подсказка места или ничего.
function formatsCaption(accept, hint) {
  const kinds = String(accept)
    .split(",")
    .map((kind) => kind.trim().toLowerCase())
    .filter(Boolean);
  if (!kinds.every(isImageKind)) return hint || null;
  const withGif = kinds.some((kind) => kind === "image/*" || kind.includes("gif"));
  return withGif ? tr("PNG, JPG, GIF или перетащите") : tr("PNG, JPG или перетащите");
}

// Пропорция поверхности и рамки; поверхность вписывается в рамку целиком:
// по ширине, если она не уже рамки, иначе по высоте.
function frameLayout(aspect) {
  const number = Number(aspect);
  const surface = number > 0 ? number : DEFAULT_ASPECT;
  const frame = Math.min(MAX_FRAME_ASPECT, Math.max(MIN_FRAME_ASPECT, surface));
  return { surface, frame, byWidth: surface >= frame };
}

// Окно кадра [x0, y0, x1, y1] в долях картинки -> раскладка, где окно ровно во всю поверхность.
// Не набрались четыре числа -- стиля нет (как у браузера, отбросившего «NaN%»).
function cropStyle(crop) {
  if (!Array.isArray(crop)) return undefined;
  const [x0, y0, x1, y1] = crop.map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined;
  const spanX = Math.max(MIN_CROP_SPAN, x1 - x0);
  const spanY = Math.max(MIN_CROP_SPAN, y1 - y0);
  return {
    width: `${100 / spanX}%`,
    height: `${100 / spanY}%`,
    left: `${-(x0 / spanX) * 100}%`,
    top: `${-(y0 / spanY) * 100}%`,
  };
}

function ownImageStyle({ crop, position, zoom }) {
  if (crop) return cropStyle(crop);
  const style = { objectPosition: position };
  if (zoom !== 1) {
    style.transformOrigin = position;
    style.transform = `scale(${zoom})`;
  }
  return style;
}

function cueLabel(working, own) {
  if (working) return tr("Читаем…");
  return own ? tr("Заменить") : tr("Заменить картинку");
}

// То, что лежит на поверхности: своя картинка, слова или лист игры.
function Picture({ own, src, current, text, fit, crop, zoom, position }) {
  if (!own) {
    return (
      <img
        alt=""
        draggable="false"
        className="ui-surface-picture-image is-stretch"
        src={current}
      />
    );
  }
  if (src) {
    return (
      <img
        alt=""
        draggable="false"
        className={`ui-surface-picture-image ${crop ? "is-crop" : `is-${fit}`}`}
        style={ownImageStyle({ crop, position, zoom })}
        src={src}
      />
    );
  }
  if (!text?.value) return null;
  const colour = text.colour ? { color: text.colour } : undefined;
  return (
    <span className="ui-surface-picture-text" style={colour}>
      {text.value}
    </span>
  );
}

export default function SurfacePicture({
  current = "",
  fill = "",
  label,
  src = "",
  aspect = DEFAULT_ASPECT,
  accept = "image/*",
  background = "",
  busy = false,
  caption = "",
  className = "",
  clearLabel = "",
  crop = null,
  disabled = false,
  dropLabel = "",
  dropSelf = false,
  empty = "",
  emptyCaption = "",
  fit = "cover",
  hint = "",
  inputLabel = "",
  onClear = null,
  onFile,
  position = "50% 50%",
  text = null,
  zoom = 1,
  ...rest
}) {
  useTr();
  const [reading, setReadActive] = useState(false);
  const root = useRef(null);
  const chooser = useRef(null);
  const alive = useRef(false);
  const reader = useRef(false);

  // В строгом режиме эффект идёт дважды: флаг ставится при каждом запуске.
  useEffect(() => {
    const markGone = () => {
      alive.current = false;
    };
    alive.current = true;
    return markGone;
  }, []);

  const working = reading || Boolean(busy);
  const own = Boolean(src || fill || caption || text?.value);
  const kind = own ? "set" : current ? "current" : "row";

  // onFile зовётся в следующей микрозадаче; любая его беда гасится, чтение всегда кончается.
  const take = (file) => {
    if (!file || disabled || busy || reader.current) return;
    reader.current = true;
    setReadActive(true);
    Promise.resolve()
      .then(() => onFile(file))
      .catch(() => undefined)
      .then(() => {
        reader.current = false;
        if (!alive.current) return;
        setReadActive(false);
      });
  };

  const openChooser = () => chooser.current?.click();

  const handlePicked = (event) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    take(file);
  };

  useFileDrop(
    root,
    disabled || working || !onFile
      ? null
      : { label: dropLabel || tr("Отпустите — встанет картинкой"), onFile: take },
    { self: dropSelf },
  );

  const renderRow = () => (
    <ListGroup>
      <NavRow
        className="ui-surface-picture-row"
        icon={<UploadSimple />}
        title={!working ? empty || tr("Своя картинка") : tr("Читаем…")}
        caption={working ? null : emptyCaption || formatsCaption(accept, hint)}
        aria-label={label}
        tooltip={hint ? hint : undefined}
        aria-busy={working ? true : undefined}
        disabled={disabled}
        trailing={null}
        onOpen={openChooser}
      />
    </ListGroup>
  );

  const renderFrame = () => {
    const { surface, frame, byWidth } = frameLayout(aspect);
    const faceStyle = {
      aspectRatio: String(surface),
      [byWidth ? "width" : "height"]: "100%",
    };
    const paint = src ? background : fill;
    if (paint) faceStyle.background = paint;

    const clearWhat = clearLabel || tr("убрать картинку");

    return (
      <>
        <button
          aria-label={label}
          className="ui-surface-picture-tile"
          style={{ aspectRatio: `${frame}` }}
          type="button"
          aria-busy={working ? true : undefined}
          disabled={disabled}
          title={hint ? hint : undefined}
          onClick={openChooser}
        >
          <span className="ui-surface-picture-face" style={faceStyle}>
            <Picture
              own={own}
              src={src}
              current={current}
              text={text}
              fit={fit}
              crop={crop}
              zoom={zoom}
              position={position}
            />
          </span>
          <span
            className={own ? "ui-surface-picture-cue" : "ui-surface-picture-cue is-current"}
            aria-hidden="true"
          >
            <UploadSimple />
            <span>{cueLabel(working, own)}</span>
          </span>
        </button>
        {own && onClear && (
          <Button
            className="ui-surface-picture-clear"
            icon={<X aria-hidden="true" />}
            size="sm"
            variant="ghost"
            ariaLabel={[label, clearWhat].filter(Boolean).join(": ")}
            disabled={working || disabled}
            onClick={onClear}
            title={clearLabel ? clearLabel : tr("Убрать картинку")}
          />
        )}
        {own && caption && <div className="ui-surface-picture-caption">{caption}</div>}
      </>
    );
  };

  return (
    <div
      ref={root}
      className={["ui-surface-picture", `is-${kind}`, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <input
        ref={chooser}
        accept={accept}
        hidden
        aria-label={inputLabel || label}
        type="file"
        onChange={handlePicked}
      />
      {kind === "row" ? renderRow() : renderFrame()}
    </div>
  );
}
