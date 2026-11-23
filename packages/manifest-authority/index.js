import path from "node:path";
import {
  canonicalManifest,
  isWeaponAudioLayerPlace,
  normalizeRelativePath,
  validateManifest,
} from "../install-engine/index.js";
import { parseTimecycleModifierXml } from "../install-engine/timecycle-merge.js";
import { WEAPONS_META_ENTRY, WEAPONS_META_STRATEGY, parseWeaponsMetaBindings } from "../install-engine/weapons-meta-bindings.js";
import {
  ASTRAL_PTFX_CORE_CHANNEL,
  ASTRAL_PTFX_CORE_VERSION,
  ASTRAL_PTFX_PLAYER_CORE_CHANNEL,
  ASTRAL_PTFX_PLAYER_CORE_VERSION,
  ASTRAL_TRACER_SCHEMA,
  knownPtfxCore,
  normalizeTracerWeapons,
  TRACER_RPF_ENTRIES,
} from "../tracer-contract/index.js";
import { normalizeBloodRouting } from "../bloodfx/index.js";

const REQUESTABLE_ADAPTERS = [
  "file-overlay",
  "rpf-overlay",
  "rpf-entry",
  "rageopenv-loose",
  "managed-addon-dlc",
  "gta-settings",
];
const OPERATIONS = ["replace", "import", "upsert", "delete"];
const EDITIONS = ["Legacy", "Enhanced"];

const UPDATE_RPF = "update/update.rpf";
const WEAPONS_DLC = "update/x64/dlcpacks/astral_weapons/dlc.rpf";
const CLOTHING_DLC = "update/x64/dlcpacks/astral_clothing/dlc.rpf";
const BLOOD_ENTRY = "common/data/effects/bloodfx.dat";
const CLIP_ENTRY = "common/data/effects/ptxclipregions.dat";
const SHEET_DICTIONARY = "scr_rcbarry2";
const MAX_ID_LENGTH = 96;
const MAX_TATTOOS = 64;

const ASTRAL_ENTRY = /^x64\/astral\/[a-z0-9][a-z0-9._-]{0,119}\.rpf(?:\/(?:[a-z0-9_]{1,40}@)?[a-z0-9_][a-z0-9._+~-]{0,119})*$/i;
const WEAPON_ENTRY = /^astral_stream\.rpf\/[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ytd)$/i;
const CLOTHING_ENTRY = /^astral_stream_0[01]\.rpf\/mp_[fm]_freemode_01[a-z0-9._+~/-]{1,220}\.(?:ydd|ytd)$/i;
const TATTOO_ENTRY = /^astral_stream_00\.rpf\/([a-z0-9][a-z0-9_]{0,63})\.ytd$/;
const TATTOO_SLOT = /^tattoo-([a-z0-9][a-z0-9_]{0,63})$/;
const FOREIGN_TATTOO_NAMES = [
  /^w_/,
  /^(?:p_)?[a-z]{3,6}_(?:diff|norm|normal|spec)_\d{3}/,
  /^(?:p_)?[a-z]{3,6}_\d{3}(?:_|$)/,
  /^mp_[mf]_freemode_01/,
];
const TIMECYCLE_ENTRY = /^common\/data\/timecycle\/timecycle_mods_[1-4]\.xml$/i;
const CORE_ENTRY_TAIL = /\/ptfx(?:_hi|_lo)?\.rpf\/core\.ypt$/i;
const OWN_PREFIX = /^astral_own_[0-9a-f]{6}_$/;
const AWC_ENTRY = /^(?:x64\/audio\/sfx\/[a-z0-9_]{1,40}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.awc$/;
const NEWMODS_LOOSE = /^newmods\/(?:common|platform|dlcpacks)\/./i;
const DLC_NAME = /^[a-z0-9][a-z0-9_]{0,63}$/;

const MSG = {
  noId: "В mod.json отсутствует корректный id.",
  noFiles: "В mod.json нет файлов для упаковки.",
  onlyMods: "Пакет может изменять только mods или разрешённый RageOpenV newmods: ",
  duplicate: "Повторяющийся целевой путь: ",
  deleteNeedsEntry: "Удаление разрешено только для entry внутри адаптера rpf-entry.",
  needsRpfTargets: "Адаптер rpf-overlay принимает только целевые RPF-архивы.",
  needsRpfEntry: "Адаптер rpf-entry требует RPF-архив в target и путь entry для каждого payload.",
  looseTargets: "Адаптер rageopenv-loose принимает только newmods/common, newmods/platform или newmods/dlcpacks и требует loader.",
  settingsShape: "Адаптер gta-settings принимает один XML/TXT-файл с target settings.xml и сохраняет аппаратные поля пользователя.",
  dlcShape: "Адаптер managed-addon-dlc требует один newmods/dlcpacks/<dlcName>/dlc.rpf и безопасное dlcName.",
  operationsOnlyEntry: "Операции import/delete разрешены только для адаптера rpf-entry.",
  editions: "Укажите Legacy и/или Enhanced в editions.",
  bloodJson: "Маршруты bloodfx.dat должны быть корректным JSON.",
  tattooTooMany: (count) => `В паке тату ${count} наложений — больше 64 в один мод не входит, разбейте пак.`,
  tattooShape:
    "Пак тату: в нём только тату, и каждый файл — словарь <txd>.ytd у корня astral_stream_00.rpf в Astral Clothing DLC; имя — строчные латиница, цифры и «_», не ствол, не расцветка и не вещь, без повторов.",
};

// ---------- Мелкие помощники ----------

function cleanId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH);
}

