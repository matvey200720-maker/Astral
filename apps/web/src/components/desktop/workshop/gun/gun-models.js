import * as taxonomy from "../../../../catalog-taxonomy.js";
import { workshopOrder } from "../../../../features/catalog/recommend.js";
import * as studio from "@modovik/gun-studio";
import * as identity from "@modovik/rpf-inspector/weapon-identity";

export {
  builtinGunModels,
  catalogGunModels,
  gameGunModels,
  gunSlotInfo,
  standardGunVariant,
  weaponCatalogModels,
};

// Все записи этого модуля собираются одной фабрикой по чертежу своего вида (см. BLUEPRINTS внизу).
function entryFrom(kind, subject, context = {}) {
  const { source, fields } = BLUEPRINTS[kind];
  const values = Object.fromEntries(fields.map(([field, pick]) => [field, pick(subject, context)]));
  return studio.createModelEntry({ source, ...values });
}

const builtinGunModels = () => Array.from(taxonomy.weaponCatalogSlots, (shelf) => entryFrom("builtin", shelf));

const catalogGunModels = () => Array.from(SKIN_TITLES, ([shelf, title]) => entryFrom("skin", { shelf, title }));

function gunSlotInfo(slotId) {
  for (const slot of taxonomy.workshopWeaponSlots) {
    if (slot.id === slotId) return slot;
  }
  return null;
}

// Моды каталога, подходящие к полке, затем её собственный скин, если каталог его не прислал.
const weaponCatalogModels = (slotId, items = []) => {
  const mods = items || [];
  if (!Array.isArray(mods)) throw new TypeError("Список модов должен быть массивом.");

  const gameModel = identity.weaponByShelf(slotId)?.model;
  const context = { slotId, gameModel };
  const fitRules = [
    (mod) => mod.catalogSlot === slotId,
    (mod) => mod.domain?.weapon?.slot === slotId,
    (mod) => Boolean(gameModel) && mod.domain?.weapon?.model === gameModel,
  ];
  const fitting = mods.filter((mod) => hasModelUrl(mod) && fitRules.some((rule) => rule(mod)));

  const queue = [];
  for (const mod of workshopOrder(fitting)) queue.push(["mod", mod]);
  if (SKIN_TITLES.has(slotId)) queue.push(["skin", { shelf: slotId, title: SKIN_TITLES.get(slotId) }]);

  const modKeys = new Set();
  const result = [];
  for (const [kind, subject] of queue) {
    const entry = entryFrom(kind, subject, context);
    if (kind === "skin" && modKeys.has(entry.key)) continue;
    if (kind === "mod") modKeys.add(entry.key);
    result.push(entry);
  }
  return result;
};

// Что открыть, пока человек не выбрал сам: заводская, затем модель игры этой полки, затем первая.
function standardGunVariant(variants, slotId) {
  const ownModel = identity.weaponByShelf(slotId)?.model;
  let ownTile;
  const factory = variants.find((variant) => {
    if (variant.source === "game" && variant.weaponId === ownModel) ownTile ??= variant;
    return variant.source === "builtin";
  });
  return factory || ownTile || variants[0] || null;
}

// Родня ствола: сначала близкая, потом прочие, внутри каждой группы по названию (русская сортировка).
function relativesOf(gun) {
  const stem = gun.model.endsWith("mk2") ? gun.model.slice(0, -3) : gun.model;
  const word = (gun.name.trimEnd().match(/\S+$/)?.[0] ?? "").toLowerCase();
  const closeness = [
    (other) => other.model.startsWith(stem),
    (other) => other.name.toLowerCase().includes(word),
  ];

  const near = [];
  const rest = [];
  for (const other of identity.WEAPONS) {
    if (other.family !== gun.family || other.id === gun.id) continue;
    if (other.model.startsWith(MELEE_MODEL_PREFIX)) continue;
    (closeness.some((test) => test(other)) ? near : rest).push(other);
  }

  const collator = new Intl.Collator("ru");
  const byTitle = (a, b) => collator.compare(a.name, b.name);
  return near.sort(byTitle).concat(rest.sort(byTitle));
}

// Сам ствол полки (если у полки нет заводской модели) и родня; у холодного и метательного родни нет.
function* lineupOf(slotId, gun) {
  if (!gunSlotInfo(slotId)?.model) yield gun;
  if (gun.family === "melee" || gun.family === "thrown") return;
  yield* relativesOf(gun);
}

function gameGunModels(slotId) {
  const gun = identity.weaponByShelf(slotId);
  if (!gun) return [];
  return Array.from(lineupOf(slotId, gun), (weapon) => entryFrom("game", weapon, { slotId }));
}

function hasModelUrl(mod) {
  const url = mod?.model;
  return typeof url === "string" && url !== "";
}

const assetPath = (folder, key, extension) => [ASSET_ROOT, folder, `${key}.${extension}`].join("/");
const skinKey = ({ shelf }) => `dragon-${shelf}`;

const ASSET_ROOT = "/assets/catalog";
const MELEE_MODEL_PREFIX = "w_me_";

// полка -> хвост названия скина «Дракон», что едет с приложением
const SKIN_TITLES = new Map([
  ["revolver", "Revolver"],
  ["carbine-rifle", "Carbine Rifle"],
  ["special-carbine", "Special Carbine"],
  ["mini-smg", "Mini SMG"],
  ["assault-shotgun", "Assault Shotgun"],
]);

// вид записи -> источник и способы достать каждое поле: [поле, (предмет, контекст) => значение]
const BLUEPRINTS = {
  builtin: {
    source: "builtin",
    fields: [
      ["key", (shelf) => shelf.id],
      ["name", (shelf) => shelf.labels?.ru || shelf.ru || shelf.id],
      ["slot", (shelf) => shelf.id],
      ["family", (shelf) => shelf.family],
      ["type", (shelf) => shelf.type],
      ["url", (shelf) => shelf.model],
      ["preview", (shelf) => shelf.image],
    ],
  },
  skin: {
    source: "catalog",
    fields: [
      ["key", skinKey],
      ["name", ({ title }) => `DRAGON ${title}`],
      ["slot", ({ shelf }) => shelf],
      ["url", (skin) => assetPath("weapons-3d", skinKey(skin), "glb")],
      ["preview", (skin) => assetPath("weapons-mods", skinKey(skin), "png")],
    ],
  },
  mod: {
    source: "catalog",
    fields: [
      ["key", (mod) => mod.id],
      ["name", (mod) => mod.name],
      ["slot", (_mod, { slotId }) => slotId],
      ["weaponId", (mod, { gameModel }) => mod.domain?.weapon?.model || gameModel || ""],
      ["url", (mod) => mod.model],
      ["preview", (mod) => mod.cover || mod.image || ""],
    ],
  },
  game: {
    source: "game",
    fields: [
      ["key", (weapon) => weapon.model],
      ["name", (weapon) => weapon.name],
      ["slot", (_weapon, { slotId }) => slotId],
      ["weaponId", (weapon) => weapon.model],
      ["preview", (weapon) => gunSlotInfo(weapon.shelf)?.image || ""],
    ],
  },
};
