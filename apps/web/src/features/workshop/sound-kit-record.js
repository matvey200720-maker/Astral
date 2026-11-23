
import { tr } from "../../locales/ui.js";
/*
 * Запись установки студии звуков — что из выстрелов и попаданий стоит в игре.
 *
 * Модуль лёгкий нарочно: его читает библиотека, а она живёт в стартовом
 * куске приложения. Таблица стволов, синтез и обработка звука остаются в
 * куске студии (`components/desktop/workshop/sound/*`); здесь только JSON
 * записи и то, как она раскладывается по карточкам полки.
 *
 * Запись: у каждого ствола свой мод (`weapons[<ствол>]`), у попаданий — один
 * мод на обе части (`hits`), у окружения — один мод на все ползунки (`mix`,
 * ТЗ 17.10.2026, задача 5). Кроме id мода в ней отпечаток поставленного
 * (им студия отличает «в игре» от «ждёт применения»), снимок замысла (им
 * библиотека пересобирает попадания без снятой части) и названия — полке не
 * нужно знать таблицу стволов, чтобы подписать карточку.
 */

export const SOUND_KIT_INSTALL_KEY = "astral.sound-kit.install.v1";
/* Черновик студии: отсюда её правку читают и сама студия, и «Мои работы»,
   которые кладут сюда открытую работу. */
export const SOUND_KIT_KEY = "astral.sound-kit.v1";

/* Карточки полки: звуки оружия — одна на все стволы, попадания — по части,
   окружение — на плитке «Фоновый шум». */
export const SOUND_WEAPON_SLOT = "weapon-sounds";
export const SOUND_MIX_SLOT = "ambient-noise";
export const SOUND_HIT_SLOTS = Object.freeze({
  head: "hit-sounds-head",
  body: "hit-sounds-body",
});
/* Карточка → часть попадания: по ним корзина снимает одну часть из двух. */
export const SOUND_HIT_SLOT_PARTS = Object.freeze(
  Object.fromEntries(
    Object.entries(SOUND_HIT_SLOTS).map(([part, slot]) => [slot, part]),
  ),
);

const text = (value) => (typeof value === "string" ? value : "");

/** Запись установки: `{ weapons, hits, mix }`; битая или пустая — пустая. */
export function readSoundKitInstalls(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(SOUND_KIT_INSTALL_KEY) || "null");
    return {
      weapons:
        value?.weapons && typeof value.weapons === "object" ? value.weapons : {},
      hits: value?.hits && typeof value.hits === "object" ? value.hits : null,
      mix: value?.mix && typeof value.mix === "object" ? value.mix : null,
    };
  } catch {
    return { weapons: {}, hits: null, mix: null };
  }
}

export function writeSoundKitInstalls(installs, storage = globalThis.localStorage) {
  try {
    const empty =
      !Object.keys(installs?.weapons || {}).length &&
      !installs?.hits &&
      !installs?.mix;
    if (empty) storage?.removeItem(SOUND_KIT_INSTALL_KEY);
    else storage?.setItem(SOUND_KIT_INSTALL_KEY, JSON.stringify(installs));
    return true;
  } catch {
    /* запись установки не сохранилась — в игре звук всё равно стоит */
    return false;
  }
}

/**
 * Установки студии звуков для полки библиотеки
 * (`workshop-library.js → readWorkshopInstallUnits`).
 *
 * Звук ствола — мод движка на карточке «Звуки оружия»; стволов бывает
 * несколько, и карточка одна. Попадания — один мод на карточках головы и
 * тела, помеченный `split: "sound-hits"`: корзина снимает с него только
 * отмеченную часть, пересобирая звук без неё.
 */