const lower = (value) => String(value).toLowerCase();
const isPlainObject = (value) => typeof value === "object" && value !== null;
const hasRpfExtension = (target) => path.posix.extname(target).toLowerCase() === ".rpf";
const rawText = (value, fallback = "") => String(value || fallback);

function pathIsInsideRpf(entry) {
  const parts = entry.split("/");
  const last = parts.pop().toLowerCase();
  return last.endsWith(".rpf") || parts.some((part) => part.toLowerCase().endsWith(".rpf"));
}

// ---------- Признаки прямых наборов (по сырым значениям спецификации) ----------

function requestedAdapter(spec, files) {
  if (REQUESTABLE_ADAPTERS.includes(spec.adapter)) return spec.adapter;
  if (files.some((item) => item.entry !== null && item.entry !== undefined)) return "rpf-entry";
  return null;
}

function tattooNameIsForeign(name) {
  return FOREIGN_TATTOO_NAMES.some((pattern) => pattern.test(name));
}

function tattooPackIsValid(spec, files, base) {
  if (!base) return false;
  if (!spec.slots.every((slot) => TATTOO_SLOT.test(String(slot)))) return false;
  if (files.length > MAX_TATTOOS) return false;
  const names = new Set();
  for (const item of files) {
    if (lower(rawText(item.target)) !== CLOTHING_DLC || lower(rawText(item.action, "replace")) !== "import") return false;
    const name = TATTOO_ENTRY.exec(rawText(item.entry))?.[1];
    if (name === undefined || names.has(name) || tattooNameIsForeign(name)) return false;
    names.add(name);
  }
  return true;
}

function directSets(spec, files, requested) {
  const base = requested === "rpf-entry" && spec.scope === "game-root" && spec.requiresLoader === false;
  const every = (test) => base && files.every(test);
  const targetIs = (item, expected) => lower(rawText(item.target)) === expected;
  const actionIs = (item, expected) => lower(rawText(item.action, "replace")) === expected;

  const update = every((item) => targetIs(item, UPDATE_RPF));
  const sets = {
    update,
    astral: update && files.every((item) => actionIs(item, "import") && ASTRAL_ENTRY.test(rawText(item.entry))),
    weapons: every((item) => targetIs(item, WEAPONS_DLC) && actionIs(item, "import") && WEAPON_ENTRY.test(rawText(item.entry))),
    clothing: every((item) => targetIs(item, CLOTHING_DLC) && actionIs(item, "import") && CLOTHING_ENTRY.test(rawText(item.entry))),
    tattoo: false,
    audio: every((item) => isWeaponAudioLayerPlace(item.target, item.entry)),
  };

  const slotsWithTattoo = Array.isArray(spec.slots) && spec.slots.some((slot) => String(slot).startsWith("tattoo-"));
  if (slotsWithTattoo) {
    if (!tattooPackIsValid(spec, files, base)) {
      throw new Error(files.length > MAX_TATTOOS ? MSG.tattooTooMany(files.length) : MSG.tattooShape);
    }
    sets.tattoo = true;
  }
  return sets;
}

