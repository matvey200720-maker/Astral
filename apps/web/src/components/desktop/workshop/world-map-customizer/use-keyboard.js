// Клавиши окна: команды карты, Esc, Enter, толщина ластика, Delete.
// Обработчик переставляется на каждой отрисовке — он читает свежее состояние.
import { useEffect, useState } from "react";
import { normalizeWorldMap, patchMajesticMark } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import { moveObject, moveObjects } from "../world-map-editing.js";
import { mapCommand } from "../world-map-shortcuts.js";
import { hideMeshLabel } from "../world-map/mesh-label-editing.js";
import { isFieldTarget, windowIsOpen } from "./dom-guards.js";
import { arrowDelta, nudgeStep } from "./frame-math.js";
import { clampEraser } from "./map-helpers.js";

const SET_TOOLS = new Set(["labels", "areas", "layers"]);
const SMALLER = new Set(["[", "х"]);
const LARGER = new Set(["]", "ъ"]);

export function useKeyboard(k) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Команды, которые берут клавишу без выбранного объекта
  const globalCommands = {
    shortcuts: () => setShortcutsOpen(true),
    find: () => k.setFindRequest(Date.now()),
    "zoom-fit": () => k.setZoomCommand({ type: "fit", stamp: Date.now() }),
  };

  // Команды над главным выбранным объектом
  const objectCommands = {
    rename: () => k.requestRename(k.selection),
    duplicate: () => k.duplicateSelected(),
    "toggle-hidden": () => k.toggleHidden(k.selection),
    "toggle-locked": () => k.toggleLocked(k.selection),
    "zoom-selection": () => k.flyTo(k.selection),
    nudge: (event) => nudgeSelected(k, event),
  };

  const runCommand = (event) => {
    const command = mapCommand(event);
    if (!command || command === "paste") return false;
    const global = globalCommands[command];
    if (global) {
      global();
    } else if (command === "group" || command === "ungroup") {
      if (!k.picked.length) return false;
      if (command === "group") k.groupPicked();
      else k.ungroupPicked();
    } else if (command === "forward" || command === "backward") {
      if (!k.selection) return false;
      k.stepSelected(command === "forward");
    } else if (command === "copy") {
      if (!k.selection || !k.selected) return false;
      k.copySelected();
      return true;
    } else {
      if (!k.selection || !k.selected) return false;
      objectCommands[command](event);
    }
    event.preventDefault();
    return true;
  };

  const onEscape = () => {
    if (k.draft.length) k.setDraft([]);
    else if (k.meshPick) k.setMeshPick(null);
    else if (k.majesticPick && k.tool === "majestic") k.setMajesticPick(null);
    else if (k.picked.length && SET_TOOLS.has(k.tool)) k.setPicked([]);
    else if (k.tool !== "select") k.chooseTool("select");
    else k.setPicked([]);
  };

  const onEnter = (event) => {
    if (k.tool === "zones" && k.draft.length) return k.closeDraft();
    if (!k.selection) return undefined;
    event.preventDefault();
    const written = k.selection.kind === "emblem" && k.selected?.kind === "text";
    return written ? k.editEmblem(k.selection) : k.requestRename(k.selection);
  };

  const onDelete = (event) => {
    if (k.meshPick && !k.picked.length && k.tool === "labels") {
      event.preventDefault();
      const key = `mesh.hide.${k.meshPick.key}`;
      k.apply(hideMeshLabel(k.config, k.meshPick), tr("Подпись спрятана"), key);
    } else if (k.majesticPick && k.tool === "majestic") {
      event.preventDefault();
      const hidden = patchMajesticMark(k.config.majestic, k.majesticPick.key, { hidden: true });
      const next = normalizeWorldMap({ ...k.config, majestic: hidden });
      k.apply(next, tr("Метка спрятана"), `majestic.mark.${k.majesticPick.key}`);
    } else if (k.picked.length) {
      event.preventDefault();
      k.removeTargets();
    }
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isFieldTarget(event.target)) return;
      if (k.printing) {
        if (event.key === "Escape") {
          event.preventDefault();
          k.finishPrint();
        }
        return;
      }
      if (windowIsOpen() || runCommand(event)) return;
      const key = event.key;
      if (key === "Escape") onEscape();
      else if (key === "Enter") onEnter(event);
      else if (k.tool === "eraser" && (SMALLER.has(key.toLowerCase()) || LARGER.has(key.toLowerCase()))) {
        const factor = SMALLER.has(key.toLowerCase()) ? 1 / 1.25 : 1.25;
        k.setEraserSize(clampEraser(Math.round(k.eraserSize * factor)));
      } else if (key === "Delete" || key === "Backspace") onDelete(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return { shortcutsOpen, setShortcutsOpen };
}

// Сдвиг стрелками: закреплённый не двигается, но клавишу берёт
function nudgeSelected(k, event) {
  if (k.selected.locked) return;
  const step = nudgeStep(k.viewRef.current, k.sceneSize, k.atlas, event.shiftKey);
  const delta = arrowDelta(event.key, step);
  if (!delta) return;
  const many = k.picked.length > 1;
  const next = many ? moveObjects(k.config, k.picked, delta) : moveObject(k.config, k.selection, delta);
  k.apply(next, many ? tr("Объекты сдвинуты") : tr("Объект сдвинут"), `nudge.${k.selection.id}`);
}

