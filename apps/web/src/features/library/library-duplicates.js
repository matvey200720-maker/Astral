/*
 * Дубли в библиотеке (владелец, 16.11.2026): «если мод дублируется — два мода на одно место, — подскажи удалить один из дублей».
 *
 * Дубль — это когда на одном месте игры стоят два мода и один из них лишний: второй всё равно перекрывает первого. Считается по карточкам полки
 * (`entries` корзины, `useLibraryShelfRemoval`), больше ничего знать не нужно. Два признака:
 *   - `place`: в одной карточке стоят два и больше модов каталога — слот у них общий (`units` с `kind: "mod"` и разными `modId`);
 *   - `twin`: две разные карточки делят хотя бы один слот редактора (`slots`) — это одно место на разных плитках.
 *
 * Только читает и возвращает карту «карточка → что за дубль»; ничего не отмечает и не удаляет: что из двух лишнее, решает человек.
 */

/** @param {{ id: string, title?: string, slots?: string[], units?: { kind?: string, modId?: string }[] }[]} entries */
export function libraryDuplicates(entries) {
  const found = new Map();
  const list = Array.isArray(entries) ? entries : [];

  const owners = new Map();
  for (const entry of list)
    for (const slot of new Set(entry.slots || [])) {
      if (!owners.has(slot)) owners.set(slot, []);
      owners.get(slot).push(entry);
    }

  for (const entry of list) {
    const mods = new Set(
      (entry.units || [])
        .filter((unit) => unit.kind === "mod" && unit.modId)
        .map((unit) => unit.modId),
    );
    if (mods.size >= 2)
      found.set(entry.id, { kind: "place", count: mods.size });
  }

  for (const sharing of owners.values()) {
    if (sharing.length < 2) continue;
    for (const entry of sharing) {
      if (found.has(entry.id)) continue;
      const other = sharing.find((item) => item.id !== entry.id);
      found.set(entry.id, { kind: "twin", with: other?.title || "" });
    }
  }
  return found;
}
