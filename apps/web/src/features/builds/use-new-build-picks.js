import { useRememberedState } from "../../section-memory.js";
import { readParkedInstalls } from "../library/parked-installs.js";
import { newBuildModIds } from "./build-mods.js";

/*
 * Что предложить в «Новую сборку» из библиотеки (ТЗ 23.10): все моды библиотеки, а не только те, что стоят в игре
 * сейчас. Библиотека хранит и моды, которые проверка файлов игры сняла (`profile.parked`, `parked-installs.js`): они
 * в библиотеке, но не стоят. Человек видит их плитками с пометкой «Стоит в игре» / «Не стоит», по умолчанию отмечены
 * все и любой можно снять; в сборку уходит отмеченное, цифры и «!» считаются по нему же.
 *
 * Хранится не «что отмечено», а «что снято»: мод, что появился в библиотеке, пока окно было закрыто, отмечен сам.
 * Мод, который заведомо не встанет (нет в каталоге, пакет без подписи), не отмечается и не переключается — причина
 * на его плитке, как в окне готовой сборки.
 */

/**
 * `{ ids, inGame }`: моды каталога из библиотеки — стоящие в игре, потом снятые; `inGame` — те, что стоят.
 * `options` — как у `newBuildModIds` (`modsById`, `catalogState`, `cloud`).
 */
export function libraryBuildMods(installed, parked, options) {
  const inGame = newBuildModIds(installed, options);
  const standing = new Set(inGame);
  const off = newBuildModIds([...parked], options).filter((id) => !standing.has(id));
  return { ids: [...inGame, ...off], inGame: standing };
}

export function useNewBuildPicks({ installed, modsById, catalogState, cloud, blockOf, entriesOf }) {
  const [unticked, setUnticked] = useRememberedState("builds:new-unticked", () => new Set());
  const { ids, inGame } = libraryBuildMods(installed, readParkedInstalls().modIds, {
    modsById,
    catalogState,
    cloud,
  });
  const enabledIds = new Set(ids.filter((id) => !unticked.has(id) && !blockOf(id)));
  const toggle = (id) =>
    setUnticked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /* «Выбрать все» не трогает те, что не встанут: они и так сняты. */
  const setAll = (on) => setUnticked(new Set(on ? [] : ids));
  return {
    ids,
    inGame,
    mods: entriesOf(ids),
    enabledIds,
    /* Для сетки «Войдёт в сборку»: что отмечено и как это менять. */
    selection: { enabledIds, onToggle: toggle, onSetAll: setAll },
    reset: () => setUnticked(new Set()),
  };
}
