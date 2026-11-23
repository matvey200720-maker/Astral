import { bushStyleOf, createVegetationProject, normalizeVegetationProject } from "@modovik/climb-contract/recolor/vegetation";

/*
 * Кусты своим цветом и живые изгороди своего цвета через носители (GTA 5 RP, 21.11.2026, ветка `j3/veg-bushes-carrier`; «кусты меняли свои цвета… чтобы у растительности всё менялось, как у нас
 * в мастерской»). До этого в режиме RP кусты своим цветом (`bushes.mode === "colour"`) получали «часть не едет» (`bushes` в `droppedParts`), а изгороди ехали только как листва общего цвета деревьев.
 *
 * Здесь вся логика единиц `bushes` и `hedges` для режима своего цвета; `vegetation-update-install.js` и `vegetation-container-build.js` зовут её тонкими вызовами (шов, согласованный с rw, 21.11).
 * Модуль чистый: ввода-вывода нет, подсчёт сборки подаёт вызывающий.
 *
 * Правила:
 *  • `bushes` — кусты своим цветом: модели и словари кустов, карточки вдали, листы «bush» в файлах деревьев (подсчёт сборки по работе из одних кустов, без изгородей);
 *  • `hedges` — живые изгороди (687 словарей): разница подсчётов тех же кустов с изгородями и без. Сборка в режиме своего цвета красит изгороди ВМЕСТЕ с кустами (отдельно изгороди не собрать), поэтому
 *    изгороди едут только если легли кусты: кусты отказаны (по плану или после сборки) — изгороди отказаны теми же кодом и числами;
 *  • порядок единиц в носителе: трава, кусты, изгороди, цветы (`VEGETATION_CARRIER_GROUPS`);
 *  • кусты «как листва» (общий цвет деревьев) идут по-прежнему: кусты — с деревьями, изгороди — единицей `hedges`.
 */

/** Кусты со своим цветом (`bushes.mode === "colour"`): не «как листва» (едут с деревьями) и не «как в игре». */
export const ownBushesColour = (project) => normalizeVegetationProject(project).bushes.mode === "colour";

/** Единицы кустов и изгородей, что просятся в носитель, в порядке «кусты, изгороди»: свой цвет — обе (изгороди, если включены), «как листва» — только изгороди (как было), иначе — ничего. */
export function bushUnitsOf(project) {
  const normal = normalizeVegetationProject(project);
  const own = ownBushesColour(normal);
  const units = [];
  if (own) units.push("bushes");
  if (normal.bushes.hedges && (own || bushStyleOf(normal)?.follow === true)) units.push("hedges");
  return units;
}

/**
 * Условия плана для раскладчика: `own` — кусты своим цветом; `needs` — какая единица без какой не едет (`{ hedges: "bushes" }`); `forced` — отказанные ПОСЛЕ сборки единицы с добавленным отказом изгородей,
 * когда отказаны кусты (теми же кодом и числами).
 */
export function bushesPlanTerms({ normal, allUnits, forcedRefused }) {
  const own = ownBushesColour(normal);
  const forced = { ...(forcedRefused || {}) };
  if (own && forced.bushes && !forced.hedges && allUnits.includes("hedges")) forced.hedges = forced.bushes;
  return { own, forced, needs: own ? { hedges: "bushes" } : {} };
}

/** Работа для сборки после выбора единиц: цвет кустов — тот, что выбрал человек; изгороди своего цвета — только если и они легли. `adjusted` — работа с уже выбранными деревьями и травой. */
export function withOwnBushes(adjusted, normal, chosen) {
  return normalizeVegetationProject({ ...adjusted, bushes: { mode: "colour", look: normal.bushes.look, hedges: chosen.includes("hedges") } });
}

/** Работа для подсчёта: одни кусты своего цвета (без деревьев, травы и цветов), изгороди включены или нет. */
export function bushesOnlyProject(normal, hedges) {
  return normalizeVegetationProject({ ...createVegetationProject(), name: normal.name, bushes: { mode: "colour", look: normal.bushes.look, hedges } });
}
