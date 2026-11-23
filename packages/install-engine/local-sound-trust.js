/*
 * Доверие локальному звуковому слою.
 *
 * Запись в корень игры требует подписи — и это правильно: неподписанный
 * пакет, который трогает `x64/audio/sfx`, обязан быть отвергнут. Студия звука
 * собирает слой на этой же машине, подписывать его нечем и незачем, поэтому
 * для неё действует то же исключение, что у pinned loader и Davis Mega Mall:
 * внутренний траст, выдаваемый только пакету СТРОГО известной формы. Любое
 * отклонение от формы — и пакет снова обычный неподписанный чужак.
 *
 * Форм две. Дорожки: слой из 1–24 потоков одноканального банка — в RESIDENT
 * (только объявленные банки), WEAPONS_PLAYER и архивах окружения. Банк
 * целиком: многоканальный потоковый банк музыки (PROLOGUE/STREAMS — ровно
 * два объявленных банка), песня музыкальной станции или банк окружения, с
 * потоком-источником и каналами. Таблица повторяет SOUND_ARCHIVES из
 * packages/sound-studio — и намеренно не импортирует её: траст обязан быть
 * самодостаточным.
 */

export const LOCAL_SOUND_LAYER_TRUST = Symbol("local-sound-layer-trust");

const RESIDENT = "x64/audio/sfx/RESIDENT.rpf";
/*
 * Все шестнадцать банков корня RESIDENT.rpf — состав снят с живого архива.
 * Список повторяет `RESIDENT_BANKS` студии звука и обязан с ним совпадать:
 * банк, который студия предлагает, а траст не признаёт, — это редактор,
 * который даёт собрать замену и отвергает её на установке. Совпадение
 * сторожит tests/sound-studio.test.js; сюда таблица скопирована нарочно —
 * траст обязан быть самодостаточным и не зависеть от пакета редактора.
 */
const RESIDENT_BANKS = new Set([
  "ambience",
  "animals_footsteps",
  "collision",
  "collisions",
  "doors",
  "explosions",
  "feet_materials",
  "feet_resident",
  "frontend",
  "low_latency",
  "melee",
  "movement",
  "player_switch",
  "vehicles",
  "weapons",
  "weather",
]);

/*
 * Архивы, где студия меняет отдельные дорожки. Совпадение с таблицей
 * `SOUND_ARCHIVES` студии сторожит tests/sound-studio.test.js: архив, который
 * редактор предлагает, а траст не признаёт, — это собранная замена, которую
 * установка отвергнет.
 */
const STREAM_ARCHIVES = new Set([
  RESIDENT,
  "x64/audio/sfx/WEAPONS_PLAYER.rpf",
  "x64/audio/sfx/STREAMED_AMBIENCE.rpf",
  "x64/audio/sfx/ONESHOT_AMBIENCE.rpf",
  "x64/audio/sfx/PAIN.rpf",
  "x64/audio/sfx/STREAMED_VEHICLES.rpf",
  "x64/audio/sfx/STREAMED_VEHICLES_GRANULAR.rpf",
  "x64/audio/sfx/STREAMED_VEHICLES_GRANULAR_NPC.rpf",
  "x64/audio/sfx/STREAMED_VEHICLES_LOW_LATENCY.rpf",
]);

const AMBIENCE_ARCHIVES = new Set([
  "x64/audio/sfx/STREAMED_AMBIENCE.rpf",
  "x64/audio/sfx/ONESHOT_AMBIENCE.rpf",
]);

const MUSIC_BANKS = new Map([
  ["x64/audio/sfx/PROLOGUE.rpf", new Set(["td_loading_music"])],
  ["x64/audio/sfx/STREAMS.rpf", new Set(["menu_music"])],
]);

const RADIO_ARCHIVE =
  /^x64\/audio\/sfx\/RADIO_(01_CLASS_ROCK|02_POP|03_HIPHOP_NEW|04_PUNK|06_COUNTRY|07_DANCE_01|08_MEXICAN|09_HIPHOP_OLD|12_REGGAE|13_JAZZ|14_DANCE_02|15_MOTOWN|16_SILVERLAKE|17_FUNK|18_90S_ROCK)\.rpf$/;

const STREAM_ID = /^0X[0-9A-F]{8}$/;
const BANK_NAME = /^[a-z0-9][a-z0-9._-]{0,118}$/;

