import {
  DECORATION_NAME_PATTERN,
  DECORATION_OVERLAY_CAPABILITY,
  DECORATION_OVERLAY_ENTRY_PATTERN,
  DECORATION_OVERLAY_STRATEGY,
} from "./decoration-overlay-shape.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, verify as verifySignature } from "node:crypto";
import { cleanId } from "./state-record.js";
import {
  FORBIDDEN_EXTENSIONS,
  hasForbiddenExtension,
  nameSegmentProblem,
  nameSegmentReason,
} from "../mod-targets/file-names.js";
import { CARRIER_REGISTRATION_ROOT, PACK_FORM_CARRIER_TARGETS, carrierEnabled } from "./carrier-targets.js";
import { CAREFUL_MIN_BYTES, carefulReadFlags, diskTurn, throttledOp } from "./disk-care.js";
import {
  ASTRAL_CONTAINER_ROOT,
  ASTRAL_REGISTRATION_ROOT,
  canonicalArchiveEntry,
} from "./astral-paths.js";
import {
  isLocalWaterManifest,
  isWaterGameEntry,
} from "./water-manifest-trust.js";
import { DRAW_DISTANCE_TIMECYCLE_ENTRY, isLocalDrawDistanceManifest } from "./draw-distance-manifest-trust.js";
import { isLocalOptimizationSetManifest } from "./optimization-manifest-trust.js";
import { clothingItemSlots } from "./clothing-slots.js";
import { withOwnMapsContainer } from "./manifest-containers.js";
import { manifestNeedsLoader } from "./loader-need.js";
import { WEAPONS_META_ENTRY, WEAPONS_META_MAX_FILES, WEAPONS_META_STRATEGY } from "./weapons-meta-bindings.js";
import { PROJECT_INTERIORS_DATA_CAPABILITY, assertProjectInteriorsData } from "./project-interiors-data.js";
import {
  ASTRAL_PTFX_CORE_CHANNEL,
  ASTRAL_PTFX_CORE_VERSION,
  ASTRAL_TRACER_SCHEMA,
  ASTRAL_TRACER_TEXTURE_LAYOUT,
  ASTRAL_PTFX_PLAYER_CORE_CHANNEL,
  ASTRAL_PTFX_PLAYER_CORE_VERSION,
  knownPtfxCore,
  normalizeTracerWeapons,
  tracerSlots,
  TRACER_RPF_ENTRIES,
} from "@modovik/tracer-contract";

/* Список запрещённых расширений и правило звена пути — одно на установку, распаковку и бандлы (`mod-targets/file-names.js`). */
export { FORBIDDEN_EXTENSIONS };

export const isModsTarget = (relativePath) =>
  relativePath === "mods" || relativePath.startsWith("mods/");
export const isNewModsTarget = (relativePath) =>
  relativePath === "newmods" || relativePath.startsWith("newmods/");
export const isManagedOverlayTarget = (relativePath) =>
  isModsTarget(relativePath) || isNewModsTarget(relativePath);
// Имя контейнера остаётся строгим, а внутри него разрешено подчёркивание в
// начале имени: так называется `_manifest.ymf` — файл, по которому игра
// связывает ymap с его ytyp. Переименовать его нельзя, а держать ради него
// отдельное исключение в каждом трасте — дороже, чем один символ здесь.
// Имя может начинаться с `hi@`: так Rockstar и паки интерьеров называют
// коллизию высокой детализации (`hi@shelter.ybn`), и без `@` в имени такой
// файл не лёг бы в контейнер. Так же — слово клипа (`clip@hatemod.ycd`, анимация
// реквизита автора арены). Остальные символы прежние; что именно можно
// писать, решает строгая форма манифеста каждой работы.
const CLOTHING_HERO_ENTRY =
  /^astral_stream_(?:00|01)\.rpf\/player_(?:zero|one|two)(?:_p)?\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydd|ytd)$/;
const ASTRAL_CONTENT_ENTRY_PATTERN =
  /^x64\/astral\/[a-z0-9][a-z0-9._-]{0,119}\.rpf(?:\/(?:[a-z0-9_]{1,40}@)?[a-z0-9_][a-z0-9._+~-]{0,119})*$/;
/* Запись в штатном пакете-носителе (форма М, `carrier-targets.js`): `x64/levels/gta5/astral_….rpf/<файл>`, то же строгое имя файла. */
const PACK_CARRIER_ENTRY_PATTERN =
  /^x64\/levels\/gta5\/astral_[a-z0-9._-]{0,110}\.rpf(?:\/(?:[a-z0-9_]{1,40}@)?[a-z0-9_][a-z0-9._+~-]{0,119})*$/;
const containsRpfContainer = (entry) =>
  String(entry || "")
    .split("/")
    .slice(0, -1)
    .some((segment) => segment.toLowerCase().endsWith(".rpf"));
const TIMECYCLE_MODIFIER_ENTRY_PATTERN =
  /^common\/data\/timecycle\/timecycle_mods_[1-4]\.xml$/i;
const BLOODFX_ENTRY_PATTERN = /^common\/data\/effects\/bloodfx\.dat$/i;
/* Свои правила автора в ядре игрока: приставка пакета и имена правил автора (`ypt-own-rules-v1`). */
const OWN_RULE_PREFIX = /^astral_own_[a-f0-9]{6}_$/;
const OWN_RULE_NAME = /^[a-z0-9_]{1,40}$/i;
/* Словари Rockstar вне ядра, из которых установщик берёт листы игры игрока для своих правил автора. */
const OWN_GAME_DICTIONARIES = new Set(["scr_rcbarry2"]);
const CLIP_REGIONS_ENTRY_PATTERN = /^common\/data\/effects\/ptxclipregions\.dat$/i;
/* Метаданные звука, которые правит `audio-rel-patch-v1`: звуки (dat54),
   настройки игры (dat151) и категории звука (dat22, «Окружение» студии
   звуков) в update.rpf — игра читает их оттуда. */
const AUDIO_REL_ENTRY_PATTERN =
  /^x64\/audio\/config\/(sounds\.dat54|game\.dat151|categories\.dat22)\.rel$/i;
const AWC_ARCHIVE_PATTERN =
  /^(x64\/audio\/sfx\/(resident|weapons_player|streamed_ambience|oneshot_ambience|pain|streamed_vehicles(_granular(_npc)?|_low_latency)?|prologue|streams|radio_\d{2}_[a-z0-9_]+)\.rpf)$/i;
const AWC_ROOT_ENTRY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,119}\.awc$/i;
/*
 * Банки стволов из пакетов дополнений Rockstar: револьвер, служебный
 * карабин, двустволка стреляют банками своих пакетов, а не общими звуковыми
 * архивами. Банк лежит в звуковой папке пакета внутри его dlc.rpf. Пакеты
 * Astral (`astral_*`) сюда не входят — их собирают свои стратегии.
 */
const AWC_DLC_ARCHIVE_PATTERN =
  /^update\/x64\/dlcpacks\/(?!astral_)[a-z0-9_]+\/dlc\.rpf$/i;
const AWC_DLC_ENTRY_PATTERN =
  /^x64\/audio\/sfx\/[a-z0-9_]+\/[a-z0-9][a-z0-9._-]{0,119}\.awc$/i;
/*
 * Звуковой пакет Astral (`audio-dlc.js`): свой архив, два файла метаданных,
 * которые собирает установщик из JSON-слоёв стволов, и личные банки стволов
 * в его волновой папке. Строчными — игра ищет записи строчными.
 */
const AUDIO_DLC_ARCHIVE = "update/x64/dlcpacks/astral_audio/dlc.rpf";
/*
 * Пакет растительности Astral (`vegetation-dlc.js`, задача 10): словари,
 * модели и карты травы — только в его потоковом архиве, только импортом
 * слоями ресурсов. Кто вправе так писать, решает строгая форма манифеста
 * растительности (`vegetation-manifest-trust.js`).
 */
const VEGETATION_DLC_ARCHIVE = "update/x64/dlcpacks/astral_vegetation/dlc.rpf";
/* Потоковых архивов пакета четыре (`VEGETATION_DLC_STREAMS`, 05.10.2026); `_mp` — архив
   сетевой карты (`GROUP_MAP`, 12.10.2026).
   Типы — только постоянные типы копий «В разнобой» (`astral_vegmix*.ytyp`,
   задача 7 ТЗ 17.10.2026): их запрашивает основа первого пакета, и каждый лежит
   в ОДНОЙ части — той, что выбирает `vegetationStreamOf` по имени
   (`astral_vegmix` → _4, `astral_vegmix_2` → первая). Части прописаны здесь
   прямо (manifest.js не может звать vegetation-dlc.js — тот зовёт его), а
   совпадение с `vegetationStreamOf` держит тест `vegetation-variety.test.js`. */
const VEGETATION_DLC_ENTRY_PATTERN =
  /^(?:astral_vegetation(?:_[234]|_mp)?\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ytd|ydr|ydd|yft|ymap)|astral_vegetation_4\.rpf\/astral_vegmix\.ytyp|astral_vegetation\.rpf\/astral_vegmix_2\.ytyp)$/;
/* Второй пакет растительности (06.10.2026): свои четыре части, 5–8. */
const VEGETATION_DLC_B_ARCHIVE = "update/x64/dlcpacks/astral_vegetation_b/dlc.rpf";
const VEGETATION_DLC_B_ENTRY_PATTERN =
  /^astral_vegetation_(?:[5-8]|b_mp)\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(ytd|ydr|ydd|yft|ymap)$/;
/* Третий пакет растительности (19.11.2026): части 9–12, только у работ на три пакета. */
const VEGETATION_DLC_C_ARCHIVE = "update/x64/dlcpacks/astral_vegetation_c/dlc.rpf";
const VEGETATION_DLC_C_ENTRY_PATTERN =
  /^astral_vegetation_(?:9|1[0-2]|c_mp)\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(ytd|ydr|ydd|yft|ymap)$/;
/*
 * Пакет текстур Astral (`textures-dlc.js`, задача 1 ТЗ 05.10.2026): только
 * словари текстур и модели карты (со своими текстурами внутри) в его
 * потоковых архивах (до 48), только импортом слоями ресурсов.
 * Кто вправе так писать, решает строгая форма манифеста текстур
 * (`textures-manifest-trust.js`).
 */
const TEXTURES_DLC_ARCHIVE = "update/x64/dlcpacks/astral_textures/dlc.rpf";
const TEXTURES_DLC_ENTRY_PATTERN =
  /^astral_textures(?:_(?:[2-9]|[1-3][0-9]|4[0-8]))?\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ytd|ydr|ydd|yft)$/;
/*
 * Второй и третий пакеты текстур (ТЗ 17.10.2026) — каждый в своих 16 частях.
 * Во втором — модели ЧБ-мира (манифест 128 px без возможности чёткости); со
 * своей возможностью `direct-textures-detail-v1` (256 px) во втором и в
 * третьем — ещё и словари, что не влезли в первый. Без этой возможности
 * словарь во втором пакете и любой файл в третьем — отказ.
 */
const TEXTURES_DLC_B_ARCHIVE = "update/x64/dlcpacks/astral_textures_b/dlc.rpf";
const TEXTURES_DLC_B_ENTRY_PATTERN =
  /^astral_textures_b(?:_(?:[2-9]|1[0-6]))?\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ydd|yft)$/;
const TEXTURES_DLC_B_DETAIL_ENTRY_PATTERN =
  /^astral_textures_b(?:_(?:[2-9]|1[0-6]))?\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ytd|ydr|ydd|yft)$/;
