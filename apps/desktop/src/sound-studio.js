/*
 * Студия звука: банки из игры и установка слоя обратно.
 *
 * Окно слушает и обрабатывает; здесь дорожки превращаются в слой
 * `awc-stream-layer-v1` и уезжают тем же install engine, что и все моды, — с
 * конфликтами по потокам, транзакцией и независимым снятием. WAV приезжают из
 * окна по одному и складываются в сессию на диске: окно никогда не называет
 * файл — оно называет дорожку банка.
 *
 * Здесь же проходит граница доверия: перед сборкой каждый WAV проверяется по
 * заголовку — PCM16, моно, частота целевой дорожки. Что не проверено здесь,
 * то уехало бы в архив игры.
 */

import { ensureStoredFile } from "@modovik/install-engine/chunk-store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  HIT_SOUND_ARCHIVE,
  HIT_SOUND_BANK,
  HIT_SOUND_FORMAT,
  HIT_SOUND_PARTS,
  HIT_SOUND_PART_IDS,
  HIT_SOUND_SILENCE_SAMPLES,
  RADIO_STATION_MAP,
  REL_PATCH_FORMAT,
  REL_PATCH_VERSION,
  WEAPON_SOUNDS,
  WEAPON_SOUND_FORMAT,
  WEAPON_SOUND_MAP,
  SOUND_LIMITS,
  SOUND_SECTION_ARCHIVES,
  analyzeSamples,
  hitSoundBankLayout,
  hitSoundBankPlan,
  waveSlotBudget,
  waveSlotOf,
  weaponSlug,
  weaponVoiceBank,
  weaponVoiceByBank,
  archivePolicy,
  bankSection,
  buildBankXml,
  buildLayerXml,
  buildPrivateBankXml,
  buildSoundManifest,
  declaredBank,
  describeBank,
  isRadioSong,
  layerAssetNames,
  listXmlStreams,
  normalizeStreamId,
  pcm16ToFloat,
  retimeFormat,
  scanEntriesOf,
  SOUND_BANK_ID,
  soundStreamConflicts,
  tagsOf,
  isHeadroom,
  xmlHeadroom,
  xmlLoopPoint,
} from "@modovik/sound-studio";
import { buildShotProgram, readSoundCurves } from "@modovik/sound-studio/shot-program";
import { WEAPON_SHOT_SOURCES } from "@modovik/sound-studio/weapon-shot-sources";
import {
  AUDIO_DLC_GAME_ENTRY,
  AUDIO_DLC_SOUNDS_ENTRY,
  cloneHash,
  mergeAudioChunks,
  planWeaponOverride,
  streamKey,
  voiceWaveName,
  weaponAudio,
  weaponVoiceLeaves,
} from "@modovik/sound-studio/weapon-voice-plan";
import { bankHash, hexHash, joaat } from "@modovik/sound-studio/rel-edit";
import { WEAPON_VOICE_SOURCES } from "@modovik/sound-studio/weapon-voice-sources";
import { applySilencerLink, silencerLinkFields, soundShape } from "@modovik/sound-studio/silencer-link";
import { WEAPON_MUTE_FORMAT, planWeaponMute } from "@modovik/sound-studio/weapon-mute-plan";
import {
  hitBaseCarriesAstral,
  planHitOverride,
} from "@modovik/sound-studio/hit-voice-plan";
import {
  HIT_SOUND_SOURCES,
  HIT_SOUND_SPARE_WAVES,
} from "@modovik/sound-studio/hit-sound-sources";
import {
  SOUND_CATEGORIES_SOURCE,
  applyCategoryPatches,
  categoryVolumeRoots,
  readSoundCategories,
} from "@modovik/sound-studio/sound-categories";
import {
  CATEGORY_PATCH_ENTRY,
  composeCategoryPatches,
} from "@modovik/sound-studio/category-patch";
import {
  SOUND_MIX_CHANNEL_MAP,
  SOUND_MIX_FORMAT,
  normalizeSoundMix,
  soundMixGains,
  soundMixSignature,
} from "@modovik/sound-studio/sound-mix";
import {
  AUDIO_DLC_TARGET,
  getProfile,
  inspectProfile,
  installLocalSoundPackage,
  planLocalSoundPackage,
  sha256File,
  uninstallPackage,
} from "@modovik/install-engine";
import { PROTECTED_UPDATE_COPY } from "@modovik/install-engine/direct-base-cleanup.js";
import {
  AWC_SLOT_BUDGET_FEATURE,
  assertRpfHelperFeatures,
  composeRpfArchive,
  convertAwcToXml,
  convertXmlToAwc,
  extractRpfEntry,
  layerFromWavOnEngine,
  readAwcOnEngine,
  inspectAwc,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
  scanAwcBanks,
  searchRpfArchive,
} from "./rpf-composer.js";
import { materializeAwcEntry } from "./audio-composer.js";
import { materializeAudioRelEntry } from "./audio-rel-composer.js";
import { materializeAudioChunkEntry } from "./audio-chunk-composer.js";
import { prepareAudioDlcHost } from "./audio-dlc-host.js";

/*
 * Helper и движок подставляются снаружи: нативный хост собирается только под
 * Windows, а сессию, границы WAV и порядок вызовов нужно проверять на любой
 * машине — ровно как у большой карты.
 */
const defaultTools = () => ({
  scan: scanAwcBanks,
  search: searchRpfArchive,
  extract: extractRpfEntry,
  inspect: inspectAwc,
  /* Импорт WAV без XML: опись банка и сборка слоя движком, за выключателем; отказ — XML хоста. */
  readAwc: readAwcOnEngine,
  layerFromWav: layerFromWavOnEngine,
  /* Возможности helper'а по имени: без описи слота банк не посчитать. */
  helperFeatures: assertRpfHelperFeatures,
  toXml: convertAwcToXml,
  fromXml: convertXmlToAwc,
  plan: planLocalSoundPackage,
  install: installLocalSoundPackage,
  uninstall: uninstallPackage,
  profile: getProfile,
  awcMaterializer: materializeAwcEntry,
  audioRelMaterializer: materializeAudioRelEntry,
  audioChunkMaterializer: materializeAudioChunkEntry,
  audioHost: prepareAudioDlcHost,
  rpfComposer: composeRpfArchive,
  rpfProbe: probeRpfArchive,
  /*
   * Звуковой пакет Astral включается строкой в dlclist.xml update.rpf, а
   * прежний звук попадания правил update.rpf сам; этот архив пересобирают и
   * нативные патчи неба, мини-карты, прицела и килл-эффекта — мимо движка.
   * Без чтения content.xml и dlclist.xml движок не может перебазироваться на
   * такой архив и отказывает: «Astral cannot verify the externally changed
   * update.rpf». Снятие без них собралось бы из прежней основы и молча
   * стёрло бы поставленное нативным патчем.
   */
  contentXmlProvider: provideUpdateContentXml,
  dlcListProvider: provideLegacyDlcList,
});

const SESSION_ID = /^[0-9a-f]{32}$/;
/* Имя банка — одно правило с окном: проект хранит адрес назначения по этому
   же шаблону, и расходись они, окно теряло бы адрес у банка, который главный
   процесс принимает. */
const BANK_ID = SOUND_BANK_ID;
/*
 * Идентификатор слоя дорожек. `local-sound-pack-…` сюда не подходит нарочно:
 * это готовый набор из папки, у него свой владелец, своя панель и своё
 * снятие. Совпадение по форме было бы тихой передачей чужой работы не тому
 * коду — а он бы её снял, и человек не понял бы, что произошло.
 */
const MOD_ID = /^local-sound-(?!pack-)[a-z0-9-]+-[a-f0-9]{12}$/;
const PACK_MOD_ID = /^local-sound-pack-[a-f0-9]{12}$/;

const sessionsRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "sound-studio", "sessions");

const banksRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "sound-studio", "banks");

const layersRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "sound-studio", "layers");

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/* Путь игры содержит имя пользователя Windows — в кэше живёт его хеш. */
const gameKey = (gameRoot) =>
  createHash("sha256")
    .update(path.resolve(gameRoot).toLowerCase())
    .digest("hex")
    .slice(0, 16);

function requireSession(input) {
  const session = String(input?.session || "").trim();
  if (!SESSION_ID.test(session)) throw new Error("Некорректная сессия звука.");
  return session;
}

/*
 * Банк голоса ствола из пакета дополнения (револьвер, служебный карабин,
 * двустволка): его архива нет среди звуковых архивов студии, путь внутри
 * dlc.rpf вложенный и берётся из таблицы голоса, а не из окна. Читать и
 * заменять в нём можно только дорожки — как в банке ствола WEAPONS_PLAYER.
 */
const WEAPON_VOICE_POLICY = Object.freeze({ streams: true, bank: false });

function requireBank(input, { voice = false } = {}) {
  const archive = String(input?.archive || "").trim();
  const bank = String(input?.bank || "")
    .trim()
    .toLowerCase()
    .replace(/\.awc$/, "");
  if (!BANK_ID.test(bank) || path.posix.basename(bank) !== bank)
    throw new Error("Недопустимое имя звукового банка.");
  const policy = archivePolicy(archive);
  if (!policy) {
    const place = voice ? weaponVoiceBank(archive, bank) : null;
    if (!place) throw new Error("Банк вне разрешённых звуковых архивов.");
    return { archive, bank, entry: place.entry, policy: WEAPON_VOICE_POLICY };
  }
  if (!declaredBank(archive, bank))
    throw new Error("В этом архиве студия заменяет только объявленные банки.");
  return { archive, bank, entry: `${bank}.awc`, policy };
}

function requireStream(value) {
  const stream = normalizeStreamId(value);
  if (!stream) throw new Error("Недопустимый идентификатор дорожки.");
  return stream;
}

/* Папка банка в сессии: имя банка, и только оно — без путей и точек. */
function requireBankFolder(value) {
  const bank = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(bank))
    throw new Error("Недопустимое имя банка в сессии звука.");
  return bank;
}

/* Банк целиком принимает стерео-пару: левый и правый канал. */
const CHANNELS = new Set(["left", "right"]);
function requireChannel(value) {
  const channel = String(value || "")
    .trim()
    .toLowerCase();
  if (!CHANNELS.has(channel))
    throw new Error("Канал банка должен быть left или right.");
  return channel;
}

/**
 * Разбор заголовка WAV. Принимается ровно то, что понимает импорт AWC:
 * RIFF/WAVE, PCM16, один канал. Частота сверяется с целевой дорожкой — иначе
 * звук в игре поплывёт по скорости, и виноватой будет выглядеть студия.
 */
export function parseWavHeader(buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Файл не является WAV.");
  let offset = 12;
  let format = null;
  let dataBytes = 0;
  let dataOffset = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = {
        audioFormat: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    }
    if (id === "data") {
      dataBytes = size;
      dataOffset = offset + 8;
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || !dataBytes) throw new Error("В WAV нет fmt или data.");
  if (
    format.audioFormat !== 1 ||
    format.bitsPerSample !== 16 ||
    format.channels !== 1
  )
    throw new Error("Дорожка должна быть PCM16 в один канал.");
  if (dataOffset + dataBytes > buffer.length || dataBytes % 2 !== 0)
    throw new Error("WAV обрезан: данных меньше, чем объявлено.");
  const seconds = dataBytes / 2 / format.sampleRate;
  return { ...format, dataBytes, dataOffset, seconds };
}

/**
 * Каноническая форма WAV: ровно 44 байта заголовка и данные — так helper
 * отдаёт дорожку (GetWavFile), поэтому SHA-256 канонического файла совпадает
 * с payloadSha256 собранного слоя байт-в-байт. Лишние чанки чужих редакторов
 * (LIST, cue) здесь отбрасываются, чтобы сверка не ловила их вместо звука.
 */
export function canonicalWav(buffer) {
  const header = parseWavHeader(buffer);
  const data = buffer.subarray(
    header.dataOffset,
    header.dataOffset + header.dataBytes,
  );
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(header.sampleRate, 24);
  wav.writeUInt32LE(header.sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return { wav, header: { ...header, dataOffset: 44 } };
}

/*
 * Сообщения helper'а — техника: NullReferenceException или пути. Известные
 * переводятся в то, что человек может сделать; остальные идут как есть.
 */
function friendly(error) {
  const text = String(error?.message || error || "");
  if (/Object reference not set/i.test(text))
    return new Error(
      "Helper не смог разобрать звуковой банк: нет ключа AWC или файл повреждён. " +
        "Обновите список банков; если повторится — повторите подготовку GTA в Astral.",
    );
  if (/checksum mismatch/i.test(text))
    return new Error(
      "Ключи RPF не совпали с закреплёнными — повторите подготовку GTA в Astral.",
    );
  if (error?.code === "ENOENT")
    return new Error(`Файл не найден: ${error.path || text}`);
  return error instanceof Error ? error : new Error(text);
}

const guarded =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw friendly(error);
    }
  };

const readJson = (file) =>
  fs
    .readFile(file, "utf8")
    .then(JSON.parse)
    .catch(() => null);

/*
 * Раскладка кэша: <state>/sound-studio/banks/<игра>/<архив>/<банк>/ —
 * bank.awc, inspect.json и, лениво, bank.xml с assets/. Скан пишет банки
 * архива именно сюда, поэтому одиночный кэш и пакетный скан видят одни и те
 * же файлы.
 */
const archiveKey = (archive) => {
  /* У пакетов дополнений архив всегда `dlc.rpf` — ключ берёт имя пакета,
     иначе банки трёх пакетов легли бы в одну папку кэша. */
  const pack = /^update\/x64\/dlcpacks\/([a-z0-9_]+)\/dlc\.rpf$/i.exec(archive);
  return pack
    ? `dlc-${pack[1].toLowerCase()}`
    : path.posix.basename(archive, ".rpf").toLowerCase();
};
const archiveCacheRoot = (stateDir, gameRoot, archive) =>
  path.join(banksRoot(stateDir), gameKey(gameRoot), archiveKey(archive));
const bankDirectory = (stateDir, gameRoot, archive, bank) =>
  path.join(archiveCacheRoot(stateDir, gameRoot, archive), bank);
const archiveFile = (gameRoot, archive) =>
  path.join(gameRoot, ...archive.split("/"));

/*
 * Один и тот же банк не извлекается дважды разом: список банков и превью
 * дорожки могут прийти внахлёст (в dev окно и вовсе монтирует эффект дважды),
 * а извлечение и инспекция не терпят гонки на одном пути.
 */
const bankInflight = new Map();

/*
 * Кэш банка: сам AWC, его инспекция и, лениво, XML с WAV-ассетами. Обычно
 * его уже наполнил скан архива; при пустом кэше банк извлекается и
 * инспектируется поодиночке. Извлечение идёт прямым `extract` с перезаписью,
 * поэтому повтор не спотыкается о свой же прошлый файл.
 *
 * `base` — банк не из игры, а из другого архива (чистой основы движка):
 * `{path, key}`, где `key` отличает эту основу от прежних, — кэш у неё свой.
 */
