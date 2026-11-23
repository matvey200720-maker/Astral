import { useEffect, useState } from "react";
import { readOwnWorks } from "./component-works.js";

/*
 * Сохранённые работы мастерской (`listWorkshopWorks`) для карточки сборки. Читаются по нужде: карточке, у которой никто не ставил свою работу на
 * место компонента, они не нужны, и тяжёлый модуль мастерской не подгружается. `null` — ещё не прочитаны.
 */
export function useOwnWorks(wanted) {
  const [works, setWorks] = useState(null);
  useEffect(() => {
    if (!wanted) return undefined;
    let alive = true;
    readOwnWorks()
      .then((list) => {
        if (alive) setWorks(list);
      })
      .catch(() => {
        if (alive) setWorks([]);
      });
    return () => {
      alive = false;
    };
  }, [wanted]);
  return wanted ? works : null;
}