const TEXTURES_DLC_C_ARCHIVE = "update/x64/dlcpacks/astral_textures_c/dlc.rpf";
const TEXTURES_DLC_C_DETAIL_ENTRY_PATTERN =
  /^astral_textures_c(?:_(?:[2-9]|1[0-6]))?\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ytd|ydr|ydd|yft)$/;
/*
 * Пакеты дорог Astral (`roads-dlc.js`, задача 6 ТЗ 07.10.2026): только
 * словари карты в их потоковых архивах (по две части в пакете), только
 * импортом слоями ресурсов. Кто вправе так писать, решает строгая форма
 * манифеста дорог (`roads-manifest-trust.js`).
 */
const ROADS_DLC_ARCHIVE = "update/x64/dlcpacks/astral_roads/dlc.rpf";
/* `_mp` — архив сетевой карты пакета (`GROUP_MAP`, 12.10.2026). */
const ROADS_DLC_ENTRY_PATTERN = /^astral_roads(?:_2|_mp)?\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.ytd$/;
/* Модели со встроенными листами дорог — только по возможности `direct-roads-models-v1`. */
const ROADS_DLC_MODEL_ENTRY_PATTERN = /^astral_roads(?:_2|_mp)?\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ydd|yft)$/;
const ROADS_DLC_B_MODEL_ENTRY_PATTERN = /^astral_roads_(?:[34]|b_mp)\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ydd|yft)$/;
const ROADS_DLC_B_ARCHIVE = "update/x64/dlcpacks/astral_roads_b/dlc.rpf";
const ROADS_DLC_B_ENTRY_PATTERN = /^astral_roads_(?:[34]|b_mp)\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.ytd$/;
/*
 * Пакет мест Astral (`places-dlc.js`, фикс 1 ТЗ 06.10.2026): файлы места —
 * модели, словари, типы, карты, манифест, клипы — только в потоковом
 * архиве своего места, только импортом слоями ресурсов. Кто вправе так
 * писать, решает строгая форма манифеста места
 * (`recolor-manifest-trust.js`). `_mp` — архивы сетевой карты места
 * (группа `GROUP_MAP`, файлы `hei_` аэропорта у ангара, 12.10.2026).
 */
const PLACES_DLC_ARCHIVE = "update/x64/dlcpacks/astral_places/dlc.rpf";
const PLACES_DLC_ENTRY_PATTERN =
  /^astral_(?:zones|factory|hangar|mapping|arenas|megamall|youtool|vinewood|busstops|mslzones|floatlogo|airships|shops|billboards|captzones|schedule|flags|atms)(?:_mp)?(?:\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ytd|ydr|ydd|yft|ycd|ybn)|_metadata\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ymap|ytyp))$/;
const AUDIO_DLC_CHUNK_PATTERN =
  /^x64\/audio\/astral_audio_(game\.dat151|sounds\.dat54)\.rel$/;
const AUDIO_DLC_BANK_PATTERN =
  /^x64\/audio\/sfx\/dlc_astral_audio\/[a-z0-9][a-z0-9_]{0,47}\.awc$/;

const isAwcArchive = (target) =>
  AWC_ARCHIVE_PATTERN.test(target) || AWC_DLC_ARCHIVE_PATTERN.test(target);

/* Архив и путь банка в нём: в общем архиве банк лежит в корне, в пакете
   дополнения — в звуковой папке пакета. */
function isAwcPlace(item) {
  const entry = String(item.entry || "");
  if (AWC_ARCHIVE_PATTERN.test(item.target))
    return AWC_ROOT_ENTRY_PATTERN.test(entry);
  if (AWC_DLC_ARCHIVE_PATTERN.test(item.target))
    return AWC_DLC_ENTRY_PATTERN.test(entry);
  return false;
}

function normalizeEntryMerge(value) {
  if (value == null) return null;
  const strategy = String(value?.strategy || "").trim();
  if (strategy === "rpf-resource-layer-v1") {
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "strategy")
    ) {
      throw new Error("Некорректная политика слоёв ресурса RPF.");
    }
    return { strategy };
  }
  if (strategy === "blood-routing-v1") {
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "strategy")
    ) {
      throw new Error("Некорректная политика маршрутов bloodfx.dat.");
    }
    return { strategy };
  }
  if (strategy === WEAPONS_META_STRATEGY) {
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "strategy")
    ) {
      throw new Error("Некорректная политика привязок трассеров weapons.meta.");
    }
    return { strategy };
  }
  if (
    strategy === "audio-rel-patch-v1" ||
    strategy === "astral-audio-chunk-v1"
  ) {
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "strategy")
    ) {
      throw new Error("Некорректная политика правки звуковых метаданных.");
    }
    return { strategy };
  }
  if (strategy === "astral-tracer-v1") {
    const allowed = new Set([
      "strategy",
      "role",
      "schemaVersion",
      "coreChannel",
      "coreVersion",
      "weapons",
      "chanceSP",
      "chanceMP",
    ]);
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.has(key)) ||
      !["core", "weapons"].includes(value.role) ||
      value.schemaVersion !== ASTRAL_TRACER_SCHEMA ||
      !knownPtfxCore(value.coreChannel, value.coreVersion)
    ) {
      throw new Error("Некорректная политика композиции трассера Astral.");
    }
    const weapons = normalizeTracerWeapons("selected", value.weapons);
    const chanceSP = Number(value.chanceSP);
    const chanceMP = Number(value.chanceMP);
    if (
      ![chanceSP, chanceMP].every(
        (chance) => Number.isFinite(chance) && chance >= 0 && chance <= 1,
      )
    ) {
      throw new Error("Некорректная вероятность трассера Astral.");
    }
    return {
      strategy,
      role: value.role,
      schemaVersion: value.schemaVersion,
      coreChannel: value.coreChannel,
      coreVersion: value.coreVersion,
      weapons,
      chanceSP,
      chanceMP,
    };
  }
  if (strategy === "ypt-texture-layer-v1") {
    const allowed = new Set([
      "strategy",
      "coreChannel",
      "coreVersion",
      "texture",
      "slot",
    ]);
    const texture = String(value?.texture || "").trim();
    const slot = cleanId(value?.slot);
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.has(key)) ||
      !knownPtfxCore(value.coreChannel, value.coreVersion) ||
      /* Штатные текстуры ядра бывают с подчёркиванием в начале (`_explosion_fireball`). */
      !/^[a-z0-9_][a-z0-9_]{0,119}$/i.test(texture) ||
      !slot
    ) {
      throw new Error("Некорректная политика композиции текстуры PTFX.");
    }
    return {
      strategy,
      coreChannel: value.coreChannel,
      coreVersion: value.coreVersion,
      texture,
      slot,
    };
  }
  /*
   * Правка штатных правил ядра игрока (`ypt-rule-patch-v1`, «наш Core», Х20): JSON кадров автора поверх правил
   * игрока. Только путь «ядро игрока»: системного ядра для неё нет и не будет.
   */
  if (strategy === "ypt-rule-patch-v1") {
    const allowed = new Set(["strategy", "coreChannel", "coreVersion", "slot"]);
    const slot = cleanId(value?.slot);
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.has(key)) ||
      value.coreChannel !== ASTRAL_PTFX_PLAYER_CORE_CHANNEL ||
      value.coreVersion !== ASTRAL_PTFX_PLAYER_CORE_VERSION ||
      !slot
    ) {
      throw new Error("Некорректная политика правки правил ядра эффектов.");
    }
    return {
      strategy,
      coreChannel: value.coreChannel,
      coreVersion: value.coreVersion,
      slot,
    };
  }
  /*
   * Строки сетки кадров своих листов автора в ptxclipregions.dat (`ptx-clip-rows-v1`, при своих правилах того же
   * пакета): JSON строк под именами листов в ядре игрока; файл собирает установщик из файла игрока.
   */
  if (strategy === "ptx-clip-rows-v1") {
    const prefix = String(value?.prefix || "");
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !["strategy", "prefix"].includes(key)) ||
      !OWN_RULE_PREFIX.test(prefix)
    ) {
      throw new Error("Некорректная политика строк кадров ptxclipregions.dat.");
    }
    return { strategy, prefix };
  }
  /*
   * Свои правила автора редукса (`ypt-own-rules-v1`, «наш Core», этап 2, Х20): словарь-донор только с правилами и
   * листами автора; установщик клонирует их в ядро игрока под приставкой пакета `astral_own_<6 hex>_`.
   */
  if (strategy === "ypt-own-rules-v1") {
    const allowed = new Set(["strategy", "coreChannel", "coreVersion", "slot", "prefix", "rules", "gameSheets"]);
    const slot = cleanId(value?.slot);
    const prefix = String(value?.prefix || "");
    const rules = Array.isArray(value?.rules) ? value.rules.map(String) : [];
    /* Листы Rockstar, которые автор взял без правки: в доноре они пустые, установщик берёт их из игры игрока. */
    const gameSheets = value?.gameSheets === undefined ? [] : value.gameSheets;
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.has(key)) ||
      value.coreChannel !== ASTRAL_PTFX_PLAYER_CORE_CHANNEL ||
      value.coreVersion !== ASTRAL_PTFX_PLAYER_CORE_VERSION ||
      !slot ||
      !OWN_RULE_PREFIX.test(prefix) ||
      !rules.length ||
      rules.length > 16 ||
      new Set(rules.map((rule) => rule.toLowerCase())).size !== rules.length ||
      rules.some((rule) => !OWN_RULE_NAME.test(rule) || `${prefix}${rule}`.length > 55) ||
      !Array.isArray(gameSheets) ||
      gameSheets.length > 32 ||
      gameSheets.some(
        (sheet) =>
          !sheet ||
          typeof sheet !== "object" ||
          Object.keys(sheet).some((key) => !["texture", "dictionary"].includes(key)) ||
          !OWN_RULE_NAME.test(String(sheet.texture || "")) ||
          !OWN_GAME_DICTIONARIES.has(sheet.dictionary),
      )
    ) {
      throw new Error("Некорректная политика своих правил автора в ядре эффектов.");
    }
    return {
      strategy,
      coreChannel: value.coreChannel,
      coreVersion: value.coreVersion,
      slot,
      prefix,
      rules,
      ...(gameSheets.length ? { gameSheets: gameSheets.map((sheet) => ({ texture: String(sheet.texture), dictionary: sheet.dictionary })) } : {}),
    };
  }
  if (strategy === "ptfx-core-base-v1") {
    const allowed = new Set(["strategy", "coreChannel", "coreVersion"]);
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.has(key)) ||
      value.coreChannel !== ASTRAL_PTFX_CORE_CHANNEL ||
      value.coreVersion !== ASTRAL_PTFX_CORE_VERSION
    ) {
      throw new Error("Некорректная политика базового Astral PTFX Core.");
    }
    return {
      strategy,
      coreChannel: value.coreChannel,
      coreVersion: value.coreVersion,
    };
  }
  if (strategy === "awc-stream-layer-v1") {
    /* `drop` — дорожки основы, которые слой убирает из банка целиком: звук
       попадания так освобождает служебную память слота под свои пики. */
    const allowed = new Set([
      "strategy",
      "streams",
      "bank",
      "completeBank",
      "drop",
    ]);
    const bank = cleanId(value?.bank);
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.has(key)) ||
      !bank ||
      !Array.isArray(value.streams) ||
      value.streams.length === 0 ||
      value.streams.length > 2048
    ) {
      throw new Error("Некорректная политика композиции звука AWC.");
    }
    const streams = [
      ...new Set(
        value.streams.map((item) => String(item).trim().toUpperCase()),
      ),
    ].sort();
    if (
      streams.length !== value.streams.length ||
      streams.some((item) => !/^0X[0-9A-F]{8}$/.test(item))
    ) {
      throw new Error(
        "Список потоков AWC содержит дубли или неверные hash ID.",
      );
    }
    if (value.completeBank != null && typeof value.completeBank !== "boolean") {
      throw new Error("completeBank AWC должен быть логическим значением.");
    }
    if (value.drop != null && !Array.isArray(value.drop))
      throw new Error("Список убираемых потоков AWC должен быть массивом.");
    const drop = [
      ...new Set(
        (value.drop || []).map((item) => String(item).trim().toUpperCase()),
      ),
    ].sort();
    if (
      drop.length !== (value.drop || []).length ||
      drop.length > 64 ||
      drop.some(
        (item) => !/^0X[0-9A-F]{8}$/.test(item) || streams.includes(item),
      ) ||
      (drop.length > 0 && value.completeBank === true)
    ) {
      throw new Error(
        "Список убираемых потоков AWC содержит дубли, неверные hash ID или заменяемые потоки.",
      );
    }
    return {
      strategy,
      bank,
      streams,
      ...(value.completeBank === true ? { completeBank: true } : {}),
      ...(drop.length ? { drop } : {}),
    };
  }
  /* Коллекция наложений педа — место тату мастерской одежды (задача 3 ТЗ
     06.10.2026, вечер): свои наложения поверх файла по `nameHash`. */
  if (strategy === DECORATION_OVERLAY_STRATEGY) {
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) => !["strategy", "priority", "includeNames"].includes(key),
      )
    )
      throw new Error("Некорректная политика объединения коллекции наложений.");
    const priority = Number(value.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000)
      throw new Error("Некорректная политика объединения коллекции наложений.");
    const names = Array.isArray(value.includeNames)
      ? value.includeNames.map((item) => String(item).trim())
      : [];
    if (
      !names.length ||
      names.length > 128 ||
      names.some((name) => !DECORATION_NAME_PATTERN.test(name)) ||
      new Set(names.map((name) => name.toLowerCase())).size !== names.length
    )
      throw new Error("Некорректный список наложений коллекции.");
    return { strategy, priority, includeNames: names };
  }
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["strategy", "priority", "includeNames", "excludeNames"].includes(key),
    )
  ) {
    throw new Error("Некорректная политика объединения RPF-entry.");
  }
  const priority = Number(value.priority);
  if (
    strategy !== "timecycle-modifier-v1" ||
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority > 1000
  ) {
    throw new Error("Некорректная политика объединения timecycle XML.");
  }
  /* Список имён: includeNames берёт из файла только названные модификаторы, excludeNames — все, кроме названных
     (килл-эффект исключают из таймцикла, где модификаторов больше ста двадцати восьми). Оба сразу не бывают. */
  const readNames = (list) => {
    if (!Array.isArray(list) || list.length > 128) {
      throw new Error("Некорректный список timecycle-модификаторов.");
    }
    const names = list.map((item) => String(item).trim());
    if (
      names.length === 0 ||
      names.some(
        (name) =>
          !name ||
          name.length > 160 ||
          [...name].some((character) => character.charCodeAt(0) <= 0x1f),
      ) ||
      new Set(names.map((name) => name.toLowerCase())).size !== names.length
    ) {
      throw new Error("Некорректный список timecycle-модификаторов.");
    }
    return names;
  };
  if (value.includeNames != null && value.excludeNames != null)
    throw new Error("Некорректная политика объединения timecycle XML.");
  const includeNames = value.includeNames != null ? readNames(value.includeNames) : undefined;
  const excludeNames = value.excludeNames != null ? readNames(value.excludeNames) : undefined;
  return {
    strategy,
    priority,
    ...(includeNames ? { includeNames } : {}),
    ...(excludeNames ? { excludeNames } : {}),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "signature")
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  return value;
}

