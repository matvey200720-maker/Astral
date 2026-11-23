// Пара «редукс в dlc + мод каталога на ту же запись update.rpf» (решение владельца 17.11.2026, проект `INSTALL-RUST-REDUX.md` §6 вопрос 3).
//
// Редукс в своём dlc всегда выше мода каталога, который правит ту же запись `update.rpf`, даже если мод поставили позже. Пару не
// запрещаем: человеку говорим об этом словами ДО установки (строка `REDUX_PAIR_NOTICE.text` — ключ словаря интерфейса, на шести
// языках, записи — `locales/ui-text/zone-redux-pair-1711.js` и `fr/`). Модуль чистый: состояние и маршруты приходят
// аргументами, на диск и в сеть он не ходит.
import { REDUX_CLASSES } from "./redux-routes.js";

/** Слово для человека: русская строка — ключ словаря интерфейса (без вставок: число записей и список модов идут рядом, полем). */
export const REDUX_PAIR_NOTICE = Object.freeze({
  code: "redux-over-mod",
  text: "Редукс ляжет выше модов из каталога, которые правят те же записи игры: эти записи будут взяты у редукса. Установка не запрещена.",
});

const UPDATE_TARGETS = ["update/update.rpf", "mods/update/update.rpf"];
const lower = (value) => String(value ?? "").replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();

/** Записи, которые редукс пишет: внутренние пути контейнеров слоя (класс D) и записи корня (U-switch, кроме общих реестров). */
export function reduxPairEntries(routes) {
  const names = new Set();
  for (const group of routes?.d ?? []) for (const item of group.files) names.add(lower(item.inner));
  for (const item of routes?.switch ?? []) if (!item.registry) names.add(lower(item.file?.entry));
  names.delete("");
  return [...names];
}

/**
 * Какие моды стоят на записях редукса. `state` — состояние установки (`readState`), `targetKey` — цель, `modId` — сам редукс
 * (его слой парой не считается). Ответ: совпавшие записи и id модов, по порядку.
 */
export function reduxPairConflicts({ routes, state, targetKey, modId }) {
  const mine = new Set(reduxPairEntries(routes));
  const entries = new Set();
  const modIds = new Set();
  const archives = state?.targets?.[targetKey]?.archives;
  if (!archives || mine.size === 0) return { entries: [], modIds: [] };
  for (const archiveTarget of UPDATE_TARGETS) {
    for (const [entry, record] of Object.entries(archives[archiveTarget]?.entries ?? {})) {
      const key = lower(entry);
      if (!mine.has(key)) continue;
      const others = (record?.layers ?? []).map((layer) => String(layer?.modId ?? "")).filter((id) => id && id !== modId);
      if (others.length === 0) continue;
      entries.add(key);
      for (const id of others) modIds.add(id);
    }
  }
  return { entries: [...entries].sort(), modIds: [...modIds] };
}

export const REDUX_PAIR_CLASS = REDUX_CLASSES.D;
