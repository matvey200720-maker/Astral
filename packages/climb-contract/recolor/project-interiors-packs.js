/*
 * «Интерьеры проектов» — пакеты интерьеров на CDN Astral (решение владельца
 * 17.10.2026, вечер: интерьеры Majestic и GTA 5 РП раздаются всем игрокам).
 *
 * Один пак проекта — один мод облачного каталога v2:
 *
 *   placement.section = "project-interiors" (в обычных полках каталога его нет),
 *   placement.slot    = "project-majestic" | "project-gta5rp",
 *   domain.projectInterior — список интерьеров пака с полнотой: редактор рисует
 *                            его, не скачав ни байта.
 *
 * Манифест пакета (`mod.json`, подписанный ключом каталога) объявляет
 * возможность `project-interiors-data-v1`: это файлы для редактора, а не мод.
 * Установщик такой пакет не ставит (`install-engine/project-interiors-data.js`),
 * редактор качает его сам и читает как папку игрока.
 *
 * Модуль без зависимостей: его читают скрипт сборки бандла, главный процесс и
 * окно. Данные в `domain` приходят с сервера — разбор `readProjectPack` им не
 * верит: всё режется до границ, чужие значения отбрасываются.
 */

export const PROJECT_PACK_SECTION = "project-interiors";
export const PROJECT_PACK_SLOTS = Object.freeze({ majestic: "project-majestic", gta5rp: "project-gta5rp" });
/* Короткие метки проектов в имени пакета: `projint-mj-…`, `projint-rp-…`. */
export const PROJECT_PACK_TAGS = Object.freeze({ majestic: "mj", gta5rp: "rp" });
export const PROJECT_PACK_CAPABILITY = "project-interiors-data-v1";
/* Куда «ставил» бы пакет старый лаунчер, если бы его всё же нажали ставить: изолированная папка `mods`, ни одной вещи игры. */
export const PROJECT_PACK_TARGET_ROOT = "mods/astral-project-interiors";
/* v1-категория мода и подпись полки: чтобы не пересечься с полкой «Интерьеры проектов» работ мастерской. */
export const PROJECT_PACK_CATEGORY = "interiors";
export const PROJECT_PACK_CATEGORY_LABEL = "Интерьеры";
export const PROJECT_PACK_SHELF = "Данные интерьеров";
export const PROJECT_PACK_VERSION = "1.0.0";
export const PROJECT_PACK_DOMAIN_KEY = "projectInterior";
export const PROJECT_PACK_DOMAIN_VERSION = 1;
/* Что вообще может лежать в таком пакете: ресурсы и метаданные игры, `.rpf` — только целые зашифрованные пакеты. */
export const PROJECT_PACK_EXTENSIONS = Object.freeze(["ydr", "ydd", "yft", "ytd", "ytyp", "ymap", "ymf", "ybn", "ycd", "rpf"]);
/* Имя пакета = slug мода = id манифеста. */
export const PROJECT_PACK_SLUG = /^projint-(mj|rp)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROJECT_PACK_SLUG_MAX = 64;
export const PROJECT_PACK_STATES = Object.freeze(["whole", "few", "many", "unknown"]);
/* Причины, по которым интерьер не предлагается к установке (`scan.js`): незнакомые из облака отбрасываются. */
export const PROJECT_PACK_BLOCKERS = Object.freeze(["no-game", "incomplete", "overrides-game", "hei-files", "no-placement", "too-big", "no-models", "no-manifest", "bad-names"]);

const INTERIOR_ID = /^p[0-9a-f]{8}$/;
const UNITS_LIMIT = 80;

/** Проект пака по slug, а `null` — не пак интерьеров. */
export function projectOfPackSlug(slug) {
  const match = PROJECT_PACK_SLUG.exec(String(slug || ""));
  if (!match || String(slug).length > PROJECT_PACK_SLUG_MAX) return null;
  return match[1] === "mj" ? "majestic" : "gta5rp";
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const text = (value, limit) => (typeof value === "string" ? value.replace(CONTROL, " ").trim().slice(0, limit) : "");
const count = (value, limit = 1e12) => (Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), limit) : 0);
const words = (value, limit, each) => (Array.isArray(value) ? value.slice(0, limit).map((item) => text(item, each)).filter(Boolean) : []);

function readUnit(item, place) {
  if (!item || typeof item !== "object" || !INTERIOR_ID.test(String(item.id || ""))) return null;
  const state = PROJECT_PACK_STATES.includes(item.state) ? item.state : "unknown";
  return {
    id: item.id,
    label: text(item.label, 80) || item.id,
    place: Array.isArray(item.place) ? words(item.place, 4, 60) : place,
    state,
    missingModels: count(item.missingModels, 100000),
    missingSheets: count(item.missingSheets, 100000),
    rooms: count(item.rooms, 10000),
    entities: count(item.entities, 100000),
    bytes: count(item.bytes),
    offered: item.offered === true,
    blockers: (Array.isArray(item.blockers) ? item.blockers : []).filter((code) => PROJECT_PACK_BLOCKERS.includes(code)).slice(0, PROJECT_PACK_BLOCKERS.length),
  };
}

/**
 * Пак интерьеров из мода облачного каталога (форма окна: `slug`, `name`,
 * `catalogSection`, `catalogSlot`, `domain`, `releaseId`) или `null`, если мод —
 * не пак интерьеров или его блок не годится. Сколько байт и интерьеров — как
 * заявил мод; проверяет это установка (подпись манифеста, sha256 файлов).
 */
export function readProjectPack(mod) {
  if (!mod || mod.catalogSection !== PROJECT_PACK_SECTION) return null;
  const project = projectOfPackSlug(mod.slug);
  if (!project || mod.catalogSlot !== PROJECT_PACK_SLOTS[project]) return null;
  const block = mod.domain?.[PROJECT_PACK_DOMAIN_KEY];
  if (!block || typeof block !== "object" || block.v !== PROJECT_PACK_DOMAIN_VERSION || block.project !== project) return null;
  const place = words(block.place, 4, 60);
  const units = (Array.isArray(block.units) ? block.units : [])
    .slice(0, UNITS_LIMIT)
    .map((item) => readUnit(item, place))
    .filter(Boolean);
  if (!units.length) return null;
  return {
    id: String(mod.id || ""),
    slug: String(mod.slug),
    project,
    name: text(mod.name, 160) || String(mod.slug),
    label: text(block.label, 120) || text(mod.name, 120) || String(mod.slug),
    place,
    author: text(mod.author, 80),
    releaseId: String(mod.releaseId || ""),
    files: count(block.files, 100000),
    bytes: count(block.bytes),
    units,
  };
}

/** Моды каталога без паков интерьеров и сами паки: так обычные полки не видят данных редактора. */
export function splitProjectPacks(catalog) {
  const mods = Array.isArray(catalog?.mods) ? catalog.mods : [];
  const packs = [];
  const rest = [];
  for (const mod of mods) {
    if (mod?.catalogSection === PROJECT_PACK_SECTION) packs.push(mod);
    else rest.push(mod);
  }
  if (!packs.length) return { catalog, packs: [] };
  const used = new Set(rest.map((mod) => mod.category));
  const categories = Array.isArray(catalog.categories) ? catalog.categories.filter((item) => item?.id !== PROJECT_PACK_CATEGORY || used.has(PROJECT_PACK_CATEGORY)) : catalog.categories;
  return { catalog: { ...catalog, mods: rest, ...(categories ? { categories } : {}) }, packs };
}
