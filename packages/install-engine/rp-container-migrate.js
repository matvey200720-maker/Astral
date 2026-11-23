import fs from "node:fs/promises";
import { LIVE_CARRIER_TARGETS } from "./carrier-targets.js";
import { rebasableArchive, rebaseArchiveIfNeeded } from "./archive-rebase.js";
import { CLOTHING_DLC_NAME, CLOTHING_DLC_TARGET, clothingHostReady } from "./clothing-dlc.js";
import { CLOTHING_CONTAINER, CLOTHING_UPDATE_TARGET, clothingContainerRoute, clothingUpdateRouteEnabled } from "./clothing-update-route.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { readState, serializeMutation } from "./engine-state.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { FAST_WEAPON_DLC_NAME, FAST_WEAPON_DLC_TARGET, fastWeaponHostReady } from "./fast-weapon-dlc.js";
import { resolveInside } from "./manifest.js";
import { ASTRAL_UPDATE_TARGET, composeAstralContentRegistry, composeDirectDlcRegistry, isAstralUpdateTarget } from "./registry-composers.js";
import { composeArchiveResource, ensureArchiveResource } from "./resource-composition.js";
import { inOperation } from "./operation-scope.js";
import { ROADS_DLC_PACKS, roadsPackOf, roadsStreamOf } from "./roads-dlc.js";
import {
  ROADS_BUDGET_ALIGN_BYTES,
  ROADS_CONTAINER_MAX_BYTES,
  ROADS_UPDATE_TARGET,
  roadsBudgetBytes,
  roadsUpdateEntry,
  roadsUpdateRouteEnabled,
} from "./roads-update-route.js";
import { roadsCarrierRouteEnabled } from "./roads-carrier-route.js";
import { assertRuntimeSafe, throwIfAborted } from "./runtime-guard.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { DEFAULT_DIR, activeBaselinePath, statePaths } from "./storage-state.js";
import { recoverPendingTransactions, transact } from "./transactions.js";
import { WEAPONS_UPDATE_TARGET, WEAPON_CONTAINER_ENTRY_PREFIX, WEAPON_HOST_PREFIX, isContainerLeaf, weaponUpdateMode } from "./weapon-update-route.js";

/*
 * Перенос уже стоящих модов между пакетами `astral_*` и контейнерами слоя в `update.rpf` (GTA 5 RP, 20.11.2026, `docs/RP-CONTAINER-MIGRATE.md`).
 *
 * Клиент GTA 5 RP не открывает пакеты `astral_*` и читает `update.rpf`: режимы `ASTRAL_WEAPONS_VIA_UPDATE=container`, `ASTRAL_CLOTHING_VIA_UPDATE` и
 * `ASTRAL_ROADS_VIA_UPDATE` кладут новые установки в контейнеры `x64/astral/astral_rp_*.rpf`, а то, что стоит в пакетах с прошлых установок, оставляли
 * на месте. Здесь это переезжает: на уровне СОСТОЯНИЯ, без манифеста и подписи (их у стоящего мода уже нет): слой записи переносится между записями
 * архивов состояния, тело берётся из кэша установки (`cachePath`), архивы собираются заново и подменяются одной транзакцией (`transact`, журнал).
 * Образец — `migrateLegacyWeaponLayers` (`fast-weapon-dlc.js`), `restoreParkedMods` и `uninstallPackage`.
 *
 * За выключателем `ASTRAL_RP_MIGRATE` (`1`, `true`, `on`), по умолчанию выключено: без него приложение не создаёт исполнителя, существующий код не
 * меняется. Направление каждого вида задаёт его режим: включён — вперёд (пакеты → контейнер), выключен — назад; режим оружия `patch` вид не трогает.
 *
 * Чистые части (`rpInventory`, `rpMigrationPlan`, `applyRpMigration`) ввода-вывода не делают; `migrateRpContainers` — исполнитель.
 */

export const RP_MIGRATE_ENV = "ASTRAL_RP_MIGRATE";
export const RP_MIGRATE_ACTION = "rp-migrate";

export const rpMigrateEnabled = (env = {}) => ["1", "true", "on"].includes(String(env?.[RP_MIGRATE_ENV] ?? "").trim().toLowerCase());

const lower = (value) => String(value ?? "").toLowerCase();