async function bankCache(
  { gameRoot, archive, bank, entry, base = null },
  stateDir,
  tools,
  input,
) {
  const directory = `${bankDirectory(stateDir, gameRoot, archive, bank)}${base ? `@${base.key}` : ""}`;
  const awcPath = path.join(directory, "bank.awc");
  const inspectionPath = path.join(directory, "inspect.json");

  if (!input?.refresh) {
    const cached = await fs
      .readFile(inspectionPath, "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (cached) return { directory, awcPath, inspection: cached };
  }

  const key = directory;
  if (bankInflight.has(key)) return bankInflight.get(key);
  const task = (async () => {
    await fs.mkdir(directory, { recursive: true });
    /* Ключ архива игра выводит из его имени: копия основы читается под
       именем архива игры. */
    const archivePath = base?.path || archiveFile(gameRoot, archive);
    await tools.extract({
      archivePath,
      archiveTarget: archive,
      entry: entry || `${bank}.awc`,
      output: awcPath,
      gameRoot,
      edition: "Legacy",
    });
    const inspection = await tools.inspect({
      input: awcPath,
      gameRoot,
      edition: "Legacy",
    });
    await fs.writeFile(inspectionPath, `${JSON.stringify(inspection)}\n`);
    return { directory, awcPath, inspection };
  })();
  bankInflight.set(key, task);
  try {
    return await task;
  } finally {
    bankInflight.delete(key);
  }
}

/** XML банка с выгруженными WAV — один раз на кэш, дальше с диска. */
async function bankXml(cache, gameRoot, tools) {
  const xmlPath = path.join(cache.directory, "bank.xml");
  const assetsDirectory = path.join(cache.directory, "assets");
  const existing = await fs.readFile(xmlPath, "utf8").catch(() => null);
  if (existing) return { xml: existing, xmlPath, assetsDirectory };
  await fs.mkdir(assetsDirectory, { recursive: true });
  await tools.toXml({
    input: cache.awcPath,
    output: xmlPath,
    assetsDirectory,
    gameRoot,
    edition: "Legacy",
  });
  return {
    xml: await fs.readFile(xmlPath, "utf8"),
    xmlPath,
    assetsDirectory,
  };
}

/*
 * Дорожка глазами окна. Заменяемы PCM и ADPCM: кодер ADPCM CodeWalker
 * ограничен длиной данных (ошибка ×4 в счётчике сэмплов безвредна) и на
 * живых банках даёт 39–47 дБ; сверяется он по числу сэмплов, а не
 * байт-в-байт — перекодировка с потерями по построению.
 */
const REPLACEABLE_CODECS = new Set(["PCM", "ADPCM"]);
const streamView = (stream) => {
  const codec = String(
    stream.codec || String(stream.type || "").split(",")[0] || "",
  )
    .trim()
    .toUpperCase();
  const replaceable = REPLACEABLE_CODECS.has(codec);
  return {
    hash: normalizeStreamId(stream.hash || stream.name),
    name: String(stream.name || ""),
    type: String(stream.type || ""),
    codec,
    sampleRate: Number(stream.sampleRate) || 0,
    samples: Number(stream.samples) || 0,
    seconds: Number(stream.seconds) || 0,
    bytes: Number(stream.bytes) || 0,
    loop: Number(stream.loopEnd) > 0,
    replaceable,
    reason: replaceable
      ? ""
      : `Кодек ${codec || "неизвестен"}: импорт таких дорожек ещё не обкатан.`,
  };
};

/*
 * Сколько банк может вырасти (задача 6 ТЗ 10.10.2026, вечер): запас его
 * слота в памяти игры — байты данных и служебных чанков сверх того, что
 * банк уже занимает (`wave-slots.js`). У постоянных банков RESIDENT (сирены,
 * окружение, взрывы, интерфейс…) и потоковых банков окружения запаса нет ни
 * байта: свой звук длиннее звука игры не поместится, и установка откажет
 * («Звуки не помещаются в банк…»). У общих слотов (стволы игрока, боль,
 * моторы) запас свой у каждого банка. `null` — у банка нет слота (музыка,
 * радио) или его опись снята прежним helper'ом.
 */
function bankBudget(archive, entry, resource) {
  try {
    const limits = waveSlotBudget(archive, entry, resource);
    if (!limits) return null;
    const bytes = limits.bytes - Number(resource?.contentBytes);
    const metadata = limits.metadata - Number(resource?.metadataBytes);
    if (!Number.isFinite(bytes) || !Number.isFinite(metadata)) return null;
    return {
      slot: limits.slot,
      bytes: Math.max(0, bytes),
      metadata: Math.max(0, metadata),
    };
  } catch {
    return null;
  }
}

/*
 * Целостное шифрование (RSXXTEA) — обычное состояние живого оружейного
 * банка: мы его расшифровываем и пересобираем обратно. Многоканальный
 * потоковый банк (музыка, радио) заменяется целиком стерео-парой; внутри
 * оружейных архивов такой банк остаётся только для чтения — там конвейер
 * подменяет дорожки, а не контейнер.
 */
function bankView(
  archive,
  bank,
  inspection,
  { policy = archivePolicy(archive), entry = `${bank}.awc` } = {},
) {
  const resource = inspection?.resource || {};
  const kind = resource.multiChannelFlag ? "bank" : "streams";
  const views = (resource.streams || [])
    .map(streamView)
    .filter((stream) => stream.hash);
  const channels = views.filter((stream) => stream.hash !== "0X00000000");
  const allowed = kind === "bank" ? policy?.bank : policy?.streams;
  const readOnly = !allowed;
  const first = channels[0] || null;
  return {
    archive,
    bank,
    entry,
    version: Number(resource.version) || 0,
    kind,
    readOnly,
    reason: readOnly
      ? kind === "bank"
        ? "Многоканальный потоковый банк — здесь он не заменяется."
        : "В этом архиве заменяется только банк целиком."
      : "",
    fixedLength: Boolean(RADIO_STATION_MAP[archive]),
    channels: kind === "bank" ? channels.length : 0,
    sampleRate: kind === "bank" ? first?.sampleRate || 0 : 0,
    samples: kind === "bank" ? first?.samples || 0 : 0,
    seconds:
      kind === "bank"
        ? channels.reduce((most, stream) => Math.max(most, stream.seconds), 0)
        : 0,
    /* Запас слота памяти игры — сколько своему звуку можно быть длиннее. */
    budget: kind === "streams" ? bankBudget(archive, entry, resource) : null,
    streams: views,
  };
}

/* Вид банка по факту: многоканальный контейнер идёт целиком. */
async function resolveBankKind({ gameRoot, archive, bank }, stateDir, kit) {
  const cache = await bankCache({ gameRoot, archive, bank }, stateDir, kit);
  return bankView(archive, bank, cache.inspection).kind;
}

async function archiveStamp(archivePath) {
  const stat = await fs.stat(archivePath);
  return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

/*
 * Скан архива: один вызов helper'а — все банки извлечены и описаны, по
 * банку на процесс первый список занимал десятки секунд. Индекс scan.json
 * помнит состав и отпечаток архива (размер и mtime): если игра обновилась
 * или в архив уже установлен слой, список помечается устаревшим, а
 * перечитывание остаётся явным действием — иначе «оригинал» дорожки после
 * установки тихо стал бы вашей же заменой.
 */
async function scanArchive({ gameRoot, archive }, stateDir, kit) {
  const root = archiveCacheRoot(stateDir, gameRoot, archive);
  const archivePath = archiveFile(gameRoot, archive);
  await fs.mkdir(root, { recursive: true });
  const result = await kit.scan({
    archivePath,
    outputDirectory: root,
    entries: scanEntriesOf(archive),
    gameRoot,
    edition: "Legacy",
  });
  const banks = [];
  for (const item of (result.banks || []).slice(0, SOUND_LIMITS.banksPerGame)) {
    const bank = String(item.bank || "").toLowerCase();
    if (!BANK_ID.test(bank)) continue;
    const entry = String(item.entry || `${bank}.awc`);
    if (item.error) {
      banks.push({ bank, entry, error: String(item.error) });
      continue;
    }
    await fs.writeFile(
      path.join(root, bank, "inspect.json"),
      `${JSON.stringify({
        status: "ready",
        mode: "awc-inspect",
        input: item.output,
        sha256: item.sha256,
        resource: item.resource,
      })}\n`,
    );
    banks.push({ bank, entry });
  }
  const index = {
    archive,
    stamp: await archiveStamp(archivePath).catch(() => null),
    /* С каким набором объявленных банков строился индекс: набор растёт с
       новыми разделами, и старый индекс без vehicles/melee должен
       перестроиться сам, а не ждать кнопки «Повторить». */
    entries: scanEntriesOf(archive),
    scannedAt: new Date().toISOString(),
    banks,
  };
  await fs.writeFile(
    path.join(root, "scan.json"),
    `${JSON.stringify(index)}\n`,
  );
  return index;
}

async function loadArchiveBanks({ gameRoot, archive }, stateDir, kit, refresh) {
  const root = archiveCacheRoot(stateDir, gameRoot, archive);
  let index = refresh ? null : await readJson(path.join(root, "scan.json"));
  if (
    index &&
    JSON.stringify(index.entries ?? null) !==
      JSON.stringify(scanEntriesOf(archive))
  )
    index = null;
  let stale = false;
  if (index) {
    const stamp = await archiveStamp(archiveFile(gameRoot, archive)).catch(
      () => null,
    );
    stale =
      Boolean(index.stamp) &&
      (!stamp ||
        stamp.size !== index.stamp.size ||
        stamp.mtimeMs !== index.stamp.mtimeMs);
  } else {
    index = await scanArchive({ gameRoot, archive }, stateDir, kit);
  }
  const banks = [];
  const problems = [];
  for (const item of index.banks || []) {
    if (item.error) {
      problems.push({ archive, bank: item.bank, error: item.error });
      continue;
    }
    const inspection = await readJson(
      path.join(root, item.bank, "inspect.json"),
    );
    if (!inspection) {
      // Кэш банка пропал под индексом — перечитать архив надёжнее, чем гадать.
      if (!refresh)
        return loadArchiveBanks({ gameRoot, archive }, stateDir, kit, true);
      problems.push({ archive, bank: item.bank, error: "кэш банка потерян" });
      continue;
    }
    banks.push(bankView(archive, item.bank, inspection));
  }
  return { banks, problems, stale };
}

/**
 * Банки из установки игрока. Ничего не пишет в игру: два разрешённых архива
 * сканируются по одному вызову helper'а, многоканальные отдаются с пометкой
 * «только чтение», а банки, которые helper не разобрал, — списком problems:
 * прятать их нечестно, трогать нельзя.
 */
/*
 * Песни станции — по именам из оглавления архива, без извлечения: станция
 * весит сотни мегабайт, а имена там читаемые. Детали (каналы, длина) банк
 * получает по запросу, когда человек его выбрал.
 */
async function listRadioSongs(input, gameRoot, kit) {
  const archive = String(input?.archive || "").trim();
  const station = RADIO_STATION_MAP[archive];
  if (!station) throw new Error("Выберите музыкальную станцию.");
  const search = await kit.search({
    archivePath: archiveFile(gameRoot, archive),
    query: ".awc",
    maxMatches: 5000,
    maxNestedDepth: 0,
    gameRoot,
    edition: "Legacy",
  });
  const banks = [
    ...new Set(
      (search.matches || [])
        .map((item) => path.posix.basename(String(item.entry || "")))
        .filter((name) => name.toLowerCase().endsWith(".awc"))
        .map((name) => name.slice(0, -4).toLowerCase())
        .filter((bank) => BANK_ID.test(bank) && isRadioSong(bank)),
    ),
  ]
    .sort()
    .map((bank) => ({
      archive,
      bank,
      entry: `${bank}.awc`,
      version: 0,
      kind: "bank",
      readOnly: false,
      reason: "",
      fixedLength: true,
      pending: true,
      channels: 0,
      sampleRate: 0,
      samples: 0,
      seconds: 0,
      streams: [],
    }));
  if (!banks.length) throw new Error("На станции не нашлось песен.");
  return {
    source: "game",
    section: "radio",
    archive,
    station: station.title,
    stale: false,
    problems: [],
    banks,
  };
}

async function listSoundBanksImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const section = String(input?.section || "weapons");
  if (section === "radio") return listRadioSongs(input, gameRoot, kit);
  const archives = SOUND_SECTION_ARCHIVES[section];
  if (!archives) throw new Error("Неизвестный раздел студии звука.");
  const banks = [];
  const problems = [];
  let stale = false;
  for (const archive of archives) {
    const loaded = await loadArchiveBanks(
      { gameRoot, archive },
      stateDir,
      kit,
      Boolean(input?.refresh),
    );
    // RESIDENT делится между разделами: каждый берёт свои банки.
    banks.push(
      ...loaded.banks.filter(
        (bank) => bankSection(archive, bank.bank) === section,
      ),
    );
    problems.push(...loaded.problems);
    stale = stale || loaded.stale;
  }
  if (!banks.length)
    throw new Error(
      problems.length
        ? `Банки этого раздела не прочитались: ${problems
            .map((item) => `${item.bank} — ${item.error}`)
            .join("; ")}`
        : "В архивах игры не нашлось банков для этого раздела.",
    );
  return { source: "game", section, stale, problems, banks };
}
export const listSoundBanks = guarded(listSoundBanksImpl);

/** Один банк с деталями — для песни станции, выбранной из списка имён. */
async function readSoundBankImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const { archive, bank, entry, policy } = requireBank(input, { voice: true });
  const cache = await bankCache(
    { gameRoot, archive, bank, entry },
    stateDir,
    kit,
    input,
  );
  return bankView(archive, bank, cache.inspection, { policy, entry });
}
export const readSoundBank = guarded(readSoundBankImpl);

/**
 * Оригинал дорожки для прослушивания: WAV из экспорта банка, base64. Экспорт
 * декодирует ADPCM сам, так что окну достаётся обычный WAV, который умеет
 * играть любой браузер.
 */
async function readSoundStreamImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const { archive, bank, entry, policy } = requireBank(input, { voice: true });
  const stream = requireStream(input?.stream);
  const cache = await bankCache(
    { gameRoot, archive, bank, entry },
    stateDir,
    kit,
  );
  const view = bankView(archive, bank, cache.inspection, { policy, entry });
  if (view.readOnly) throw new Error(view.reason);
  if (view.kind === "bank") {
    // Превью банка — его левый канал: то, что слышно в игре, без сведения.
    if (view.seconds > SOUND_LIMITS.bankTrackSeconds)
      throw new Error("Банк длиннее десяти минут — превью не отдаётся.");
    const { xml, assetsDirectory } = await bankXml(cache, gameRoot, kit);
    const channels = listXmlStreams(xml).filter((item) => item.fileName);
    const channel =
      stream === "0X00000000"
        ? channels[0]
        : channels.find((item) => item.stream === stream);
    if (!channel) throw new Error("В банке нет такого канала.");
    const wav = await fs.readFile(path.join(assetsDirectory, channel.fileName));
    return {
      stream,
      sampleRate: view.sampleRate,
      seconds: view.seconds,
      wav: wav.toString("base64"),
    };
  }
  const known = view.streams.find((item) => item.hash === stream);
  if (!known) throw new Error("В банке нет такой дорожки.");
  if (known.seconds > SOUND_LIMITS.previewSeconds)
    throw new Error("Дорожка длиннее минуты — превью не отдаётся.");
  const { xml, assetsDirectory } = await bankXml(cache, gameRoot, kit);
  const asset = layerAssetNames(xml, [stream])[0];
  if (!asset?.fileName)
    throw new Error("У дорожки нет собственных данных для превью.");
  const wav = await fs.readFile(path.join(assetsDirectory, asset.fileName));
  return {
    stream,
    sampleRate: known.sampleRate,
    seconds: known.seconds,
    /* Крутит ли игра дорожку по кругу и с какого сэмпла (−1 — разовая):
       окно по нему предлагает сшить свой звук в петлю без щелчка. */
    loopPoint: xmlLoopPoint(xml, stream),
    wav: wav.toString("base64"),
  };
}
export const readSoundStream = guarded(readSoundStreamImpl);

/*
 * Выстрел ствола «как в игре»: программа дерева игры (`shot-program.js`) и
 * дорожки, на которые ведут её листья. Окно вычисляет из программы каждый
 * выстрел и сводит его в потоке (`shot-voices.js`, `shot-mix.js`).
 *
 * Метаданные — из чистых архивов (`readAudioChunks`, извлекаются один раз и
 * помнятся на диске), сведённые в один вид — в памяти на игру. Дорожки — из
 * чистой основы банка (`vanillaBankXml`): превью звучит игрой без модов.
 */
const SHOT_DATA_TTL = 10 * 60 * 1000;
const shotData = new Map();

async function weaponShotData(gameRoot, stateDir, kit) {
  const key = gameKey(gameRoot);
  const known = shotData.get(key);
  if (known && Date.now() - known.at < SHOT_DATA_TTL) return known.task;
  const task = (async () => {
    const chunks = await readAudioChunks({ gameRoot, sources: WEAPON_SHOT_SOURCES }, stateDir, kit);
    const [curves, categories] = await readAudioChunks(
      { gameRoot, sources: { chunks: [WEAPON_SHOT_SOURCES.curves, WEAPON_SHOT_SOURCES.categories] } },
      stateDir,
      kit,
    );
    return {
      merged: mergeAudioChunks(chunks),
      curves: readSoundCurves(curves.buffer),
      categories: readSoundCategories(categories.buffer),
    };
  })();
  shotData.set(key, { at: Date.now(), task });
  task.catch(() => {
    if (shotData.get(key)?.task === task) shotData.delete(key);
  });
  return task;
}

