/*
 * Голос каждого ствола мастерской: какие дорожки звучат, когда из него
 * стреляет игрок, и где они лежат в игре.
 *
 * ЗВУК — У КАЖДОГО СВОЙ. До 26.09.2026 свой звук ставился семье: стволам, у
 * которых в игре общие дорожки (штурмовая винтовка, булл-пап, улучшенная и
 * марксманская), — и звук «для АК» слышался у всех четырёх. Теперь ствол
 * получает свой голос переопределением в звуковом пакете Astral
 * (`weapon-voice-plan.js`): строка игрока его предмета звука ведёт на копию
 * настроек, а та — на копии ветвей и на личный банк; соседи по банку, NPC и
 * другие игроки звучат как прежде.
 *
 * ОТКУДА ГОЛОС. Таблица `weapon-voices.js` снята скриптом
 * `scripts/build-weapon-voices.mjs` с метаданных самой игры — базы и всех
 * пакетов в порядке dlclist.xml: действующие настройки игрока ствола, главный
 * корень (`AutoSound` у автомата, `FireSound` у полуавтомата), листья в банке
 * ствола и их стерео-пары. Строка дорожки — `[архив, банк, дорожка, канал,
 * роль, сэмплов, частота]`:
 *   • банк — путь внутри архива: `weapons.awc` в корне RESIDENT, у пакетов
 *     дополнений — вложенный (`x64/audio/sfx/dlc_mpsum2/…awc`);
 *   • канал — `left`/`right`/`mid` по панораме листа у игрока;
 *   • роль — `shot` (выстрел, первый выстрел очереди) или `tail` (хвост,
 *     который игра играет, когда очередь кончилась);
 *   • сэмплов — длина дорожки в игре: по ней студия режет свой звук так же,
 *     как его обрежет игра.
 */

import { WEAPON_VOICES } from "./weapon-voices.js";

export const WEAPON_SOUND_GROUPS = Object.freeze([
  Object.freeze({ id: "pistols", title: "Пистолеты" }),
  Object.freeze({ id: "smg", title: "Пистолеты-пулемёты" }),
  Object.freeze({ id: "rifles", title: "Винтовки" }),
  Object.freeze({ id: "shotguns", title: "Дробовики" }),
  Object.freeze({ id: "snipers", title: "Снайперские" }),
  Object.freeze({ id: "mg", title: "Пулемёты" }),
  Object.freeze({ id: "heavy", title: "Тяжёлое" }),
]);

export const WEAPON_SOUND_GROUP_MAP = Object.freeze(
  Object.fromEntries(WEAPON_SOUND_GROUPS.map((group) => [group.id, group])),
);

const bankName = (entry) =>
  String(entry)
    .split("/")
    .pop()
    .replace(/\.awc$/i, "")
    .toLowerCase();

/*
 * Ствол — то, что видно на полке мастерской: модель (`model` — id плитки
 * вкладки «Оружие»), темп и магазин из его weapons.meta, предмет звука
 * (`audio` — `AUDIO_ITEM_*` из weapons.meta, по нему скрипт таблицы находит
 * настройки).
 */
