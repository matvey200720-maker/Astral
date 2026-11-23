import * as hc from "./hibernation-client.js";
import { useEffect, useRef, useState } from "react";

// Спячка окна (21.10.2026). Разбор 02.11.2026: окно уснуло посреди установок, потому что главный считал
// молчание согласием; теперь очередь сама держит сон и сообщает об этом на каждую смену причины.

// Начальное состояние оболочки после сна: пусто, null и "" — как «нет»; 0 и false — настоящие значения
export const shellRestored = (key, fallback) => {
  const v = hc.restoredPart("shell")?.[key];
  if (v === undefined || v === null || v === "") return typeof fallback === "function" ? fallback() : fallback;
  return v;
};

// Упавшая строка очереди сон не держит; ждущие и идущие — одинаково
export const queueHoldsSleep = (q = []) => Array.isArray(q) && !q.every((row) => row?.failed);

// Причины видны только в журнале главного процесса, поэтому остаются русскими без перевода
export const holdReason = (q, writing = false) =>
  queueHoldsSleep(q) ? "загрузки в очереди" : writing ? "мастерская ставит в игру" : null;

const reasonOf = (p) => holdReason(p.queue, p.workshopWriting);

export function useShellHibernation(p) {
  // свежие свойства лежат в ссылке: часть оболочки регистрируется один раз
  const now = useRef(p);
  now.current = p;
  const reason = reasonOf(p);

  useEffect(
    () =>
      hc.registerHibernationState("shell", {
        busy: () => reasonOf(now.current),
        snapshot: () => ({
          page: now.current.page,
          settingsOpen: now.current.settingsOpen,
          catalogGroup: now.current.catalogGroup,
          detailMod: now.current.detailMod,
          detailReturnPage: now.current.detailReturnPage,
          scroll: document.querySelector(".desktop-main")?.scrollTop || 0,
        }),
      }),
    [],
  );

  useEffect(() => {
    Promise.resolve(window.modovik?.hibernation?.hold?.(reason)).catch(() => {});
  }, [reason]);

  // пробуждение читается один раз: после «готово» waking остаётся true
  const [waking] = useState(hc.wokeFromHibernation);
  const [target] = useState(() => hc.restoredPart("shell")?.scroll || 0);
  const ready = waking && p.bootstrapped;

  // ставит прокрутку, когда список дорастёт (он приходит позже раздела), и говорит главному «готово»
  useEffect(() => {
    if (!ready) return undefined;
    const t0 = performance.now();
    let id;
    function step() {
      const box = document.querySelector(".desktop-main");
      if (target && box && target <= box.scrollHeight - box.clientHeight) box.scrollTop = target;
      if (!target || box?.scrollTop >= target - 1 || performance.now() - t0 > 4000) hc.finishHibernationRestore();
      else id = requestAnimationFrame(step);
    }
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [ready, target]);

  return waking;
}
