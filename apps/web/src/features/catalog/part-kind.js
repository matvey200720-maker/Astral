/*
 * Вид части мода — отдельным лёгким модулем: его читают на старте (`part-map.js`), а `pack-contents.js` тянет за собой
 * тексты состава пака, оружие, звуки и наборы мэппинга, которым на старте делать нечего.
 */
import { REDUX_BASE_SLOT, isReduxBase } from "./bundles/component-groups.js";

export const partKindOf = (mod) => {
  if (isReduxBase(mod)) return REDUX_BASE_SLOT;
  const gunpack =
    mod?.catalogSection === "gunpacks" &&
    (mod.catalogSlot === "gunpack" || mod.includedModIds?.length);
  if (gunpack) return "gunpack";
  return mod?.category === "timecycle" ? "timecycle" : mod?.catalogSlot || "";
};
