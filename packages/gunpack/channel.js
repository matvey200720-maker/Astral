// Имя канала поста: сведение к буквам и подсказка о виде мода и стволе.

const SMALL_CAPS = new Map(
  Array.from("ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡʏᴢ").map((char, index) => [
    char,
    "abcdefghijklmnopqrstuvwyz"[index],
  ]),
);

const KIND_NAMES = {
  gunpack: [
    "gunpack", "gunpacks", "guns", "weapons", "weaponpack", "weaponpacks",
    "weaponskins", "gunskins", "ганпак", "ганпаки", "оружие", "скинынаоружие",
  ],
  "weapon-sounds": [
    "soundsguns", "soundgun", "gunsounds", "gunsound", "weaponsounds", "weaponsound",
    "звукиоружия", "звукиганов",
  ],
  "sniper-reticle": [
    "scope", "scopes", "sniperscope", "sniperscopes", "sniper", "снайпер",
    "снайперскиеприцелы", "оптика",
  ],
  reticle: ["crosshair", "crosshairs", "reticle", "reticles", "прицел", "прицелы"],
  tracers: ["tracer", "tracers", "трейсер", "трейсеры", "трассеры"],
  effects: ["effects", "blood", "killeffect", "killeffects", "эффекты", "кровь", "киллэффекты"],
};

const KIND_BY_NAME = new Map(
  Object.entries(KIND_NAMES).flatMap(([kind, names]) => names.map((name) => [name, kind])),
);

// `sniper` стоит и здесь, и в видах намеренно: там это прицел, здесь снайперские винтовки.
const WEAPON_CHANNELS = new Map(
  Object.entries({
    revolver: { weapons: ["WEAPON_REVOLVER"] },
    revolvermk2: { weapons: ["WEAPON_REVOLVER_MK2"] },
    deagle: { weapons: ["WEAPON_PISTOL50"] },
    glock: { families: ["pistol"], look: "Glock" },
    cz75: { families: ["pistol"], look: "CZ-75" },
    usp: { families: ["pistol"], look: "USP" },
    p250: { families: ["pistol"], look: "P250" },
    carbine: { weapons: ["WEAPON_CARBINERIFLE"] },
    carbinemk2: { weapons: ["WEAPON_CARBINERIFLE_MK2"] },
    shotgun: { families: ["shotgun"] },
    pulik: { weapons: ["WEAPON_MG", "WEAPON_COMBATMG", "WEAPON_COMBATMG_MK2"] },
    sniper: { families: ["sniper"] },
    marksmanrifle: { weapons: ["WEAPON_MARKSMANRIFLE", "WEAPON_MARKSMANRIFLE_MK2"] },
    knife: { weapons: ["WEAPON_KNIFE"] },
  }),
);

function plainName(name) {
  const text = String(name || "").normalize("NFKC");
  return Array.from(text, (char) => SMALL_CAPS.get(char) ?? char)
    .join("")
    .toLowerCase()
    .replace(/ё/g, "е");
}

export function channelLetters(name) {
  return plainName(name).replace(/[^a-zа-я]/g, "");
}

export function channelKey(name) {
  return plainName(name).replace(/[^a-zа-я0-9]/g, "");
}

export function weaponChannelKind(name) {
  return KIND_BY_NAME.get(channelLetters(name)) ?? null;
}

// Массивы таблицы отдаются те самые: вызывающие могут видеть правки друг друга.
export function weaponOfChannel(name) {
  const key = channelKey(name);
  const entry = WEAPON_CHANNELS.get(key);
  if (!entry) return null;
  return { key, weapons: entry.weapons ?? [], families: entry.families ?? [], look: entry.look ?? "" };
}

export function channelFits(channel, weapon) {
  if (!channel || !weapon) return false;
  return channel.weapons.includes(weapon.weaponId) || channel.families.includes(weapon.family);
}
