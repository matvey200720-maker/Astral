/*
 * Лист, что можно ставить материалу сейчас (14.11.2026, «Astral быстрее»): свой, если пришёл; пока едет — тот же лист игры в другом размере, что уже
 * на месте. Облик просит другую ступень листа (`mapSize`: «Зоны» сперва кладут 512, потом ступени по близости к камере, `sheet-budget.js`), а лист новой
 * ступени — другая запись кэша окна (`@2048` против `@512`) и приходит позже: пока он едет, материал уходил в средний цвет, то есть сцена
 * показывалась без текстур посреди показа. Лист в другом размере — тот же лист, только мельче; пришёл нужный — встаёт он (приход листа сбрасывает записи
 * `look-memo.js`, пачка листов ставит материалы заново).
 *
 * Чистый модуль без three и DOM: «лист» здесь — любой объект с `userData: { ready, source, size }`.
 */
export function createSheetStandIns() {
  /* Источник листа (`textureKey(entry, 0)`: без размера) → самый крупный из пришедших листов. */
  const bySource = new Map();
  return {
    /** Лист, что можно ставить сейчас: свой пришёл — он; нет — пришедший того же источника; нет и его — `null` (средний цвет). */
    usable(sheet) {
      if (!sheet) return null;
      if (sheet.userData.ready) return sheet;
      return bySource.get(sheet.userData.source) || null;
    },
    /** Лист пришёл: запомнить как замену для тех же листов других размеров (самый крупный). */
    remember(sheet) {
      const known = bySource.get(sheet.userData.source);
      if (!known || (sheet.userData.size || 0) >= (known.userData.size || 0)) bySource.set(sheet.userData.source, sheet);
    },
    /** Лист освобождён (сцена ушла): замена из него уходит. */
    forget(sheet) {
      if (bySource.get(sheet.userData.source) === sheet) bySource.delete(sheet.userData.source);
    },
    clear() {
      bySource.clear();
    },
    /** Листы-замены, что сейчас стоят (для учёта картинок, `image-ledger.js`): ничего не меняет. */
    held() {
      return [...bySource.values()];
    },
  };
}
