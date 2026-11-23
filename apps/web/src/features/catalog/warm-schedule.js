/*
 * Прогрев каталога в простое после старта (31.10.2026, холодный первый вход в каталог).
 *
 * Первый вход считает на ответ каталога то, что потом лежит в кэшах по этому ответу: витрину (`catalogPageMods`), группы частей, паки звуков и куски маппинга
 * (`prepare`), блок одежды каждого мода (`clothingOf`). На трёх тысячах модов это ~120 мс при ×4 одной порцией внутри самого тяжёлого кадра входа. Здесь то же самое
 * делается раньше, в простое, теми же функциями с теми же аргументами, — вход в каталог находит кэши готовыми.
 *
 * Этот модуль лёгкий и едет в стартовом куске: он только ждёт и подгружает `warm.js` (тот тянет кусок каталога). Каталог приходит страницами — новый массив раз в
 * 1,5 с, пока не дойдёт до конца, — поэтому греется тот ответ, что простоял без обновлений `SETTLE_MS`. Окно спрятано — ждём, пока покажут.
 */
const SETTLE_MS = 2500;

let latest = null;
let warmed = null;
let timer = 0;
let cancelWarm = null;

const whenIdle = (task) => {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(task, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 400);
  return () => window.clearTimeout(id);
};

function start() {
  timer = 0;
  const mods = latest;
  if (!mods || mods === warmed) return;
  if (document.visibilityState === "hidden") {
    timer = window.setTimeout(start, SETTLE_MS);
    return;
  }
  cancelWarm = whenIdle(() => {
    cancelWarm = null;
    import("./warm.js")
      .then(({ warmCatalog }) => {
        if (latest !== mods) return;
        warmed = mods;
        cancelWarm = warmCatalog(mods, whenIdle);
      })
      .catch(() => {});
  });
}

/** Каталог окна обновился: через `SETTLE_MS` тишины его прогреют. */
export function scheduleCatalogWarm(mods) {
  if (!Array.isArray(mods) || !mods.length || mods === warmed || mods === latest) return;
  latest = mods;
  window.clearTimeout(timer);
  cancelWarm?.();
  cancelWarm = null;
  timer = window.setTimeout(start, SETTLE_MS);
}
