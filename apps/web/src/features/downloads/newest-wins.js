/*
 * «Новый мод старше» (слово владельца 18.11.2026): в одном месте игры стоит
 * то, что поставлено последним, и между вещами Astral вопроса нет. Прежний
 * мод уходит той же установкой, работа мастерской на тех же файлах ложится
 * под мод и возвращается, когда мод снимут. Человеку вместо вопроса — строка
 * в «Загрузках»: что именно заменено (названия), не блокирующая.
 *
 * Что уйдёт, знает план движка: `plan.conflicts` (моды) и `plan.nativeUnder`
 * (работы мастерской, правящие те же файлы нативным патчем). Названия мода
 * берутся из каталога окна, названия работ — из записей установок окна;
 * записи не нашлось — «работа мастерской» (слова подставляет место
 * отрисовки: язык меняется, а очередь живёт дольше).
 */

import { tr, trIn } from "../../locales/ui.js";
import { readWorkshopInstallUnits } from "../../workshop-library.js";

/**
 * Режим RP, «новое заменяет старое» (слово владельца 22.11.2026): работы, которые движок снял сам, потому что новая перекрыла их целиком (`engineReplaced` в итоге установки,
 * `packages/install-engine/host-standing.js`), попадают в `replaceIds` строки — и «Загрузки» говорят о них тем же словом, что о названной замене («установлен вместо конфликтующих»).
 */
export function withEngineReplaced(row, result) {
  const ids = Array.isArray(result?.engineReplaced) ? result.engineReplaced.filter((id) => typeof id === "string") : [];
  return ids.length ? { ...row, replaceIds: [...new Set([...(row?.replaceIds || []), ...ids])] } : row;
}

/** Названия модов, которые вытеснит установка (`replaceIds` → имена каталога окна, каждое один раз). */
export function replacedNamesOf(replaceIds = [], mods = []) {
  const names = replaceIds.map(
    (id) => mods.find((mod) => mod.id === id || mod.slug === id)?.name || "",
  );
  return [...new Set(names.filter(Boolean))];
}

/** Работы мастерской, которые ляжут под мод: имена из записей установок; без имени — пустая строка. */
export function underWorkNames(plan) {
  const works = Array.isArray(plan?.nativeUnder) ? plan.nativeUnder : [];
  if (!works.length) return [];
  const units = readWorkshopInstallUnits();
  return works.map(
    (work) =>
      units.find((unit) => unit.patch && unit.patch === work.patch)?.name || "",
  );
}

const joined = (names) => names.join(", ");

/**
 * Строка установки в «Загрузках»: «Заменено: А, Б · Поверх работ: В». Пусто,
 * когда ничего не заменяется. Слова берутся на языке окна сейчас, а не на
 * том, на котором строку поставили в очередь.
 */
export function newestWinsLine(row, language) {
  const parts = [];
  if (row?.replacedNames?.length)
    parts.push(`${trIn(language, "Заменено")}: ${joined(row.replacedNames)}`);
  if (row?.underWorks?.length) {
    const fallback = trIn(language, "работа мастерской");
    parts.push(
      `${trIn(language, "Поверх работ")}: ${joined(row.underWorks.map((name) => name || fallback))}`,
    );
  }
  return parts.join(" · ");
}

/** Всплывашка при постановке в очередь: что встанет вместо чего. */
export const replacedNotice = (name, names) =>
  tr("{0}: заменит {1}").replace("{0}", name).replace("{1}", joined(names));
