import { createElement as h, Fragment, useState } from "react";
import { PhotoSkeleton, Skeleton } from "./Skeleton.jsx";
import { useRenderFill } from "./frame-crop.js";
import { DARK, useImageTones } from "./image-tone.js";
import { Check } from "./icons.jsx";
import { useTileThumb } from "../../utils/tile-thumb.js";

const FRAME_OPTIONS = { fallback: "auto", reserve: 0.46, caption: ":scope > .ui-pick-copy" };

const joinClasses = (...names) => names.filter(Boolean).join(" ");

// Отметка в углу и атрибуты кнопки по режиму; режим, которого здесь нет, остаётся без отметки.
const MARKS = new Map([
  ["check", (selected) => h("i", { className: "ui-pick-mark", "aria-hidden": "true" }, selected && h(Check, { weight: "bold" }))],
  ["switch", (selected) => h("i", { className: joinClasses("ui-pick-switch", selected && "is-on"), "aria-hidden": "true" })],
]);
const STATE_ATTRS = new Map([
  ["check", (selected) => ({ "aria-pressed": selected })],
  ["switch", (selected) => ({ role: "switch", "aria-checked": selected })],
]);

// Рисунок показан целиком: не лёг на своё поле, рамка не решила «фото без рамки», а fit или прозрачный кадр просят целиком.
function showsWhole(fit, tones, frame) {
  if (frame.mode === "fill" || frame.mode === "cover") return false;
  return fit === "contain" || (fit === "auto" && tones.transparent);
}

// Тон подписи и раскладка фото постера по выдаче тона кадра и рамки рисунка.
function posterLook(fit, tones, frame) {
  const fill = frame.mode === "fill";
  const whole = showsWhole(fit, tones, frame);
  const plate = whole || (fill && frame.transparent) ? DARK : null;
  return { fill, whole, text: plate ?? tones.text, corner: plate ?? tones.corner, ready: (fit !== "auto" || tones.measured) && frame.ready };
}

// Плита и фото рядом: плита обязана стоять сразу перед картинкой. Своё состояние «доехало» живёт, пока адрес тот же.
function PosterPhoto({ src, look, frame }) {
  const [arrived, setArrived] = useState(false);
  const onLoad = () => {
    setArrived(true);
  };
  return h(
    Fragment,
    null,
    h(PhotoSkeleton, { held: !look.ready }),
    h("img", {
      "data-photo": "",
      className: joinClasses("ui-pick-photo", look.whole && "is-contain", arrived && look.ready && "is-loaded"),
      "data-render": look.fill ? "fill" : undefined,
      alt: "",
      loading: "lazy",
      decoding: "async",
      draggable: "false",
      src,
      style: look.fill ? frame.style : undefined,
      ref: frame.ref,
      onLoad,
    }),
  );
}

function captionOf({ poster, kicker, title, note, meta }) {
  const tail = note ? h("em", null, note) : meta ? h("small", null, meta) : null;
  return h("span", { className: "ui-pick-copy" }, poster && kicker && h("span", { className: "ui-pick-kicker" }, kicker), h("b", null, title), tail);
}

/* `coverTile` — раскладка плитки (`utils/tile-thumb.js`): облачное фото идёт превью по её ширине, а не оригиналом; без неё — как было. */
const DEFAULTS = { media: null, meta: null, note: null, mode: "check", look: "tile", cover: "", coverTile: null, fit: "cover", kicker: null, badge: null, selected: false, disabled: false, className: "" };
const OWN_KEYS = new Set([...Object.keys(DEFAULTS), "title", "ariaLabel", "onClick"]);

// Делит свойства на свои (с умолчаниями для undefined) и остальные, которые уйдут на корень как есть.
function splitProps(props) {
  const own = { ...DEFAULTS };
  const rest = {};
  for (const [name, value] of Object.entries(props)) {
    if (!OWN_KEYS.has(name)) rest[name] = value;
    else if (value !== undefined || !(name in DEFAULTS)) own[name] = value;
  }
  return [own, rest];
}

export default function PickTile(props) {
  const [own, rest] = splitProps(props);
  const {
    ariaLabel,
    badge,
    className,
    cover: fullCover,
    coverTile,
    disabled,
    fit,
    kicker,
    look,
    media,
    meta,
    mode,
    note,
    onClick,
    selected,
    title,
  } = own;
  const isPoster = look === "poster";
  const cover = useTileThumb(fullCover, coverTile);
  const inkTones = useImageTones(isPoster ? cover : "");
  const fillSrc = isPoster && cover && fit !== "cover" ? cover : "";
  const renderFrame = useRenderFill(fillSrc, FRAME_OPTIONS);
  const stance = isPoster ? posterLook(fit, inkTones, renderFrame) : null;

  const rootClass = joinClasses(
    "ui-pick-tile",
    `is-${mode}`,
    isPoster && "is-poster",
    isPoster && !cover && !media && "is-blank",
    selected && "is-selected",
    note && "has-note",
    badge && "has-badge",
    className,
  );
  const toneAttrs = { "data-tone": stance?.text, "data-corner-tone": stance?.corner };

  const front =
    isPoster && cover
      ? h(PosterPhoto, { key: cover, src: cover, look: stance, frame: renderFrame })
      : h("span", { className: "ui-pick-media", "aria-hidden": "true" }, media);
  const shade = isPoster ? h("span", { className: "ui-pick-shade", "aria-hidden": "true" }) : null;
  const mark = MARKS.get(mode)?.(selected);
  const caption = captionOf({ poster: isPoster, kicker, title, note, meta });
  const pin = badge ? h("span", { className: "ui-pick-badge" }, badge) : null;

  if (mode === "static") {
    return h("div", { className: rootClass, ...toneAttrs, ...rest }, front, shade, mark, caption, pin);
  }

  const buttonProps = {
    type: "button",
    className: rootClass,
    role: undefined,
    "aria-checked": undefined,
    "aria-pressed": undefined,
    "aria-label": ariaLabel || undefined,
    disabled,
    ...toneAttrs,
    onClick,
  };
  Object.assign(buttonProps, STATE_ATTRS.get(mode)?.(selected));
  return h("button", { ...buttonProps, ...rest }, front, shade, mark, caption, pin);
}

export function PickGrid({ children, className = "", label, look = "tile" }) {
  return h("div", { className: joinClasses("ui-pick-grid", look === "poster" && "is-poster", className), role: "group", "aria-label": label, "data-screen-group": "" }, children);
}

export function PickTileSkeleton({ look = "tile", delay = 0 }) {
  const poster = look === "poster";
  const lead = poster ? h(Skeleton, { fill: true, delay }) : h(Skeleton, { className: "ui-pick-media", delay });
  const lines = h("span", { className: "ui-pick-copy" }, h(Skeleton, { line: true, delay: delay + 60 }), h(Skeleton, { line: true, delay: delay + 120 }));
  return h("div", { className: joinClasses("ui-pick-tile is-skeleton", poster && "is-poster"), "aria-hidden": "true" }, lead, lines);
}