async function readWeaponShotImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const id = String(input?.weapon || "");
  const weapon = WEAPON_SHOT_SOURCES.weapons[id];
  if (!weapon) throw new Error("Для этого ствола нет выстрела игры.");
  const data = await weaponShotData(gameRoot, stateDir, kit);
  const program = buildShotProgram(data.merged, {
    item: weapon.item,
    auto: weapon.auto,
    curves: data.curves,
    categories: data.categories,
  });
  const byBank = new Map();
  for (const wave of program.waves) {
    const place = WEAPON_SHOT_SOURCES.banks[wave.container];
    if (!place) continue;
    if (!byBank.has(wave.container)) byBank.set(wave.container, { place, waves: [] });
    byBank.get(wave.container).waves.push(wave);
  }
  const waves = [];
  for (const { place, waves: wanted } of byBank.values()) {
    const { xml, assetsDirectory } = await vanillaBankXml(place, gameRoot, stateDir, kit);
    const assets = new Map(listXmlStreams(xml).map((item) => [item.stream, item.fileName]));
    for (const wave of wanted) {
      const fileName = assets.get(wave.wave);
      if (!fileName) continue;
      const bytes = await fs.readFile(path.join(assetsDirectory, fileName));
      const header = parseWavHeader(bytes);
      waves.push({
        key: wave.key,
        sampleRate: header.sampleRate,
        headroom: xmlHeadroom(xml, wave.wave),
        loopPoint: xmlLoopPoint(xml, wave.wave) ?? -1,
        /* PCM16 как есть: окно переводит в float в потоке. */
        pcm: new Uint8Array(bytes.subarray(header.dataOffset, header.dataOffset + header.dataBytes)),
      });
    }
  }
  return { weapon: id, program, waves };
}
export const readWeaponShot = guarded(readWeaponShotImpl);

/*
 * Акустический профиль банка дорожек: признаки, теги и мини-волна каждой
 * дорожки. Считается один раз по WAV из экспорта банка и лежит рядом с ним
 * в profile.json; окну отдаётся целиком — это килобайты, а не мегабайты.
 * Без имён дорожек это единственный способ дать человеку не столбец из
 * пятисот «дорожка N», а сирены отдельно от щелчков.
 */
const PROFILE_VERSION = 1;

async function readSoundBankProfileImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const { archive, bank, entry, policy } = requireBank(input, { voice: true });
  const cache = await bankCache(
    { gameRoot, archive, bank, entry },
    stateDir,
    kit,
  );
  const view = bankView(archive, bank, cache.inspection, { policy, entry });
  if (view.kind !== "streams")
    throw new Error("Профиль считается только для банков с дорожками.");
  const profilePath = path.join(cache.directory, "profile.json");
  const cached = input?.refresh ? null : await readJson(profilePath);
  if (
    cached?.version === PROFILE_VERSION &&
    cached.sha256 === cache.inspection?.sha256
  )
    return { archive, bank, tracks: cached.tracks };
  const { xml, assetsDirectory } = await bankXml(cache, gameRoot, kit);
  const tracks = {};
  for (const item of listXmlStreams(xml)) {
    if (!item.fileName) continue;
    try {
      const bytes = await fs.readFile(
        path.join(assetsDirectory, item.fileName),
      );
      const header = parseWavHeader(bytes);
      const samples = pcm16ToFloat(bytes, header.dataOffset, header.dataBytes);
      const features = analyzeSamples(samples, header.sampleRate);
      tracks[item.stream] = { ...features, tags: tagsOf(features) };
    } catch (error) {
      tracks[item.stream] = { error: String(error?.message || error) };
    }
  }
  await fs.writeFile(
    profilePath,
    `${JSON.stringify({
      version: PROFILE_VERSION,
      sha256: cache.inspection?.sha256 || null,
      tracks,
    })}\n`,
  );
  return { archive, bank, tracks };
}
export const readSoundBankProfile = guarded(readSoundBankProfileImpl);

/** Открывает сессию замены и отдаёт окну её идентификатор. */
export async function beginSoundSession(_input, _context, stateDir) {
  const session = randomUUID().replaceAll("-", "");
  const directory = path.join(sessionsRoot(stateDir), session);
  await fs.mkdir(directory, { recursive: true });
  return { session };
}

const stagedFiles = async (directory) =>
  (await fs.readdir(directory)).filter((name) => name.endsWith(".wav"));

/**
 * Принимает один обработанный WAV под дорожку банка (`stream`) или под
 * канал стерео-пары банка целиком (`channel`: left/right). Большой WAV
 * приходит частями по порядку — канал IPC ограничен, а музыка на канал
 * весит десятки мегабайт; собранное целое проверяется как один файл.
 */
export async function stageSoundWav(input, _context, stateDir) {
  const session = requireSession(input);
  const sessionDirectory = path.join(sessionsRoot(stateDir), session);
  const stat = await fs.stat(sessionDirectory).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Сессия звука не открыта.");
  /* Звук ствола живёт в нескольких банках сразу, и у разных банков бывают
     дорожки с одним хешем — поэтому дорожки банка лежат в его папке. */
  const bankFolder =
    input?.bank !== undefined && input?.bank !== null
      ? requireBankFolder(input.bank)
      : "";
  const directory = bankFolder
    ? path.join(sessionDirectory, bankFolder)
    : sessionDirectory;
  if (bankFolder) await fs.mkdir(directory, { recursive: true });
  const channel =
    input?.channel !== undefined && input?.channel !== null
      ? requireChannel(input.channel)
      : null;
  const id = channel || requireStream(input?.stream);
  const whole = Boolean(channel);
  const expectedRate = Number(input?.sampleRate) || 0;
  const encoded = String(input?.wav || "");
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded))
    throw new RangeError("Дорожка передана не как base64.");
  const part = Number.isInteger(input?.part) ? input.part : 0;
  const parts = Number.isInteger(input?.parts) ? input.parts : 1;
  if (parts < 1 || parts > SOUND_LIMITS.stageParts || part < 0 || part >= parts)
    throw new RangeError("Некорректная нумерация частей дорожки.");
  const chunk = Buffer.from(encoded, "base64");
  if (!chunk.length || chunk.length > SOUND_LIMITS.stagePartBytes)
    throw new RangeError("Часть дорожки пустая или больше 16 МБ.");
  if (chunk.toString("base64") !== encoded)
    throw new Error("Дорожка передана в неканоническом base64.");
  const partPath = path.join(directory, `${id}.part`);
  if (part === 0) await fs.writeFile(partPath, chunk);
  else {
    if (!(await fs.stat(partPath).catch(() => null)))
      throw new Error("Части дорожки пришли не по порядку.");
    await fs.appendFile(partPath, chunk);
  }
  if (part < parts - 1)
    return { staged: (await stagedFiles(directory)).length, part, parts };
  const buffer = await fs.readFile(partPath);
  await fs.rm(partPath, { force: true });
  const limitBytes = whole ? SOUND_LIMITS.bankWavBytes : SOUND_LIMITS.wavBytes;
  const limitSeconds = whole
    ? SOUND_LIMITS.bankTrackSeconds
    : SOUND_LIMITS.trackSeconds;
  if (!buffer.length || buffer.length > limitBytes)
    throw new RangeError(
      `Дорожка пустая или больше ${Math.round(limitBytes / 1048576)} МБ.`,
    );
  const { wav, header } = canonicalWav(buffer);
  if (expectedRate && header.sampleRate !== expectedRate)
    throw new Error(
      `Частота ${header.sampleRate} Гц не совпадает с дорожкой банка (${expectedRate} Гц).`,
    );
  if (header.seconds > limitSeconds)
    throw new Error(`Дорожка длиннее ${limitSeconds} секунд.`);
  const existing = await stagedFiles(directory);
  const file = `${id}.wav`;
  if (
    !whole &&
    !existing.includes(file) &&
    existing.length >= SOUND_LIMITS.streamsPerSession
  )
    throw new Error("В сессии уже 24 дорожки.");
  const samples = header.dataBytes / 2;
  /*
   * Начало петли (задача 6): окно сшило свой звук в петлю без щелчка и
   * просит крутить его целиком — с этого сэмпла. Действует только там, где
   * игра и так крутит дорожку по кругу (`retimeStreamBlock`); разовый звук
   * им в петлю не превращается.
   */
  const loopStart =
    !whole &&
    Number.isInteger(input?.loopStart) &&
    input.loopStart >= 0 &&
    input.loopStart < samples
      ? input.loopStart
      : null;
  await fs.writeFile(path.join(directory, file), wav);
  const loopFile = path.join(directory, `${id}.loop`);
  if (loopStart === null) await fs.rm(loopFile, { force: true });
  else await fs.writeFile(loopFile, String(loopStart));
  /* Запас автора дорожки пака (`Headroom`, сотые дБ): личный банк ствола переносит его как есть — громкость как у
     пака, поставленного целиком. Свой звук окна запаса не несёт (0). */
  const headroomFile = path.join(directory, `${id}.headroom`);
  const headroom = !whole && isHeadroom(input?.headroom) && input.headroom !== 0 ? input.headroom : 0;
  if (!headroom) await fs.rm(headroomFile, { force: true });
  else await fs.writeFile(headroomFile, String(headroom));
  return {
    staged: (await stagedFiles(directory)).length,
    samples,
    seconds: header.seconds,
    loopStart,
  };
}

/* Запас дорожки сессии (дорожка пака), сотые дБ; 0 — своя. */
async function stagedHeadroom(file) {
  const text = (await fs.readFile(file.replace(/\.wav$/, ".headroom"), "utf8").catch(() => "")).trim();
  const value = Number.parseInt(text, 10);
  return /^-?\d+$/.test(text) && isHeadroom(value) ? value : 0;
}

/* Начало петли дорожки сессии, если окно его назвало. */
async function stagedLoopStart(file) {
  const text = await fs
    .readFile(file.replace(/\.wav$/, ".loop"), "utf8")
    .catch(() => "");
  const value = Number.parseInt(text, 10);
  return /^\d+$/.test(text.trim()) && Number.isInteger(value) ? value : null;
}

/** Закрывает сессию и убирает её файлы. */
export async function endSoundSession(input, _context, stateDir) {
  const session = requireSession(input);
  await fs
    .rm(path.join(sessionsRoot(stateDir), session), {
      recursive: true,
      force: true,
    })
    .catch(() => {});
  return { closed: true };
}

async function sessionStreams(stateDir, session, bank = "") {
  const directory = bank
    ? path.join(sessionsRoot(stateDir), session, requireBankFolder(bank))
    : path.join(sessionsRoot(stateDir), session);
  const names = await fs.readdir(directory).catch(() => null);
  if (!names) throw new Error("Сессия звука не открыта.");
  const streams = names
    .filter((name) => /^0X[0-9A-F]{8}\.wav$/.test(name))
    .map((name) => ({
      stream: name.slice(0, -4),
      file: path.join(directory, name),
    }))
    .sort((left, right) => left.stream.localeCompare(right.stream));
  if (!streams.length)
    throw new Error("В сессии нет ни одной дорожки для замены.");
  return streams;
}

/**
 * Сборка слоя. XML банка режется до заменяемых потоков, заголовки дорожек
 * переписываются под длину подложенных WAV, helper собирает компактный AWC —
 * и до любой установки собранное перечитывается: набор потоков, версия,
 * число сэмплов и сами байты звука (SHA-256 канонического WAV) обязаны
 * сойтись с тем, что человек слышал в превью.
 */
async function buildLayer({ gameRoot, archive, bank, session }, stateDir, kit) {
  const staged = await sessionStreams(stateDir, session);
  const streams = staged.map((item) => item.stream);
  for (const item of staged) item.loopStart = await stagedLoopStart(item.file);
  const loops = staged.filter((item) => item.loopStart !== null);
  const fingerprint = createHash("sha256");
  fingerprint.update(JSON.stringify({ archive, bank, streams }));
  /* Петля меняет заголовок слоя — и отпечаток; без петель он прежний. */
  if (loops.length)
    fingerprint.update(
      JSON.stringify(loops.map((item) => [item.stream, item.loopStart])),
    );
  for (const item of staged) fingerprint.update(await fs.readFile(item.file));
  const designHash = fingerprint.digest("hex");
  const directory = path.join(layersRoot(stateDir), designHash);
  const { layerPath, tracks } = await buildStreamLayerAwc(
    { gameRoot, archive, bank, staged, directory },
    stateDir,
    kit,
  );
  const manifest = buildSoundManifest({
    archive,
    bank,
    streams,
    designHash,
    size: (await fs.stat(layerPath)).size,
    sha256: await sha256File(layerPath),
  });
  return { directory, manifest, streams, tracks, designHash };
}

/**
 * Слой дорожек одного банка в `directory/payload/<банк>.awc`.
 *
 * `staged` — дорожки и WAV под них (`{stream, file}`), отсортированные по
 * дорожке; `base` — банк из чистой основы, а не из игры (см. `bankCache`).
 * Собранное перечитывается до любой установки — см. `buildLayer`.
 */
/*
 * Проверка собранного слоя: те же дорожки, версия банка, число сэмплов каждой
 * и для PCM — WAV байт в байт. Общая для сборки по XML и на Rust.
 */
async function checkStreamLayer(layerFile, { streams, byStream, resource, kit, gameRoot }) {
  const check = await kit.inspect({
    input: layerFile,
    gameRoot,
    edition: "Legacy",
  });
  const checkResource = check?.resource || {};
  const actual = (checkResource.streams || [])
    .map((stream) => normalizeStreamId(stream.hash || stream.name))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(streams))
    throw new Error("Собранный слой потерял дорожки — установка отменена.");
  if (Number(checkResource.version) !== Number(resource.version))
    throw new Error("Версия собранного слоя разошлась с банком.");
  const builtById = new Map(
    (checkResource.streams || []).map((stream) => [
      normalizeStreamId(stream.hash || stream.name),
      stream,
    ]),
  );
  for (const stream of streams) {
    const built = builtById.get(stream);
    const wav = await fs.readFile(byStream.get(stream));
    const expectedSamples = parseWavHeader(wav).dataBytes / 2;
    if (!built || Number(built.samples) !== expectedSamples)
      throw new Error(
        `Дорожка ${stream}: в собранном слое ${built?.samples ?? "?"} сэмплов вместо ${expectedSamples} — установка отменена.`,
      );
    // PCM сходится байт-в-байт; ADPCM перекодируется с потерями, его
    // держит равенство сэмплов выше и SNR живого прогона.
    const codec = String(built.codec || "").toUpperCase();
    if (codec === "ADPCM") continue;
    const digest = createHash("sha256").update(wav).digest("hex");
    if (String(built.payloadSha256 || "").toLowerCase() !== digest)
      throw new Error(
        `Дорожка ${stream} собралась не байт-в-байт — установка отменена.`,
      );
  }
}

const CHUNK_NAMES = new Map([
  [0x55, "data"],
  [0xfa, "format"],
  [0x36, "peak"],
]);

/*
 * Слой импорта на Rust без XML: шаблоны потоков — из описи банка движка
 * (`read-awc`), слой — `awc-layer-from-wav`; проверка та же, что у XML-пути.
 * Нет движка, банк зашифрован или многоканальный, чужой чанк, WAV не PCM,
 * проверка не сошлась — `null`: слой собирает хост по XML, как раньше.
 */