// ---------- Политики объединения ----------

const isSystemCore = (merge) =>
  merge.coreChannel === ASTRAL_PTFX_CORE_CHANNEL && merge.coreVersion === ASTRAL_PTFX_CORE_VERSION;
const isPlayerCore = (merge) =>
  merge.coreChannel === ASTRAL_PTFX_PLAYER_CORE_CHANNEL && merge.coreVersion === ASTRAL_PTFX_PLAYER_CORE_VERSION;
const isCoreEntry = (entry) => CORE_ENTRY_TAIL.test(entry);
const isRule = (text) => /^[A-Za-z0-9_]{1,40}$/.test(text);

function readTimecyclePriority(merge) {
  const priority = Number(merge.priority);
  return Number.isInteger(priority) && priority >= 0 && priority <= 1000 ? priority : null;
}

function readTimecycleNames(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 128) return null;
  const names = list.map((name) => String(name).trim());
  if (names.some((name) => name === "" || name.length > 160)) return null;
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) return null;
  return names;
}

function readGameSheets(sheets) {
  if (!Array.isArray(sheets) || sheets.length > 32) return null;
  const result = [];
  for (const sheet of sheets) {
    if (!isPlainObject(sheet)) return null;
    if (Object.keys(sheet).some((key) => key !== "texture" && key !== "dictionary")) return null;
    const texture = String(sheet.texture || "");
    if (!/^[A-Za-z0-9_]{1,40}$/.test(texture) || sheet.dictionary !== SHEET_DICTIONARY) return null;
    result.push({ texture, dictionary: sheet.dictionary });
  }
  return result;
}

function readOwnRules(merge) {
  const rules = Array.isArray(merge.rules) ? merge.rules : [];
  if (rules.length < 1 || rules.length > 16 || typeof merge.prefix !== "string") return null;
  const texts = rules.map(String);
  return texts.every((rule) => isRule(rule) && merge.prefix.length + rule.length <= 55) ? texts : null;
}

function readAwcStreams(list) {
  const streams = (Array.isArray(list) ? list : []).map((item) => String(item).trim().toUpperCase());
  const unique = new Set(streams).size === streams.length;
  return streams.length > 0 && unique && streams.every((stream) => /^0X[0-9A-F]{8}$/.test(stream)) ? streams : null;
}

function tracerRoleFor(entry) {
  return TRACER_RPF_ENTRIES.find((known) => known.entry.toLowerCase() === entry.toLowerCase())?.role;
}

function readChance(value) {
  const chance = Number(value);
  return Number.isFinite(chance) && chance >= 0 && chance <= 1 ? chance : null;
}

