// Черновики студий оружия и одежды: таблица «ствол или вещь → запись» в localStorage.
// Проект здесь не разбирается: модуль только читает таблицу, пишет её и кладёт один проект.

import { variantGender } from "@modovik/clothing/gender";

const DRAFT_LIMIT = 64;
const KEYS = { gun: "astral.gun-studio.drafts.v2", clothing: "astral.clothing-studio.drafts.v1" };

// Метки записей как текст; у записи без метки (и у самой null) она пустая.
const stampsOf = (rows) => rows.map(([, entry]) => String(entry?.updatedAt ?? ""));

// Остаются самые свежие записи; равные метки сохраняют порядок входа.
function newestOnly(table) {
  const rows = Object.entries(table);
  const stamps = stampsOf(rows);
  const order = Array.from(rows.keys()).sort(
    (left, right) => stamps[right].localeCompare(stamps[left]) || left - right,
  );
  return Object.fromEntries(order.slice(0, DRAFT_LIMIT).map((at) => rows[at]));
}

// Слой хранилища: одно место, где живут параметры (storage, key) и обработка ошибок чтения.
const shelfOf = (storage, key) => ({
  load() {
    try {
      const table = JSON.parse(storage.getItem(key));
      return typeof table === "object" && table !== null && !Array.isArray(table) ? table : {};
    } catch {
      return {};
    }
  },
  store(table) {
    const kept = newestOnly(table);
    if (storage != null) {
      storage.setItem(key, JSON.stringify(kept));
    }
  },
});

export function putGunDraftEntry(slot, project, storage = globalThis.localStorage, key = KEYS.gun) {
  if (!slot || !project || typeof project !== "object") {
    return false;
  }
  const shelf = shelfOf(storage, key);
  try {
    const table = shelf.load();
    // Присваивание, а не fromEntries: имя «__proto__» ведёт себя как раньше.
    table[slot] = { updatedAt: new Date().toISOString(), project };
    shelf.store(table);
    return true;
  } catch {
    return false;
  }
}

export function writeGunDraftEntries(drafts, storage = globalThis.localStorage, key = KEYS.gun) {
  shelfOf(storage, key).store(drafts);
}

export function readGunDraftEntries(storage = globalThis.localStorage, key = KEYS.gun) {
  return shelfOf(storage, key).load();
}

export const { gun: GUN_DRAFTS_KEY, clothing: CLOTHING_DRAFTS_KEY } = KEYS;

/**
 * Черновик одежды — по слоту и полу (ревью 14.11.2026, п. 4): мужской лежит под прежним именем слота (старые записи читаются как мужские, миграции нет), женский — под `слот.f`.
 * Так закрашенная мужская вещь слота не пропадает, когда в том же слоте правят женскую.
 */
export const draftSlot = (slot, gender) => (gender === "female" && slot ? `${slot}.f` : slot);

/** Какому полу принадлежит запись таблицы черновиков одежды: `{ slot, gender }`. */
export const draftOwner = (key) => (String(key).endsWith(".f") ? { slot: String(key).slice(0, -2), gender: "female" } : { slot: String(key), gender: "male" });

/** Пол проекта по его вещи игры (`game:слот-число`, женское число — со смещением); вещь каталога и пустое — `null`: пол в id не написан. */
export const draftGenderOf = (modelId) => {
  const game = /^game:[a-z-]+-(\d+)$/.exec(String(modelId ?? ""));
  return game ? variantGender(Number(game[1])) : null;
};
