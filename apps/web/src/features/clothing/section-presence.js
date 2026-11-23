/*
 * Какие разделы окно «На что поставить?» показывает (правило ведущей 16.11.2026, М2 матрицы целей):
 *   • раздел, в котором нет целей НИ на одной из трёх вкладок («GTA», Majestic, GTA 5 RP) — «Рот» у аксессуаров головы и т. п., — не показывается вовсе: ставить некуда нигде;
 *   • раздел, пустой только на текущей вкладке, остаётся в ряду приглушённым с подсказкой «На этой вкладке таких вещей нет»; щелчок по нему не ломает окно (вместо списка — строка и вкладки, где вещи есть);
 *   • свой раздел вещи — всегда (`head` на Majestic и GTA 5 RP — часть тела: строка почему);
 *   • выбранный сейчас раздел не пропадает из ряда у человека под рукой.
 * Число вещей раздела на вкладке: «GTA» — по строкам оглавления игры (`useGameRows`), вкладки проектов — по базе вещей серверов (`BASE_COUNTS`: куски, из которых вкладка и собирается; вещи, которые приносит
 * реестр проекта или вики Majestic поверх базы, число не уменьшают — приглушённый раздел остаётся нажимаемым). Игра ещё читается — число «GTA» неизвестно (`null`), и раздел ничего не теряет.
 * Чистые функции без React: ими же считает таблица видов (`scripts/target-matrix-offline.mjs`).
 */
import { BASE_COUNTS } from "@modovik/clothing/server-base";
import { TARGET_TABS } from "@modovik/clothing/target-tabs";

const counted = new WeakMap();

/** Строки игры → таблица «пол|вид → сколько» (пустышки без модели не считаются, как и в списке окна); не список — `null`. Тот же список строк — та же таблица. */
export function gameRowCounts(rows) {
  if (!Array.isArray(rows)) return null;
  let table = counted.get(rows);
  if (!table) {
    table = new Map();
    for (const row of rows) {
      if (row?.blank) continue;
      const key = `${row.gender}|${row.component}`;
      table.set(key, (table.get(key) || 0) + 1);
    }
    counted.set(rows, table);
  }
  return table;
}

const gendersOf = (gender) =>
  (Array.isArray(gender) ? gender : [gender]).filter(Boolean);

/**
 * Сколько вещей раздела `id` на вкладке `tab` (id вкладки: «gta», «majestic», «gta5rp») для полов `gender` (строка или список). `game` — `{ ready, rows }` (`useGameRows`) или `null`, если оглавление игры не
 * передали (считаем, что прочитать его нельзя). `null` в ответе — «ещё не известно» (игра читается).
 */
export function tabCount({ tab, gender, id, game = null }) {
  const found = TARGET_TABS.find((entry) => entry.id === tab);
  if (!found) return 0;
  const genders = gendersOf(gender);
  if (found.server)
    return genders.reduce(
      (sum, one) => sum + (BASE_COUNTS[`${found.server}|${one}|${id}`] || 0),
      0,
    );
  if (game && game.ready === false) return null;
  /* `game.table` — готовые числа («пол|вид → сколько»): так считает таблица видов по выгрузке оглавления, без строк. */
  const table = game?.table ?? gameRowCounts(game?.rows);
  return table
    ? genders.reduce((sum, one) => sum + (table.get(`${one}|${id}`) || 0), 0)
    : 0;
}

/** Числа по всем вкладкам: `{ gta, majestic, gta5rp }`. */
export const tabCounts = (query) =>
  Object.fromEntries(
    TARGET_TABS.map((entry) => [
      entry.id,
      tabCount({ ...query, tab: entry.id }),
    ]),
  );

/**
 * Состояние раздела на вкладке: `{ state: "shown" | "muted" | "hidden", why, counts }`. `why`: «own» (свой раздел), «selected» (выбран сейчас), «nowhere» (нет целей ни на одной вкладке — скрыт),
 * «own-empty» (свой раздел пуст на этой вкладке — показан, причина строкой в списке), «here» (чужой, на этой вкладке нет — приглушён), «ok». `section` — запись `crossSections` (`{ id, own, cross }`).
 */
export function sectionPresence({
  section,
  tab,
  gender,
  game = null,
  selected = "",
}) {
  const counts = tabCounts({ gender, id: section.id, game });
  const known = Object.values(counts).every((count) => count !== null);
  const nowhere = known && Object.values(counts).every((count) => count === 0);
  const here = counts[tab];
  if (section.own)
    return { state: "shown", why: here === 0 ? "own-empty" : "own", counts };
  if (nowhere)
    return selected === section.id
      ? { state: "muted", why: "selected", counts }
      : { state: "hidden", why: "nowhere", counts };
  return here === 0
    ? { state: "muted", why: "here", counts }
    : { state: "shown", why: "ok", counts };
}

/**
 * Разделы для ряда чипов: без скрытых; у каждого — `muted` (чужой раздел пуст на этой вкладке), `counts` и `ownEmpty` (свой раздел пуст на вкладке: остаётся обычным чипом, причина — строкой в списке).
 */
export function visibleSections({
  sections,
  tab,
  gender,
  game = null,
  selected = "",
}) {
  const out = [];
  for (const section of sections) {
    /* Выключенный чип части тела (`blocked`, 18.11.2026): вещи там не бывает ни на одной вкладке — правило «нет целей» к нему не применяется, он стоит в ряду и объясняет почему. */
    if (section.blocked) {
      out.push({ ...section, muted: false, ownEmpty: false, counts: {} });
      continue;
    }
    const presence = sectionPresence({ section, tab, gender, game, selected });
    if (presence.state === "hidden") continue;
    out.push({
      ...section,
      muted: presence.state === "muted",
      ownEmpty: presence.why === "own-empty",
      counts: presence.counts,
    });
  }
  return out;
}

/** Вкладки, где у раздела есть вещи: `[{ id, label, count }]` (неизвестное число — «есть»: игру ещё читают). */
export function tabsWithItems({ counts, tab }) {
  return TARGET_TABS.filter(
    (entry) => entry.id !== tab && counts?.[entry.id] !== 0,
  ).map((entry) => ({
    id: entry.id,
    label: entry.label,
    count: counts?.[entry.id] ?? null,
  }));
}
