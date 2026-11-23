/*
 * Дым из-под колёс из игры игрока — один на сеанс окна.
 *
 * Редактор и обложка его плитки читают одно и то же: правила-доноры дыма,
 * искр и огня и листы ядра (`readWheelSmokeBase`). Обещание помнится по
 * папке игры: вход в редактор после полки не ждёт главный процесс заново,
 * а обложка не читает игру второй раз. Отказ не запоминается — следующий
 * вход спросит снова.
 */

import { detectInstallations, hasDesktopBridge, readWheelSmokeBase, readWheelSmokeCar } from "../../../api.js";

const bases = new Map();

/** База дыма для папки игры: `{ model, sheets, light? }` или `null`. */
export function loadWheelSmokeBase(gameRoot) {
  const root = String(gameRoot || "");
  if (!root) return Promise.resolve(null);
  if (!bases.has(root)) {
    const job = Promise.resolve()
      .then(() => readWheelSmokeBase({ gameRoot: root }))
      .then((result) => {
        /* Пустой ответ (главный процесс старее редактора, кэша песочницы
           нет) не запоминается: после перезапуска спросить снова. */
        if (result?.model) return result;
        bases.delete(root);
        return null;
      })
      .catch((error) => {
        bases.delete(root);
        throw error;
      });
    bases.set(root, job);
  }
  return bases.get(root);
}

const cars = new Map();

/*
 * Дрифт-машина кадра из игры — тоже одна на сеанс и папку игры: GLB и опись
 * (`readWheelSmokeCar`). Ответ без машины (нет дополнения, старый главный
 * процесс) — `null`, в кадре остаются колёса Astral; отказ не помнится.
 */
export function loadWheelSmokeCar(gameRoot) {
  const root = String(gameRoot || "");
  if (!root) return Promise.resolve(null);
  if (!cars.has(root)) {
    const job = Promise.resolve()
      .then(() => readWheelSmokeCar({ gameRoot: root }))
      .then((result) => {
        if (result?.status === "ready" && result.glb) return result;
        cars.delete(root);
        return null;
      })
      .catch((error) => {
        cars.delete(root);
        throw error;
      });
    cars.set(root, job);
  }
  return cars.get(root);
}

/** Папка GTA V Legacy, если окно её знает; иначе пусто. */
export async function findLegacyRoot() {
  try {
    const games = await detectInstallations();
    const legacy = (Array.isArray(games) ? games : []).find(
      (item) => item?.path && String(item.edition || "Legacy").toLowerCase() === "legacy",
    );
    return legacy?.path || "";
  } catch {
    return "";
  }
}

/*
 * Заранее — пока человек на полке мастерской. Холодное чтение базы (после
 * записи в игру или обновления приложения) — секунда-две у главного процесса
 * и больше на слабой машине, и всё это время кадр редактора стоял без дыма.
 * Базу уже держим или читаем — ничего не делаем: обещание одно на папку игры,
 * его же берёт редактор и обложка плитки. Отказ молчит и не запоминается —
 * о нём скажет редактор, если в него зайдут.
 */
let prefetching = null;
export function prefetchWheelSmokeBase() {
  if (prefetching) return prefetching;
  /* Уже читается или прочитана — наведение на плитку не стоит и вызова моста. */
  if (bases.size) return Promise.resolve();
  try {
    if (!hasDesktopBridge()) return Promise.resolve();
    prefetching = findLegacyRoot()
      .then((root) => (root ? loadWheelSmokeBase(root) : null))
      .catch(() => null)
      .finally(() => {
        prefetching = null;
      });
  } catch {
    /* Заранее — значит необязательно: мост без чтения дыма не повод ронять полку. */
    return Promise.resolve();
  }
  return prefetching;
}

/* Для тестов: сеанс окна живёт долго, тестам нужен чистый. */
export function forgetWheelSmokeBases() {
  cars.clear();
  bases.clear();
}
