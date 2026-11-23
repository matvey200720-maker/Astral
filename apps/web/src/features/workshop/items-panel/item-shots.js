/*
 * Кадры предметов для панели «Предметы» (ТЗ владельца 26.10.2026, п. A: «чтобы были именно картинки, не просто название»).
 *
 * Картинка предмета — кадр самой модели из сцены редактора, нашим рендером (`snapshotItemPixels` кадра, без второго
 * контекста WebGL), а не рисунок. Плиток много (у Majestic 186 моделей), поэтому снимки идут очередью по одному, с
 * паузой между ними, последний запрошенный — первым (видимое важнее ушедшего со страницы); готовый кадр помнится на
 * сцену (`WeakMap`), смена зала или вида даёт новую сцену и новую память. Кодирует кадр поток (`snapshot-encode-worker`):
 * `toDataURL` на главном потоке запрещён (docs/3D.md, правило 8). Снимать начинают, когда кадр сцены готов (`ready`: листы пришли, облик
 * устоялся — `model-stage/sheets-ready.js`): снимок, взятый раньше, видит материалы без листов (тёмные плитки, ТЗ 26.10.2026); до тех пор
 * плитка — скелет.
 *
 * Состояние вне React: плитка читает его через `useSyncExternalStore` (`useItemShot`), без состояния на каждую.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { encodeSnapshotBitmap } from "../model-stage/scene-snapshot.js";

const GAP_MS = 24;
/* Столько тишины после щелчка, нажатия клавиши или колеса — и очередь снимает дальше: щелчок по предмету ждал, пока доснимутся плитки
   (ТЗ 26.10.2026, перф ×4: снимок на главном потоке сидел между щелчком и первым кадром). */
const QUIET_MS = 450;

let lastInput = -Infinity;
let watching = false;
function watchInput() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  for (const type of ["pointerdown", "pointerup", "keydown", "wheel"]) window.addEventListener(type, () => (lastInput = performance.now()), { capture: true, passive: true });
}
/** Сколько ещё ждать, пока человек отпустит ввод; 0 — можно снимать. */
const quietFor = () => Math.max(0, QUIET_MS - (performance.now() - lastInput));
export const SHOT_SIZE = Object.freeze({ width: 256, height: 144 });
/** Крупный кадр — страница предмета. */
export const SHOT_SIZE_LARGE = Object.freeze({ width: 480, height: 270 });

/** Серединная точка рамки. */
const middle = (box) => [0, 1, 2].map((axis) => (box.min[axis] + box.max[axis]) / 2);

/*
 * Куда смотрит вещь: направление (единичный вектор), в которое обращено больше всего площади её граней, — лицо экрана, передняя
 * стенка автомата, наклонный планшет на столе. Грань и её изнанка — одна сторона (нормали складываются в одну полусферу), знак
 * потом выбирает ракурс. Память — на сцену и вещь.
 */
const facings = new WeakMap();
const AZIMUTHS = 12;
const ELEVATIONS = 4;
function facingOf(asset, key) {
  let memo = facings.get(asset);
  if (!memo) facings.set(asset, (memo = new Map()));
  if (memo.has(key)) return memo.get(key);
  const sums = Array.from({ length: AZIMUTHS * ELEVATIONS }, () => [0, 0, 0, 0]);
  for (const mesh of asset.meshes || []) {
    if (mesh.entity !== key) continue;
    const { positions, indices } = mesh;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const [a, b, c] = [indices[at] * 3, indices[at + 1] * 3, indices[at + 2] * 3];
      const ux = positions[b] - positions[a];
      const uy = positions[b + 1] - positions[a + 1];
      const uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a];
      const vy = positions[c + 1] - positions[a + 1];
      const vz = positions[c + 2] - positions[a + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-9) continue;
      /* В одну полусферу: нормаль и её изнанка — одна сторона вещи. */
      if (nz < 0 || (nz === 0 && (ny < 0 || (ny === 0 && nx < 0)))) [nx, ny, nz] = [-nx, -ny, -nz];
      const azimuth = (Math.atan2(ny, nx) + Math.PI) / (2 * Math.PI);
      const lift = Math.min(ELEVATIONS - 1, Math.floor((nz / length) * ELEVATIONS));
      const bin = sums[Math.min(AZIMUTHS - 1, Math.floor(azimuth * AZIMUTHS)) * ELEVATIONS + lift];
      bin[0] += nx / length;
      bin[1] += ny / length;
      bin[2] += nz / length;
      bin[3] += length / 2;
    }
  }
  let best = null;
  for (const bin of sums) if (bin[3] > 0 && (!best || bin[3] > best[3])) best = bin;
  const size = best ? Math.hypot(best[0], best[1], best[2]) : 0;
  const result = size > 1e-6 ? [best[0] / size, best[1] / size, best[2] / size] : null;
  memo.set(key, result);
  return result;
}

