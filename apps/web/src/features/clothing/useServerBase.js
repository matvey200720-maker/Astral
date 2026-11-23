/*
 * База вещей серверов — источник «external» ассортимента «На что
 * поставить?» (задача 9 ТЗ 10.10.2026, вечер).
 *
 * Прежде вещи проектов приносил Desktop с сайтов в рантайме — минута на
 * первое открытие и пусто без сети. Теперь база в Astral
 * (`@modovik/clothing/server-base`): на открытие выбора грузятся три куска
 * того пола и вида, что правят (GTA5RP, Majestic, RMRP — десятки килобайт),
 * один раз за запуск окна. Desktop для этого не нужен: база работает и в
 * песочнице окна.
 */

import { useEffect, useState } from "react";
import { BASE_SERVERS, loadServerBase } from "@modovik/clothing/server-base";

const EMPTY = Object.freeze([]);
const NONE = Object.freeze({});
const IDLE = Object.freeze({ status: "idle", key: "", lists: NONE });
/* Прочитанное — сразу, без мига «загрузка» на втором открытии. */
const ready = new Map();

const keyOf = (wear) =>
  wear?.gender && wear?.component ? `${wear.gender}|${wear.component}` : "";

/* Куски базы одного пола и вида — один запрос на ключ, пока он не кончился (окно и прогрев ждут один и тот же). */
const loads = new Map();
function loadLists(key) {
  if (!loads.has(key)) {
    const [gender, component] = key.split("|");
    const load = Promise.all(
      BASE_SERVERS.map((server) =>
        loadServerBase({ server, gender, component }).catch(() => null),
      ),
    ).then((lists) => {
      const next = Object.freeze({
        status: lists.includes(null) ? "partial" : "ready",
        key,
        lists: Object.freeze(
          Object.fromEntries(
            BASE_SERVERS.map((server, at) => [server, lists[at] || EMPTY]),
          ),
        ),
      });
      /* Кусок не загрузился — следующее открытие попробует снова. */
      if (next.status === "ready") ready.set(key, next);
      loads.delete(key);
      return next;
    });
    loads.set(key, load);
  }
  return loads.get(key);
}

/** Прогрев до открытия окна (`prewarm.js`): куски базы этого пола и вида загружены и разобраны. */
export const warmServerBase = (wear) => {
  const key = keyOf(wear);
  return key && !ready.has(key) ? loadLists(key) : Promise.resolve(ready.get(key) || IDLE);
};

/** Вещи серверов базы этого пола и вида: `{ status, lists: { gta5rp: [...] } }`. */
export function useServerBase(wear) {
  const key = keyOf(wear);
  const [state, setState] = useState(() => ready.get(key) || IDLE);
  useEffect(() => {
    if (!key) {
      setState(IDLE);
      return undefined;
    }
    const known = ready.get(key);
    if (known) {
      setState(known);
      return undefined;
    }
    let alive = true;
    setState({ status: "loading", key, lists: NONE });
    void loadLists(key).then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return state.key === key ? state : IDLE;
}

/** Забыть прочитанное (тесты). */
export const forgetServerBaseLists = () => {
  ready.clear();
  loads.clear();
};
