import { tr } from "../../../../locales/ui.js";
import { createSticker } from "@modovik/gun-studio";
import * as detach from "./gun-detach.js";
import { decalBasis } from "./gun-decals.js";
import { maskKey } from "./gun-canvas.js";
import * as copy from "./gun-copy.js";
import * as uv from "./gun-uv.js";
import { strokeWasEmpty } from "./item-empty-hint.js";
import * as THREE from "three";
import { useEffect, useRef } from "react";
import { markWheel } from "../../../ui/wheel-mark.js";

// Указатель над стволом: один набор обработчиков на холсте обслуживает все инструменты.
// Состояние (мазок, перетаскивание, показанные подсказки) живёт в одном объекте-сеансе
// между отрисовками, а не в состоянии React: хук не вызывает перерисовок.

export function useGunPointer({ scene, ...rest }) {
  const props = { scene, ...rest };
  const holder = useRef(null);
  if (holder.current === null) holder.current = new PointerSession();
  const session = holder.current;
  session.props = props;

  useWheelGrip(session, props);
  useHandReset(props);
  useForgetNotices(session, props.loading);

  const release = () => {
    session.release();
  };
  return {
    onPointerDown: (event) => {
      session.press(event);
    },
    onPointerMove: (event) => {
      session.move(event);
    },
    onPointerUp: release,
    onPointerCancel: release,
    onPointerLeave: () => {
      session.leave();
    },
  };
}

// Какая наклейка лежит под точкой модели: обход с конца, верхняя наклейка — последняя.
export function stickerUnder(stickers, point, normal, modelLength, artworkOf) {
  const facing = vectorOf(normal);
  const spot = vectorOf(point);
  for (let rest = stickers.length; rest > 0; ) {
    const sticker = stickers[--rest];
    if (liesUnder(sticker, spot, facing, modelLength, artworkOf)) return sticker;
  }
  return null;
}

function liesUnder(sticker, spot, facing, modelLength, artworkOf) {
  if (sticker.visible === false) return false;
  const axes = decalBasis(sticker.normal, sticker.rotation);
  if (facing.dot(axes.normal) < MIN_FACING) return false;

  const art = artworkOf(sticker);
  const ratio = art && art.width ? art.height / art.width : 1;
  const wide = ((sticker.size / 100) * modelLength) / 2;
  const offset = spot.clone().sub(vectorOf(sticker.anchor));
  return covers(axes, offset, wide, wide * ratio);
}

function vectorOf(p) {
  return new THREE.Vector3(p.x, p.y, p.z);
}

// Точка внутри плиты наклейки: по ширине, по высоте и вглубь не дальше большей из половин.
function covers(axes, offset, wide, tall) {
  const slabs = [
    [axes.tangent, wide],
    [axes.bitangent, tall],
    [axes.normal, Math.max(wide, tall)],
  ];
  return slabs.every(([axis, limit]) => Math.abs(offset.dot(axis)) <= limit);
}

// Колесо при наклейке в руке: вращает её, с Shift меняет размер. Чтобы сцена не приближала
// кадр заодно, зум на это время выключен, а при снятии подписки возвращается.
function useWheelGrip(session, props) {
  const { tool, armed, canvasRef, scene, onArmedPose, surfaces } = props;
  useEffect(() => {
    const canvas = canvasRef.current;
    const holding = tool === "sticker" && Boolean(armed);
    scene.current?.setZoomEnabled?.(!holding);
    if (!canvas || !holding) return undefined;

    const listener = (event) => session.spin(event);
    canvas.addEventListener("wheel", listener, { passive: false });
    /* Колесо над кадром, пока наклейка в руке, — её поворот, а не прокрутка страницы: метка для правила `scroll`. */
    const unmarkWheel = markWheel(canvas);
    return () => {
      canvas.removeEventListener("wheel", listener);
      unmarkWheel();
      // Зум возвращаем сцене, которая стоит к моменту снятия, а не той, что была при подписке.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      scene.current?.setZoomEnabled?.(true);
    };
  }, [session, tool, armed, canvasRef, scene, onArmedPose, surfaces]);
}

