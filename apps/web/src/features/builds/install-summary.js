import { conflictingMods } from "../../utils/catalogConflicts.js";

/*
 * Что сделает установка сборки с модами, которые отмечены «ставить» (ТЗ 10.10):
 * сколько встанут без замены, сколько заменят то, что уже стоит у человека, и
 * сколько уже в игре. Окно сборки пишет это под весом, чтобы до «Установить»
 * было видно, тронет ли сборка его моды.
 *
 * «Заменит» — то же правило, что у установки и у страницы мода
 * (`conflictingMods`: та же часть игры — слот ствола, мини-карта, таймцикл…).
 * Точный план по файлам движок считает только при установке; здесь — без сети
 * и без движка, по данным каталога. Мод сборки, который сам стоит и остаётся
 * отмеченным, своим не считается: он не «ваш, который заменят».
 *
 * Неотмеченные и те, что не встанут (`blockOf`), — «останутся в сборке»: так
 * строки окна складываются в «Модов». Отмеченный мод, который каталог ещё не
 * довёз (`pending`), и не в игре, и не судим — это `unknown`: окно пишет вместо
 * «0 без замены» и «0 заменят» прочерк, иначе неизвестное выдавалось бы за
 * ноль. Уже стоящий в игре такой мод считается «в игре» — это known без каталога.
 */

/*
 * Каждому моду сборки — что с ним сделает установка: `stays` (не отмечен или не встанет), `already` (уже в игре),
 * `unknown` (каталог ещё не довёз), `replacing` (заменит ваши моды: они в `yours`) или `fresh`. Сводка считает по этому
 * ответу, а плитка с «!» — по нему же: два счёта не разойдутся.
 */
function verdicts({
  mods = [],
  enabledIds = new Set(),
  installedIds = new Set(),
  allMods = [],
  blockOf = () => null,
  /* Что ещё из вашего заменит мод, кроме модов каталога: работы мастерской в той же части игры (ТЗ 24.10.2026, вечер, п. C). */
  extraConflicts = () => [],
}) {
  const installed = [...installedIds];
  const staying = new Set(
    mods
      .filter((mod) => enabledIds.has(mod.id) && installedIds.has(mod.id))
      .map((mod) => mod.id),
  );
  return mods.map((mod) => {
    if (!enabledIds.has(mod.id) || blockOf(mod.id))
      return { mod, kind: "stays" };
    if (installedIds.has(mod.id)) return { mod, kind: "already" };
    if (mod.pending) return { mod, kind: "unknown" };
    const yours = [
      ...conflictingMods(mod, installed, allMods).filter(
        (item) => !staying.has(item.id),
      ),
      ...extraConflicts(mod),
    ];
    return yours.length
      ? { mod, kind: "replacing", yours }
      : { mod, kind: "fresh" };
  });
}

/**
 * @returns {{ fresh: number, replacing: number, already: number, stays: number, unknown: number }}
 */
export function buildInstallSummary(input) {
  const summary = { fresh: 0, replacing: 0, already: 0, stays: 0, unknown: 0 };
  for (const { kind } of verdicts(input)) summary[kind] += 1;
  return summary;
}

/**
 * Общая сводка окна сборки (ТЗ 24.10.2026, вечер, п. C): к счёту модов (`buildInstallSummary`) добавляются работы мастерской
 * и установки старой сборки. Работа из кода — по своему ответу (`work-verdicts.js`: `already` / `replacing` / `fresh` / `stays`;
 * нет ответа — `unknown`); установка старой сборки (`items`) ничего не ставит, поэтому `stays`. «Из каталога» — все моды сборки,
 * «своих» — все работы: вместе они дают «Всего».
 */
export function buildContentsSummary(modSummary, { modCount = 0, works = [], items = [], verdicts = new Map() } = {}) {
  const sum = { ...modSummary };
  for (const entry of works) {
    const kind = verdicts.get(entry.code)?.kind || "unknown";
    sum[kind] = (sum[kind] || 0) + 1;
  }
  sum.stays += items.length;
  return { ...sum, total: modCount + works.length + items.length, catalog: modCount, own: works.length + items.length };
}

/**
 * Какие ваши моды заменит каждый мод сборки: `Map(id мода сборки → [ваши моды])`. Только те, что заменяют, — у них на
 * плитке «!» с именами (ТЗ 23.10, п. K: «заменят ваши моды — с восклицательным знаком, осторожно»).
 */
export function replacedByBuild(input) {
  return new Map(
    verdicts(input)
      .filter(({ kind }) => kind === "replacing")
      .map(({ mod, yours }) => [mod.id, yours]),
  );
}