async function buildStreamLayerOnEngine(
  { bank, cache, staged, streams, views, resource, directory, kit, gameRoot, keepHeadroom },
) {
  if (!kit.readAwc || !kit.layerFromWav) return null;
  const base = await kit.readAwc({ input: cache.awcPath });
  const info = base?.bank;
  if (!info || info.encrypted || info.multiChannel) return null;
  const baseStreams = new Map((info.streams || []).map((item) => [item.id, item]));
  const byStream = new Map(staged.map((item) => [item.stream, item.file]));
  const entries = [];
  const tracks = [];
  const loops = new Map();
  for (const stream of streams) {
    const view = views.get(stream);
    if (view && !view.replaceable) return null;
    const baseStream = baseStreams.get(Number.parseInt(String(stream).replace(/^0x/i, ""), 16));
    if (!baseStream?.format) return null;
    const chunks = baseStream.chunks.map((chunk) => CHUNK_NAMES.get(chunk.type));
    if (chunks.some((name) => !name)) return null;
    const codec = { 0: "PCM", 4: "ADPCM" }[baseStream.format.codec];
    if (!codec) return null;
    const header = parseWavHeader(await fs.readFile(byStream.get(stream)));
    const count = header.dataBytes / 2;
    const original = baseStream.format.loopPoint;
    const looped = original >= 0;
    const wanted = staged.find((item) => item.stream === stream)?.loopStart;
    if (looped && Number.isInteger(wanted)) loops.set(stream, wanted);
    const point = loops.has(stream) ? loops.get(stream) : original;
    tracks.push({
      stream,
      seconds: header.seconds,
      originalSeconds: view?.seconds ?? null,
      loopTrimmed: Boolean(view?.loop) && count < (view?.samples || 0),
      loop: looped,
      loopPoint: looped ? (point < count ? point : 0) : null,
    });
    const retimed = retimeFormat(baseStream.format, count, loops.get(stream) ?? null);
    entries.push({
      wav: byStream.get(stream),
      template: {
        id: baseStream.id,
        chunks,
        codec,
        samples: retimed.samples,
        loopPoint: retimed.loopPoint,
        playBegin: retimed.playBegin,
        playEnd: retimed.playEnd,
        loopBegin: retimed.loopBegin,
        loopEnd: retimed.loopEnd,
        headroom: keepHeadroom ? baseStream.format.headroom : 0,
        peakUnk: baseStream.format.peak ? 0 : null,
      },
    });
  }
  const payloadDirectory = path.join(directory, "payload");
  const layerPath = path.join(payloadDirectory, `${bank}.awc`);
  const ready = await fs.stat(layerPath).catch(() => null);
  if (!ready?.isFile()) {
    const work = path.join(directory, `.stage-${randomUUID()}`);
    await fs.mkdir(work, { recursive: true });
    try {
      const request = path.join(work, "layer.json");
      await fs.writeFile(
        request,
        JSON.stringify({
          version: info.version,
          chunkIndices: (info.flags & 1) === 1,
          streams: entries,
        }),
      );
      const built = path.join(work, `${bank}.awc`);
      const made = await kit.layerFromWav({ request, output: built });
      if (!made) return null;
      try {
        await checkStreamLayer(built, { streams, byStream, resource, kit, gameRoot });
      } catch {
        return null;
      }
      await fs.mkdir(payloadDirectory, { recursive: true });
      await fs.rename(built, layerPath);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  }
  return { layerPath, tracks, views };
}

/*
 * Запас дорожки (`Headroom`): игра вычитает его из громкости. Своя дорожка пишется с запасом 0 — в игре она
 * звучит так, как человек слышал её в превью (с запасом заменённой дорожки игры была бы на −h дБ: у оружейных
 * дорожек RESIDENT на 2 дБ громче, у тихих слоёв до 29,5 дБ тише). `keepHeadroom` — оставить запас дорожки
 * игры: звуку попадания, чей уровень подобран под удар игры без учёта запаса с обеих сторон.
 */
async function buildStreamLayerAwc(
  { gameRoot, archive, bank, entry, base = null, staged, directory, keepHeadroom = false },
  stateDir,
  kit,
) {
  const streams = staged.map((item) => item.stream);
  const cache = await bankCache(
    { gameRoot, archive, bank, entry, base },
    stateDir,
    kit,
  );
  const resource = cache.inspection?.resource || {};
  if (resource.multiChannelFlag)
    throw new Error("Многоканальный банк доступен только для чтения.");
  const views = new Map(
    (resource.streams || []).map(streamView).map((view) => [view.hash, view]),
  );
  const onEngine = await buildStreamLayerOnEngine({
    bank,
    cache,
    staged,
    streams,
    views,
    resource,
    directory,
    kit,
    gameRoot,
    keepHeadroom,
  });
  if (onEngine) return onEngine;
  const { xml } = await bankXml(cache, gameRoot, kit);
  const known = new Set(listXmlStreams(xml).map((item) => item.stream));
  const byStream = new Map(staged.map((item) => [item.stream, item.file]));
  const samples = new Map();
  const loops = new Map();
  const tracks = [];
  for (const stream of streams) {
    if (!known.has(stream))
      throw new Error(`В банке ${bank} нет дорожки ${stream}.`);
    const view = views.get(stream);
    if (view && !view.replaceable)
      throw new Error(`Дорожка ${stream}: ${view.reason}`);
    const header = parseWavHeader(await fs.readFile(byStream.get(stream)));
    const count = header.dataBytes / 2;
    samples.set(stream, count);
    /* Петля игры — по LoopPoint из XML банка, а не по LoopEnd описи: у
       PCM-дорожек тот всегда ноль (задача 6). */
    const original = xmlLoopPoint(xml, stream);
    const looped = original !== null && original >= 0;
    const wanted = staged.find((item) => item.stream === stream)?.loopStart;
    if (looped && Number.isInteger(wanted)) loops.set(stream, wanted);
    /* С какого сэмпла петля пойдёт в игре — как перепишет заголовок. */
    const point = loops.has(stream) ? loops.get(stream) : original;
    tracks.push({
      stream,
      seconds: header.seconds,
      originalSeconds: view?.seconds ?? null,
      loopTrimmed:
        Boolean(view?.loop) && header.dataBytes / 2 < (view?.samples || 0),
      loop: looped,
      loopPoint: looped ? (point < count ? point : 0) : null,
    });
  }
  const layerXml = buildLayerXml(xml, streams, {
    samples,
    loops,
    headroom: keepHeadroom ? null : 0,
  });
  const assets = layerAssetNames(xml, streams);

  const payloadDirectory = path.join(directory, "payload");
  const layerPath = path.join(payloadDirectory, `${bank}.awc`);
  const ready = await fs.stat(layerPath).catch(() => null);
  if (!ready?.isFile()) {
    const work = path.join(directory, `.stage-${randomUUID()}`);
    const assetsDirectory = path.join(work, "assets");
    await fs.mkdir(assetsDirectory, { recursive: true });
    try {
      const xmlPath = path.join(work, "layer.xml");
      await fs.writeFile(xmlPath, layerXml);
      for (const asset of assets)
        await fs.copyFile(
          byStream.get(asset.stream),
          path.join(assetsDirectory, asset.fileName),
        );
      const built = path.join(work, `${bank}.awc`);
      await kit.fromXml({
        input: xmlPath,
        output: built,
        assetsDirectory,
        gameRoot,
        edition: "Legacy",
      });
      await checkStreamLayer(built, { streams, byStream, resource, kit, gameRoot });
      await fs.mkdir(payloadDirectory, { recursive: true });
      await fs.rename(built, layerPath);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  }
  return { layerPath, tracks, views };
}

/*
 * Стерео-пара сессии для банка целиком. Оба канала обязательны и равны по
 * длине и частоте — многоканальный контейнер хранит каналы блоками
 * вперемешку, и канал другой длины там просто не уложится.
 */
async function sessionChannels(stateDir, session) {
  const directory = path.join(sessionsRoot(stateDir), session);
  const files = await fs.readdir(directory).catch(() => null);
  if (!files) throw new Error("Сессия звука не открыта.");
  const pair = {};
  for (const channel of ["left", "right"]) {
    const file = path.join(directory, `${channel}.wav`);
    if (!files.includes(`${channel}.wav`))
      throw new Error("В сессии нет стерео-пары каналов для банка.");
    pair[channel] = { file, header: parseWavHeader(await fs.readFile(file)) };
  }
  if (
    pair.left.header.dataBytes !== pair.right.header.dataBytes ||
    pair.left.header.sampleRate !== pair.right.header.sampleRate
  )
    throw new Error("Каналы стерео-пары разной длины или частоты.");
  return pair;
}

const seconds = (value) =>
  `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`;

/**
 * Банк целиком: XML многоканального контейнера с новой длиной каналов,
 * левый канал под чётные каналы, правый под нечётные (у музыки и песен их
 * ровно два), сборка helper'ом и перечитка — число каналов, число сэмплов
 * каждого, версия и флаг многоканальности обязаны сойтись. На радио длина
 * песни фиксирована: расписание станции и метки диджея считают её родной.
 */
async function buildBankLayer(
  { gameRoot, archive, bank, session },
  stateDir,
  kit,
) {
  const pair = await sessionChannels(stateDir, session);
  const frames = pair.left.header.dataBytes / 2;
  const cache = await bankCache({ gameRoot, archive, bank }, stateDir, kit);
  const view = bankView(archive, bank, cache.inspection);
  if (view.kind !== "bank")
    throw new Error("Этот банк не многоканальный — замените дорожки по одной.");
  if (view.readOnly) throw new Error(view.reason);
  if (pair.left.header.sampleRate !== view.sampleRate)
    throw new Error(
      `Частота ${pair.left.header.sampleRate} Гц не совпадает с банком (${view.sampleRate} Гц).`,
    );
  if (view.fixedLength && frames !== view.samples)
    throw new Error(
      `На радио длина трека фиксирована: ${seconds(view.seconds)} (${view.samples} сэмплов), а в сессии ${frames}.`,
    );
  const { xml } = await bankXml(cache, gameRoot, kit);
  const channels = listXmlStreams(xml).filter((item) => item.fileName);
  if (!channels.length) throw new Error("В банке нет ни одного канала.");
  const samples = new Map(channels.map((item) => [item.stream, frames]));
  const layerXml = buildBankXml(xml, { samples });

  const fingerprint = createHash("sha256");
  fingerprint.update(JSON.stringify({ archive, bank, kind: "bank" }));
  fingerprint.update(await fs.readFile(pair.left.file));
  fingerprint.update(await fs.readFile(pair.right.file));
  const designHash = fingerprint.digest("hex");

  const directory = path.join(layersRoot(stateDir), designHash);
  const payloadDirectory = path.join(directory, "payload");
  const layerPath = path.join(payloadDirectory, `${bank}.awc`);
  const ready = await fs.stat(layerPath).catch(() => null);
  let streams = null;
  if (!ready?.isFile()) {
    const work = path.join(directory, `.stage-${randomUUID()}`);
    const assetsDirectory = path.join(work, "assets");
    await fs.mkdir(assetsDirectory, { recursive: true });
    try {
      const xmlPath = path.join(work, "layer.xml");
      await fs.writeFile(xmlPath, layerXml);
      for (const [index, channel] of channels.entries())
        await fs.copyFile(
          index % 2 === 0 ? pair.left.file : pair.right.file,
          path.join(assetsDirectory, channel.fileName),
        );
      const built = path.join(work, `${bank}.awc`);
      await kit.fromXml({
        input: xmlPath,
        output: built,
        assetsDirectory,
        gameRoot,
        edition: "Legacy",
      });
      const check = await kit.inspect({
        input: built,
        gameRoot,
        edition: "Legacy",
      });
      const checkResource = check?.resource || {};
      const builtView = bankView(archive, bank, check);
      if (!checkResource.multiChannelFlag)
        throw new Error(
          "Собранный банк потерял многоканальность — установка отменена.",
        );
      if (builtView.channels !== channels.length)
        throw new Error("Собранный банк потерял каналы — установка отменена.");
      if (Number(checkResource.version) !== view.version)
        throw new Error("Версия собранного банка разошлась с оригиналом.");
      for (const channel of builtView.streams)
        if (channel.hash !== "0X00000000" && channel.samples !== frames)
          throw new Error(
            `Канал ${channel.hash}: в собранном банке ${channel.samples} сэмплов вместо ${frames} — установка отменена.`,
          );
      streams = builtView.streams.map((item) => item.hash).sort();
      await fs.mkdir(payloadDirectory, { recursive: true });
      await fs.rename(built, layerPath);
      await fs.writeFile(
        path.join(directory, "streams.json"),
        `${JSON.stringify(streams)}\n`,
      );
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  }
  if (!streams)
    streams = JSON.parse(
      await fs.readFile(path.join(directory, "streams.json"), "utf8"),
    );
  const manifest = buildSoundManifest({
    archive,
    bank,
    streams,
    designHash,
    size: (await fs.stat(layerPath)).size,
    sha256: await sha256File(layerPath),
    completeBank: true,
  });
  return {
    directory,
    manifest,
    streams,
    tracks: [
      {
        stream: "0X00000000",
        seconds: frames / view.sampleRate,
        originalSeconds: view.seconds,
        channels: channels.length,
        fixedLength: view.fixedLength,
        loopTrimmed: false,
      },
    ],
    designHash,
  };
}

const manifestHashOf = (manifest) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex")}`;

const engineOptions = (layer, input, stateDir, kit, extra = {}) => ({
  manifest: layer.manifest,
  packageRoot: layer.directory,
  gameRoot: requireGameRoot(input),
  targetId: String(input?.targetId || "default"),
  edition: "Legacy",
  stateDir,
  awcMaterializer: kit.awcMaterializer,
  audioRelMaterializer: kit.audioRelMaterializer,
  audioChunkMaterializer: kit.audioChunkMaterializer,
  rpfComposer: kit.rpfComposer,
  rpfProbe: kit.rpfProbe,
  contentXmlProvider: kit.contentXmlProvider,
  dlcListProvider: kit.dlcListProvider,
  ...extra,
});

/* Слой метаданных звукового пакета Astral (`astral-audio-chunk-v1`): объекты
   dat54/dat151, которые установщик сложит в файл пакета. */
const audioChunkPayload = (entry, type, objects, names, owner = {}) => ({
  format: "astral-audio-chunk",
  version: 1,
  entry,
  type,
  ...owner,
  names,
  objects: objects.map((object) => ({
    hash: hexHash(object.hash),
    bytes: Buffer.from(object.bytes).toString("base64"),
    links: object.links,
    packs: object.packs,
  })),
});

/**
 * План: что заменится, с кем пересекаемся по потокам и что предлагаем
 * заменить. Пересечения считаются здесь, а не ловятся ошибкой из глубины
 * композитора: пакет-витрина с полным банком держит все дорожки сразу.
 */
async function planSoundCustomizationImpl(
  input,
  _context,
  stateDir,
  tools = {},
) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const { archive, bank } = requireBank(input);
  const session = requireSession(input);
  const kind = await resolveBankKind(
    { gameRoot, archive, bank },
    stateDir,
    kit,
  );
  const layer = await (kind === "bank" ? buildBankLayer : buildLayer)(
    { gameRoot, archive, bank, session },
    stateDir,
    kit,
  );
  const profile = await kit.profile({ stateDir });
  const installed =
    profile?.targets?.[String(input?.targetId || "default")]?.installed || [];
  const conflicts = soundStreamConflicts(installed, {
    target: archive,
    entry: `${bank}.awc`,
    streams: layer.streams,
  });
  const plan = await kit.plan(engineOptions(layer, input, stateDir, kit));
  const replaceModIds = [
    ...new Set([
      ...(plan.conflicts || []).map((item) => item.modId),
      ...conflicts.map((item) => item.modId),
    ]),
  ].sort();
  return {
    modId: layer.manifest.id,
    kind,
    manifestHash: manifestHashOf(layer.manifest),
    designHash: `sha256:${layer.designHash}`,
    bank,
    archive,
    streams: layer.streams,
    tracks: layer.tracks,
    streamConflicts: conflicts,
    replaceModIds,
    rightsNotice:
      "Устанавливая звук, вы подтверждаете права на использование этой записи.",
    edition: "Legacy",
  };
}
export const planSoundCustomization = guarded(planSoundCustomizationImpl);

/** Применение: та же сборка, строгий манифест и общий движок установки. */
async function applySoundCustomizationImpl(
  input,
  _context,
  stateDir,
  tools = {},
) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const { archive, bank } = requireBank(input);
  const session = requireSession(input);
  await kit.assertRuntimeSafety?.(gameRoot);
  const kind = await resolveBankKind(
    { gameRoot, archive, bank },
    stateDir,
    kit,
  );
  const layer = await (kind === "bank" ? buildBankLayer : buildLayer)(
    { gameRoot, archive, bank, session },
    stateDir,
    kit,
  );
  if (manifestHashOf(layer.manifest) !== String(input?.expectedManifestHash))
    throw new Error("План установки звука устарел.");
  const profile = await kit.profile({ stateDir });
  const installed =
    profile?.targets?.[String(input?.targetId || "default")]?.installed || [];
  const conflicts = soundStreamConflicts(installed, {
    target: archive,
    entry: `${bank}.awc`,
    streams: layer.streams,
  });
  const plan = await kit.plan(engineOptions(layer, input, stateDir, kit));
  const replaceModIds = [
    ...new Set([
      ...(plan.conflicts || []).map((item) => item.modId),
      ...conflicts.map((item) => item.modId),
    ]),
  ].sort();
  const installedResult = await kit.install(
    engineOptions(layer, input, stateDir, kit, { replaceModIds }),
  );
  return {
    ...installedResult,
    installId: layer.manifest.id,
    modId: layer.manifest.id,
    kind: "local-sound-layer",
    status: "active",
    bank,
    archive,
    streams: layer.streams,
    gameRoot,
    targetId: String(input?.targetId || "default"),
    installedAt: new Date().toISOString(),
  };
}
export const applySoundCustomization = guarded(applySoundCustomizationImpl);

/** Снятие слоя. Движок соберёт банк заново из оставшихся слоёв. */
export async function removeSoundCustomization(
  input,
  _context,
  stateDir,
  tools = {},
) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await kit.assertRuntimeSafety?.(gameRoot);
  const modId = String(input?.modId || "");
  if (!MOD_ID.test(modId)) throw new Error("Некорректный local sound modId.");
  const result = await kit.uninstall({
    modId,
    targetId: String(input?.targetId || "default"),
    stateDir,
    awcMaterializer: kit.awcMaterializer,
    audioRelMaterializer: kit.audioRelMaterializer,
    audioChunkMaterializer: kit.audioChunkMaterializer,
    rpfComposer: kit.rpfComposer,
    contentXmlProvider: kit.contentXmlProvider,
    dlcListProvider: kit.dlcListProvider,
  });
  return {
    ...result,
    installId: modId,
    modId,
    kind: "local-sound-layer",
    status: "rolled-back",
    gameRoot,
    targetId: String(input?.targetId || "default"),
  };
}