export function canonicalManifest(manifest) {
  return JSON.stringify(stableValue(manifest));
}

export function mergeDlcListXml(xml, dlcNames) {
  const source = String(xml || "");
  if (!/<Paths\b[^>]*>/i.test(source) || !/<\/Paths>/i.test(source)) {
    throw new Error("dlclist.xml не содержит корректный элемент Paths.");
  }
  const names = [
    ...new Set(
      (dlcNames || []).map((item) => String(item).trim().toLowerCase()),
    ),
  ]
    .filter((item) => /^[a-z0-9][a-z0-9_]{0,63}$/.test(item))
    .sort((a, b) => a.localeCompare(b));
  let result = source;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  for (const name of names) {
    const registration = `dlcpacks:/${name}/`;
    if (
      new RegExp(
        `<Item>\\s*${registration.replaceAll("/", "\\/")}\\s*<\\/Item>`,
        "i",
      ).test(result)
    ) {
      continue;
    }
    const closingIndex = result.toLowerCase().indexOf("</paths>");
    if (closingIndex < 0) {
      throw new Error(
        "dlclist.xml no longer contains a closing Paths element.",
      );
    }
    let indentationStart = closingIndex;
    while (
      indentationStart > 0 &&
      (result[indentationStart - 1] === " " ||
        result[indentationStart - 1] === "\t")
    ) {
      indentationStart -= 1;
    }
    const indentation = result.slice(indentationStart, closingIndex);
    result = `${result.slice(0, indentationStart)}${indentation}\t<Item>${registration}</Item>${newline}${indentation}${result.slice(closingIndex)}`;
  }
  return result;
}

/*
 * Регистрации Astral в основе.
 *
 * Основа сборки бывает не оригиналом, а перебазированным живым архивом —
 * после нативного патча неба, мини-карты или прицела. В его content.xml и
 * dlclist.xml уже стоят наши прежние строки. Оставь их в основе — и снятый
 * контейнер остался бы зарегистрированным: игра полезла бы за архивом,
 * которого нет или который пуст, и упала бы с ERR_SYS_FILELOAD. Поэтому
 * основа всегда очищается от строк Astral, а движок пишет ровно те, чьи
 * контейнеры и DLC стоят сейчас. Сниматься они должны байт в байт так, как
 * их вставляют `mergeAstralContentXml` и `mergeDlcListXml`.
 */
const ASTRAL_DATA_FILE_ITEM =
  /[ \t]*<Item>\s*<filename>\s*update2?:\/(?:%PLATFORM%|x64)\/astral\/[^<]*<\/filename>[\s\S]*?<\/Item>[ \t]*(?:\r?\n)?/gi;
const ASTRAL_CHANGESET_ITEM =
  /[ \t]*<Item>\s*update2?:\/(?:%PLATFORM%|x64)\/astral\/[^<]*<\/Item>[ \t]*(?:\r?\n)?/gi;
const ASTRAL_DLC_ITEM =
  /[ \t]*<Item>\s*dlcpacks:\/astral_[a-z0-9_]*\/\s*<\/Item>[ \t]*(?:\r?\n)?/gi;

/** content.xml без регистраций Astral и список снятых контейнеров. */
export function stripAstralContentXml(xml) {
  const source = String(xml || "");
  const removed = [];
  const text = source
    .replace(ASTRAL_DATA_FILE_ITEM, (item) => {
      const name = /astral\/([^<\s]+)/i.exec(item)?.[1];
      if (name) removed.push(name.toLowerCase());
      return "";
    })
    .replace(ASTRAL_CHANGESET_ITEM, "");
  return { xml: text, removed: [...new Set(removed)].sort() };
}

/** dlclist.xml без регистраций DLC Astral и список снятых. */
export function stripAstralDlcListXml(xml) {
  const source = String(xml || "");
  const removed = [];
  const text = source.replace(ASTRAL_DLC_ITEM, (item) => {
    const name = /dlcpacks:\/(astral_[a-z0-9_]*)\//i.exec(item)?.[1];
    if (name) removed.push(name.toLowerCase());
    return "";
  });
  return { xml: text, removed: [...new Set(removed)].sort() };
}

/* `carrierEntries` — контейнеры в носителе `update2.rpf`: строки с корнем `update2:/%PLATFORM%/astral` (`carrier-targets.js`), форма та же, что у `update:/…`. */
export function mergeAstralContentXml(xml, archiveEntries, carrierEntries = []) {
  const source = String(xml || "");
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(source)) {
    throw new Error(
      "content.xml contains forbidden DTD or entity declarations.",
    );
  }
  if (
    !/<CDataFileMgr__ContentsOfDataFileXml\b[^>]*>/i.test(source) ||
    !/<dataFiles\b[^>]*>[\s\S]*<\/dataFiles>/i.test(source)
  ) {
    throw new Error(
      "content.xml does not contain the expected GTA V content structure.",
    );
  }
  const streamingFiles = (value) =>
    value.match(
      /<changeSetName>\s*CCS_TITLE_UPDATE_STREAMING\s*<\/changeSetName>[\s\S]*?<filesToEnable\b[^>]*>[\s\S]*?<\/filesToEnable>/i,
    )?.[0];
  if (!streamingFiles(source)) {
    throw new Error(
      "content.xml does not contain CCS_TITLE_UPDATE_STREAMING/filesToEnable.",
    );
  }
  const root = new RegExp(`^${ASTRAL_CONTAINER_ROOT}/`, "i");
  const namesOf = (list) => {
    const names = [
      ...new Set(
        (list || []).map((entry) =>
          canonicalArchiveEntry(normalizeRelativePath(entry)).replace(root, ""),
        ),
      ),
    ]
      .filter((entry) => /^[a-z0-9][a-z0-9._-]{0,119}\.rpf$/.test(entry))
      .sort((a, b) => a.localeCompare(b));
    if (names.length !== new Set((list || []).map(canonicalArchiveEntry)).size) {
      throw new Error(
        `Astral content registry accepts only ${ASTRAL_CONTAINER_ROOT}/<name>.rpf entries.`,
      );
    }
    return names;
  };
  const entries = namesOf(archiveEntries);
  const carriers = namesOf(carrierEntries);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  /* Регистрации прежних сборок (в том числе с заглавной `Astral`) снимаются
     до записи новых: строка контейнера пишется ровно одна и ровно так, как
     её прочтёт игра. */
  let result = stripAstralContentXml(source).xml;
  const registered = [
    ...entries.map((entry) => `${ASTRAL_REGISTRATION_ROOT}/${entry}`),
    ...carriers.map((entry) => `${CARRIER_REGISTRATION_ROOT}/${entry}`),
  ];
  for (const filename of registered) {
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      !new RegExp(`<filename>\\s*${escaped}\\s*<\\/filename>`, "i").test(result)
    ) {
      const dataItem = [
        "\t\t<Item>",
        `\t\t\t<filename>${filename}</filename>`,
        "\t\t\t<fileType>RPF_FILE</fileType>",
        '\t\t\t<locked value="true"/>',
        '\t\t\t<disabled value="true"/>',
        '\t\t\t<persistent value="true"/>',
        '\t\t\t<overlay value="true"/>',
        "\t\t</Item>",
      ].join(newline);
      result = result.replace(
        /([ \t]*)<\/dataFiles>/i,
        `${dataItem}${newline}$1</dataFiles>`,
      );
    }
    const currentStreaming = streamingFiles(result);
    if (
      !new RegExp(`<Item>\\s*${escaped}\\s*<\\/Item>`, "i").test(
        currentStreaming || "",
      )
    ) {
      result = result.replace(
        /(<Item>\s*<changeSetName>\s*CCS_TITLE_UPDATE_STREAMING\s*<\/changeSetName>[\s\S]*?<filesToEnable\b[^>]*>[\s\S]*?)([ \t]*)<\/filesToEnable>/i,
        `$1\t\t\t\t<Item>${filename}</Item>${newline}$2</filesToEnable>`,
      );
    }
  }
  return result;
}

/*
 * `publicKey` — PEM одного ключа или нескольких подряд: локального каталога и
 * облачного (`catalog-key.js`). Подпись принимается, если её подтверждает
 * любой из них.
 */