const slug = (bank) => bank.replace(/[^a-z0-9]+/g, "-");

function commonShape(manifest, edition, file, bank) {
  const digest = /^local-sound-[a-z0-9-]+-([a-f0-9]{12})$/.exec(
    String(manifest?.id || ""),
  );
  return Boolean(
    String(edition || "").toLowerCase() === "legacy" &&
    digest &&
    manifest?.scope === "game-root" &&
    manifest?.adapter === "rpf-entry" &&
    manifest?.requiresLoader === false &&
    manifest?.gameplayChanges === false &&
    JSON.stringify(manifest?.capabilities) ===
      JSON.stringify(["awc-stream-layer-v1"]) &&
    JSON.stringify(manifest?.editions) === JSON.stringify(["Legacy"]) &&
    Array.isArray(manifest?.files) &&
    manifest.files.length === 1 &&
    BANK_NAME.test(bank) &&
    file?.entry === `${bank}.awc` &&
    file?.source === `payload/${bank}.awc` &&
    file?.action === "replace" &&
    file?.merge?.strategy === "awc-stream-layer-v1" &&
    Number.isInteger(file?.size) &&
    file.size > 0 &&
    /^[a-f0-9]{64}$/.test(file?.sha256 || ""),
  );
}

export function isLocalSoundLayerManifest(manifest, edition) {
  const file = manifest?.files?.[0];
  const merge = file?.merge;
  const bank = String(merge?.bank || "");
  const target = String(file?.target || "");
  const streams = Array.isArray(merge?.streams) ? merge.streams : [];
  if (!commonShape(manifest, edition, file, bank)) return false;
  /* Убирать дорожки из банка может только звук попадания. */
  if (merge?.drop !== undefined) return false;
  const uniqueIds =
    streams.every((stream) => STREAM_ID.test(String(stream))) &&
    new Set(streams).size === streams.length;
  if (!uniqueIds) return false;
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : null;
  if (!slots) return false;
  if (target === RESIDENT && !RESIDENT_BANKS.has(bank)) return false;

  if (merge.completeBank === true) {
    const music = MUSIC_BANKS.get(target);
    const allowedTarget = music
      ? music.has(bank)
      : RADIO_ARCHIVE.test(target) || AMBIENCE_ARCHIVES.has(target);
    return Boolean(
      allowedTarget &&
      streams.length >= 2 &&
      streams.length <= 17 &&
      streams.includes("0X00000000") &&
      slots.length === 1 &&
      slots[0] === `sound-bank-${slug(bank)}` &&
      file.size <= 96 * 1024 * 1024,
    );
  }

  return Boolean(
    STREAM_ARCHIVES.has(target) &&
    merge.completeBank === undefined &&
    streams.length >= 1 &&
    streams.length <= 24 &&
    slots.length === streams.length &&
    slots.every(
      (slot, index) =>
        slot === `sound-${slug(bank)}-${String(streams[index]).toLowerCase()}`,
    ) &&
    file.size <= 64 * 1024 * 1024,
  );
}

/*
 * Звук попадания — третья форма, и она пишет в два места.
 *
 * Звук головы и тела нельзя поставить одной заменой дорожки: их слои собраны
 * из волн, которые звучат ещё и в драке, и при падении тела. Поэтому пакет
 * несёт две вещи: слой дорожек банка `collision` (звук человека и тишина на
 * месте освобождённых дорожек) и дерево звуков, которое переводит голову и
 * тело на эти дорожки. Форма здесь описана дословно, и любое отклонение от
 * неё снова делает пакет чужаком.
 *
 * Дерево бывает двух видов. До 26.09.2026 (вечер) — правка ссылок в
 * `update.rpf/x64/audio/config/sounds.dat54.rel`: она не умеет ни громкость,
 * ни дальность, и звук человека тонул в штатном ударе. Теперь — слой
 * метаданных звукового пакета Astral (`astral_audio_sounds.dat54.rel`), где
 * удар по голове и телу переопределён целиком. Прежний вид остаётся
 * доверенным: поставленное так снимается и заменяется новым.
 */
