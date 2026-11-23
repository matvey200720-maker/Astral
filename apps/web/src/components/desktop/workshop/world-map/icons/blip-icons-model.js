/*
 * Модель экрана «Иконки» большой карты (05.11.2026): чистые функции без окна. Состояние игрока — ответ `readBlipIcons`
 * (таблица значков и атлас штатных клеток); работа — `config.blipIcons` (`@modovik/vector-map/blip-icons`).
 *
 * Общая клетка: у нескольких номеров бывает один рисунок (`garage` и `multistorey_garage`), и игра меняет их разом. Правка
 * одного номера поэтому снимает правки остальных номеров клетки и записывается один раз — на тот, что выбран: в работе
 * не бывает двух разных правок на одну клетку.
 */

import { blipIconEdit, normalizeBlipIcons, withBlipIconEdit } from "@modovik/vector-map/blip-icons";
import { BLIP_CATALOG, BLIP_CATEGORIES, BLIP_REST_CATEGORY, blipCatalogEntry, blipText, blipTitle, humanSymbol } from "./blip-catalog.js";
import { SERVER_ICON_SECTIONS, serverIconTitle, serverIconsOf, serverSectionTitle } from "./server-icons.js";

/** Карточка состояния игрока для быстрых запросов: таблица по номеру и положение клетки в атласе. */
export function indexBlipState(state) {
  const bySprite = new Map((state?.sprites || []).map((item) => [item.sprite, item]));
  const atlas = new Map((state?.atlas?.items || []).map((sprite, index) => [sprite, index]));
  return { state, bySprite, atlas, edited: new Set(state?.edited || []) };
}

/** Положение клетки в атласе в точках экрана: `{ x, y }` при клетке `size` или `null`, если у значка нет картинки. */
export function atlasPosition(index, sprite, size) {
  const at = index.atlas.get(sprite);
  if (at === undefined) return null;
  const { columns } = index.state.atlas;
  return { x: (at % columns) * size, y: Math.floor(at / columns) * size };
}

/** Размер атласа в клетках — для `background-size`. */
export function atlasGrid(index) {
  const columns = index.state?.atlas?.columns || 1;
  return { columns, rows: Math.max(1, Math.ceil((index.state?.atlas?.items?.length || 1) / columns)) };
}

/**
 * Разделы экрана: подборка каталога по разделам и «Остальные значки игры». Номера, которых нет в игре игрока или у которых нет
 * картинки в листе, не показываются. `query` — подстрока: название на языке окна, имя символа, название бизнеса сервера или номер.
 */
export function buildSections(index, language, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const matches = (sprite, symbol, title, servers) => {
    if (!needle) return true;
    /* Подписи сервера (Majestic) ищутся тоже: «автошкола» находит значок 545, как его зовёт игрок. */
    const labels = serverIconsOf(sprite).flatMap((item) => [item.names.ru, serverIconTitle(item, language)]);
    const haystack = [String(sprite), symbol, title, ...Object.values(servers || {}), ...labels].join(" ").toLowerCase();
    return haystack.includes(needle);
  };
  const itemOf = (sprite) => {
    const info = index.bySprite.get(sprite);
    if (!info || !index.atlas.has(sprite)) return null;
    const catalog = blipCatalogEntry(sprite);
    const title = blipTitle(sprite, info.symbol, language);
    if (!matches(sprite, info.symbol, title, catalog?.servers)) return null;
    return { ...info, title, servers: catalog?.servers || {}, listed: Boolean(catalog) };
  };
  const sections = BLIP_CATEGORIES.map((category) => ({
    id: category.id,
    title: blipText(category.title, language),
    items: BLIP_CATALOG.filter((entry) => entry.category === category.id)
      .map((entry) => itemOf(entry.sprite))
      .filter(Boolean),
  }));
  const listed = new Set(BLIP_CATALOG.map((entry) => entry.sprite));
  const rest = (index.state?.atlas?.items || [])
    .filter((sprite) => !listed.has(sprite))
    .map(itemOf)
    .filter(Boolean)
    .sort((a, b) => a.sprite - b.sprite);
  sections.push({ id: BLIP_REST_CATEGORY.id, title: blipText(BLIP_REST_CATEGORY.title, language), items: rest });
  return sections.filter((section) => section.items.length);
}

/**
 * Разделы «Иконок сервера» (Majestic): те же значки игры, но по разделам и под названиями сервера. Показываются все значки
 * серверного списка, что есть в игре игрока, — и те, у которых в листе нет картинки (векторные): у них плитка без рисунка и
 * причина в подсказке, чтобы счётчик раздела («16/16») честно считал весь раздел, а не только то, что нарисовалось.
 * `query` — подстрока: подпись сервера (на языке окна и русская), название раздела, имя символа, номер.
 */