const RAW_WEAPONS = [
  { id: "WEAPON_HEAVYPISTOL", title: "Тяжёлый пистолет", group: "pistols", model: "heavy-pistol", auto: false, rpm: 143, clip: 18, audio: "AUDIO_ITEM_HEAVYPISTOL" },
  { id: "WEAPON_REVOLVER", title: "Револьвер", group: "pistols", model: "revolver", auto: false, rpm: 33, clip: 6, audio: "AUDIO_ITEM_REVOLVER" },
  { id: "WEAPON_STUNGUN", title: "Тазер", group: "pistols", model: "stun-gun", auto: false, rpm: 21, clip: 1, audio: "AUDIO_ITEM_STUNGUN" },
  { id: "WEAPON_CARBINERIFLE", title: "Карабинная винтовка", group: "rifles", model: "carbine-rifle", auto: true, rpm: 444, clip: 30, audio: "AUDIO_ITEM_CARBINERIFLE" },
  { id: "WEAPON_TACTICALRIFLE", title: "Служебный карабин", group: "rifles", model: "carabine_reh", auto: true, rpm: 444, clip: 30, audio: "audio_item_service_carbine" },
  { id: "WEAPON_CARBINERIFLE_MK2", title: "Карабинная винтовка MK2", group: "rifles", model: "carbine-rifle-mk2", auto: true, rpm: 444, clip: 30, audio: "AUDIO_ITEM_CARBINERIFLE_MK2" },
  { id: "WEAPON_ASSAULTRIFLE", title: "Штурмовая винтовка", group: "rifles", model: "assault-rifle", auto: true, rpm: 380, clip: 30, audio: "AUDIO_ITEM_ASSAULTRIFLE" },
  { id: "WEAPON_BULLPUPRIFLE", title: "Булл-пап винтовка", group: "rifles", model: "bullpup-rifle", auto: true, rpm: 500, clip: 30, audio: "AUDIO_ITEM_BULLPUPRIFLE" },
  { id: "WEAPON_SPECIALCARBINE", title: "Специальный карабин", group: "rifles", model: "special-carbine", auto: true, rpm: 444, clip: 30, audio: "AUDIO_ITEM_CARBINE_SPECIAL" },
  { id: "WEAPON_SPECIALCARBINE_MK2", title: "Специальный карабин MK2", group: "rifles", model: "special-carbine-mk2", auto: true, rpm: 444, clip: 30, audio: "AUDIO_ITEM_CARBINE_SPECIAL_MK2" },
  { id: "WEAPON_PUMPSHOTGUN", title: "Помповый дробовик", group: "shotguns", model: "pump-shotgun", auto: false, rpm: 75, clip: 8, audio: "AUDIO_ITEM_PUMPSHOTGUN" },
  { id: "WEAPON_ASSAULTSHOTGUN", title: "Штурмовой дробовик", group: "shotguns", model: "assault-shotgun", auto: false, rpm: 200, clip: 8, audio: "AUDIO_ITEM_ASSAULTSHOTGUN" },
  { id: "WEAPON_HEAVYSNIPER", title: "Тяжёлая снайперская винтовка", group: "snipers", model: "heavy-sniper", auto: false, rpm: 50, clip: 6, audio: "AUDIO_ITEM_HEAVYSNIPER" },
  { id: "WEAPON_HEAVYSNIPER_MK2", title: "Тяжёлая снайперская винтовка MK2", group: "snipers", model: "heavy-sniper-mk2", auto: false, rpm: 50, clip: 6, audio: "AUDIO_ITEM_HEAVYSNIPER_MK2" },
  { id: "WEAPON_MARKSMANRIFLE", title: "Марксманская винтовка", group: "snipers", model: "marksman-rifle", auto: true, rpm: 200, clip: 8, audio: "AUDIO_ITEM_DMRSNIPER" },
  { id: "WEAPON_ADVANCEDRIFLE", title: "Улучшенная винтовка", group: "rifles", model: "advanced-rifle", auto: true, rpm: 500, clip: 30, audio: "AUDIO_ITEM_ADVANCEDRIFLE" },
  { id: "WEAPON_COMBATMG", title: "Боевой пулемёт", group: "mg", model: "combat-mg", auto: true, rpm: 556, clip: 100, audio: "AUDIO_ITEM_COMBATMG" },
  { id: "WEAPON_COMBATPDW", title: "Боевой PDW", group: "smg", model: "combat-pdw", auto: true, rpm: 444, clip: 30, audio: "AUDIO_ITEM_COMBAT_PDW" },
  { id: "WEAPON_SMG_MK2", title: "ПП MK2", group: "smg", model: "smg-mk2", auto: true, rpm: 508, clip: 30, audio: "AUDIO_ITEM_SMG_MK2" },
  { id: "WEAPON_SMG", title: "Пистолет-пулемёт", group: "smg", model: "smg", auto: true, rpm: 508, clip: 30, audio: "AUDIO_ITEM_SMG" },
  { id: "WEAPON_MINISMG", title: "Мини ПП", group: "smg", model: "mini-smg", auto: true, rpm: 652, clip: 20, audio: "AUDIO_ITEM_MINISMG" },
  { id: "WEAPON_MICROSMG", title: "Микро ПП", group: "smg", model: "micro-smg", auto: true, rpm: 600, clip: 16, audio: "AUDIO_ITEM_MICROSMG" },
  { id: "WEAPON_ASSAULTSMG", title: "Штурмовой ПП", group: "smg", model: "assault-smg", auto: true, rpm: 462, clip: 30, audio: "AUDIO_ITEM_ASSAULTSMG" },
  { id: "WEAPON_HEAVYSHOTGUN", title: "Тяжёлый дробовик", group: "shotguns", model: "heavy-shotgun", auto: false, rpm: 200, clip: 6, audio: "AUDIO_ITEM_HEAVYSHOTGUN" },
  { id: "WEAPON_BULLPUPSHOTGUN", title: "Булл-пап дробовик", group: "shotguns", model: "bullpup-shotgun", auto: false, rpm: 60, clip: 14, audio: "AUDIO_ITEM_BULLPUPSHOTGUN" },
  { id: "WEAPON_DBSHOTGUN", title: "Двуствольный дробовик", group: "shotguns", model: "double-barrel-shotgun", auto: false, rpm: 600, clip: 2, audio: "AUDIO_ITEM_DB_SHOTGUN" },
  { id: "WEAPON_SAWNOFFSHOTGUN", title: "Обрез", group: "shotguns", model: "sawed-off-shotgun", auto: false, rpm: 60, clip: 8, audio: "AUDIO_ITEM_SAWNOFFSHOTGUN" },
  { id: "WEAPON_SNIPERRIFLE", title: "Снайперская винтовка", group: "snipers", model: "sniper-rifle", auto: false, rpm: 38, clip: 10, audio: "AUDIO_ITEM_SNIPERRIFLE" },
  { id: "WEAPON_MG", title: "Пулемёт", group: "mg", model: "mg", auto: true, rpm: 438, clip: 54, audio: "AUDIO_ITEM_MG" },
  { id: "WEAPON_GUSENBERG", title: "Автомат Гузенберга", group: "mg", model: "gusenberg-sweeper", auto: true, rpm: 556, clip: 30, audio: "AUDIO_ITEM_GUSENBERG" },
  { id: "WEAPON_GRENADELAUNCHER", title: "Гранатомёт", group: "heavy", model: "grenade-launcher", auto: false, rpm: 49, clip: 10, audio: "AUDIO_ITEM_GRENADELAUNCHER" },
];