const HIT_SOUND_ID = /^local-sound-hits-([a-f0-9]{12})$/;
const HIT_SOUND_PATCH_CAPABILITIES = JSON.stringify([
  "awc-stream-layer-v1",
  "audio-rel-patch-v1",
  "direct-update-entries-v1",
]);
const HIT_SOUND_PACK_CAPABILITIES = JSON.stringify([
  "awc-stream-layer-v1",
  "astral-audio-chunk-v1",
  "direct-audio-dlc-v1",
]);
const AUDIO_PACK_TARGET = "update/x64/dlcpacks/astral_audio/dlc.rpf";

/*
 * Слой дорожек банка collision: звук человека и тишина освобождённых. С
 * 27.09.2026 слой ещё и убирает несколько мёртвых дорожек банка (`drop`):
 * служебная память слота COLLISION занята штатным банком до байта, и пикам
 * длинного звука человека место есть только на их месте.
 */
function hitLayerOk(layer) {
  const streams = Array.isArray(layer?.merge?.streams) ? layer.merge.streams : [];
  const drop = layer?.merge?.drop === undefined ? [] : layer.merge.drop;
  return Boolean(
    layer?.target === RESIDENT &&
    layer?.entry === "collision.awc" &&
    layer?.source === "payload/collision.awc" &&
    layer?.action === "replace" &&
    layer?.merge?.strategy === "awc-stream-layer-v1" &&
    layer?.merge?.bank === "collision" &&
    layer?.merge?.completeBank === undefined &&
    streams.length >= 1 &&
    streams.length <= 24 &&
    streams.every((stream) => STREAM_ID.test(String(stream))) &&
    new Set(streams).size === streams.length &&
    Array.isArray(drop) &&
    drop.length <= 16 &&
    drop.every((stream) => STREAM_ID.test(String(stream)) && !streams.includes(stream)) &&
    new Set(drop).size === drop.length &&
    Number.isInteger(layer?.size) &&
    layer.size > 0 &&
    layer.size <= 64 * 1024 * 1024 &&
    /^[a-f0-9]{64}$/.test(layer?.sha256 || ""),
  );
}

/* Дерево звуков: правка ссылок update.rpf (прежний вид) или слой пакета. */
function hitRoutingOk(routing, capabilities) {
  const sized = (limit) =>
    Number.isInteger(routing?.size) &&
    routing.size > 0 &&
    routing.size <= limit &&
    /^[a-f0-9]{64}$/.test(routing?.sha256 || "");
  if (capabilities === HIT_SOUND_PATCH_CAPABILITIES)
    return Boolean(
      routing?.target === "update/update.rpf" &&
      routing?.entry === "x64/audio/config/sounds.dat54.rel" &&
      routing?.source === "payload/sounds.dat54.patch.json" &&
      routing?.action === "replace" &&
      routing?.merge?.strategy === "audio-rel-patch-v1" &&
      Object.keys(routing.merge).length === 1 &&
      sized(64 * 1024),
    );
  return Boolean(
    capabilities === HIT_SOUND_PACK_CAPABILITIES &&
    routing?.target === AUDIO_PACK_TARGET &&
    routing?.entry === "x64/audio/astral_audio_sounds.dat54.rel" &&
    routing?.source === "payload/astral_audio_sounds.json" &&
    routing?.action === "replace" &&
    routing?.merge?.strategy === "astral-audio-chunk-v1" &&
    Object.keys(routing.merge).length === 1 &&
    sized(64 * 1024),
  );
}

export function isLocalHitSoundManifest(manifest, edition) {
  const [layer, routing] = Array.isArray(manifest?.files)
    ? manifest.files
    : [];
  const capabilities = JSON.stringify(manifest?.capabilities);
  return Boolean(
    String(edition || "").toLowerCase() === "legacy" &&
    HIT_SOUND_ID.test(String(manifest?.id || "")) &&
    manifest?.scope === "game-root" &&
    manifest?.adapter === "rpf-entry" &&
    manifest?.requiresLoader === false &&
    manifest?.gameplayChanges === false &&
    JSON.stringify(manifest?.editions) === JSON.stringify(["Legacy"]) &&
    JSON.stringify(manifest?.slots) === JSON.stringify(["sound-hits"]) &&
    manifest.files.length === 2 &&
    hitLayerOk(layer) &&
    hitRoutingOk(routing, capabilities),
  );
}

