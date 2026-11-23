// Правила выбора: какой слой берёт курсор, что закреплено, где ручки, подпись под курсором.
// Чистые функции над `env` (что собирает отрисовка: config, scene, tool, проекция, допуски…).
import { groupMembers, isUserGroup, sceneLabelAt } from "@modovik/vector-map";
import {
  emblemBox,
  findObject,
  hitEmblemHandle,
  hitTest,
  zonePress,
  zoneShapeBox,
} from "../world-map-editing.js";
import { HANDLE_CURSORS, HIT_LAYERS, LABEL_TOOLS, POINTS, ZONE_HANDLE_TOOLS } from "./numbers.js";

const hasOwn = (table, key) => Object.prototype.hasOwnProperty.call(table, key);

export const layerOfTool = (tool) => (hasOwn(HIT_LAYERS, tool) ? HIT_LAYERS[tool] : "all");

const sectionOf = (config, kind) => {
  if (kind === "zone") return config.zones;
  return kind === "marker" ? config.markers : null;
};

// Закреплён сам объект либо весь его набор (у зон и меток)
export function isLocked(config, kind, object) {
  if (!object) return false;
  if (object.locked) return true;
  const frozen = sectionOf(config, kind)?.lockedGroups;
  return Boolean(frozen?.includes?.(object.group || "own"));
}

// Какие надписи берёт инструмент (фильтр поверх попадания по слою «emblems»)
const EMBLEM_FILTERS = {
  text: (object) => object.kind === "text",
  images: (object) => object.kind === "image",
  schedule: (object) => Boolean(object.schedule),
};

// Ручки надписи есть у «Выбора», «Слоёв» и у инструмента своего вида
const EMBLEM_HANDLE_TOOLS = {
  select: () => true,
  layers: () => true,
  text: EMBLEM_FILTERS.text,
  images: EMBLEM_FILTERS.images,
  schedule: EMBLEM_FILTERS.schedule,
};

// sceneLabelAt даёт { kind: "marker" | "zone", id }; нам нужна цель с пометкой части
const labelTargetOf = (found) => (found ? { kind: found.kind, id: found.id, part: "label" } : null);

// Подпись под курсором по рамке текста; закреплённого подпись не берётся
export function labelHitAt(env, point) {
  if (!LABEL_TOOLS.has(env.tool)) return null;
  const reach = POINTS.hit * env.unit * POINTS.labelReach;
  const target = labelTargetOf(sceneLabelAt(env.scene, point, reach));
  if (!target) return null;
  if (env.tool === "labels" && target.kind !== "marker") return null;
  if (env.tool === "areas" && target.kind !== "zone") return null;
  const object = findObject(env.config, target);
  return object && !isLocked(env.config, target.kind, object) ? target : null;
}

// Попадание по инструменту; `null`, если инструмент ничего не берёт
export function hitByTool(env, world, point) {
  const layer = layerOfTool(env.tool);
  if (layer === "none") return null;
  const label = labelHitAt(env, point);
  if (label) return label;
  if (env.tool === "zones") {
    return zonePress(env.config, world, env.tolerance, env.preferLayer).grab;
  }
  const hit = hitTest(env.config, layer, world, env.tolerance, env.preferLayer, {
    textAdvance: env.textAdvance,
  });
  const keeps = EMBLEM_FILTERS[env.tool];
  if (!hit || !keeps || !hasOwn(EMBLEM_FILTERS, env.tool)) return hit;
  const object = findObject(env.config, hit);
  return object && keeps(object) ? hit : null;
}

const NO_HANDLES = Object.freeze({ kind: null, object: null });

// Что даёт выбранный объект: вершины свободной зоны, рамку фигуры, рамку надписи
export function handlesOf(env) {
  const { config, selection, tool } = env;
  const object = selection ? findObject(config, selection) : null;
  if (!object || isLocked(config, selection.kind, object)) return NO_HANDLES;
  if (selection.kind === "zone") {
    if (!ZONE_HANDLE_TOOLS.has(tool)) return NO_HANDLES;
    return { kind: object.box ? "shape" : "vertex", object };
  }
  const offers = hasOwn(EMBLEM_HANDLE_TOOLS, tool) ? EMBLEM_HANDLE_TOOLS[tool] : null;
  if (selection.kind === "emblem" && offers?.(object)) return { kind: "emblem", object };
  return NO_HANDLES;
}

// Рамка с ручками для выбранной фигуры или надписи
export function handleFrameOf(env, spec) {
  if (spec.kind === "shape") return zoneShapeBox(spec.object, env.projector, env.handleGap);
  if (spec.kind === "emblem") {
    return emblemBox(spec.object, env.projector, env.handleGap, env.textAdvance);
  }
  return null;
}

// Имя ручки → класс курсора (угол, поворот, кольцо у угла)
export function cursorOfHandle(name) {
  if (!name) return null;
  if (hasOwn(HANDLE_CURSORS, name)) return HANDLE_CURSORS[name];
  return name.startsWith("rotate-corner") ? "rotate" : null;
}

// Курсор над ручками без нажатой кнопки; `move` — над готовой зоной при фигурах
export function cursorAt(env, world, point) {
  const spec = handlesOf(env);
  const frame = handleFrameOf(env, spec);
  if (frame) {
    const named = cursorOfHandle(hitEmblemHandle(frame, point, env.handleSize, { ring: true }));
    if (named) return named;
  }
  if (env.tool === "zones" && env.shape !== "free") {
    return hitByTool(env, world, point) ? "move" : null;
  }
  return null;
}

// Что тянется вместе с нажатым: одна цель, все выбранные или вся пользовательская группа
export function dragTargets(env, hit, { deep, inPicked }) {
  const single = [{ kind: hit.kind, id: hit.id }];
  if (deep) return single;
  if (inPicked) return env.picked;
  const owner = findObject(env.config, hit);
  if (owner?.group && isUserGroup(owner.group)) return groupMembers(env.config, owner.group);
  return single;
}
