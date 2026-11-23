import { weaponSlug } from "@modovik/sound-studio";
import { weaponsOfSoundSlots } from "@modovik/weapon-sound-pack";

const MOD_PREFIX = "local-sound-weapon-";
const SLOT_PREFIX = "sound-weapon-";

const isWorkshopMod = (record) => String(record?.modId || "").startsWith(MOD_PREFIX);
const slotsOf = (record) => record.slots || [];

// Слот → modId первой записи мастерской, чей список слотов его содержит.
function ownersOfSlots(records, slots) {
  const owners = new Map();
  for (const record of records) {
    for (const slot of slots) {
      if (!owners.has(slot) && slotsOf(record).includes(slot)) owners.set(slot, record.modId);
    }
  }
  return owners;
}

export function workshopSoundsUnderPack(manifest, installed = []) {
  const slotByWeapon = new Map(
    weaponsOfSoundSlots(manifest?.slots).map((weapon) => [
      weapon,
      SLOT_PREFIX + weaponSlug(weapon.id),
    ]),
  );
  if (slotByWeapon.size === 0) return [];

  const records = Array.isArray(installed) ? installed.filter(isWorkshopMod) : [];
  const owners = ownersOfSlots(records, new Set(slotByWeapon.values()));
  return [...slotByWeapon]
    .filter(([, slot]) => owners.has(slot))
    .map(([weapon, slot]) => ({ weapon: weapon.id, title: weapon.title, modId: owners.get(slot) }));
}
