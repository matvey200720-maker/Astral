// Банки звука оружия: где лежит банк, из каких слоёв состоит ствол и как стволы собираются в группы.
import * as awc from "@modovik/awc";
import * as studio from "@modovik/sound-studio";

export const WEAPONS_PLAYER = "x64/audio/sfx/WEAPONS_PLAYER.rpf";
export const RESIDENT = "x64/audio/sfx/RESIDENT.rpf";

export const DLC_WEAPON_BANKS = Object.freeze({
  weapon_heavy_rifle: Object.freeze({
    archive: "update/x64/dlcpacks/mpsecurity/dlc.rpf",
    folder: "x64/audio/sfx/dlc_security/",
    weapon: Object.freeze({ id: "WEAPON_HEAVYRIFLE", model: "w_ar_heavyrifleh", title: "Тяжёлая винтовка" }),
  }),
});

const dlcArchives = Object.values(DLC_WEAPON_BANKS).map((entry) => entry.archive);
export const LAYER_ARCHIVES = Object.freeze(Array.from(new Set([WEAPONS_PLAYER, RESIDENT, ...dlcArchives])));

const AWC_EXTENSION = ".awc";
const SHARED_BANK = "weapons";
const has = (table, key) => Object.hasOwn(table, key);
const ascending = (a, b) => a - b;

// Какие архивы игры узнаются по окончанию пути дорожки (без учёта регистра).
const ARCHIVE_BY_TAIL = [
  ["weapons_player.rpf", WEAPONS_PLAYER],
  ["resident.rpf", RESIDENT],
];

/* ---------------------------------------------------------------- bankPlace */

// Банк пакета дополнения по имени или null (прототипные имена не находятся).
const dlcBankOf = (name) => (has(DLC_WEAPON_BANKS, name) ? DLC_WEAPON_BANKS[name] : null);

export function bankPlace(path) {
  const parts = String(path ?? "").replaceAll("\\", "/").split("/");
  const lastPart = parts.pop();
  const fileName = lastPart.toLowerCase();
  if (!fileName.endsWith(AWC_EXTENSION)) return null;

  const bank = fileName.slice(0, -AWC_EXTENSION.length);
  const parent = (parts.at(-1) ?? "").toLowerCase();
  const dlc = dlcBankOf(bank);
  const stock = has(studio.WEAPON_BANKS, bank);
  const dlcFolder = dlc ? dlc.folder.replace(/\/$/, "").toLowerCase() : null;
  const inDlcFolder = dlcFolder !== null && parts.join("/").toLowerCase().endsWith(dlcFolder);

  const place = (archive, anchorParts) => ({ archive, bank, anchor: anchorParts.join("/") });
  const insideArchive = parts.slice(0, -1);
  const dlcAnchor = () => {
    const depth = dlc.folder.split("/").filter(Boolean).length;
    return inDlcFolder ? parts.slice(0, parts.length - depth) : parts;
  };

  // Правила идут сверху вниз; срабатывает первое подходящее.
  if (parent === "weapons_player.rpf") return place(WEAPONS_PLAYER, insideArchive);
  if (parent === "resident.rpf") return bank === SHARED_BANK ? place(RESIDENT, insideArchive) : null;
  if (dlc && (inDlcFolder || !parent.endsWith(".rpf"))) return place(dlc.archive, dlcAnchor());
  if (parent.endsWith(".rpf")) return null;
  if (bank === SHARED_BANK) return place(RESIDENT, parts);
  return stock ? place(WEAPONS_PLAYER, parts) : null;
}

/* ------------------------------------------------------------ слои и слоты */

// Ключи банков равны, как у Map: NaN равен NaN, +0 равен -0.
const sameKey = (left, right) => left === right || (Number.isNaN(left) && Number.isNaN(right));

export function weaponLayers(weapon) {
  const layers = [];
  for (const track of weapon.voice || []) {
    const tail = track.archive.toLowerCase();
    const archive = ARCHIVE_BY_TAIL.find(([suffix]) => tail.endsWith(suffix))?.[1];
    const stream = archive === undefined ? null : awc.awcStreamId(track.stream);
    if (stream === null) continue;

    let layer = layers.find((known) => known.archive === archive && sameKey(known.bank, track.bank));
    if (!layer) {
      layer = { archive, bank: track.bank, streams: new Set() };
      layers.push(layer);
    }
    layer.streams.add(stream);
  }
  return layers;
}

export function streamSlot(bank, id) {
  const place = bank.replace(/[^a-z0-9]+/g, "-");
  return `sound-${place}-${awc.awcStreamName(id).toLowerCase()}`;
}

export function weaponsOfSoundSlots(slots) {
  if (!Array.isArray(slots)) return [];
  const installed = new Set(slots);
  const slotInstalled = (layer, stream) => installed.has(streamSlot(layer.bank, stream));
  const present = (layer) => Array.from(layer.streams).some((stream) => slotInstalled(layer, stream));
  return studio.WEAPON_SOUNDS.filter((weapon) => weaponLayers(weapon).some(present));
}

/* ------------------------------------------------------------------ группы */

const layerKey = (layer) => `${layer.archive}|${layer.bank}`;
const streamKeys = (layers) =>
  layers.flatMap((layer) => Array.from(layer.streams, (stream) => `${layerKey(layer)}|${stream}`));