// Пока наклейки нет в руке или инструмент другой, предпросмотра на модели быть не должно.
function useHandReset({ scene, armed, tool }) {
  useEffect(() => {
    const handed = Boolean(armed) && tool === "sticker";
    if (!handed) scene.current?.previewSticker?.(null);
  }, [armed, tool, scene]);
}

function useForgetNotices(session, loading) {
  useEffect(() => {
    if (loading) session.forgetNotices();
  }, [session, loading]);
}

// След одного мазка на одной детали: прежняя точка и обрезка по острову.
class Trail {
  constructor(material, layer, strokeId, look) {
    this.material = material;
    this.layer = layer;
    this.strokeId = strokeId;
    // инструмент и цвет заданы только у маски; иначе берутся текущие на каждом отрезке
    this.tool = look.tool;
    this.colour = look.colour;
    this.last = null;
    this.clip = null;
    // Задела ли кисть вещь (а не только закрытую кожу листа): пока нет — мазок «пустой» (подсказка полосы `ItemOnlyBar`).
    this.touchedItem = false;
  }

  // зеркальный след делит с главным номер мазка и вид
  twin(material, layer) {
    return new Trail(material, layer, this.strokeId, this);
  }
}

class PointerSession {
  props = null;
  stroke = null; // { lead, twin } пока идёт мазок
  drag = null; // { sticker, moved } пока наклейку тащат
  spillMemory = new Map(); // id наклейки -> доля, о которой уже сказали
  told = { crowded: new Set(), repeats: new Set() }; // детали, о которых уже сказали

  get stage() {
    return this.props.scene.current;
  }

  forgetNotices() {
    this.told.crowded.clear();
    this.told.repeats.clear();
  }

  // ---- нажатие ----

  press(event) {
    const { tool, loading } = this.props;
    if (event.button !== 0 || loading || tool === "orbit") return;
    const hit = this.stage?.pickSurface(event.clientX, event.clientY) ?? null;
    if (this.props.markItem) {
      this.pressMark(event, hit);
      return;
    }
    switch (tool) {
      case "brush":
      case "eraser":
      case "clear":
      case "fill":
        this.pressPaint(event, hit);
        break;
      case "picker":
        this.pressPicker(hit);
        break;
      case "sticker":
        this.pressSticker(event, hit);
        break;
      default:
        break;
    }
  }

  // Режим «Красить только здесь»: щелчок не красит, а отмечает часть вещи под курсором (сетка целиком или остров, `item-mask.js`).
  pressMark(event, hit) {
    if (!hit) return;
    const { surfaces } = this.props;
    const key = surfaces.itemPartAt(hit);
    if (!key) return;
    event.preventDefault();
    surfaces.toggleItemPart(hit.material, key);
  }

  pressPaint(event, hit) {
    if (!hit) return;
    event.preventDefault();
    const { maskEdit, tool, surfaces, onNotice } = this.props;
    const { setActiveMaterial, ensurePaintLayer } = this.props;
    if (maskEdit && maskEdit.material !== hit.material) {
      onNotice?.(tr("Маска у слоя другой детали — веди по ней"));
      return;
    }
    setActiveMaterial(hit.material);
    const layer = maskEdit ? maskKey(maskEdit.layerId) : ensurePaintLayer(hit.material);
    const surface = surfaces.surfaceOf(hit.material);
    if (!surface) return;

    if (tool === "fill") this.floodLayer(surface, layer, hit.material);
    else this.beginStroke(event, hit, layer);
  }

  floodLayer(surface, layer, material) {
    const { maskEdit, toolState, surfaces } = this.props;
    let label = `fill:${layer}`;
    if (maskEdit) {
      label = `mask:${layer}`;
      if (maskEdit.mode === "hide") surface.clearLayer(layer);
      else surface.fillLayer(layer, MASK_WHITE);
    } else {
      surface.fillLayer(layer, toolState.colour);
      // Заливка закрытого листа (вещь не отмечена) ничего не красит: та же подсказка, что у пустого мазка.
      if (surfaces.itemMaskOf?.(material)?.state === "closed") surfaces.noteEmptyStroke?.();
    }
    surfaces.renderMaterial(material);
    surfaces.commitRaster(material, layer, label);
  }

