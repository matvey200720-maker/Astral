/*
 * Что из оптимизации стоит в игре — для библиотеки.
 *
 * Раздел оптимизации держит снимок применённого (`astral.optimizer.applied.v1`,
 * см. `components/desktop/workshop/optimizer/optimizer-storage.js`), но его
 * нормализация тянет за собой каталог рычагов `@modovik/optimizer` — ради
 * него сам раздел грузится лениво. Библиотеке рычаги не нужны: ей хватает
 * ответа «стоит ли что-то и сколько правок», поэтому снимок читается здесь
 * без нормализации, и полка не тащит в стартовый кусок то, от чего раздел
 * оптимизации бережёт его отдельной загрузкой.
 */

export const APPLIED_OPTIMIZER_KEY = "astral.optimizer.applied.v1";

/**
 * @param {Storage} [storage]
 * @returns {{ tweaks: number, enabled: string[], appliedAt: string,
 *   canRollback: boolean, restorePointId: string,
 *   settingsPrevious: Record<string, string> } | null}
 */
export function readAppliedOptimizerSummary(storage = globalThis.localStorage) {
  let raw = null;
  try {
    raw = JSON.parse(storage?.getItem(APPLIED_OPTIMIZER_KEY) || "null");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const enabled = Array.isArray(raw.profile?.enabled)
    ? raw.profile.enabled.filter((id) => typeof id === "string" && id)
    : [];
  /* Пустой снимок — это «в игре ничего от раздела нет», а не «стоит пустая
     настройка»: так его читает и сам раздел. */
  if (!enabled.length) return null;
  const settingsPrevious =
    raw.settingsPrevious && typeof raw.settingsPrevious === "object"
      ? Object.fromEntries(
          Object.entries(raw.settingsPrevious).map(([key, value]) => [
            key,
            String(value),
          ]),
        )
      : {};
  return {
    tweaks: enabled.length,
    /* Какие именно правки стоят — для показа в библиотеке (названия берёт
       строка оптимизации из каталога, лениво: здесь его не тянем). */
    enabled,
    appliedAt: String(raw.appliedAt || ""),
    canRollback: Boolean(raw.restorePointId),
    /* Корзине библиотеки: чем снять — точкой отката и прежними значениями
       settings.xml. */
    restorePointId: String(raw.restorePointId || ""),
    settingsPrevious,
  };
}