/** Установленные работы студии — по префиксу их manifest id. */
export async function listSoundWorks(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const profile = await kit.profile({ stateDir });
  const target = profile?.targets?.[String(input?.targetId || "default")];
  /*
   * Работы студии — и только они: готовые наборы живут своей панелью, и
   * показывать их здесь значило бы дать снять набор кнопкой слоя.
   *
   * Заодно у каждой работы появляется человеческое имя: список из строк
   * `local-sound-lmg-combat-9f2c…` не отвечает на единственный вопрос, ради
   * которого его открывают, — «что я поставил».
   *
   * `formats` — какими способами этот главный процесс ставит звук ствола и
   * попадания: окно обновляется на лету, а главный процесс — только с
   * перезапуском, и окно не переставляет звуки, пока они разные.
   */
  return {
    formats: {
      weapon: WEAPON_FORMAT_VERSION,
      /* Способ «Без своих выстрелов»: окно, обновившееся без перезапуска, этого ключа у прежнего главного процесса не найдёт и тишину не поставит. */
      weaponMute: WEAPON_MUTE_FORMAT,
      hits: HITS_FORMAT_VERSION,
      mix: SOUND_MIX_FORMAT,
    },
    works: (target?.installed || [])
      .filter(
        (item) =>
          String(item.modId || "").startsWith("local-sound-") &&
          !PACK_MOD_ID.test(String(item.modId || "")),
      )
      .map((item) => {
        /* Звук попадания — работа из двух частей, а не банк: её имя —
           части, которые в ней стоят. */
        if (HITS_MOD_ID.test(String(item.modId || ""))) {
          /* Запись движка о моде манифеста не держит: дорожки слоя — в
             слоях самого банка collision. */
          const layer = target?.archives?.[HIT_SOUND_ARCHIVE]?.entries?.[
            `${HIT_SOUND_BANK}.awc`
          ]?.layers?.find((entry) => entry.modId === item.modId);
          const parts = hitPartsOfManifest(
            item.manifest ||
              (layer ? { files: [{ merge: layer.merge }] } : null),
          );
          /* Прежний звук попадания правил update.rpf и тонул в штатном
             ударе: «Применить» переставит его в звуковой пакет. */
          const legacy = !(item.archiveEntries || []).some(
            (entry) => entry?.target === AUDIO_DLC_TARGET,
          );
          return {
            ...item,
            kind: "hits",
            parts,
            ...(legacy ? { legacy: true } : {}),
            title: hitSoundsTitle(parts),
          };
        }
        /* «Окружение» — громкость категорий звука, не банк. */
        if (MIX_MOD_ID.test(String(item.modId || "")))
          return { ...item, kind: "mix", title: SOUND_MIX_TITLE };
        /* Звук ствола — по слоту, а не по банку: у ствола их несколько.
           Прежний (на семью стволов) помечен: «Применить» переставит его
           только на свой ствол. */
        const weapon = weaponOfManifest(item);
        if (weapon)
          return {
            ...item,
            kind: "weapon",
            weapon: weapon.id,
            ...(weapon.legacy ? { legacy: true } : {}),
            ...(weapon.mute ? { mute: true } : {}),
            title: weapon.mute ? `Без своих выстрелов: ${weapon.title}` : `Свой звук: ${weapon.title}`,
          };
        const entry = (item.archiveEntries || [])[0];
        const bank = String(entry?.entry || "").replace(/\.awc$/i, "");
        const described = bank ? describeBank(bank, entry?.target) : null;
        return {
          ...item,
          ...(bank ? { bank, archive: entry.target } : {}),
          ...(described ? { title: described.title } : {}),
        };
      }),
  };
}

/* ============================================================================
 * Звук попадания: голова и тело.
 *
 * Окно рендерит звук человека в частоту дорожки-носителя и кладёт WAV в
 * сессию — под дорожкой головы или тела. Всё остальное решает главный
 * процесс и больше никто: какие дорожки освобождаются и становятся тишиной,
 * как переопределяется удар (`@modovik/sound-studio/hit-voice-plan`), влезает
 * ли звук в банк. Окну здесь доверяется только звук.
 *
 * Пакет — один мод из двух файлов: слой дорожек `RESIDENT.rpf/collision.awc`
 * и слой метаданных звукового пакета Astral (`astral_audio_sounds.dat54.rel`),
 * где удар по голове и телу переопределён целиком: звучит только звук
 * человека, без затухания в пределах 25 м. Файлы ставятся и снимаются одной
 * транзакцией: дорожки без метаданных оставили бы хвост тела беззвучным,
 * метаданные без дорожек — удар со штатной плотью вместо звука человека.
 *
 * До 26.09.2026 (вечер) дерево правилось ссылками в update.rpf, и свой звук
 * тонул в штатном ударе («звуков попадания не было»). Поставленное так
 * снимается той же установкой: слот `sound-hits` один.
 * ========================================================================== */

const HITS_MOD_ID = /^local-sound-hits-[a-f0-9]{12}$/;
const HITS_FORMAT_VERSION = HIT_SOUND_FORMAT;
const hitsRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "sound-studio", "hits");

function requireHitParts(input) {
  const asked = new Set(
    (Array.isArray(input?.parts) ? input.parts : []).map((part) =>
      String(part || ""),
    ),
  );
  if (!asked.size || [...asked].some((part) => !HIT_SOUND_PARTS[part]))
    throw new Error("Выберите голову, тело или обе части.");
  return HIT_SOUND_PART_IDS.filter((part) => asked.has(part));
}

/* Какие части стоят в установленном моде — по дорожкам его слоя. */
function hitPartsOfManifest(manifest) {
  const streams = new Set(
    (manifest?.files?.[0]?.merge?.streams || []).map((stream) =>
      normalizeStreamId(stream),
    ),
  );
  return HIT_SOUND_PART_IDS.filter((part) =>
    streams.has(HIT_SOUND_PARTS[part].carrier),
  );
}

function hitSoundsTitle(parts) {
  if (parts.length === 2) return "Звуки попадания: голова и тело";
  if (parts[0] === "head") return "Звук попадания в голову";
  if (parts[0] === "body") return "Звук попадания в тело";
  return "Звуки попадания";
}

/*
 * Банк collision — из чистой основы, а не из игры: в игре он может уже нести
 * прежний звук попадания, где освобождённые дорожки стали тишиной, и место по
 * нему вышло бы втрое меньше настоящего (0,31 с вместо 0,88 — 26.09.2026).
 * Слой движок тоже кладёт на основу, так что и собирается он по ней.
 */
async function hitBankBase(gameRoot, stateDir) {
  const basePath = await vanillaArchive(stateDir, gameRoot, HIT_SOUND_ARCHIVE);
  const stat = await fs.stat(basePath);
  return {
    path: basePath,
    key: createHash("sha256")
      .update(
        JSON.stringify([
          path.resolve(basePath).toLowerCase(),
          stat.size,
          Math.round(stat.mtimeMs),
        ]),
      )
      .digest("hex")
      .slice(0, 16),
  };
}

/*
 * Банк collision с описью слота: таблицей дорожек и служебными чанками. Опись,
 * снятая прежним helper'ом, этих чисел не несёт — она снимается заново; а
 * helper, который их не называет, старше приложения, и это говорится словами.
 */
async function hitBankCache(gameRoot, stateDir, kit, base = null) {
  const bankBase = base || (await hitBankBase(gameRoot, stateDir));
  const read = (refresh) =>
    bankCache(
      { gameRoot, archive: HIT_SOUND_ARCHIVE, bank: HIT_SOUND_BANK, base: bankBase },
      stateDir,
      kit,
      { refresh },
    );
  const cache = await read(false);
  if (Number.isFinite(Number(cache.inspection?.resource?.metadataBytes))) return cache;
  await kit.helperFeatures([AWC_SLOT_BUDGET_FEATURE]);
  return read(true);
}

/**
 * Сколько звука примет каждая часть и в какой частоте его рендерить.
 * Считается по банку игрока с запасом на обе части сразу — предел не должен
 * меняться от того, поставлена ли вторая.
 */
async function readHitSoundBudgetImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const cache = await hitBankCache(gameRoot, stateDir, kit);
  const plan = hitSoundBankPlan(HIT_SOUND_PART_IDS, cache.inspection?.resource || {}, {
    spare: HIT_SOUND_SPARE_WAVES,
  });
  return {
    archive: HIT_SOUND_ARCHIVE,
    bank: HIT_SOUND_BANK,
    parts: Object.fromEntries(
      plan.carriers.map((carrier) => [
        carrier.part,
        {
          stream: carrier.stream,
          sampleRate: carrier.sampleRate,
          maxSamples: carrier.maxSamples,
          maxSeconds: carrier.maxSamples / carrier.sampleRate,
        },
      ]),
    ),
  };
}
export const readHitSoundBudget = guarded(readHitSoundBudgetImpl);

/* Тишина на месте освобождённой дорожки: настоящий WAV в её частоте. */
function silentWav(sampleRate) {
  const data = Buffer.alloc(HIT_SOUND_SILENCE_SAMPLES * 2);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

/**
 * Пакет звука попадания: слой дорожек и переопределение удара — из сессии
 * окна и метаданных игры игрока.
 *
 * В сессии обязаны лежать ровно дорожки-носители выбранных частей, в их
 * частоте и не длиннее предела. Тишину на месте освобождённых дорожек
 * главный процесс кладёт сам. Переопределение собирается по метаданным
 * игры (`HIT_SOUND_SOURCES`) до записи: игра другой сборки получает отказ, а
 * не удар, который ведёт мимо.
 */
async function buildHitPackage({ gameRoot, session, parts }, stateDir, kit) {
  const base = await hitBankBase(gameRoot, stateDir);
  const cache = await hitBankCache(gameRoot, stateDir, kit, base);
  const plan = hitSoundBankPlan(parts, cache.inspection?.resource || {}, {
    spare: HIT_SOUND_SPARE_WAVES,
  });
  const staged = await sessionStreams(stateDir, session);
  const wanted = new Set(plan.carriers.map((carrier) => carrier.stream));
  if (
    staged.length !== wanted.size ||
    staged.some((item) => !wanted.has(item.stream))
  )
    throw new Error(
      "В сессии не те дорожки: звук попадания принимает только звук головы и тела.",
    );
  const tracks = [];
  for (const carrier of plan.carriers) {
    const item = staged.find((entry) => entry.stream === carrier.stream);
    const header = parseWavHeader(await fs.readFile(item.file));
    if (header.sampleRate !== carrier.sampleRate)
      throw new Error(
        `Звук части «${HIT_SOUND_PARTS[carrier.part].title}» в частоте ${header.sampleRate} Гц, а дорожка игры — ${carrier.sampleRate} Гц.`,
      );
    const samples = header.dataBytes / 2;
    if (samples > carrier.maxSamples)
      throw new Error(
        `Звук части «${HIT_SOUND_PARTS[carrier.part].title}» длиннее ${(carrier.maxSamples / carrier.sampleRate).toFixed(1).replace(".", ",")} с — столько игра не вместит.`,
      );
    tracks.push({ part: carrier.part, stream: carrier.stream, samples });
  }
  /* Слот COLLISION занят штатным банком до байта: пикам звука длиннее 8192
     сэмплов место есть только на месте запасных (мёртвых) дорожек. План
     называет их до сборки — ровно столько, сколько нужно. */
  const layout = hitSoundBankLayout(
    plan,
    Object.fromEntries(tracks.map((track) => [track.part, track.samples])),
  );

  /* Удар — по игре без Astral: основа движка, а если она несёт прежний
     звук попадания (перебазирование до 27.09.2026 уносило его туда) —
     защищённая копия update.rpf. План по основе с прежней правкой вышел бы
     без переопределений, нужных штатной игре. */
  let merged = mergeAudioChunks(
    await readAudioChunks({ gameRoot, sources: HIT_SOUND_SOURCES }, stateDir, kit),
  );
  if (hitBaseCarriesAstral(merged)) {
    const pristine = await protectedUpdateCopy(stateDir, gameRoot);
    if (pristine)
      merged = mergeAudioChunks(
        await readAudioChunks(
          {
            gameRoot,
            sources: HIT_SOUND_SOURCES,
            from: { "update/update.rpf": pristine },
          },
          stateDir,
          kit,
        ),
      );
    if (hitBaseCarriesAstral(merged))
      throw new Error(
        "Основа игры в кэше Astral несёт прежний звук попадания, а чистой копии update.rpf нет — проверьте файлы игры в Steam и нажмите «Применить» снова.",
      );
  }
  /* Громкость удара — вместе с категориями звука игры: без них слой
     человека выходил тише удара игры (`hit-voice-plan.js`). */
  const [categoriesChunk] = await readAudioChunks(
    { gameRoot, sources: { chunks: [SOUND_CATEGORIES_SOURCE] } },
    stateDir,
    kit,
  );
  const routing = planHitOverride(merged, parts, {
    categories: readSoundCategories(categoriesChunk.buffer),
  });

  const fingerprint = createHash("sha256");
  fingerprint.update(
    JSON.stringify({
      format: HITS_FORMAT_VERSION,
      parts,
      streams: [...wanted],
      drop: layout.drop,
      objects: routing.objects.map((item) => [
        hexHash(item.hash),
        item.bytes.toString("hex"),
      ]),
    }),
  );
  for (const item of staged) fingerprint.update(await fs.readFile(item.file));
  const designHash = fingerprint.digest("hex");
  const directory = path.join(hitsRoot(stateDir), designHash);

  /* Тишина — в папку самого пакета: сборка перечитывает её байт в байт. */
  const silenceDirectory = path.join(directory, "silence");
  await fs.mkdir(silenceDirectory, { recursive: true });
  const silence = [];
  for (const item of plan.silence) {
    if (!item.sampleRate)
      throw new Error(`У дорожки ${item.stream} нет частоты.`);
    const file = path.join(silenceDirectory, `${item.stream}.wav`);
    await fs.writeFile(file, silentWav(item.sampleRate));
    silence.push({ stream: item.stream, file });
  }
  const layerStaged = [...staged, ...silence].sort((left, right) =>
    left.stream.localeCompare(right.stream),
  );
  const newBytes = [
    ...tracks.map((track) => track.samples * 2),
    ...silence.map(() => HIT_SOUND_SILENCE_SAMPLES * 2),
  ].reduce((sum, bytes) => sum + bytes, 0);
  if (newBytes > plan.budgetBytes)
    throw new Error(
      "Звуки головы и тела вместе не помещаются в банк игры — сократите один из них.",
    );

  const { layerPath } = await buildStreamLayerAwc(
    {
      gameRoot,
      archive: HIT_SOUND_ARCHIVE,
      bank: HIT_SOUND_BANK,
      base,
      staged: layerStaged,
      directory,
      /* Уровень удара подобран под удар игры без учёта запаса с обеих сторон (у носителей −201). */
      keepHeadroom: true,
    },
    stateDir,
    kit,
  );
  const routingPath = path.join(directory, "payload", "astral_audio_sounds.json");
  await fs.writeFile(
    routingPath,
    `${JSON.stringify(
      audioChunkPayload(AUDIO_DLC_SOUNDS_ENTRY, 54, routing.objects, routing.names),
    )}\n`,
  );
  const streams = layerStaged.map((item) => item.stream);
  const digest = designHash.slice(0, 12);
  const manifest = {
    id: `local-sound-hits-${digest}`,
    version: `1.0.0-${digest}`,
    name: hitSoundsTitle(parts),
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    gameplayChanges: false,
    scope: "game-root",
    capabilities: [
      "awc-stream-layer-v1",
      "astral-audio-chunk-v1",
      "direct-audio-dlc-v1",
    ],
    slots: ["sound-hits"],
    files: [
      {
        source: "payload/collision.awc",
        target: HIT_SOUND_ARCHIVE,
        entry: `${HIT_SOUND_BANK}.awc`,
        action: "replace",
        size: (await fs.stat(layerPath)).size,
        sha256: await sha256File(layerPath),
        merge: {
          strategy: "awc-stream-layer-v1",
          bank: HIT_SOUND_BANK,
          streams,
          ...(layout.drop.length ? { drop: layout.drop } : {}),
        },
      },
      {
        source: "payload/astral_audio_sounds.json",
        target: AUDIO_DLC_TARGET,
        entry: AUDIO_DLC_SOUNDS_ENTRY,
        action: "replace",
        size: (await fs.stat(routingPath)).size,
        sha256: await sha256File(routingPath),
        merge: { strategy: "astral-audio-chunk-v1" },
      },
    ],
  };
  return {
    directory,
    manifest,
    streams,
    tracks,
    designHash,
    parts,
    levels: routing.levels,
    /* Слот COLLISION после установки: убранные запасные дорожки и то, чем
       банк займёт таблицу и служебные чанки. */
    slot: { drop: layout.drop, header: layout.header, metadata: layout.metadata },
  };
}

async function planHitSoundsWith(input, stateDir, kit) {
  const gameRoot = requireGameRoot(input);
  const session = requireSession(input);
  const parts = requireHitParts(input);
  const profile = await kit.profile({ stateDir });
  const installed =
    profile?.targets?.[String(input?.targetId || "default")]?.installed || [];
  const layer = await buildHitPackage({ gameRoot, session, parts }, stateDir, kit);
  const host = await kit.audioHost({ stateDir, gameRoot });
  /* Прежний звук попадания держит тот же слот и те же дорожки — он
     заменяется, а не спорит. Чужой слой на этих дорожках collision — тоже:
     его название уходит в план, окно говорит о нём прямо. */
  const conflicts = soundStreamConflicts(installed, {
    target: HIT_SOUND_ARCHIVE,
    entry: `${HIT_SOUND_BANK}.awc`,
    streams: [...layer.streams, ...layer.slot.drop],
  });
  const previous = installed
    .filter((item) => (item.slots || []).includes("sound-hits"))
    .map((item) => item.modId);
  const plan = await kit.plan(
    engineOptions(layer, input, stateDir, kit, { audioDlcHost: host }),
  );
  const replaceModIds = [
    ...new Set([
      ...(plan.conflicts || []).map((item) => item.modId),
      ...conflicts.map((item) => item.modId),
      ...previous,
    ]),
  ]
    .filter((modId) => modId !== layer.manifest.id)
    .sort();
  return { layer, replaceModIds, conflicts, host };
}

async function planHitSoundsImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const { layer, replaceModIds, conflicts } = await planHitSoundsWith(
    input,
    stateDir,
    kit,
  );
  return {
    modId: layer.manifest.id,
    kind: "hits",
    format: HITS_FORMAT_VERSION,
    manifestHash: manifestHashOf(layer.manifest),
    designHash: `sha256:${layer.designHash}`,
    parts: layer.parts,
    tracks: layer.tracks,
    levels: layer.levels,
    slot: layer.slot,
    streamConflicts: conflicts,
    replaceModIds,
    rightsNotice:
      "Устанавливая звук, вы подтверждаете права на использование этой записи.",
    edition: "Legacy",
  };
}
export const planHitSounds = guarded(planHitSoundsImpl);