/* ------------------------------------------------------------------------------------------ */
/* Три вида: где стоят в пакетах, где в контейнерах, как отображается запись                  */
/* ------------------------------------------------------------------------------------------ */

const HOST_PACKS = Object.freeze({
  weapons: Object.freeze([
    Object.freeze({ target: FAST_WEAPON_DLC_TARGET, name: FAST_WEAPON_DLC_NAME, state: "fastWeaponDlc", owner: "@astral-fast-weapon-host" }),
  ]),
  clothing: Object.freeze([
    Object.freeze({ target: CLOTHING_DLC_TARGET, name: CLOTHING_DLC_NAME, state: "clothingDlc", owner: "@astral-clothing-host" }),
  ]),
  roads: Object.freeze(ROADS_DLC_PACKS.map((pack) => Object.freeze({ target: pack.target, name: pack.name, state: null, owner: pack.owner }))),
});

const ROADS_CONTAINER_ENTRY = /^x64\/astral\/astral_rp_road(?:_b)?\.rpf\/([^/]+)$/;

export const RP_KINDS = Object.freeze(["weapons", "clothing", "roads"]);

/** Цели пакетов вида (что «стоит в пакетах»). */
const hostTargetsOf = (kind) => HOST_PACKS[kind].map((pack) => pack.target);

/**
 * Где запись пакета окажется в контейнере: `{ target, entry }` или `{ reason }`. `layer` — слой записи в состоянии (одежде важно действие).
 */
const FORWARD = {
  weapons({ target, entry }) {
    if (target !== FAST_WEAPON_DLC_TARGET || !lower(entry).startsWith(WEAPON_HOST_PREFIX)) return { reason: "not-host-entry" };
    const leaf = String(entry).slice(WEAPON_HOST_PREFIX.length);
    if (!isContainerLeaf(leaf)) return { reason: "bad-name" };
    return { target: WEAPONS_UPDATE_TARGET, entry: `${WEAPON_CONTAINER_ENTRY_PREFIX}${leaf}` };
  },
  clothing({ target, entry, layer }) {
    if (target !== CLOTHING_DLC_TARGET) return { reason: "not-host-entry" };
    if (layer?.action !== "import") return { reason: "not-import" };
    const route = clothingContainerRoute(entry);
    if (!route.ready) return { reason: route.reason };
    return { target: CLOTHING_UPDATE_TARGET, entry: route.entry };
  },
  roads({ target, entry }) {
    const pack = ROADS_DLC_PACKS.find((item) => item.target === target);
    if (!pack) return { reason: "not-host-entry" };
    const parts = lower(entry).split("/");
    /* Потоковые архивы частей — в контейнер; `<пакет>_mp.rpf` (сетевая карта, `hei_…`) контейнера не имеет. */
    if (parts.length !== 2 || !pack.streams.includes(parts[0]) || !parts[1]) return { reason: "not-movable" };
    return { target: ROADS_UPDATE_TARGET, entry: roadsUpdateEntry(parts[1]) };
  },
};

/** Запись в контейнере → `{ leaf }` (имя внутри контейнера вида) или `null`, если запись не этого вида. */
const CONTAINER_LEAF = {
  weapons: (entry) => (lower(entry).startsWith(WEAPON_CONTAINER_ENTRY_PREFIX) ? String(entry).slice(WEAPON_CONTAINER_ENTRY_PREFIX.length) : null),
  clothing: (entry) => (lower(entry).startsWith(`${CLOTHING_CONTAINER}/`) ? String(entry).slice(CLOTHING_CONTAINER.length + 1) : null),
  roads: (entry) => ROADS_CONTAINER_ENTRY.exec(lower(entry))?.[1] ?? null,
};

/** Запись контейнера → прежнее место в пакете: из `migratedFrom`, иначе по умолчанию вида. */
const BACK = {
  weapons: (leaf) => ({ target: FAST_WEAPON_DLC_TARGET, entry: `${WEAPON_HOST_PREFIX}${leaf}` }),
  clothing: (leaf) => ({ target: CLOTHING_DLC_TARGET, entry: `astral_stream_00.rpf/${leaf}` }),
  roads: (leaf) => {
    const pack = roadsPackOf(leaf);
    return pack ? { target: pack.target, entry: `${roadsStreamOf(leaf)}/${leaf}` } : null;
  },
};

