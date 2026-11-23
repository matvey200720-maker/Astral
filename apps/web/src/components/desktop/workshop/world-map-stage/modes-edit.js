// Режимы, которые правят проект: перенос объектов, вершины зоны, ручки фигуры и надписи,
// перенос подписи зоны. Каждый режим - { move, up? }; правки уходят в `env.change`.
import { sceneLabelOf } from "@modovik/vector-map";
import {
  emblemBox,
  emblemRotationFromPointer,
  emblemWidthFromPointer,
  findObject,
  hitEmblemHandle,
  hitZoneEdge,
  hitZoneVertex,
  insertZoneVertex,
  moveObject,
  moveObjects,
  moveZoneVertex,
  patchObject,
  resizeZoneShape,
  rotationFromDrag,
  zoneBoxFromCorner,
} from "../world-map-editing.js";
import { DOUBLE_PRESS_MS, POINTS } from "./numbers.js";
import { dragTargets, handlesOf, handleFrameOf } from "./select-rules.js";
import { tr } from "../../../../locales/ui.js";

const sameTarget = (a, b) => ["kind", "id"].every((field) => a[field] === b[field]);
const targetOf = ({ kind, id }) => ({ kind, id });
const worldOf = (env, { clientX, clientY }) => env.worldAt(clientX, clientY);
const sceneOf = (env, { clientX, clientY }) => env.sceneAt(clientX, clientY);

// Взять режим в руку: он живёт в ссылке, класс is-dragging - в состоянии
function grab(env, mode) {
  env.dragRef.current = mode;
  env.setDragging(true);
  return true;
}

// ——— шаги движения ———

// Одна правка на движение: title() - подпись шага (через tr), key(mode) - ключ склейки,
// build(mode, env, event) собирает новый проект
class EditStep {
  constructor({ title, key, build }) {
    Object.assign(this, { title, key, build });
  }

  move(mode, env, event) {
    const next = this.build(mode, env, event);
    env.change(next, this.title(), this.key(mode));
  }
}

// Сдвиг мира от прошлой точки; нулевой сдвиг правки не даёт, build получает { x, y } сдвига
class DragStep extends EditStep {
  move(mode, env, event) {
    const at = worldOf(env, event);
    const dx = at.x - mode.last.x;
    const dy = at.y - mode.last.y;
    if (dx === 0 && dy === 0) return;
    env.change(this.build(mode, env, { x: dx, y: dy }), this.title(), this.key(mode));
    mode.last = at;
  }
}

// Подпись зоны едет за курсором, пока он не отошёл на пятую долю допуска
const LabelStep = {
  move(mode, env, event) {
    const at = worldOf(env, event);
    const [dx, dy] = [at.x - mode.origin.x, at.y - mode.origin.y];
    if (!mode.moved && Math.hypot(dx, dy) < env.tolerance * 0.2) return;
    mode.moved = true;
    const nudged = (axis, delta) => Math.round(mode.start[axis] + delta);
    const next = patchObject(env.config, mode.target, {
      labelOffset: { x: nudged("x", dx), y: nudged("y", dy) },
    });
    env.change(next, tr("Сдвинута подпись зоны"), `zone.labelOffset.${mode.target.id}`);
  },
};

// Угол: от ручки сверху, а за кольцо у угла - относительно места захвата
function angleOf({ relative, box, start, from }, env, event) {
  const point = sceneOf(env, event);
  const { shiftKey } = event;
  return relative
    ? rotationFromDrag(box, start, point, from, shiftKey)
    : emblemRotationFromPointer(box, point, shiftKey);
}

export const EDIT_MODES = Object.fromEntries([
  [
    "object",
    new DragStep({
      title: () => tr("Объект перемещён"),
      key: ({ target }) => `move.${target.kind}.${target.id}`,
      build: (mode, env, shift) => moveObject(env.config, mode.target, shift),
    }),
  ],
  [
    "objects",
    new DragStep({
      title: () => tr("Объекты перемещены"),
      key: ({ key }) => `move.many.${key}`,
      build: (mode, env, shift) => moveObjects(env.config, mode.targets, shift),
    }),
  ],
  [
    "vertex",
    new EditStep({
      title: () => tr("Сдвинута вершина зоны"),
      key: ({ zoneId, index }) => `zone.vertex.${zoneId}.${index}`,
      build: ({ zoneId, index }, env, event) =>
        moveZoneVertex(env.config, zoneId, index, worldOf(env, event)),
    }),
  ],
  [
    "resize",
    new EditStep({
      title: () => tr("Размер эмблемы"),
      key: ({ target }) => `emblem.resize.${target.id}`,
      build({ box, target }, env, event) {
        const width = emblemWidthFromPointer(box, sceneOf(env, event), env.projector);
        return patchObject(env.config, target, { width });
      },
    }),
  ],
  [
    "rotate",
    new EditStep({
      title: () => tr("Поворот эмблемы"),
      key: ({ target }) => `emblem.rotate.${target.id}`,
      build(mode, env, event) {
        const rotation = angleOf(mode, env, event);
        return patchObject(env.config, mode.target, { rotation });
      },
    }),
  ],
  [
    "zone-resize",
    new EditStep({
      title: () => tr("Размер фигуры"),
      key: ({ target }) => `zone.zone-resize.${target.id}`,
      build({ box, corner, target }, env, event) {
        const options = { projector: env.projector, unproject: env.toWorld, square: event.shiftKey };
        const grown = zoneBoxFromCorner(box, corner, sceneOf(env, event), options);
        return resizeZoneShape(env.config, target, grown);
      },
    }),
  ],
  [
    "zone-rotate",
    new EditStep({
      title: () => tr("Поворот фигуры"),
      key: ({ target }) => `zone.zone-rotate.${target.id}`,
      build(mode, env, event) {
        const rotation = angleOf(mode, env, event);
        return resizeZoneShape(env.config, mode.target, { rotation });
      },
    }),
  ],
  ["label", LabelStep],
]);

