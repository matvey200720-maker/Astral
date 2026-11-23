import { createHash } from "node:crypto";

/*
 * Готовый набор звуков из папки мода.
 *
 * Как звуковые моды раздают на самом деле (проверено по инструкциям авторов
 * и по устройству архивов игры): архив с файлами `.awc`, которые полагается
 * руками положить в `x64/audio/sfx/RESIDENT.rpf` и
 * `x64/audio/sfx/WEAPONS_PLAYER.rpf` через OpenIV, предварительно сделав
 * резервную копию. Это и есть работа, от которой Astral избавляет: студия
 * звука умеет собрать замену по дорожкам, но у людей на руках лежат готовые
 * наборы, и ставить их всё равно приходилось вручную.
 *
 * Почему не слой дорожек. Слой (`awc-stream-layer-v1`) подкладывает свои
 * дорожки в родной банк игрока. Готовый набор — это чужой банк целиком, со
 * своим числом дорожек и своими заголовками; разбирать его на дорожки, чтобы
 * тут же собрать обратно, значит внести потери там, где их не было. Поэтому
 * запись идёт целиком: `action: "replace"` на существующую запись архива.
 *
 * Что это ограничивает и почему так и надо: набор занимает банк целиком, и
 * поштучные замены студии в том же банке он вытесняет. Движок видит это как
 * обычный конфликт по записи и предлагает замену — то же самое поведение,
 * что у готовой карты и своей карты.
 */
export const LOCAL_SOUND_PACK_TRUST = Symbol("local-sound-pack-package");

const RESIDENT = "x64/audio/sfx/RESIDENT.rpf";
const WEAPONS_PLAYER = "x64/audio/sfx/WEAPONS_PLAYER.rpf";
const STREAMED_AMBIENCE = "x64/audio/sfx/STREAMED_AMBIENCE.rpf";
const ONESHOT_AMBIENCE = "x64/audio/sfx/ONESHOT_AMBIENCE.rpf";
/*
 * Архивы, где банки называет сама игра и их сотни: звуки двигателей (69 в
 * STREAMED_VEHICLES и ещё три архива вариантов), боль и дыхание (63),
 * полицейская рация (332), фон (170 и 93). Перечислять 700 имён здесь
 * значило бы держать копию оглавления архива, которая устареет молча;
 * поэтому форма имени строгая, а существование банка в архиве игры
 * проверяется на сборке набора — по живому оглавлению, а не по списку.
 */
const FREE_BANK_ARCHIVES = Object.freeze([
  STREAMED_AMBIENCE,
  ONESHOT_AMBIENCE,
  "x64/audio/sfx/PAIN.rpf",
  "x64/audio/sfx/POLICE_SCANNER.rpf",
  "x64/audio/sfx/STREAMED_VEHICLES.rpf",
  "x64/audio/sfx/STREAMED_VEHICLES_GRANULAR.rpf",
  "x64/audio/sfx/STREAMED_VEHICLES_GRANULAR_NPC.rpf",
  "x64/audio/sfx/STREAMED_VEHICLES_LOW_LATENCY.rpf",
]);

/*
 * Банки корня RESIDENT.rpf — все шестнадцать, состав снят с живого архива.
 * Совпадение с таблицами студии звука и трастом слоя сторожит
 * tests/sound-pack.test.js: банк, который набор принесёт, а траст не узнает,
 * — это отказ на установке после успешного разбора папки.
 */