/** Режим вида: `on` (контейнер), `off`, `other` (оружие в режиме `patch` — вид не трогается). */
export function rpKindMode(kind, env = {}) {
  if (kind === "weapons") {
    const mode = weaponUpdateMode(env);
    return mode === "container" ? "on" : mode === null ? "off" : "other";
  }
  if (kind === "clothing") return clothingUpdateRouteEnabled(env) ? "on" : "off";
  /* Дороги через носитель (`carrier`): ни в контейнеры `update.rpf`, ни обратно в пакеты перенос не трогает — старые дороги снимает/заменяет «Применить» и «Откатить». */
  if (kind === "roads") return roadsCarrierRouteEnabled(env) ? "other" : roadsUpdateRouteEnabled(env) ? "on" : "off";
  throw new Error(`Неизвестный вид переноса: ${kind}`);
}

/* ------------------------------------------------------------------------------------------ */
/* Перечень стоящего                                                                          */
/* ------------------------------------------------------------------------------------------ */

const entriesOf = (target, archiveTarget) => Object.entries(target?.archives?.[archiveTarget]?.entries || {});

/**
 * Перечень стоящего по видам: `{ weapons: { inPacks: [{ modId, target, entry, layer }], inContainer: [...] }, … }`. Чистая функция по состоянию.
 * В пакетах — слои записей пакетов вида; в контейнере — слои записей контейнера вида в `update.rpf`.
 */
export function rpInventory(target) {
  const out = {};
  for (const kind of RP_KINDS) {
    const inPacks = [];
    for (const hostTarget of hostTargetsOf(kind))
      for (const [entry, state] of entriesOf(target, hostTarget))
        for (const layer of state?.layers || []) if (layer?.modId) inPacks.push({ modId: layer.modId, target: hostTarget, entry, layer });
    const inContainer = [];
    for (const [entry, state] of entriesOf(target, ASTRAL_UPDATE_TARGET)) {
      const leaf = CONTAINER_LEAF[kind](entry);
      if (leaf === null) continue;
      for (const layer of state?.layers || []) if (layer?.modId && layer.astralContent === true) inContainer.push({ modId: layer.modId, target: ASTRAL_UPDATE_TARGET, entry, leaf, layer });
    }
    out[kind] = { inPacks, inContainer };
  }
  return out;
}

/** Есть ли что переносить при этом окружении (без размеров и чтения файлов): дешёвая проверка до любого ввода-вывода. */
export function rpMigrationNeeded(target, env = {}) {
  if (!rpMigrateEnabled(env)) return false;
  const inventory = rpInventory(target);
  return RP_KINDS.some((kind) => {
    const mode = rpKindMode(kind, env);
    return (mode === "on" && inventory[kind].inPacks.length > 0) || (mode === "off" && inventory[kind].inContainer.length > 0);
  });
}

/* ------------------------------------------------------------------------------------------ */
/* План                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const MiB = 1024 * 1024;
const miB = (bytes) => Math.ceil(bytes / MiB);
const costOf = (count, bytes) => bytes + count * ROADS_BUDGET_ALIGN_BYTES;
const containerOf = (entry) => entry.split("/").slice(0, 3).join("/");

function emptyKind(kind, mode) {
  return { kind, mode, direction: "none", moves: [], dropped: [], kept: [], refusal: null, bytes: 0 };
}

/**
 * Прямой перенос вида: слои пакетов → записи контейнера. Всё, что не отображается, — в `kept` с причиной; маски оружия — в `dropped`.
 * Дороги — всё или ничего: любая оставшаяся запись или отказ по бюджету снимает весь перенос вида (`refusal`).
 */
