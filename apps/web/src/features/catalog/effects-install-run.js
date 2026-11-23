import { installTodoOf } from "./effects-install-set.js";
import { plainEffectsName } from "./bundles/component-groups.js";
import { releaseHeldGame } from "./install-prepare-wait.js";

/*
 * «Установить» на карточке «Эффектов» или «Трейсеров» ставит весь набор пакетов редукса (состав — `effects-install-set.js`) и показывает человеку ОДНУ установку: пакеты идут
 * пачкой одной транзакции движка (`installPackages`), одной строкой «Загрузок» — как замена компонента в окне «Компоненты». Отказ одного пакета ничего не меняет в игре.
 * Модуль ленивый, а тяжёлый `batch-install.js` берётся, только когда набор из нескольких пакетов: оболочка берёт модуль по `import()` при первой установке и даёт своё состояние (`shell` — `bundleShell()` оболочки).
 */

const NOTHING = Object.freeze({ handled: false, only: null });

/**
 * @param {object} mod запись каталога, на которой нажали «Установить»
 * @param {object} shell состояние оболочки: `game`, `preparation`, `prepareGame`, `mods`, `installed`, `demoMode`, `notify`, `notices` и очередь (`installPackages`)
 * @returns {Promise<{ handled: boolean, only: object|null }>} `handled` — набор принят (или остановлен с объяснением), оболочке делать нечего; `only` — недостаёт одного пакета,
 * и он не `mod`: оболочка ставит его обычной установкой; обе пустые — это не набор, ход прежний
 */
export async function installEffectsSet(mod, shell, options = {}) {
  if (!mod || shell.demoMode) return NOTHING;
  /* Ганпак каталога встаёт по стволам (`bundles/gunpack-parts.js`): одной строкой очереди, записью на ствол. Размер модели и пак, который по частям не разложить, — прежним ходом, одной записью. */
  if (mod.domain?.weapon?.pack === true && !options?.modelScale) {
    const parts = await import("./bundles/gunpack-parts.js");
    if (parts.isGunpackPack(mod) && (await parts.installGunpackParts(mod, shell)) !== "legacy") return { handled: true, only: null };
  }
  const todo = installTodoOf(mod, shell.mods, shell.installed);
  if (todo.length < 2) return todo.length === 1 && todo[0].id !== mod.id ? { handled: false, only: todo[0] } : NOTHING;
  /* Игра после «Вернуть GTA V без модов» и игра без подготовки: как у одиночной установки, сначала подготовка (план без неё не сходится). */
  if (shell.preparation.stockHold) await releaseHeldGame({ game: shell.game, prepareGame: shell.prepareGame, notify: shell.notify }, mod);
  if (shell.game.installReadiness !== "ready") {
    shell.notify(shell.notices.finishPreparation);
    void shell.prepareGame(shell.game, { force: true });
    return { handled: true, only: null };
  }
  const { installPackages } = await import("./bundles/batch-install.js");
  await installPackages({ name: plainEffectsName(mod.name) || mod.name, parts: todo }, shell);
  return { handled: true, only: null };
}
