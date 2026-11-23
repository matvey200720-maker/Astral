/*
 * Куда в каталоге ложится отдельный ствол.
 *
 * Витрина оружия устроена так: сначала человек видит ганпаки целиком, а
 * потом переключается на конкретное оружие. Значит, из одного ганпака
 * рождается не одна карточка, а пак плюс по карточке на ствол, и у каждого
 * ствола есть своё место: полка мастерской (`carbine-rifle-mk2`) и подраздел
 * общего каталога («Скины → Carbine Rifle MK2»).
 *
 * Кто есть кто, решает таблица оружия (`weapon-identity.js`): там модели и
 * имена сверены с данными игры. Здесь из неё выводится место в каталоге.
 * Общие обвесы (`w_at_*`) стволом не бывают — они едут отдельной карточкой
 * «Обвесы», потому что один прицел стоит на многих стволах.
 */

import { WEAPONS, identifyWeaponModel } from "./weapon-identity.js";
import { weaponName } from "./weapon-names.js";

/** Подраздел каталога для общих обвесов: прицелы, глушители, фонари. */
export const ATTACHMENTS_SUBCATEGORY = "Обвесы";

/** Полки мастерской: id полки, семейство и подраздел каталога. */
export const CATALOG_WEAPON_SLOTS = Object.freeze(
  WEAPONS.filter((item) => item.shelf).map((item) =>
    Object.freeze([item.shelf, item.family, item.catalog]),
  ),
);

const FAMILY_BY_PREFIX = Object.freeze({
  pi: "pistol",
  sb: "smg",
  sg: "shotgun",
  ar: "rifle",
  sl: "rifle",
  sr: "sniper",
  mg: "machinegun",
  lr: "launcher",
  me: "melee",
  ex: "thrown",
});

const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const modelSlug = (model) =>
  slug(String(model || "").replace(/^w_[a-z]{2}_/, "")) || "weapon";

/**
 * Место модели в каталоге.
 *
 * `kind` — `weapon` или `attachment`. `slot` — полка мастерской, а у ствола
 * без полки — его собственный слот (`revolver-mk2`): конфликт двух версий
 * одного ствола при установке всё равно разрешается. `subcategory` — подпись
 * подраздела общего каталога или пустая строка, если своей полки там нет.
 * `known` — есть ли модель в таблице оружия.
 */
export function describeWeaponSlot(model) {
  const identity = identifyWeaponModel(model);
  if (identity.kind === "attachment")
    return {
      kind: "attachment",
      weaponId: null,
      model: identity.model,
      name: "Обвесы",
      slot: "attachments",
      family: "attachment",
      subcategory: ATTACHMENTS_SUBCATEGORY,
      shelf: false,
      known: true,
    };
  if (identity.kind === "weapon") {
    const { weapon } = identity;
    return {
      kind: "weapon",
      weaponId: weapon.id,
      model: weapon.model,
      name: weapon.name,
      slot: weapon.shelf || slug(weapon.catalog) || modelSlug(weapon.model),
      family: weapon.family,
      subcategory: weapon.catalog || "",
      shelf: Boolean(weapon.shelf),
      known: true,
    };
  }
  const prefix = identity.model.match(/^w_([a-z]{2})_/)?.[1];
  return {
    kind: "weapon",
    weaponId: null,
    model: identity.model,
    name: weaponName(identity.model),
    slot: modelSlug(identity.model),
    family: FAMILY_BY_PREFIX[prefix] || "weapon",
    subcategory: "",
    shelf: false,
    known: false,
  };
}
