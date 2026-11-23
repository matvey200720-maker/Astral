import { isKeptMod, keptModIds, replacedConflicts, standsByParts } from "./plan-keeps.js";

const weaponSlots = {
  "tactical-arsenal": [
    "weapon:carbine",
    "weapon:special-carbine",
    "weapon:revolver",
    "weapon:smg",
    "weapon:pistol",
  ],
  "compact-weapons": [
    "weapon:carbine",
    "weapon:special-carbine",
    "weapon:revolver",
    "weapon:smg",
    "weapon:pistol",
  ],
  "carbon-rifle": ["weapon:carbine"],
  "classic-smg": ["weapon:smg"],
  "midnight-pistol": ["weapon:pistol"],
};
export const slotLabels = {
  "weapon:carbine": "Carbine Rifle",
  "weapon:special-carbine": "Special Carbine",
  "weapon:revolver": "Revolver",
  "weapon:smg": "SMG",
  "weapon:pistol": "Pistol",
  timecycle: "Таймцикл",
  graphics: "Графический пресет",
  optimization: "Оптимизация",
  "interface:hud": "Интерфейс",
  "effect:sirens": "Эффекты и сирены",
  "world:vegetation": "Растительность",
  "world:roads": "Дороги",
};
/*
 * Одежда спорит только местом вещи, и его знает движок: слот вещи он
 * уточняет по папкам записей (`install-engine/clothing-slots.js`), а
 * совпавшие записи видит сам (`plan.conflicts`). Здесь у мода каталога —
 * объявленный слот без коллекции или общий «clothing:Одежда» у мода без
 * манифеста, и по ним куртка сменяла бы чужую куртку другой коллекции, а
 * мод без манифеста — любую одежду (14.10.2026).
 */
const isClothing = (mod) =>
  mod?.catalogSection === "clothing" || mod?.category === "clothing";

/*
 * Маппинг каталога (16.10.2026) встаёт рядом с другим маппингом: у каждого
 * мода с манифестом свой контейнер (`withOwnMapsContainer` движка), и куски
 * одного редукса — Optimization, Gz, Zapretka — ставятся вместе. Общий
 * «world:Маппинг» сменял бы один кусок другим; совпавшие записи, если они
 * есть, назовёт план движка (`plan.conflicts`).
 */
const isMapping = (mod) =>
  mod?.catalogSlot === "mapping" && mod?.catalogSection === "redux";

export const conflictSlotsFor = (mod) => {
  if (isClothing(mod) || isMapping(mod)) return [];
  const declaredSlots = Array.isArray(mod?.manifest?.slots)
    ? mod.manifest.slots.filter(Boolean)
    : [];
  if (declaredSlots.length) return declaredSlots;
  if (weaponSlots[mod?.id]) return weaponSlots[mod.id];
  if (mod?.catalogSection === "gunpacks" || mod?.category === "gunpacks") {
    return [`weapon:${mod?.catalogSlot || mod?.id}`];
  }
  if (mod?.category === "weapons") return [`weapon:${mod.id}`];
  if (mod?.category === "timecycle") return ["timecycle"];
  if (mod?.category === "optimization") return ["optimization"];
  if (mod?.categoryLabel === "ИНТЕРФЕЙС") return ["interface:hud"];
  if (mod?.categoryLabel === "ЭФФЕКТЫ" || /siren/i.test(mod?.id || ""))
    return ["effect:sirens"];
  if (/tree|vegetation/i.test(mod?.id || "")) return ["world:vegetation"];
  if (/road/i.test(mod?.id || "")) return ["world:roads"];
  if (mod?.id === "urban-redux")
    return ["graphics", "timecycle", "world:roads", "effect:sirens"];
  if (mod?.id === "vanilla-plus") return ["graphics", "timecycle"];
  if (mod?.category === "graphics") return ["graphics"];
  return [`${mod?.category || "mod"}:${mod?.categoryLabel || mod?.id}`];
};
export const conflictingMods = (mod, ids, mods) => {
  const slots = new Set(conflictSlotsFor(mod));
  return mods.filter(
    (item) =>
      ids.includes(item.id) &&
      item.id !== mod.id &&
      conflictSlotsFor(item).some((slot) => slots.has(slot)),
  );
};

/**
 * Что сменит установка мода каталога: моды, чьи записи в игре он займёт
 * (`plan.conflicts`, кроме работ мастерской — они остаются под модом,
 * Т-107b), и моды той же части игры (`conflictingMods`). Каждый — один раз.
 */
export function planConflicts(plan, mod, ids, mods) {
  /* Работа, у которой остаются слоты, каких нет у нового мода (ганпак из трёх стволов и новый на один), не заменяется: новая ложится слоем (`plan-keeps.js`). */
  const kept = keptModIds(plan);
  const exact = replacedConflicts(plan)
    .filter((item) => !item.stack)
    .map((item) => {
      /* Движок называет установку id манифеста — у облачного мода это slug. */
      const known = mods.find(
        (candidate) =>
          candidate.id === item.modId || candidate.slug === item.modId,
      );
      return { ...known, id: known?.id || item.modId, fileCount: item.fileCount };
    })
    .filter((item) => item.id);
  const visual = conflictingMods(mod, ids, mods).filter((item) => !isKeptMod(kept, item) && !standsByParts(item, ids));
  return [...new globalThis.Map([...exact, ...visual].map((item) => [item.id, item])).values()];
}
