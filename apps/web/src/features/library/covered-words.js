import { tr } from "../../locales/ui.js";

/*
 * «Заменён» — новый мод старше (слово владельца 18.11.2026): место мода целиком
 * занял более новый слой (работа мастерской или другой мод поверх), в игре его
 * не видно, но он записан установленным. Библиотека говорит это словом, а не
 * делает вид, что он стоит. `covered` — `libraryStatus.covered`
 * (`[{ modId, by }]`, `coveredMods` главного процесса). Кем — по имени из
 * каталога окна или из записей установок мастерской; имени нет — просто
 * «Заменён». Пустая строка — мод на виду.
 */
export function coveredWords({ covered, modId, mods = [], units = [] }) {
  const hit = modId ? covered?.find((item) => item.modId === modId) : null;
  if (!hit) return "";
  const by =
    mods.find((mod) => mod.id === hit.by)?.name ||
    units.find((unit) => unit.modId === hit.by)?.name ||
    "";
  return by ? `${tr("Заменён")}: ${by}` : tr("Заменён");
}