// Каждая стратегия: допустимые ключи, отказ, условия (ctx -> boolean) и сборка результата.
// ctx: merge, action, entry, requested, sets (признаки прямых наборов), spec.
const STRATEGIES = {
  "timecycle-modifier-v1": {
    keys: ["strategy", "priority", "includeNames", "excludeNames"],
    failure: "Некорректная политика объединения timecycle XML.",
    capability: "timecycle-modifier-merge-v1",
    valid: ({ merge, action, entry, requested }) =>
      readTimecyclePriority(merge) !== null && requested === "rpf-entry" && action === "replace" && TIMECYCLE_ENTRY.test(entry),
    build({ merge }) {
      const result = { strategy: "timecycle-modifier-v1", priority: readTimecyclePriority(merge) };
      const given = (list) => list !== null && list !== undefined;
      /* Названные модификаторы берутся (includeNames) или, наоборот, исключаются (excludeNames); оба списка сразу не бывают. */
      if (given(merge.includeNames) && given(merge.excludeNames)) throw new Error("Некорректная политика объединения timecycle XML.");
      for (const key of ["includeNames", "excludeNames"]) {
        if (!given(merge[key])) continue;
        const names = readTimecycleNames(merge[key]);
        if (names === null) throw new Error("Некорректный список timecycle-модификаторов.");
        result[key] = names;
      }
      return result;
    },
    reads: "timecycle",
  },
  "rpf-resource-layer-v1": {
    keys: ["strategy"],
    failure: "Некорректная политика слоёв ресурса Astral RPF.",
    capability: null,
    valid: ({ action, entry, requested, sets }) =>
      requested === "rpf-entry" &&
      sets.update &&
      ASTRAL_ENTRY.test(entry) &&
      (sets.astral ? action === "import" : action === "upsert" || action === "replace"),
    build: () => ({ strategy: "rpf-resource-layer-v1" }),
  },
  "blood-routing-v1": {
    keys: ["strategy"],
    failure: "Некорректная политика маршрутов bloodfx.dat.",
    capability: "blood-routing-v1",
    valid: ({ action, entry, requested, sets }) =>
      requested === "rpf-entry" && sets.update && action === "replace" && entry.toLowerCase() === BLOOD_ENTRY,
    build: () => ({ strategy: "blood-routing-v1" }),
    reads: "blood",
  },
  "ypt-texture-layer-v1": {
    keys: ["strategy", "coreChannel", "coreVersion", "texture", "slot"],
    failure: "Некорректная политика текстурного слоя PTFX.",
    capability: "ypt-texture-layer-v1",
    valid: ({ merge, action, entry, sets }) =>
      knownPtfxCore(merge.coreChannel, merge.coreVersion) &&
      /^[A-Za-z0-9_]{1,120}$/.test(rawText(merge.texture).trim()) &&
      cleanId(merge.slot) !== "" &&
      sets.update &&
      action === "replace" &&
      isCoreEntry(entry),
    build: ({ merge }) => ({
      strategy: "ypt-texture-layer-v1",
      coreChannel: merge.coreChannel,
      coreVersion: merge.coreVersion,
      texture: rawText(merge.texture).trim(),
      slot: cleanId(merge.slot),
    }),
  },
  "ypt-own-rules-v1": {
    keys: ["strategy", "coreChannel", "coreVersion", "slot", "prefix", "rules", "gameSheets"],
    failure: "Некорректная политика своих правил автора в ядре эффектов.",
    capability: "ypt-own-rules-v1",
    valid: ({ merge, action, entry, sets }) =>
      isPlayerCore(merge) &&
      cleanId(merge.slot) !== "" &&
      OWN_PREFIX.test(String(merge.prefix)) &&
      readOwnRules(merge) !== null &&
      (merge.gameSheets === undefined || readGameSheets(merge.gameSheets) !== null) &&
      sets.update &&
      action === "replace" &&
      isCoreEntry(entry),
    build({ merge }) {
      const result = {
        strategy: "ypt-own-rules-v1",
        coreChannel: merge.coreChannel,
        coreVersion: merge.coreVersion,
        slot: cleanId(merge.slot),
        prefix: merge.prefix,
        rules: readOwnRules(merge),
      };
      const sheets = merge.gameSheets === undefined ? [] : readGameSheets(merge.gameSheets);
      if (sheets.length > 0) result.gameSheets = sheets;
      return result;
    },
  },
  [WEAPONS_META_STRATEGY]: {
    keys: ["strategy"],
    failure: "Некорректная политика привязок трассеров weapons.meta.",
    capability: WEAPONS_META_STRATEGY,
    valid: ({ action, entry, requested, sets }) =>
      requested === "rpf-entry" && sets.update && action === "replace" && WEAPONS_META_ENTRY.test(entry),
    build: () => ({ strategy: WEAPONS_META_STRATEGY }),
    reads: "weapons-bindings",
  },
  "ptx-clip-rows-v1": {
    keys: ["strategy", "prefix"],
    failure: "Некорректная политика строк кадров ptxclipregions.dat.",
    capability: "ptx-clip-rows-v1",
    valid: ({ merge, action, entry, sets }) =>
      OWN_PREFIX.test(String(merge.prefix)) && sets.update && action === "replace" && entry.toLowerCase() === CLIP_ENTRY,
    build: ({ merge }) => ({ strategy: "ptx-clip-rows-v1", prefix: merge.prefix }),
  },
  "ypt-rule-patch-v1": {
    keys: ["strategy", "coreChannel", "coreVersion", "slot"],
    failure: "Некорректная политика правки правил ядра эффектов.",
    capability: "ypt-rule-patch-v1",
    valid: ({ merge, action, entry, sets }) =>
      isPlayerCore(merge) && cleanId(merge.slot) !== "" && sets.update && action === "replace" && isCoreEntry(entry),
    build: ({ merge }) => ({
      strategy: "ypt-rule-patch-v1",
      coreChannel: merge.coreChannel,
      coreVersion: merge.coreVersion,
      slot: cleanId(merge.slot),
    }),
  },
  "ptfx-core-base-v1": {
    keys: ["strategy", "coreChannel", "coreVersion"],
    failure: "Некорректная политика базового Astral PTFX Core.",
    capability: "ptfx-core-base-v1",
    valid: ({ merge, action, entry, sets }) => isSystemCore(merge) && sets.update && action === "import" && isCoreEntry(entry),
    build: ({ merge }) => ({ strategy: "ptfx-core-base-v1", coreChannel: merge.coreChannel, coreVersion: merge.coreVersion }),
  },
  "astral-tracer-v1": {
    keys: ["strategy", "role", "schemaVersion", "coreChannel", "coreVersion", "weapons", "chanceSP", "chanceMP"],
    failure: "Некорректная политика трассера Astral.",
    capability: "astral-tracer-v1",
    // Оружие нормализуется раньше остальных проверок: его отказы идут наружу как есть.
    prelude: ({ merge }) => normalizeTracerWeapons("selected", merge.weapons),
    valid: ({ merge, action, entry, sets }) =>
      merge.role === tracerRoleFor(entry) &&
      merge.schemaVersion === ASTRAL_TRACER_SCHEMA &&
      knownPtfxCore(merge.coreChannel, merge.coreVersion) &&
      readChance(merge.chanceSP) !== null &&
      readChance(merge.chanceMP) !== null &&
      sets.update &&
      action === "replace",
    build: ({ merge, prepared }) => ({
      strategy: "astral-tracer-v1",
      role: merge.role,
      schemaVersion: merge.schemaVersion,
      coreChannel: merge.coreChannel,
      coreVersion: merge.coreVersion,
      weapons: prepared,
      chanceSP: Number(merge.chanceSP),
      chanceMP: Number(merge.chanceMP),
    }),
  },
  "awc-stream-layer-v1": {
    keys: ["strategy", "bank", "streams", "completeBank"],
    failure: "Некорректная политика звукового слоя AWC.",
    capability: "awc-stream-layer-v1",
    valid: ({ merge, action, entry, requested, sets }) =>
      cleanId(merge.bank) !== "" &&
      readAwcStreams(merge.streams) !== null &&
      sets.audio &&
      requested === "rpf-entry" &&
      action === "replace" &&
      AWC_ENTRY.test(entry) &&
      cleanId(merge.bank) === path.posix.basename(entry).replace(/\.awc$/, "") &&
      (merge.completeBank === null || merge.completeBank === undefined || typeof merge.completeBank === "boolean"),
    build({ merge }) {
      const result = { strategy: "awc-stream-layer-v1", bank: cleanId(merge.bank), streams: readAwcStreams(merge.streams).sort() };
      if (merge.completeBank === true) result.completeBank = true;
      return result;
    },
  },
};

