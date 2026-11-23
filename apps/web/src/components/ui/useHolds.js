import { useLayoutEffect, useRef } from "react";

export const HOLDS_ATTRIBUTE = "data-holds";

// Счётчики имён по элементам; запись живёт, пока жив элемент.
const ledger = new WeakMap();

// Меняет счётчик имени и переписывает атрибут целиком: имена по кодам знаков через пробел.
const adjust = (element, name, delta) => {
  const counts = ledger.get(element) ?? ledger.set(element, new Map()).get(element);
  const left = (counts.get(name) ?? 0) + delta;
  if (left > 0) counts.set(name, left);
  else counts.delete(name);
  if (!counts.size) return element.removeAttribute(HOLDS_ATTRIBUTE);
  element.setAttribute(HOLDS_ATTRIBUTE, [...counts.keys()].sort().join(" "));
};

export const hold = (element, token) => {
  adjust(element, token, 1);
  return () => {
    adjust(element, token, -1);
  };
};

// Вешает каждое имя на каждое место (без повторов и пустых), отдаёт одну функцию снятия.
const claim = (places, names) => {
  const drops = [];
  for (const place of new Set(places)) {
    if (place) for (const name of names) drops.push(hold(place, name));
  }
  return () => drops.forEach((drop) => drop());
};

export const useDocumentHolds = (token) => {
  useLayoutEffect(() => claim([document.body, document.getElementById("root")], [token]), [token]);
};

// Правила поиска предка: Map, чтобы имя вроде constructor не находило прототип.
const nearOrInDocument = (wide) => (node, selector) => node.closest(selector) ?? node.ownerDocument.querySelector(wide);
const FINDERS = new Map([
  [":parent", (node) => node.parentElement],
  ["body", (node) => node.ownerDocument.body],
  ["#root", (node) => node.ownerDocument.getElementById("root")],
  [".desktop-app", nearOrInDocument(".desktop-app")],
  [".desktop-main", nearOrInDocument(".desktop-main")],
  [".desktop-content", nearOrInDocument(".desktop-content:not([data-kept])")],
]);
const NEAREST = (node, selector) => node.closest(selector);

const nameOf = (token, node) => String((typeof token === "function" ? token(node) : token) || "").trim();

// Память хука: подпись последней сверки и функция снятия того, что повесили.
class Memory {
  signature = null;
  undo = null;

  clear() {
    this.undo?.();
    this.undo = null;
  }

  forget() {
    this.clear();
    this.signature = null;
  }

  renew(signature, place) {
    if (this.signature?.every((part, at) => part === signature[at])) return;
    this.clear();
    this.signature = signature;
    this.undo = place();
  }
}

export default function useHolds(ref, token, hosts, on = true, within = "") {
  const memory = useRef(null);
  memory.current ??= new Memory();

  useLayoutEffect(() => {
    const node = on ? (ref?.current ?? null) : null;
    const name = node ? nameOf(token, node) : "";
    memory.current.renew([node, name, hosts.join("|"), within], () => {
      if (!name || (within && !node.closest(within))) return null;
      return claim(hosts.map((selector) => (FINDERS.get(selector) ?? NEAREST)(node, selector)), name.split(/\s+/));
    });
  });

  useLayoutEffect(() => {
    const own = memory.current;
    return () => own.forget();
  }, []);
}
