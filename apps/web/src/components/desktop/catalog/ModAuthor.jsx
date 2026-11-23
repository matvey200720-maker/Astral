import { isOwnVideo, youtubeVideoId } from "../../../features/catalog/youtube-video.js";
import { createElement, useId } from "react";
import { dataLangOf } from "./data-lang.js";
import AccountAvatar from "../../ui/AccountAvatar.jsx";
import {
  authorKey,
  authorPageOf,
  isAuthorUnknown,
  isDefaultAuthor,
  modAuthor,
  modCredits,
} from "../../../features/catalog/catalog-authors.js";
import { CaretRight } from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";

const BRAND_MARK = "/brand/astral-icon.jpg";

const secure = (url) => (url.startsWith("https://") ? url : "");

// Слово роли в строке «Редукс … Обзор …»; перевод берёт словарь окна.
const ROLE_WORD = {
  redux: () => tr("Редукс"),
  reviewer: () => tr("Обзор"),
};

export const avatarOf = (mod, name) => {
  if (isDefaultAuthor(name)) return BRAND_MARK;
  const wanted = authorKey(name);
  const list = mod?.attribution?.authors || [];
  const entry = list.find((one) => typeof one?.avatar === "string" && authorKey(one.name) === wanted);
  return entry ? secure(entry.avatar) : "";
};

export const modSourceLinks = (mod, mods = null) => {
  const links = new Map();
  [...(mod?.attribution?.sources || [])].forEach((item) => {
    const video = item?.type === "youtube" && item.url && youtubeVideoId(item.url);
    if (!video || !isOwnVideo(video, mod, mods)) return;
    const link = links.get(video) || { key: `yt:${video}`, type: "youtube", url: item.url, title: "" };
    link.title = link.title || item.title || "";
    links.set(video, link);
  });
  return [...links.values()];
};

// Тон кружка 0…359 из ключа имени: свёртка кодовых точек в 32-битное целое со знаком.
const hueOf = (name) => {
  const folded = [...authorKey(name)].reduce((sum, sign) => (sum * 31 + sign.codePointAt(0)) | 0, 0);
  return Math.abs(folded) % 360;
};

export const AuthorAvatar = (props) => {
  const { name, avatar = "", size = "md", className = "", unknown = false } = props;
  const look = {
    className: ["author-avatar", className].filter(Boolean).join(" "),
    "data-size": size,
    "data-unknown": unknown ? "" : undefined,
    style: { "--author-hue": hueOf(name) },
    lang: dataLangOf(name),
  };
  return createElement("span", look, <AccountAvatar account={{ avatarUrl: avatar, displayName: name }} />);
};

// Подпись и ник связаны с кнопкой через общий префикс; язык окна слушает тот же хук.
const useChipIds = () => {
  useTr();
  const prefix = useId();
  return { role: `${prefix}-role`, name: `${prefix}-name` };
};

const chipOf = (variant, ...children) => createElement("span", { className: `mod-author-chip ${variant}` }, ...children);

const ModAuthor = ({ mod, onOpen = null }) => {
  const ids = useChipIds();
  if (isAuthorUnknown(mod)) {
    const note = createElement("span", { className: "mod-author-copy" }, createElement("strong", null, tr("Автор не указан")));
    return chipOf("is-static is-unknown", <AuthorAvatar name="?" unknown />, note);
  }

  const name = modAuthor(mod);
  const face = <AuthorAvatar name={name} avatar={avatarOf(mod, name)} />;
  const copy = createElement(
    "span",
    { className: "mod-author-copy" },
    createElement("small", { id: ids.role }, tr("Автор")),
    createElement("strong", { id: ids.name, "data-audit-ignore": "caps", lang: dataLangOf(name) }, name),
  );
  if (!onOpen) return chipOf("is-static", face, copy);

  const button = {
    type: "button",
    className: "mod-author-chip",
    "aria-labelledby": `${ids.role} ${ids.name}`,
    title: tr("Все моды автора"),
    onClick: () => {
      onOpen(authorPageOf(name));
    },
  };
  return createElement("button", button, face, copy, <CaretRight className="mod-author-go" aria-hidden="true" />);
};

export default ModAuthor;

export const ModCreditsLine = ({ mod }) => {
  useTr();
  const rows = modCredits(mod).map(({ role, names }) => {
    const people = createElement("b", { "data-audit-ignore": "caps", lang: dataLangOf(names.join(" ")) }, names.join(", "));
    return createElement("span", { key: role }, ROLE_WORD[role](), " ", people);
  });
  return rows.length > 0 ? createElement("p", { className: "mod-author-credits" }, rows) : null;
};