/**
 * Ракурс снимка предмета: вдоль той стороны, куда он обращён (`facing`), с той, что ближе к залу (`home` — глаз зала по
 * умолчанию) и выше, и чуть сверху. Предметы зала лицом к залу (экраны на стенах, кресла к сцене), так что снимок показывает их
 * лицом, а не ребром и не изнанкой, и у всех плиток один и тот же свет. Нет граней (`facing` пуст) — просто со стороны зала.
 */
export function shotDirection(home, box, facing = null) {
  const centre = middle(box);
  let dx = (home?.[0] ?? 0) - centre[0];
  let dy = (home?.[1] ?? -10) - centre[1];
  let length = Math.hypot(dx, dy);
  if (length < 0.3) {
    dx = 0;
    dy = -1;
    length = 1;
  }
  const toward = [dx / length, dy / length, 0.35];
  /* Грань, что смотрит почти вертикально (крыша здания, столешница, плита земли), узнаваемого вида не даёт — сверху видно только её. */
  if (facing && Math.abs(facing[2]) < 0.7) {
    const side = facing[0] * toward[0] + facing[1] * toward[1] + facing[2] * toward[2] >= 0 ? 1 : -1;
    const lifted = [facing[0] * side, facing[1] * side, facing[2] * side + 0.22];
    const size = Math.hypot(...lifted) || 1;
    return lifted.map((value) => value / size);
  }
  return [toward[0] * 0.86, toward[1] * 0.86, 0.5];
}

/**
 * Что снимать для модели: первая вещь модели, что ещё в игре (убранная из кадра не рисуется), её рамка и ракурс.
 * `null` — снимать нечем (вещей модели нет в сцене).
 */
export function modelShotSpec({ asset, model, removed = null, home = null, size = SHOT_SIZE, entityBounds }) {
  if (!asset || !model) return null;
  const gone = removed instanceof Set ? removed : new Set(removed || []);
  const boxes = entityBounds(asset);
  const key = model.keys.find((entry) => !gone.has(entry) && boxes.has(entry));
  if (key === undefined) return null;
  const box = boxes.get(key);
  return { id: `${key}@${size.width}`, keys: new Set([key]), box, direction: shotDirection(home, box, facingOf(asset, key)), width: size.width, height: size.height };
}

