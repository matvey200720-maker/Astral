import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Главный прокручиваемый блок оболочки ищется заново при каждом обращении.
const mainBlock = () => globalThis.document?.querySelector(".desktop-main") ?? null;

const scrollMainTo = (top) => {
  const block = mainBlock();
  if (block) block.scrollTo({ top, left: 0 });
};

// След после перехода: страница, на которую уже заходили, обрезает след
// до записей перед ней, иначе уходящая страница ложится в конец.
const nextTrail = (entries, leaving, nextId) => {
  const at = entries.map((entry) => entry.mod.id).indexOf(nextId);
  return at === -1 ? entries.concat([leaving]) : entries.slice(0, at);
};

// Действия, которым не нужен текущий след: живут столько же, сколько компонент.
const trailActions = (setEntries) => ({
  follow(from, next) {
    if (!from) {
      setEntries([]);
      return;
    }
    const nextId = next?.id;
    if (from.id === nextId) return;
    const leaving = { mod: from, top: mainBlock()?.scrollTop || 0 };
    setEntries((latest) => nextTrail(latest, leaving, nextId));
  },
  reset() {
    setEntries([]);
  },
});

// Возврат работает по следу той отрисовки, в которой он создан.
function popTrail(entries, setEntries, pending, show) {
  if (entries.length === 0) return false;
  const head = entries.slice(0, -1);
  const tail = entries[head.length];
  pending.current = { top: tail.top };
  setEntries(head);
  show(tail.mod);
  return true;
}

export const useDetailTrail = () => {
  const [entries, setEntries] = useState([]);
  // Прокрутка, которую надо вернуть блоку после ближайшей отрисовки следа.
  const pending = useRef(null);
  const [{ follow, reset }] = useState(() => trailActions(setEntries));
  const back = useCallback((show) => popTrail(entries, setEntries, pending, show), [entries]);

  useLayoutEffect(() => {
    const waiting = pending.current;
    if (waiting === null) return;
    pending.current = null;
    scrollMainTo(waiting.top);
  }, [entries]);

  const backName = entries.at(-1)?.mod.name || "";

  return { follow, back, reset, backName };
};
