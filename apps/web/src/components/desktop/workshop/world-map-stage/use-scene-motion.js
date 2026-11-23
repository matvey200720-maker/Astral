// Появление и уход объектов: контуры дорисовки новых зон, карта задержек входа, множество
// уходящих и «показанная сцена» (живая сцена + ещё тающие ушедшие, без скрытого правкой).
import { ANIMATED_LAYERS, MOTION } from "./numbers.js";
import { motionOff } from "./motion-switch.js";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

const NO_ENTRIES = new Map();
const NO_IDS = new Set();
const ANIMATED = new Set(ANIMATED_LAYERS);

// Состояние движения: контуры новых зон, карта задержек входа, ещё тающие ушедшие
const START = { fresh: [], appear: NO_ENTRIES, vanishing: [] };

// Копия карты задержек, правленая на месте
function withAppear(state, change) {
  const appear = new Map(state.appear);
  change(appear);
  return { ...state, appear };
}

function reduceMotion(state, action) {
  switch (action.type) {
    case "zonesBorn":
      return { ...state, fresh: state.fresh.concat(action.born) };
    case "zonesDone":
      return { ...state, fresh: state.fresh.filter((one) => action.born.indexOf(one) < 0) };
    case "enter": {
      const { ids, lead, pace } = action;
      return withAppear(state, (appear) => {
        ids.forEach((id, at) => appear.set(id, lead + Math.round(at * pace)));
      });
    }
    case "entered": {
      const next = withAppear(state, (appear) => action.ids.forEach((id) => appear.delete(id)));
      return next.appear.size > 0 ? next : { ...next, appear: NO_ENTRIES };
    }
    case "leave": {
      const gone = (one) => action.left.some((record) => record.id === one.id);
      const remaining = state.vanishing.filter((one) => !gone(one));
      return { ...state, vanishing: remaining.concat(action.left) };
    }
    case "left":
      return { ...state, vanishing: state.vanishing.filter((one) => action.left.indexOf(one) < 0) };
    default:
      throw new TypeError(`unknown motion action: ${action.type}`);
  }
}

// Отложенные задачи с общей очисткой: колбэки не срабатывают после выгрузки
class TimerBag {
  pending = new Set();

  later = (task, ms) => {
    const id = window.setTimeout(() => {
      this.pending.delete(id);
      task();
    }, ms);
    this.pending.add(id);
  };

  clear = () => {
    for (const id of this.pending) window.clearTimeout(id);
    this.pending.clear();
  };
}

function useTimers() {
  const [bag] = useState(() => new TimerBag());
  useEffect(() => bag.clear, [bag]);
  return bag.later;
}

const itemsOf = (scene, layerId) => {
  const layer = (scene.layers ?? []).find((one) => one.id === layerId);
  return layer?.items ?? [];
};

// Зоны сцены по ключу: из слоя «zones», свечение (zone-glow-) не считается
function zonesOf(scene) {
  const zones = new Map();
  for (const item of itemsOf(scene, "zones")) {
    const id = String(item.id ?? "");
    const isZone = id.startsWith("zone-") && !id.startsWith("zone-glow-");
    if (isZone) zones.set(id.slice("zone-".length), item);
  }
  return zones;
}

// Примитивы анимируемых слоёв: id → { item, layer } (при повторе id остаётся последний)
function animatedOf(scene) {
  const rows = (scene.layers ?? [])
    .filter((layer) => ANIMATED.has(layer.id))
    .flatMap((layer) => (layer.items ?? []).map((item) => [item, layer.id]))
    .filter(([item]) => item.id != null)
    .map(([item, layer]) => [item.id, { item, layer }]);
  return new Map(rows);
}

// ids из `from`, которых нет в `known`
function missingFrom(known, from) {
  const missing = [];
  for (const id of from.keys()) {
    if (!known.has(id)) missing.push(id);
  }
  return missing;
}

const withinLimit = (count) => count >= 1 && count <= MOTION.animMax;

// Ушедшие записи по слою: слой → примитивы, которые дописываются в его хвост
function tailsOf(records) {
  const tails = new Map();
  for (const { layer, item } of records) tails.set(layer, [...(tails.get(layer) ?? []), item]);
  return tails;
}