function planForward(kind, target, { sizeOf, remaining }) {
  const plan = emptyKind(kind, "on");
  plan.direction = "forward";
  const sources = new Map();
  const taken = new Map();
  const standing = target?.archives?.[ASTRAL_UPDATE_TARGET]?.entries || {};
  for (const item of rpInventory(target)[kind].inPacks) {
    const { modId, layer } = item;
    const where = { modId, target: item.target, entry: item.entry };
    if (layer.action === "delete") {
      /* Маска в контейнере не нужна (запись, которой не положили, там и так нет): в оружии снимается и помнится, в остальных видах — остаётся. */
      if (kind === "weapons") plan.dropped.push({ ...where, allowMissing: layer.allowMissing === true });
      else plan.kept.push({ ...where, reason: "not-import" });
      continue;
    }
    const mapped = FORWARD[kind]({ target: item.target, entry: item.entry, layer });
    if (mapped.reason) {
      plan.kept.push({ ...where, reason: mapped.reason });
      continue;
    }
    const size = sizeOf(layer);
    if (!Number.isFinite(size) || size < 0) {
      plan.kept.push({ ...where, reason: "body-missing" });
      continue;
    }
    const sourceKey = `${item.target}\n${item.entry}`;
    const claimed = taken.get(mapped.entry);
    if (claimed !== undefined && claimed !== sourceKey) {
      plan.kept.push({ ...where, reason: "duplicate" });
      continue;
    }
    if ((standing[mapped.entry]?.layers || []).some((existing) => existing.modId !== modId)) {
      plan.kept.push({ ...where, reason: "container-occupied" });
      continue;
    }
    taken.set(mapped.entry, sourceKey);
    sources.set(mapped.entry, sourceKey);
    plan.moves.push({ ...where, to: mapped, size });
  }
  plan.bytes = plan.moves.reduce((sum, move) => sum + move.size, 0);
  if (kind === "roads" && plan.kept.length) {
    plan.refusal = { code: "not-movable", reasons: [...new Set(plan.kept.map((item) => item.reason))] };
  } else if (plan.moves.length) {
    const cost = costOf(plan.moves.length, plan.bytes);
    const perContainer = new Map();
    for (const move of plan.moves) perContainer.set(containerOf(move.to.entry), (perContainer.get(containerOf(move.to.entry)) || 0) + move.size);
    const heaviest = Math.max(...[...perContainer.values()].map((bytes) => bytes + ROADS_BUDGET_ALIGN_BYTES));
    if (cost > remaining || heaviest > ROADS_CONTAINER_MAX_BYTES) {
      plan.refusal = { code: "over-budget", needMiB: miB(Math.max(cost, heaviest)), budgetMiB: miB(Math.max(0, remaining)) };
    }
  }
  if (plan.refusal) {
    plan.kept = [...plan.kept, ...plan.moves.map(({ modId, target: fromTarget, entry }) => ({ modId, target: fromTarget, entry, reason: plan.refusal.code }))];
    plan.moves = [];
    plan.dropped = [];
    plan.bytes = 0;
  }
  return plan;
}

/** Обратный перенос вида: слои контейнера → прежние записи пакетов. Пакет не готов — отказ всего вида (слои остаются в контейнере). */
function planBack(kind, target, { hostReady }) {
  const plan = emptyKind(kind, "off");
  plan.direction = "back";
  for (const item of rpInventory(target)[kind].inContainer) {
    const { modId, layer } = item;
    const from = layer.migratedFrom && typeof layer.migratedFrom === "object" ? { target: layer.migratedFrom.target, entry: layer.migratedFrom.entry } : null;
    const to = from?.target && from?.entry ? from : BACK[kind](item.leaf);
    const where = { modId, target: item.target, entry: item.entry };
    if (!to) {
      plan.kept.push({ ...where, reason: "no-origin" });
      continue;
    }
    plan.moves.push({ ...where, to, size: 0 });
  }
  if (plan.moves.length && !hostReady) {
    plan.refusal = { code: "host-not-ready" };
    plan.kept.push(...plan.moves.map(({ modId, target: fromTarget, entry }) => ({ modId, target: fromTarget, entry, reason: "host-not-ready" })));
    plan.moves = [];
  }
  return plan;
}

/**
 * План переноса по состоянию и окружению. `updateLength` — длина живого `update.rpf` (нужна вперёд), `sizeOf(layer)` — размер тела в кэше или `null`,
 * `hostReady` — `{ weapons, clothing, roads }` (нужны назад). Виды идут оружие → одежда → дороги, каждый берёт из остатка бюджета.
 * Ответ: `{ kinds: { weapons, clothing, roads }, moved, budget, lines }`.
 */