  pressPicker(hit) {
    if (!hit) return;
    const { surfaces, onToolState, onNotice } = this.props;
    const colour = surfaces.surfaceOf(hit.material)?.pick(hit.u, hit.v);
    if (!colour) return;
    onToolState({ colour });
    onNotice?.(copy.fill(tr("Взят цвет {colour}"), { colour }));
  }

  pressSticker(event, hit) {
    const { armed, project, modelLength, surfaces } = this.props;
    const { onSelectSticker, onPlaceSticker, onCreateText } = this.props;
    if (!hit) {
      if (!armed) onSelectSticker("");
      return;
    }
    event.preventDefault();

    if (armed) {
      const draft = this.draftAt(hit);
      onPlaceSticker(draft, { keepInHand: event.shiftKey });
      this.measureSpill(draft);
      return;
    }
    const found = stickerUnder(
      project.stickers ?? [],
      hit.point,
      hit.normal,
      modelLength,
      surfaces.stickerImage,
    );
    if (found) this.grab(event, found);
    else if (!(onCreateText && onCreateText(hit))) onSelectSticker("");
  }

  // ---- мазок ----

  beginStroke(event, hit, layer) {
    const { maskEdit } = this.props;
    this.stage?.setControlsEnabled(false);
    this.capture(event);

    const look = maskEdit
      ? { tool: maskEdit.mode === "hide" ? "eraser" : "brush", colour: MASK_WHITE }
      : {};
    const lead = new Trail(hit.material, layer, freshStrokeId(), look);
    this.stroke = { lead, twin: this.twinFor(hit, lead) };
    this.advance(hit);
  }

