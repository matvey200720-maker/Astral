import { useEffect, useState } from "react";

/*
 * Отметки в прочитанном коде («Новая сборка» → «По коду», 31.10.2026): как у модов
 * библиотеки (`use-new-build-picks.js`), хранится то, что снято. Другой код — другие отметки.
 *
 * В сборку уходит отмеченное (`pickedIds`). Запись кода, которой нет в каталоге (мод сняли, в
 * старой сборке лежала установка мастерской), раньше роняла весь код отказом «нет релиза».
 * Каталог едет или недоступен (`pending`) — мод остаётся: снять его человек не мог, а выбросить
 * значило бы прочитать код в пустую сборку. В облаке мод без опубликованного релиза не отмечается:
 * сохранить такой сервер не может, как и в «Из установленного» (`newBuildModIds`).
 */
export function useCodePicks({ importCode, importMods, blockOf, cloud = false }) {
  const [unticked, setUnticked] = useState(() => new Set());
  useEffect(() => setUnticked(new Set()), [importCode]);
  const tickable = importMods.filter(
    (mod) => !mod.pending && !mod.missing && !blockOf(mod.id) && (!cloud || mod.releaseId),
  );
  const enabledIds = new Set(tickable.map((mod) => mod.id).filter((id) => !unticked.has(id)));
  return {
    selection: {
      enabledIds,
      onToggle: (id) =>
        setUnticked((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      onSetAll: (on) => setUnticked(new Set(on ? [] : tickable.map((mod) => mod.id))),
    },
    pickedIds: importMods
      .filter((mod) => enabledIds.has(mod.id) || mod.pending)
      .map((mod) => mod.id),
  };
}
