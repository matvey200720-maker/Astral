import { useEffect, useState } from "react";

/*
 * Слова про GTA 5 RP в «Библиотеке» (21.11.2026): запись установки хранит коды (`unit.rp`, `install-queue/tasks/rp-words.js`), слова собираются на языке окна. Модуль слов берётся по `import()`:
 * ни он, ни словарь частичного случая в главный кусок не попадают, а у работы без структуры (режим выключен — `unit.rp` нет) хук ничего не загружает.
 */

/** Ключ юнита в карте слов. */
export const rpWordsKey = (unit) => String(unit?.key || unit?.modId || unit?.slots?.join(",") || "");

/**
 * `{ [ключ юнита]: слова }` для юнитов со структурой `rp`; перестраивается при смене юнитов и языка.
 * @param {Array<object>} units юниты установок (`readWorkshopInstallUnits`)
 * @param {string} language язык окна — слова зависят от него
 */
export function useRpWords(units, language = "ru") {
  const [words, setWords] = useState({});
  const withRp = (units || []).filter((unit) => unit?.rp);
  const signature = withRp.map((unit) => `${rpWordsKey(unit)}=${JSON.stringify(unit.rp)}`).join("|");
  useEffect(() => {
    if (!withRp.length) {
      setWords((previous) => (Object.keys(previous).length ? {} : previous));
      return undefined;
    }
    let alive = true;
    void import("../workshop/install-queue/tasks/rp-words.js").then(async ({ rpWordsOf }) => {
      const next = {};
      for (const unit of withRp) next[rpWordsKey(unit)] = await rpWordsOf(unit.rp);
      if (alive) setWords(next);
    });
    return () => {
      alive = false;
    };
    // `signature` и язык описывают то, от чего зависят слова
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, language]);
  return words;
}
