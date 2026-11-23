export const cloudItemsOf = (profile, { pattern, missingRelease, mods = [] }) => {
  const saved = (profile.items || []).reduce((map, part) => map.set(part.modId, part.releaseId), new Map());
  return Array.from(new Set(profile.modIds || []), (modId) => {
    const mod = mods.find((entry) => modId === entry.id);
    const releaseId = saved.get(modId) || (mod && mod.releaseId) || "";
    if (pattern.test(modId) && pattern.test(releaseId)) return { mod_id: modId, release_id: releaseId };
    throw new Error(missingRelease(mod?.name || modId));
  });
};
