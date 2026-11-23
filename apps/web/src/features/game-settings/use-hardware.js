import { readHardware } from "../../api.js";
import { recommendPreset } from "@modovik/optimizer/recommend-preset.js";
import { useEffect, useMemo, useState } from "react";

// Снимок железа лежит в хранилище вкладки, а не на диске: после перезапуска он не
// должен подсказывать оборудование, которого в машине уже нет (коммит 15cfaf9d3).
const KEY = "astral-graphics-hardware";

const quiet = (job) => {
  try {
    return job();
  } catch {
    return null;
  }
};

export const forgetHardwareForTests = () => {
  quiet(() => sessionStorage.removeItem(KEY));
};

// Опрос тяжёлый (powershell и CIM): сначала показывается снимок, свежий ответ догоняет
// в фоне; пустой ответ и отказ ничего не меняют.
export function useHardware() {
  const [snapshot, setSnapshot] = useState(() => quiet(() => JSON.parse(sessionStorage.getItem(KEY) ?? "null")));

  useEffect(() => {
    let cancelled = false;
    const catchUp = async () => {
      let fresh;
      try {
        fresh = await readHardware();
      } catch {
        return;
      }
      if (cancelled || !fresh) return;
      quiet(() => sessionStorage.setItem(KEY, JSON.stringify(fresh)));
      setSnapshot(fresh);
    };
    catchUp();
    return () => {
      cancelled = true;
    };
  }, []);

  return snapshot;
}

// Страница берёт из рекомендации только id для пометки «Рекомендуем» (ТЗ 23.10.2026, п. H);
// железо не прочитано — рекомендации нет, страница ничего не домысливает.
export const useRecommendation = () => {
  const hardware = useHardware();
  return useMemo(() => recommendPreset(hardware), [hardware]);
};
