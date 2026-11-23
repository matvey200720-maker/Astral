// Приём своего звука студией: перетаскивание файла над документом, цель под курсором.
import { useEffect, useRef, useState } from "react";
import { tr } from "../../../../locales/ui.js";
import { SOUND_ASSET_EXTENSIONS } from "../workshop-assets.js";

export const SOUND_FILE_ACCEPT = ".wav,.ogg,.mp3,.flac,audio/wav,audio/ogg,audio/mpeg,audio/flac";
export const SOUND_FORMATS = ["wav", "ogg", "mp3", "flac"].join(" · ");

const DOM = Object.freeze({ shell: ".snd-shell", keyAttribute: "data-drop-key", textNode: 3 });
const AFTER_LAST_DOT = /\.([^.]*)$/;

export function soundFileProblem(file) {
  if (!file) return tr("Файл не пришёл — перетащите его ещё раз.");
  const extension = AFTER_LAST_DOT.exec(String(file.name || ""))?.[1].toLowerCase() ?? "";
  return SOUND_ASSET_EXTENSIONS.has(extension)
    ? ""
    : tr("«{name}» — не звуковой файл. Подойдут wav, ogg, mp3 и flac.").replace("{name}", file.name);
}

export const dropCaption = (title) =>
  tr("Отпустите — звук встанет на «{title}»").replace("{title}", title);

// Несёт ли событие файлы: тип «Files» в types или непустой files.
const carriesFiles = ({ dataTransfer }) =>
  Boolean(dataTransfer) &&
  (Array.from(dataTransfer.types ?? []).includes("Files") || Boolean(dataTransfer.files?.length));

// undefined — событие вне студии; null — сюда класть нельзя; строка — ключ цели.
function targetKeyOf(anchor, eventTarget, fallbackKey) {
  if (!anchor) return undefined;
  const shell = anchor.closest(DOM.shell) || anchor;
  const element = eventTarget?.nodeType === DOM.textNode ? eventTarget.parentNode : eventTarget;
  const inside = Boolean(element) && typeof element.nodeType === "number" && shell.contains(element);
  if (!inside) return undefined;
  const holder = element.closest?.(`[${DOM.keyAttribute}]`);
  const owned = holder && shell.contains(holder);
  return (owned ? holder.getAttribute(DOM.keyAttribute) : fallbackKey) || null;
}

// Слушатели документа; глубину вложенности хранит вызывающий, чтобы она переживала переподписку.
class DropWatcher {
  constructor({ anchorRef, depth, latest, setArmed, setDropKey }) {
    this.anchorRef = anchorRef;
    this.depth = depth;
    this.latest = latest;
    this.setArmed = setArmed;
    this.setDropKey = setDropKey;
  }

  keyFor(event) {
    return targetKeyOf(this.anchorRef.current, event.target, this.latest.current.fallbackKey);
  }

  calm() {
    this.depth.current = 0;
    this.setArmed(false);
    this.setDropKey(null);
  }

  listeners() {
    return {
      dragenter: (event) => {
        if (!carriesFiles(event)) return;
        this.depth.current += 1;
        this.setArmed(true);
      },
      dragleave: (event) => {
        if (!carriesFiles(event)) return;
        this.depth.current = Math.max(0, this.depth.current - 1);
        if (!this.depth.current) this.calm();
      },
      dragover: (event) => {
        if (!carriesFiles(event)) return;
        const key = this.keyFor(event);
        if (key === undefined) return this.setDropKey(null);
        event.preventDefault();
        event.dataTransfer.dropEffect = typeof key === "string" ? "copy" : "none";
        this.setDropKey(key);
      },
      drop: (event) => {
        const key = this.keyFor(event);
        this.calm();
        if (key === undefined || !carriesFiles(event)) return;
        event.preventDefault();
        if (typeof key === "string") this.latest.current.onDrop?.(key, event.dataTransfer);
      },
      dragend: () => this.calm(),
    };
  }
}

export function useSoundDrop(anchorRef, { fallbackKey = null, onDrop }) {
  const [armed, setArmed] = useState(false);
  const [dropKey, setDropKey] = useState(null);
  const depth = useRef(0);
  const latest = useRef({ fallbackKey, onDrop });

  useEffect(() => {
    latest.current = { fallbackKey, onDrop };
  });

  useEffect(() => {
    const watcher = new DropWatcher({ anchorRef, depth, latest, setArmed, setDropKey });
    const pairs = Object.entries(watcher.listeners());
    pairs.forEach(([type, listener]) => document.addEventListener(type, listener));
    return () => pairs.forEach(([type, listener]) => document.removeEventListener(type, listener));
  }, [anchorRef]);

  return { armed, dropKey };
}