  capture(event) {
    const canvas = this.props.canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // захват не обязателен: без него мазок всё равно идёт
    }
  }

  // Зеркальная точка для попадания, либо null, если зеркала нет или оно совпало с главной.
  mirrorOf(hit) {
    const mirrored = this.stage?.pickMirror?.(hit);
    if (!mirrored) return null;
    const sameSpot =
      mirrored.material === hit.material &&
      Math.abs(mirrored.u - hit.u) < SEAM_GAP &&
      Math.abs(mirrored.v - hit.v) < SEAM_GAP;
    return sameSpot ? null : mirrored;
  }

  twinFor(hit, lead) {
    const { toolState, maskEdit, ensurePaintLayer } = this.props;
    if (!toolState.mirror) return null;
    const mirrored = this.mirrorOf(hit);
    if (!mirrored) return null;
    if (maskEdit && maskEdit.material !== mirrored.material) return null;
    const sameMaterial = mirrored.material === lead.material;
    const layer = sameMaterial ? lead.layer : ensurePaintLayer(mirrored.material);
    return lead.twin(mirrored.material, layer);
  }

  // Новое попадание: отрезок главного следа, затем зеркального.
  advance(hit) {
    const { lead, twin } = this.stroke;
    this.lay(lead, hit);
    if (!twin || !this.props.toolState.mirror) return;
    const mirrored = this.mirrorOf(hit);
    if (mirrored) this.lay(twin, mirrored);
  }

  lay(trail, hit) {
    if (hit.material !== trail.material) return;
    const { surfaces, tool, toolState } = this.props;
    const surface = surfaces.surfaceOf(trail.material);
    if (!surface) return;

    let to = hit;
    let resumed = uv.continuesStroke(trail.last, hit);
    if (!resumed) {
      const reach = detach.detachReach(toolState.size);
      to = surfaces.detachUnder?.(hit, { reach }) ?? hit;
      this.warnAbout(to);
      resumed = uv.continuesStroke(trail.last, to);
      if (!resumed) trail.clip = this.stage?.islandClip?.(to) ?? null;
    }

    surface.stroke(trail.layer, {
      from: resumed ? trail.last : null,
      to,
      clip: trail.clip,
      tool: trail.tool ?? tool,
      colour: trail.colour ?? toolState.colour,
      size: toolState.size,
      opacity: toolState.opacity,
      hardness: toolState.hardness,
      strokeId: trail.strokeId,
    });
    if (!trail.touchedItem && !this.props.maskEdit && (surface.itemInk?.(to.u, to.v, (toolState.size || 0) / 100) ?? true)) trail.touchedItem = true;
    surfaces.renderMaterial(trail.material);
    trail.last = to;
  }

  // Подсказки про общий кусок текстуры: по одной на деталь, «тесно» главнее «повтора».
  warnAbout(spot) {
    const { crowded, repeats } = this.told;
    const { onNotice } = this.props;
    const { material } = spot;
    if (spot.crowded) {
      if (crowded.has(material)) return;
      crowded.add(material);
      onNotice?.(
        tr(
          "Этот кусок текстуры лежит и на других местах ствола, а отделить его больше некуда — мазок ляжет и туда, в игре будет так же.",
        ),
      );
      return;
    }
    if (!spot.repeats || repeats.has(material)) return;
    repeats.add(material);
    onNotice?.(
      tr(
        "Здесь у детали повторяющаяся текстура — мазок повторится везде, где она лежит. Ровный цвет — «Заливкой», рисунок в одном месте — наклейкой.",
      ),
    );
  }

  commitStroke({ lead, twin }) {
    const { surfaces } = this.props;
    const label = `stroke:${Date.now()}`;
    surfaces.commitRaster(lead.material, lead.layer, label);
    if (twin && (twin.material !== lead.material || twin.layer !== lead.layer)) {
      surfaces.commitRaster(twin.material, twin.layer, label);
    }
    for (const trail of [lead, twin]) {
      if (trail) surfaces.surfaceOf(trail.material)?.endStroke?.(trail.layer);
    }
    // Мазок целиком пришёлся на закрытое (кожа листа вещи): ничего не закрасил — первый такой на вещь включает подсказку «Поправить отметку».
    if (strokeWasEmpty({ maskEdit: this.props.maskEdit, trails: [lead, twin] })) surfaces.noteEmptyStroke?.();
  }

  // ---- наклейка ----

  // Черновик наклейки из руки в точке попадания.
  draftAt(hit) {
    const { armed, armedPose } = this.props;
    const draft = createSticker({
      source: armed.source,
      text: armed.text,
      font: armed.font,
      fontAsset: armed.fontAsset,
      fontName: armed.fontName,
      tint: armed.tint,
      name: armed.name,
      anchor: hit.point,
      normal: hit.normal,
      size: armedPose.size,
      rotation: armedPose.rotation,
    });
    draft.id = HAND_ID;
    return draft;
  }

  grab(event, sticker) {
    const { surfaces, onSelectSticker } = this.props;
    onSelectSticker(sticker.id);
    this.drag = { sticker, moved: null };
    surfaces.setDragging(sticker.id);
    this.stage?.setControlsEnabled(false);
    this.capture(event);
    surfaces.artworkFor(sticker).then((art) => {
      if (this.drag?.sticker === sticker) this.stage?.previewSticker(sticker, art);
    });
  }

  dragTo(event) {
    const hit = this.stage?.pickSurface(event.clientX, event.clientY);
    if (!hit) return;
    const { drag } = this;
    const moved = { ...drag.sticker, anchor: hit.point, normal: hit.normal };
    drag.moved = moved;
    this.props.surfaces.artworkFor(moved).then((art) => {
      if (this.drag?.moved === moved) this.stage?.previewSticker(moved, art);
    });
  }

  settleDrag({ moved }) {
    const { surfaces, onMoveSticker } = this.props;
    const clearProjection = () => {
      surfaces.setDragging("");
      this.stage?.previewSticker(null);
    };
    if (!moved) {
      clearProjection();
      return;
    }
    surfaces.bakeNow(moved).then(clearProjection);
    onMoveSticker(moved.id, { anchor: moved.anchor, normal: moved.normal });
    this.measureSpill(moved);
  }

  // Наклейка в руке следует за курсором: проекция на модели по лучу из точки экрана.
  previewInHand(clientX, clientY) {
    const stage = this.stage;
    const hit = stage?.pickSurface(clientX, clientY);
    if (!hit) {
      stage?.previewSticker(null);
      return;
    }
    const draft = this.draftAt(hit);
    this.props.surfaces.artworkFor(draft).then((art) => {
      const hand = this.props.armed;
      const sameHand =
        Boolean(hand) && (hand.source ?? null) === draft.source && (hand.text ?? "") === draft.text;
      if (sameHand) this.stage?.previewSticker(draft, art);
    });
  }

  // Доля наклейки, легшая на чужие места листа; любой сбой здесь молчаливый.
  measureSpill(sticker) {
    try {
      this.props.surfaces
        .artworkFor(sticker)
        .then((art) => this.reportSpill(sticker, this.stage?.stickerSpill?.(sticker, art)))
        .catch(() => {});
    } catch {
      // замер необязателен
    }
  }

  reportSpill(sticker, report) {
    if (!report) return;
    const painted = Number(report.painted);
    if (painted < SPILL_MIN_CELLS) return;

    const shared = Number(report.shared);
    const share = shared / painted;
    const verdict = spillVerdict(share, this.spillMemory.get(sticker.id));
    if (verdict === "forget") this.spillMemory.delete(sticker.id);
    if (verdict !== "say") return;

    this.spillMemory.set(sticker.id, share);
    const percent = Math.round((shared * 100) / (painted * SPILL_STEP)) * SPILL_STEP;
    this.props.onNotice?.(
      copy.fill(
        tr(
          "Около {percent} % наклейки ляжет и на другие места ствола: у модели там один кусок текстуры на несколько деталей, в игре будет так же. Сдвинь наклейку на ровное место без повторов.",
        ),
        { percent: String(percent) },
      ),
    );
  }

  // ---- движение, отпускание, уход ----

  move(event) {
    if (this.drag) {
      this.dragTo(event);
      return;
    }
    if (this.stroke) {
      const hit = this.stage?.pickSurface(event.clientX, event.clientY);
      if (hit) this.advance(hit);
      return;
    }
    const { tool, armed } = this.props;
    if (tool === "sticker" && armed) this.previewInHand(event.clientX, event.clientY);
  }

  release() {
    this.stage?.setControlsEnabled(true);
    const { stroke, drag } = this;
    this.stroke = null;
    this.drag = null;
    if (stroke) this.commitStroke(stroke);
    if (drag) this.settleDrag(drag);
  }

  leave() {
    const { tool, armed } = this.props;
    if (tool === "sticker" && armed && !this.drag) this.stage?.previewSticker(null);
  }

  // Колесо: знак вертикальной прокрутки, а при нулевой — горизонтальной.
  spin(event) {
    event.preventDefault();
    const direction = Math.sign(event.deltaY) || Math.sign(event.deltaX);
    if (!direction) return;

    const { armedPose, onArmedPose } = this.props;
    if (event.shiftKey) {
      const grown = armedPose.size - direction * WHEEL_SIZE_STEP;
      onArmedPose({ size: Math.min(WHEEL_SIZE_MAX, Math.max(WHEEL_SIZE_MIN, grown)) });
    } else {
      onArmedPose({ rotation: wrapDegrees(armedPose.rotation - direction * WHEEL_TURN_STEP) });
    }
    this.previewInHand(event.clientX, event.clientY);
  }
}

// Что делать с новой долей: забыть прежнюю, промолчать или сказать.
function spillVerdict(share, before) {
  if (share < SPILL_FLOOR) return "forget";
  const settled = before !== undefined && Math.abs(share - before) < SPILL_DRIFT;
  return settled ? "quiet" : "say";
}

function wrapDegrees(angle) {
  if (angle > 180) return angle - 360;
  if (angle < -180) return angle + 360;
  return angle;
}

function freshStrokeId() {
  const noise = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${Date.now()}-${noise}`;
}

const HAND_ID = "sticker-in-hand";
const MASK_WHITE = "#ffffff";
const MIN_FACING = 0.1; // нормаль поверхности против нормали наклейки
const SEAM_GAP = 0.004; // зеркальная точка ближе этого к главной — зеркала нет
const SPILL_MIN_CELLS = 24;
const SPILL_FLOOR = 0.2;
const SPILL_DRIFT = 0.1;
const SPILL_STEP = 5;
const WHEEL_TURN_STEP = 15;
const WHEEL_SIZE_STEP = 2;
const WHEEL_SIZE_MIN = 2;
const WHEEL_SIZE_MAX = 100;
