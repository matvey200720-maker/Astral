import { useSyncExternalStore } from "react";

// Внешний вид (ТЗ владельца 17.10.2026): выбор лежит в localStorage окна и в атрибутах <html>, листы look.css
// читают их сами. Тема одна, тёмная (светлая убрана 24.09.2026), поэтому выбираются акцент, фон и скругления.

const attempt = (f, otherwise) => {
  try {
    return f();
  } catch {
    return otherwise;
  }
};
const listeners = new Set();
const freeze = Object.freeze;

// rgb акцента — те же байты, что в hex; листы стилей берут отсюда «r, g, b» для прозрачных оттенков
export const LOOK_ACCENTS = freeze(
  [
    ["white", "#f4f4f5", "#ffffff"],
    ["sand", "#dccaa5", "#e8d9ba"],
    ["peach", "#e8b48f", "#f0c4a4"],
    ["rose", "#e6a9c2", "#efbdd1"],
    ["lavender", "#b9a9ec", "#cbbef3"],
    ["sky", "#9fc0ea", "#b6d0f0"],
    ["sage", "#a9cba1", "#bdd8b6"],
  ].map(([id, hex, hover]) => ({ id, hex, hover, rgb: hex.slice(1).match(/../g).map((byte) => parseInt(byte, 16)).join(", ") })),
);
export const LOOK_BACKDROPS = freeze(["none", "light", "waves", "lines"]);
export const LOOK_RADII = freeze(["sharp", "soft", "round"]);
export const DEFAULT_LOOK = freeze({ accent: "white", backdrop: "none", radius: "soft" });

// Поле вида → допустимые значения. Порядок ключей — порядок в виде и в записи хранилища.
const CHOICES = { accent: LOOK_ACCENTS.map(({ id }) => id), backdrop: LOOK_BACKDROPS, radius: LOOK_RADII };

// Негодное значение поля заменяется умолчанием поля, а не прежним значением; лишние поля отбрасываются
const sanitize = (raw) =>
  freeze(
    Object.fromEntries(
      Object.entries(CHOICES).map(([field, allowed]) => [field, allowed.includes(raw[field]) ? raw[field] : DEFAULT_LOOK[field]]),
    ),
  );

// Сбой хранилища (нет localStorage, бросает чтение) даёт сам DEFAULT_LOOK; не-JSON и не-объект — пустой выбор
const readSaved = () => {
  const stored = attempt(() => [localStorage.getItem("astral.look.v1")], null);
  if (!stored) return DEFAULT_LOOK;
  const saved = attempt(() => JSON.parse(stored[0]), null);
  return sanitize(saved && typeof saved === "object" ? saved : {});
};

let current = readSaved();

export const getLook = () => current;

export const isDefaultLook = (look) => Object.keys(DEFAULT_LOOK).every((field) => look[field] === DEFAULT_LOOK[field]);

export const accentOf = (id) => LOOK_ACCENTS[Math.max(0, CHOICES.accent.indexOf(id))];

// Листы стилей читают вид с <html>; data-logo — метка прежних версий (выбор знака отменён 25.10.2026),
// снимается при каждом применении
export const applyLook = (look = current) => {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  for (const field of Object.keys(CHOICES)) root.dataset[field] = look[field];
  root.removeAttribute("data-logo");
};

export const setLook = (patch) => {
  const fresh = sanitize(Object.assign({}, current, patch));
  current = fresh;
  attempt(() => localStorage.setItem("astral.look.v1", JSON.stringify(fresh)), null);
  applyLook();
  listeners.forEach((notify) => notify());
  return fresh;
};

const subscribe = (notify) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export const useLook = () => useSyncExternalStore(subscribe, getLook, getLook);

applyLook();