export function rpMigrationPlan({ target, env = {}, updateLength = null, sizeOf = () => null, hostReady = {} } = {}) {
  const kinds = {};
  let remaining = Number.isFinite(updateLength) ? roadsBudgetBytes({ updateLength }) : 0;
  const budget = remaining;
  const inventory = rpInventory(target);
  for (const kind of RP_KINDS) {
    const mode = rpKindMode(kind, env);
    if (mode === "other") kinds[kind] = emptyKind(kind, "other");
    else if (mode === "on") {
      if (!inventory[kind].inPacks.length) kinds[kind] = emptyKind(kind, "on");
      else if (!Number.isFinite(updateLength)) {
        kinds[kind] = { ...emptyKind(kind, "on"), direction: "forward", refusal: { code: "no-update-length" } };
      } else {
        kinds[kind] = planForward(kind, target, { sizeOf, remaining });
        remaining -= costOf(kinds[kind].moves.length, kinds[kind].bytes);
      }
    } else if (!inventory[kind].inContainer.length) kinds[kind] = emptyKind(kind, "off");
    else kinds[kind] = planBack(kind, target, { hostReady: hostReady[kind] === true });
  }
  const moved = Object.fromEntries(RP_KINDS.map((kind) => [kind, kinds[kind].moves.length]));
  return { kinds, moved, budget, lines: rpMigrationLines(kinds) };
}

const names = (list) => (list.length ? list.join(", ") : "—");
const reasonsOf = (items) => {
  const counts = new Map();
  for (const { reason } of items) counts.set(reason, (counts.get(reason) || 0) + 1);
  return [...counts].map(([reason, count]) => `${reason} ×${count}`).join(", ");
};
const KIND_TITLE = { weapons: "Оружие", clothing: "Одежда", roads: "Дороги" };

/** Строки журнала приложения (видимых человеку строк нет). */
export function rpMigrationLines(kinds) {
  const lines = [];
  for (const kind of RP_KINDS) {
    const plan = kinds[kind];
    if (!plan || plan.direction === "none") continue;
    const title = `${KIND_TITLE[kind]}: перенос ${plan.direction === "forward" ? "из пакетов в контейнер update.rpf" : "из контейнера update.rpf в пакеты"}`;
    if (plan.refusal) {
      const params =
        plan.refusal.code === "over-budget"
          ? ` (нужно ${plan.refusal.needMiB} МиБ, свободно ${plan.refusal.budgetMiB} МиБ)`
          : plan.refusal.reasons
            ? ` (${names(plan.refusal.reasons)})`
            : "";
      lines.push(`${title}, отказ ${plan.refusal.code}${params}: стоящее остаётся как есть.`);
      continue;
    }
    if (!plan.moves.length && !plan.dropped.length) {
      if (plan.kept.length) lines.push(`${title}: переносить нечего, остаются на месте ${plan.kept.length} (${reasonsOf(plan.kept)}).`);
      continue;
    }
    lines.push(
      `${title}: ${plan.moves.length} записей` +
        (plan.dropped.length ? `, масок снято ${plan.dropped.length}` : "") +
        (plan.kept.length ? `, остаются на месте ${plan.kept.length} (${reasonsOf(plan.kept)})` : "") +
        ".",
    );
  }
  return lines;
}

/* ------------------------------------------------------------------------------------------ */
/* Правка состояния                                                                           */
/* ------------------------------------------------------------------------------------------ */

const archiveOf = (target, archiveTarget) => {
  target.archives ||= {};
  target.archives[archiveTarget] ||= { entries: {} };
  target.archives[archiveTarget].entries ||= {};
  return target.archives[archiveTarget];
};
const recordOf = (target, modId) => (target.installed || []).find((item) => item?.modId === modId);

function detachLayer(target, from, modId) {
  const archive = target.archives?.[from.target];
  const state = archive?.entries?.[from.entry];
  if (!state) return null;
  const layer = (state.layers || []).find((item) => item.modId === modId);
  state.layers = (state.layers || []).filter((item) => item.modId !== modId);
  if (!state.layers.length) delete archive.entries[from.entry];
  return layer || null;
}

function attachLayer(target, to, layer) {
  const state = (archiveOf(target, to.target).entries[to.entry] ||= { layers: [] });
  state.layers = [...(state.layers || []).filter((item) => item.modId !== layer.modId), layer];
}

