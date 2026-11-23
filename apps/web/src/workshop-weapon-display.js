export const FEATURED_WEAPON_SLOT_IDS = Object.freeze([
  "assault-shotgun",
  "heavy-shotgun",
  "revolver",
  "heavy-pistol",
  "bullpup-rifle",
  "sniper-rifle",
  "mini-smg",
  "pump-shotgun",
  "special-carbine",
  "carbine-rifle",
  "carabine_reh",
  "carbine-rifle-mk2",
  "heavy-sniper",
  "heavy-sniper-mk2",
  "mg",
  "marksman-rifle",
]);

const featuredWeaponIds = new Set(FEATURED_WEAPON_SLOT_IDS);

// A small group of exported previews was rendered with a much lower source
// exposure. Brightness alone clips highlights while leaving true black pixels
// black, so every affected render gets a small studio profile: exposure brings
// the body into range and contrast gently opens its shadows. Keeping this in
// data makes the card, hover and both themes use the exact same correction.
const DEFAULT_WEAPON_PREVIEW_PROFILE = Object.freeze({
  exposure: 1,
  contrast: 0.94,
});

const weaponPreviewProfileById = Object.freeze({
  carabine_reh: Object.freeze({ exposure: 1.45, contrast: 0.86 }),
  "carbine-rifle-mk2": Object.freeze({ exposure: 1.45, contrast: 0.86 }),
  "heavy-sniper-mk2": Object.freeze({ exposure: 1.2, contrast: 0.9 }),
  "heavy-sniper": Object.freeze({ exposure: 1.25, contrast: 0.82 }),
  "special-carbine-mk2": Object.freeze({ exposure: 1.45, contrast: 0.86 }),
  "carbine-rifle": Object.freeze({ exposure: 1.2, contrast: 0.88 }),
});

export function orderWeaponCatalogSlots(slots) {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const featured = FEATURED_WEAPON_SLOT_IDS.map((id) => byId.get(id)).filter(
    Boolean,
  );
  const remaining = slots.filter((slot) => !featuredWeaponIds.has(slot.id));

  return [...featured, ...remaining];
}

export function resolveVisibleWeaponSlots(
  slots,
  { expanded = false, hasActiveFilter = false } = {},
) {
  const orderedSlots = orderWeaponCatalogSlots(slots);

  if (expanded || hasActiveFilter) {
    return orderedSlots;
  }

  return orderedSlots.slice(0, FEATURED_WEAPON_SLOT_IDS.length);
}

export function weaponPreviewTreatmentFor(slotId) {
  return slotId in weaponPreviewProfileById
    ? "normalized-low-light"
    : "normalized-standard";
}

export function weaponPreviewProfileFor(slotId) {
  return weaponPreviewProfileById[slotId] ?? DEFAULT_WEAPON_PREVIEW_PROFILE;
}

export function weaponPreviewExposureFor(slotId) {
  return weaponPreviewProfileFor(slotId).exposure;
}

export function weaponPreviewContrastFor(slotId) {
  return weaponPreviewProfileFor(slotId).contrast;
}
