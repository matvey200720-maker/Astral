// Учёт переопределений ствола, которые поставил звуковой пак: пак -> ствол -> { мод, слот }.
// Все функции работают над обычным объектом связей, вход не меняют и возвращают новый верхний объект.
export const PACK_WEAPON_LINKS_FILE = "pack-weapon-links.json";

const LINK_ERROR = "Связь звука ствола: нужны пак, ствол, мод и слот.";

// Поверхностная копия набора: строки распыляются по знакам, числа и массивы дают пустой набор.
// Ключ добавляется вычисляемым именем, поэтому «__proto__» из набора остаётся обычным свойством.
const shallowCopy = (value) =>
  Object.entries(value ?? {}).reduce((copy, [key, item]) => ({ ...copy, [key]: item }), {});

// Запись по ключу присваиванием; возвращает ту же цель.
function put(target, key, value) {
  target[key] = value;
  return target;
}

export function linkWeaponOverride(links, options) {
  const { packId, weaponId, modId, slot } = options;
  const sourceSha = options.sourceSha === undefined ? null : options.sourceSha;
  if ([packId, weaponId, modId, slot].some((part) => !part)) throw new TypeError(LINK_ERROR);

  const entry = { modId, slot, ...(sourceSha && { sourceSha }) };
  const next = shallowCopy(links);
  const record = shallowCopy(next[packId]);
  // Запись идёт присваиванием по ключу: служебные имена вроде __proto__ и constructor
  // остаются свойствами прототипа и ведут себя так же, как в учёте до переписывания.
  const replaced = record[weaponId] ?? null;
  const updatedRecord = put(record, weaponId, entry);
  const updatedLinks = put(next, packId, updatedRecord);
  return { links: updatedLinks, replaced };
}

export function unlinkPackWeaponOverrides(links, packId) {
  const all = links ?? {};
  const dropped = String(packId);
  const kept = Object.entries(all).reduce(
    (rest, [key, value]) => (key === dropped ? rest : { ...rest, [key]: value }),
    {},
  );
  const entries = Object.entries(all[packId] ?? {}).map(([weaponId, record]) =>
    Object.entries(record ?? {}).reduce((row, [key, item]) => ({ ...row, [key]: item }), { weaponId }),
  );
  return { links: kept, entries };
}

// modId элемента читается необязательным доступом (у null и примитивов он undefined); слоты читаются только
// при строгом совпадении modId и без защиты от null; ложные слоты считаются пустым списком.
export function isLinkedOverrideInstalled(entry, installed = []) {
  function matches(item) {
    return item?.modId === entry.modId && (item.slots || []).includes(entry.slot);
  }
  return installed.some(matches);
}

export function weaponsFreeForPack(weapons, config) {
  const links = config.links === undefined ? {} : config.links;
  const installed = config.installed === undefined ? [] : config.installed;
  // Моды, записанные в связях любого пака, слот не занимают: установка заменит их по слоту.
  const boundMods = Object.values(links).flatMap((records) => Object.values(records).map((record) => record.modId));
  function isStrangerHoldingSlot(slot) {
    return (item) => !boundMods.includes(item?.modId) && Boolean(item?.slots?.includes(slot));
  }
  return weapons.filter(({ slot }) => !installed.some(isStrangerHoldingSlot(slot)));
}
