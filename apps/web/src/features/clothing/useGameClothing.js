/*
 * Вещи самой игры — источник «game» ассортимента «На что поставить?» (W5).
 *
 * Desktop читает оглавление одежды из файлов игры (дополнения GTA Online) и
 * отдаёт плоские строки: пол, вид, папка, номер, число цветов, имя на языке
 * игры и дополнение вместо магазина. Здесь они фильтруются по тому, что
 * красили (пол и вид), и становятся вещами ассортимента. Один запрос на окно:
 * Desktop держит оглавление в кэше, а первое чтение — десятки секунд.
 * Нет игры, нет ключей, браузер — пусто, выбор остаётся на каталоге.
 */

import { useEffect, useMemo, useState } from "react";
import { listGameClothingItems } from "../../api.js";
import { gameItemsOf, majesticLocalOf } from "./assortment-cache.js";

const EMPTY = Object.freeze([]);
let loading = null;

/** Забыть прочитанное: следующее окно спросит Desktop заново. */
export function forgetGameClothing() {
  loading = null;
}

/**
 * Прогрев до открытия окна (`prewarm.js`): строки игры читаются и из них собираются вещи нужных пола и вида и набор Majestic — окно открывается на готовом.
 * Без Astral Desktop (пусто) ничего не собирается.
 */
export async function warmGameClothing(wears = []) {
  loading ||= listGameClothingItems().catch(() => {
    loading = null;
    return null;
  });
  const answer = await loading;
  const rows = Array.isArray(answer?.rows) ? answer.rows : null;
  if (!rows?.length) return false;
  majesticLocalOf(rows);
  for (const wear of wears) if (wear?.component) gameItemsOf(rows, wear.gender, wear.component);
  return true;
}

/*
 * Что на Majestic можно заменить файлами игры (`majesticLocalSet`): вещи белых
 * паков с файлами. `null` — игра не прочитана (браузер, нет игры): тогда окно
 * ничего не прячет.
 */
export function useMajesticLocal() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    loading ||= listGameClothingItems().catch(() => {
      loading = null;
      return null;
    });
    void loading.then((answer) => {
      if (alive) setRows(Array.isArray(answer?.rows) ? answer.rows : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  /* Тот же ответ Desktop — тот же набор: на каждое открытие окна он не пересчитывается (`assortment-cache.js`). */
  return useMemo(() => majesticLocalOf(rows), [rows]);
}

export function useGameClothing(wear) {
  const [rows, setRows] = useState(EMPTY);
  const wanted = Boolean(wear?.component);
  useEffect(() => {
    if (!wanted) return undefined;
    let alive = true;
    loading ||= listGameClothingItems().catch(() => {
      loading = null;
      return null;
    });
    void loading.then((answer) => {
      if (alive) setRows(Array.isArray(answer?.rows) ? answer.rows : EMPTY);
    });
    return () => {
      alive = false;
    };
  }, [wanted]);
  return useMemo(() => {
    if (!wanted || !rows.length) return EMPTY;
    /* Те же строки, пол и вид — тот же список (`assortment-cache.js`): пустышки игры в выборе не показываются. */
    return gameItemsOf(rows, wear.gender, wear.component);
  }, [rows, wanted, wear?.gender, wear?.component]);
}

const GAME_NOT_ASKED = Object.freeze({ ready: false, rows: null });

/**
 * Строки игры целиком и признак «ответ пришёл» (TASK-targets-5: цель по умолчанию должна отличать «игра ещё читается» от «игра не прочитана»). `enabled` — спрашивать ли вообще:
 * карточка без цели по умолчанию игру не трогает. Игра не прочитана (браузер, нет игры, сбой) — `ready: true, rows: null`.
 */
export function useGameRows(enabled = true) {
  const [answer, setAnswer] = useState(GAME_NOT_ASKED);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    loading ||= listGameClothingItems().catch(() => {
      loading = null;
      return null;
    });
    void loading.then((reply) => {
      if (alive) setAnswer({ ready: true, rows: Array.isArray(reply?.rows) && reply.rows.length ? reply.rows : null });
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return answer;
}
