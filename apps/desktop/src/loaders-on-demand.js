import fs from "node:fs/promises";
import path from "node:path";
import {
  inspectProfile,
  loaderManifestId,
  manifestNeedsLoader,
  ownLoaderFiles,
  parkForeignPlugins,
  recordNeedsLoader,
  sha256File,
  uninstallPackage,
} from "@modovik/install-engine";
import { discoverGames } from "@modovik/game-discovery";
import { appLog } from "./app-log.js";
import { loadersStanding, settleGameLoaders } from "./game-loaders.js";
import { provisionOfficialLoaders } from "./loader-provisioner.js";

/*
 * Пара `dinput8.dll` + `RageOpenV.asi` — по требованию (23.11.2026, слово владельца).
 *
 * Прямая схема (`update.rpf`, `dlcpacks/astral_*`) загрузчика игре не требует (`packages/install-engine/astral-layer.js`),
 * а на RP-серверах пара в корне игры — лишний риск (`docs/handoff/RP-ROUTE-HELP-2011.md`). Поэтому «Подготовка GTA V» её
 * больше не ставит. Она нужна только:
 *   - пакету с `requiresLoader` не `false` вне корня игры (`loader-need.js`: старый мегамолл, пакеты каталога из `mods`);
 *   - ReShade `.asi` в корне игры (любой ASI-прокси).
 * Пара встаёт тихо тем же проверенным путём (`loader-provisioner.js`, суммы из `docs/LOADER-SOURCES.md`) прямо перед такой
 * установкой и уходит, когда снимают последнюю нужную ей работу. Миграция для уже поставивших — тот же уход при подготовке.
 *
 * Видимых человеку строк нет: события — в журнал (`app-log`, источник «loaders»); ошибка снятия не останавливает ничего.
 */

const SOURCE = "loaders";
const note = (level, message) => appLog.record({ level, source: SOURCE, message });

/* Любой `.asi` в корне игры, кроме нашего `RageOpenV.asi`, — чужие плагины (или ReShade) уже опираются на ASI-прокси. */
async function otherPluginsIn(gameRoot) {
  const names = await fs.readdir(gameRoot).catch(() => []);
  return names.filter((name) => /\.asi$/i.test(name) && name.toLowerCase() !== "rageopenv.asi");
}

/* Прежний редактор фонарей (`street-light-customizer.js`, `mods/x64h.rpf`) держит свою запись установки вне движка. */
async function streetLightsActive(stateDir) {
  try {
    const state = JSON.parse(await fs.readFile(path.join(stateDir, "street-lights", "install-state.json"), "utf8"));
    return state?.status === "active";
  } catch {
    return false;
  }
}

/** Единственная GTA V Legacy (так её выбирает и прежний редактор фонарей). */
async function soleLegacyGame(listGames) {
  const legacy = (await listGames().catch(() => [])).filter((game) => String(game?.edition || "").toLowerCase() === "legacy");
  return legacy.length === 1 ? legacy[0] : null;
}

/** Прежнему редактору фонарей пара нужна (он сверяет её суммы): ставим перед планом. Ошибка не мешает — план сам скажет «нет загрузчика». */
export async function ensureLoadersForLegacy({ listGames, stateDir, deps = {} }) {
  try {
    const game = await soleLegacyGame(listGames);
    if (!game) return { status: "none" };
    await ensureLoaders({
      game,
      stateDir,
      reread: async () => (await soleLegacyGame(listGames)) ?? game,
      provision: deps.provision,
      park: deps.park,
    });
    return { status: "ok" };
  } catch (error) {
    note("warn", `пара загрузчиков для фонарей не поставилась: ${error?.message || error}`);
    return { status: "failed", error: String(error?.message || error) };
  }
}

export async function retireLoadersForLegacy({ listGames, stateDir, deps = {} }) {
  const game = await soleLegacyGame(listGames);
  return game ? retireLoadersIfUnused({ game, stateDir, deps }) : { status: "none" };
}

/** Игра по папке (ReShade знает корень игры, а не id цели). */
export async function gameByRoot(gameRoot, { discover = discoverGames } = {}) {
  const wanted = path.resolve(String(gameRoot || "")).toLowerCase();
  if (!gameRoot) return null;
  const games = await discover().catch(() => []);
  return games.find((game) => path.resolve(game.path).toLowerCase() === wanted) ?? null;
}

/**
 * Перед установкой: если хоть одному пакету нужна пара, а её нет — поставить. Иначе ничего не делает.
 * `reread` отдаёт игру после установки пары (бросает, если писать уже нельзя).
 */
export async function ensureLoadersFor({
  game,
  manifests = [],
  stateDir,
  assertRuntimeSafety = null,
  reread,
  provision = provisionOfficialLoaders,
  park = parkForeignPlugins,
}) {
  if (!manifests.some(manifestNeedsLoader)) return game;
  return ensureLoaders({ game, stateDir, assertRuntimeSafety, reread, provision, park });
}

export async function ensureLoaders({
  game,
  stateDir,
  assertRuntimeSafety = null,
  reread,
  provision = provisionOfficialLoaders,
  park = parkForeignPlugins,
}) {
  if (loadersStanding(game)) return game;
  /* Игра запущена — в её папку ничего не кладём: отказ теми же словами, что у остальной записи в игру (`assertSafe`). */
  if (assertRuntimeSafety) await assertRuntimeSafety();
  note("info", "пара загрузчиков нужна установке и ставится");
  return settleGameLoaders({
    game,
    park,
    provision: () =>
      provision({ gameRoot: game.path, targetId: game.id, edition: game.edition, stateDir, assertRuntimeSafety }),
    reread,
  });
}

