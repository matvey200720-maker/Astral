import { useCallback, useEffect, useSyncExternalStore } from "react";
import { reduxLayerCall } from "../../../api.js";

/*
 * Установленные редуксы на новом пути (dlc + слой, `reduxLayer` главного процесса) — склад для окна. Один список на всё окно:
 * кнопки «Выключить / Включить / Освободить место» читают из него свою строку, действие обновляет список заново. Мод прежнего пути и
 * браузер без Electron строки не имеют, и компонент молчит.
 */

let layers = new Map();
let loaded = false;
let pending = null;
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

function setLayers(list) {
  layers = new Map((Array.isArray(list) ? list : []).filter((item) => item?.modId).map((item) => [item.modId, item]));
  loaded = true;
  notify();
}

/** Читает список у главного процесса (один запрос за раз). */
export function refreshReduxLayers() {
  pending ||= reduxLayerCall({ action: "list" })
    .then(setLayers)
    .catch(() => setLayers([]))
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Для тестов: склад пуст и список ещё не читался. */
export function resetReduxLayers() {
  layers = new Map();
  loaded = false;
  pending = null;
  notify();
}

/**
 * Действие над редуксом: `disable`, `enable` или `free`. Ответ главного процесса (`{ state, bytes, freedBytes }`); отказ — исключение
 * (слова человеку — `redux-layer-words.js`). После действия список читается заново.
 */
export async function runReduxLayerAction(modId, action) {
  try {
    return await reduxLayerCall({ action, modId });
  } finally {
    await refreshReduxLayers();
  }
}

/** Строка редукса мода (`{ modId, state, bytes, targetId }`) или `null`; первое чтение — при первой подписке. */
export function useReduxLayer(modId) {
  const subscribe = useCallback((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const read = useCallback(() => layers.get(modId) ?? null, [modId]);
  const layer = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    if (!loaded) refreshReduxLayers();
  }, []);
  return layer;
}
