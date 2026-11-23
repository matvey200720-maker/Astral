import { modWeapons, queryHits, queryWeapons, queryWords, weaponById } from "./search-concepts.js";


// «Звуки оружия «имя»»: слова любого регистра, кавычки любого из трёх видов, внутри хотя бы один знак.
const PACK_TITLE = /^\s*звуки\s+оружия\s*[«"“](.+)[»"”]\s*$/i;

// Признаки звука: блок domain.sound, слот weapon-sounds или категория sounds (регистр важен).
const SOUND_SIGNS = [
  (mod) => mod.domain?.sound,
  (mod) => mod.catalogSlot === "weapon-sounds",
  (mod) => mod.catalogCategory === "sounds",
];

const NOTHING = Object.freeze({ members: new Map(), packOf: new Map() });
const remembered = new WeakMap();

export const isSoundMod = (mod) => Boolean(mod) && SOUND_SIGNS.some((sign) => sign(mod));

// У мода есть собственный состав — значит, это пак, а не звук.
const holdsList = (mod) => Boolean(mod.includedModIds?.length);

// Паки по порядку списка; звук достаётся первому паку, назвавшему его, а id в индексе — последнему мода с таким id.
const regroup = (mods) => {
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const folded = mods.reduce(
    (acc, pack) => {
      if (!isSoundMod(pack) || !holdsList(pack) || acc.packOf.has(pack.id)) return acc;
      const list = pack.includedModIds
        .map((id) => byId.get(id))
        .filter((one) => one && one !== pack && isSoundMod(one) && !holdsList(one) && !acc.packOf.has(one.id));
      if (list.length > 0) {
        acc.members.set(pack.id, Object.freeze(list));
        list.forEach((one) => acc.packOf.set(one.id, pack.id));
      }
      return acc;
    },
    { members: new Map(), packOf: new Map() },
  );
  return Object.freeze(folded);
};

export const soundPacksOf = (mods) => {
  if (!Array.isArray(mods) || mods.length === 0) return NOTHING;
  if (!remembered.has(mods)) remembered.set(mods, regroup(mods));
  return remembered.get(mods);
};

// Имя пака — то, что в кавычках; любая другая строка остаётся как есть.
export const soundPackName = (name) => {
  const text = String(name || "");
  const [, inner] = PACK_TITLE.exec(text) ?? [];
  return inner === undefined ? text : inner.trim();
};

export const soundPackMembers = (pack, mods) => {
  const known = pack && Array.isArray(mods) ? soundPacksOf(mods) : NOTHING;
  return known.members.get(pack?.id) ?? [];
};

const withUrl = (take) => typeof take?.url === "string" && take.url !== "";

export const soundRow = (mod) => ({
  mod,
  weapons: modWeapons(mod)
    .map((id) => weaponById(id))
    .filter((gun) => gun && (gun.name || gun.catalog)),
  sound: (Array.isArray(mod?.audio) && mod.audio.find(withUrl)) || null,
});

// Какие звуки пака нашёл запрос: названные стволом идут первыми; совпал сам пак целиком — выделять нечего.
export const soundHitIds = (members, query, textOf) => {
  if (!(query && members?.length)) return [];
  const [need, named] = [queryWords(query).length, queryWeapons(query)];
  const marked = members.map((sound) => ({
    id: sound.id,
    fits: queryHits(textOf(sound), query) === need,
    byGun: modWeapons(sound).some((gun) => named.has(gun)),
  }));
  const [first, second] = [true, false].map((byGun) => marked.filter((m) => m.fits && m.byGun === byGun));
  return marked.every((m) => m.fits) && first.length === 0 ? [] : [...first, ...second].map((m) => m.id);
};