/**
 * Стоит ли у человека то, чему пара нужна: запись установки с `needsLoader` (`recordNeedsLoader`) или прежние фонари «active».
 * Панель «Игра» показывает строки про загрузчики только тогда (слово владельца 23.11.2026: «никаких плашек» тому, кому пара не нужна).
 * Никогда не бросает: не прочиталось — «не нужна».
 */
export async function loadersNeededBy({ game, stateDir, deps = {} }) {
  const tools = { inspectProfile, streetLightsActive, ...deps };
  try {
    const installed = (await tools.inspectProfile({ stateDir }))?.targets?.[game?.id]?.installed ?? [];
    if (installed.some(recordNeedsLoader)) return true;
    return Boolean(await tools.streetLightsActive(stateDir));
  } catch {
    return false;
  }
}

/** Игры для окна: у каждой `loadersNeeded` — нужна ли ей пара (см. `loadersNeededBy`). */
export async function markLoaderNeed(games, { stateDir, deps = {} }) {
  const list = Array.isArray(games) ? games : [];
  return Promise.all(list.map(async (game) => ({ ...game, loadersNeeded: await loadersNeededBy({ game, stateDir, deps }) })));
}

/**
 * Пара больше никому не нужна? Тогда убрать, и только нашу. Никогда не бросает: ошибка — в журнал и «отложено».
 *  - запись нашей установки есть в состоянии цели → снятие движком (SafeSwitch-транзакция возвращает чужой файл из копии);
 *  - записи нет, но файлы лежат → убираются только файлы с ТОЧНОЙ суммой из `LOADER-SOURCES.md`;
 *  - нужна записи установки (`recordNeedsLoader`) или в корне игры стоят чужие `.asi` (в том числе ReShade) — остаётся.
 * Игра запущена или файл занят — отложено до следующего раза.
 */
export async function retireLoadersIfUnused({
  game,
  stateDir,
  assertRuntimeSafety = null,
  deps = {},
}) {
  const tools = { inspectProfile, uninstallPackage, sha256File, discover: discoverGames, ...deps };
  try {
    const target = (await tools.inspectProfile({ stateDir }))?.targets?.[game.id];
    const installed = target?.installed ?? [];
    if (installed.some(recordNeedsLoader)) return { status: "needed" };
    if (await (tools.streetLightsActive || streetLightsActive)(stateDir)) return { status: "needed", by: "street-lights" };
    const ownRecord = installed.some((record) => record?.modId === loaderManifestId(game.edition));
    const strangers = await otherPluginsIn(game.path);
    if (strangers.length) return { status: "kept", reason: "other-asi", plugins: strangers };
    if (assertRuntimeSafety) await assertRuntimeSafety();
    if (ownRecord) {
      await tools.uninstallPackage({
        modId: loaderManifestId(game.edition),
        targetId: game.id,
        stateDir,
        assertRuntimeSafety,
      });
      note("info", "пара загрузчиков снята: она больше не нужна ни одной работе");
      return { status: "removed", via: "state" };
    }
    const removed = [];
    for (const file of ownLoaderFiles(game.edition)) {
      const live = path.join(game.path, file.target);
      const stat = await fs.stat(live).catch(() => null);
      if (!stat?.isFile() || stat.size !== file.size) continue;
      if ((await tools.sha256File(live)) !== file.sha256) continue;
      await fs.rm(live);
      removed.push(file.target);
    }
    if (removed.length) note("info", `наши файлы загрузчиков убраны (${removed.join(", ")}): нужны никому`);
    return { status: removed.length ? "removed" : "none", via: "files", removed };
  } catch (error) {
    note("warn", `пара загрузчиков не убрана, отложено: ${error?.message || error}`);
    return { status: "deferred", error: String(error?.message || error) };
  }
}

/** То же по папке игры (ReShade, мегамолл): игру находит сама. */
export async function retireLoadersAtRoot({ gameRoot, stateDir, assertRuntimeSafety = null, deps = {} }) {
  const game = await gameByRoot(gameRoot, { discover: deps.discover });
  if (!game) return { status: "none", reason: "no-game" };
  return retireLoadersIfUnused({ game, stateDir, assertRuntimeSafety, deps });
}

/** ReShade в корень игры: нет ASI-прокси — ставим пару и отдаём игру после неё. Ошибка не мешает (останется «нет загрузчика»). */
export async function ensureLoadersAtRoot({ gameRoot, stateDir, assertRuntimeSafety = null, deps = {} }) {
  try {
    const game = await gameByRoot(gameRoot, { discover: deps.discover });
    if (!game || game.asiLoader) return { status: "none" };
    await ensureLoaders({
      game,
      stateDir,
      assertRuntimeSafety,
      reread: async () => (await gameByRoot(gameRoot, { discover: deps.discover })) ?? game,
      provision: deps.provision,
      park: deps.park,
    });
    return { status: "provisioned" };
  } catch (error) {
    note("warn", `пара загрузчиков для ReShade не поставилась: ${error?.message || error}`);
    return { status: "failed", error: String(error?.message || error) };
  }
}