// Решение по одному стволу: null — молча пропустить, { skip } — пропуск с причиной, { take } — берём.
function judgeWeapon(weapon, { banks, common, sharedOnly }) {
  const layers = weaponLayers(weapon);
  const inArchive = (archive) => layers.filter((layer) => layer.archive === archive);
  const [shared, own] = [RESIDENT, WEAPONS_PLAYER].map(inArchive);
  // Общий банк годится, если он есть, не зашифрован и держит все потоки перечисленных слоёв.
  const commonHolds = (wanted) => {
    if (!common || common.encrypted) return false;
    const holds = (layer) => Array.from(layer.streams).every((stream) => common.streams.has(stream));
    return wanted.every(holds);
  };

  if (sharedOnly) {
    if (!shared.length || !commonHolds(shared)) return null;
    return { take: { weapon, layers: shared, partial: false, shared: true } };
  }

  const packed = own.map((layer) => banks.get(`${WEAPONS_PLAYER}|${layer.bank}`));
  if (!own.length || packed.some((bank) => !bank || bank.encrypted)) return null;

  const lacking = [];
  own.forEach((layer, i) => {
    for (const stream of layer.streams) {
      if (!packed[i].streams.has(stream)) lacking.push(stream);
    }
  });
  if (lacking.length > 0) {
    const reason = `в банке пака нет потоков ствола (${lacking.length})`;
    return { skip: { weapon: weapon.id, title: weapon.title, reason } };
  }

  const whole = commonHolds(shared);
  return { take: { weapon, layers: whole ? layers : own, partial: !whole && shared.length > 0, shared: false } };
}

// Стволы связаны, если делят хотя бы один поток (архив, банк, номер); связность транзитивна —
// объединение по общему потоку, компоненты идут по наименьшему номеру ствола.
function linkedComponents(members) {
  const parent = members.map((_, index) => index);
  const rootOf = (index) => {
    let at = index;
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]];
      at = parent[at];
    }
    return at;
  };
  const firstHolder = new Map();
  members.forEach((member, index) => {
    for (const key of streamKeys(member.layers)) {
      if (!firstHolder.has(key)) firstHolder.set(key, index);
      else parent[rootOf(index)] = rootOf(firstHolder.get(key));
    }
  });

  const components = new Map();
  members.forEach((member, index) => {
    const root = rootOf(index);
    components.set(root, [...(components.get(root) ?? []), member]);
  });
  return [...components.values()];
}

// Порядок слоёв: по архиву, затем по банку.
const byText = (field) => (a, b) => a[field].localeCompare(b[field]);
const LAYER_ORDER = [byText("archive"), byText("bank")];

// Слои стволов группы, слитые по паре «архив, банк».
function foldLayers(members) {
  const folded = new Map();
  for (const layer of members.flatMap((member) => member.layers)) {
    const key = layerKey(layer);
    if (!folded.has(key)) folded.set(key, { archive: layer.archive, bank: layer.bank, streams: new Set() });
    for (const stream of layer.streams) folded.get(key).streams.add(stream);
  }
  const layers = [];
  for (const layer of folded.values()) layers.push({ ...layer, streams: [...layer.streams].sort(ascending) });
  return layers.sort((a, b) => LAYER_ORDER.reduce((diff, compare) => diff || compare(a, b), 0));
}

function toGroup(members) {
  return {
    weapons: members.map((member) => member.weapon),
    layers: foldLayers(members),
    partial: members.some((member) => member.partial),
    ...(members.some((member) => member.shared) && { shared: true }),
  };
}

// Запись пака с банком пакета дополнения: группа, пропуск или ничего (чужой ключ, зашифрованный банк).
function judgeDlcBank(record) {
  const [key, entry] = record;
  const pieces = key.split("|");
  const [archive, bankName] = [pieces[0], pieces[1]];
  const dlc = dlcBankOf(bankName);
  if (!dlc || dlc.archive !== archive || entry.encrypted) return null;

  const streams = [...entry.streams].sort(ascending);
  if (streams.length === 0) {
    const { id: weapon, title } = dlc.weapon;
    return { skip: { weapon, title, reason: "в банке пака нет потоков" } };
  }
  const layer = { archive, bank: bankName, entry: `${dlc.folder}${bankName}.awc`, streams };
  return { group: { weapons: [dlc.weapon], layers: [layer], partial: false } };
}

// Поле field у тех решений, где оно есть (в порядке решений).
const pluck = (verdicts, field) => verdicts.filter((verdict) => verdict[field]).map((verdict) => verdict[field]);

export function soundGroups(banks, { sharedOnly = false } = {}) {
  if (!(banks instanceof Map)) throw new TypeError("soundGroups: нужен Map банков пака.");

  const context = { banks, common: banks.get(`${RESIDENT}|${SHARED_BANK}`), sharedOnly };
  const verdicts = studio.WEAPON_SOUNDS.map((weapon) => judgeWeapon(weapon, context)).filter(Boolean);
  // Банки дополнений берутся из любых ключей пака, в том числе в режиме sharedOnly.
  const dlcVerdicts = Array.from(banks, judgeDlcBank).filter(Boolean);

  const streamGroups = linkedComponents(pluck(verdicts, "take")).map(toGroup);
  const groups = [...streamGroups, ...pluck(dlcVerdicts, "group")];
  const skipped = pluck([...verdicts, ...dlcVerdicts], "skip");

  const titleOf = (group) => group.weapons[0].title;
  groups.sort((a, b) => titleOf(a).localeCompare(titleOf(b), "ru"));
  return { groups, skipped };
}