function moveRecordEntry(target, modId, from, to) {
  const record = recordOf(target, modId);
  if (!record) return;
  const entries = Array.isArray(record.archiveEntries) ? record.archiveEntries : [];
  const old = entries.find((item) => item.target === from.target && item.entry === from.entry);
  const kept = entries.filter((item) => !(item.target === from.target && item.entry === from.entry));
  if (!kept.some((item) => item.target === to.target && item.entry === to.entry)) kept.push({ ...(old || {}), target: to.target, entry: to.entry });
  record.archiveEntries = kept;
  /* Запись переигрывания относилась к прежнему составу `update.rpf`. */
  delete record.engineReplay;
}

function dropRecordEntry(target, modId, from) {
  const record = recordOf(target, modId);
  if (!record) return;
  record.archiveEntries = (record.archiveEntries || []).filter((item) => !(item.target === from.target && item.entry === from.entry));
}

const hasLayers = (target, archiveTarget) =>
  Object.values(target.archives?.[archiveTarget]?.entries || {}).some((state) => (state?.layers || []).length > 0);

/**
 * Применяет план к состоянию на месте. Ответ: `{ archives, registryChanged }` — какие архивы сменятся и менялась ли регистрация пакетов.
 * Вперёд: слой записи пакета → запись контейнера (`astralContent`, `migratedFrom`); пакет, в котором не осталось слоёв, снимается с регистрации
 * (`preparedOnly = true`), как при снятии последней вещи. Назад: слой возвращается на `migratedFrom`, пакет регистрируется, маски оружия встают на место.
 */
export function applyRpMigration(target, plan) {
  const archives = new Set();
  let registryChanged = false;
  target.directDlcRegistrations ||= {};
  for (const kind of RP_KINDS) {
    const item = plan.kinds[kind];
    if (!item || (!item.moves.length && !item.dropped.length)) continue;
    if (item.direction === "forward") {
      for (const move of item.moves) {
        const layer = detachLayer(target, { target: move.target, entry: move.entry }, move.modId);
        if (!layer) continue;
        attachLayer(target, move.to, { ...layer, action: "import", astralContent: true, migratedFrom: { target: move.target, entry: move.entry } });
        moveRecordEntry(target, move.modId, { target: move.target, entry: move.entry }, move.to);
        archives.add(move.target);
        archives.add(move.to.target);
      }
      for (const mask of item.dropped) {
        if (!detachLayer(target, mask, mask.modId)) continue;
        dropRecordEntry(target, mask.modId, mask);
        const record = recordOf(target, mask.modId);
        if (record) {
          record.migration ||= {};
          record.migration.masks = [...(record.migration.masks || []), { target: mask.target, entry: mask.entry, ...(mask.allowMissing ? { allowMissing: true } : {}) }];
        }
        archives.add(mask.target);
      }
      for (const pack of HOST_PACKS[kind]) {
        if (!archives.has(pack.target) || hasLayers(target, pack.target) || !target.directDlcRegistrations[pack.name]) continue;
        delete target.directDlcRegistrations[pack.name];
        if (pack.state && target[pack.state]) target[pack.state].preparedOnly = true;
        registryChanged = true;
      }
    } else if (item.direction === "back") {
      for (const move of item.moves) {
        const layer = detachLayer(target, { target: move.target, entry: move.entry }, move.modId);
        if (!layer) continue;
        const { astralContent: _content, migratedFrom: _from, ...rest } = layer;
        attachLayer(target, move.to, rest);
        moveRecordEntry(target, move.modId, { target: move.target, entry: move.entry }, move.to);
        archives.add(move.target);
        archives.add(move.to.target);
      }
      for (const pack of HOST_PACKS[kind]) {
        if (!archives.has(pack.target) || target.directDlcRegistrations[pack.name]) continue;
        target.directDlcRegistrations[pack.name] = { owner: pack.owner, registeredAt: new Date().toISOString() };
        if (pack.state && target[pack.state]) target[pack.state].preparedOnly = false;
        registryChanged = true;
      }
      if (kind === "weapons") restoreMasks(target, archives);
    }
  }
  return { archives, registryChanged };
}

