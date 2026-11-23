// Словарь bloodfx.dat: секции, кости, классы оружия, колонки записи и человеческие группировки.

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const records = (keys, rows) => rows.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])));

export const BLOODFX_TABLES = deepFreeze(
  records(
    ["id", "section", "label"],
    [
      ["alive", "BLOODFX_TABLE_ALIVE", "Живой, одиночная игра"],
      ["dead", "BLOODFX_TABLE_DEAD", "Труп, одиночная игра"],
      ["alive-mp", "BLOODFX_TABLE_ALIVE_MP", "Живой, сетевая игра"],
      ["dead-mp", "BLOODFX_TABLE_DEAD_MP", "Труп, сетевая игра"],
    ],
  ),
);

export const BLOODFX_RECORD_SECTIONS = deepFreeze(
  records(
    ["id", "section", "label"],
    [
      ["entry", "BLOODFX_ENTRY_INFO", "Входное отверстие"],
      ["exit", "BLOODFX_EXIT_INFO", "Выходное отверстие"],
    ],
  ),
);

export const BLOOD_BODY_PARTS = deepFreeze([
  "BUTTOCKS",
  "THIGH_LEFT",
  "SHIN_LEFT",
  "FOOT_LEFT",
  "THIGH_RIGHT",
  "SHIN_RIGHT",
  "FOOT_RIGHT",
  "SPINE0",
  "SPINE1",
  "SPINE2",
  "SPINE3",
  "CLAVICLE_LEFT",
  "UPPER_ARM_LEFT",
  "LOWER_ARM_LEFT",
  "HAND_LEFT",
  "CLAVICLE_RIGHT",
  "UPPER_ARM_RIGHT",
  "LOWER_ARM_RIGHT",
  "HAND_RIGHT",
  "NECK",
  "HEAD",
  "ANIMAL_DEFAULT",
]);

export const BLOOD_WEAPON_CLASSES = deepFreeze([
  "PUNCH_KICK",
  "MELEE_WOOD",
  "MELEE_METAL",
  "MELEE_SHARP",
  "MELEE_GENERIC",
  "PISTOL_SMALL",
  "PISTOL_LARGE",
  "PISTOL_SILENCED",
  "RUBBER",
  "SMG",
  "SHOTGUN",
  "RIFLE_ASSAULT",
  "RIFLE_SNIPER",
  "ROCKET",
  "GRENADE",
  "MOLOTOV",
  "FIRE",
  "EXPLOSION",
  "LASER",
  "STUNGUN",
  "HEAVY_MG",
  "VEHICLE_MG",
  "CLOWN",
  "ALIEN",
  "SKELETON",
]);

export const BLOODFX_RECORD_FIELDS = 43;

export const BLOODFX_FIELD = deepFreeze(
  Object.fromEntries([
    ["id", 0],
    ["probability", 1],
    ["splatDecalNormal", 2],
    ["splatDecalSoak", 3],
    ["sprayDecalNormal", 4],
    ["sprayDecalSoak", 5],
    ["mistDecalNormal", 6],
    ["mistDecalSoak", 7],
    ["tintRed", 8],
    ["tintGreen", 9],
    ["tintBlue", 10],
    ["sizeAHighMin", 20],
    ["sizeAHighMax", 21],
    ["sizeALowMin", 22],
    ["sizeALowMax", 23],
    ["sizeBHighMin", 24],
    ["sizeBHighMax", 25],
    ["sizeBLowMin", 26],
    ["sizeBLowMax", 27],
    ["fxSystem", 34],
    ["fxSystemBodyArmour", 35],
    ["fxSystemHeavyArmour", 36],
    ["fxSystemUnderwater", 37],
    ["sizeEvolution", 38],
    ["fxProbability", 39],
    ["damageName", 40],
    ["damageNameBodyArmour", 41],
    ["damageNameHeavyArmour", 42],
  ]),
);

export const BLOODFX_NAME_FIELDS = deepFreeze([34, 35, 36, 37, 40, 41, 42]);

export const BLOODFX_EMPTY_NAME = "-";

export const BLOOD_ZONES = deepFreeze(
  records(
    ["id", "label", "description", "parts"],
    [
      ["head", "Голова", "Попадание в череп — самый заметный эффект в игре.", ["HEAD"]],
      ["throat", "Шея", "Отдельная зона: у неё своя запись и в оригинале.", ["NECK"]],
      ["torso", "Корпус", "Грудь, живот и таз — основная масса попаданий.", ["SPINE0", "SPINE1", "SPINE2", "SPINE3", "BUTTOCKS"]],
      [
        "arms",
        "Руки",
        "Плечи и предплечья.",
        ["CLAVICLE_LEFT", "UPPER_ARM_LEFT", "LOWER_ARM_LEFT", "CLAVICLE_RIGHT", "UPPER_ARM_RIGHT", "LOWER_ARM_RIGHT"],
      ],
      ["legs", "Ноги", "Бёдра и голени.", ["THIGH_LEFT", "SHIN_LEFT", "THIGH_RIGHT", "SHIN_RIGHT"]],
      [
        "extremities",
        "Кисти и стопы",
        "Мелкие кости: в оригинале у них ослабленный эффект.",
        ["HAND_LEFT", "HAND_RIGHT", "FOOT_LEFT", "FOOT_RIGHT"],
      ],
      ["animal", "Животные", "Единственная строка для всей живности.", ["ANIMAL_DEFAULT"]],
    ],
  ),
);

export const BLOOD_WEAPON_GROUPS = deepFreeze(
  records(
    ["id", "label", "classes"],
    [
      [
        "firearms",
        "Огнестрельное",
        ["PISTOL_SMALL", "PISTOL_LARGE", "PISTOL_SILENCED", "SMG", "RIFLE_ASSAULT", "HEAVY_MG", "VEHICLE_MG"],
      ],
      ["shotgun", "Дробовики", ["SHOTGUN"]],
      ["sniper", "Снайперские", ["RIFLE_SNIPER"]],
      ["melee", "Ближний бой", ["PUNCH_KICK", "MELEE_WOOD", "MELEE_METAL", "MELEE_SHARP", "MELEE_GENERIC"]],
      ["explosive", "Взрывное и огонь", ["ROCKET", "GRENADE", "MOLOTOV", "FIRE", "EXPLOSION"]],
      ["exotic", "Особое", ["RUBBER", "LASER", "STUNGUN", "CLOWN", "ALIEN", "SKELETON"]],
    ],
  ),
);

// Ключ поиска: ложное значение — пустая строка, остальное — обычным String (Map не знает прототипных имён).
const lookupKey = (value) => String(value || "");

const positionFinder = (names) => {
  const positions = new Map(names.map((name, index) => [name, index]));
  return (name) => positions.get(lookupKey(name));
};

const idFinder = (items) => {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (id) => byId.get(lookupKey(id)) ?? null;
};

export const bodyPartIndex = positionFinder(BLOOD_BODY_PARTS);
export const weaponClassIndex = positionFinder(BLOOD_WEAPON_CLASSES);

export const findBloodZone = idFinder(BLOOD_ZONES);
export const findBloodWeaponGroup = idFinder(BLOOD_WEAPON_GROUPS);
export const findBloodTable = idFinder(BLOODFX_TABLES);
export const findBloodRecordSection = idFinder(BLOODFX_RECORD_SECTIONS);

const zoneByPart = new Map();
BLOOD_ZONES.forEach((zone) => zone.parts.forEach((part) => zoneByPart.has(part) || zoneByPart.set(part, zone)));

export const zoneOfBodyPart = (part) => zoneByPart.get(lookupKey(part)) ?? null;