export function createItemShots() {
  let source = null;
  let version = 0;
  let epoch = 0;
  let busy = false;
  let timer = 0;
  /* Кадр сказал «готов» (`source.ready`: листы пришли, облик устоялся) для этой сцены; пока нет — очередь стоит, плитки — скелет. */
  let readyAsset = null;
  let readying = null;
  const caches = new WeakMap();
  const waiting = [];
  const listeners = new Set();
  /* Плитки слушают каждая свой снимок: готовый кадр будит только свою плитку, а не все на странице. */
  const byId = new Map();

  const cacheOf = () => {
    if (!source) return null;
    let cache = caches.get(source.asset);
    if (!cache) caches.set(source.asset, (cache = new Map()));
    return cache;
  };
  const emit = (id = null) => {
    version += 1;
    for (const listener of listeners) listener();
    if (id === null) for (const set of byId.values()) for (const listener of set) listener();
    else for (const listener of byId.get(id) || []) listener();
  };

  /*
   * Ждём, когда кадр сцены готов к снимкам (ТЗ 26.10.2026: плитки «Контейнер, вид 3» вставали тёмными): сцена появляется сразу, листы доезжают
   * позже, и снимок, взятый раньше, видит материалы без листов. Ожидание по событию кадра, не по таймеру; кадр без `ready` готов сразу.
   */
  function settle() {
    if (!source || readying) return;
    const current = source;
    if (typeof current.ready !== "function") {
      readyAsset = current.asset;
      return;
    }
    const wait = Promise.resolve()
      .then(() => current.ready())
      .catch(() => true);
    readying = wait;
    wait.then(() => {
      /* Сцену успели сменить — это ожидание чужое. */
      if (readying !== wait) return;
      readying = null;
      if (source && source.asset === current.asset) readyAsset = current.asset;
      pump();
    });
  }

  function pump() {
    clearTimeout(timer);
    if (busy || !source || !waiting.length) return;
    if (readyAsset !== source.asset) {
      settle();
      return;
    }
    if (typeof document !== "undefined" && document.hidden) {
      timer = setTimeout(pump, 500);
      return;
    }
    const quiet = quietFor();
    if (quiet > 0) {
      timer = setTimeout(pump, quiet);
      return;
    }
    busy = true;
    const job = waiting.pop();
    const current = source;
    Promise.resolve()
      .then(() => job.run(current))
      .catch(() => null)
      .then((url) => {
        /* Сцену успели сменить — кадр чужой, в память новой он не ложится. */
        if (current === source) cacheOf().set(job.id, typeof url === "string" ? url : null);
      })
      .finally(() => {
        busy = false;
        emit(job.id);
        timer = setTimeout(pump, GAP_MS);
      });
  }

  return {
    /**
     * Кадр сцены есть: `{ asset, shoot(keys, box, options) → пиксели, ready?() → Promise }` (`useItemShotsFeed`). `ready` — листы пришли и облик
     * устоялся; снимать начинают после него. Очередь прежней сцены сбрасывается.
     */
    attach(next) {
      if (source && next && source.asset === next.asset) {
        source = next;
        return;
      }
      source = next || null;
      waiting.length = 0;
      epoch += 1;
      /* Другая сцена — снова ждём её листов. */
      readyAsset = null;
      readying = null;
      emit();
      settle();
      pump();
    },
    detach() {
      if (!source) return;
      source = null;
      waiting.length = 0;
      epoch += 1;
      readyAsset = null;
      readying = null;
      emit();
    },
    /** Поставить снимок в очередь, если его нет: `spec` из `modelShotSpec`. */
    request(spec) {
      const cache = cacheOf();
      if (!cache || cache.has(spec.id) || waiting.some((job) => job.id === spec.id)) return;
      waiting.push({
        id: spec.id,
        run: async (current) => {
          const shot = await current.shoot(spec.keys, spec.box, { width: spec.width, height: spec.height, direction: spec.direction, async: true });
          if (!shot || typeof createImageBitmap !== "function" || typeof ImageData !== "function") return null;
          const bitmap = await createImageBitmap(new ImageData(shot.pixels, shot.width, shot.height));
          return encodeSnapshotBitmap(bitmap);
        },
      });
      pump();
    },
    /** Плитка ушла со страницы: снимок, что ещё не начат, не нужен. */
    cancel(id) {
      const at = waiting.findIndex((job) => job.id === id);
      if (at >= 0) waiting.splice(at, 1);
    },
    /** Готовый адрес, `null` — снять не вышло, `undefined` — ещё не снимали. */
    get: (id) => cacheOf()?.get(id),
    /** Забыть неудачный снимок: человек нажал «Снять ещё раз». */
    retry(id) {
      cacheOf()?.delete(id);
      emit(id);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Подписка на один снимок: будит только, когда готов (или забыт) именно он, и при смене сцены. */
    subscribeId(id, listener) {
      if (!byId.has(id)) byId.set(id, new Set());
      byId.get(id).add(listener);
      return () => {
        const set = byId.get(id);
        set?.delete(listener);
        if (set && !set.size) byId.delete(id);
      };
    },
    version: () => version,
    epoch: () => epoch,
  };
}

/**
 * Кадр предмета для плитки: `{ url, state }`, `state` — `idle` (снимать нечем), `loading`, `ready`, `failed`. Снимок ставится в
 * очередь, когда плитка на странице, и снимается из неё, когда плитка ушла.
 */
export function useItemShot(shots, spec) {
  const id = spec?.id || "";
  watchInput();
  const subscribe = useCallback((listener) => shots.subscribeId(id, listener), [shots, id]);
  /* Снимок плитки меняется один раз — когда он готов: страница не перерисовывает все плитки на каждый чужой кадр. */
  useSyncExternalStore(subscribe, () => shots.get(id));
  const epoch = useSyncExternalStore(shots.subscribe, shots.epoch);
  useEffect(() => {
    if (!spec) return undefined;
    shots.request(spec);
    return () => shots.cancel(spec.id);
    // spec собирается заново на каждый кадр страницы — следим за его id и за сценой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, id, epoch]);
  if (!spec) return { url: null, state: "idle" };
  const url = shots.get(id);
  return url ? { url, state: "ready" } : url === null ? { url: null, state: "failed" } : { url: null, state: "loading" };
}
