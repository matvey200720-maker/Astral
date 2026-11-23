import { useEffect, useMemo, useRef, useState } from "react";
import { rgbaToCanvas } from "../../../components/desktop/workshop/canvas-surface.js";
import {
  cachedClimbMarker,
  climbMarkerCanvas,
  climbMarkerKey,
  climbMarkerLayers,
  rememberClimbMarker,
} from "./climb-render.js";
import { climbMarkerLayout } from "@modovik/climb-contract";

// Потоки выключены в тестах и там, где нет Worker
const OFFLOAD = typeof Worker === "function" && import.meta.env?.MODE !== "test";

// Что из слоёв уходит в поток и что при этом передаётся буферами (порядок важен)
const JOB_FIELDS = ["width", "height", "union", "fillPixels", "inkPixels", "needsDistance", "paint"];
const TRANSFERRED = ["union", "fillPixels", "inkPixels"];

/**
 * Клиент потока досчёта, один на окно: одно задание в работе, одно в ожидании.
 * Номера растут и на вытесненных заданиях, поэтому в нумерации бывают пропуски.
 */
function createLane() {
  let thread = null;
  let dead = false;
  let running = null;
  let waiting = null;
  let issued = 0;

  const promote = () => {
    const next = waiting;
    waiting = null;
    if (next) launch(next);
  };

  function hear(data) {
    if (!data || !running || data.id !== running.id) return;
    const job = running;
    running = null;
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.rgba);
    promote();
  }

  function collapse(failed) {
    dead = true;
    failed.terminate();
    if (thread === failed) thread = null;
    const doomed = [running, waiting].filter(Boolean);
    running = null;
    waiting = null;
    doomed.forEach((job) => job.reject(new Error("worker")));
  }

  function spawn() {
    const worker = new Worker(new URL("./climb-marker-worker.js", import.meta.url), { type: "module" });
    thread = worker;
    worker.onmessage = (event) => hear(event.data);
    worker.onerror = () => collapse(worker);
    return worker;
  }

  function launch(job) {
    const { id, slotId, layers } = job;
    try {
      if (dead) throw new Error("worker");
      (thread ?? spawn()).postMessage(
        { id, slotId, ...Object.fromEntries(JOB_FIELDS.map((field) => [field, layers[field]])) },
        TRANSFERRED.map((field) => layers[field].buffer),
      );
    } catch (error) {
      dead = true;
      job.reject(error);
      return;
    }
    running = job;
  }

  return {
    get dead() {
      return dead;
    },
    submit(slotId, layers) {
      issued += 1;
      const id = issued;
      return new Promise((resolve, reject) => {
        const job = { id, slotId, layers, resolve, reject };
        if (running) {
          waiting?.resolve(null);
          waiting = job;
        } else {
          launch(job);
        }
      });
    },
  };
}

const lane = createLane();

/** Метка «как есть»: холст и раскладка, посчитанные в самом окне. */
const frameOf = (design, slotId, picture, key) => ({
  key,
  slotId,
  marker: climbMarkerCanvas(design, slotId, { picture }),
  layout: climbMarkerLayout(design, slotId),
});

// В окне считаем сразу, когда поток не нужен или не поможет
const paintsHere = (slotId, shownSlot, key) =>
  !OFFLOAD || lane.dead || slotId !== shownSlot || cachedClimbMarker(key) != null;

/**
 * Отдаёт слои потоку; готовая метка приходит в setShown, отказ потока ведёт в запасной путь
 * (метка считается в окне по макету последнего показа). Возвращает отмену.
 */
function offload({ key, slotId, latest, setShown }) {
  let stale = false;
  const { design, picture } = latest.current;
  const layers = climbMarkerLayers(design, slotId, { picture });

  const adopt = (rgba) => {
    if (stale || !rgba) return;
    const marker = rememberClimbMarker(key, rgbaToCanvas(rgba, layers.width, layers.height));
    if (marker) setShown({ key, slotId, marker, layout: layers.layout });
  };
  const fallBack = () => {
    if (stale) return;
    const fresh = latest.current;
    setShown(frameOf(fresh.design, slotId, fresh.picture, key));
  };

  if (layers) lane.submit(slotId, layers).then(adopt).catch(fallBack);
  return () => {
    stale = true;
  };
}

export function useClimbStageMarker(design, slotId, picture) {
  const key = climbMarkerKey(design, slotId, picture);
  const [shown, setShown] = useState(() => frameOf(design, slotId, picture, key));
  const latest = useRef({ design, picture });
  const shownSlot = shown.slotId;

  useEffect(() => {
    latest.current = { design, picture };
  });

  const instant = useMemo(
    () => (paintsHere(slotId, shownSlot, key) ? frameOf(design, slotId, picture, key) : null),
    [design, key, picture, shownSlot, slotId],
  );

  useEffect(() => {
    if (instant) {
      if (instant.key !== shown.key) setShown(instant);
      return undefined;
    }
    return shown.key === key ? undefined : offload({ key, slotId, latest, setShown });
  }, [instant, key, shown, slotId]);

  const visible = instant ?? shown;
  return { marker: visible.marker, layout: visible.layout, pending: !instant && shown.key !== key };
}