// Разбирает политику файла: null - объединения нет.
function parseMerge(merge, context) {
  if (merge === null || merge === undefined) return null;
  const strategyName = String(merge.strategy || "").trim();
  const strategy = Object.hasOwn(STRATEGIES, strategyName) ? STRATEGIES[strategyName] : undefined;
  if (strategy === undefined) throw new Error(`Неизвестная стратегия объединения: ${strategyName}.`);

  const ctx = { ...context, merge };
  if (strategy.prelude) ctx.prepared = strategy.prelude(ctx);
  const extraKey = Object.keys(merge).some((key) => !strategy.keys.includes(key));
  if (extraKey || !strategy.valid(ctx)) throw new Error(strategy.failure);
  return { strategy, strategyName, value: strategy.build(ctx) };
}

// ---------- Файлы ----------

function targetIsAllowed(target, entry, { requested, sets }) {
  const lowered = target.toLowerCase();
  if (target === "mods" || target.startsWith("mods/")) return true;
  if (target.startsWith("newmods/") && (requested === "rageopenv-loose" || requested === "managed-addon-dlc")) return true;
  if (requested === "gta-settings" && lowered === "settings.xml") return true;
  if (sets.update && lowered === UPDATE_RPF) return true;
  if (sets.weapons && lowered === WEAPONS_DLC) return true;
  if ((sets.clothing || sets.tattoo) && lowered === CLOTHING_DLC) return true;
  return sets.audio && isWeaponAudioLayerPlace(target, entry);
}

