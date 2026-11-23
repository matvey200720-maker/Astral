import { gunSlotOf } from "./work-kinds.js";
import { createElement as h, useEffect, useState } from "react";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";

const THUMB_PREFIX = "asset:gun:";
const noop = () => {};

// Папка и расширение запасной картинки; всё, кроме одежды, считается оружием.
const FALLBACK_ART = new Map([["clothing", ["clothing", "svg"]]]);

const fallbackOf = (kind, slot) => {
  if (!slot) return "";
  const [dir, ext] = FALLBACK_ART.get(kind) ?? ["weapons", "png"];
  return `/assets/catalog/${dir}/${slot}.${ext}`;
};

const readState = (state) => {
  if (typeof state !== "string") return state;
  try {
    return JSON.parse(state);
  } catch {
    return null;
  }
};

// Ссылка миниатюры из состояния работы; чужая или битая — пустая строка.
const thumbnailOf = (state) => {
  const link = String(readState(state)?.thumbnail ?? "");
  return link.startsWith(THUMB_PREFIX) ? link : "";
};

// Просит миниатюру у хранилища работ, отдаёт адрес в `accept`, возвращает отмену.
function watchThumbnail(link, accept) {
  const watch = { live: true, address: "" };
  const key = `gun:${link.slice(THUMB_PREFIX.length)}`;
  const deliver = (blob) => {
    if (!watch.live || !blob) return;
    watch.address = URL.createObjectURL(blob);
    accept(watch.address);
  };

  (async () => deliver(await getWorkshopAsset(key)))().catch(noop);

  return () => {
    watch.live = false;
    if (watch.address) URL.revokeObjectURL(watch.address);
  };
}

function useThumbnail(link) {
  const [address, setAddress] = useState("");
  useEffect(() => (link ? watchThumbnail(link, setAddress) : undefined), [link]);
  return address;
}

const pictureProps = (src) => ({ alt: "", loading: "lazy", draggable: false, src });

const GunWorkCover = (props) => {
  const { className = "", kind = "weapon", state } = props;
  const stored = useThumbnail(thumbnailOf(state));
  const slot = gunSlotOf(state);
  const src = stored.length > 0 ? stored : fallbackOf(kind, slot);
  const classes = `gun-work-cover ${className}`.trim();

  return h("span", { className: classes }, src ? h("img", pictureProps(src)) : null);
};

export default GunWorkCover;