export function verifyManifest(manifest, publicKey) {
  if (!manifest?.signature || !publicKey) return false;
  const keys =
    typeof publicKey === "string"
      ? (publicKey.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? [publicKey])
      : [publicKey];
  let data;
  try {
    data = Buffer.from(canonicalManifest(manifest));
  } catch {
    return false;
  }
  const signature = Buffer.from(String(manifest.signature), "base64");
  return keys.some((key) => {
    try {
      return verifySignature(null, data, key, signature);
    } catch {
      return false;
    }
  });
}

export function normalizeRelativePath(value, { allowExecutable = false } = {}) {
  const raw = String(value || "")
    .trim()
    .replace(/\\/g, "/");
  if (
    !raw ||
    raw.includes("\0") ||
    path.posix.isAbsolute(raw) ||
    /^[a-z]:/i.test(raw)
  )
    throw new Error("Путь файла должен быть относительным.");
  const parts = raw.split("/");
  /* Одно правило звена для всех (`mod-targets/file-names.js`): поток NTFS, хвостовая точка и пробел, имена устройств,
     знаки направления текста. Расширение смотрится только после него: до него часть имени расширением не считалась. */
  for (const part of parts) {
    const problem = nameSegmentProblem(part);
    if (problem === "empty" || problem === "dots")
      throw new Error("Путь файла содержит недопустимый сегмент.");
    if (problem)
      throw new Error(`Путь файла содержит недопустимый сегмент: ${nameSegmentReason(problem)}.`);
  }
  const normalized = parts.join("/");
  if (normalized.length > 240) throw new Error("Путь файла слишком длинный.");
  if (!allowExecutable && hasForbiddenExtension(normalized))
    throw new Error(`Исполняемый файл запрещён в пакете: ${normalized}`);
  return normalized;
}

export function resolveInside(root, relative) {
  const base = path.resolve(root);
  const candidate = path.resolve(
    base,
    ...normalizeRelativePath(relative, { allowExecutable: true }).split("/"),
  );
  const diff = path.relative(base, candidate);
  if (diff.startsWith("..") || path.isAbsolute(diff))
    throw new Error("Путь выходит за пределы разрешённой папки.");
  return candidate;
}

/*
 * Кусками до 4 МБ (задача 8, 05.10.2026): поток по 64 КБ читал
 * двухгигабайтный update.rpf 4–5 с, а движок считает его отпечаток на каждой
 * установке; так — 1,2 с. Мелкий файл берёт буфер своего размера.
 */
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