/*
 * «Окружение» студии звуков (ТЗ 17.10.2026, задача 5) — шестая форма:
 * громкость категорий звука игры. Пакет несёт один JSON сдвигов громкости
 * категорий; файл `categories.dat22.rel` установщик собирает из файла
 * игрока (`audio-rel-patch-v1`, сборщик `audio-rel-composer.js`): только
 * поля громкости, ни байта больше. Слот один — новое окружение сменяет
 * прежнее.
 */
const SOUND_MIX_ID = /^local-sound-mix-[a-f0-9]{12}$/;
const SOUND_MIX_CAPABILITIES = JSON.stringify([
  "audio-rel-patch-v1",
  "direct-update-entries-v1",
]);

export function isLocalSoundMixManifest(manifest, edition) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const [patch] = files;
  return Boolean(
    String(edition || "").toLowerCase() === "legacy" &&
    SOUND_MIX_ID.test(String(manifest?.id || "")) &&
    manifest?.scope === "game-root" &&
    manifest?.adapter === "rpf-entry" &&
    manifest?.requiresLoader === false &&
    manifest?.gameplayChanges === false &&
    JSON.stringify(manifest?.capabilities) === SOUND_MIX_CAPABILITIES &&
    JSON.stringify(manifest?.editions) === JSON.stringify(["Legacy"]) &&
    JSON.stringify(manifest?.slots) === JSON.stringify(["sound-mix"]) &&
    files.length === 1 &&
    patch?.target === "update/update.rpf" &&
    patch?.entry === "x64/audio/config/categories.dat22.rel" &&
    patch?.source === "payload/categories.dat22.patch.json" &&
    patch?.action === "replace" &&
    patch?.merge?.strategy === "audio-rel-patch-v1" &&
    Object.keys(patch.merge).length === 1 &&
    Number.isInteger(patch?.size) &&
    patch.size > 0 &&
    patch.size <= 64 * 1024 &&
    /^[a-f0-9]{64}$/.test(patch?.sha256 || ""),
  );
}

/** Любая из форм, которые студия звука собирает на этой машине. */
export const isLocalSoundManifest = (manifest, edition) =>
  isLocalSoundLayerManifest(manifest, edition) ||
  isLocalHitSoundManifest(manifest, edition) ||
  isLocalWeaponSoundManifest(manifest, edition) ||
  isLocalWeaponVoiceManifest(manifest, edition) ||
  isLocalWeaponMuteManifest(manifest, edition) ||
  isLocalSoundMixManifest(manifest, edition);

/*
 * Свой звук одного ствола — пятая форма: переопределение в звуковом пакете
 * Astral (`audio-dlc.js` движка). Пакет пишет только в свой архив
 * `update/x64/dlcpacks/astral_audio/dlc.rpf`: переопределённый предмет
 * звука ствола, копию его настроек игрока и копии ветвей (JSON, файл
 * метаданных собирает установщик из всех стволов) и личный банк ствола. Файлы игры не трогаются; регистрация пакета
 * в dlclist.xml — дело движка, а не пакета.
 */
const WEAPON_VOICE_TARGET = AUDIO_PACK_TARGET;
const WEAPON_VOICE_CAPABILITIES = JSON.stringify([
  "astral-audio-chunk-v1",
  "direct-audio-dlc-v1",
]);
const WEAPON_VOICE_CHUNKS = Object.freeze([
  ["payload/astral_audio_game.json", "x64/audio/astral_audio_game.dat151.rel"],
  ["payload/astral_audio_sounds.json", "x64/audio/astral_audio_sounds.dat54.rel"],
]);
const WEAPON_VOICE_BANK_BYTES = 1024 * 1024;

/* Файл метаданных звукового пакета Astral: JSON-слой, который установщик сливает в файл пакета. */
const chunkOk = (file, [source, entry]) =>
  file?.target === WEAPON_VOICE_TARGET &&
  file?.source === source &&
  file?.entry === entry &&
  file?.action === "replace" &&
  file?.merge?.strategy === "astral-audio-chunk-v1" &&
  Object.keys(file.merge).length === 1 &&
  Number.isInteger(file?.size) &&
  file.size > 0 &&
  file.size <= 512 * 1024 &&
  /^[a-f0-9]{64}$/.test(file?.sha256 || "");