/** Что нужно скрипту таблицы: ствол, его предмет звука, автомат ли он. */
export const WEAPON_SOUND_TARGETS = Object.freeze(
  RAW_WEAPONS.map(({ id, audio, auto }) => Object.freeze({ id, audio, auto })),
);

/* Архивы, где живёт голос стволов: общие звуковые и пакеты дополнений. */
export const WEAPON_SOUND_ARCHIVES = Object.freeze(
  [
    ...new Set(
      Object.values(WEAPON_VOICES).flatMap((waves) =>
        waves.map(([archive]) => archive),
      ),
    ),
  ].sort(),
);

function voiceOf(id) {
  const waves = WEAPON_VOICES[id];
  if (!waves) return Object.freeze([]);
  return Object.freeze(
    waves.map(([archive, entry, stream, channel, role, samples, sampleRate]) =>
      Object.freeze({
        archive,
        entry,
        bank: bankName(entry),
        stream,
        channel,
        role,
        npc: false,
        samples,
        sampleRate,
      }),
    ),
  );
}

export const WEAPON_SOUNDS = Object.freeze(
  RAW_WEAPONS.map((meta) => Object.freeze({ ...meta, voice: voiceOf(meta.id) })),
);

export const WEAPON_SOUND_MAP = Object.freeze(
  Object.fromEntries(WEAPON_SOUNDS.map((item) => [item.id, item])),
);

/** Ствол по умолчанию — тот, что в предпросмотре: карабин. */
export const DEFAULT_WEAPON_SOUND = "WEAPON_CARBINERIFLE";

/** Есть ли у ствола свой голос — то, что студия может заменить. */
export const weaponHasVoice = (item) => Boolean(item?.voice?.length);

/** Стволы по группам в порядке полки. */
export function weaponSoundsByGroup() {
  return WEAPON_SOUND_GROUPS.map((group) => ({
    ...group,
    weapons: WEAPON_SOUNDS.filter((item) => item.group === group.id),
  })).filter((group) => group.weapons.length);
}

