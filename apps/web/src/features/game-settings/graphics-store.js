import { useSyncExternalStore } from "react";
import {
  GRAPHICS_PARAMETERS,
  GRAPHICS_TEMPLATES,
  graphicsParameter,
  graphicsTemplate,
  normalizeGraphicsValues,
} from "@modovik/optimizer/graphics.js";

// Свои шаблоны графики (ТЗ 05.10.2026, задача 15) лежат в localStorage окна и
// проходят normalizeGraphicsValues: испорченная запись просто не встаёт на полку.

const KEY = "astral.graphics.templates.v1";
const OWN_ID = /^own-[a-z0-9-]{4,40}$/;

export const EDITABLE_KEYS = Object.freeze(GRAPHICS_PARAMETERS.map(({ key }) => key));

const quiet = (f) => {
  try {
    return f();
  } catch {
    return null;
  }
};

const clip = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// ── запись: из хранилища и из saveOwnTemplate собирается одним путём ──

function entryOf(raw) {
  const values = quiet(() => normalizeGraphicsValues(raw.values));
  const name = String(raw.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  // Бета 15.10.2026: отказ называет причину, а не «нужно название» на любой случай.
  if (!name) throw new Error("Шаблон не сохранён: нужно название.");
  if (!values || !OWN_ID.test(raw.id)) throw new Error("Шаблон не сохранён: в нём значение, которого нет в меню игры.");
  return Object.freeze({
    id: raw.id,
    name,
    base: clip(raw.base, 60),
    values: Object.freeze(values),
    updatedAt: `${raw.updatedAt || ""}`,
  });
}

// ── хранилище в памяти окна ──

let cache = null;
const subs = new Set();

const readStored = () =>
  quiet(() => {
    const ls = window.localStorage;
    // ключи, которые страница держала до задачи 15 (пресет, избранное, копия настроек):
    // прежнее состояние игры теперь помнит главный процесс, поэтому ключи стираются
    ["modovik-game-preset", "astral-favorite-presets", "astral-settings-backup"].forEach((k) => ls.removeItem(k));
    const found = JSON.parse(ls.getItem(KEY));
    if (!Array.isArray(found)) return null;
    return found.map((raw) => quiet(() => entryOf(raw))).filter(Boolean);
  }) ?? [];

const rows = () => (cache ??= readStored());

// правка списка: прочитать (при первом обращении), изменить, записать, разбудить подписчиков
function change(edit) {
  cache = edit(rows());
  // шаблон живёт в памяти до закрытия окна, даже если запись не удалась
  quiet(() => window.localStorage.setItem(KEY, JSON.stringify(cache)));
  subs.forEach((ping) => ping());
}

// подписка одна на модуль, иначе React переподписывался бы на каждой отрисовке
const subscribe = (ping) => (subs.add(ping), () => subs.delete(ping));

export const useOwnTemplates = () => useSyncExternalStore(subscribe, rows, rows);

// Первое свойство с умолчанием: без него отказ на пустом аргументе читается иначе.
export function saveOwnTemplate({ id = "", base, name, values }) {
  const fresh = `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = entryOf({
    base,
    id: id || fresh,
    name,
    updatedAt: new Date().toISOString(),
    values,
  });
  change((all) => {
    const slot = all.findIndex((item) => item.id === entry.id);
    return slot === -1 ? [...all, entry] : all.map((item, at) => (at === slot ? entry : item));
  });
  return entry;
}

export const deleteOwnTemplate = (id) => {
  change((all) => all.filter((x) => x.id !== id));
};

export const resetOwnTemplatesForTests = () => {
  cache = null;
};

// ── полка: поставочные (кроме подменённых сервером), серверные, свои ──

export function graphicsShelf(own, locale, remote = []) {
  const slot = locale === "ru" ? 0 : 1;
  const inLocale = (names) => names?.[locale] || names?.en;
  const serverIds = new Set(remote.map((tpl) => tpl.id));

  const frame = (core, kind, middle = []) =>
    Object.fromEntries([
      ["id", core.id],
      ["group", core.group],
      ["label", core.label],
      ["note", core.note],
      ["author", core.author],
      ["tier", core.tier],
      ...middle,
      ["values", core.values],
      ["own", kind === "own"],
      ["remote", kind === "remote"],
    ]);

  const baseLabel = (base) => {
    if (!base) return "";
    const fromServer = remote.find((tpl) => tpl.id === base);
    if (fromServer) return inLocale(fromServer.label) || "";
    const fromBox = graphicsTemplate(base);
    return fromBox ? fromBox.label[slot] : "";
  };

  const shipped = GRAPHICS_TEMPLATES.filter((tpl) => !serverIds.has(tpl.id)).map((tpl) =>
    frame({ ...tpl, label: tpl.label[slot], note: tpl.graphics?.[slot] || "" }, "shipped"),
  );
  const served = remote.map((tpl) =>
    frame({ ...tpl, label: inLocale(tpl.label), note: inLocale(tpl.level) || "" }, "remote"),
  );
  const mine = own.map((entry) =>
    frame(
      {
        author: "",
        group: "own",
        id: entry.id,
        label: entry.name,
        note: baseLabel(entry.base),
        tier: "own",
        values: entry.values,
      },
      "own",
      [["base", entry.base]],
    ),
  );

  return [...shipped, ...served, ...mine];
}

// ── сравнение с игрой и полоски уровня ──

const near = (a, b) => Math.abs(Number(a) - b) < 0.001;
const strict = (a, b) => a === b;

export const templateMatches = (values, game) =>
  !!game && Object.keys(values).every((key) => key in game && (graphicsParameter(key)?.kind === "share" ? near : strict)(game[key], values[key]));

// восемь главных параметров: полоска показывает высоту уровня от 0 до 1
export const templateBars = (values) =>
  "TextureQuality ShaderQuality ShadowQuality ReflectionQuality GrassQuality WaterQuality ParticleQuality PostFX".split(" ").map((key) => {
    const menu = graphicsParameter(key).options;
    const rank = menu.findIndex((o) => o.value === values[key]) + 1;
    return { key, level: rank / menu.length };
  });