export function isLocalWeaponVoiceManifest(manifest, edition) {
  const id = WEAPON_SOUND_ID.exec(String(manifest?.id || ""));
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (!id || files.length !== 3) return false;
  const bank = id[1].replace(/-/g, "_");
  const [game, sounds, wave] = files;
  return Boolean(
    String(edition || "").toLowerCase() === "legacy" &&
    manifest?.scope === "game-root" &&
    manifest?.adapter === "rpf-entry" &&
    manifest?.requiresLoader === false &&
    manifest?.gameplayChanges === false &&
    JSON.stringify(manifest?.capabilities) === WEAPON_VOICE_CAPABILITIES &&
    JSON.stringify(manifest?.editions) === JSON.stringify(["Legacy"]) &&
    JSON.stringify(manifest?.slots) ===
      JSON.stringify([`sound-weapon-${id[1]}`]) &&
    chunkOk(game, WEAPON_VOICE_CHUNKS[0]) &&
    chunkOk(sounds, WEAPON_VOICE_CHUNKS[1]) &&
    /^[a-z0-9][a-z0-9_]{0,47}$/.test(bank) &&
    wave?.target === WEAPON_VOICE_TARGET &&
    wave?.source === `payload/${bank}.awc` &&
    wave?.entry === `x64/audio/sfx/dlc_astral_audio/${bank}.awc` &&
    wave?.action === "import" &&
    wave?.merge === undefined &&
    Number.isInteger(wave?.size) &&
    wave.size > 16 &&
    wave.size <= WEAPON_VOICE_BANK_BYTES &&
    /^[a-f0-9]{64}$/.test(wave?.sha256 || ""),
  );
}

/*
 * Ствол без своих выстрелов (30.10.2026) — шестая форма: тишина на выстреле игрока. Пакет — один файл: слой звуковых метаданных пакета Astral с двумя объектами (копия настроек игрока,
 * где поля выстрела ведут на `null_sound`, и предмет звука, где строка игрока ведёт на копию). Ни банка, ни деревьев, ни файлов игры: `BankSound` остаётся банком игры, общие банки не
 * трогаются. Слот тот же, что у своего звука ствола, — выбор один: звук или тишина, новый заменяет прежний.
 */
export function isLocalWeaponMuteManifest(manifest, edition) {
  const id = WEAPON_SOUND_ID.exec(String(manifest?.id || ""));
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (!id || files.length !== 1) return false;
  return Boolean(
    String(edition || "").toLowerCase() === "legacy" &&
    manifest?.scope === "game-root" &&
    manifest?.adapter === "rpf-entry" &&
    manifest?.requiresLoader === false &&
    manifest?.gameplayChanges === false &&
    JSON.stringify(manifest?.capabilities) === WEAPON_VOICE_CAPABILITIES &&
    JSON.stringify(manifest?.editions) === JSON.stringify(["Legacy"]) &&
    JSON.stringify(manifest?.slots) === JSON.stringify([`sound-weapon-${id[1]}`]) &&
    chunkOk(files[0], WEAPON_VOICE_CHUNKS[0]),
  );
}

/*
 * Свой звук ствола — четвёртая форма: один мод на семью стволов с общим
 * голосом (карабин и карабин MK2 стреляют одними дорожками), а в нём слои
 * всех банков, где этот голос звучит. Стерео выстрела игра собирает из двух
 * моно-дорожек в разных архивах (левая часто в WEAPONS_PLAYER, правая — в
 * RESIDENT), и слой только одного из них оставлял бы в другом канале
 * оригинал. Поэтому банки ставятся и снимаются вместе, одной транзакцией.
 *
 * Слот один на семью (`sound-weapon-<основной ствол>`): новая версия звука
 * заменяет прежнюю, а не спорит с ней.
 *
 * Револьвер, служебный карабин и двустволка стреляют банками своих пакетов
 * дополнений: архив — dlc.rpf пакета, банк — в его звуковой папке. Таблица
 * повторяет банки голоса студии (`weapon-sounds.js`) и сверяется с ними
 * тестом: траст обязан быть самодостаточным.
 */
