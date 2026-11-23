import { variantOf } from "@modovik/publishing";
import { GENDER_LABELS } from "@modovik/clothing/taxonomy";
import { withoutAttachmentCards } from "./features/catalog/attachment-cards.js";
import { catalogLabel } from "./features/catalog/catalog-words.js";
import { isReduxBase } from "./features/catalog/bundles/component-groups.js";
import { tr } from "./locales/ui.js";

// Модуль не знает ни оболочки, ни окружения сборки: его грузят и проверки ядра
// под Node без Vite, поэтому шаблон id облачного мода живёт здесь.
export const cloudCatalogIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ---- общие помощники ----

const safe = (run, fallback) => {
  try {
    return run();
  } catch {
    return fallback;
  }
};
const pos = (n) => (n > 0 ? n : undefined);
const fileBytes = (f) => Number(f?.size) || 0;
const sumFiles = (files) => files.reduce((s, f) => s + fileBytes(f), 0);
const fin = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// группа варианта мода или undefined
const grp = (mod) => variantOf(mod)?.group;

// ---- размеры словами ----

// Размер считается на каждой карточке при каждой перерисовке сетки, а формат
// чисел дорог (ТЗ 08.10, задача 6): форматы хранятся по строке локали.
const formats = {};
const nf = (locale, frac) =>
  (formats[frac + locale] ??= new Intl.NumberFormat(locale, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac && 2,
  }));

export const formatSizeNumber = (value, locale = "ru-RU") => nf(locale).format(value);

// ru и uk пишут кириллицей, но по языку окна (tr), а не по локали; fr — Go, Mo, Ko
// (шестой язык с 29.10.2026).
export const sizeUnits = (locale = "ru-RU") => {
  const tag = String(locale).toLowerCase();
  const [gb, mb, kb] = tag.startsWith("fr")
    ? ["Go", "Mo", "Ko"]
    : /^(ru|uk)/.test(tag) ? [tr("ГБ"), tr("МБ"), tr("КБ")] : ["GB", "MB", "KB"];
  return { gb, mb, kb };
};

// 1 КБ = 1000 байт; единица меняется там, где округление дошло бы до тысячи.
// Мусор на входе печатается как есть (вызывающие защищаются сами).
export const formatSize = (bytes, locale = "ru-RU") => {
  if (!bytes) return "";
  const [unit, div] = bytes < 999500 ? ["kb", 1e3] : bytes >= 999500000 ? ["gb", 1e9] : ["mb", 1e6];
  const n = bytes / div;
  const text = unit === "gb" ? nf(locale, 1).format(n) : nf(locale).format(Math.max(1, Math.round(n)));
  return `${text} ${sizeUnits(locale)[unit]}`;
};

// ---- размер мода и составы ----

// Т-21: индекс id → мод строится один раз на массив каталога (слабо, по ссылке).
const indexes = new WeakMap();
const byId = (all) =>
  Array.isArray(all) ? indexes.get(all) ?? indexes.set(all, new Map(all.map((m) => [m.id, m]))).get(all) : new Map();

// Размер — первая ветвь, давшая число больше нуля (pos); 0 — «неизвестно».
// `trail` — id паков, которые раскрываются сейчас: замкнутый состав считается
// неизвестным, а не роняет стек (Т-99). Сумма состава берётся, только если
// известен размер каждой части: иначе чужой размер выдавался бы за свой.
const size = (m, all, trail) => {
  const code = m.publicationMode === "work" ? m.work?.code : null;
  if (typeof code === "string") return new Blob([code]).size;
  const ids = [m.includedModIds, m.modIds, m.manifest?.includedModIds].find(Boolean);
  const path = [...trail, m.id];
  const gun = m.domain?.weapon;
  return (
    pos(ids?.length && ids.map((id) => {
      const part = byId(all).get(id);
      return !part || path.includes(part.id) ? 0 : size(part, all, path);
    }).reduce((a, b) => (a > 0 && b > 0 ? a + b : 0))) ??
    pos(fin(m.sizeBytes ?? m.fileSizeBytes ?? m.totalSizeBytes ?? m.manifest?.sizeBytes ?? m.manifest?.totalSizeBytes)) ??
    pos(m.manifest?.files && sumFiles(m.manifest.files)) ??
    pos(fin(Number(gun?.bytes) || sumFiles(Array.isArray(gun?.files) ? gun.files : []))) ??
    0
  );
};

