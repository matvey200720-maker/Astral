/*
 * Вещи GTA Online под именами проекта — источник «external» ассортимента
 * «На что поставить?» (задача 2 ТЗ 06.10.2026).
 *
 * С задачи 9 ТЗ 10.10.2026 (вечер) вещи серверов окно берёт из базы Astral
 * само (`useServerBase`), а Desktop отвечает за одно: вещам вики GTA5RP без
 * файла на сервере (это вещи GTA Online) место в игре даёт порядок вещей
 * игры игрока. С сайтов в рантайме ничего не грузится. Окно спрашивает один
 * раз на сервер, пол и вид за запуск; браузер без Desktop или игры — пусто.
 */

import { useEffect, useState } from "react";
import { readProjectClothing } from "../../api.js";

const EMPTY = Object.freeze([]);
const IDLE = Object.freeze({ status: "idle", items: EMPTY, vanilla: EMPTY });
const loads = new Map();

/** Забыть прочитанное: следующее окно спросит Desktop заново. */
export const forgetProjectClothing = () => loads.clear();

export function useProjectClothing(wear, server) {
  const key =
    wear?.component && server ? `${server}|${wear.gender}|${wear.component}` : "";
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    if (!key) {
      setState(IDLE);
      return undefined;
    }
    let alive = true;
    const [project, gender, component] = key.split("|");
    if (!loads.has(key))
      loads.set(
        key,
        readProjectClothing({ server: project, gender, component }).catch(() => {
          loads.delete(key);
          return { status: "unavailable", items: EMPTY, vanilla: EMPTY };
        }),
      );
    void loads.get(key).then((result) => {
      if (!alive) return;
      /* «Недоступно» не запоминается: следующее окно спросит снова. */
      if (result?.status === "unavailable") loads.delete(key);
      setState({
        status: result?.status || "unavailable",
        items: Array.isArray(result?.items) ? result.items : EMPTY,
        vanilla: Array.isArray(result?.vanilla) ? result.vanilla : EMPTY,
      });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}
