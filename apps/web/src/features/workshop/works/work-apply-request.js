// Одна «просьба открыть окно установки» на окно: корзина кладёт, студия одежды забирает (владелец, 16.11.2026: «на корзине установить могу», а вещь одежды ставится только через выбор цели).
// Редактор открывается на сохранённой работе, и окно выбора цели — то же, что у «Применить», — встаёт само, а не пустой редактор. Просьба — на ствол (слот) работы и живёт минуту, как просьба открыть работу.

const LIFETIME_MS = 60_000;

let parcel = null; // { slot, placedAt }

const isFresh = () =>
  parcel !== null && Date.now() - parcel.placedAt < LIFETIME_MS;

/** Положить просьбу: когда студия откроет слот `slot`, окно установки откроется само. */
export const requestWorkApply = (slot) => {
  parcel = slot ? { slot: String(slot), placedAt: Date.now() } : null;
};

/** Есть ли свежая просьба на этот слот (не забирая её). */
export const hasWorkApply = (slot) => isFresh() && parcel.slot === String(slot);

/** Забрать просьбу на этот слот: `true` один раз; чужой слот или просроченная просьба — `false`. */
export const takeWorkApply = (slot) => {
  if (!hasWorkApply(slot)) return false;
  parcel = null;
  return true;
};