export const modSizeBytes = (mod, allMods = []) => size(mod, allMods, []);

export const formatModSize = (mod, allMods = [], locale = "ru-RU") => formatSize(modSizeBytes(mod, allMods), locale);

export const packMembers = (mod, allMods = []) =>
  mod?.includedModIds?.length ? mod.includedModIds.map((id) => byId(allMods).get(id)).filter(Boolean) : [];

export const packsContaining = (mod, allMods = []) =>
  mod?.id ? allMods.filter((o) => o.id !== mod.id && (o.includedModIds || []).includes(mod.id)) : [];

// ---- варианты и витринная выдача ----

// «по умолчанию» первым, затем order (нет — 99), затем подпись.
const cmp = (a, b) => +!a.default - +!b.default || (a.order ?? 99) - (b.order ?? 99) || a.label.localeCompare(b.label);

export const variantSiblings = (mod, allMods = []) => {
  const group = grp(mod);
  return group === undefined
    ? [mod]
    : [mod, ...allMods.filter((o) => o.id !== mod.id && grp(o) === group)]
        .sort((a, b) => cmp(variantOf(a), variantOf(b)));
};

// Группа вариантов в каталоге — одна карточка (Т-77), её лидер остаётся на своём
// месте; при равных рангах лидер — первый в списке.
export const listedCatalogMods = (mods = []) => {
  const lead = [...mods].reduce((acc, m) => {
    const g = grp(m);
    return g !== undefined && !(acc.has(g) && cmp(variantOf(acc.get(g)), variantOf(m)) <= 0) ? acc.set(g, m) : acc;
  }, new Map());
  return mods.filter((m) => grp(m) === undefined || lead.get(grp(m)) === m);
};

// Карточки обвесов живут в студии ствола (ТЗ 24.10.2026, п. 4), витрина игрока их
// скрывает; лидер-карточка уносит с собой группу. «Основа редукса» (`redux-base`) карточкой
// не идёт нигде — ни на Главной, ни среди похожих: она живёт только внутри своего редукса.
export const shelfCatalogMods = (mods = []) => withoutAttachmentCards(listedCatalogMods(mods)).filter((mod) => !isReduxBase(mod));

// Подпись варианта — слова через « · »: части переводятся по отдельности, число
// идёт в готовый перевод, незнакомая часть остаётся как есть.
export const variantLabelText = (label) =>
  label
    ? String(label).split(" · ").map((part) => {
        const m = /^(Обновление |ред\. )(\d+)$/.exec(part);
        return m ? tr(m[1] + "{count}").replace("{count}", m[2]) : tr(part);
      }).join(" · ")
    : "";

// ---- посты ----

// Ссылка на общий пост Discord объединяет заявки в набор (Т-73).
const isPost = (s) => s?.type === "discord" && s.url;
export const postKeyOf = (mod) => String((mod?.attribution?.sources || []).find(isPost)?.url ?? "");

// Не соседи: сам мод, паки с ним, любые части паков, варианты самого мода и целые
// группы, чей вариант лежит в каком-нибудь паке (вариант по умолчанию в сборке
// уводит всю группу).
const matesOf = (mod, allMods, key) => {
  const packed = new Set(allMods.flatMap((o) => o.includedModIds || []));
  const skipIds = new Set([mod.id, ...packed, ...packsContaining(mod, allMods).map((p) => p.id)]);
  const skipGroups = new Set(
    [grp(mod), ...allMods.map((o) => packed.has(o.id) && grp(o))].filter(Boolean),
  );
  return listedCatalogMods(allMods).filter(
    (o) => !skipIds.has(o.id) && !skipGroups.has(grp(o)) && postKeyOf(o) === key,
  );
};

export const postMates = (mod, allMods = []) => {
  const key = postKeyOf(mod);
  if (!key) return [];
  return matesOf(mod, allMods, key);
};

