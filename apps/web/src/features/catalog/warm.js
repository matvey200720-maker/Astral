import { clothingOf } from "../clothing/clothing-catalog.js";
import { publicCatalogPreviewMods } from "../../components/desktop/catalog/preview-mods.js";
import { catalogPageMods } from "./catalog-page-mods.js";
import { catalogWarmView } from "../../components/desktop/catalog/PublicCatalog.jsx";
import { resultsInput, warmCatalogResults, warmResults } from "./useCatalogResults.js";

/*
 * Что греется в простое (`warm-schedule.js`): те же кэши по ответу каталога, что заполняет первый вход в каталог, — теми же вызовами с теми же аргументами
 * (`PublicCatalog.jsx`: `catalogPageMods(data.mods, publicCatalogPreviewMods)`, `useCatalogResults`: `listedMods` и `prepare`). Порциями: витрина, группы и паки,
 * затем блок одежды каждого мода кусками по времени простоя, затем сама выдача с условиями, с которыми страница откроется (`catalogWarmView`), — её фазы по куску
 * за простой (`warmResults`). Возвращает отмену.
 */
export function warmCatalog(mods, whenIdle) {
  let cancelled = false;
  let cancel = () => {};
  let listed = [];
  let index = 0;
  let pageMods = null;
  let cancelResults = () => {};
  /* Каждый шаг — свой вызов простоя: витрина (~10 мс при обычном ПК), затем группы и паки. */
  const steps = [
    () => {
      pageMods = catalogPageMods(mods, publicCatalogPreviewMods);
    },
    () => {
      listed = warmCatalogResults(pageMods);
    },
  ];
  const results = () => {
    cancelResults = warmResults(resultsInput({ mods: pageMods, ...catalogWarmView(pageMods) }), whenIdle);
  };
  const chunk = () => {
    const until = performance.now() + 6;
    while (index < listed.length && performance.now() < until) clothingOf(listed[index++]);
    return index >= listed.length;
  };
  const next = () => {
    if (cancelled) return;
    const step = steps.shift();
    if (step) step();
    else if (chunk()) {
      results();
      return;
    }
    cancel = whenIdle(next);
  };
  cancel = whenIdle(next);
  return () => {
    cancelled = true;
    cancel();
    cancelResults();
  };
}
