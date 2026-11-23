/*
 * Варианты, которые на самом деле — один пак (28.10.2026, владелец: «ALL BLACK — на обложке один револьвер, остальные стволы только в компонентах»).
 *
 * Опись (`inventory.js`) делит пак на варианты, если одна модель лежит под разными якорями: так расцветки `blue/` и `red/` с одними и теми же
 * стволами становятся двумя паками. Но копия штатного ствола в соседнем DLC (ALL BLACK: в `mpapartment` — револьвер автора и штатный карабин,
 * в `patchday18ng` — правленый карабин и ещё три ствола) даёт повтор модели тем же образом — и пак распадался на «mpapartment» с одним револьвером
 * и «patchday18ng» с четырьмя: по умолчанию показывался первый. Опись базы штатных стволов не знает, поэтому решает работник — когда она есть.
 *
 * Правило: варианты — альтернативы друг другу, только если у каких-то двух есть общий ИЗМЕНЁННЫЙ ствол (не копия игры у обоих). Нет такого —
 * это части одного пака, разложенного автором по DLC: стволы складываются в один вариант. Общий штатный ствол в одном из них отбрасывается
 * копией (в пак идёт правленый). Без базы штатных стволов (`stock` пуст) ничего не решается — варианты остаются как есть.
 */

import { stockModels } from "./stock.js";

/**
 * @param {object[]} variants варианты описи (`gunpackInventory`)
 * @param {{ read: (path: string) => Promise<Uint8Array>, hashEntry: Function, stock: Set<string> }} options
 * @returns {Promise<object[]>} те же варианты или один объединённый
 */
export async function mergeDisjointVariants(variants, { read, hashEntry, stock } = {}) {
  if (!Array.isArray(variants) || variants.length < 2 || !stock?.size || typeof hashEntry !== "function") return variants;
  const stocked = [];
  for (const variant of variants) stocked.push(await stockModels(variant, { read, hashEntry, stock }));
  const changed = variants.map((variant, at) => new Set(variant.weapons.filter((weapon) => !stocked[at].has(weapon.model)).map((weapon) => weapon.model)));
  /* Общий изменённый ствол у любых двух — настоящие альтернативы (расцветки, серверы): всё как есть. */
  for (let left = 0; left < changed.length; left += 1)
    for (let right = left + 1; right < changed.length; right += 1) for (const model of changed[left]) if (changed[right].has(model)) return variants;

  const weapons = new Map();
  variants.forEach((variant, at) => {
    for (const weapon of variant.weapons) {
      const record = { ...weapon, variantKey: weapon.variantKey ?? variant.key };
      const own = !stocked[at].has(weapon.model);
      const known = weapons.get(weapon.model);
      /* Правленый ствол вытесняет штатную копию того же ствола из другого DLC. */
      if (!known || (own && known.stock)) weapons.set(weapon.model, { ...record, stock: !own });
    }
  });
  const attachments = new Map();
  const unknown = new Map();
  for (const variant of variants) {
    for (const attachment of variant.attachments || []) {
      const known = attachments.get(attachment.model);
      if (!known || attachment.bytes > known.bytes) attachments.set(attachment.model, attachment);
    }
    for (const item of variant.unknown || []) if (!unknown.has(item.model)) unknown.set(item.model, item);
  }
  const sum = (key) => variants.reduce((total, variant) => total + (Number(variant[key]) || 0), 0);
  return [
    {
      key: variants[0].key,
      /* Подпись варианта не нужна: пак один, имя — самого пака. */
      label: "",
      dlcpacks: [...new Set(variants.flatMap((variant) => variant.dlcpacks || []))].sort(),
      archives: [...new Set(variants.flatMap((variant) => variant.archives || []))].sort(),
      weapons: [...weapons.values()]
        .map(({ stock: _stock, ...weapon }) => weapon)
        .sort((left, right) => left.family.localeCompare(right.family) || left.name.localeCompare(right.name, "ru")),
      attachments: [...attachments.values()].sort((left, right) => left.model.localeCompare(right.model)),
      unknown: [...unknown.values()].sort((left, right) => left.model.localeCompare(right.model)),
      files: sum("files"),
      bytes: sum("bytes"),
    },
  ];
}