// ---- счётчики и признаки ----

export const catalogDownloadCount = (mod) => {
  const n = Number(mod.downloads ?? mod.downloadCount);
  return n >= 0 && n < Infinity ? n : 0;
};

// Нет конечных лайков — оценка: 16 % от скачиваний.
export const catalogLikeCount = (mod) => {
  const n = Number(mod.likes ?? mod.favoriteCount);
  return Number.isFinite(n) ? n : Math.round(catalogDownloadCount(mod) * 0.16);
};

// Сборка редукса своего пакета не имеет, части ставятся своими кнопками (Т-81c, Т-81d).
export const isCatalogBundle = (mod) => [mod?.publicationMode, mod?.packageStatus].includes("bundle");

// Облачный мод без релиза — витрина: облако на установку отвечает отказом.
export const catalogModWithoutPackage = (mod) =>
  mod?.packageStatus === "preview" && !(mod.manifest || mod.releaseId) && cloudCatalogIDPattern.test(mod.id || "");

// Размер шрифта героя подстраивается по длине в кодовых точках (data-length).
export const heroTitleLength = (name) => {
  const n = Array.from(String(name || "")).length;
  return [undefined, "long", "very-long"][(n > 40) + (n > 90)];
};

// ---- избранное и ссылка ----

const FAVORITES = "astral-catalog-favorites";

// Недоступное хранилище не показывается человеку ошибкой: избранное живёт в сеансе.
export const readCatalogFavoriteIds = () =>
  safe(() => new Set(JSON.parse(window.localStorage.getItem(FAVORITES)) || []), new Set());

export const writeCatalogFavoriteIds = (ids) => {
  safe(() => window.localStorage.setItem(FAVORITES, JSON.stringify([...ids])));
};

// astral://mods/<id>: ссылка приходит и со слэшем на конце, и с продолжением пути
// (ТЗ 29.10, п. 5), поэтому берётся первый непустой отрезок.
export const modIdFromDeepLink = (value) =>
  safe(() => {
    const url = new URL(`${value || ""}`);
    return url.protocol + url.hostname === "astral:mods" ? decodeURIComponent(url.pathname.match(/[^/]+/)?.[0] ?? "") : "";
  }, "");

// ---- раздел, пол и подпись над названием ----

// Порядок важен: побеждает первый подошедший раздел (ищется подстрока).
const SECTIONS = [
  ["clothing", /cloth|outfit|одеж|armor|mask/],
  ["sounds", /sound|audio|сирен|звук/],
  ["skins", /weapon|gun|оруж|skin/],
  ["interface", /hud|map|interface|прицел|crosshair/],
  ["effects", /effect|tracer|smoke|дым|попадан/],
  ["packs", /pack|redux|сбор/],
];

export const catalogCategoryForMod = (mod) => {
  const text = "catalogSection catalogSlot category categoryLabel name"
    .split(" ")
    .map((key) => mod[key] || "")
    .join(" ")
    .toLowerCase();
  return SECTIONS.find(([, re]) => re.test(text))?.[0] ?? "improvements";
};

// Т-95: у мужской и женской версий вещи разные пакеты, плитки в сетке «Все» не
// отличались; слово пола то же, что в витрине «Одежды».
export const clothingGenderLabel = (mod, language = "ru") => {
  const word = GENDER_LABELS[[mod?.domain, mod].map((o) => o?.clothing?.gender).find(Boolean)];
  return (word && catalogLabel(word, language)) || "";
};

// Строки с автором над названием нет (решение владельца 16.10): плитка называет раздел,
// author оставлен ради формы ответа. Раздел из облака вне таблицы остаётся как есть.
export const modCardKickerParts = (mod, fallback = "", language = "ru") => {
  const section = String(mod?.categoryLabel || "").trim();
  return {
    text: (section && catalogLabel(section, language)) || fallback,
    author: false,
    gender: clothingGenderLabel(mod, language),
  };
};

// Подпись без языка окна: всегда по-русски.
export const modCardKicker = (mod, fallback = "") => modCardKickerParts(mod, fallback).text;
