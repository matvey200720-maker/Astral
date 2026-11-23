/*
 * Прогрев «Сделать заменёнку» на странице мода одежды (ТЗ 27.10.2026, замер входа в Desktop ×4): пока человек читает страницу, в тихие минуты окна
 * готовится то, что окно иначе собрало бы за один кадр при нажатии «Установить» — кусок окна (`lazy`), ответы Desktop о вещах игры и файлах серверов
 * вместе со вещами из них, база вещей серверов этого пола и вида, список «Заменяет» каталога и совет автора. Результаты ложатся в кэш
 * (`assortment-cache.js`, `useServerBase`): окно открывается на готовом, а второе открытие ничего не пересчитывает.
 *
 * По шагу за тихую минуту: каждый шаг — десятки миллисекунд, а не одна задача на сотни. Страница ушла — прогрев останавливается. Нет
 * `requestIdleCallback` (тесты, jsdom) — прогрева нет: окно собирает всё само, как и прежде.
 */

import { hasDesktopBridge } from "../../api.js";
import { authorTargets, catalogTargets, wearOf } from "./clothing-targets.js";
import { genderOfMod, genderTwin } from "./gender-twin.js";
import { warmGameClothing } from "./useGameClothing.js";
import { warmServerBase } from "./useServerBase.js";
import { warmServerClothing } from "./useServerClothing.js";

/** Вещь, на которую встаёт мод, и вещь его пары другого пола — так окно строит сетку (`ClothingInstallDialog.jsx`). */
function wearsOf(mod, mods) {
  const base = wearOf(mod);
  const gender = genderOfMod(mod);
  const own = base && gender ? { ...base, gender } : base;
  if (!own) return [];
  const twin = genderTwin(mod, mods);
  const twinGender = twin ? genderOfMod(twin) : null;
  return twinGender ? [own, { ...own, gender: twinGender }] : [own];
}

/** Прогрев страницы мода одежды; ответ — «остановить» (страница ушла). */
export function prewarmClothingInstall({ mod, mods, loadDialog = null }) {
  if (typeof requestIdleCallback !== "function") return () => {};
  let alive = true;
  let handle = null;
  const wears = wearsOf(mod, mods);
  const desktop = () => {
    try {
      return hasDesktopBridge();
    } catch {
      return false;
    }
  };
  const steps = [
    () => loadDialog?.(),
    () => {
      catalogTargets(mods);
      authorTargets(mod);
    },
    () => desktop() && warmGameClothing(wears),
    () => desktop() && warmServerClothing(),
    ...wears.map((wear) => () => warmServerBase(wear)),
  ];
  const run = (index) => {
    if (!alive || index >= steps.length) return;
    handle = requestIdleCallback(
      async () => {
        try {
          await steps[index]();
        } catch {
          /* Прогрев не обязан удаваться: окно соберёт то, чего не хватило, само. */
        }
        run(index + 1);
      },
      { timeout: 2500 },
    );
  };
  run(0);
  return () => {
    alive = false;
    if (handle !== null && typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
  };
}
