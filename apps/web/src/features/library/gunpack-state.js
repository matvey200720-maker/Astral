/*
 * Ганпак по стволам: что из пака стоит в игре (22.11.2026). Чистые функции без React и без моста к Desktop — их берут и стартовый кусок окна (`engine-ids.js`), и ленивые модули установки и снятия.
 *
 * Пак встаёт записями на стволы с `origin.bundleId` — id пака (`bundles/gunpack-parts.js`), и служебной записью «прочее ганпака» (`local-gunpack-*`, тоже с `origin.bundleId`; она не мод каталога и своей строки в
 * библиотеке не имеет). `bundleOf` — «id записи → id сборки или пака, что её поставила» (`bundleOriginsOf`): по нему видно, какие записи принадлежат паку.
 */

/** Служебная запись «прочее ганпака»: строгий локальный пакет ганпака, а не мод каталога. */
export const EXTRAS_ID = /^local-gunpack-[0-9a-f]{12}$/;

/** Пак ганпака с составом из стволов (не сборка редукса — у неё свой ход). */
export const isGunpackPack = (mod) =>
  mod?.domain?.weapon?.pack === true && Boolean(mod?.includedModIds?.length) && mod?.publicationMode !== "bundle" && mod?.packageStatus !== "bundle";

/** Записи, что поставил этот пак: стволы каталога и служебное «прочее». */
export const packMembers = (packId, bundleOf = {}) => Object.keys(bundleOf).filter((id) => bundleOf[id] === packId);

/**
 * Сколько стволов пака стоит.
 * @returns {{ total: number, standing: string[], extras: string[] }} `standing` — id стоящих стволов пака (поставленных им), `extras` — id служебных записей
 */
export function packProgress(pack, bundleOf = {}, installed = []) {
  const members = packMembers(pack?.id, bundleOf);
  const guns = new Set(pack?.includedModIds || []);
  return {
    total: guns.size,
    standing: members.filter((id) => guns.has(id) && installed.includes(id)),
    extras: members.filter((id) => EXTRAS_ID.test(id)),
  };
}

/** Паки, которые «стоят» в игре, пока стоит хоть одна запись, поставленная ими: их id окно добавляет к установленным. */
export function standingPackIds(bundleOf = {}, mods = []) {
  const packs = new Set(Object.values(bundleOf));
  return mods.filter((mod) => packs.has(mod.id) && isGunpackPack(mod)).map((mod) => mod.id);
}

/**
 * Что снять по «Удалить ганпак» (корзина пака): стоящие стволы, которые поставил пак; пак, что стоит прежней одной записью, снимается своим id. Когда стволов этого пака не осталось (их сняли мимо
 * `removePackExtras`), а «прочее» стоит, снимается оно само: служебная запись с файлами в Astral Weapons DLC иначе осталась бы навсегда без корзины. Пока стоит хоть один ствол, «прочее» не предлагается.
 * @returns {string[]} пусто — это не пак или нечего снимать
 */
export function packRemovalIds(pack, installed = [], bundleOf = {}) {
  if (!isGunpackPack(pack)) return [];
  const { standing, extras } = packProgress(pack, bundleOf, installed);
  if (standing.length) return standing;
  const orphaned = extras.filter((id) => installed.includes(id));
  if (orphaned.length) return orphaned;
  return installed.includes(pack.id) && !packMembers(pack.id, bundleOf).length ? [pack.id] : [];
}

/**
 * Служебное «прочее» паков, которое уходит вместе с этой операцией: снимаются последние стволы пака (или всё, что стоит от пака) — запись «прочее» без стволов больше ни к чему и остаться не должна.
 * @param {string[]} removing id стволов (и записей), которые ставятся на снятие
 * @returns {{ packId: string, extras: string[] }[]}
 */
export function extrasLeaving(removing, { mods = [], installed = [], bundleOf = {} } = {}) {
  const leaving = new Set(removing);
  const packIds = [...new Set(removing.map((id) => bundleOf[id]).filter(Boolean))];
  const out = [];
  for (const packId of packIds) {
    const pack = mods.find((mod) => mod.id === packId);
    if (!isGunpackPack(pack)) continue;
    const { standing, extras } = packProgress(pack, bundleOf, installed);
    const rest = standing.filter((id) => !leaving.has(id));
    const wanted = extras.filter((id) => !leaving.has(id));
    if (!rest.length && wanted.length) out.push({ packId, extras: wanted });
  }
  return out;
}
