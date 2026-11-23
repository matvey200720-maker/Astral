import { createElement as h } from "react";
import { Check } from "./icons.jsx";
import FavoriteHeart from "./FavoriteHeart.jsx";
import { PhotoSkeleton } from "./Skeleton.jsx";
import { useVirtualScrolled } from "./virtual-scrolled.js";

const DEFAULTS = {
  className: "",
  media: null,
  mediaStyle: null,
  frameClassName: "",
  shadeClassName: "",
  copyClassName: "",
  trailingClassName: "",
  likeClassName: "",
  selectClassName: "",
  kicker: null,
  description: null,
  trailing: null,
  liked: false,
  favoriteLabel: "",
  onFavorite: null,
  editing: false,
  selected: false,
};
const OWN_ONLY = ["title", "onClick", "children"];
const PRESS_ENDS = ["pointerup", "pointercancel"];

const joinClasses = (...names) => names.filter(Boolean).join(" ");

// Названные свойства получают умолчания вместо undefined; остальное уходит на корень как есть.
function splitProps(props) {
  const known = new Set([...Object.keys(DEFAULTS), ...OWN_ONLY]);
  const own = { ...DEFAULTS };
  const rest = {};
  for (const [name, value] of Object.entries(props)) {
    if (!known.has(name)) rest[name] = value;
    else if (value !== undefined || !(name in DEFAULTS)) own[name] = value;
  }
  return [own, rest];
}

// Адрес картинки кадра: первое url(…) в backgroundImage, парные кавычки снимаются, прочее остаётся как есть.
function pictureUrl(style) {
  const found = /url\(([^)]*)\)/.exec(String(style.backgroundImage ?? ""));
  return found ? found[1].replace(/^(["'])(.*)\1$/, "$2") : "";
}

const swallow = (event) => {
  event.stopPropagation();
};

// Жесты на сердце остаются на нём; зажатое сердце метит карточку, а окно снимает метку при отпускании где угодно.
function heartGestures(onFavorite) {
  const choose = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onFavorite();
  };
  return {
    onPointerDown(event) {
      event.stopPropagation();
      const card = event.currentTarget.parentElement;
      card.setAttribute("data-like-press", "");
      const release = () => {
        card.removeAttribute("data-like-press");
        PRESS_ENDS.forEach((type) => window.removeEventListener(type, release, true));
      };
      PRESS_ENDS.forEach((type) => window.addEventListener(type, release, true));
    },
    onPointerUp: swallow,
    onMouseDown: swallow,
    onMouseUp: swallow,
    onKeyUp: swallow,
    onClick: choose,
    onKeyDown(event) {
      if (event.key === "Enter" || event.key === " ") choose(event);
    },
  };
}

/* Картинки из локальной службы медиа (`/api/media/…`) плита берёт по очереди окна (`Skeleton.jsx`, не больше пяти разом): их фон в стиле кадра не стоит, пока она не доехала, а лежит в `data-photo-bg`,
   иначе браузер сам пошёл бы за всеми сразу и занял шесть соединений окна к службе (16.11.2026). Это каждое свойство стиля с `url(…)`: `backgroundImage` и переменные вида `--catalog-card-art`. */
const SERVICE_PICTURE = /^\/api\/media\//;

function withheldStyle(mediaStyle) {
  const picture = {};
  const rest = {};
  for (const [name, value] of Object.entries(mediaStyle)) {
    if (typeof value === "string" && value.includes("url(")) picture[name] = value;
    else rest[name] = value;
  }
  return [rest, picture];
}

function frameNode({ mediaStyle, frameClassName }, scrolled) {
  if (!mediaStyle) return null;
  const url = pictureUrl(mediaStyle);
  const plate = scrolled ? null : h(PhotoSkeleton, { url });
  const gated = Boolean(plate && SERVICE_PICTURE.test(url));
  const [style, picture] = gated ? withheldStyle(mediaStyle) : [mediaStyle, null];
  return h(
    "span",
    { className: joinClasses("ui-media-card-frame", frameClassName), style, "data-photo-bg": picture ? JSON.stringify(picture) : undefined, "aria-hidden": "true" },
    plate,
  );
}

function heartNode({ likeClassName, liked, favoriteLabel, onFavorite }) {
  return h(
    "span",
    {
      className: joinClasses("ui-media-card-like", likeClassName, liked && "is-liked"),
      role: "button",
      tabIndex: 0,
      "aria-label": favoriteLabel,
      "aria-pressed": liked,
      title: favoriteLabel,
      ...heartGestures(onFavorite),
    },
    h(FavoriteHeart, { on: liked, compact: true }),
  );
}

export default function MediaCard(props) {
  const [own, rest] = splitProps(props);
  const { media, kicker, description, trailing, editing, selected, onFavorite } = own;
  const scrolled = useVirtualScrolled();
  const hearted = onFavorite && !editing;
  const cornerless = !trailing && !hearted && !editing;

  const parts = [
    media,
    frameNode(own, scrolled),
    h("span", { className: joinClasses("ui-media-card-shade", own.shadeClassName), "aria-hidden": "true" }),
    h("div", { className: joinClasses("ui-media-card-copy", own.copyClassName) }, kicker && h("small", null, kicker), h("h3", null, props.title), description && h("p", typeof description === "string" ? { title: description } : null, description)),
    trailing && h("span", { className: joinClasses("ui-media-card-trailing", own.trailingClassName) }, trailing),
    hearted ? heartNode(own) : null,
    editing && h("span", { className: joinClasses("ui-media-card-select", own.selectClassName) }, selected && h(Check)),
    props.children,
  ];
  const root = {
    type: "button",
    className: joinClasses("ui-media-card", trailing && "has-trailing", cornerless && "is-cornerless", own.className),
    "aria-pressed": editing ? selected : undefined,
    ...rest,
    onClick: props.onClick,
  };
  return h("button", root, ...parts);
}
