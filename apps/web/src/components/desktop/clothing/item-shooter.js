/*
 * Съёмщик плиток вещей: поток с `OffscreenCanvas` (`item-shot-worker.js`), а где потока нет — прежний съёмщик в окне (`clothing-shot.js`).
 *
 * Замер в настоящем Desktop на закрытой сборке ×4 (27.10.2026): создание съёмщика и первая съёмка в окне — два кадра по 0,35–0,5 с (ожидание ссылки
 * шейдеров, окружение), каждый следующий снимок — 60–200 мс главного потока (чтение кадра, обрезка по альфе, PNG). В потоке всё это идёт мимо окна.
 *
 * Потока нет в тестах (jsdom) и там, где нет `Worker` или `OffscreenCanvas`. Не создался контекст WebGL в потоке или поток упал — съёмщик
 * переходит на окно и остаётся на нём до конца жизни окна: падение не должно ломать плитки по кругу. `shoot(shot)` → `{ bytes }`, `dispose()`.
 */

const factoryOverride = { make: null };

/** Для проверок: подменить создание потока (`null` — настоящий). */
export function setItemShooterWorkerFactory(make) {
  factoryOverride.make = typeof make === "function" ? make : null;
  state.dead = false;
}

const state = { dead: false };

const supported = () =>
  !state.dead &&
  (Boolean(factoryOverride.make) || (typeof Worker === "function" && typeof OffscreenCanvas === "function"));

/** Буферы всех типизированных массивов запроса — в список передачи: меши и расцветка идут в поток без копии (запрос после снимка не нужен). */
function buffersOf(value, found = new Set(), depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return found;
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) found.add(value.buffer);
    return found;
  }
  for (const entry of Array.isArray(value) ? value : Object.values(value)) buffersOf(entry, found, depth + 1);
  return found;
}

/** Съёмщик в окне — запасной путь; `three` и `clothing-shot.js` берутся, только если без него не обойтись. */
function inWindow(options) {
  let inner = null;
  let disposed = false;
  const ready = import("../../../features/clothing/clothing-shot.js").then(async ({ createClothingShooter }) => {
    if (!disposed) inner = createClothingShooter(options);
    /* Создание (контекст, окружение) и первая съёмка (шейдеры) — двумя кусками: вместе это больше секунды главного потока ×4. */
    await new Promise((resolve) => setTimeout(resolve, 0));
    return inner;
  });
  return {
    async shoot(shot) {
      const shooter = await ready;
      if (!shooter) throw new Error("Съёмщик отпущен.");
      return shooter.shoot(shot);
    },
    dispose() {
      disposed = true;
      inner?.dispose();
      inner = null;
    },
  };
}

/** Съёмщик в потоке. Не поднялся — отказ с причиной, и вызывающий уходит на окно. */
function inWorker(options) {
  const worker = factoryOverride.make ? factoryOverride.make() : new Worker(new URL("./item-shot-worker.js", import.meta.url), { type: "module" });
  const waiting = new Map();
  let next = 1;
  const failAll = (reason) => {
    for (const { reject } of waiting.values()) reject(new Error(reason));
    waiting.clear();
  };
  worker.onmessage = (event) => {
    const { id, error, ...done } = event.data || {};
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(done);
  };
  worker.onerror = () => {
    state.dead = true;
    failAll("Поток съёмщика остановился.");
  };
  const call = (message, transfer = []) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, ...message }, transfer);
      } catch (error) {
        waiting.delete(id);
        reject(error);
      }
    });
  const ready = call({ op: "init", options });
  return {
    ready,
    async shoot(shot) {
      await ready;
      const { bytes } = await call({ op: "shoot", shot }, [...buffersOf(shot)]);
      return { bytes };
    },
    dispose() {
      failAll("Съёмщик отпущен.");
      worker.postMessage({ id: 0, op: "dispose" });
      /* Контекст освобождается вместе с потоком; даём `dispose` дойти. */
      setTimeout(() => worker.terminate(), 200);
    },
  };
}

/** Съёмщик плиток: поток, а если он не поднялся — окно. */
export function createItemShooter(options) {
  if (!supported()) return inWindow(options);
  let primary;
  try {
    primary = inWorker(options);
  } catch {
    state.dead = true;
    return inWindow(options);
  }
  /* `ready` без слушателя при `dispose` до первого снимка — не «необработанный отказ». */
  primary.ready.catch(() => {});
  let fallback = null;
  let disposed = false;
  const toWindow = () => {
    state.dead = true;
    primary.dispose();
    fallback ||= inWindow(options);
    return fallback;
  };
  return {
    async shoot(shot) {
      if (!fallback) {
        /* Поток не поднялся (нет WebGL на OffscreenCanvas, упал при создании) — все снимки окна дальше идут в окне. */
        try {
          await primary.ready;
        } catch {
          toWindow();
        }
      }
      if (fallback) return fallback.shoot(shot);
      try {
        return await primary.shoot(shot);
      } catch (error) {
        /* Поток упал посреди снимка — буферы запроса уже у него, эту вещь не снять (значок), следующие — в окне; отказ самой вещи — как раньше. */
        if (state.dead) toWindow();
        throw error;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (fallback) fallback.dispose();
      else primary.dispose();
    },
  };
}