async function applyHitSoundsImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await kit.assertRuntimeSafety?.(gameRoot);
  const { layer, replaceModIds, host } = await planHitSoundsWith(
    input,
    stateDir,
    kit,
  );
  if (manifestHashOf(layer.manifest) !== String(input?.expectedManifestHash))
    throw new Error("План установки звука попадания устарел.");
  const installedResult = await kit.install(
    engineOptions(layer, input, stateDir, kit, {
      replaceModIds,
      audioDlcHost: host,
    }),
  );
  return {
    ...installedResult,
    installId: layer.manifest.id,
    modId: layer.manifest.id,
    kind: "local-sound-hits",
    format: HITS_FORMAT_VERSION,
    status: "active",
    parts: layer.parts,
    gameRoot,
    targetId: String(input?.targetId || "default"),
    installedAt: new Date().toISOString(),
  };
}
export const applyHitSounds = guarded(applyHitSoundsImpl);

/* ============================================================================
 * Свой звук ствола — только этого ствола.
 *
 * До 26.09.2026 звук ставился семье: стволам с общими дорожками банка (АК,
 * булл-пап, улучшенная, марксманская), и звук «для АК» слышался у всех. Теперь
 * ствол получает свой голос переопределением в звуковом пакете Astral
 * (`@modovik/sound-studio/weapon-voice-plan`): строка игрока его предмета
 * звука ведёт на копию настроек, а та — на копии ветвей выстрела и на личный
 * банк ствола. В копиях звучит только голос ствола: слои игры, отзвук и
 * эхо после выстрела заглушены, тон дерева обнулён (26.09.2026, вечер:
 * «у снайперки слышно два звука», «на калаш звук не применился»), и свой
 * звук стоит во всех полях выстрела — с глушителем и в замедленной съёмке
 * тоже (27.09.2026). Файлы игры не меняются; соседи по банку, NPC и другие
 * игроки звучат как прежде; снятие — удаление переопределения.
 *
 * Окну доверяется только звук: по WAV на каждую дорожку голоса из таблицы, в
 * частоте дорожки игры и не длиннее её. Всё остальное решается здесь — по
 * метаданным игры игрока: какие ветви копировать, какие слои убрать, как
 * назвать новые дорожки. Одинаковые WAV (свой звук на дорожках одной длины
 * и канала) ложатся в банк одной дорожкой — банк ствола грузится в слот
 * оружия игрока, и место в нём дорого.
 * ========================================================================== */

const WEAPON_FORMAT_VERSION = WEAPON_SOUND_FORMAT;
const weaponsRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "sound-studio", "weapons");
const audioMetaRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "sound-studio", "audio-meta");

/* Слот оружия игрока (PLAYER_WEAPON в audioconfig.dat4.rel): банк ствола не
   больше его ни звуками, ни таблицей дорожек, ни служебными чанками —
   больший игра не дочитывает или копирует за край своих буферов. */
const PLAYER_WEAPON_SLOT = waveSlotOf("x64/audio/sfx/WEAPONS_PLAYER.rpf");

/* Ствол из окна: только ствол полки со своим голосом и снятыми источниками. */
function requireWeapon(input) {
  const weapon = WEAPON_SOUND_MAP[String(input?.weapon || "")];
  if (!weapon) throw new Error("Выберите ствол.");
  if (!weapon.voice.length || !WEAPON_VOICE_SOURCES[weapon.id])
    throw new Error(
      `У «${weapon.title}» нет своего голоса: его выстрел целиком собран из общих слоёв игры.`,
    );
  return weapon;
}

/* Ствол из окна для тишины: любой ствол полки со звуком выстрела — голос и банк не нужны (PDW и тазер тоже). */
function requireMuteWeapon(input) {
  const weapon = WEAPON_SOUND_MAP[String(input?.weapon || "")];
  if (!weapon?.audio) throw new Error("Выберите ствол.");
  return weapon;
}

/* Имя банка дорожки голоса, как его знает таблица имён звуков. */
function waveContainer(wave) {
  const folder = /x64\/audio\/sfx\/([a-z0-9_]+)\//i.exec(wave.entry);
  const pack = folder
    ? folder[1]
    : wave.archive.split("/").pop().replace(/\.rpf$/i, "");
  return bankHash(`${pack}\\${wave.bank}`);
}

/*
 * Архив игры без модов Astral. Если движок его пересобирал, в игре лежит
 * сборка с чужими звуками (или, как 26.09, с испорченным банком), а чистая
 * основа — в его кэше: голос ствола читается только оттуда.
 */
async function engineTargetOf(stateDir, gameRoot) {
  const state = await inspectProfile({ stateDir }).catch(() => null);
  const found = Object.entries(state?.targets || {}).find(
    ([, item]) =>
      path.resolve(String(item.gameRoot || "")).toLowerCase() ===
      path.resolve(gameRoot).toLowerCase(),
  );
  return found ? { key: found[0], target: found[1] } : null;
}

async function vanillaArchive(stateDir, gameRoot, archive) {
  const resource = (await engineTargetOf(stateDir, gameRoot))?.target?.resources?.[
    archive
  ];
  const base = resource?.layers?.length
    ? resource.compositionBase?.path || resource.base?.path
    : null;
  return base && (await ensureStoredFile(base)) ? base : archiveFile(gameRoot, archive);
}

/*
 * Копия update.rpf, снятая движком при первой подготовке, — игра до Astral
 * (`PROTECTED_UPDATE_COPY`). Нужна, когда основа в кэше движка несёт прежнюю
 * запись Astral: до 27.09.2026 перебазирование уносило их в основу.
 */
async function protectedUpdateCopy(stateDir, gameRoot) {
  const engine = await engineTargetOf(stateDir, gameRoot);
  if (!engine || !stateDir) return null;
  const file = path.join(stateDir, "bases", engine.key, PROTECTED_UPDATE_COPY);
  return (await ensureStoredFile(file).catch(() => false)) ? file : null;
}

/*
 * Файлы звуковых метаданных, по которым собирается переопределение ствола
 * или удара: база и пакеты дополнений в порядке загрузки. Извлекаются из
 * чистых архивов один раз и помнятся по отпечатку архива.
 */
async function readAudioChunks({ gameRoot, sources, from = {} }, stateDir, kit) {
  const chunks = [];
  const directory = path.join(audioMetaRoot(stateDir), gameKey(gameRoot));
  await fs.mkdir(directory, { recursive: true });
  for (const [archive, entry, rank] of sources.chunks) {
    const source = from[archive] || (await vanillaArchive(stateDir, gameRoot, archive));
    const stat = await fs.stat(source);
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          path.resolve(source).toLowerCase(),
          stat.size,
          Math.round(stat.mtimeMs),
          entry,
        ]),
      )
      .digest("hex");
    const file = path.join(directory, `${key}.rel`);
    if (!(await fs.stat(file).catch(() => null))) {
      const stage = `${file}.${randomUUID()}.stage`;
      try {
        await kit.extract({
          archivePath: source,
          archiveTarget: archive,
          entry,
          output: stage,
          gameRoot,
          edition: "Legacy",
        });
        await fs.rename(stage, file);
      } finally {
        await fs.rm(stage, { force: true }).catch(() => {});
      }
    }
    chunks.push({ name: `${archive}::${entry}`, rank, buffer: await fs.readFile(file) });
  }
  return chunks.sort((left, right) => left.rank - right.rank);
}

/*
 * Банк ствола из чистого архива: дорожки, которые переезжают в личный банк
 * как есть (перезарядка, выстрел с глушителем), и его XML-шапка.
 */
