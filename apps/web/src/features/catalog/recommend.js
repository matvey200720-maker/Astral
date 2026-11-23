import { GLOW_REASON, variantOf } from "@modovik/publishing";
import { isPlaceholderAuthor } from "./catalog-authors.js";
import { catalogDownloadCount, listedCatalogMods, shelfCatalogMods } from "../../catalog-utils.js";

export const NEW_WINDOW_DAYS = 30;
export const POPULAR_HALF_LIFE_DAYS = 21;

const DAY_MS = 86400000;
const UNDATED_AGE_DAYS = 3 * POPULAR_HALF_LIFE_DAYS;

// Подстроки «преимущества» в полях мода (без учёта регистра).
const RISK_WORDS = ["tracer", "трейсер", "трассер", "wallbang", "прострел"];

const isObject = (value) => value !== null && typeof value === "object";

// Одно вычисление на объект записи: правка записи после первого вызова не видна.
const rememberedBy = (compute) => {
  const memo = new WeakMap();
  return (mod) => {
    if (!isObject(mod)) return compute(mod);
    if (!memo.has(mod)) memo.set(mod, compute(mod));
    return memo.get(mod);
  };
};

export const postedTime = rememberedBy((mod) => {
  const dates = [mod?.postedAt, mod?.origin?.postedAt, mod?.originPublishedAt, mod?.publishedAt, mod?.createdAt, mod?.addedAt];
  for (const date of dates) {
    const time = date ? Date.parse(String(date)) : NaN;
    if (Number.isFinite(time)) return time;
  }
  return 0;
});

export const isNewMod = (mod, now = Date.now()) => {
  const age = now - postedTime(mod);
  return postedTime(mod) > 0 && age >= 0 && age <= NEW_WINDOW_DAYS * DAY_MS;
};

// Конечное строго положительное число, иначе 0.
const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

export const popularityScore = (mod, now = Date.now()) => {
  const downloads = catalogDownloadCount(mod);
  const likes = positive(mod.likes ?? mod.favoriteCount);
  const reactions = positive(mod.reactions ?? mod.discord?.reactions ?? mod.origin?.reactions);
  const signal = downloads + 3 * likes + 2 * reactions;
  if (signal === 0) return 0;
  const posted = postedTime(mod);
  const ageDays = posted ? Math.max(0, (now - posted) / DAY_MS) : UNDATED_AGE_DAYS;
  return Math.log1p(signal) * 0.5 ** (ageDays / POPULAR_HALF_LIFE_DAYS);
};

/*
 * Метка «преимущество» с одной причиной «светящееся снаряжение» — не риск: за светящееся оружие не банят (владелец, 13.11.2026, слова администрации).
 * Так старые записи каталога, пока их не перевыложили, не прячут паки; метка без перечня причин считается как прежде.
 */
const markedAdvantage = (risk) => {
  if (risk?.advantage !== true) return false;
  const reasons = Array.isArray(risk.reasons) ? risk.reasons : [];
  return reasons.length === 0 || reasons.some((reason) => reason !== GLOW_REASON);
};

export const advantageRisk = (mod, byId = null) => {
  if (!mod) return false;
  const flagged = mod.advantage === true || markedAdvantage(mod.risk);
  const words = [mod.catalogSlot, mod.catalogSubcategory, mod.category, mod.domain?.kind].filter(Boolean).join(" ").toLowerCase();
  const throughPack = () => Boolean(byId) && [...(mod.includedModIds ?? [])].some((id) => id !== mod.id && advantageRisk(byId.get(id)));
  return flagged || RISK_WORDS.some((word) => words.includes(word)) || throughPack();
};

// Признаки: вид, вес, откуда читать значение и список ли это значений.
const FEATURE_KINDS = [
  ["weapon", 3, (mod) => mod.domain?.weapon?.model || mod.domain?.weapon?.weaponId, false],
  ["slot", 2.5, (mod) => mod.catalogSlot || mod.domain?.weapon?.slot, false],
  ["sub", 2, (mod) => mod.catalogSubcategory, false],
  ["clothing", 2, (mod) => mod.domain?.clothing?.category, false],
  ["author", 1.5, (mod) => (isPlaceholderAuthor(mod.author) ? "" : mod.author), false],
  ["category", 1, (mod) => mod.catalogCategory || mod.category, false],
  ["tag", 1, (mod) => mod.tags ?? [], true],
  ["server", 0.5, (mod) => mod.platforms ?? [], true],
];

const tidyValue = (value) => (value ? String(value).trim().toLowerCase().replace(/\s+/g, " ") : "");

export const modFeatures = rememberedBy((mod) => {
  const features = new Map();
  if (!isObject(mod)) return features;
  for (const [kind, weight, read, isList] of FEATURE_KINDS) {
    const value = read(mod);
    for (const one of isList ? [...value] : [value]) {
      const text = tidyValue(one);
      if (text) features.set(`${kind}:${text}`, weight);
    }
  }
  return features;
});

export const similarity = (first, second) => {
  const [left, right] = [modFeatures(first), modFeatures(second)];
  const sum = (entries) => entries.reduce((total, [, weight]) => total + weight, 0);
  const everything = sum([...new Map([...left, ...right])]);
  return everything ? sum([...left].filter(([key]) => right.has(key))) / everything : 0;
};

// Составной порядок: первый ключ с ненулевой разностью решает; NaN считается «ничья».
const orderBy =
  (...keys) =>
  (a, b) => {
    for (const key of keys) {
      const diff = key(a, b);
      if (diff) return diff;
    }
    return 0;
  };

const lessRisky = (a, b) => a.risky - b.risky;
const morePopular = (a, b) => b.popularity - a.popularity;
const fresher = (a, b) => postedTime(b.mod) - postedTime(a.mod);
const sectionOf = (mod) => mod?.catalogCategory || mod?.category;

export const similarMods = (mod, candidates = [], { now = Date.now(), limit = 6 } = {}) => {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const group = variantOf(mod)?.group;
  const rated = shelfCatalogMods(candidates)
    .filter((candidate) => candidate && candidate.id !== mod?.id && !candidate.internal)
    .filter((candidate) => !group || variantOf(candidate)?.group !== group)
    .map((candidate) => ({
      mod: candidate,
      likeness: similarity(mod, candidate),
      risky: Number(advantageRisk(candidate, byId)),
      popularity: popularityScore(candidate, now),
    }));

  const alike = rated
    .filter((entry) => entry.likeness > 0)
    .sort(orderBy(lessRisky, (a, b) => b.likeness - a.likeness, morePopular, fresher))
    .map((entry) => entry.mod)
    .slice(0, limit);
  if (alike.length >= limit) return alike;

  // Добивка: тот же раздел первым, дальше по популярности и свежести.
  const chosen = new Set(alike.map((one) => one.id));
  const sameSection = (entry) => Number(sectionOf(entry.mod) === sectionOf(mod));
  const filler = rated
    .filter((entry) => !chosen.has(entry.mod.id))
    .sort(orderBy(lessRisky, (a, b) => sameSection(b) - sameSection(a), morePopular, fresher))
    .map((entry) => entry.mod)
    .slice(0, limit - alike.length);
  return [...alike, ...filler];
};

export const workshopOrder = (mods = [], { now = Date.now() } = {}) => {
  const listed = listedCatalogMods(mods);
  const byId = new Map(mods.map((one) => [one.id, one]));
  return listed
    .map((mod) => ({ mod, risky: Number(advantageRisk(mod, byId)), popularity: popularityScore(mod, now) }))
    .sort(orderBy(lessRisky, morePopular, fresher))
    .map((entry) => entry.mod);
};
