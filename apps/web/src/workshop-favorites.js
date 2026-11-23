const FAVORITE_PREFIX = "workshop-slot";

export function workshopSlotFavoriteId(section, slotId) {
  return `${FAVORITE_PREFIX}:${section}:${slotId}`;
}

export function isWorkshopSlotFavorite(
  favorites,
  section,
  slotId,
  publishedMods = [],
) {
  const favoriteIds = new Set(favorites);
  return (
    favoriteIds.has(workshopSlotFavoriteId(section, slotId)) ||
    publishedMods.some((mod) => favoriteIds.has(mod.id))
  );
}

export function workshopSlotFavoriteTarget({ section, slotId, title, type }) {
  return {
    id: workshopSlotFavoriteId(section, slotId),
    name: title,
    description: type,
    catalogSection: section,
    catalogSlot: slotId,
    internal: true,
  };
}