async function vanillaBankXml(bank, gameRoot, stateDir, kit) {
  const source = await vanillaArchive(stateDir, gameRoot, bank.archive);
  const stat = await fs.stat(source);
  const identity = createHash("sha256")
    .update(
      JSON.stringify([
        path.resolve(source).toLowerCase(),
        stat.size,
        Math.round(stat.mtimeMs),
        bank.entry,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  const directory = path.join(
    stateDir || os.tmpdir(),
    "sound-studio",
    "vanilla-banks",
    gameKey(gameRoot),
    `${bank.bank}-${identity}`,
  );
  const awcPath = path.join(directory, "bank.awc");
  const inspectionPath = path.join(directory, "inspect.json");
  let inspection = await fs
    .readFile(inspectionPath, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  if (!inspection) {
    await fs.mkdir(directory, { recursive: true });
    await kit.extract({
      archivePath: source,
      archiveTarget: bank.archive,
      entry: bank.entry,
      output: awcPath,
      gameRoot,
      edition: "Legacy",
    });
    inspection = await kit.inspect({ input: awcPath, gameRoot, edition: "Legacy" });
    await fs.writeFile(inspectionPath, `${JSON.stringify(inspection)}\n`);
  }
  const { xml, assetsDirectory } = await bankXml(
    { directory, awcPath, inspection },
    gameRoot,
    kit,
  );
  return { xml, assetsDirectory, inspection };
}

/**
 * Личный банк ствола: дорожки голоса со своим звуком и дорожки банка ствола,
 * которые переезжают как есть (`kept`). Собранное перечитывается: набор
 * дорожек, их длины, звук новых PCM — байт в байт, и банк не больше слота
 * оружия игрока. Не влезает в PCM — новые дорожки идут ADPCM (как у части
 * банков игры), не влезает и так — отказ до записи.
 */
async function buildPrivateBank(
  { gameRoot, bank, kept, added, directory },
  stateDir,
  kit,
) {
  const old = kept.length
    ? await vanillaBankXml(bank, gameRoot, stateDir, kit)
    : { xml: null, assetsDirectory: null, inspection: null };
  const oldStreams = new Map(
    (old.inspection?.resource?.streams || []).map((stream) => [
      normalizeStreamId(stream.hash || stream.name),
      stream,
    ]),
  );
  const keptFiles = old.xml
    ? new Map(
        listXmlStreams(old.xml)
          .filter((item) => kept.includes(item.stream))
          .map((item) => [item.stream, item.fileName]),
      )
    : new Map();
  const attempt = async (codec) => {
    const work = path.join(directory, `.bank-${randomUUID()}`);
    const assetsDirectory = path.join(work, "assets");
    await fs.mkdir(assetsDirectory, { recursive: true });
    try {
      let xml = buildPrivateBankXml(old.xml, {
        kept,
        added: added.map((item) => ({
          stream: item.stream,
          fileName: item.fileName,
          samples: item.samples,
          sampleRate: item.sampleRate,
          headroom: item.headroom || 0,
        })),
      });
      if (codec === "ADPCM")
        for (const item of added)
          xml = xml.replace(
            new RegExp(`(<Name>hash_${item.stream.slice(2)}</Name>[\\s\\S]*?<Codec>)PCM(</Codec>)`),
            "$1ADPCM$2",
          );
      await fs.writeFile(path.join(work, "bank.xml"), xml);
      for (const [stream, fileName] of keptFiles) {
        if (!fileName) throw new Error(`У дорожки ${stream} нет данных в банке игры.`);
        await fs.copyFile(
          path.join(old.assetsDirectory, fileName),
          path.join(assetsDirectory, fileName),
        );
      }
      for (const item of added)
        await fs.copyFile(item.file, path.join(assetsDirectory, item.fileName));
      const built = path.join(work, "bank.awc");
      await kit.fromXml({
        input: path.join(work, "bank.xml"),
        output: built,
        assetsDirectory,
        gameRoot,
        edition: "Legacy",
      });
      const check = (await kit.inspect({ input: built, gameRoot, edition: "Legacy" }))
        ?.resource;
      const streams = new Map(
        (check?.streams || []).map((stream) => [
          normalizeStreamId(stream.hash || stream.name),
          stream,
        ]),
      );
      const expected = [...kept, ...added.map((item) => item.stream)].sort();
      if (JSON.stringify([...streams.keys()].sort()) !== JSON.stringify(expected))
        throw new Error("Собранный банк ствола потерял дорожки — установка отменена.");
      for (const stream of kept) {
        const before = oldStreams.get(stream);
        const after = streams.get(stream);
        if (Number(after?.samples) !== Number(before?.samples))
          throw new Error(`Дорожка ${stream} банка игры изменила длину — установка отменена.`);
      }
      for (const item of added) {
        const after = streams.get(item.stream);
        if (Number(after?.samples) !== item.samples)
          throw new Error(
            `Дорожка ${item.stream}: в банке ${after?.samples ?? "?"} сэмплов вместо ${item.samples} — установка отменена.`,
          );
        if (
          codec === "PCM" &&
          String(after?.payloadSha256 || "").toLowerCase() !== item.sha256
        )
          throw new Error(`Дорожка ${item.stream} собралась не байт в байт — установка отменена.`);
      }
      const size = (await fs.stat(built)).size;
      const budget = {
        header: Number(check?.headerBytes),
        metadata: Number(check?.metadataBytes),
        content: Number(check?.contentBytes),
      };
      if (!Object.values(budget).every(Number.isFinite)) {
        await kit.helperFeatures([AWC_SLOT_BUDGET_FEATURE]);
        throw new Error("Помощник Astral не назвал таблицу и служебные чанки банка ствола — установка отменена.");
      }
      return { built, size, budget, work };
    } catch (error) {
      await fs.rm(work, { recursive: true, force: true });
      throw error;
    }
  };
  const slot = PLAYER_WEAPON_SLOT;
  let result = await attempt("PCM");
  if (result.budget.content > slot.bytes) {
    await fs.rm(result.work, { recursive: true, force: true });
    result = await attempt("ADPCM");
  }
  const refuse = async (message) => {
    await fs.rm(result.work, { recursive: true, force: true });
    throw new Error(message);
  };
  if (result.budget.content > slot.bytes)
    await refuse(
      `Звук ствола не помещается в его банк: игра грузит банк оружия слотом ${Math.round(slot.bytes / 1024)} КБ, а собранный — ${Math.round(result.budget.content / 1024)} КБ. Сократите звук.`,
    );
  if (result.budget.metadata > slot.metadata || result.budget.header > slot.header)
    await refuse(
      `Банк ствола не помещается в служебную память слота оружия: служебные данные дорожек — ${result.budget.metadata} байт при пределе ${slot.metadata}, таблица — ${result.budget.header} при пределе ${slot.header}. Больший банк игра скопировала бы за край своей памяти и упала бы. Сократите звук.`,
    );
  return result;
}

async function buildWeaponPackage(
  { gameRoot, session, weapon },
  stateDir,
  kit,
) {
  const sources = WEAPON_VOICE_SOURCES[weapon.id];
  const slug = weaponSlug(weapon.id);
  const bankSlug = slug.replace(/-/g, "_");

  /* Звук окна: ровно дорожки голоса, в их частоте и не длиннее. */
  const staged = [];
  for (const bank of weaponVoiceByBank(weapon)) {
    const files = await sessionStreams(stateDir, session, bank.bank);
    const expected = new Map(bank.waves.map((wave) => [wave.stream, wave]));
    if (
      files.length !== expected.size ||
      files.some((item) => !expected.has(item.stream))
    )
      throw new Error(
        `В сессии не весь голос ствола: банку ${bank.bank} нужны ${expected.size} дорожек.`,
      );
    for (const item of files) {
      const wave = expected.get(item.stream);
      const bytes = await fs.readFile(item.file);
      const header = parseWavHeader(bytes);
      if (header.sampleRate !== wave.sampleRate)
        throw new Error(
          `Дорожка ${item.stream}: частота ${header.sampleRate} Гц вместо ${wave.sampleRate} Гц.`,
        );
      if (header.dataBytes / 2 > wave.samples)
        throw new Error(
          `Дорожка ${item.stream} длиннее, чем у игры (${header.dataBytes / 2} сэмплов вместо ${wave.samples}).`,
        );
      staged.push({
        key: streamKey(waveContainer(wave), Number.parseInt(wave.stream.slice(2), 16)),
        file: item.file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        samples: header.dataBytes / 2,
        sampleRate: header.sampleRate,
        headroom: await stagedHeadroom(item.file),
      });
    }
  }

  /* Метаданные игры игрока: действующие настройки и голос сверяются с
     таблицей — другая сборка игры не получит переопределение вслепую. */
  const merged = mergeAudioChunks(
    await readAudioChunks({ gameRoot, sources }, stateDir, kit),
  );
  const audio = weaponAudio(merged, { item: joaat(weapon.audio), auto: weapon.auto });
  if (hexHash(audio.settings.hash) !== sources.settings)
    throw new Error(
      `Настройки звука «${weapon.title}» в этой игре другие — обновите Astral.`,
    );
  const voice = weaponVoiceLeaves(merged, audio);
  /* Дорожки, которые остаются звучать в копиях, — ровно те, что прислало
     окно по таблице: иначе игра этой сборки устроена не так, как таблица. */
  const heard = planWeaponOverride(merged, { slug: bankSlug, audio, voice }).voice;
  const keys = staged.map((item) => item.key).sort();
  if (JSON.stringify(heard.map((item) => item.key).sort()) !== JSON.stringify(keys))
    throw new Error(
      `Голос «${weapon.title}» в этой игре устроен иначе — обновите Astral.`,
    );

  /* Одинаковый звук с одинаковым запасом — одна дорожка банка. */
  const groups = new Map();
  for (const item of [...staged].sort((left, right) => left.key.localeCompare(right.key))) {
    const same = `${item.sha256}|${item.headroom}`;
    if (!groups.has(same)) {
      const name = voiceWaveName(bankSlug, item.key);
      const stream = hexHash(name & 0x1fffffff);
      groups.set(same, {
        name,
        stream,
        fileName: `0x${stream.slice(2)}.wav`,
        file: item.file,
        sha256: item.sha256,
        samples: item.samples,
        sampleRate: item.sampleRate,
        headroom: item.headroom,
        keys: [],
      });
    }
    groups.get(same).keys.push(item.key);
  }
  const nameOf = new Map();
  for (const group of groups.values())
    for (const key of group.keys) nameOf.set(key, group.name);
  const plan = planWeaponOverride(merged, {
    slug: bankSlug,
    audio,
    voice,
    waveName: (key) => nameOf.get(key),
  });
  const added = [...groups.values()];

  const fingerprint = createHash("sha256");
  fingerprint.update(
    JSON.stringify({
      format: WEAPON_FORMAT_VERSION,
      weapon: weapon.id,
      settings: sources.settings,
      /* Запас — только если он есть: замысел без него сохраняет прежний отпечаток. */
      streams: added.map((item) =>
        item.headroom ? [item.stream, item.sha256, item.headroom] : [item.stream, item.sha256],
      ),
      kept: plan.kept,
      objects: plan.objects.map((item) => [hexHash(item.hash), item.bytes.toString("hex")]),
      settingsCopy: [hexHash(plan.settings.hash), plan.settings.bytes.toString("hex")],
      item: [hexHash(plan.item.hash), plan.item.bytes.toString("hex")],
    }),
  );
  const designHash = fingerprint.digest("hex");
  const directory = path.join(weaponsRoot(stateDir), designHash);
  const payloadDirectory = path.join(directory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });

  const bankFile = path.join(payloadDirectory, `${bankSlug}.awc`);
  if (!(await fs.stat(bankFile).catch(() => null))) {
    const built = await buildPrivateBank(
      { gameRoot, bank: sources.bank, kept: plan.kept, added, directory },
      stateDir,
      kit,
    );
    try {
      await fs.rename(built.built, bankFile);
    } finally {
      await fs.rm(built.work, { recursive: true, force: true });
    }
  }

  const owner = { weapon: weapon.id };
  const gamePath = path.join(payloadDirectory, "astral_audio_game.json");
  const soundsPath = path.join(payloadDirectory, "astral_audio_sounds.json");
  await fs.writeFile(
    gamePath,
    `${JSON.stringify(
      audioChunkPayload(AUDIO_DLC_GAME_ENTRY, 151, [plan.settings, plan.item], [], owner),
    )}\n`,
  );
  await fs.writeFile(
    soundsPath,
    `${JSON.stringify(
      audioChunkPayload(AUDIO_DLC_SOUNDS_ENTRY, 54, plan.objects, [plan.bank.name], owner),
    )}\n`,
  );

  const digest = designHash.slice(0, 12);
  const chunkFile = async (source, entry, file) => ({
    source,
    target: AUDIO_DLC_TARGET,
    entry,
    action: "replace",
    size: (await fs.stat(file)).size,
    sha256: await sha256File(file),
    merge: { strategy: "astral-audio-chunk-v1" },
  });
  const manifest = {
    id: `local-sound-weapon-${slug}-${digest}`,
    version: `1.0.0-${digest}`,
    name: `Свой звук: ${weapon.title}`,
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    gameplayChanges: false,
    scope: "game-root",
    capabilities: ["astral-audio-chunk-v1", "direct-audio-dlc-v1"],
    slots: [`sound-weapon-${slug}`],
    files: [
      await chunkFile("payload/astral_audio_game.json", AUDIO_DLC_GAME_ENTRY, gamePath),
      await chunkFile("payload/astral_audio_sounds.json", AUDIO_DLC_SOUNDS_ENTRY, soundsPath),
      {
        source: `payload/${bankSlug}.awc`,
        target: AUDIO_DLC_TARGET,
        entry: plan.bank.entry,
        action: "import",
        size: (await fs.stat(bankFile)).size,
        sha256: await sha256File(bankFile),
      },
    ],
  };
  return {
    directory,
    manifest,
    designHash,
    weapon,
    summary: {
      streams: added.length,
      kept: plan.kept.length,
      copies: plan.objects.length,
      fields: plan.fields.map((item) => item.field),
      bankBytes: (await fs.stat(bankFile)).size,
    },
  };
}

/*
 * Ствол без своих выстрелов (30.10.2026, владелец: «отключить звуки от себя, звуки стрельбы, чтобы от других там было слышно»): пакет из одного файла — слой звуковых метаданных Astral
 * с копией настроек игрока (поля выстрела, отзвук, эхо, слой помещения — на `null_sound`) и предметом звука, где строка игрока ведёт на копию (`weapon-mute-plan.js`). Банка и деревьев нет:
 * файл `.awc` не нужен, `BankSound` — банк игры, общие банки не тронуты. Слот тот же, что у своего звука ствола: тишина и свой звук — один выбор, новый заменяет прежний. Читается из файлов игры
 * игрока (метаданные всех пакетов дополнений в порядке загрузки), а не из таблицы голосов: тишине нужны только настройки игрока ствола, у PDW и тазера они есть тоже.
 */
async function buildWeaponMutePackage({ gameRoot, weapon }, stateDir, kit) {
  const slug = weaponSlug(weapon.id);
  const merged = mergeAudioChunks(await readAudioChunks({ gameRoot, sources: WEAPON_SHOT_SOURCES }, stateDir, kit));
  const audio = weaponAudio(merged, { item: joaat(weapon.audio), auto: weapon.auto });
  const plan = planWeaponMute(merged, { slug: slug.replace(/-/g, "_"), audio });
  const designHash = createHash("sha256")
    .update(
      JSON.stringify({
        format: WEAPON_MUTE_FORMAT,
        weapon: weapon.id,
        settings: [hexHash(plan.settings.hash), plan.settings.bytes.toString("hex")],
        item: [hexHash(plan.item.hash), plan.item.bytes.toString("hex")],
      }),
    )
    .digest("hex");
  const directory = path.join(weaponsRoot(stateDir), `mute-${designHash.slice(0, 16)}`);
  const payloadDirectory = path.join(directory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  const gamePath = path.join(payloadDirectory, "astral_audio_game.json");
  await fs.writeFile(
    gamePath,
    `${JSON.stringify(audioChunkPayload(AUDIO_DLC_GAME_ENTRY, 151, [plan.settings, plan.item], [], { weapon: weapon.id, mute: true }))}
`,
  );
  const digest = designHash.slice(0, 12);
  const manifest = {
    id: `local-sound-weapon-${slug}-${digest}`,
    version: `1.0.0-${digest}`,
    name: `Без своих выстрелов: ${weapon.title}`,
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    gameplayChanges: false,
    scope: "game-root",
    capabilities: ["astral-audio-chunk-v1", "direct-audio-dlc-v1"],
    slots: [`sound-weapon-${slug}`],
    files: [
      {
        source: "payload/astral_audio_game.json",
        target: AUDIO_DLC_TARGET,
        entry: AUDIO_DLC_GAME_ENTRY,
        action: "replace",
        size: (await fs.stat(gamePath)).size,
        sha256: await sha256File(gamePath),
        merge: { strategy: "astral-audio-chunk-v1" },
      },
    ],
  };
  return {
    directory,
    manifest,
    designHash,
    weapon,
    summary: { mute: true, streams: 0, kept: 0, copies: 2, fields: plan.fields.map((item) => item.field), stays: plan.stays, bankBytes: 0 },
  };
}

/*
 * Прежний звук этого ствола уходит той же установкой: новая версия своего
 * звука (тот же слот), звук, поставленный до «звука на ствол» на семью, где
 * ствол был основным (слот `sound-weapon-<основной>` — тот же), и слой
 * прежней студии на его дорожках. Чужие стволы не трогаются.
 */
async function planWeaponSoundWith(input, stateDir, kit) {
  const gameRoot = requireGameRoot(input);
  /* Тишина (`mute`) — без сессии с дорожками: звука у неё нет. */
  const mute = input?.mute === true;
  const weapon = mute ? requireMuteWeapon(input) : requireWeapon(input);
  const layer = mute
    ? await buildWeaponMutePackage({ gameRoot, weapon }, stateDir, kit)
    : await buildWeaponPackage({ gameRoot, session: requireSession(input), weapon }, stateDir, kit);
  const host = await kit.audioHost({ stateDir, gameRoot });
  const profile = await kit.profile({ stateDir });
  const installed =
    profile?.targets?.[String(input?.targetId || "default")]?.installed || [];
  const slot = `sound-weapon-${weaponSlug(weapon.id)}`;
  const previous = installed
    .filter((item) => (item.slots || []).includes(slot))
    .map((item) => ({ modId: item.modId }));
  const plan = await kit.plan(
    engineOptions(layer, input, stateDir, kit, { audioDlcHost: host }),
  );
  const replaceModIds = [
    ...new Set([
      ...(plan.conflicts || []).map((item) => item.modId),
      ...previous.map((item) => item.modId),
    ]),
  ]
    .filter((modId) => modId !== layer.manifest.id)
    .sort();
  return { layer, replaceModIds, conflicts: previous, host };
}

async function planWeaponSoundImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const { layer, replaceModIds, conflicts } = await planWeaponSoundWith(
    input,
    stateDir,
    kit,
  );
  return {
    modId: layer.manifest.id,
    kind: "weapon",
    format: WEAPON_FORMAT_VERSION,
    weapon: layer.weapon.id,
    ...(layer.summary.mute ? { mute: true } : {}),
    manifestHash: manifestHashOf(layer.manifest),
    designHash: `sha256:${layer.designHash}`,
    bank: layer.manifest.files[2]?.entry ?? null,
    summary: layer.summary,
    streamConflicts: conflicts,
    replaceModIds,
    rightsNotice:
      "Устанавливая звук, вы подтверждаете права на использование этой записи.",
    edition: "Legacy",
  };
}
export const planWeaponSound = guarded(planWeaponSoundImpl);

async function applyWeaponSoundImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await kit.assertRuntimeSafety?.(gameRoot);
  const { layer, replaceModIds, host } = await planWeaponSoundWith(
    input,
    stateDir,
    kit,
  );
  if (manifestHashOf(layer.manifest) !== String(input?.expectedManifestHash))
    throw new Error("План установки звука ствола устарел.");
  const installedResult = await kit.install(
    engineOptions(layer, input, stateDir, kit, {
      replaceModIds,
      audioDlcHost: host,
    }),
  );
  return {
    ...installedResult,
    installId: layer.manifest.id,
    modId: layer.manifest.id,
    kind: "local-sound-weapon",
    format: WEAPON_FORMAT_VERSION,
    status: "active",
    weapon: layer.weapon.id,
    ...(layer.summary.mute ? { mute: true } : {}),
    replaced: replaceModIds,
    gameRoot,
    targetId: String(input?.targetId || "default"),
    installedAt: new Date().toISOString(),
  };
}
export const applyWeaponSound = guarded(applyWeaponSoundImpl);

/* ── Глушитель, вшитый в модель: путь звука глушителя (`silencer-link.js`) ──
   Игра не знает, что на стволе глушитель, и играет обычный выстрел. Связь переводит поля выстрела ствола
   на путь глушителя игры. Связь — только у ствола без своего голоса: свой звук студии и звук пака уже пишут
   все поля выстрела. Один пакет на ствол, id стабильный: переустановка заменяет прежний. Какой скин вшил
   глушитель, — в `silencer-links.json`, чтобы снятие скина сняло и связь. */
/* 2 (22.10): поле — на дерево того же вида: у автомата AutoSound → очередь глушителя, FireSound — тишина. */
const SILENCER_LINK_FORMAT = 2;
const silencerLinkId = (slug) => `local-sound-weapon-${slug}-silencer`;
const silencerLinksFile = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "sound-studio", "silencer-links.json");

async function readSilencerLinks(stateDir) {
  try {
    return JSON.parse(await fs.readFile(silencerLinksFile(stateDir), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function writeSilencerLinks(stateDir, records) {
  const file = silencerLinksFile(stateDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(records, null, 2));
  await fs.rename(tmp, file);
}

/* Слой связи: копия настроек ствола с полями глушителя и предмет, где строка игрока ведёт на копию. Своего банка
   нет: `BankSound` остаётся банком игры, деревья глушителя — тоже игры (общий слой RESIDENT грузится всегда). */
async function silencerLinkLayer(weapon, { gameRoot, stateDir, kit }) {
  const sources = WEAPON_VOICE_SOURCES[weapon.id];
  if (!sources) return null;
  const slug = weaponSlug(weapon.id);
  const merged = mergeAudioChunks(await readAudioChunks({ gameRoot, sources }, stateDir, kit));
  const audio = weaponAudio(merged, { item: joaat(weapon.audio), auto: weapon.auto });
  if (hexHash(audio.settings.hash) !== sources.settings)
    throw new Error(`Настройки звука «${weapon.title}» в этой игре другие — обновите Astral.`);
  /* Вид дерева (очередь или разовое) — по тем же файлам голоса ствола: сверено на всех 30 стволах таблицы. */
  const links = silencerLinkFields({
    roots: audio.roots,
    embedded: true,
    shapeOf: (hash) => soundShape(merged, hash),
  });
  if (!links.length) return null;
  const itemObject = merged.game(audio.item);
  if (!itemObject || itemObject.bytes.readUInt32LE(audio.playerAt) !== audio.settings.hash)
    throw new Error(`Предмет звука «${weapon.title}» в этой игре устроен иначе — обновите Astral.`);
  const settingsCopy = cloneHash(slug, audio.settings.hash);
  if (merged.game(settingsCopy))
    throw new Error(`Имя копии настроек ${hexHash(settingsCopy)} уже занято в настройках игры.`);
  const settings = applySilencerLink(audio.settings.bytes, links);
  const item = Buffer.from(itemObject.bytes);
  item.writeUInt32LE(settingsCopy, audio.playerAt);

  const shape = {
    format: SILENCER_LINK_FORMAT,
    weapon: weapon.id,
    settings: sources.settings,
    links: links.map((link) => [link.field, link.to]),
    item: item.toString("hex"),
  };
  const designHash = createHash("sha256").update(JSON.stringify(shape)).digest("hex");
  const directory = path.join(weaponsRoot(stateDir), `silencer-${designHash.slice(0, 16)}`);
  const payloadDirectory = path.join(directory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  const gamePath = path.join(payloadDirectory, "astral_audio_game.json");
  await fs.writeFile(
    gamePath,
    `${JSON.stringify(
      audioChunkPayload(
        AUDIO_DLC_GAME_ENTRY,
        151,
        [
          { hash: settingsCopy, bytes: settings, links: audio.settings.links, packs: audio.settings.packs },
          { hash: audio.item, bytes: item, links: itemObject.links, packs: itemObject.packs },
        ],
        [],
        { weapon: weapon.id },
      ),
    )}\n`,
  );
  const digest = designHash.slice(0, 12);
  const manifest = {
    id: silencerLinkId(slug),
    version: `1.0.0-${digest}`,
    name: `Глушитель: ${weapon.title}`,
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    gameplayChanges: false,
    scope: "game-root",
    capabilities: ["astral-audio-chunk-v1", "direct-audio-dlc-v1"],
    slots: [`sound-weapon-${slug}`],
    files: [
      {
        source: "payload/astral_audio_game.json",
        target: AUDIO_DLC_TARGET,
        entry: AUDIO_DLC_GAME_ENTRY,
        action: "replace",
        size: (await fs.stat(gamePath)).size,
        sha256: await sha256File(gamePath),
        merge: { strategy: "astral-audio-chunk-v1" },
      },
    ],
  };
  return { directory, manifest, designHash, weapon, summary: { fields: links.map((link) => link.field) } };
}

/* Решение установки: глушитель вшит — связь ставится; снят — связь снимается. Свой звук или пак на слоте
   не трогаем: их поля выстрела уже на своём звуке. `tools` — подмена для тестов (как у `applyWeaponSound`). */
export async function syncWeaponSilencerLink(
  { gameRoot, targetId = "default", weapon: weaponId, embedded, skinModId = null },
  stateDir,
  tools = {},
) {
  const kit = { ...defaultTools(), ...tools };
  const weapon = WEAPON_SOUND_MAP[String(weaponId || "")];
  if (!weapon) return { status: "no-weapon" };
  const slug = weaponSlug(weapon.id);
  const modId = silencerLinkId(slug);
  const slot = `sound-weapon-${slug}`;
  const profile = await kit.profile({ stateDir });
  const installed = profile?.targets?.[targetId]?.installed || [];
  const onSlot = installed.filter((item) => (item.slots || []).includes(slot));
  const ours = onSlot.some((item) => item.modId === modId);
  const others = onSlot.filter((item) => item.modId !== modId);
  const records = await readSilencerLinks(stateDir);
  const target = { ...(records[targetId] || {}) };

  if (!embedded) {
    if (!ours) return { status: "absent", modId };
    await (tools.remove || removeSoundCustomization)({ gameRoot, modId, targetId }, {}, stateDir);
    delete target[weapon.id];
    records[targetId] = target;
    await writeSilencerLinks(stateDir, records);
    return { status: "removed", modId };
  }
  if (others.length) return { status: "skipped", modId, reason: "слот занят звуком игрока или пака" };
  const layer = await (tools.layer || silencerLinkLayer)(weapon, { gameRoot, stateDir, kit });
  if (!layer) return { status: "none", modId };
  const input = { gameRoot, targetId };
  const host = await kit.audioHost({ stateDir, gameRoot });
  const plan = await kit.plan(engineOptions(layer, input, stateDir, kit, { audioDlcHost: host }));
  const replaceModIds = [
    ...new Set([
      ...(plan.conflicts || []).map((item) => item.modId),
      ...onSlot.map((item) => item.modId),
    ]),
  ]
    .filter((id) => id !== layer.manifest.id)
    .sort();
  await kit.install(engineOptions(layer, input, stateDir, kit, { replaceModIds, audioDlcHost: host }));
  target[weapon.id] = { skinModId };
  records[targetId] = target;
  await writeSilencerLinks(stateDir, records);
  return { status: "installed", modId: layer.manifest.id, fields: layer.summary.fields };
}

/* Снят скин: связи глушителя, которые он поставил, снимаются вместе с ним. */
export async function forgetSkinSilencerLinks({ gameRoot, targetId = "default", modId }, stateDir, tools = {}) {
  const records = await readSilencerLinks(stateDir);
  const target = { ...(records[targetId] || {}) };
  const mine = Object.entries(target)
    .filter(([, record]) => record?.skinModId === modId)
    .map(([weaponId]) => weaponId);
  for (const weaponId of mine) {
    await (tools.remove || removeSoundCustomization)(
      { gameRoot, modId: silencerLinkId(weaponSlug(weaponId)), targetId },
      {},
      stateDir,
    ).catch(() => null);
    delete target[weaponId];
  }
  records[targetId] = target;
  await writeSilencerLinks(stateDir, records);
  return { removed: mine };
}

/*
 * Ствол установленного мода — по его слоту `sound-weapon-<ствол>`. Звук,
 * поставленный до «звука на ствол», стоял на семье (форма
 * `awc-stream-layer-v1`): он называется своим основным стволом и помечается
 * как прежний — он менял и соседей по семье, и «Применить» переставит его
 * только на этот ствол.
 */
function weaponOfManifest(record) {
  /* Запись движка о поставленном моде держит слоты и места записей, а не
     манифест: по ним ствол и узнаётся. */
  const slot = (record?.slots || []).find((item) =>
    String(item).startsWith("sound-weapon-"),
  );
  if (!slot) return null;
  const slug = String(slot).slice("sound-weapon-".length);
  const legacy = !(record?.archiveEntries || []).some(
    (item) => item?.target === AUDIO_DLC_TARGET,
  );
  const manifest = record?.manifest;
  /* Тишина — один файл пакета (слой метаданных звукового пакета), без банка и без второго слоя: «Без своих выстрелов». */
  const entries = record?.archiveEntries || [];
  const mute =
    entries.length === 1 &&
    entries[0]?.target === AUDIO_DLC_TARGET &&
    entries[0]?.entry === AUDIO_DLC_GAME_ENTRY &&
    !/-silencer$/.test(String(record?.modId || ""));
  const weapon = WEAPON_SOUNDS.find((item) => weaponSlug(item.id) === slug);
  if (weapon) return { id: weapon.id, title: weapon.title, legacy, ...(mute ? { mute: true } : {}) };
  const named = String(manifest?.name || "").replace(/^Свой звук:\s*/, "");
  return {
    id: `WEAPON_${slug.toUpperCase().replace(/-/g, "_")}`,
    title: named || "ствол",
    legacy,
  };
}

/* ============================================================================
 * «Окружение»: громкость машин, улиц, природы, погоды и людей по отдельности
 * (ТЗ владельца 17.10.2026, задача 5).
 *
 * Окно присылает только ползунки — сдвиг в дБ на канал
 * (`@modovik/sound-studio/sound-mix`). Какие категории игры двигает канал,
 * решается здесь, по таблице каналов и по файлу категорий игрока: ветка
 * канала и её подветки, которые не берут громкость у родителей. Пакет — один
 * JSON сдвигов на `categories.dat22.rel` в update.rpf; сам файл собирает
 * установщик из файла игры (`audio-rel-composer.js`), меняя только поля
 * громкости. Снятие возвращает категории игры как были.
 *
 * Категории читаются из основы движка, а не из игры: в игре они уже могут
 * нести прежнее окружение, и сдвиг лёг бы на сдвиг. Звук попадания читает их
 * оттуда же — его громкость считается от категорий игры, а не от ползунков.
 * ========================================================================== */

const MIX_MOD_ID = /^local-sound-mix-[a-f0-9]{12}$/;
const SOUND_MIX_SLOT = "sound-mix";
const SOUND_MIX_TITLE = "Звуки окружения";
const mixRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "sound-studio", "mix");

/* Окружение из окна: только известные каналы и значения в пределах. */
function requireSoundMix(input) {
  const raw = input?.mix && typeof input.mix === "object" ? input.mix : {};
  const levels = raw.levels && typeof raw.levels === "object" ? raw.levels : {};
  for (const id of Object.keys(levels))
    if (!Object.hasOwn(SOUND_MIX_CHANNEL_MAP, id))
      throw new Error(`Неизвестный канал окружения: ${String(id).slice(0, 40)}.`);
  const mix = normalizeSoundMix(raw);
  if (!Object.keys(mix.levels).length)
    throw new Error("Окружение как в игре — ставить нечего: снимите прежнее.");
  return mix;
}

/**
 * Сдвиги категорий окружения по файлу категорий игрока: каждая ветка канала
 * и её подветки, которые не берут громкость у родителей. Канал, ветки
 * которого в игре нет, — отказ словами: игра другой сборки.
 */
export function soundMixCategoryPatches(mix, categories) {
  const sums = new Map();
  for (const { channel, category, gain } of soundMixGains(mix)) {
    const hash = Number.parseInt(category.slice(2), 16) >>> 0;
    let roots;
    try {
      roots = categoryVolumeRoots(categories, hash);
    } catch {
      throw new Error(
        `В категориях звука вашей игры нет ветки канала «${SOUND_MIX_CHANNEL_MAP[channel].title}» (${category}) — эта сборка GTA V устроена иначе.`,
      );
    }
    for (const root of roots)
      sums.set(hexHash(root), (sums.get(hexHash(root)) || 0) + gain);
  }
  return composeCategoryPatches([
    { patches: [...sums].map(([category, gain]) => ({ category, gain })) },
  ]);
}

async function buildSoundMixPackage({ gameRoot, mix }, stateDir, kit) {
  const [categoriesChunk] = await readAudioChunks(
    { gameRoot, sources: { chunks: [SOUND_CATEGORIES_SOURCE] } },
    stateDir,
    kit,
  );
  const categories = readSoundCategories(categoriesChunk.buffer);
  const patches = soundMixCategoryPatches(mix, categories);
  /* Сборка на основе — та же, что сделает установщик: правка встаёт, и
     громкости после неё известны заранее. */
  const { volumes } = applyCategoryPatches(categoriesChunk.buffer, patches);
  const payload = {
    format: REL_PATCH_FORMAT,
    version: REL_PATCH_VERSION,
    entry: CATEGORY_PATCH_ENTRY,
    patches,
  };
  const text = `${JSON.stringify(payload)}\n`;
  const designHash = createHash("sha256")
    .update(JSON.stringify({ format: SOUND_MIX_FORMAT, patches }))
    .digest("hex");
  const digest = designHash.slice(0, 12);
  const directory = path.join(mixRoot(stateDir), designHash);
  const payloadPath = path.join(directory, "payload", "categories.dat22.patch.json");
  await fs.mkdir(path.dirname(payloadPath), { recursive: true });
  await fs.writeFile(payloadPath, text);
  const manifest = {
    id: `local-sound-mix-${digest}`,
    version: `1.0.0-${digest}`,
    name: SOUND_MIX_TITLE,
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    gameplayChanges: false,
    scope: "game-root",
    capabilities: ["audio-rel-patch-v1", "direct-update-entries-v1"],
    slots: [SOUND_MIX_SLOT],
    files: [
      {
        source: "payload/categories.dat22.patch.json",
        target: SOUND_CATEGORIES_SOURCE[0],
        entry: CATEGORY_PATCH_ENTRY,
        action: "replace",
        size: Buffer.byteLength(text),
        sha256: createHash("sha256").update(text).digest("hex"),
        merge: { strategy: "audio-rel-patch-v1" },
      },
    ],
  };
  return {
    directory,
    manifest,
    designHash,
    patches,
    /* Громкость каждой сдвинутой категории в игре: была → станет. */
    categories: patches.map(({ category, gain }) => {
      const hash = Number.parseInt(category.slice(2), 16) >>> 0;
      return {
        category,
        gain,
        before: categories.volume.get(hash),
        after: volumes.get(hash),
      };
    }),
  };
}

/*
 * План окружения. Прежнее окружение держит тот же слот и сменяется; чужой
 * мод, который заменяет файл категорий целиком, — отказ с его именем: снять
 * его молча значило бы вернуть игре то, что человек ставил нарочно.
 */
async function planSoundMixWith(input, stateDir, kit) {
  const gameRoot = requireGameRoot(input);
  const mix = requireSoundMix(input);
  const layer = await buildSoundMixPackage({ gameRoot, mix }, stateDir, kit);
  const profile = await kit.profile({ stateDir });
  const installed =
    profile?.targets?.[String(input?.targetId || "default")]?.installed || [];
  const previous = installed
    .filter((item) => (item.slots || []).includes(SOUND_MIX_SLOT))
    .map((item) => item.modId);
  const plan = await kit.plan(engineOptions(layer, input, stateDir, kit));
  const foreign = (plan.conflicts || []).filter(
    (item) =>
      item.modId !== layer.manifest.id &&
      !previous.includes(item.modId) &&
      Number(item.fileCount) > 0,
  );
  if (foreign.length) {
    const names = foreign.map((item) => {
      const record = installed.find((entry) => entry.modId === item.modId);
      return record?.name || record?.manifest?.name || item.modId;
    });
    throw new Error(
      `Категории звука игры уже заменяет «${names.join("», «")}» — снимите его в библиотеке, чтобы настроить окружение здесь.`,
    );
  }
  const replaceModIds = previous
    .filter((modId) => modId !== layer.manifest.id)
    .sort();
  return { layer, mix, replaceModIds };
}

async function planSoundMixImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const { layer, mix, replaceModIds } = await planSoundMixWith(
    input,
    stateDir,
    kit,
  );
  return {
    modId: layer.manifest.id,
    kind: "mix",
    format: SOUND_MIX_FORMAT,
    manifestHash: manifestHashOf(layer.manifest),
    designHash: `sha256:${layer.designHash}`,
    signature: soundMixSignature(mix),
    categories: layer.categories,
    replaceModIds,
    edition: "Legacy",
  };
}
export const planSoundMix = guarded(planSoundMixImpl);

async function applySoundMixImpl(input, _context, stateDir, tools = {}) {
  const kit = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await kit.assertRuntimeSafety?.(gameRoot);
  const { layer, mix, replaceModIds } = await planSoundMixWith(
    input,
    stateDir,
    kit,
  );
  if (manifestHashOf(layer.manifest) !== String(input?.expectedManifestHash))
    throw new Error("План установки окружения устарел.");
  const installedResult = await kit.install(
    engineOptions(layer, input, stateDir, kit, { replaceModIds }),
  );
  return {
    ...installedResult,
    installId: layer.manifest.id,
    modId: layer.manifest.id,
    kind: "local-sound-mix",
    format: SOUND_MIX_FORMAT,
    status: "active",
    signature: soundMixSignature(mix),
    replaced: replaceModIds,
    gameRoot,
    targetId: String(input?.targetId || "default"),
    installedAt: new Date().toISOString(),
  };
}
export const applySoundMix = guarded(applySoundMixImpl);
