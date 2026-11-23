/*
 * Сторож старта носителя (GTA 5 RP, 21.11.2026, этап 1, условие выпуска): «в `update.rpf` есть наши регистрации `update2:/%PLATFORM%/astral/…`,
 * а в `update2.rpf` названных контейнеров нет» — регистрации снимаются до запуска игры (`packages/install-engine/carrier-guard.js`).
 *
 * Сценарий: патч игры или «Проверить целостность» в Steam вернул штатный `update2.rpf`, а `update.rpf` с регистрациями остался — игра не запускается
 * («Corrupt game data», замер тестового ПК, `docs/RP-CARRIERS-TESTPC-2011.md` §5). Обратный случай (контейнеры лежат, регистраций нет) безвреден — только строка в журнал.
 *
 * Где встроен: старт приложения, цепочка `recoverLibraryRemoval` (`install-state-ipc.js`), после доводки журналов и подмен архивов. Единой точки «запуск игры» в приложении нет
 * (её запускает Steam, лаунчер Rockstar или клиент сервера, `engine-journals.js`), поэтому «до игры» значит «при запуске Astral».
 * Снимает не новый механизм, а прежний: пересборка слоя (`provisionAstralLayer({ force })`, как `engine-layer-heal.js`) с набором контейнеров, что лежат в носителе
 * (`carrierPresence` → `composeAstralContentRegistry`): точка отката, правило хвоста и подмена переименованием — те же, что у установки.
 *
 * За выключателем `ASTRAL_CARRIERS=update2` (`carrier-targets.js`), по умолчанию выключено: без него ни одного чтения `update2.rpf` и `update.rpf`.
 * Читается только оглавление носителя (`nested: false`), не тела. Не прочитался (занят, нет ключей) — регистрации НЕ снимаются вслепую, строка в журнал.
 * Видимых человеку строк нет: итог в журнал приложения. Модуль лёгкий (стартовый граф): тяжёлое подгружается по требованию.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { carriersEnabled, enabledCarrierIds } from "@modovik/install-engine/carrier-targets.js";
import { carrierContainersInToc, carrierContentRegistrations, carrierGuardVerdict } from "@modovik/install-engine/carrier-guard.js";

const firstLine = (error) => String(error?.message || error || "неизвестная ошибка").split(/\r?\n/)[0].slice(0, 200);

/**
 * Какие контейнеры Astral лежат в `update/update2.rpf`: `Set` имён строчными. `null` — не прочитан (занят другой программой, нет ключей ArchiveFix,
 * архив не открылся). Файла нет вовсе — пустой набор: носитель отсутствует, контейнеров в нём нет.
 */
export async function readCarrierPresence({ gameRoot, keysProvider = null, open = null } = {}) {
  const file = path.join(String(gameRoot), "update", "update2.rpf");
  try {
    await fs.stat(file);
  } catch (error) {
    return error?.code === "ENOENT" ? new Set() : null;
  }
  let archive = null;
  try {
    const rpf7 = open && keysProvider ? null : await import("@modovik/rpf7/node");
    const keys = await (keysProvider || (async () => rpf7.keysFromDirectory((await import("./loader-provisioner.js")).archiveSupportDirectory())))();
    if (!keys?.ngKeys || !keys?.ngTables) return null;
    archive = await (open || rpf7.openRpfFile)(file, { keys, nested: false });
    return new Set(carrierContainersInToc((archive.entries || []).map((entry) => entry.path)));
  } catch {
    return null;
  } finally {
    await archive?.close?.();
  }
}

