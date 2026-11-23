import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { moveId } from "../queue-order.js";

/*
 * Перестановка строк списка за ручку: мышью и пальцем (тянуть) и с клавиатуры (фокус на ручке, ↑ и ↓; Home и End — в начало и в конец).
 * Владелец, 16.11.2026: порядок очереди «Загрузок» меняется перетаскиванием за левую ручку, «куда угодно».
 *
 * Хук ничего не знает о том, что за строки: ему даны их `ids` и функция `onOrder(новые ids)`. Каждая строка помечается `data-sort-id`, ручка получает
 * `gripProps(id)`. Пока строку тянут, список перестраивается «вживую» (`order`), а тянутая строка едет за указателем (`offsetOf`) — в своё место она встаёт
 * на отпускании. Escape и потеря указателя отменяют перетаскивание, и порядок не меняется.
 */

const NO_DRAG = null;

/** Где встанет строка `id`, если её центр сейчас на высоте `center`: сколько остальных строк по их исходным центрам выше неё. */
function targetIndex(ids, id, rects, center) {
  let above = 0;
  for (const other of ids) {
    if (other === id) continue;
    const rect = rects.get(other);
    if (rect && rect.top + rect.height / 2 < center) above += 1;
  }
  return above;
}

/**
 * @param {{ ids: string[], onOrder: (ids: string[]) => void }} options
 */
export function useSortableRows({ ids, onOrder }) {
  const listRef = useRef(null);
  const [drag, setDrag] = useState(NO_DRAG);
  const [message, setMessage] = useState("");
  const session = useRef(null);
  const focusAfter = useRef("");
  const latest = useRef({ ids, onOrder });
  latest.current = { ids, onOrder };

  const finish = useCallback((commit) => {
    const current = session.current;
    session.current = null;
    setDrag(NO_DRAG);
    if (!current || !commit) return;
    const { ids: shown, onOrder: apply } = latest.current;
    if (current.draft.join("\n") !== shown.join("\n")) apply(current.draft);
  }, []);

  /* Escape отменяет перетаскивание, пока оно идёт. */
  useEffect(() => {
    if (!drag) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      finish(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [drag, finish]);

  /* После перестановки с клавиатуры строка в разметке переехала: ручке возвращается фокус. */
  const signature = ids.join("\n");
  useLayoutEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = "";
    const grips = listRef.current?.querySelectorAll("[data-grip]") || [];
    for (const grip of grips) {
      if (grip.dataset.grip === id) grip.focus({ preventScroll: true });
    }
  }, [signature]);

  const begin = (event, id) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const list = listRef.current;
    if (!list) return;
    const rects = new Map();
    for (const row of list.querySelectorAll("[data-sort-id]")) {
      rects.set(row.dataset.sortId, row.getBoundingClientRect());
    }
    if (!rects.has(id)) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* указатель уже ушёл (палец сняли, окно потеряло фокус): тянуть нечем, но и падать незачем */
    }
    const top = Math.min(...[...rects.values()].map((rect) => rect.top));
    session.current = { id, startY: event.clientY, rects, top, draft: ids };
    setDrag({ id, dy: 0, draft: ids, offset: 0 });
  };

  const move = (event) => {
    const current = session.current;
    if (!current) return;
    const dy = event.clientY - current.startY;
    const own = current.rects.get(current.id);
    const center = own.top + own.height / 2 + dy;
    const draft = moveId(
      latest.current.ids,
      current.id,
      targetIndex(latest.current.ids, current.id, current.rects, center),
    );
    current.draft = draft;
    /* Где тянутая строка лежала бы в разметке сейчас, и сколько до указателя. */
    const before = draft.slice(0, draft.indexOf(current.id));
    const natural =
      current.top +
      before.reduce(
        (sum, key) => sum + (current.rects.get(key)?.height || 0),
        0,
      );
    setDrag({ id: current.id, dy, draft, offset: own.top + dy - natural });
  };

  const keyDown = (event, id) => {
    const at = latest.current.ids.indexOf(id);
    if (at === -1) return;
    const last = latest.current.ids.length - 1;
    const target =
      event.key === "ArrowUp"
        ? at - 1
        : event.key === "ArrowDown"
          ? at + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = moveId(
      latest.current.ids,
      id,
      Math.min(Math.max(target, 0), last),
    );
    if (next === latest.current.ids) return;
    focusAfter.current = id;
    setMessage(`${next.indexOf(id) + 1}/${next.length}:${id}`);
    latest.current.onOrder(next);
  };

  const gripProps = (id) => ({
    "data-grip": id,
    onPointerDown: (event) => begin(event, id),
    onPointerMove: move,
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onKeyDown: (event) => keyDown(event, id),
  });

  return {
    listRef,
    order: drag ? drag.draft : ids,
    draggingId: drag ? drag.id : "",
    offsetOf: (id) => (drag && drag.id === id ? drag.offset : 0),
    gripProps,
    /** «место/всего:id» — последняя перестановка клавишей; слова к ней собирает вызывающий. */
    moved: message,
  };
}