const WEAPON_SOUND_ID = /^local-sound-weapon-([a-z0-9-]{1,48})-([a-f0-9]{12})$/;
const WEAPON_SOUND_ARCHIVES = new Set([
  RESIDENT,
  "x64/audio/sfx/WEAPONS_PLAYER.rpf",
]);
export const WEAPON_SOUND_DLC_FOLDERS = Object.freeze({
  "update/x64/dlcpacks/mpapartment/dlc.rpf": "x64/audio/sfx/dlc_apartment/",
  "update/x64/dlcpacks/mplowrider2/dlc.rpf": "x64/audio/sfx/dlc_low2/",
  "update/x64/dlcpacks/mpsecurity/dlc.rpf": "x64/audio/sfx/dlc_security/",
  "update/x64/dlcpacks/mpsum2/dlc.rpf": "x64/audio/sfx/dlc_mpsum2/",
});

/* Где лежит банк ствола: в корне общего архива или в папке пакета. */
function weaponBankEntry(target, bank) {
  if (WEAPON_SOUND_ARCHIVES.has(target)) return `${bank}.awc`;
  const folder = Object.hasOwn(WEAPON_SOUND_DLC_FOLDERS, target)
    ? WEAPON_SOUND_DLC_FOLDERS[target]
    : null;
  return folder ? `${folder}${bank}.awc` : null;
}

/**
 * Куда звуковой слой ствола можно положить из каталога: банк в корне
 * `RESIDENT`/`WEAPONS_PLAYER` или в звуковой папке пакета дополнения из
 * `WEAPON_SOUND_DLC_FOLDERS`. Одно правило для сервера каталога и для
 * проверки заявки (`publisher.js`, `manifest-authority`).
 */
export function isWeaponAudioLayerPlace(target, entry) {
  const archive = String(target || "");
  const path = String(entry || "");
  const name = /^[a-z0-9][a-z0-9._-]{0,119}\.awc$/i;
  if (/^x64\/audio\/sfx\/(resident|weapons_player)\.rpf$/i.test(archive))
    return name.test(path);
  const key = archive.toLowerCase();
  const folder = Object.hasOwn(WEAPON_SOUND_DLC_FOLDERS, key)
    ? WEAPON_SOUND_DLC_FOLDERS[key]
    : null;
  return Boolean(
    folder && path.startsWith(folder) && name.test(path.slice(folder.length)),
  );
}

export function isLocalWeaponSoundManifest(manifest, edition) {
  const id = WEAPON_SOUND_ID.exec(String(manifest?.id || ""));
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (!id) return false;
  const places = files.map((file) => `${file?.target}/${file?.entry}`);
  return Boolean(
    String(edition || "").toLowerCase() === "legacy" &&
    manifest?.scope === "game-root" &&
    manifest?.adapter === "rpf-entry" &&
    manifest?.requiresLoader === false &&
    manifest?.gameplayChanges === false &&
    JSON.stringify(manifest?.capabilities) ===
      JSON.stringify(["awc-stream-layer-v1"]) &&
    JSON.stringify(manifest?.editions) === JSON.stringify(["Legacy"]) &&
    JSON.stringify(manifest?.slots) ===
      JSON.stringify([`sound-weapon-${id[1]}`]) &&
    files.length >= 1 &&
    files.length <= 4 &&
    new Set(places).size === files.length &&
    new Set(files.map((file) => file?.source)).size === files.length &&
    files.every((file) => {
      const bank = String(file?.merge?.bank || "");
      const streams = Array.isArray(file?.merge?.streams)
        ? file.merge.streams
        : [];
      const entry = BANK_NAME.test(bank)
        ? weaponBankEntry(file?.target, bank)
        : null;
      return (
        Boolean(entry) &&
        (file.target !== RESIDENT || RESIDENT_BANKS.has(bank)) &&
        file?.entry === entry &&
        file?.source === `payload/${bank}.awc` &&
        file?.action === "replace" &&
        file?.merge?.strategy === "awc-stream-layer-v1" &&
        file?.merge?.completeBank === undefined &&
        file?.merge?.drop === undefined &&
        streams.length >= 1 &&
        streams.length <= 64 &&
        streams.every((stream) => STREAM_ID.test(String(stream))) &&
        new Set(streams).size === streams.length &&
        Number.isInteger(file?.size) &&
        file.size > 0 &&
        file.size <= 64 * 1024 * 1024 &&
        /^[a-f0-9]{64}$/.test(file?.sha256 || "")
      );
    }),
  );
}
