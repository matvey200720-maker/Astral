/*
 * Женские пары мужских вещей игры (ТЗ владельца 29.10.2026, «скин одежды на женского персонажа», п. 2).
 *
 * Desktop сопоставляет вещи «Моделей» (мужские — по числу игры, женские — со смещением, `@modovik/clothing/gender`) по ярлыку магазина, названию и
 * крою моделей. Здесь — запрос и запоминание на окно: список категории — один раз, пара одной вещи (там, где ярлыка и названия нет, Desktop читает
 * модели и сверяет крой) — по требованию. Нет Desktop, игры или пары — пусто: окно ничего не обещает.
 */

import { useEffect, useState } from "react";
import { listGameClothingPairs } from "../../api.js";
import { detectLegacyGame } from "../workshop/install-queue/game-root.js";

const EMPTY = Object.freeze({ status: "idle", pairs: Object.freeze({}) });
const lists = new Map();
const singles = new Map();

/** Забыть прочитанное: следующий запрос спросит Desktop заново (смена игры, тесты). */
export function forgetGamePairs() {
  lists.clear();
  singles.clear();
}

async function ask(slot, variant = null) {
  const gameRoot = await detectLegacyGame().catch(() => "");
  if (!gameRoot) return { slot, status: "no-game", pairs: {} };
  return listGameClothingPairs({ gameRoot, slot, ...(variant === null ? {} : { variant }) });
}

/** Пары всей категории по оглавлению игры: `{ status, pairs }`, `pairs[число мужской вещи]` — женские кандидаты, лучший первым. */
export function loadGamePairs(slot) {
  if (!lists.has(slot))
    lists.set(
      slot,
      ask(slot).catch(() => {
        lists.delete(slot);
        return { slot, status: "failed", pairs: {} };
      }),
    );
  return lists.get(slot);
}

/**
 * Женские кандидаты одной вещи — с проверкой по крою там, где оглавление не уверено. Дороже списка (читаются модели), поэтому — только когда
 * человек просит пару этой вещи.
 */
export function loadGamePairOf(slot, variant) {
  const key = `${slot}|${variant}`;
  if (!singles.has(key))
    singles.set(
      key,
      ask(slot, variant)
        .then((answer) => answer?.pairs?.[variant] || [])
        .catch(() => {
          singles.delete(key);
          return [];
        }),
    );
  return singles.get(key);
}

/** Лучшая пара мужской вещи из ответа списка: `{ variant, score, why, confident, shape? }` или `null`. */
export const bestPairOf = (answer, variant) => answer?.pairs?.[variant]?.[0] || null;

/** Пары категории для окна: `{ status, pairs }`; пока не пришли — `idle`. Не просит, пока `enabled` ложно. */
export function useGamePairs(slot, enabled = true) {
  const [answer, setAnswer] = useState(EMPTY);
  useEffect(() => {
    if (!enabled || !slot) return undefined;
    let alive = true;
    setAnswer(EMPTY);
    void loadGamePairs(slot).then((next) => {
      if (alive) setAnswer(next);
    });
    return () => {
      alive = false;
    };
  }, [slot, enabled]);
  return answer;
}
