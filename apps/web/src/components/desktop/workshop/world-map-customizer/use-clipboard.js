// Копирование и вставка объектов карты через события окна copy и paste.
import { useRef, useCallback, useEffect } from "react";
import { tr } from "../../../../locales/ui.js";
import { pasteObject } from "../world-map-editing.js";
import { MOD } from "../world-map-shortcuts.js";
import { mapText } from "../world-map/map-copy.js";
import { isEditableTarget, windowIsOpen } from "./dom-guards.js";
import { frameCentre } from "./frame-math.js";
import { isPictureFile } from "./picture-helpers.js";
import { CLIPBOARD_MARK } from "./panel-data.js";

// Буфер панели: объект, метка-время и признак «ждёт события copy»
class PanelClipboard {
  entry = null;

  remember(kind, object) {
    this.entry = { kind, object, mark: String(Date.now()), waiting: true };
  }

  // Событие copy: кладём в системный буфер имя и метку один раз
  handOut(transfer) {
    const held = this.entry;
    if (!(held?.waiting && transfer)) return false;
    held.waiting = false;
    transfer.setData("text/plain", held.object.name || tr("Объект карты"));
    transfer.setData(CLIPBOARD_MARK, held.mark);
    return true;
  }

  // В системном буфере лежит наша метка
  owns(transfer) {
    return Boolean(this.entry && transfer && transfer.getData(CLIPBOARD_MARK) === this.entry.mark);
  }
}

const imageFrom = (transfer) => Array.from(transfer.files || []).find(isPictureFile) || null;

const keepsKeyboard = (event) => isEditableTarget(event.target) || windowIsOpen();

export function useClipboard(deps) {
  const { selection, selected, notify } = deps;
  const buffer = useRef(null);
  buffer.current ??= new PanelClipboard();

  // Ctrl+C: запоминаем объект; системный буфер заполнит следом событие copy
  const copySelected = useCallback(() => {
    buffer.current.remember(selection.kind, selected);
    notify(mapText("Скопировано — {mod}+V вставит в середину кадра", { mod: MOD }));
  }, [selection, selected, notify]);

  useEffect(() => {
    const { config, apply, setPicked, viewRef, sceneSize, atlas, addPicture } = deps;
    const held = buffer.current;
    const events = {
      copy: (event) => {
        if (keepsKeyboard(event)) return;
        if (held.handOut(event.clipboardData)) event.preventDefault();
      },
      paste: (event) => {
        if (keepsKeyboard(event)) return;
        const transfer = event.clipboardData;
        const picture = !held.owns(transfer) && transfer ? imageFrom(transfer) : null;
        if (picture) {
          event.preventDefault();
          addPicture(picture);
          return;
        }
        if (!held.entry?.object) return;
        const at = frameCentre(viewRef.current, sceneSize, atlas);
        const { kind, object } = held.entry;
        const pasted = pasteObject(config, { kind, object }, at);
        if (!pasted.selection) return;
        apply(pasted.config, tr("Вставлено"));
        setPicked([pasted.selection]);
        event.preventDefault();
      },
    };
    const pairs = Object.entries(events);
    pairs.forEach(([name, listener]) => window.addEventListener(name, listener));
    return () => pairs.forEach(([name, listener]) => window.removeEventListener(name, listener));
  });

  return { copySelected };
}
