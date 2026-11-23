import { useSyncExternalStore } from "react";
import { normalizeGraphicsValues } from "@modovik/optimizer/graphics.js";
import { api } from "../../api.js";

/*
 * Готовые шаблоны графики, которые команда подгружает с сервера (ТЗ 23.10.2026, п. H: «шаблоны „от Astral“ и „от
 * игроков“ мы будем подгружать — они должны отображаться»).
 *
 * В поставке лежат свои шаблоны (`@modovik/optimizer/graphics.js`, `GRAPHICS_TEMPLATES`) — они на полке всегда, даже без
 * сети. Сервер добавляет к ним новые и может заменить поставочный шаблон своим с тем же `id`: полка склеивается так, что
 * серверный побеждает (`graphicsShelf` в `graphics-store.js`). Полка — две: «Шаблоны Astral» (`group: "astral"`) и «От
 * игроков» (`group: "community"`, у шаблона есть автор); свои шаблоны человека к ним не относятся и живут только у него
 * на компьютере (`graphics-store.js`).
 *
 * КОНТРАКТ. `GET /api/v1/public/graphics-templates` (без входа) → `{ "templates": [ … ] }`; шаблон:
 *   {
 *     "id": "player-low-vram",                 // a–z, 0–9, «-», 3–48 знаков; свои шаблоны человека (`own-…`) не занять
 *     "group": "astral" | "community",
 *     "author": "Ник",                         // у «от игроков» — кто сделал; у «от Astral» можно не писать
 *     "tier": "low",                           // необязательно: ultra, high, medium, low, ultra-low …
 *     "label": { "ru": "…", "uk": "…", "en": "…", "de": "…", "pl": "…", "fr": "…" },   // или одной строкой на всех
 *     "level": { … },                          // подпись под названием («Высокие», «Низкие настройки»); так же
 *     "values": { "TextureQuality": 2, … }     // ключи и значения — как в `GRAPHICS_PARAMETERS`
 *   }
 * `values` проходит ту же проверку, что и запись в игру (`normalizeGraphicsValues`): шаблон с негодным значением
 * пропускается целиком, а не показывается урезанным — тот, что не встанет в игру, на полке не нужен. Остальные идут
 * на полку.
 *
 * НЕТ СЕТИ ИЛИ СЕРВЕР МОЛЧИТ. Последний хороший ответ лежит в хранилище окна и показывается сразу, ещё до ответа; пустой
 * ответ без списка или отказ ничего не стирают — полка остаётся прежней; `{ "templates": [] }` очищает её. Спрашивается раз в `REFRESH_MS`, а не при каждом заходе.
 */

const CACHE_KEY = "astral.graphics.server-templates.v1";
const REFRESH_MS = 10 * 60 * 1000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,47}$/;
const LANGUAGES = Object.freeze(["ru", "uk", "en", "de", "pl", "fr"]);
const GROUPS = Object.freeze(["astral", "community"]);
const TEXT_LIMIT = 60;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT);

/* Подпись на шести языках: строка — одна на всех, объект — по языкам, нехватающее берётся у соседа (en → ru → любой). */
function words(raw) {
  if (typeof raw === "string") {
    const text = clean(raw);
    return text ? Object.freeze(Object.fromEntries(LANGUAGES.map((language) => [language, text]))) : null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fallback = clean(raw.en) || clean(raw.ru) || LANGUAGES.map((language) => clean(raw[language])).find(Boolean) || "";
  if (!fallback) return null;
  return Object.freeze(Object.fromEntries(LANGUAGES.map((language) => [language, clean(raw[language]) || fallback])));
}

/** Шаблон сервера в том виде, как его держит полка, или `null`, если он негоден. */
export function readServerTemplate(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "");
  if (!ID_PATTERN.test(id) || id.startsWith("own-")) return null;
  const group = GROUPS.includes(item.group) ? item.group : null;
  const label = words(item.label);
  if (!group || !label) return null;
  try {
    return Object.freeze({
      id,
      group,
      author: clean(item.author) || (group === "astral" ? "Astral" : ""),
      tier: clean(item.tier) || "custom",
      label,
      level: words(item.level) || Object.freeze(Object.fromEntries(LANGUAGES.map((language) => [language, ""]))),
      values: Object.freeze(normalizeGraphicsValues(item.values)),
    });
  } catch {
    return null;
  }
}

/** Список из ответа сервера: негодные шаблоны отброшены, повторы по `id` — последний побеждает. */
export function readServerTemplates(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.templates) ? payload.templates : [];
  const byId = new Map();
  for (const item of list) {
    const template = readServerTemplate(item);
    if (template) byId.set(template.id, template);
  }
  return [...byId.values()];
}

const listeners = new Set();
let current = null;
let lastAsked = 0;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function snapshot() {
  if (current) return current;
  let stored = [];
  try {
    stored = readServerTemplates(JSON.parse(storage()?.getItem(CACHE_KEY) || "[]"));
  } catch {
    stored = [];
  }
  current = Object.freeze(stored);
  return current;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Шаблоны сервера для полки: последний хороший ответ, дальше — свежий. */
export function useServerTemplates() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Положить ответ сервера: хороший заменяет и запоминается; `{ "templates": [] }` — сервер прямо сказал «шаблонов нет» и
 * очищает полку; всё остальное (мусор, ответ без списка, список из одних негодных шаблонов) ничего не стирает.
 */
export function setServerTemplates(payload) {
  const next = readServerTemplates(payload);
  const none = Array.isArray(payload?.templates) && payload.templates.length === 0;
  if (!next.length && !none) return snapshot();
  current = Object.freeze(next);
  try {
    storage()?.setItem(CACHE_KEY, JSON.stringify(next.map((item) => ({ ...item, values: { ...item.values } }))));
  } catch {
    /* Приватное окно — шаблоны живут до закрытия. */
  }
  for (const listener of listeners) listener();
  return current;
}

/**
 * Спросить сервер (не чаще раза в десять минут). Любая ошибка — тишина: полка остаётся прежней.
 * `fetcher` — подмена для теста.
 */
export async function refreshServerTemplates({ fetcher = () => api("/v1/public/graphics-templates"), force = false, now = Date.now() } = {}) {
  if (!force && now - lastAsked < REFRESH_MS) return snapshot();
  lastAsked = now;
  try {
    return setServerTemplates(await fetcher());
  } catch {
    return snapshot();
  }
}

export function resetServerTemplatesForTests() {
  current = null;
  lastAsked = 0;
  try {
    storage()?.removeItem(CACHE_KEY);
  } catch {
    /* нечего стирать */
  }
}