const RESIDENT_BANKS = Object.freeze([
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
 * Банки WEAPONS_PLAYER.rpf — все двадцать два, состав снят с живого архива.
 * Имена банков этих двух архивов не пересекаются, и на этом стоит разбор
 * «плоской» папки: по имени файла однозначно видно, в какой архив он идёт.
 */
const WEAPON_BANKS = Object.freeze([
  "lmg_combat",
  "lmg_mg_player",
  "mgn_sml_am83_vera",
  "mgn_sml_am83_verb",
  "mgn_sml_sc__l",
  "ptl_50cal",
  "ptl_combat",
  "ptl_pistol",
  "ptl_px4",
  "ptl_rubber",
  "sht_bullpup",
  "sht_pump",
  "smg_micro",
  "smg_smg",
  "snp_heavy",
  "snp_rifle",
  "spl_grenade_player",
  "spl_minigun_player",
  "spl_prog_ar_player",
  "spl_railgun",
  "spl_rpg_player",
  "spl_tank_player",
]);

/* Форма имени банка в архивах, где имена держит игра. */
const FREE_BANK = /^[a-z0-9][a-z0-9_]{0,63}$/;

const ARCHIVE_BANKS = Object.freeze({
  [RESIDENT]: new Set(RESIDENT_BANKS),
  [WEAPONS_PLAYER]: new Set(WEAPON_BANKS),
});

export const SOUND_PACK_ARCHIVES = Object.freeze([
  RESIDENT,
  WEAPONS_PLAYER,
  ...FREE_BANK_ARCHIVES,
]);

/** Архив, которому принадлежит банк по имени, или null. */
export function soundPackArchiveOfBank(bank) {
  const name = String(bank || "").toLowerCase();
  if (ARCHIVE_BANKS[RESIDENT].has(name)) return RESIDENT;
  if (ARCHIVE_BANKS[WEAPONS_PLAYER].has(name)) return WEAPONS_PLAYER;
  return null;
}

/**
 * Разрешён ли этот банк в этом архиве.
 *
 * В манифесте архив и банк лежат порознь (`target` и `entry`) — так устроен
 * адаптер `rpf-entry` у всего движка. Слитный адрес `<архив>/<банк>.awc`
 * нужен снаружи: им адресуется файл в кэше пакета и им считается отпечаток
 * набора, потому что одно имя банка встречается в разных архивах.
 */
export function isSoundPackBank(archive, entry) {
  const bank = /^([a-z0-9][a-z0-9_.-]{0,63})\.awc$/.exec(
    String(entry || "").toLowerCase(),
  )?.[1];
  if (!bank) return false;
  const declared = ARCHIVE_BANKS[String(archive || "")];
  if (declared) return declared.has(bank);
  if (FREE_BANK_ARCHIVES.includes(String(archive || "")))
    return FREE_BANK.test(bank);
  return false;
}

/** То же самое по слитному адресу `x64/audio/sfx/RESIDENT.rpf/weapons.awc`. */
export function isSoundPackEntry(address) {
  const value = String(address || "");
  const cut = value.lastIndexOf("/");
  if (cut < 0) return false;
  return isSoundPackBank(value.slice(0, cut), value.slice(cut + 1));
}

const MAX_RESOURCE_COUNT = 64;
const MAX_RESOURCE_BYTES = 96 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

const MANIFEST_KEYS = Object.freeze([
  "id",
  "version",
  "name",
  "editions",
  "scope",
  "adapter",
  "requiresLoader",
  "gameplayChanges",
  "capabilities",
  "slots",
  "soundPack",
  "files",
]);
const SOUND_PACK_KEYS = Object.freeze([
  "schemaVersion",
  "sourceDigest",
  "bankCount",
]);
const FILE_KEYS = Object.freeze([
  "source",
  "target",
  "action",
  "entry",
  "size",
  "sha256",
]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const slug = (bank) => String(bank).replace(/[^a-z0-9]+/g, "-");

/** Банк записи: `…/RESIDENT.rpf/weapons.awc` → `weapons`. */
export const soundPackBankOfEntry = (entry) =>
  String(entry || "")
    .split("/")
    .pop()
    .replace(/\.awc$/i, "");

/**
 * Детерминированный хэш содержимого: отсортированные пары `запись\nsha256`.
 * Порядок обхода папки на него не влияет, поэтому один и тот же набор всегда
 * даёт один и тот же id, а другой набор — другой мод.
 */
export function soundPackSourceDigest(files) {
  const lines = files
    .map((file) => `${file.entry}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export function isLocalSoundPackManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.soundPack, SOUND_PACK_KEYS)) return false;

  const idMatch = /^local-sound-pack-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];

  if (manifest.version !== `1.0.0-${suffix}`) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 120) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  // Звук — это то, что слышно, а не правила игры.
  if (manifest.gameplayChanges !== false) return false;
  if (
    JSON.stringify(manifest.capabilities) !==
    JSON.stringify(["rpf-container-entry-v1"])
  )
    return false;

  const files = manifest.files;
  if (!Array.isArray(files)) return false;
  if (files.length < 1 || files.length > MAX_RESOURCE_COUNT) return false;
  if (manifest.soundPack.bankCount !== files.length) return false;
  if (manifest.soundPack.schemaVersion !== 1) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.soundPack.sourceDigest || ""))
    return false;

  const seen = new Set();
  const digestInput = [];
  const expectedSlots = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.target !== "string" || typeof file.entry !== "string")
      return false;
    if (!isSoundPackBank(file.target, file.entry)) return false;
    /* Адрес в кэше — слитный: одно имя банка встречается в разных архивах. */
    const address = `${file.target}/${file.entry}`;
    if (seen.has(address)) return false;
    seen.add(address);
    if (file.source !== `payload/${address}`) return false;
    /*
     * Только replace. Все банки этих архивов у игрока уже есть: набор их
     * заменяет, а не добавляет. `upsert` открыл бы дорогу записи, которой в
     * архиве нет, — а такой банк игра всё равно не прочитает.
     */
    if (file.action !== "replace") return false;
    if (
      !Number.isInteger(file.size) ||
      file.size < 1 ||
      file.size > MAX_RESOURCE_BYTES
    )
      return false;
    totalBytes += file.size;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    digestInput.push({ entry: address, sha256: file.sha256 });
    expectedSlots.push(`sound-bank-${slug(soundPackBankOfEntry(file.entry))}`);
  }
  if (totalBytes > MAX_TOTAL_BYTES) return false;

  /*
   * Слот на банк, тот же, каким студия занимает банк целиком: набор и своя
   * музыка на одном банке — это две работы в одном месте, и вторая должна
   * сменять первую, а не складываться с ней.
   */
  const slots = Array.isArray(manifest.slots) ? manifest.slots : null;
  if (!slots) return false;
  if (JSON.stringify(slots) !== JSON.stringify([...expectedSlots].sort()))
    return false;

  const digest = soundPackSourceDigest(digestInput);
  if (manifest.soundPack.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;

  return true;
}