export function buildServerSections(index, language, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  return SERVER_ICON_SECTIONS.map((section) => {
    const sectionTitle = serverSectionTitle(section, language);
    const wholeSection = needle && [sectionTitle, section.title.ru].join(" ").toLowerCase().includes(needle);
    const items = [];
    for (const [sprite, key, names] of section.icons) {
      const info = index.bySprite.get(sprite);
      if (!info) continue;
      const title = names[language] || names.en || names.ru;
      const haystack = [String(sprite), key, info.symbol, title, names.ru].join(" ").toLowerCase();
      if (needle && !wholeSection && !haystack.includes(needle)) continue;
      items.push({ ...info, key, title, servers: {}, listed: true, hasPicture: index.atlas.has(sprite) });
    }
    return { id: section.id, title: sectionTitle, items };
  }).filter((section) => section.items.length);
}

/** Название раздела серверного каталога на языке окна — для подписи выбранного значка. */
export function serverSectionName(id, language) {
  const section = SERVER_ICON_SECTIONS.find((item) => item.id === id);
  return section ? serverSectionTitle(section, language) : "";
}

/**
 * Значки, которые можно взять «из набора» вместо выбранного: все с картинкой — сначала подборка, потом остальные.
 */
export function readyIcons(index, language, query = "") {
  return buildSections(index, language, query).flatMap((section) => section.items);
}

/** Правка номера: `null` — как в игре. */
export const editOf = (work, sprite) => blipIconEdit(work, sprite);

/** Номера, что делят клетку с этим (без него самого). */
export const sharedOf = (index, sprite) => index.bySprite.get(sprite)?.sharedWith || [];

/**
 * Что будет в игре у номера с учётом общей клетки: своя правка, а если её нет — правка того, кто делит с ним клетку (клетка у
 * них одна, и игра меняет её разом). Правка в работе стоит одна на клетку (`applyBlipEdit`), поэтому у соседа по клетке
 * без этого плитка показывала бы «как в игре», а в игре значок был бы уже другим.
 */
export function effectiveEdit(index, work, sprite) {
  const own = blipIconEdit(work, sprite);
  if (own) return own;
  for (const other of sharedOf(index, sprite)) {
    const edit = blipIconEdit(work, other);
    if (edit) return edit;
  }
  return null;
}

/** Сколько значков из списка сейчас видно на карте (не скрыто) — для счётчика раздела «16/16». */
export const countVisible = (index, work, sprites) => sprites.filter((sprite) => effectiveEdit(index, work, sprite)?.mode !== "hidden").length;

/**
 * Работа с правкой номера. Правки остальных номеров его клетки снимаются: правка встаёт один раз (`null` возвращает значок игре
 * и всей общей клетке).
 */
export function applyBlipEdit(index, work, sprite, edit) {
  let next = normalizeBlipIcons(work);
  for (const other of sharedOf(index, sprite)) next = withBlipIconEdit(next, other, null);
  return withBlipIconEdit(next, sprite, edit);
}

/** Номера, что можно править (клетка есть и не заперта). */
export const editableSprites = (items) => items.filter((item) => item.editable).map((item) => item.sprite);

/** Скрыть все эти номера (общая клетка — один раз). */
export function hideBlips(index, work, sprites) {
  let next = normalizeBlipIcons(work);
  const done = new Set();
  for (const sprite of sprites) {
    if (done.has(sprite)) continue;
    done.add(sprite);
    for (const other of sharedOf(index, sprite)) done.add(other);
    next = applyBlipEdit(index, next, sprite, { mode: "hidden" });
  }
  return next;
}

/** Показать все эти номера: снимается только «скрыть», замены и свои картинки остаются. */
export function showBlips(index, work, sprites) {
  let next = normalizeBlipIcons(work);
  for (const sprite of sprites) {
    /* Скрытие мог поставить сосед по общей клетке (другой раздел): возвращается вся клетка. */
    if (effectiveEdit(index, next, sprite)?.mode !== "hidden") continue;
    next = applyBlipEdit(index, next, sprite, null);
  }
  return next;
}

/** Счётчик над списком: сколько значков скрыто и сколько заменено (замена значком игры и своя картинка). */
export function countEdits(work) {
  let hidden = 0;
  let replaced = 0;
  for (const edit of Object.values(normalizeBlipIcons(work).icons)) {
    if (edit.mode === "hidden") hidden += 1;
    else replaced += 1;
  }
  return { hidden, replaced };
}

/** Слово причины, по которой значок не меняется: окно переводит его в тексте (`reasonText`). */
export const REASON_WORDS = Object.freeze(["gps-owned", "vector", "placeholder", "composite", "no-symbol", "no-sheet", "unknown"]);

/** Подпись символа игры для инспектора: `radar_clothes_store` как есть. */
export const symbolName = (info) => info?.symbol || "";

export { humanSymbol };
