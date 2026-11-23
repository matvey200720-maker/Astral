/*
 * Подсказка «Это место отмечено как кожа и закрыто» в полосе «красить только вещь» (`ItemOnlyBar`, 16.11.2026, решение общей ведущей): человек водит кистью или жмёт заливку, а на листе вещи ничего не меняется,
 * потому что место отмечено как кожа. Одна строка в полосе (не окно и не на каждый мазок): появляется после первого «пустого» мазка, гаснет, когда отметку поправили, и дальше на этой вещи не возвращается.
 *   idle → shown (первый пустой мазок или заливка закрытого листа) → done (отметку поправили; другая вещь — снова idle).
 */

/** Автомат подсказки: `note()` — пустой мазок (true, если подсказка только что включилась), `corrected()` — отметку поправили, `reset()` — другая вещь. */
export function createEmptyHint() {
  let state = "idle";
  return {
    note() {
      if (state !== "idle") return false;
      state = "shown";
      return true;
    },
    corrected() {
      if (state === "shown") state = "done";
    },
    reset() {
      state = "idle";
    },
    get shown() {
      return state === "shown";
    },
    get state() {
      return state;
    },
  };
}

/** Мазок «пустой», если ни один из его следов (главный и зеркальный) не задел вещь; правка маски слоя (`maskEdit`) — не покраска вещи. */
export const strokeWasEmpty = ({ maskEdit = null, trails = [] } = {}) => {
  if (maskEdit) return false;
  const used = trails.filter(Boolean);
  return used.length > 0 && used.every((trail) => !trail.touchedItem);
};