export async function sha256File(file) {
  const hash = createHash("sha256");
  const { size: known } = await fs.stat(file);
  /* Большой файл читается своей очередью и с отдыхом диска (`disk-care.js`): иначе проверка двух гигабайт — это диск в 100 % на всё время чтения. */
  const careful = known >= CAREFUL_MIN_BYTES;
  const handle = await fs.open(file, careful ? carefulReadFlags() : "r");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(HASH_CHUNK_BYTES, size || 1)));
    const read = async () => {
      await throttledOp(buffer.length);
      return handle.read(buffer, 0, buffer.length, null);
    };
    for (;;) {
      const { bytesRead } = await (careful ? diskTurn(read, { measure: { kind: "read", bytes: buffer.length, place: file } }) : read());
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

/*
 * Путь записи внутри архива — строчными, как её ищет игра
 * (`astral-paths.js`). Приводится здесь, на входе: отсюда путь уходит и в
 * ключи состояния, и в операции helper, и старый манифест с `x64/Astral`
 * встаёт туда же, куда новый.
 */
function normalizeRpfEntryPath(value, { allowArchiveContainer = false } = {}) {
  const normalized = canonicalArchiveEntry(normalizeRelativePath(value));
  if (
    path.posix.extname(normalized).toLowerCase() === ".rpf" &&
    !allowArchiveContainer
  )
    throw new Error(
      "Путь RPF-entry должен указывать на файл внутри архива, а не на архив-контейнер.",
    );
  return normalized;
}

/* Пак тату из каталога (Т-101): потолок наложений и имена, которые тату
   быть не могут, — ствол, расцветка или модель вещи, сам пед. Тот же список —
   в подписи (manifest-authority). */
const TATTOO_PACK_LIMIT = 64;
const NOT_A_TATTOO =
  /^w_|^(?:p_)?[a-z]{3,6}_(?:diff|norm(?:al)?|spec)_\d{3}|^(?:p_)?[a-z]{3,6}_\d{3}(?:_|$)|^mp_[mf]_freemode_01/;

export function validateManifest(
  manifest,
  edition,
  { allowGameRootWrites = false, projectInteriorsData = false } = {},
) {
  const id = cleanId(manifest?.id);
  if (!id) throw new Error("В манифесте отсутствует id модификации.");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0)
    throw new Error("В пакете нет файлов для установки.");
  /* Ступень «Ухудшения текстур» на всю карту — около двадцати тысяч словарей
     и двадцати тысяч моделей (задача 1 ТЗ 05.10.2026); их форму держит
     строгая проверка доверия. */
  /* Растительность (с согласия владельца, ТЗ 11.10.2026, день, задача 3):
     его набор «всё сразу» — 5 242 файла, с засаженностью 100 % — 5 822.
     Форму пакета держит её проверка доверия: каждый файл — из описи
     растительности (`vegetation-manifest-trust.js`). */
  const declared = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const fileLimit = declared.includes("direct-textures-dlc-v1") || declared.includes("direct-textures-dlc-b-v1") || declared.includes("direct-textures-dlc-c-v1") || declared.includes("direct-textures-detail-v1")
    ? 80000
    : declared.includes("direct-vegetation-dlc-v1") || declared.includes("direct-vegetation-dlc-b-v1") || declared.includes("direct-vegetation-dlc-c-v1")
      ? 8000
      : 5000;
  if (manifest.files.length > fileLimit)
    throw new Error("Пакет содержит слишком много файлов.");
  if (
    Array.isArray(manifest.editions) &&
    edition &&
    !manifest.editions.includes(edition)
  )
    throw new Error(`Пакет несовместим с GTA V ${edition}.`);
  const capabilities = Array.isArray(manifest.capabilities)
    ? [...new Set(manifest.capabilities.map(cleanId).filter(Boolean))]
    : [];
  const loaderInstall =
    allowGameRootWrites && capabilities.includes("loader-install-v1");
  const allowRpfContainers = capabilities.includes("rpf-container-entry-v1");
  const astralContentRpf = capabilities.includes("astral-content-rpf-v1");
  const directUpdateRpf = capabilities.includes("direct-update-rpf-v1");
  const directUpdateEntries = capabilities.includes("direct-update-entries-v1");
  const directWeaponDlc = capabilities.includes("direct-weapon-dlc-v1");
  const directClothingDlc = capabilities.includes("direct-clothing-dlc-v1");
  const timecycleModifierMerge = capabilities.includes(
    "timecycle-modifier-merge-v1",
  );
  const decorationOverlayMerge = capabilities.includes(
    DECORATION_OVERLAY_CAPABILITY,
  );
  const astralTracer = capabilities.includes("astral-tracer-v1");
  const ptfxTextureLayer = capabilities.includes("ypt-texture-layer-v1");
  const ptfxRulePatch = capabilities.includes("ypt-rule-patch-v1");
  const ptfxCoreBase = capabilities.includes("ptfx-core-base-v1");
  const awcStreamLayer = capabilities.includes("awc-stream-layer-v1");
  const bloodRouting = capabilities.includes("blood-routing-v1");
  const ptfxOwnRules = capabilities.includes("ypt-own-rules-v1");
  const clipRows = capabilities.includes("ptx-clip-rows-v1");
  const audioRelPatch = capabilities.includes("audio-rel-patch-v1");
  const weaponsMetaPatch = capabilities.includes(WEAPONS_META_STRATEGY);
  const directAudioDlc = capabilities.includes("direct-audio-dlc-v1");
  const directVegetationDlc = capabilities.includes("direct-vegetation-dlc-v1");
  const directVegetationDlcB = capabilities.includes("direct-vegetation-dlc-b-v1");
  const directVegetationDlcC = capabilities.includes("direct-vegetation-dlc-c-v1");
  const directTexturesDlc = capabilities.includes("direct-textures-dlc-v1");
  const directTexturesDlcB = capabilities.includes("direct-textures-dlc-b-v1");
  const directTexturesDlcC = capabilities.includes("direct-textures-dlc-c-v1");
  const directTexturesDetail = capabilities.includes("direct-textures-detail-v1");
  const directRoadsDlc = capabilities.includes("direct-roads-dlc-v1");
  const directRoadsDlcB = capabilities.includes("direct-roads-dlc-b-v1");
  const directRoadsModels = capabilities.includes("direct-roads-models-v1");
  const directPlacesDlc = capabilities.includes("direct-places-dlc-v1");
  const audioChunk = capabilities.includes("astral-audio-chunk-v1");
  const files = manifest.files.map((item) => {
    const action = String(item.action || "replace")
      .trim()
      .toLowerCase();
    return {
      action,
      source:
        action === "delete"
          ? null
          : normalizeRelativePath(item.source, {
              allowExecutable: loaderInstall,
            }),
      target: normalizeRelativePath(item.target, {
        allowExecutable: loaderInstall,
      }),
      ...(item.entry == null
        ? {}
        : {
            entry: normalizeRpfEntryPath(item.entry, {
              allowArchiveContainer: allowRpfContainers,
            }),
          }),
      sha256: String(item.sha256 || "").toLowerCase(),
      /* Маска: удалить запись, если она есть, — у скина мастерской поверх
         модели каталога (Т-107b). Без записи — ничего не делать. */
      ...(action === "delete" && item.allowMissing === true
        ? { allowMissing: true }
        : {}),
      ...(item.merge == null ? {} : { merge: normalizeEntryMerge(item.merge) }),
      size:
        action !== "delete" &&
        Number.isFinite(Number(item.size)) &&
        Number(item.size) >= 0
          ? Number(item.size)
          : null,
    };
  });
  /* Пакет данных «Интерьеров проектов» (`project-interiors-data.js`): как мод он не ставится,
     а скачивает его только редактор — и только такой строгой формы. */
  if (capabilities.includes(PROJECT_INTERIORS_DATA_CAPABILITY))
    assertProjectInteriorsData({ id, files }, { allowed: projectInteriorsData });
  const adapter = [
    "file-overlay",
    "rpf-overlay",
    "rpf-entry",
    "rageopenv-loose",
    "managed-addon-dlc",
    "gta-settings",
  ].includes(manifest.adapter)
    ? manifest.adapter
    : files.every((item) => path.extname(item.target).toLowerCase() === ".rpf")
      ? "rpf-overlay"
      : "file-overlay";
  if (
    !allowGameRootWrites &&
    files.some(
      (item) =>
        !isModsTarget(item.target) &&
        !(
          ["rageopenv-loose", "managed-addon-dlc"].includes(adapter) &&
          isNewModsTarget(item.target)
        ) &&
        !(
          adapter === "gta-settings" &&
          item.target.toLowerCase() === "settings.xml"
        ),
    )
  )
    throw new Error(
      "Пакет может записывать файлы только в изолированные каталоги mods или в разрешённый RageOpenV newmods.",
    );
  if (loaderInstall) {
    const declaredEditions = Array.isArray(manifest.editions)
      ? [...new Set(manifest.editions)]
      : [];
    const loaderEdition =
      edition || (declaredEditions.length === 1 ? declaredEditions[0] : null);
    const expected =
      loaderEdition === "Legacy"
        ? new Set(["dinput8.dll", "rageopenv.asi"])
        : loaderEdition === "Enhanced"
          ? new Set(["xinput1_4.dll", "rageopenv.asi"])
          : null;
    const actual = new Set(files.map((item) => item.target.toLowerCase()));
    const sources = new Set(
      files.map((item) => String(item.source || "").toLowerCase()),
    );
    if (
      !expected ||
      declaredEditions.length !== 1 ||
      declaredEditions[0] !== loaderEdition ||
      manifest.scope !== "game-root" ||
      adapter !== "file-overlay" ||
      files.length !== 2 ||
      files.some((item) => item.action !== "replace") ||
      actual.size !== expected.size ||
      sources.size !== expected.size ||
      [...expected].some((item) => !actual.has(item) || !sources.has(item))
    ) {
      throw new Error(
        "Capability loader-install-v1 разрешает только точную подписанную пару RageOpenV и совместимого ASI loader для выбранной редакции GTA V.",
      );
    }
  }
  const directWeaponTarget = "update/x64/dlcpacks/astral_weapons/dlc.rpf";
  if (
    directWeaponDlc &&
    (!allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      files.some(
        (item) =>
          item.target.toLowerCase() !== directWeaponTarget ||
          /* Маска скина поверх модели каталога (Т-107b) — `delete` с
             `allowMissing`; кто вправе её класть, решает доверие. */
          (item.action !== "import" &&
            !(item.action === "delete" && item.allowMissing === true)) ||
          !/^astral_stream\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(ydr|ytd)$/i.test(
            item.entry || "",
          ),
      ) ||
      !Array.isArray(manifest.slots) ||
      !manifest.slots.some((slot) => /^weapon-[a-z0-9._-]+$/i.test(slot)))
  ) {
    throw new Error(
      "Capability direct-weapon-dlc-v1 is restricted to signed weapon models inside the prepared Astral Weapons DLC.",
    );
  }
  const directClothingTarget = "update/x64/dlcpacks/astral_clothing/dlc.rpf";
  /*
   * Тату сервера (Т-65; зона отладки-1, согласовано с тимлидом): картинка
   * наложения лежит у корня потокового архива, как у Rockstar в
   * `*_overlays.rpf`, — игра ищет её по имени. Только пакет, у которого
   * единственный слот `server-tattoo-<txd>` и единственный файл `<txd>.ytd`;
   * путь сверяется до нормализации — без заглавных, подпапок и «..».
   */
  const serverTattoo =
    Array.isArray(manifest.slots) &&
    manifest.slots.length > 0 &&
    manifest.slots.every((slot) => /^server-tattoo-/.test(slot));
  const tattooName =
    serverTattoo && manifest.slots.length === 1
      ? /^server-tattoo-([a-z0-9][a-z0-9_]{0,63})$/.exec(manifest.slots[0])?.[1]
      : null;
  /* Под видом тату — не словарь ствола и не расцветка одежды. */
  const tattooTxd =
    tattooName &&
    !/^w_|^(?:p_)?[a-z]{3,6}_(?:diff|norm(?:al)?|spec)_\d{3}/.test(tattooName)
      ? tattooName
      : null;
  /*
   * Тату-мод наложениями из каталога (Т-101, та же зона и то же место, что
   * у Т-65, согласовано с тимлидом): пак словарей — слот `tattoo-<txd>` на
   * каждый и ровно по файлу `astral_stream_00.rpf/<txd>.ytd` на слот, имена
   * совпадают; те же запреты имени, что у тату сервера.
   */
  const modTattoo =
    Array.isArray(manifest.slots) &&
    manifest.slots.length > 0 &&
    manifest.slots.every((slot) => /^tattoo-/.test(slot));
  const modTattooNames = modTattoo
    ? manifest.slots.map(
        (slot) => /^tattoo-([a-z0-9][a-z0-9_]{0,63})$/.exec(slot)?.[1] || null,
      )
    : [];
  /* Коллекции места тату (`decoration-overlay-v1`) — не картинки пака. */
  const modTattooEntries = modTattoo
    ? manifest.files.filter((item) => !item?.merge).map(
        (item) =>
          /^astral_stream_00\.rpf\/([a-z0-9][a-z0-9_]{0,63})\.ytd$/.exec(
            String(item.entry || ""),
          )?.[1] || null,
      )
    : [];
  const modTattooAllowed =
    modTattoo &&
    modTattooNames.length <= TATTOO_PACK_LIMIT &&
    modTattooNames.every((name) => name && !NOT_A_TATTOO.test(name)) &&
    new Set(modTattooNames).size === modTattooNames.length &&
    modTattooEntries.length === modTattooNames.length &&
    modTattooEntries.every(Boolean) &&
    [...modTattooEntries].sort().join("|") ===
      [...modTattooNames].sort().join("|");
  const clothingEntryAllowed = serverTattoo
    ? tattooTxd &&
      manifest.files.length === 1 &&
      /^astral_stream_00\.rpf\/([a-z0-9][a-z0-9_]{0,63})\.ytd$/.exec(
        String(manifest.files[0].entry || ""),
      )?.[1] === tattooTxd
    : modTattoo
      ? modTattooAllowed
      : !files.some(
          (item) =>
            !(
              /^astral_stream_(?:00|01)\.rpf\/(mp_f_freemode_01|mp_m_freemode_01)[a-z0-9._+~/-]{1,220}\.(ydd|ytd)$/i.test(
                item.entry || "",
              ) ||
              /* Сюжетные герои (20.11.2026, снято лидом 1: верх и штаны Франклина через контейнер в сюжетке): ровно шесть папок — `player_zero|one|two` и их `_p`, одно имя файла
                 тем же строгим правилом, что у маршрута (`clothing-update-route.js`, LEAF): строчные, без папок и «..». Ставится только маршрутом через update.rpf: без выключателя
                 пакет героя отказан при планировании (`refuseHeroWithoutContainer`). */
              CLOTHING_HERO_ENTRY.test(item.entry || "")
            ),
        ) &&
        Array.isArray(manifest.slots) &&
        manifest.slots.some((slot) => /^clothing-[a-z0-9._-]+$/i.test(slot)) &&
        /* Одежда вперемешку с тату — отказ: у тату своя форма. */
        !manifest.slots.some((slot) => /^(?:server-)?tattoo-/i.test(slot));
  /*
   * Место тату под рисунок (ТЗ 06.10.2026, вечер, задача 3): пак тату рядом
   * с картинками несёт коллекции наложений этих тату в update.rpf
   * (`decoration-overlay-v1`). Только ради этой пары правила «Clothing DLC —
   * только Clothing DLC» и «direct-update — только update.rpf» раздвигаются.
   */
  const tattooPlaces = modTattoo && directClothingDlc && decorationOverlayMerge;
  const placeBesideTattoos = (item) =>
    tattooPlaces &&
    item.merge?.strategy === DECORATION_OVERLAY_STRATEGY &&
    item.target.toLowerCase() === "update/update.rpf";
  /* Потолок пака — отказ словами, а не общей фразой о возможности. */
  if (
    directClothingDlc &&
    modTattoo &&
    modTattooNames.length > TATTOO_PACK_LIMIT
  )
    throw new Error(
      `В паке тату ${modTattooNames.length} наложений — больше ${TATTOO_PACK_LIMIT} в один пакет не входит.`,
    );
  if (
    directClothingDlc &&
    (!allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      files.some(
        (item) =>
          !placeBesideTattoos(item) &&
          (item.target.toLowerCase() !== directClothingTarget ||
            item.action !== "import"),
      ) ||
      !clothingEntryAllowed)
  ) {
    throw new Error(
      "Capability direct-clothing-dlc-v1 разрешён только для подписанной одежды внутри подготовленного Astral Clothing DLC.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === directClothingTarget) &&
    !directClothingDlc
  ) {
    throw new Error(
      "Direct Astral Clothing DLC entries require capability direct-clothing-dlc-v1.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === directWeaponTarget) &&
    !directWeaponDlc
  ) {
    throw new Error(
      "Direct Astral Weapons DLC entries require capability direct-weapon-dlc-v1.",
    );
  }
  /* Запись растительности — в один из её пакетов, в его части. */
  const vegetationEntry = (item) => {
    const archive = item.target.toLowerCase();
    if (archive === VEGETATION_DLC_ARCHIVE) return VEGETATION_DLC_ENTRY_PATTERN.test(item.entry || "");
    if (archive === VEGETATION_DLC_B_ARCHIVE) return VEGETATION_DLC_B_ENTRY_PATTERN.test(item.entry || "");
    if (archive === VEGETATION_DLC_C_ARCHIVE) return VEGETATION_DLC_C_ENTRY_PATTERN.test(item.entry || "");
    return false;
  };
  if (
    (directVegetationDlc || directVegetationDlcB || directVegetationDlcC) &&
    (!allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      !Array.isArray(manifest.slots) ||
      !manifest.slots.includes("vegetation") ||
      files.some(
        (item) =>
          !vegetationEntry(item) ||
          item.action !== "import" ||
          item.merge?.strategy !== "rpf-resource-layer-v1",
      ))
  ) {
    throw new Error(
      "Пакет растительности Astral принимает только словари, модели и карты внутри update/x64/dlcpacks/astral_vegetation(_b, _c)/dlc.rpf.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === VEGETATION_DLC_ARCHIVE) &&
    !directVegetationDlc
  ) {
    throw new Error(
      "Записи пакета растительности Astral требуют capability direct-vegetation-dlc-v1.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === VEGETATION_DLC_B_ARCHIVE) &&
    !directVegetationDlcB
  ) {
    throw new Error(
      "Записи второго пакета растительности Astral требуют capability direct-vegetation-dlc-b-v1.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === VEGETATION_DLC_C_ARCHIVE) &&
    !directVegetationDlcC
  ) {
    throw new Error(
      "Записи третьего пакета растительности Astral требуют capability direct-vegetation-dlc-c-v1.",
    );
  }
  /*
   * Запись текстур — в первый пакет (словари и модели), во второй (модели; со
   * своей возможностью 256 px — и словари) или в третий (только со своей
   * возможностью 256 px; ТЗ 17.10.2026).
   */
  const texturesEntry = (item) => {
    const archive = item.target.toLowerCase();
    if (archive === TEXTURES_DLC_ARCHIVE) return TEXTURES_DLC_ENTRY_PATTERN.test(item.entry || "");
    if (archive === TEXTURES_DLC_B_ARCHIVE)
      return (directTexturesDetail ? TEXTURES_DLC_B_DETAIL_ENTRY_PATTERN : TEXTURES_DLC_B_ENTRY_PATTERN).test(item.entry || "");
    if (archive === TEXTURES_DLC_C_ARCHIVE) return directTexturesDetail && TEXTURES_DLC_C_DETAIL_ENTRY_PATTERN.test(item.entry || "");
    return false;
  };
  if (
    (directTexturesDlc || directTexturesDlcB || directTexturesDlcC || directTexturesDetail) &&
    (!allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      !Array.isArray(manifest.slots) ||
      !manifest.slots.includes("textures") ||
      files.some(
        (item) =>
          !texturesEntry(item) ||
          item.action !== "import" ||
          item.merge?.strategy !== "rpf-resource-layer-v1",
      ))
  ) {
    throw new Error(
      "Пакет текстур Astral принимает только словари текстур и модели карты внутри update/x64/dlcpacks/astral_textures(_b|_c)/dlc.rpf.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === TEXTURES_DLC_B_ARCHIVE) &&
    !directTexturesDlcB
  ) {
    throw new Error(
      "Записи второго пакета текстур Astral требуют capability direct-textures-dlc-b-v1.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === TEXTURES_DLC_C_ARCHIVE) &&
    !directTexturesDlcC
  ) {
    throw new Error(
      "Записи третьего пакета текстур Astral требуют capability direct-textures-dlc-c-v1.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === TEXTURES_DLC_ARCHIVE) &&
    !directTexturesDlc
  ) {
    throw new Error(
      "Записи пакета текстур Astral требуют capability direct-textures-dlc-v1.",
    );
  }
  /* Запись дорог — в один из двух пакетов, в его части. */
  const roadsEntry = (item) => {
    const archive = item.target.toLowerCase();
    const entry = item.entry || "";
    if (archive === ROADS_DLC_ARCHIVE) return ROADS_DLC_ENTRY_PATTERN.test(entry) || (directRoadsModels && ROADS_DLC_MODEL_ENTRY_PATTERN.test(entry));
    if (archive === ROADS_DLC_B_ARCHIVE) return ROADS_DLC_B_ENTRY_PATTERN.test(entry) || (directRoadsModels && ROADS_DLC_B_MODEL_ENTRY_PATTERN.test(entry));
    return false;
  };
  if (
    (directRoadsDlc || directRoadsDlcB) &&
    (!allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      !Array.isArray(manifest.slots) ||
      !manifest.slots.includes("roads") ||
      files.some(
        (item) =>
          !roadsEntry(item) ||
          item.action !== "import" ||
          item.merge?.strategy !== "rpf-resource-layer-v1",
      ))
  ) {
    throw new Error(
      "Пакет дорог Astral принимает только словари карты внутри update/x64/dlcpacks/astral_roads(_b)/dlc.rpf.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === ROADS_DLC_ARCHIVE) &&
    !directRoadsDlc
  ) {
    throw new Error(
      "Записи пакета дорог Astral требуют capability direct-roads-dlc-v1.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === ROADS_DLC_B_ARCHIVE) &&
    !directRoadsDlcB
  ) {
    throw new Error(
      "Записи второго пакета дорог Astral требуют capability direct-roads-dlc-b-v1.",
    );
  }
  /* Возможность моделей дорог без единой модели — лишняя: форма манифеста строго её объявляет, только если модели едут. */
  if (
    directRoadsModels &&
    !files.some((item) => /\.(?:ydr|ydd|yft)$/.test(String(item.entry || "").toLowerCase()) && /^update\/x64\/dlcpacks\/astral_roads(?:_b)?\/dlc\.rpf$/.test(item.target.toLowerCase()))
  ) {
    throw new Error("Возможность direct-roads-models-v1 объявлена, а моделей дорог в манифесте нет.");
  }
  if (
    directPlacesDlc &&
    (!allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      !Array.isArray(manifest.slots) ||
      !manifest.slots.some((slot) => /^recolor-[a-z0-9]+$/.test(String(slot))) ||
      /* Рядом с пакетом мест — только контейнер слоя Astral в update.rpf
         (свои новые карты, типы и манифест места); его записи проверяют
         правила слоя Astral. */
      files.some(
        (item) =>
          (item.target.toLowerCase() !== PLACES_DLC_ARCHIVE && item.target.toLowerCase() !== "update/update.rpf") ||
          item.action !== "import" ||
          item.merge?.strategy !== "rpf-resource-layer-v1" ||
          (item.target.toLowerCase() === PLACES_DLC_ARCHIVE && !PLACES_DLC_ENTRY_PATTERN.test(item.entry || "")),
      ))
  ) {
    throw new Error(
      "Пакет мест Astral принимает только файлы места внутри update/x64/dlcpacks/astral_places/dlc.rpf.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === PLACES_DLC_ARCHIVE) &&
    !directPlacesDlc
  ) {
    throw new Error(
      "Записи пакета мест Astral требуют capability direct-places-dlc-v1.",
    );
  }
  const audioChunkEntries = files.filter(
    (item) => item.merge?.strategy === "astral-audio-chunk-v1",
  );
  /* Звук попадания пишет в пакет Astral дерево звуков, а свои дорожки — в
     банк collision резидентного архива: банк пакета не резидентный, и удар
     пули, который может прозвучать где угодно, его бы не нашёл. Рядом с
     пакетом разрешены только такие слои дорожек. */
  const soundBesideAudioPack = (item) =>
    awcStreamLayer &&
    item.merge?.strategy === "awc-stream-layer-v1" &&
    isAwcArchive(item.target);
  if (
    (directAudioDlc || audioChunk || audioChunkEntries.length > 0) &&
    (!directAudioDlc ||
      !audioChunk ||
      !allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      !audioChunkEntries.length ||
      files.some(
        (item) =>
          !soundBesideAudioPack(item) &&
          (item.target !== AUDIO_DLC_ARCHIVE ||
            !(
              (item.merge?.strategy === "astral-audio-chunk-v1" &&
                item.action === "replace" &&
                AUDIO_DLC_CHUNK_PATTERN.test(item.entry || "") &&
                path.posix.extname(item.source || "").toLowerCase() ===
                  ".json") ||
              (!item.merge &&
                item.action === "import" &&
                AUDIO_DLC_BANK_PATTERN.test(item.entry || ""))
            )),
      ))
  ) {
    throw new Error(
      "Звуковой пакет Astral принимает только JSON-слои своих метаданных и личные банки стволов внутри update/x64/dlcpacks/astral_audio/dlc.rpf, а рядом — только слои дорожек звуковых архивов.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === AUDIO_DLC_ARCHIVE) &&
    !directAudioDlc
  ) {
    throw new Error(
      "Записи звукового пакета Astral требуют capability direct-audio-dlc-v1.",
    );
  }
  const resourceIdentity = (item) =>
    adapter === "rpf-entry"
      ? `${item.target.toLowerCase()}::${String(item.entry || "").toLowerCase()}`
      : item.target.toLowerCase();
  if (new Set(files.map(resourceIdentity)).size !== files.length)
    throw new Error("Пакет содержит повторяющиеся целевые пути.");
  if (
    files.some(
      (item) =>
        !["replace", "import", "upsert", "delete"].includes(item.action) ||
        (adapter !== "rpf-entry" && item.action !== "replace"),
    )
  )
    throw new Error(
      "Операции import/upsert/delete разрешены только для адаптера rpf-entry.",
    );
  if (
    files.some((item) => item.action === "delete") &&
    !capabilities.includes("rpf-delete-v1")
  )
    throw new Error(
      "Удаление RPF-entry требует подписанного capability rpf-delete-v1.",
    );
  if (
    adapter === "rpf-entry" &&
    files.some(
      (item) =>
        (path.posix.extname(item.entry || "").toLowerCase() === ".rpf" ||
          containsRpfContainer(item.entry)) &&
        !allowRpfContainers,
    )
  )
    throw new Error(
      "Вложенный RPF-контейнер требует capability rpf-container-entry-v1 и не может удаляться.",
    );
  if (
    adapter === "rpf-overlay" &&
    files.some((item) => path.extname(item.target).toLowerCase() !== ".rpf")
  ) {
    throw new Error("Адаптер rpf-overlay принимает только целевые RPF-архивы.");
  }
  /*
   * Вода мастерской (`water-manifest-trust.js`) — единственный пакет слоя
   * Astral, который рядом со своим контейнером (туман рек в
   * `x64/astral/astral_water.rpf`) правит файлы игры на их местах в
   * update.rpf: плитки тумана во вложенных `waterfog_txds(_dx).rpf` и квады
   * `water.xml`/`water_heistisland.xml`. Игра читает их по своему адресу, и
   * в контейнер их не переложить. Только ради этих записей и только у
   * манифеста строгой формы воды правило «astral-content — одни импорты в
   * контейнеры» раздвигается. Права писать это не даёт: без символа доверия
   * воды (`installLocalWaterPackage`) такой пакет движок не поставит.
   */
  const waterManifest =
    astralContentRpf && isLocalWaterManifest(manifest, edition);
  const waterBesideContainer = (item) =>
    waterManifest && isWaterGameEntry(item);
  /* Набор оптимизации (задача 8): контейнеры слоёв и записи игры у
     слоёв-записей (следы, тряска, дым, грязь, трава, таймцикл) — одним
     пакетом, чтобы переключение было одной пересборкой. Та же раздвижка,
     что у воды, и только у манифеста строгой формы набора: каждая его запись
     сверена с местом своего слоя. Без символа доверия оптимизации такой
     пакет движок не поставит. */
  const optimizationSet =
    astralContentRpf && isLocalOptimizationSetManifest(manifest, edition);
  /* «Дальность прорисовки» (задача 7 ТЗ 06.10.2026): рядом с картой коробки в
     своём контейнере — модификатор таймцикла объединением в
     timecycle_mods_2.xml. Та же раздвижка и только у манифеста строгой формы. */
  const drawDistance =
    astralContentRpf && isLocalDrawDistanceManifest(manifest, edition);
  const besideContainer = (item) =>
    waterBesideContainer(item) ||
    (drawDistance && item.action === "replace" && item.entry === DRAW_DISTANCE_TIMECYCLE_ENTRY) ||
    /* `upsert` — у «Частиц в воздухе по местности»: vfxregioninfo.ymt в
       update.rpf нет, запись кладётся (ТЗ 17.10). Какой слой вправе так
       писать, решает строгая форма набора выше. */
    (optimizationSet && (item.action === "replace" || item.action === "upsert")) ||
    /* Место мастерской: перекрытия игры — в пакете мест, свои карты, типы и
       манифест — в контейнере слоя (`recolorRouteOf`). Записи пакета мест
       проверяет его правило выше. */
    (directPlacesDlc && item.target.toLowerCase() === PLACES_DLC_ARCHIVE);
  /* Носитель `update/update2.rpf` (`carrier-targets.js`): под выключателем `ASTRAL_CARRIERS=update2` контейнер слоя `x64/astral/<имя>.rpf` ложится и туда — только импорт и то же строгое имя. */
  const packTarget = (item) => PACK_FORM_CARRIER_TARGETS.includes(String(item.target || "").toLowerCase());
  /* Запись контейнера слоя: в `update.rpf` и `update2.rpf` — `x64/astral/…`, в штатном пакете-носителе и его подпакете `dlc<N>.rpf` — `x64/levels/gta5/astral_…` (форма М; цель подпакета включает слово `<хозяин>_s1`). */
  const containerEntryOk = (item) => (packTarget(item) ? PACK_CARRIER_ENTRY_PATTERN : ASTRAL_CONTENT_ENTRY_PATTERN).test(item.entry || "");
  const carrierFile = (item) => astralContentRpf && carrierEnabled(item.target) && item.action === "import" && containerEntryOk(item);
  if (
    astralContentRpf &&
    (adapter !== "rpf-entry" ||
      !allowRpfContainers ||
      files.some(
        (item) =>
          !besideContainer(item) &&
          (item.action !== "import" ||
            !containerEntryOk(item) ||
            (directUpdateRpf
              ? item.target.toLowerCase() !== "update/update.rpf" && !carrierFile(item)
              : item.target.toLowerCase() !== "mods/update/update.rpf")),
      ) ||
      (directUpdateRpf
        ? manifest.scope !== "game-root" || manifest.requiresLoader !== false
        : manifest.requiresLoader !== true))
  ) {
    throw new Error(
      `Capability astral-content-rpf-v1 accepts only imported files inside ${ASTRAL_CONTAINER_ROOT}/*.rpf containers in the declared update.rpf mode.`,
    );
  }
  if (
    directUpdateRpf &&
    (!astralContentRpf ||
      !directUpdateEntries ||
      !allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      files.some(
        (item) =>
          item.target.toLowerCase() !== "update/update.rpf" &&
          !carrierFile(item) &&
          /* Место мастерской: перекрытия игры — в пакете мест. */
          !(directPlacesDlc && item.target.toLowerCase() === PLACES_DLC_ARCHIVE),
      ))
  ) {
    throw new Error(
      "Capability direct-update-rpf-v1 is restricted to signed Astral containers inside update/update.rpf.",
    );
  }
  /*
   * Звуковой пакет с правкой метаданных пишет в два места сразу: дорожки — в
   * звуковые архивы, правку дерева звуков — в update.rpf. Больше ничего за
   * пределами update.rpf такой пакет не пишет, и только ради этой пары
   * правило «direct-update — только update.rpf» раздвигается.
   */
  const soundBesideUpdate = (item) =>
    audioRelPatch &&
    awcStreamLayer &&
    item.merge?.strategy === "awc-stream-layer-v1" &&
    isAwcArchive(item.target);
  if (
    directUpdateEntries &&
    (!allowGameRootWrites ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      adapter !== "rpf-entry" ||
      files.some(
        (item) =>
          item.target.toLowerCase() !== "update/update.rpf" &&
          !carrierFile(item) &&
          !soundBesideUpdate(item) &&
          !(tattooPlaces && item.target.toLowerCase() === directClothingTarget) &&
          !(directPlacesDlc && item.target.toLowerCase() === PLACES_DLC_ARCHIVE),
      ))
  ) {
    throw new Error(
      "Capability direct-update-entries-v1 is restricted to signed update/update.rpf entry transactions.",
    );
  }
  if (
    files.some((item) => item.target.toLowerCase() === "update/update.rpf") &&
    !directUpdateEntries
  ) {
    throw new Error(
      "Direct update/update.rpf entries require capability direct-update-entries-v1.",
    );
  }
  const mergedEntries = files.filter((item) => item.merge);
  const timecycleEntries = mergedEntries.filter(
    (item) => item.merge.strategy === "timecycle-modifier-v1",
  );
  const tracerEntries = mergedEntries.filter(
    (item) => item.merge.strategy === "astral-tracer-v1",
  );
  const ptfxTextureEntries = mergedEntries.filter(
    (item) => item.merge.strategy === "ypt-texture-layer-v1",
  );
  const awcStreamEntries = mergedEntries.filter(
    (item) => item.merge.strategy === "awc-stream-layer-v1",
  );
  if (
    timecycleEntries.length > 0 &&
    (!timecycleModifierMerge ||
      adapter !== "rpf-entry" ||
      timecycleEntries.some(
        (item) =>
          item.action !== "replace" ||
          !["mods/update/update.rpf", "update/update.rpf"].includes(
            item.target.toLowerCase(),
          ) ||
          !TIMECYCLE_MODIFIER_ENTRY_PATTERN.test(item.entry || ""),
      ))
  ) {
    throw new Error(
      "Объединение timecycle XML разрешено только capability timecycle-modifier-merge-v1 для timecycle_mods_1…4.xml.",
    );
  }
  if (timecycleModifierMerge && timecycleEntries.length === 0) {
    throw new Error(
      "Capability timecycle-modifier-merge-v1 требует хотя бы один объединяемый timecycle XML.",
    );
  }
  const decorationEntries = mergedEntries.filter(
    (item) => item.merge.strategy === DECORATION_OVERLAY_STRATEGY,
  );
  if (
    decorationEntries.length > 0 &&
    (!decorationOverlayMerge ||
      !directUpdateEntries ||
      adapter !== "rpf-entry" ||
      decorationEntries.some(
        (item) =>
          !["replace", "import"].includes(item.action) ||
          item.target.toLowerCase() !== "update/update.rpf" ||
          !DECORATION_OVERLAY_ENTRY_PATTERN.test(item.entry || ""),
      ))
  ) {
    throw new Error(
      "Объединение коллекций наложений разрешено только capability decoration-overlay-merge-v1 для common/data/effects/peds/*_overlays.xml в update.rpf.",
    );
  }
  if (decorationOverlayMerge && decorationEntries.length === 0) {
    throw new Error(
      "Capability decoration-overlay-merge-v1 требует хотя бы одну объединяемую коллекцию наложений.",
    );
  }
  if (
    tracerEntries.length > 0 &&
    (!astralTracer ||
      !directUpdateEntries ||
      adapter !== "rpf-entry" ||
      manifest.scope !== "game-root" ||
      manifest.requiresLoader !== false ||
      files.length !== TRACER_RPF_ENTRIES.length ||
      tracerEntries.length !== files.length ||
      tracerEntries.some(
        (item) =>
          item.action !== "replace" ||
          item.target.toLowerCase() !== "update/update.rpf",
      ))
  ) {
    throw new Error(
      "Capability astral-tracer-v1 разрешает только полный декларативный набор core.ypt/weapons.meta внутри update.rpf.",
    );
  }
  if (astralTracer) {
    const expected = new Map(
      TRACER_RPF_ENTRIES.map((item) => [item.entry.toLowerCase(), item.role]),
    );
    const first = tracerEntries[0];
    const validEntries = tracerEntries.every(
      (item) =>
        expected.get(item.entry.toLowerCase()) === item.merge.role &&
        item.source === first.source &&
        item.sha256 === first.sha256 &&
        item.size === first.size &&
        JSON.stringify(item.merge.weapons) ===
          JSON.stringify(first.merge.weapons) &&
        item.merge.chanceSP === first.merge.chanceSP &&
        item.merge.chanceMP === first.merge.chanceMP &&
        item.merge.coreChannel === first.merge.coreChannel &&
        item.merge.coreVersion === first.merge.coreVersion,
    );
    if (
      !validEntries ||
      new Set(tracerEntries.map((item) => item.entry.toLowerCase())).size !==
        expected.size
    ) {
      throw new Error(
        "Manifest трассера не совпадает с защищённым контрактом Astral.",
      );
    }
    const tracer = manifest.tracer;
    const allowedTracerKeys = new Set([
      "schemaVersion",
      "coreChannel",
      "coreVersion",
      "targetMode",
      "weapons",
      "chanceSP",
      "chanceMP",
      "dds",
    ]);
    const dds = tracer?.dds;
    const allowedDdsKeys = new Set([
      "sha256",
      "width",
      "height",
      "mipLevels",
      "format",
      "bytes",
    ]);
    const tracerWeapons = normalizeTracerWeapons(
      tracer?.targetMode === "all" ? "all" : "selected",
      tracer?.weapons,
    );
    const expectedSlots = tracerSlots(tracerWeapons);
    const declaredSlots = Array.isArray(manifest.slots)
      ? [...new Set(manifest.slots.map(cleanId).filter(Boolean))]
      : [];
    const validTracerMetadata =
      tracer &&
      typeof tracer === "object" &&
      !Array.isArray(tracer) &&
      Object.keys(tracer).every((key) => allowedTracerKeys.has(key)) &&
      tracer.schemaVersion === ASTRAL_TRACER_SCHEMA &&
      tracer.coreChannel === first.merge.coreChannel &&
      tracer.coreVersion === first.merge.coreVersion &&
      ["selected", "all"].includes(tracer.targetMode) &&
      JSON.stringify(tracerWeapons) === JSON.stringify(first.merge.weapons) &&
      tracer.chanceSP === first.merge.chanceSP &&
      tracer.chanceMP === first.merge.chanceMP &&
      dds &&
      typeof dds === "object" &&
      !Array.isArray(dds) &&
      Object.keys(dds).every((key) => allowedDdsKeys.has(key)) &&
      dds.sha256 === first.sha256 &&
      dds.bytes === first.size &&
      Number.isInteger(dds.width) &&
      dds.width > 0 &&
      Number.isInteger(dds.height) &&
      dds.height > 0 &&
      Number.isInteger(dds.mipLevels) &&
      dds.mipLevels > 0 &&
      typeof dds.format === "string" &&
      Object.entries(ASTRAL_TRACER_TEXTURE_LAYOUT).every(
        ([field, expected]) => dds[field] === expected,
      ) &&
      JSON.stringify(declaredSlots) === JSON.stringify(expectedSlots);
    if (!validTracerMetadata) {
      throw new Error(
        "Описание трассера или его слоты не совпадают с подписанным payload.",
      );
    }
  } else if (tracerEntries.length > 0) {
    throw new Error("Композиция трассера требует capability astral-tracer-v1.");
  }
  if (ptfxTextureLayer || ptfxTextureEntries.length > 0) {
    const coreEntries = TRACER_RPF_ENTRIES.filter(
      (item) => item.role === "core",
    );
    const expected = new Set(
      coreEntries.map((item) => item.entry.toLowerCase()),
    );
    const first = ptfxTextureEntries[0];
    const valid =
      ptfxTextureLayer &&
      directUpdateEntries &&
      adapter === "rpf-entry" &&
      manifest.scope === "game-root" &&
      manifest.requiresLoader === false &&
      files.length === coreEntries.length &&
      ptfxTextureEntries.length === files.length &&
      new Set(ptfxTextureEntries.map((item) => item.entry.toLowerCase()))
        .size === expected.size &&
      ptfxTextureEntries.every(
        (item) =>
          expected.has(item.entry.toLowerCase()) &&
          item.target.toLowerCase() === "update/update.rpf" &&
          item.action === "replace" &&
          item.source === first.source &&
          item.sha256 === first.sha256 &&
          item.size === first.size &&
          item.merge.texture === first.merge.texture &&
          item.merge.slot === first.merge.slot &&
          item.merge.coreChannel === first.merge.coreChannel &&
          item.merge.coreVersion === first.merge.coreVersion,
      );
    if (!valid) {
      throw new Error(
        "Слой PTFX должен атомарно обновлять один texture slot во всех трёх core.ypt.",
      );
    }
  }
  const ptfxRuleEntries = mergedEntries.filter(
    (item) => item.merge.strategy === "ypt-rule-patch-v1",
  );
  if (ptfxRulePatch || ptfxRuleEntries.length > 0) {
    /* Одна JSON-правка на все три core.ypt: те же записи, что у слоя текстуры. */
    const coreEntries = TRACER_RPF_ENTRIES.filter((item) => item.role === "core");
    const expected = new Set(coreEntries.map((item) => item.entry.toLowerCase()));
    const first = ptfxRuleEntries[0];
    const valid =
      ptfxRulePatch &&
      directUpdateEntries &&
      adapter === "rpf-entry" &&
      manifest.scope === "game-root" &&
      manifest.requiresLoader === false &&
      files.length === coreEntries.length &&
      ptfxRuleEntries.length === files.length &&
      new Set(ptfxRuleEntries.map((item) => item.entry.toLowerCase())).size === expected.size &&
      ptfxRuleEntries.every(
        (item) =>
          expected.has(item.entry.toLowerCase()) &&
          item.target.toLowerCase() === "update/update.rpf" &&
          item.action === "replace" &&
          item.source === first.source &&
          item.sha256 === first.sha256 &&
          item.size === first.size &&
          item.merge.slot === first.merge.slot &&
          path.posix.extname(item.source || "").toLowerCase() === ".json",
      );
    if (!valid) {
      throw new Error(
        "Правка правил ядра должна атомарно обновлять все три core.ypt одним JSON кадров.",
      );
    }
  }
  const ownRuleEntries = mergedEntries.filter((item) => item.merge.strategy === "ypt-own-rules-v1");
  const clipRowEntries = mergedEntries.filter((item) => item.merge.strategy === "ptx-clip-rows-v1");
  if (ptfxOwnRules || ownRuleEntries.length > 0 || clipRows || clipRowEntries.length > 0) {
    /*
     * Свои правила автора: словарь-донор на все три core.ypt одним файлом; рядом могут быть строки кадров его листов
     * (ptxclipregions.dat) и маршруты крови (bloodfx.dat) того же пакета — с той же приставкой клонов.
     */
    const coreEntries = TRACER_RPF_ENTRIES.filter((item) => item.role === "core");
    const expected = new Set(coreEntries.map((item) => item.entry.toLowerCase()));
    const first = ownRuleEntries[0];
    const [clip] = clipRowEntries;
    const others = files.length - ownRuleEntries.length - clipRowEntries.length - (ptfxOwnRules ? mergedEntries.filter((item) => item.merge.strategy === "blood-routing-v1").length : 0);
    const valid =
      ptfxOwnRules &&
      directUpdateEntries &&
      adapter === "rpf-entry" &&
      manifest.scope === "game-root" &&
      manifest.requiresLoader === false &&
      ownRuleEntries.length === coreEntries.length &&
      new Set(ownRuleEntries.map((item) => item.entry.toLowerCase())).size === expected.size &&
      ownRuleEntries.every(
        (item) =>
          expected.has(item.entry.toLowerCase()) &&
          item.target.toLowerCase() === "update/update.rpf" &&
          item.action === "replace" &&
          item.source === first.source &&
          item.sha256 === first.sha256 &&
          item.size === first.size &&
          item.merge.slot === first.merge.slot &&
          item.merge.prefix === first.merge.prefix &&
          JSON.stringify(item.merge.rules) === JSON.stringify(first.merge.rules) &&
          JSON.stringify(item.merge.gameSheets || []) === JSON.stringify(first.merge.gameSheets || []) &&
          path.posix.extname(item.source || "").toLowerCase() === ".ypt",
      ) &&
      /* Приставка клонов — от id пакета: два пакета именами не столкнутся. */
      first.merge.prefix === `astral_own_${createHash("sha256").update(String(manifest.id)).digest("hex").slice(0, 6)}_` &&
      clipRowEntries.length <= 1 &&
      clipRows === Boolean(clip) &&
      (!clip ||
        (clip.action === "replace" &&
          clip.target.toLowerCase() === "update/update.rpf" &&
          CLIP_REGIONS_ENTRY_PATTERN.test(clip.entry || "") &&
          clip.merge.prefix === first.merge.prefix &&
          path.posix.extname(clip.source || "").toLowerCase() === ".json")) &&
      others === 0;
    if (!valid) {
      throw new Error(
        "Свои правила автора должны атомарно обновлять все три core.ypt одним словарём; рядом — только строки кадров и маршруты крови того же пакета.",
      );
    }
  }
  const ptfxCoreEntries = mergedEntries.filter(
    (item) => item.merge.strategy === "ptfx-core-base-v1",
  );
  if (ptfxCoreBase || ptfxCoreEntries.length > 0) {
    const expected = new Set(
      TRACER_RPF_ENTRIES.filter((item) => item.role === "core").map((item) =>
        item.entry.toLowerCase(),
      ),
    );
    const first = ptfxCoreEntries[0];
    const valid =
      ptfxCoreBase &&
      directUpdateEntries &&
      adapter === "rpf-entry" &&
      manifest.scope === "game-root" &&
      manifest.requiresLoader === false &&
      files.length === expected.size &&
      ptfxCoreEntries.length === files.length &&
      new Set(ptfxCoreEntries.map((item) => item.entry.toLowerCase())).size ===
        expected.size &&
      ptfxCoreEntries.every(
        (item) =>
          expected.has(item.entry.toLowerCase()) &&
          item.target.toLowerCase() === "update/update.rpf" &&
          item.action === "import" &&
          item.source === first.source &&
          item.sha256 === first.sha256 &&
          item.size === first.size,
      );
    if (!valid) {
      throw new Error(
        "Базовый Astral PTFX Core должен атомарно обновлять все три core.ypt одним подписанным payload.",
      );
    }
  }
  const bloodRoutingEntries = mergedEntries.filter(
    (item) => item.merge.strategy === "blood-routing-v1",
  );
  if (bloodRouting || bloodRoutingEntries.length > 0) {
    /* Слой крови — один JSON маршрутов на один bloodfx.dat в update.rpf.
       Сам файл установщик собирает из файла игрока, поэтому ничего другого
       в таком пакете быть не может. */
    const [routing] = bloodRoutingEntries;
    const valid =
      bloodRouting &&
      directUpdateEntries &&
      adapter === "rpf-entry" &&
      manifest.scope === "game-root" &&
      manifest.requiresLoader === false &&
      /* Рядом — только свои правила автора того же пакета: маршруты ведут в их клоны. */
      (files.length === 1 || ptfxOwnRules) &&
      bloodRoutingEntries.length === 1 &&
      routing.action === "replace" &&
      routing.target.toLowerCase() === "update/update.rpf" &&
      BLOODFX_ENTRY_PATTERN.test(routing.entry || "") &&
      path.posix.extname(routing.source || "").toLowerCase() === ".json";
    if (!valid) {
      throw new Error(
        "Слой крови разрешён только одним JSON маршрутов для common/data/effects/bloodfx.dat внутри update.rpf.",
      );
    }
  }
  const weaponsMetaEntries = mergedEntries.filter(
    (item) => item.merge.strategy === WEAPONS_META_STRATEGY,
  );
  if (weaponsMetaPatch || weaponsMetaEntries.length > 0) {
    /* Привязки следа к стволам — по JSON на каждый файл меты игрока в update.rpf (`weapons-meta-bindings.js`); сам файл установщик
       собирает из файла игрока, поэтому ничего другого в таком пакете быть не может. */
    const valid =
      weaponsMetaPatch &&
      directUpdateEntries &&
      adapter === "rpf-entry" &&
      manifest.scope === "game-root" &&
      manifest.requiresLoader === false &&
      weaponsMetaEntries.length >= 1 &&
      weaponsMetaEntries.length <= WEAPONS_META_MAX_FILES &&
      weaponsMetaEntries.length === files.length &&
      new Set(weaponsMetaEntries.map((item) => item.entry.toLowerCase())).size === weaponsMetaEntries.length &&
      weaponsMetaEntries.every(
        (item) =>
          item.action === "replace" &&
          item.target.toLowerCase() === "update/update.rpf" &&
          WEAPONS_META_ENTRY.test(item.entry || "") &&
          path.posix.extname(item.source || "").toLowerCase() === ".json",
      );
    if (!valid) {
      throw new Error(
        "Привязки трассеров разрешены только JSON-файлами на common/data/ai/weapons*.meta и dlc_patch/<пакет>/common/data/ai/*.meta внутри update.rpf.",
      );
    }
  }
  const audioRelEntries = mergedEntries.filter(
    (item) => item.merge.strategy === "audio-rel-patch-v1",
  );
  if (audioRelPatch || audioRelEntries.length > 0) {
    /* Правка метаданных звука — JSON правок на sounds.dat54.rel,
       game.dat151.rel и/или categories.dat22.rel в update.rpf; сам файл
       установщик собирает из файла игрока. Рядом могут стоять только слои
       дорожек AWC того же пакета. */
    const valid =
      audioRelPatch &&
      directUpdateEntries &&
      adapter === "rpf-entry" &&
      manifest.scope === "game-root" &&
      manifest.requiresLoader === false &&
      audioRelEntries.length >= 1 &&
      audioRelEntries.length <= 3 &&
      new Set(audioRelEntries.map((item) => item.entry.toLowerCase())).size ===
        audioRelEntries.length &&
      audioRelEntries.every(
        (item) =>
          item.action === "replace" &&
          item.target.toLowerCase() === "update/update.rpf" &&
          AUDIO_REL_ENTRY_PATTERN.test(item.entry || "") &&
          path.posix.extname(item.source || "").toLowerCase() === ".json",
      ) &&
      audioRelEntries.length + awcStreamEntries.length === files.length;
    if (!valid) {
      throw new Error(
        "Правка звуковых метаданных разрешена только JSON-правкой sounds.dat54.rel, game.dat151.rel или categories.dat22.rel внутри update.rpf рядом со слоями дорожек AWC.",
      );
    }
  }
  if (awcStreamLayer || awcStreamEntries.length > 0) {
    const valid =
      awcStreamLayer &&
      adapter === "rpf-entry" &&
      manifest.scope === "game-root" &&
      manifest.requiresLoader === false &&
      awcStreamEntries.length > 0 &&
      awcStreamEntries.length +
        (audioRelPatch ? audioRelEntries.length : 0) +
        (audioChunk ? audioChunkEntries.length : 0) ===
        files.length &&
      awcStreamEntries.every(
        (item) =>
          item.action === "replace" &&
          isAwcPlace(item) &&
          item.merge.bank === path.posix.basename(item.entry, ".awc"),
      );
    if (!valid) {
      throw new Error(
        "Слой AWC разрешён только для объявленных звуковых архивов: RESIDENT/WEAPONS_PLAYER, боль (PAIN), двигатели (STREAMED_VEHICLES и его варианты), окружение (STREAMED/ONESHOT_AMBIENCE), музыка (PROLOGUE/STREAMS), радиостанции и банки стволов в пакетах дополнений.",
      );
    }
  }
  if (
    adapter === "rpf-entry" &&
    files.some(
      (item) =>
        path.extname(item.target).toLowerCase() !== ".rpf" || !item.entry,
    )
  ) {
    throw new Error(
      "Адаптер rpf-entry требует RPF-архив в target и безопасный путь entry для каждого payload.",
    );
  }
  if (
    adapter === "rageopenv-loose" &&
    (manifest.requiresLoader !== true ||
      files.some(
        (item) =>
          item.action !== "replace" ||
          !/^newmods\/(common|platform|dlcpacks)\/[^/]/i.test(item.target),
      ))
  ) {
    throw new Error(
      "Адаптер rageopenv-loose принимает только файлы newmods/common, newmods/platform или newmods/dlcpacks и требует RageOpenV loader.",
    );
  }
  if (
    adapter === "gta-settings" &&
    (manifest.scope !== "gta-settings" ||
      !capabilities.includes("preserve-video-card-description-v1") ||
      manifest.requiresLoader !== false ||
      files.length !== 1 ||
      files[0].action !== "replace" ||
      files[0].target.toLowerCase() !== "settings.xml")
  ) {
    throw new Error(
      "Адаптер gta-settings требует один settings.xml и capability preserve-video-card-description-v1.",
    );
  }
  const dlcName = String(manifest.dlcName || "")
    .trim()
    .toLowerCase();
  if (
    adapter === "managed-addon-dlc" &&
    (manifest.requiresLoader !== true ||
      manifest.scope !== "newmods-vfs" ||
      !/^[a-z0-9][a-z0-9_]{0,63}$/.test(dlcName) ||
      files.length !== 1 ||
      files[0].action !== "replace" ||
      files[0].target.toLowerCase() !== `newmods/dlcpacks/${dlcName}/dlc.rpf`)
  ) {
    throw new Error(
      "Адаптер managed-addon-dlc требует один dlc.rpf, безопасное dlcName, scope newmods-vfs и RageOpenV loader.",
    );
  }
  const declaredSlotIds = Array.isArray(manifest.slots)
    ? [...new Set(manifest.slots.map(cleanId).filter(Boolean))]
    : [];
  /* Вещь одежды — место по папке с коллекцией, куда пишут записи
     (`clothing-slots.js`): иначе вещи разных коллекций с одним номером
     сменяли бы друг друга. */
  const slots = directClothingDlc
    ? clothingItemSlots(declaredSlotIds, files)
    : declaredSlotIds;
  /* Мод каталога с манифестом в общем контейнере — в своём
     (`manifest-containers.js`). */
  return withOwnMapsContainer({
    id,
    version: cleanId(manifest.version) || "1.0.0",
    adapter,
    capabilities,
    slots,
    files,
    ...(adapter === "managed-addon-dlc" ? { dlcName } : {}),
    /* Пакету нужна пара загрузчиков (`loader-need.js`): запись установки это запоминает, снятие последней такой работы уносит пару. */
    needsLoader: manifestNeedsLoader(manifest),
  });
}