/** Маски, снятые при переносе вперёд, встают на место, когда у мода в контейнере не осталось слоёв. */
function restoreMasks(target, archives) {
  const standing = new Set(
    Object.entries(target.archives?.[ASTRAL_UPDATE_TARGET]?.entries || {})
      .filter(([entry]) => CONTAINER_LEAF.weapons(entry) !== null)
      .flatMap(([, state]) => (state?.layers || []).map((layer) => layer.modId)),
  );
  for (const record of target.installed || []) {
    const masks = record?.migration?.masks;
    if (!Array.isArray(masks) || !masks.length || standing.has(record.modId)) continue;
    for (const mask of masks) {
      attachLayer(target, mask, {
        modId: record.modId,
        version: record.version,
        action: "delete",
        cachePath: null,
        sha256: null,
        allowDelete: true,
        ...(mask.allowMissing ? { allowMissing: true } : {}),
      });
      record.archiveEntries = [...(record.archiveEntries || []).filter((item) => !(item.target === mask.target && item.entry === mask.entry)), { target: mask.target, entry: mask.entry }];
      archives.add(mask.target);
    }
    delete record.migration.masks;
    if (!Object.keys(record.migration).length) delete record.migration;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Исполнитель                                                                                */
/* ------------------------------------------------------------------------------------------ */

const noResult = (state, plan = null) => ({
  state,
  moved: Object.fromEntries(RP_KINDS.map((kind) => [kind, 0])),
  dropped: 0,
  kept: [],
  refused: [],
  lines: plan?.lines || [],
  changed: false,
});

async function sizesOf(target, env, resolve) {
  const sizes = new Map();
  const inventory = rpInventory(target);
  const layers = RP_KINDS.filter((kind) => rpKindMode(kind, env) === "on").flatMap((kind) => inventory[kind].inPacks.map((item) => item.layer));
  await Promise.all(
    layers.map(async (layer) => {
      if (!layer?.cachePath || sizes.has(layer.cachePath)) return;
      try {
        const stat = await fs.stat(resolve(layer.cachePath));
        sizes.set(layer.cachePath, stat.isFile() ? stat.size : null);
      } catch {
        sizes.set(layer.cachePath, null);
      }
    }),
  );
  return (layer) => (layer?.cachePath && sizes.has(layer.cachePath) ? sizes.get(layer.cachePath) : null);
}

async function hostReadiness(target, env) {
  const ready = {};
  const deps = { resolveInside, sha256File: fingerprintSha256, allowPrepared: true };
  const wantsBack = (kind) => rpKindMode(kind, env) === "off" && rpInventory(target)[kind].inContainer.length > 0;
  if (wantsBack("weapons")) ready.weapons = await fastWeaponHostReady(target, deps);
  if (wantsBack("clothing")) ready.clothing = await clothingHostReady(target, deps);
  /* Пакеты дорог готовит приложение при первой установке: ресурс пакета в состоянии есть — основа есть. */
  if (wantsBack("roads")) {
    const needed = new Set(rpInventory(target).roads.inContainer.map((item) => BACK.roads(item.leaf)?.target).filter(Boolean));
    ready.roads = needed.size > 0 && [...needed].every((pack) => Boolean(target.resources?.[pack]));
  }
  return ready;
}

/**
 * Перенос по режимам одной транзакцией (`transact`, журнал): подмена обоих архивов и запись состояния — или ничего. Нечего переносить —
 * выход без единой записи (повторный запуск ничего не делает). Отказ вида (бюджет, не все записи дорог переносятся, пакет не готов) — строка
 * в `lines` и `refused`, остальные виды едут. Ответ: `{ state, moved, dropped, kept, refused, lines, changed }`.
 */
export function migrateRpContainers(input = {}) {
  return inOperation(() => migrateNow(input));
}

async function migrateNow({
  targetId = "default",
  stateDir = DEFAULT_DIR,
  env = process.env,
  rpfComposer = null,
  contentXmlProvider = null,
  dlcListProvider = null,
  signal = null,
  assertRuntimeSafety = null,
  onProgress = null,
  note = () => {},
  updateLength = null,
  ...materializers
} = {}) {
  if (!rpMigrateEnabled(env)) return noResult(null);
  return serializeMutation(async () => {
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const probe = ownRecordValue(current.targets, targetKey);
    if (!probe || !rpMigrationNeeded(probe, env)) return noResult(current);
    if (probe.vanillaGuard && probe.vanillaGuard.phase !== "restored") throw new Error("Сначала завершите сеанс Vanilla Guard и восстановите профиль.");
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-rp-migrate");
    const next = structuredClone(current);
    const target = ownRecordValue(next.targets, targetKey);
    const forward = RP_KINDS.some((kind) => rpKindMode(kind, env) === "on" && rpInventory(target)[kind].inPacks.length > 0);
    let length = updateLength;
    if (forward && !Number.isFinite(length)) {
      try {
        length = (await fs.stat(resolveInside(target.gameRoot, ASTRAL_UPDATE_TARGET))).size;
      } catch {
        length = null;
      }
    }
    const plan = rpMigrationPlan({
      target,
      env,
      updateLength: length,
      sizeOf: await sizesOf(target, env, (cachePath) => cachePath),
      hostReady: await hostReadiness(target, env),
    });
    for (const line of plan.lines) note(line);
    const refused = RP_KINDS.filter((kind) => plan.kinds[kind].refusal).map((kind) => ({ kind, ...plan.kinds[kind].refusal }));
    const kept = RP_KINDS.flatMap((kind) => plan.kinds[kind].kept.map((item) => ({ kind, ...item })));
    const work = RP_KINDS.some((kind) => plan.kinds[kind].moves.length || plan.kinds[kind].dropped.length);
    const dropped = RP_KINDS.reduce((sum, kind) => sum + plan.kinds[kind].dropped.length, 0);
    if (!work) return { ...noResult(current, plan), kept, refused };

    const paths = statePaths(stateDir);
    onProgress?.({ phase: "prepare", percent: 10, cancellable: true });
    /* Живой update.rpf, который правили после Astral, и пакеты — тем же ребейзом, что у снятия мода: основа берёт чужую правку из живого файла. */
    await rebaseDirectUpdateIfNeeded({ target, root: target.gameRoot, paths, targetKey, contentXmlProvider, dlcListProvider, signal });
    const hostTargets = new Set(RP_KINDS.flatMap(hostTargetsOf));
    for (const archiveTarget of hostTargets)
      if (target.archives?.[archiveTarget] && rebasableArchive(archiveTarget)) await rebaseArchiveIfNeeded({ target, archiveTarget, paths, targetKey, signal });
    if (!target.archives?.[ASTRAL_UPDATE_TARGET]) await ensureArchiveResource({ target, archiveTarget: ASTRAL_UPDATE_TARGET, root: target.gameRoot, paths, targetKey, signal, onProgress });

    const { archives, registryChanged } = applyRpMigration(target, plan);
    archives.add(ASTRAL_UPDATE_TARGET);
    if (registryChanged) await composeDirectDlcRegistry({ target, targetKey, paths, dlcListProvider, archiveTarget: ASTRAL_UPDATE_TARGET });
    onProgress?.({ phase: "compose", percent: 40, cancellable: true });
    const affected = [];
    for (const archiveTarget of [...archives].sort((a, b) => (a === ASTRAL_UPDATE_TARGET ? 1 : b === ASTRAL_UPDATE_TARGET ? -1 : a.localeCompare(b)))) {
      throwIfAborted(signal);
      if (!target.archives?.[archiveTarget]) continue;
      if (isAstralUpdateTarget(archiveTarget)) await composeAstralContentRegistry({ target, targetKey, paths, contentXmlProvider, archiveTarget, carrierWriting: new Set([...archives].filter((archive) => LIVE_CARRIER_TARGETS.includes(archive))) });
      const sourcePath = await composeArchiveResource({
        target,
        archiveTarget,
        targetKey,
        edition: target.edition,
        gameRoot: target.gameRoot,
        paths,
        rpfComposer,
        signal,
        assertRuntimeSafety,
        onProgress,
        ...materializers,
      });
      const resource = target.resources?.[archiveTarget];
      affected.push({
        relativePath: archiveTarget,
        livePath: resolveInside(target.gameRoot, archiveTarget),
        sourcePath: sourcePath || resource?.layers?.at(-1)?.cachePath || activeBaselinePath(target, resource),
      });
    }
    onProgress?.({ phase: "ready-to-commit", percent: 90, cancellable: true });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-rp-migrate-commit");
    onProgress?.({ phase: "commit", percent: 94, cancellable: false });
    const state = await transact({ stateDir, current, next, targetId: targetKey, affected, action: RP_MIGRATE_ACTION, signal, engineInstall: null });
    onProgress?.({ phase: "finalizing", percent: 99, cancellable: false });
    return {
      state,
      moved: plan.moved,
      dropped,
      kept,
      refused,
      lines: plan.lines,
      changed: true,
    };
  });
}
