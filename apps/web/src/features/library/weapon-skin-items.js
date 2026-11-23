import { WEAPON_SKIN_INSTALLS_KEY } from "../workshop/install-queue/tasks/weapon-skin-key.js";
import { PACK_SKIN_INSTALLS_KEY } from "../workshop/install-queue/tasks/pack-skin-key.js";
import { tr } from "../../locales/ui.js";
import { modPicture } from "./mod-picture.js";

/*
 * Своё оружие в «Библиотеке» (ТЗ 24.10.2026, п. 5).
 *
 * Скин ствола из мастерской и покраска ствола из «Моих паков» ставятся не
 * модом каталога, а локальным пакетом (`local-weapon-skin-*`, `local-gunpack-*`),
 * и у каждого ствола своя запись в хранилище окна (`skin-installs.js`). Полка
 * оружия показывала только моды каталога на слотах стволов: поставленный в
 * мастерской скин в «Библиотеку» не попадал, хотя в игре стоял, и сборка его не
 * видела. Здесь — то же, что `clothing-paint-slots.js` делает для одежды:
 * запись установки → карточка полки и установка для корзины.
 *
 * Модуль читает только `localStorage` (как и одежда): полка стоит в стартовом
 * куске окна, а мост к Desktop и очередь тянуть ради двух строк незачем.
 */

const KINDS = Object.freeze([
  Object.freeze({ kind: "skin", storageKey: WEAPON_SKIN_INSTALLS_KEY, modId: /^local-weapon-skin-/ }),
  Object.freeze({ kind: "pack", storageKey: PACK_SKIN_INSTALLS_KEY, modId: /^local-gunpack-/ }),
]);

/* Слот карточки: по нему корзина находит, что снимать. */
const ITEM_SLOT = "weapon-skin:";
const LOCALES = ["ru", "uk", "en", "de", "pl", "fr"];

const text = (value) => (typeof value === "string" ? value.trim() : "");
const everyLocale = (value) => Object.fromEntries(LOCALES.map((locale) => [locale, value]));

function readAll(storage, storageKey) {
  try {
    const raw = JSON.parse(storage?.getItem(storageKey) || "null");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/* Пакеты записи: у копящей памяти — по работам, у прочей — modIds. */
const modIdsOf = (record) =>
  (record?.works?.length
    ? record.works.map((work) => work?.modId)
    : record?.modIds?.length
      ? record.modIds
      : [record?.modId]
  ).filter((modId) => typeof modId === "string" && modId);

/** Ствол, на котором стоит скин: ключ записи скина — это слот ствола. */
const weaponOf = (kind, key, record) =>
  kind === "skin" ? text(record?.slot) || key : text(record?.slot);

/**
 * Скины стволов и стволы паков, что стоят в игре:
 * `[{ id, key, kind, slot, name, modIds, installedAt }]`, от старых к новым.
 */
export function installedWeaponItems(storage = globalThis.localStorage) {
  const out = [];
  for (const { kind, storageKey, modId: pattern } of KINDS) {
    for (const [key, record] of Object.entries(readAll(storage, storageKey))) {
      const modIds = modIdsOf(record).filter((modId) => pattern.test(modId));
      if (!modIds.length) continue;
      out.push({
        id: `${ITEM_SLOT}${kind}:${key}`,
        key,
        kind,
        slot: weaponOf(kind, key, record),
        name: text(record?.name),
        modIds,
        installedAt: text(record?.installedAt),
      });
    }
  }
  return out.sort((left, right) => left.installedAt.localeCompare(right.installedAt));
}

/** Установки скинов оружия для полки и корзины библиотеки. */
export const weaponSkinUnits = (storage = globalThis.localStorage) =>
  installedWeaponItems(storage).flatMap((item) =>
    item.modIds.map((modId) => ({
      kind: "mod",
      key: `mod:${modId}`,
      modId,
      name: item.name,
      slots: [item.id],
      installedAt: item.installedAt,
      origin: { type: "weapon-skin", key: item.key },
    })),
  );

/**
 * После снятия из библиотеки: снятые пакеты уходят из записей скинов,
 * запись без пакетов — целиком. Возвращает, менялось ли что-то.
 */
export function forgetWeaponSkinMods(storage = globalThis.localStorage, removed = new Set()) {
  if (!storage || !removed?.size) return false;
  let changed = false;
  for (const { storageKey } of KINDS) {
    const records = readAll(storage, storageKey);
    let touched = false;
    for (const [key, record] of Object.entries(records)) {
      if (!record || typeof record !== "object") continue;
      const modIds = modIdsOf(record);
      const left = modIds.filter((modId) => !removed.has(modId));
      if (left.length === modIds.length) continue;
      touched = true;
      if (!left.length) delete records[key];
      else records[key] = { ...record, modId: left[0], modIds: left, works: undefined };
    }
    if (!touched) continue;
    try {
      storage.setItem(storageKey, JSON.stringify(records));
      changed = true;
    } catch {
      /* приватный режим: пакет снят из игры, теряется только карточка */
    }
  }
  return changed;
}

/**
 * Карточки полки «Оружие» для скинов. `weaponSlots` — стволы мастерской
 * (`workshopWeaponSlots`): по ним карточка берёт кадр и имя ствола. У ствола пака (его слота у мастерской нет) кадр — обложка
 * мода каталога с этим слотом (`mods`, 25.10.2026: «Неон», «Гонка», «Сакура» стояли без превью).
 */
export function weaponSkinCards(items = [], weaponSlots = [], { mods = [] } = {}) {
  const bySlot = new Map(weaponSlots.map((slot) => [slot.id, slot]));
  return items.map((item) => {
    const weapon = bySlot.get(item.slot) || null;
    const catalogMod =
      !weapon?.image && item.slot
        ? mods.find(
            (mod) =>
              (mod?.catalogSlot === item.slot ||
                mod?.id === item.slot ||
                mod?.domain?.weapon?.slot === item.slot) &&
              modPicture(mod),
          ) || null
        : null;
    const kindNote = item.kind === "pack" ? tr("Ствол из пака") : tr("Свой скин");
    const name = item.name || (weapon ? "" : tr("Скин оружия"));
    return {
      id: item.id,
      /* Куда ведёт карточка: слот ствола, если он известен мастерской. */
      category: weapon?.id || "",
      placed: true,
      mod: null,
      weaponSlot: weapon?.id || "",
      title: name ? everyLocale(name) : weapon?.labels || weapon?.title || everyLocale(tr("Скин оружия")),
      /* Под своим именем — ствол и откуда он: «Карабинная винтовка · Свой скин». */
      description: Object.fromEntries(
        LOCALES.map((locale) => [
          locale,
          [name && weapon ? weapon.labels?.[locale] || weapon.labels?.ru : "", kindNote].filter(Boolean).join(" · "),
        ]),
      ),
      image: weapon?.image || modPicture(catalogMod) || "",
      fallbackImage: weapon?.fallbackImage,
    };
  });
}