// ——— начало: нажатие по объекту ———

// Центр зоны по вершинам: суммы идут по порядку точек
function centroidOf(points) {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

// Где подпись стоит сейчас относительно середины зоны: смещение в метрах, если его не задавали
function labelStart(env, zone) {
  const { labelOffset } = zone;
  if (labelOffset) return { x: labelOffset.x, y: labelOffset.y };
  const label = sceneLabelOf(env.scene, { kind: "zone", id: zone.id });
  if (!label) return { x: 0, y: 0 };
  const centre = env.projector.point(centroidOf(zone.points));
  const unit = env.projector.length(1000) / 1000 || 1;
  const meters = (sceneShift) => Math.round(sceneShift * (1 / unit));
  return { x: meters(label.x - centre.x), y: meters(-(label.y - centre.y)) };
}

function beginLabelDrag(env, hit, world) {
  const target = { kind: "zone", id: hit.id };
  const zone = findObject(env.config, target);
  const start = zone ? labelStart(env, zone) : { x: 0, y: 0 };
  grab(env, { kind: "label", target, origin: world, start, moved: false });
}

// Второе нажатие по тому же объекту быстрее DOUBLE_PRESS_MS - «внутрь группы»
function isDeepPress(env, key) {
  const now = Date.now();
  const before = env.pressRef.current;
  env.pressRef.current = { key, at: now };
  return before.key === key && now - before.at < DOUBLE_PRESS_MS;
}

// Нажатие по объекту: выбор (или «внутрь группы» при двойном), затем перенос
export function pressObject(env, hit, world) {
  const deep = isDeepPress(env, `${hit.kind}:${hit.id}`);
  const inPicked = env.picked.length > 1 && env.picked.some((one) => sameTarget(one, hit));
  if (deep || !inPicked) env.onSelect(targetOf(hit), { deep });
  if (!inPicked && hit.kind === "zone" && hit.part === "label") {
    beginLabelDrag(env, hit, world);
    return;
  }
  const targets = dragTargets(env, hit, { deep, inPicked });
  const mode =
    targets.length > 1
      ? { kind: "objects", targets, key: `${hit.kind}.${hit.id}`, last: world }
      : { kind: "object", target: targets[0] ?? targetOf(hit), last: world };
  grab(env, mode);
}

// Удалить вершину зоны (меньше четырёх - зона остаётся как есть)
function dropVertex(env, zone, index) {
  const { points } = zone;
  const patch = points.length > 3 ? { points: [...points.slice(0, index), ...points.slice(index + 1)] } : {};
  env.change(
    patchObject(env.config, { kind: "zone", id: zone.id }, patch),
    tr("Удалена вершина зоны"),
    `zone.vertex.${zone.id}`,
  );
  return true;
}

// Вершина выбранной свободной зоны: Alt убирает, Shift у ребра вставляет, иначе тянем
export function pressZoneVertex(env, ctx) {
  const spec = handlesOf(env);
  if (spec.kind !== "vertex") return false;
  const zone = spec.object;
  const found = hitZoneVertex(zone, ctx.world, env.tolerance);
  if (found >= 0) {
    if (ctx.alt) return dropVertex(env, zone, found);
    return grab(env, { kind: "vertex", zoneId: zone.id, index: found });
  }
  const edge = ctx.shift ? hitZoneEdge(zone, ctx.world, env.tolerance * POINTS.edgeFactor) : -1;
  if (edge < 0) return false;
  env.change(
    insertZoneVertex(env.config, zone.id, edge, ctx.world),
    tr("Добавлена вершина зоны"),
    `zone.vertex.${zone.id}`,
  );
  return grab(env, { kind: "vertex", zoneId: zone.id, index: edge + 1 });
}

// ——— ручки ———

const CORNER_NAME = /^corner-(\d+)$/;

// Режим по имени ручки: угол, ручка поворота или кольцо у угла.
// У фигуры зоны режимы свои (zone-resize, zone-rotate), у надписи и эмблемы - resize, rotate
function gripMode(name, onShape, { target, box, point }) {
  const corner = CORNER_NAME.exec(name);
  if (corner && onShape) return { kind: "zone-resize", target, box, corner: Number(corner[1]) };
  if (corner) return { kind: "resize", target, box };
  const kind = onShape ? "zone-rotate" : "rotate";
  if (name === "rotate") return { kind, target, box, relative: false };
  return { kind, target, box, relative: true, start: point, from: box.rotation };
}

// Ручка рамки выбранной фигуры или надписи
export function pressFrameHandle(env, ctx) {
  const spec = handlesOf(env);
  const box = handleFrameOf(env, spec);
  if (!box) return false;
  const name = hitEmblemHandle(box, ctx.point, env.handleSize, { ring: true });
  if (!name) return false;
  const target = targetOf(env.selection);
  return grab(env, gripMode(name, spec.kind === "shape", { target, box, point: ctx.point }));
}

// Ручка поля печати надписи (края, углы, кружок поворота)
export function pressTypeGrip(env, grip, event) {
  const emblem = env.textEdit?.emblem;
  if (!emblem) return false;
  const target = { kind: "emblem", id: emblem.id };
  if (grip === "move") return grab(env, { kind: "object", target, last: worldOf(env, event) });
  const box = emblemBox(emblem, env.projector, env.handleGap, env.textAdvance);
  const start = sceneOf(env, event);
  const mode =
    grip === "rotate"
      ? { kind: "rotate", target, box, relative: false, start }
      : { kind: "resize", target, box };
  return grab(env, mode);
}
