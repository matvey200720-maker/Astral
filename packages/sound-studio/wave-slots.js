/*
 * Сколько звукового банка игра готова принять.
 *
 * Банк AWC не читается с диска по кусочку, как музыка: игра загружает его в
 * заранее выделенный слот памяти (объекты WaveSlot в
 * `update.rpf/x64/audio/config/audioconfig.dat4.rel`). У слота не один предел,
 * а три, и каждый — отдельный буфер:
 *
 *   • `bytes` — сам банк до конца данных (без хвостового выравнивания под
 *     шифрование: у collisions.awc файл на 2 байта длиннее своего слота);
 *   • `header` — таблица дорожек: 16 байт шапки, по 2 на индекс, по 4 на
 *     дорожку и по 8 на чанк (MaxHeaderSize);
 *   • `metadata` — служебные чанки: формат каждой дорожки (24 байта), пики
 *     (по 2 байта на каждые 4096 сэмплов после первых 4096), метки
 *     (MaxMetadataSize).
 *
 * Банк больше слота — вне того, на что рассчитана игра: слот — это буферы
 * ровно таких размеров, и студия держит банк в них, как держит свой игра.
 * Чем кончается превышение, по игре не видно: 27.09.2026 лишние 4 байта пиков
 * звука головы в банке collision сочли было причиной краша при попадании —
 * нет, сборка 26.09 выходила за слот так же и не падала, а роняли игру слои
 * удара без флагов поведения (`sound-header.js`).
 *
 * У всех 15 постоянных банков RESIDENT служебные чанки ровно равны пределу
 * своего слота, а данные — его размеру (сверено на живой Legacy 27.09.2026):
 * запаса там нет ни байта. Банки ствола игрока грузятся в общие слоты
 * PLAYER_WEAPON_0…2 — предел по самому большому из них (smg_micro: 536 байт
 * служебных чанков). Боль и двигатели — свои общие слоты. Музыка и радио
 * читаются потоком, и слота у них нет.
 */

const RESIDENT = "x64/audio/sfx/RESIDENT.rpf";

const slot = (name, bytes, header, metadata) =>
  Object.freeze({ name, bytes, header, metadata });

/* Слоты audioconfig.dat4.rel Legacy, которые принимают банки студии. */
export const WAVE_SLOTS = Object.freeze({
  PLAYER_WEAPON: slot("PLAYER_WEAPON", 383_588, 2048, 536),
  PAIN: slot("PAIN", 976_504, 2048, 1234),
  STREAM_ENGINE: slot("STREAM_ENGINE", 1_372_078, 2048, 8166),
  STREAM_ENGINE_GRANULAR_HI: slot("STREAM_ENGINE_GRANULAR_HI", 4_418_424, 2048, 24_544),
  STREAM_ENGINE_LOW_LATENCY: slot("STREAM_ENGINE_LOW_LATENCY", 154_322, 2048, 656),
  AMBIENCE: slot("AMBIENCE", 4_503_900, 4096, 3330),
  COLLISION: slot("COLLISION", 17_635_320, 20_480, 21_388),
  MOVEMENT: slot("MOVEMENT", 2_616_864, 4096, 3380),
  STATIC_ANIMAL_FOOTSTEPS: slot("STATIC_ANIMAL_FOOTSTEPS", 1_365_200, 2048, 1612),
  STATIC_COLLISIONS: slot("STATIC_COLLISIONS", 9_001_842, 8192, 7308),
  STATIC_DOORS: slot("STATIC_DOORS", 1_143_248, 2048, 1558),
  STATIC_EXPLOSIONS: slot("STATIC_EXPLOSIONS", 19_805_814, 6144, 8288),
  STATIC_FEET: slot("STATIC_FEET", 1_159_136, 2048, 1388),
  STATIC_FEET_MATERIALS: slot("STATIC_FEET_MATERIALS", 7_251_360, 14_336, 13_004),
  STATIC_FRONTEND: slot("STATIC_FRONTEND", 6_060_128, 4096, 3614),
  STATIC_MELEE: slot("STATIC_MELEE", 1_784_682, 4096, 2560),
  STATIC_PLAYER_SWITCH: slot("STATIC_PLAYER_SWITCH", 371_636, 2048, 216),
  STATIC_VEHICLES: slot("STATIC_VEHICLES", 16_519_400, 14_336, 15_916),
  STATIC_WEAPONS: slot("STATIC_WEAPONS", 19_466_072, 14_336, 15_876),
  WEATHER: slot("WEATHER", 4_079_904, 2048, 2532),
});

/* Архив → общий слот, в который игра грузит любой его банк. Личные банки
   стволов Astral грузятся по BankSound в слот оружия игрока. */
const SHARED_SLOTS = Object.freeze({
  "x64/audio/sfx/WEAPONS_PLAYER.rpf": WAVE_SLOTS.PLAYER_WEAPON,
  "update/x64/dlcpacks/astral_audio/dlc.rpf": WAVE_SLOTS.PLAYER_WEAPON,
  "x64/audio/sfx/PAIN.rpf": WAVE_SLOTS.PAIN,
  "x64/audio/sfx/STREAMED_VEHICLES.rpf": WAVE_SLOTS.STREAM_ENGINE,
  "x64/audio/sfx/STREAMED_VEHICLES_GRANULAR.rpf": WAVE_SLOTS.STREAM_ENGINE_GRANULAR_HI,
  "x64/audio/sfx/STREAMED_VEHICLES_LOW_LATENCY.rpf": WAVE_SLOTS.STREAM_ENGINE_LOW_LATENCY,
});

