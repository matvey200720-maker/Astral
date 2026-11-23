// Наведение: объект под курсором, подсказка, подсветка подписей донора и меток Majestic,
// сброс при смене инструмента, файлы, брошенные на карту.
import { useEffect, useReducer, useState } from "react";
import { tooltipPlace } from "../world-map-frame.js";
import { closesDraft } from "../world-map-editing.js";
import { majesticHitAt, meshHitAt } from "./donor-hits.js";
import { HOVER_TOOLS } from "./numbers.js";
import { hitByTool, cursorAt, layerOfTool } from "./select-rules.js";
import { applyPatch } from "./use-pointer-state.js";

const freshKeys = () => ({ hit: "", mesh: "", majestic: "" });
const emptyTip = () => ({ node: null, size: { width: 0, height: 0 } });
const NOTHING_HOVERED = { hover: null, meshHover: null, majesticHover: null, dropping: false };

const hitKey = (hit) => (hit ? `${hit.kind}:${hit.id}:${hit.part ?? ""}` : "");
const markKey = (mark) =>
  mark ? String(mark.key ?? `${mark.kind}:${mark.id}:${mark.index ?? ""}`) : "";

// Подсказка едет за мышью прямо по узлу, без перерисовки редактора
export function moveTooltip(tip, left, top, win) {
  const { node, size } = tip;
  if (!node) return;
  const place = tooltipPlace(left, top, win, size);
  node.style.transform = `translate(${place.x}px, ${place.y}px)`;
}

// Всё, что наведение держит вне состояния: ключи последних попаданий и узел подсказки
class HoverDesk {
  keys = freshKeys();
  tip = emptyTip();

  constructor(put) {
    this.put = put;
  }

  // Запись в состояние только если ключ слота сменился; true - смена была
  #moved(slot, key, patch) {
    if (this.keys[slot] === key) return false;
    this.keys[slot] = key;
    this.put(patch);
    return true;
  }

  forgetHit() {
    this.keys.hit = "";
  }

  reset = () => {
    this.keys = freshKeys();
    this.put({ hover: null, meshHover: null, majesticHover: null });
  };

  // Свободная фигура «Зон»: линия тянется за курсором, пока есть черновик
  #aimAt(env, world) {
    const { draft } = env;
    const aim = draft?.length > 0 ? { world, closing: closesDraft(draft, world, env.closeTolerance) } : null;
    env.setAim(aim);
  }

  #markAt(env, world) {
    const mark = majesticHitAt(env, world);
    this.#moved("majestic", markKey(mark), { majesticHover: mark });
  }

  // Объект под курсором, подсказка рядом с ним и (у «Подписей») подпись донора
  #objectAt(env, spot, event) {
    const { point, world } = spot;
    const hit = hitByTool(env, world, point);
    const box = (env.stageRef.current ?? event.currentTarget).getBoundingClientRect();
    const left = event.clientX - box.left;
    const top = event.clientY - box.top;
    const changed = this.#moved("hit", hitKey(hit), { hover: hit ? { hit, left, top } : null });
    if (hit && !changed) moveTooltip(this.tip, left, top, env.win);
    if (env.tool !== "labels") return;
    const found = hit ? null : meshHitAt(env, world);
    this.#moved("mesh", found ? `${found.item.id}|${found.key}` : "", { meshHover: found });
  }

  // Движение без нажатой кнопки
  track = (env, event) => {
    const spot = { point: env.sceneAt(event.clientX, event.clientY) };
    spot.world = env.toWorld(spot.point);
    if (env.tool === "zones" && env.shape === "free") {
      this.#aimAt(env, spot.world);
      return;
    }
    env.setCursor(cursorAt(env, spot.world, spot.point));
    if (env.tool === "majestic") this.#markAt(env, spot.world);
    else if (HOVER_TOOLS.has(env.tool)) this.#objectAt(env, spot, event);
  };
}

// Файлы над картой; работают только при onDropFiles
class FileDrop {
  constructor(put, enabled) {
    this.put = put;
    this.enabled = enabled;
  }

  over = (event) => {
    if (!this.enabled) return;
    const kinds = Array.from(event.dataTransfer?.types ?? []);
    if (!kinds.includes("Files")) return;
    event.preventDefault();
    this.put({ dropping: true });
  };

  leave = (event) => {
    if (!this.enabled) return;
    const into = event.relatedTarget;
    const inside = Boolean(into) && event.currentTarget.contains(into);
    if (!inside) this.put({ dropping: false });
  };

  drop = (event, env) => {
    if (!this.enabled) return;
    event.preventDefault();
    this.put({ dropping: false });
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    env.onDropFiles(files, env.worldAt(event.clientX, event.clientY));
  };
}

export function useStageHover(options) {
  const { tool, shape, draft, setAim, setStretch, hideRing, dropEnabled } = options;
  const [shown, put] = useReducer(applyPatch, NOTHING_HOVERED);
  const [desk] = useState(() => new HoverDesk(put));

  // Смена инструмента, слоя попадания или фигуры сбрасывает наведение, кольцо, линию и растяжку
  const layer = layerOfTool(tool);
  const rewind = () => {
    desk.forgetHit();
    put({ hover: null });
    hideRing();
    [setAim, setStretch].forEach((setter) => setter(null));
  };
  useEffect(rewind, [tool, layer, shape, desk, hideRing, setAim, setStretch]);

  // Линия за курсором живёт, пока есть черновик зоны
  const drafted = (draft?.length ?? 0) > 0;
  const dropAim = () => {
    if (!drafted) setAim(null);
  };
  useEffect(dropAim, [drafted, setAim]);

  const files = new FileDrop(put, dropEnabled);
  return {
    ...shown,
    tip: desk.tip,
    reset: desk.reset,
    track: desk.track,
    dropHandlers: { onDragOver: files.over, onDragLeave: files.leave, onDrop: files.drop },
  };
}
