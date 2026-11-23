import { getCloudCatalog } from "../../api.js";
import { useEffect, useState } from "react";

// Общий для всех хуков окна пустой ответ.
const NONE = Object.freeze([]);

// Карточки из ответа каталога; всё, что не массив, — пустой список.
const cardsOf = (catalog) => [catalog?.mods].find(Array.isArray) ?? NONE;

// Запрос живёт, пока не отказал и не сброшен: новые хуки берут тот же.
function keepOne(start) {
  let held = null;
  return {
    get: () => (held ??= start()),
    clear: () => {
      held = null;
    },
  };
}

const request = keepOne(() =>
  getCloudCatalog()
    .then(cardsOf)
    .catch(() => {
      request.clear();
      return NONE;
    }),
);

// Хуки, которые ещё на странице и ждут ответа.
const watchers = new Set();

export const forgetCatalogMods = () => {
  request.clear();
};

export const useCatalogMods = () => {
  const [mods, setMods] = useState(NONE);
  useEffect(() => {
    const pending = request.get();
    watchers.add(setMods);
    pending.then((list) => {
      if (watchers.has(setMods)) setMods(list);
    });
    return () => {
      watchers.delete(setMods);
    };
  }, []);
  return mods;
};