function duplicateKey(target, entry, requested) {
  return requested === "rpf-entry" ? `${target}::${entry ?? ""}`.toLowerCase() : target.toLowerCase();
}

async function describeFile(item, state, { materialize, readText }) {
  const { requested, sets, seen } = state;
  const action = String(item.action || "replace").trim().toLowerCase();
  if (!OPERATIONS.includes(action)) throw new Error(`Неизвестная операция RPF: ${action}.`);

  const source = action === "delete" ? undefined : normalizeRelativePath(item.source);
  const target = normalizeRelativePath(item.target);
  const hasEntry = item.entry !== null && item.entry !== undefined;
  const entry = hasEntry ? normalizeRelativePath(String(item.entry)) : undefined;

  const merge = parseMerge(item.merge, { action, entry: entry ?? "", requested, sets, spec: state.spec });
  if (!targetIsAllowed(target, entry, state)) throw new Error(MSG.onlyMods + target);

  const key = duplicateKey(target, entry, requested);
  if (seen.has(key)) throw new Error(MSG.duplicate + target);
  seen.add(key);

  if (action === "delete") {
    if (requested !== "rpf-entry" || !entry) throw new Error(MSG.deleteNeedsEntry);
    return { file: { action: "delete", target, entry }, action, target, entry, strategy: null };
  }

  const stored = await materialize(source);
  if (merge?.strategy.reads === "timecycle") parseTimecycleModifierXml(await readText(source));
  if (merge?.strategy.reads === "weapons-bindings") parseWeaponsMetaBindings(await readText(source));
  if (merge?.strategy.reads === "blood") {
    let routing;
    try {
      routing = JSON.parse(await readText(source));
    } catch {
      throw new Error(MSG.bloodJson);
    }
    normalizeBloodRouting(routing);
  }

  const file = { source, target };
  if (action !== "replace") file.action = action;
  if (entry !== undefined) file.entry = entry;
  if (merge !== null) file.merge = merge.value;
  file.size = stored.size;
  file.sha256 = stored.sha256;
  return { file, action, target, entry, strategy: merge?.strategy ?? null };
}

// ---------- Итоговый адаптер ----------

const ADAPTER_RULES = [
  {
    adapter: "rpf-overlay",
    message: MSG.needsRpfTargets,
    broken: ({ described }) => described.some((d) => !hasRpfExtension(d.target)),
  },
  {
    adapter: "rpf-entry",
    message: MSG.needsRpfEntry,
    broken: ({ described }) => described.some((d) => !hasRpfExtension(d.target) || !d.entry),
  },
  {
    adapter: "rageopenv-loose",
    message: MSG.looseTargets,
    broken: ({ spec, described }) => spec.requiresLoader === false || described.some((d) => !NEWMODS_LOOSE.test(d.target)),
  },
  {
    adapter: "gta-settings",
    message: MSG.settingsShape,
    broken: ({ described, files }) =>
      files.length !== 1 ||
      described[0].target.toLowerCase() !== "settings.xml" ||
      ![".xml", ".txt"].includes(path.posix.extname(files[0].source ?? "").toLowerCase()) ||
      described[0].action !== "replace",
  },
  {
    adapter: "managed-addon-dlc",
    message: MSG.dlcShape,
    broken: ({ spec, described }) => {
      const name = managedDlcName(spec);
      return (
        spec.requiresLoader === false ||
        !DLC_NAME.test(name) ||
        described.length !== 1 ||
        described[0].target.toLowerCase() !== `newmods/dlcpacks/${name}/dlc.rpf`
      );
    },
  },
];

const managedDlcName = (spec) => String(spec.dlcName || "").trim().toLowerCase();

