import { useEffect, useState } from "react";
import { workCodeFingerprint } from "./build-works.js";
import { workVerdicts } from "./work-verdicts.js";

const NONE = new Map();

/*
 * Ответы по работам сборки (`work-verdicts.js`) для окна: считаются после отрисовки (разбор кода работы и установщика
 * ленивый), пока считаются — пустой `Map`, и окно пишет прочерк вместо числа. Меняется состав работ или то, что стоит у
 * человека, — считается заново; устаревший ответ не показывается.
 */
export function useWorkVerdicts(entries, { workItems = [], installedIds, allMods = [] } = {}) {
  const [done, setDone] = useState({ key: "", map: NONE });
  const key = entries.length
    ? [
        entries.map((entry) => `${entry.workKind}:${entry.slotId}:${workCodeFingerprint(entry.code)}`).join("|"),
        workItems.map((item) => item.key).join(","),
        [...(installedIds || [])].join(","),
      ].join("#")
    : "";
  useEffect(() => {
    if (!key) return undefined;
    let current = true;
    workVerdicts(entries, { workItems, installedIds: installedIds || new Set(), allMods }).then((map) => {
      if (current) setDone({ key, map });
    });
    return () => {
      current = false;
    };
    // Ответ зависит от состава работ и от того, что стоит, — это и есть `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && done.key === key ? done.map : NONE;
}
