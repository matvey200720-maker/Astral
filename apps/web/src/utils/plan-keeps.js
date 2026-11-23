/*
 * Что из конфликтов плана окно называет к замене (22.11.2026, правило «по стволам», решение лида 1).
 *
 * Движок кладёт в конфликт плана поле `keeps` — слоты прежней работы, которых у нового пакета нет (`plan-install.js`): ганпак из трёх стволов и новый на один. Такая работа целиком не заменяется,
 * новая ложится слоем поверх общих записей, остальные стволы остаются (`install-engine/plan-conflict-ids.js`, тот же помощник у ганпака и скина мастерской). Окно раньше называло к замене все
 * конфликты подряд и через `replaceModIds` снимало такую работу целиком. Здесь правило одно для всех мест окна, что превращают `plan.conflicts` в список замены (`catalogConflicts.js`,
 * `builds/install-plan.js`): пустой или отсутствующий `keeps` (старый ответ движка, одно место, тот же слот) — заменяется, как раньше.
 */

/*
 * Правило только для СТВОЛОВ (поправка 23.11.2026 после второго чтения): `keeps` движок ставит любому конфликту, где у прежней работы есть слоты, которых нет у нового пакета, — у обычного мода
 * каталога слот свой (`catalog-<id>`), у одежды `clothing-…`, и два таких мода на общую запись давали бы непустой `keeps`: прежний мод перестал бы заменяться. Остающейся работа считается, только
 * когда у конфликта есть общий слот ствола (`slots` — `weapon-…`) и непустой `keeps`; остальное — как в 1.0.2.
 */
const WEAPON_SLOT = /^weapon-/;

/** Прежняя работа остаётся под новой: общий слот ствола и слоты, которых нет у нового пакета. */
export const keptByPlan = (conflict) =>
  Array.isArray(conflict?.keeps) &&
  conflict.keeps.some((slot) => WEAPON_SLOT.test(String(slot))) &&
  Array.isArray(conflict?.slots) &&
  conflict.slots.some((slot) => WEAPON_SLOT.test(String(slot)));

/** Ганпак каталога стоит «по компонентам» (стволами): записей под id пака нет, его id окно добавляет к установленным — заменять там нечего и говорить «заменено» не о чем. */
export const standsByParts = (mod, ids = []) => mod?.domain?.weapon?.pack === true && Array.isArray(mod.includedModIds) && mod.includedModIds.some((id) => ids.includes(id));

/** Конфликты плана, что заменяются целиком (без остающихся слотов). */
export const replacedConflicts = (plan) => (Array.isArray(plan?.conflicts) ? plan.conflicts : []).filter((conflict) => !keptByPlan(conflict));

/** Id работ, что остаются (как их называет движок: id манифеста или slug). */
export const keptModIds = (plan) => new Set((Array.isArray(plan?.conflicts) ? plan.conflicts : []).filter(keptByPlan).map((conflict) => conflict.modId));

/** Мод каталога (`id` или `slug`) — среди остающихся работ плана. */
export const isKeptMod = (kept, mod) => Boolean(mod) && (kept.has(mod.id) || (Boolean(mod.slug) && kept.has(mod.slug)));