function capabilitiesFor(adapter, described, sets, strategies) {
  const list = [];
  const add = (condition, name) => {
    if (condition && !list.includes(name)) list.push(name);
  };
  add(described.some((d) => d.action === "delete"), "rpf-delete-v1");
  add(described.some((d) => d.entry !== undefined && pathIsInsideRpf(d.entry)), "rpf-container-entry-v1");
  add(
    adapter === "rpf-entry" &&
      described.every(
        (d) => ["mods/update/update.rpf", UPDATE_RPF].includes(d.target.toLowerCase()) && d.action === "import" && ASTRAL_ENTRY.test(d.entry ?? ""),
      ),
    "astral-content-rpf-v1",
  );
  add(sets.astral, "direct-update-rpf-v1");
  add(sets.update, "direct-update-entries-v1");
  add(sets.weapons, "direct-weapon-dlc-v1");
  add(sets.clothing || sets.tattoo, "direct-clothing-dlc-v1");
  for (const name of STRATEGY_CAPABILITY_ORDER) {
    add(strategies.some((strategy) => strategy.capability === name), name);
  }
  add(adapter === "gta-settings", "preserve-video-card-description-v1");
  return list;
}

const STRATEGY_CAPABILITY_ORDER = [
  "timecycle-modifier-merge-v1",
  "ypt-texture-layer-v1",
  "ptfx-core-base-v1",
  "ypt-rule-patch-v1",
  "ypt-own-rules-v1",
  "ptx-clip-rows-v1",
  "astral-tracer-v1",
  "awc-stream-layer-v1",
  "blood-routing-v1",
  WEAPONS_META_STRATEGY,
];

function pickEditions(list) {
  if (!Array.isArray(list) || list.length === 0) return ["Legacy"];
  const picked = [...new Set(list.filter((edition) => EDITIONS.includes(edition)))];
  if (picked.length === 0) throw new Error(MSG.editions);
  return picked;
}

function scopeFor(adapter, anyDirect) {
  if (anyDirect) return "game-root";
  if (adapter === "rageopenv-loose" || adapter === "managed-addon-dlc") return "newmods-vfs";
  return adapter === "gta-settings" ? "gta-settings" : "mods-only";
}

export async function buildManifest(spec, { materialize, readText, inspectSettingsXml }) {
  const id = cleanId(spec.id);
  const version = cleanId(spec.version || "1.0.0");
  if (!id) throw new Error(MSG.noId);
  const files = spec.files;
  if (!Array.isArray(files) || files.length === 0) throw new Error(MSG.noFiles);

  const requested = requestedAdapter(spec, files);
  const sets = directSets(spec, files, requested);

  const state = { spec, requested, sets, seen: new Set() };
  const described = [];
  for (const item of files) described.push(await describeFile(item, state, { materialize, readText }));

  const adapter = requested ?? (described.every((d) => hasRpfExtension(d.target)) ? "rpf-overlay" : "file-overlay");
  const checkContext = { spec, described, files: described.map((d) => d.file) };
  const brokenRule = ADAPTER_RULES.find((rule) => rule.adapter === adapter && rule.broken(checkContext));
  if (brokenRule) throw new Error(brokenRule.message);
  if (adapter === "gta-settings") inspectSettingsXml(await readText(checkContext.files[0].source));
  if (described.some((d) => d.action !== "replace") && adapter !== "rpf-entry") throw new Error(MSG.operationsOnlyEntry);

  const strategies = described.map((d) => d.strategy).filter(Boolean);
  const capabilities = capabilitiesFor(adapter, described, sets, strategies);
  const anyDirect = sets.update || sets.weapons || sets.clothing || sets.tattoo || sets.audio;

  const manifest = {
    id,
    version,
    adapter,
    editions: pickEditions(spec.editions),
    requiresLoader: adapter === "gta-settings" || anyDirect ? false : spec.requiresLoader !== false,
    gameplayChanges: adapter === "gta-settings" ? false : spec.gameplayChanges !== false,
    scope: scopeFor(adapter, anyDirect),
  };
  if (adapter === "managed-addon-dlc") manifest.dlcName = managedDlcName(spec);
  if (capabilities.length > 0) manifest.capabilities = capabilities;
  manifest.slots = Array.isArray(spec.slots) ? [...new Set(spec.slots.map(cleanId).filter(Boolean))] : [];
  manifest.files = described.map((d) => d.file);
  if (capabilities.includes("astral-tracer-v1")) manifest.tracer = spec.tracer;

  for (const edition of manifest.editions) {
    validateManifest(manifest, edition, { allowGameRootWrites: true });
  }
  return { manifest, canonical: canonicalManifest(manifest) };
}
