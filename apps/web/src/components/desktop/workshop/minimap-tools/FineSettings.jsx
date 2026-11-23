import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * «Тонкая настройка» (владелец, 22.11.2026: «должно быть всё просто… когда много наляпов, очень непонятно»).
 *
 * Правило «без лавины»: в каждом инструменте сверху — выбор готового вида и несколько главных ручек, а всё остальное лежит в одном
 * сворачиваемом разделе «Тонкая настройка», по умолчанию закрытом. Возможности те же, они только сгруппированы.
 *
 * Как устроено. `FineHost` стоит вокруг панели инструмента и держит место (`FineSlot`) в её конце. Любой раздел внутри панели, обёрнутый
 * в `<Fine>`, рисуется не на месте, а в этом месте — через портал. Так составная панель (цвета, значки, GPS…) отдаёт «тонкие» разделы
 * одним обёртыванием, без передачи флагов через все уровни. Вне `FineHost` (проба, старые тесты) `<Fine>` рисует разделы на месте.
 * Пока в месте нет ни одного раздела, «Тонкая настройка» не показывается.
 */

const FineContext = createContext(null);

/* Хозяин места: панель инструмента оборачивается им целиком. */
export function FineHost({ children }) {
  const [slot, setSlot] = useState(null);
  const [count, setCount] = useState(0);
  const bump = useCallback((step) => setCount((value) => value + step), []);
  const value = useMemo(() => ({ slot, count, bump }), [slot, count, bump]);
  return (
    <FineContext.Provider value={value}>
      {children}
      <FineSlot setSlot={setSlot} count={count} />
    </FineContext.Provider>
  );
}

function FineSlot({ setSlot, count }) {
  useTr();
  return (
    <details
      className="mmc-fine"
      data-fine
      hidden={count === 0}
      aria-hidden={count === 0 ? "true" : undefined}
    >
      <summary className="mmc-fine-summary">{tr("Тонкая настройка")}</summary>
      <div className="mmc-fine-body" ref={setSlot} />
    </details>
  );
}

/* Раздел «тонкой настройки»: уходит в место `FineHost`, а без него остаётся на месте. */
export function Fine({ children }) {
  const host = useContext(FineContext);
  const bump = host?.bump;
  useLayoutEffect(() => {
    if (!bump) return undefined;
    bump(1);
    return () => bump(-1);
  }, [bump]);
  if (!host) return children;
  /* Место ещё не появилось (первый кадр): ничего не рисуем, чтобы раздел не мигнул на чужом месте. */
  if (!host.slot) return null;
  return createPortal(children, host.slot);
}