/** Регистрации контейнеров носителя в живом `update.rpf`: массив имён; `null` — не прочитан. */
export async function readLiveCarrierRegistrations({ gameRoot, edition = "Legacy", extract = null } = {}) {
  const output = path.join(os.tmpdir(), `astral-carrier-guard-${process.pid}-${Date.now()}.content.xml`);
  try {
    const provide = extract || (await import("./rpf-composer.js")).provideUpdateContentXml;
    await provide({ baseArchive: path.join(String(gameRoot), "update", "update.rpf"), gameRoot, edition, output });
    return carrierContentRegistrations(await fs.readFile(output, "utf8"));
  } catch {
    return null;
  } finally {
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

/**
 * Одна игра. `heal({ presence })` пересобирает слой с набором лежащих контейнеров.
 * @returns {Promise<{status: "off"|"unreadable"|"ok"|"healed"|"failed", orphans?: string[], unregistered?: string[]}>}
 */
export async function guardCarrierRegistrations({
  gameRoot,
  readPresence = readCarrierPresence,
  readRegistered = readLiveCarrierRegistrations,
  /* Имена контейнеров носителя, что числятся за работами в состоянии Astral: вариант 1 стенда — оба файла штатные, регистраций в update.rpf уже нет, а работы в состоянии стоят; чинится на старте. */
  readOwned = async () => [],
  heal,
  log = () => {},
}) {
  /* Сторож включён СОСТОЯНИЕМ (есть работы носителя или регистрации), а не окружением: режим RP мог выключиться (Majestic, смена канала), регистрации в update.rpf от этого не исчезли (Н-3). */
  const presentSet = await readPresence({ gameRoot });
  const registered = presentSet == null ? null : await readRegistered({ gameRoot });
  if (presentSet == null || registered == null) {
    log({ level: "warn", source: "install", message: "Сторож носителя: update2.rpf или update.rpf не прочитался (занят, нет ключей) — регистрации носителя не трогаю." });
    return { status: "unreadable" };
  }
  const verdict = carrierGuardVerdict({ registered, present: [...presentSet] });
  const owned = (await readOwned({ gameRoot }).catch(() => [])) || [];
  const stateLost = owned.filter((name) => !presentSet.has(String(name).toLowerCase()));
  if (verdict.unregistered.length)
    log({ level: "info", source: "install", message: `Сторож носителя: контейнеры в update2.rpf без регистрации (${verdict.unregistered.join(", ")}) — безвредно, не трогаю.` });
  if (!verdict.orphans.length && !stateLost.length) return { status: "ok", orphans: [], unregistered: verdict.unregistered };
  try {
    await heal({ presence: presentSet });
    /* Итог перечитывается (Н-1б): «сняты» говорится только если в живом update.rpf сирот больше нет. */
    const after = await readRegistered({ gameRoot });
    const left = after == null ? null : carrierGuardVerdict({ registered: after, present: [...presentSet] }).orphans;
    const ownedAfter = (await readOwned({ gameRoot }).catch(() => null)) ?? [];
    const stateLeft = ownedAfter.filter((name) => !presentSet.has(String(name).toLowerCase()));
    if (left == null || left.length || stateLeft.length) {
      log({ level: "error", source: "install", message: `Сторож носителя: после пересборки в update.rpf ${left == null ? "не читается итог" : `остались регистрации ${left.join(", ") || stateLeft.join(", ")}`} — игра может не запуститься, нужна «Починить» или проверка файлов в Steam.` });
      return { status: "failed", orphans: left ?? verdict.orphans, unregistered: verdict.unregistered };
    }
    log({ level: "warn", source: "install", message: `Сторож носителя: в update2.rpf нет контейнеров ${[...new Set([...verdict.orphans, ...stateLost])].join(", ")} (патч игры или проверка файлов) — регистрации сняты, работы помечены «носитель потерян».` });
    return { status: "healed", orphans: [...new Set([...verdict.orphans, ...stateLost])], unregistered: verdict.unregistered };
  } catch (error) {
    log({ level: "error", source: "install", message: `Сторож носителя: регистрации ${verdict.orphans.join(", ")} без контейнеров в update2.rpf снять не удалось: ${firstLine(error)}` });
    return { status: "failed", orphans: verdict.orphans, unregistered: verdict.unregistered };
  }
}

/** Имена контейнеров носителя, что числятся за работами в состоянии Astral (строчными); состояние читается без игры. `targets` — только контейнеры этих носителей (цели-файлы), без него — все. */
export async function carrierOwnedNames({ stateDir, targetId, targets = null } = {}) {
  const { inspectProfile } = await import("@modovik/install-engine");
  const { carrierOwnership } = await import("@modovik/install-engine/carrier-follow.js");
  const profile = await inspectProfile({ stateDir });
  const target = profile?.targets?.[targetId];
  if (!target) return [];
  return [...carrierOwnership(target)].filter(([, item]) => !targets || targets.includes(item.target)).map(([name]) => name);
}

/** Имена контейнеров носителей `targets`, что числятся за ЗАПАРКОВАННЫМИ работами («снятые», `target.parked`): файл подпакета с ними не мусор, а ждёт «Починить». */
export async function carrierParkedNames({ stateDir, targetId, targets = null } = {}) {
  const { inspectProfile } = await import("@modovik/install-engine");
  const { carrierContainerOf } = await import("@modovik/install-engine/carrier-follow.js");
  const target = (await inspectProfile({ stateDir }))?.targets?.[targetId];
  const names = new Set();
  for (const item of target?.parked || [])
    for (const entry of item?.entries || []) {
      if (targets && !targets.includes(entry?.archive)) continue;
      const container = carrierContainerOf(entry.entry, entry.archive);
      if (container) names.add(container.split("/").pop());
    }
  return [...names];
}

/** Есть ли в состоянии Astral работы, чьи контейнеры лежат в носителе (регистрация следует за состоянием, а не за окружением, Н-3). */
export async function carrierWorkInState({ stateDir, targetId } = {}) {
  return (await carrierOwnedNames({ stateDir, targetId })).length > 0;
}

/**
 * Проверка носителя на возврат окна в фокус (Н-2): клиент сервера или Steam могли вернуть файлы игры, пока Astral был свёрнут. Не чаще раза в `gapMs`, не во время установки, не пока игра идёт.
 * `run` — сторож по всем играм (`guardCarriersAllGames` из `install-state-ipc.js`).
 */
export function bootCarrierFocusGuard({ app, run, busy = () => false, gameRunning = () => false, gapMs = 60_000, now = Date.now, log = () => {} }) {
  let last = 0;
  let running = false;
  app.on("browser-window-focus", () => {
    if (running || busy() || gameRunning() || now() - last < gapMs) return;
    running = true;
    last = now();
    Promise.resolve()
      .then(() => run())
      .catch((error) => log({ level: "warn", source: "install", message: `Сторож носителя (фокус): ${firstLine(error)}` }))
      .finally(() => {
        running = false;
      });
  });
}

/** Для запуска приложения: все найденные игры; сбой одной не мешает остальным и запуску. */
export async function guardCarriersOnStartup({
  discover,
  stateDirOf,
  provision,
  env = process.env,
  log = () => {},
  guard = guardCarrierRegistrations,
  guardPacks = guardPackCarriers,
  guardSubpacks = guardSubpackHosts,
  /* Есть ли у игры работы носителя в состоянии Astral: без них и без выключателя ничего не читается (люди без RP). */
  hasCarrierWork = carrierWorkInState,
}) {
  const results = [];
  for (const game of (await discover().catch(() => [])) || []) {
    if (!game?.path) continue;
    /* Штатные пакеты-носители: проверка без записи (регистрация в самом пакете). */
    if (enabledCarrierIds(env).some((id) => id !== "update2")) await guardPacks({ gameRoot: game.path, env, log }).catch((error) => log({ level: "warn", source: "install", message: `Сторож пакетов-носителей: ${firstLine(error)}` }));
    /* Подпакеты хозяев (слово `<хозяин>_s<N>` в `ASTRAL_CARRIERS`): регистрация и число лежат в хозяине, контейнер в `dlc<N>.rpf` — расхождение чинится ДО игры. Без слова — ни чтения, ни записи. */
    if (await subpackWordsOn(env))
      await guardSubpacks({
        gameRoot: game.path,
        env,
        log,
        readOwned: async ({ targets }) => carrierOwnedNames({ stateDir: await stateDirOf(), targetId: game.id, targets }),
        readParked: async ({ targets }) => carrierParkedNames({ stateDir: await stateDirOf(), targetId: game.id, targets }),
        heal: async ({ presence }) =>
          provision({
            gameRoot: game.path,
            targetId: game.id,
            edition: game.edition,
            stateDir: await stateDirOf(),
            force: true,
            carrierPresence: async () => presence,
          }),
      }).catch((error) => log({ level: "warn", source: "install", message: `Сторож подпакетов: ${firstLine(error)}` }));
    try {
      if (!carriersEnabled(env) && !(await hasCarrierWork({ stateDir: await stateDirOf(), targetId: game.id, gameRoot: game.path }).catch(() => false))) continue;
      results.push(
        await guard({
          gameRoot: game.path,
          env,
          log,
          readOwned: async () => carrierOwnedNames({ stateDir: await stateDirOf(), targetId: game.id }),
          heal: async ({ presence }) =>
            provision({
              gameRoot: game.path,
              targetId: game.id,
              edition: game.edition,
              stateDir: await stateDirOf(),
              force: true,
              carrierPresence: async () => presence,
            }),
        }),
      );
    } catch (error) {
      log({ level: "warn", source: "install", message: `Сторож носителя: ${firstLine(error)}` });
    }
  }
  return results;
}

/**
 * Что в штатном пакете-носителе: `{ registered, present }` — зарегистрированные в его `content.xml` наши контейнеры и лежащие в нём; `null` — не прочитан (занят, нет ключей, нет файла).
 * Читается оглавление и один `content.xml` (`nested: false`).
 */
export async function readPackCarrierState({ gameRoot, carrier, keysProvider = null, open = null } = {}) {
  const file = path.join(String(gameRoot), ...carrier.target.split("/"));
  try {
    await fs.stat(file);
  } catch {
    return null;
  }
  let archive = null;
  try {
    const rpf7 = open && keysProvider ? null : await import("@modovik/rpf7/node");
    const keys = await (keysProvider || (async () => rpf7.keysFromDirectory((await import("./loader-provisioner.js")).archiveSupportDirectory())))();
    if (!keys?.ngKeys || !keys?.ngTables) return null;
    archive = await (open || rpf7.openRpfFile)(file, { keys, nested: false });
    const { packContainersInToc, packContentRegistrations } = await import("@modovik/install-engine/pack-registration.js");
    const entry = (archive.entries || []).find((item) => String(item.path).toLowerCase() === "content.xml");
    if (!entry) return null;
    const xml = Buffer.from(await archive.read(entry.path)).toString("utf8");
    return { registered: packContentRegistrations(xml, carrier.device), present: packContainersInToc((archive.entries || []).map((item) => item.path)) };
  } catch {
    return null;
  } finally {
    await archive?.close?.();
  }
}

/**
 * Сторож штатных пакетов-носителей (включены словами в `ASTRAL_CARRIERS`): регистрации в самом пакете против контейнеров в нём. Ничего не пишет: у пакета регистрация и контейнер в одном
 * файле, «регистрации без файла» (падение игры, как у update2) быть не может — пока у пакета нет подпакета (с подпакетом регистрация и число лежат в хозяине, а контейнер в `dlc<N>.rpf`:
 * тогда работает `guardSubpackHosts` ниже, он и чинит); найденное расхождение — строка в журнал («Починить»). После «Проверить файлы игры» пакет штатный — ни регистраций, ни контейнеров.
 * @returns {Promise<Array<{id: string, status: "ok"|"orphans"|"unreadable", orphans?: string[]}>>}
 */
export async function guardPackCarriers({ gameRoot, env = process.env, readState = readPackCarrierState, log = () => {} }) {
  const { CARRIERS, enabledCarrierIds, subpackCarriersOf } = await import("@modovik/install-engine/carrier-targets.js");
  const { packCarrierVerdict } = await import("@modovik/install-engine/pack-registration.js");
  const results = [];
  for (const id of enabledCarrierIds(env)) {
    const carrier = CARRIERS.find((item) => item.id === id);
    if (carrier?.registration !== "pack-content") continue;
    const state = await readState({ gameRoot, carrier });
    /* Контейнеры ПОДПАКЕТА хозяина (`…_s<N>(_b|_c|_d).rpf`) зарегистрированы в его `content.xml`, а лежат в `dlc<N>.rpf`: в оглавлении `dlc.rpf` их по устройству нет — это не «сироты» (их сверяет сторож подпакетов). */
    const ownsSubpacks = subpackCarriersOf(carrier).length > 0;
    const registered = state?.registered ? (ownsSubpacks ? state.registered.filter((name) => !/_s\d+(?:_[bcd])?\.rpf$/i.test(name)) : state.registered) : null;
    const verdict = packCarrierVerdict({ registered, present: state?.present ?? null });
    if (!verdict.readable) {
      results.push({ id, status: "unreadable" });
      continue;
    }
    if (verdict.orphans.length) {
      log({ level: "warn", source: "install", message: `Сторож носителя ${id}: в content.xml пакета зарегистрированы ${verdict.orphans.join(", ")}, а самих контейнеров в пакете нет — нажмите «Починить» (регистрация и контейнер лежат в одном файле, игра от этого не падает).` });
      results.push({ id, status: "orphans", orphans: verdict.orphans });
    } else results.push({ id, status: "ok" });
  }
  return results;
}

/*
 * Подпакеты хозяев (21.11.2026): у штатного пакета-хозяина (`mpbiker`, `mpluxe`, `mpluxe2`) наши контейнеры лежат в `update/x64/dlcpacks/<хозяин>/dlc<N>.rpf`, а регистрация (`content.xml`)
 * и число подпакетов (`subPackCount` в `setup2.xml`) — в `dlc.rpf` хозяина. Допущение «регистрация и контейнер в одном файле, регистрации без файла не бывает» здесь не держится:
 * число или регистрация могут остаться без файла (обрыв, чужая правка), и такой набор у носителей ронял игру на входе («Corrupt game data», `docs/RP-CARRIERS-TESTPC-2011.md`, §5). Поэтому сторож
 * подпакетов не только пишет в журнал, но и чинит (вердикт — `packages/install-engine/subpack-guard.js`). Включается словом подпакета в `ASTRAL_CARRIERS` (`mpbiker_s1`, …); без слова — ни чтения, ни записи.
 */

/** Включено ли хоть одно слово подпакета в `ASTRAL_CARRIERS`. */
export async function subpackWordsOn(env = process.env) {
  const { isSubpackCarrier } = await import("@modovik/install-engine/carrier-targets.js");
  return enabledCarrierIds(env).some((id) => isSubpackCarrier(id));
}

/** Оглавление архива (`nested: false`); `null` — не открылся (нет ключей ArchiveFix, занят). */
async function openCarrierToc(file, { keysProvider = null, open = null } = {}) {
  const rpf7 = open && keysProvider ? null : await import("@modovik/rpf7/node");
  const keys = await (keysProvider || (async () => rpf7.keysFromDirectory((await import("./loader-provisioner.js")).archiveSupportDirectory())))();
  if (!keys?.ngKeys || !keys?.ngTables) return null;
  return (open || rpf7.openRpfFile)(file, { keys, nested: false });
}

/**
 * Что лежит у хозяина и в его подпакетах: `{ liveCount, registered, hostContainers, subpacks: [{ index, exists, ours, foreign }] }` — всё, что нужно вердикту (`subpackGuardVerdict`); `null` — хозяин не
 * прочитан (нет файла, ключей, `setup2.xml` или `content.xml`). Читаются оглавления (`nested: false`) и два XML хозяина; номера смотрятся от 1 до большего из «числа в `setup2.xml`» и «номеров подпакетов таблицы».
 * Подпакет, что лежит, а не открылся, — `ours: null` (вердикт его не трогает); `foreign` — в нём есть запись, что не наш контейнер (папки не в счёт).
 */
export async function readSubpackHostState({ gameRoot, host, subpacks = [], keysProvider = null, open = null, parseCount = null } = {}) {
  const { packContainersInToc, packContentRegistrations } = await import("@modovik/install-engine/pack-registration.js");
  const { subPackFileName } = await import("@modovik/install-engine/carrier-targets.js");
  const countOf = parseCount || (await import("@modovik/install-engine/pack-subpack-xml.js")).subPackCountOf;
  const hostFile = path.join(String(gameRoot), ...host.target.split("/"));
  let hostPart = null;
  try {
    await fs.stat(hostFile);
    const archive = await openCarrierToc(hostFile, { keysProvider, open });
    if (!archive) return null;
    try {
      const entries = archive.entries || [];
      const textOf = async (name) => {
        const entry = entries.find((item) => String(item.path).toLowerCase() === name);
        return entry ? Buffer.from(await archive.read(entry.path)).toString("utf8") : null;
      };
      const [setup, content] = [await textOf("setup2.xml"), await textOf("content.xml")];
      if (setup == null || content == null) return null;
      hostPart = { liveCount: countOf(setup), registered: packContentRegistrations(content, host.device), hostContainers: packContainersInToc(entries.map((item) => item.path)) };
    } finally {
      await archive.close?.();
    }
  } catch {
    return null;
  }
  const files = [];
  const last = Math.max(hostPart.liveCount, ...subpacks.map((row) => row.subIndex), 0);
  for (let index = 1; index <= last; index += 1) {
    const file = path.join(path.dirname(hostFile), subPackFileName(index));
    try {
      await fs.stat(file);
    } catch (error) {
      files.push(error?.code === "ENOENT" ? { index, exists: false } : { index, exists: true, ours: null, foreign: false });
      continue;
    }
    let archive = null;
    try {
      archive = await openCarrierToc(file, { keysProvider, open });
      const paths = (archive?.entries || []).map((item) => ({ path: String(item.path), directory: item.kind === "directory" }));
      files.push(
        archive
          ? { index, exists: true, ours: packContainersInToc(paths.map((item) => item.path)), foreign: paths.some((item) => !item.directory && !packContainersInToc([item.path]).length) }
          : { index, exists: true, ours: null, foreign: false },
      );
    } catch {
      files.push({ index, exists: true, ours: null, foreign: false });
    } finally {
      await archive?.close?.();
    }
  }
  return { ...hostPart, subpacks: files };
}

/** Убирает файл подпакета хозяина (только по вердикту «наш мусор»); нет файла — не ошибка. */
export async function removeSubpackFile({ gameRoot, host, index }) {
  const { subPackFileName } = await import("@modovik/install-engine/carrier-targets.js");
  await fs.rm(path.join(String(gameRoot), ...path.posix.dirname(host.target).split("/"), subPackFileName(index)), { force: true });
}

/** Что сторож говорит «пересборке слоя» о составе носителей хозяина (`carrierPresence` вердикта): хозяин — его контейнеры; подпакет — контейнеры, если он СМОНТИРОВАН (номер не больше числа), иначе пусто. */
function presenceOfHost(state, host, rows) {
  const presence = new Map([[host.target, new Set(state.hostContainers)]]);
  for (const row of rows) {
    const file = state.subpacks.find((item) => item.index === row.subIndex);
    const mounted = file?.exists === true && row.subIndex <= state.liveCount && Array.isArray(file.ours);
    presence.set(row.target, new Set(mounted ? file.ours : []));
  }
  return presence;
}

const numbers = (list) => list.join(", ");

/**
 * Сторож подпакетов: по каждому хозяину, чей подпакет включён словом. Опасное (число поднято без файла, регистрация без контейнера, работы числятся за подпакетом, что игра не смонтирует)
 * чинится ДО игры пересборкой с регистрацией «по факту» (`heal({ host, presence })`, как `guardCarrierRegistrations` у `update2`); потом наш мусор (файл подпакета без числа, в нём только наше, состояние им
 * не владеет) убирается; чужой файл не трогается никогда — строка в журнал. Нечем прочесть — ничего не меняется.
 * @returns {Promise<Array<{id: string, status: "ok"|"unreadable"|"healed"|"cleaned"|"failed", removed?: number[], foreign?: number[]}>>}
 */
export async function guardSubpackHosts({ gameRoot, env = process.env, readState = readSubpackHostState, readOwned = async () => [], readParked = async () => [], heal, remove = removeSubpackFile, log = () => {} }) {
  const { CARRIERS, hostCarrierOf, isSubpackCarrier, subpackCarriersOf } = await import("@modovik/install-engine/carrier-targets.js");
  const { subpackGuardVerdict } = await import("@modovik/install-engine/subpack-guard.js");
  const hosts = new Map();
  for (const id of enabledCarrierIds(env)) {
    const host = isSubpackCarrier(id) ? hostCarrierOf(CARRIERS.find((row) => row.id === id)) : null;
    if (host) hosts.set(host.id, host);
  }
  const say = (level, message) => log({ level, source: "install", message });
  const results = [];
  for (const host of hosts.values()) {
    const rows = subpackCarriersOf(host);
    const judge = async () => {
      const state = await readState({ gameRoot, host, subpacks: rows });
      if (!state) return null;
      const targets = rows.map((row) => row.target);
      const stateOwned = (await readOwned({ host, targets }).catch(() => [])) || [];
      const parkedOwned = (await readParked({ host, targets }).catch(() => [])) || [];
      return { state, verdict: subpackGuardVerdict({ stockCount: host.stockSubPackCount ?? 0, liveCount: state.liveCount, registered: state.registered, hostContainers: state.hostContainers, subpacks: state.subpacks, stateOwned, parkedOwned }) };
    };
    try {
      let now = await judge();
      if (!now?.verdict.readable) {
        say("warn", `Сторож подпакетов ${host.id}: хозяин или подпакет не прочитался (занят, нет ключей) — ничего не трогаю.`);
        results.push({ id: host.id, status: "unreadable" });
        continue;
      }
      if (now.verdict.unregistered.length) say("info", `Сторож подпакетов ${host.id}: контейнеры без регистрации (${now.verdict.unregistered.join(", ")}) — безвредно, не трогаю.`);
      if (now.verdict.stockMissing.length) say("warn", `Сторож подпакетов ${host.id}: нет штатных подпакетов ${numbers(now.verdict.stockMissing)} — это не наш файл, не трогаю.`);
      if (now.verdict.garbage.kept.length) say("info", `Сторож подпакетов ${host.id}: подпакет ${numbers(now.verdict.garbage.kept)} лежит без числа, его работы запаркованы — файл не трогаю, «Починить» вернёт число и регистрацию.`);
      const foreign = now.verdict.foreign;
      if (foreign.length) say("warn", `Сторож подпакетов ${host.id}: подпакет ${numbers(foreign)} лежит без числа, но в нём чужое или непонятное — не трогаю.`);
      let healed = false;
      if (now.verdict.status === "danger" || now.verdict.garbage.park.length) {
        const { missingFiles, orphans } = now.verdict.danger;
        const found = [
          missingFiles.length ? `число подпакетов ${now.state.liveCount}, а файла нет у номеров ${numbers(missingFiles)}` : "",
          orphans.length ? `в content.xml зарегистрированы ${orphans.join(", ")} без контейнера` : "",
          now.verdict.garbage.park.length ? `за подпакетом ${numbers(now.verdict.garbage.park)} числятся работы, а игра его не смонтирует` : "",
        ].filter(Boolean);
        say("warn", `Сторож подпакетов ${host.id}: ${found.join("; ")} — пересобираю хозяина до запуска игры.`);
        await heal({ host, presence: presenceOfHost(now.state, host, rows) });
        healed = true;
        now = await judge();
        if (!now?.verdict.readable || now.verdict.status === "danger" || now.verdict.garbage.park.length) {
          const left = now?.verdict.readable ? [...now.verdict.danger.missingFiles.map((index) => `нет dlc${index}.rpf`), ...now.verdict.danger.orphans].join(", ") || "работы числятся за немонтируемым подпакетом" : "итог не читается";
          say("error", `Сторож подпакетов ${host.id}: после пересборки расхождение осталось (${left}) — игра может не запуститься, нужна «Починить» или проверка файлов в Steam.`);
          results.push({ id: host.id, status: "failed", ...(foreign.length ? { foreign } : {}) });
          continue;
        }
      }
      const removed = [];
      for (const index of now.verdict.garbage.remove) {
        try {
          await remove({ gameRoot, host, index });
          removed.push(index);
          say("warn", `Сторож подпакетов ${host.id}: убран наш файл подпакета ${index} без числа (в нём только наши контейнеры, состояние им не владеет).`);
        } catch (error) {
          say("warn", `Сторож подпакетов ${host.id}: файл подпакета ${index} убрать не удалось: ${firstLine(error)}`);
        }
      }
      results.push({ id: host.id, status: healed ? "healed" : removed.length ? "cleaned" : "ok", ...(removed.length ? { removed } : {}), ...(foreign.length ? { foreign } : {}) });
    } catch (error) {
      say("error", `Сторож подпакетов ${host.id}: ${firstLine(error)}`);
      results.push({ id: host.id, status: "failed" });
    }
  }
  return results;
}