/* Постоянные банки RESIDENT → свой слот (StaticBank слота — этот банк). */
const RESIDENT_SLOTS = Object.freeze({
  "ambience.awc": WAVE_SLOTS.AMBIENCE,
  "animals_footsteps.awc": WAVE_SLOTS.STATIC_ANIMAL_FOOTSTEPS,
  "collision.awc": WAVE_SLOTS.COLLISION,
  "collisions.awc": WAVE_SLOTS.STATIC_COLLISIONS,
  "doors.awc": WAVE_SLOTS.STATIC_DOORS,
  "explosions.awc": WAVE_SLOTS.STATIC_EXPLOSIONS,
  "feet_materials.awc": WAVE_SLOTS.STATIC_FEET_MATERIALS,
  "feet_resident.awc": WAVE_SLOTS.STATIC_FEET,
  "frontend.awc": WAVE_SLOTS.STATIC_FRONTEND,
  "melee.awc": WAVE_SLOTS.STATIC_MELEE,
  "movement.awc": WAVE_SLOTS.MOVEMENT,
  "player_switch.awc": WAVE_SLOTS.STATIC_PLAYER_SWITCH,
  "vehicles.awc": WAVE_SLOTS.STATIC_VEHICLES,
  "weapons.awc": WAVE_SLOTS.STATIC_WEAPONS,
  "weather.awc": WAVE_SLOTS.WEATHER,
});

/* Архивы, банки которых игра держит слотами ровно по размеру; чей это слот —
   не сверено, поэтому предел — сам банк игры. */
const NO_GROWTH = new Set([
  RESIDENT,
  "x64/audio/sfx/STREAMED_VEHICLES_GRANULAR_NPC.rpf",
  "x64/audio/sfx/STREAMED_AMBIENCE.rpf",
  "x64/audio/sfx/ONESHOT_AMBIENCE.rpf",
]);

/*
 * Пакеты дополнений Rockstar (`update/x64/dlcpacks/<пакет>/dlc.rpf`): банки
 * стволов из них — револьвер, служебный карабин, двустволка — объявляют свои
 * слоты в метаданных пакета, и запаса в них никто не мерил. Правило то же,
 * что у постоянных банков: собранный банк не больше исходного.
 */
const DLC_ARCHIVE = /^update\/x64\/dlcpacks\/[a-z0-9_]+\/dlc\.rpf$/i;

const normalizeArchive = (archive) => String(archive || "").split("\\").join("/");
const entryName = (entry) =>
  String(entry || "").split("\\").join("/").split("/").pop().toLowerCase();

/** Слот, в который игра грузит этот банк, или `null`, если он не сверен. */
export function waveSlotOf(archive, entry) {
  const key = normalizeArchive(archive);
  if (SHARED_SLOTS[key]) return SHARED_SLOTS[key];
  if (key === RESIDENT) return RESIDENT_SLOTS[entryName(entry)] || null;
  return null;
}

/**
 * Пределы собранного банка или `null` — у банка нет слота (музыка, песня
 * станции читаются потоком целиком).
 *
 * `base` — опись банка игры до правки (`headerBytes`, `metadataBytes`,
 * `contentBytes` из awc-inspect): у банков, чей слот не сверен, предел — он
 * сам.
 *
 * @returns {{slot: string, bytes: number, header: number, metadata: number} | null}
 */
export function waveSlotBudget(archive, entry, base = {}, { completeBank = false } = {}) {
  if (completeBank) return null;
  const known = waveSlotOf(archive, entry);
  if (known)
    return {
      slot: known.name,
      bytes: known.bytes,
      header: known.header,
      metadata: known.metadata,
    };
  const key = normalizeArchive(archive);
  if (!NO_GROWTH.has(key) && !DLC_ARCHIVE.test(key)) return null;
  const own = [base?.contentBytes, base?.headerBytes, base?.metadataBytes].map(Number);
  if (own.some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error(
      `У банка ${entryName(entry)} нет описи таблицы и служебных чанков — предел его слота не посчитать.`,
    );
  return {
    slot: `по штатному ${entryName(entry)}`,
    bytes: own[0],
    header: own[1],
    metadata: own[2],
  };
}

/** Размер общего слота архива (ствол игрока, боль), байт; 0 — слот не общий. */
export const waveSlotBytes = (archive) => SHARED_SLOTS[normalizeArchive(archive)]?.bytes || 0;

/*
 * Служебные чанки дорожки, как их пишет банк игры и CodeWalker: формат —
 * 24 байта, пики — по 2 байта на каждые полные 4096 сэмплов после первых
 * 4096 (дорожка короче 8192 сэмплов пиков не несёт).
 */
export const AWC_FORMAT_CHUNK_BYTES = 24;

/** Байт пиков у дорожки из `samples` сэмплов. */
export const awcPeakBytes = (samples) =>
  Number(samples) >= 8192 ? 2 * Math.floor((Number(samples) - 4096) / 4096) : 0;