/** Голос по банкам: `архив|путь банка` → дорожки. */
export function weaponVoiceByBank(item) {
  const banks = new Map();
  for (const wave of item?.voice || []) {
    const key = `${wave.archive}|${wave.entry}`;
    if (!banks.has(key))
      banks.set(key, {
        archive: wave.archive,
        entry: wave.entry,
        bank: wave.bank,
        waves: [],
      });
    banks.get(key).waves.push(wave);
  }
  return [...banks.values()];
}

const VOICE_BANKS = new Map(
  WEAPON_SOUNDS.flatMap((item) =>
    item.voice.map((wave) => [`${wave.archive}|${wave.bank}`, wave]),
  ),
);

/**
 * Банк голоса по архиву и имени: `{archive, entry, bank}` или `null`. У
 * банков пакетов дополнений путь вложенный (`x64/audio/sfx/dlc_mpsum2/…`), и
 * по одному имени банка его не восстановить — главный процесс берёт путь
 * отсюда, а не из окна.
 */
export function weaponVoiceBank(archive, bank) {
  const place = VOICE_BANKS.get(
    `${String(archive || "")}|${String(bank || "").toLowerCase()}`,
  );
  return place
    ? { archive: place.archive, entry: place.entry, bank: place.bank }
    : null;
}

/*
 * Способ, которым главный процесс ставит свой звук ствола (формат его
 * пакета): 5 — в выстреле только свой звук (26.09.2026, вечер); 6 — свой звук
 * во всех полях выстрела, с глушителем и в замедленной съёмке (27.09.2026);
 * 7 — свой звук вместо поля берёт флаги поведения у донора того же вида
 * (27.09.2026: одиночный выстрел карабина формы 6 был мультитреком без них,
 * как слои удара, ронявшие игру — `sound-header.js`).
 * Главный процесс называет свой способ в ответе установки, окно пишет его в
 * запись: окно обновляется на лету, а главный процесс — только с
 * перезапуском приложения, и запись должна говорить, как звук поставлен на
 * самом деле.
 */
export const WEAPON_SOUND_FORMAT = 7;

/*
 * Отпечаток голоса: какие дорожки поёт свой звук ствола и каким способом он
 * ставится. Пишется в запись установки — сменилась таблица (другая сборка
 * игры) или способ, и поставленный по-старому звук честно становится «ждёт
 * применения», а не «в игре». Способы: v3 — переопределение одного ствола
 * вместо семьи; v4 (26.09.2026, вечер) — в выстреле звучит только свой
 * звук, без слоёв, отзвука и эха игры; v5 (27.09.2026) — свой звук и с
 * глушителем, и в замедленной съёмке: во всех полях выстрела.
 */
export function weaponVoiceKey(item) {
  const places = (item?.voice || [])
    .map((wave) => `${wave.archive}|${wave.entry}|${wave.stream}`)
    .sort()
    .join(";");
  let hash = 0x811c9dc5;
  for (let index = 0; index < places.length; index += 1) {
    hash ^= places.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return places ? `v5:${hash.toString(16).padStart(8, "0")}` : "";
}

/*
 * Длина выстрела и хвоста в игре. По ним стрельбище режет свой звук так же,
 * как его обрежет игра: у карабина выстрел очереди — 0,14 с, остальное
 * доигрывает хвост в конце очереди.
 *
 * Выстрел — медиана дорожек выстрела, а не самая длинная: у карабина среди
 * дорожек по 0,14 с есть и длинные (первый выстрел со своим хвостом), и по
 * самой длинной очередь звучала бы кашей из хвостов, которой в игре нет.
 * Хвост — самая длинная дорожка хвоста.
 */
export function weaponVoiceSeconds(item, role) {
  const waves = (item?.voice || []).filter(
    (wave) => wave.role === role && wave.sampleRate,
  );
  const lengths = waves
    .map((wave) => wave.samples / wave.sampleRate)
    .sort((left, right) => left - right);
  if (!lengths.length) return 0;
  return role === "tail"
    ? lengths.at(-1)
    : lengths[Math.floor((lengths.length - 1) / 2)];
}

/** Секунд между выстрелами — из `TimeBetweenShots` ствола. */
export const weaponShotInterval = (item) => (item?.rpm ? 60 / item.rpm : 0.25);

/** Имя ствола в пакете и в слоте: `WEAPON_CARBINERIFLE_MK2` → `carbinerifle-mk2`. */
export const weaponSlug = (id) =>
  String(id || "")
    .toLowerCase()
    .replace(/^weapon_/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48);