export function soundKitUnits(storage = globalThis.localStorage) {
  const { weapons, hits, mix } = readSoundKitInstalls(storage);
  const units = [];
  for (const [weaponId, record] of Object.entries(weapons)) {
    const modId = text(record?.modId);
    if (!modId) continue;
    const archives = Array.isArray(record.archives)
      ? record.archives.filter((name) => typeof name === "string" && name)
      : [];
    units.push({
      kind: "mod",
      key: `mod:${modId}`,
      modId,
      name: text(record.title) || tr("Свой звук ствола"),
      /* Куда встал звук — звуковые архивы, а не update.rpf. */
      where: `GTA V Legacy · ${archives.length ? archives.join(" + ") : tr("звуковые архивы")}`,
      slots: [SOUND_WEAPON_SLOT],
      installedAt: text(record.installedAt),
      origin: { type: "sound-kit", part: "weapon", weapon: weaponId },
    });
  }
  const modId = text(hits?.modId);
  const parts = Array.isArray(hits?.parts)
    ? hits.parts.filter((part) => SOUND_HIT_SLOTS[part])
    : [];
  /* Слой банка collision и метаданные звукового пакета; поставленное до
     записи архивов правило update.rpf. */
  const hitArchives = Array.isArray(hits?.archives)
    ? hits.archives.filter((name) => typeof name === "string" && name)
    : [];
  if (modId && parts.length)
    units.push({
      kind: "mod",
      key: `mod:${modId}`,
      modId,
      name: tr("Звуки попадания"),
      where: `GTA V Legacy · ${hitArchives.length ? hitArchives.join(" + ") : "RESIDENT.rpf + update.rpf"}`,
      slots: parts.map((part) => SOUND_HIT_SLOTS[part]),
      /* Подпись карточки у каждой части своя: «Колокольчик» у головы,
         «Хитмаркер» у тела. */
      slotNames: Object.fromEntries(
        parts
          .map((part) => [SOUND_HIT_SLOTS[part], text(hits.titles?.[part])])
          .filter(([, name]) => name),
      ),
      split: "sound-hits",
      installedAt: text(hits.installedAt),
      origin: { type: "sound-kit", part: "hits" },
    });
  /* Окружение — громкость категорий звука в update.rpf, одна карточка. */
  const mixModId = text(mix?.modId);
  if (mixModId)
    units.push({
      kind: "mod",
      key: `mod:${mixModId}`,
      modId: mixModId,
      name: tr("Звуки окружения"),
      where: "GTA V Legacy · update.rpf",
      slots: [SOUND_MIX_SLOT],
      installedAt: text(mix.installedAt),
      origin: { type: "sound-kit", part: "mix" },
    });
  return units;
}

/**
 * Что из звуков стоит в игре — снимком работы студии (`{ version, weapons,
 * hits }`): «Мои работы» считают работу «в игре», когда её снимок с ним
 * совпадает.
 *
 * Одной точки установки у звуков нет — мод на каждый ствол и мод
 * попаданий, — поэтому снимок собирается из замыслов, записанных при
 * установке. Звук без снимка замысла (найденный в игре мимо студии) с
 * работой не сравнить: тогда `null`.
 */
export function soundKitInstalledState(storage = globalThis.localStorage) {
  const { weapons, hits, mix } = readSoundKitInstalls(storage);
  const installed = Object.entries(weapons);
  const parts = Array.isArray(hits?.parts)
    ? hits.parts.filter((part) => SOUND_HIT_SLOTS[part])
    : [];
  const mixLevels =
    mix?.modId && mix.levels && typeof mix.levels === "object" ? mix.levels : null;
  if (!installed.length && !parts.length && !mix?.modId) return null;
  if (installed.some(([, record]) => !record?.design)) return null;
  if (parts.some((part) => !hits.designs?.[part])) return null;
  if (mix?.modId && !mixLevels) return null;
  /* Окружение — в снимке, только когда оно есть: так снимки работ до него
     совпадают с поставленным, как совпадали. */
  return JSON.stringify({
    version: 1,
    weapons: Object.fromEntries(
      installed.map(([id, record]) => [id, record.design]),
    ),
    hits: Object.fromEntries(
      Object.keys(SOUND_HIT_SLOTS).map((part) => [
        part,
        parts.includes(part) ? hits.designs[part] : null,
      ]),
    ),
    ...(mixLevels && Object.keys(mixLevels).length
      ? { mix: { levels: mixLevels } }
      : {}),
  });
}

/**
 * Снятые из игры моды уходят из записи — после корзины библиотеки.
 *
 * @param {Iterable<string>} modIds моды, которых в игре больше нет
 * @returns {boolean} изменилась ли запись
 */
export function forgetSoundKitMods(storage, modIds) {
  const removed = new Set(modIds);
  if (!removed.size) return false;
  const installs = readSoundKitInstalls(storage);
  let changed = false;
  const weapons = {};
  for (const [id, record] of Object.entries(installs.weapons)) {
    if (removed.has(record?.modId)) changed = true;
    else weapons[id] = record;
  }
  let hits = installs.hits;
  if (hits && removed.has(hits.modId)) {
    hits = null;
    changed = true;
  }
  let mix = installs.mix;
  if (mix && removed.has(mix.modId)) {
    mix = null;
    changed = true;
  }
  if (!changed) return false;
  return writeSoundKitInstalls({ weapons, hits, mix }, storage);
}
