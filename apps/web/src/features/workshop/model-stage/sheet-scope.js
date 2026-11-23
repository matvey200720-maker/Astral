/*
 * Листы текущей сцены (находка 6 ревью тестового ПК, 15.11.2026).
 *
 * Кадр держит листы всех сцен, что лежат у него в кэше сцен (возврат к сцене не читает их заново), и счёт для заставки считал по всем сразу: тяжёлая холодная сцена A, затем
 * лёгкая B («Карта зон», листов нет) — листы A ещё едут, и заставка B, итог листов и показ придержанных материалов ждали листы A. В `main` этому мешал потолок 20 с, у этапа 1 потолок 180 с
 * (`use-sheets-progress.js`), и чужие листы стали держать заставку надолго. Счёт — только по листам текущей сцены: тем, что названы в её описании (`asset.textures`), и тем, что её облик
 * просил в этом проходе (отделка, листы вне списка сцены) — по ним же облик придёт и в `textureFor`.
 *
 * Чистый модуль без three и DOM: «лист» здесь — любой объект с `userData: { source, settled }`; его читает `orbit-stage.js`, а тест гоняет на подставных листах.
 */
export function createSheetScope() {
  let generation = 0;
  let sources = new Set();
  const has = (sheet) => sheet.userData.scope === generation || sources.has(sheet.userData.source);
  return {
    /** Сцена встала (или встала обратно из кэша): `sourceKeys` — источники (`textureKey(entry, 0)`) листов её описания. Просьбы прежней сцены — уже чужие. */
    begin(sourceKeys = []) {
      generation += 1;
      sources = new Set(sourceKeys);
    },
    /** Облик текущей сцены просил этот лист (в том числе уже заведённый кадром): он её. */
    touch(sheet) {
      sheet.userData.scope = generation;
    },
    has,
    /** `{ done, total }` по листам текущей сцены: сколько ответило (пришло или не придёт) из всех просимых. */
    progress(sheets) {
      let done = 0;
      let total = 0;
      for (const sheet of sheets) {
        if (!has(sheet)) continue;
        total += 1;
        if (sheet.userData.settled) done += 1;
      }
      return { done, total };
    },
    /** Все листы текущей сцены ответили. */
    answered(sheets) {
      for (const sheet of sheets) if (has(sheet) && !sheet.userData.settled) return false;
      return true;
    },
  };
}