// Слой с хвостом ушедших и без скрытых правкой; тот же слой, если менять нечего
function reshapeLayer(layer, tail, hidden) {
  const doomed = (item) => hidden.has(item.id);
  const cut = hidden.size > 0 && layer.items.some(doomed);
  if (!tail && !cut) return layer;
  const kept = cut ? layer.items.filter((item) => !doomed(item)) : layer.items;
  return { ...layer, items: [...kept, ...(tail ?? [])] };
}

function composeShown(scene, vanishing, hidden) {
  if (vanishing.length === 0 && hidden.size === 0) return { scene, leaving: NO_IDS };
  const present = vanishing.length > 0 ? animatedOf(scene) : NO_ENTRIES;
  const back = vanishing.filter((record) => !present.has(record.id));
  const tails = tailsOf(back);
  const layers = scene.layers.map((layer) => reshapeLayer(layer, tails.get(layer.id), hidden));
  const changed = layers.some((layer, at) => layer !== scene.layers[at]);
  const leaving = back.length > 0 ? new Set(back.map((record) => record.id)) : NO_IDS;
  return { scene: changed ? { ...scene, layers } : scene, leaving };
}

// Зум кадра запоминаем до эффекта сцены: он сравнивает «масштаб раскладки»
function useLatestZoom(zoom) {
  const zoomNow = useRef(zoom);
  useLayoutEffect(() => {
    zoomNow.current = zoom;
  });
  return zoomNow;
}

// Шаг волны входа: подряд идущие ids расходятся не дальше waveStep и укладываются в waveMs
const paceFor = (count) => (count === 1 ? 0 : Math.min(MOTION.waveStep, MOTION.waveMs / count));

// Волна входа: ids появились, задержка первого - из hold(), дальше шаг по волне
function startEntry(ids, { hold, act, later }) {
  if (!withinLimit(ids.length)) return;
  const lead = hold();
  act({ type: "enter", ids, lead, pace: paceFor(ids.length) });
  later(() => act({ type: "entered", ids }), lead + MOTION.appearMs + MOTION.waveMs);
}

// Уход: записи ушедших тают vanishMs
function startExit(left, { act, later }) {
  if (!withinLimit(left.length)) return;
  act({ type: "leave", left });
  later(() => act({ type: "left", left }), MOTION.vanishMs);
}

// Вход и уход - до отрисовки, иначе новое мелькнуло бы целиком на кадр
function useArrivals({ scene, zoomNow, later, hold, act }) {
  const memory = useRef({ known: null, key: null });
  const compare = () => {
    const now = animatedOf(scene);
    const { known: before, key: keyBefore } = memory.current;
    const key = scene.layoutZoom ?? zoomNow.current;
    memory.current = { known: now, key };
    const calm = !before || keyBefore !== key || motionOff();
    if (calm) return;
    const tools = { hold, act, later };
    startEntry(missingFrom(before, now), tools);
    startExit(missingFrom(now, before).map((id) => ({ id, ...before.get(id) })), tools);
  };
  useLayoutEffect(compare, [scene, zoomNow, later, hold, act]);
}

// Контур дорисовки новой зоны живёт 760 мс; пачку больше 12 не рисуем по одной
function useBornZones({ scene, later, act }) {
  const knownZones = useRef(null);
  const watch = () => {
    const now = zonesOf(scene);
    const before = knownZones.current;
    knownZones.current = now;
    if (!before) return;
    const born = [];
    for (const [id, item] of now) {
      if (!before.has(id)) born.push({ id, item });
    }
    if (born.length < 1 || born.length > MOTION.freshMax) return;
    act({ type: "zonesBorn", born });
    later(() => act({ type: "zonesDone", born }), MOTION.freshMs);
  };
  useEffect(watch, [scene, later, act]);
}

export function useSceneMotion(props) {
  const { scene, zoom, hold, hidden } = props;
  const later = useTimers();
  const [state, act] = useReducer(reduceMotion, START);
  const zoomNow = useLatestZoom(zoom);
  useArrivals({ scene, zoomNow, later, hold, act });
  useBornZones({ scene, later, act });

  const shown = useMemo(
    () => composeShown(scene, state.vanishing, hidden),
    [scene, state.vanishing, hidden],
  );

  const { fresh, appear } = state;
  return { fresh, appear, shown: shown.scene, leaving: shown.leaving };
}
