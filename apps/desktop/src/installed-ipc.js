import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { appLog } from "./app-log.js";
import { removalTools } from "./library-removal-ipc.js";
import { readPassSeconds, recordPassTiming } from "./pass-timing.js";
import { DIRECT_BASE_TOOLS } from "./direct-base-tools.js";
import { listInstalled, planUninstall, uninstall } from "./installed-manager.js";
import { inspectInstallRuntime } from "./install-safety.js";
import { sha256File } from "@modovik/install-engine/manifest.js";

const ARCHIVE_TARGET = "update/update.rpf";
const MAX_IDS = 256;
const QUEUE_BUSY = "Дождитесь окончания установок и удалений в очереди загрузок.";
// Каналы, которые пишут в игру и подписываются через handleGameWrite.
const GAME_WRITERS = new Set(["INSTALLED_UNINSTALL"]);

const hintsOf = (hints) => (hints && typeof hints === "object" ? hints : {});
const idsOf = (ids) => (Array.isArray(ids) ? ids.map((id) => String(id)).slice(0, MAX_IDS) : []);

// Сверка записей update.rpf с игрой: что нашли в архиве и какой у найденного отпечаток.
class Reconciliation {
  constructor(game, archivePath) {
    this.game = game;
    this.request = {
      archivePath,
      archiveTarget: ARCHIVE_TARGET,
      edition: game.edition,
      gameRoot: game.path,
    };
    this.outputDirectory = null;
    this.known = new Map();
  }

  async prepare() {
    this.outputDirectory = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "astral-verify-"));
  }

  probe(entries) {
    return DIRECT_BASE_TOOLS.entryProbe({ ...this.request, entries });
  }

  read(present) {
    if (!present.length) return [];
    return DIRECT_BASE_TOOLS.entryReader({
      ...this.request,
      entries: present,
      outputDirectory: this.outputDirectory,
    });
  }

  // Пары «ключ, отпечаток»; отпечатки считаются по очереди.
  async *digests(records) {
    for (const item of records) {
      const key = String(item.entry).toLowerCase();
      let digest = item.sha256;
      if (!digest) digest = await sha256File(item.file);
      yield [key, digest];
    }
  }

  verdict(entries) {
    return new Map(
      entries.map((entry) => {
        const key = entry.toLowerCase();
        return [entry, this.known.has(key) ? { sha256: this.known.get(key) } : null];
      }),
    );
  }

  async dispose() {
    await fsp.rm(this.outputDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

function makeVerifier(game) {
  return async function verifyEntries({ archivePath, entries }) {
    const check = new Reconciliation(game, archivePath);
    await check.prepare();
    try {
      const records = await check.read(await check.probe(entries));
      for await (const [key, digest] of check.digests(records)) check.known.set(key, digest);
      return check.verdict(entries);
    } finally {
      await check.dispose();
    }
  };
}

// Замер времени идёт в оценку, только если что-то снято и план назвал число проходов.
// Он нужен лишь для оценки в плане: сбой записи уходит в журнал и не отменяет уже сделанное снятие.
async function recordIfUseful({ record, log }, stateDir, plan, result, startedAt) {
  if (!result.removed.length) return;
  const passes = plan.estimate?.archivePasses;
  if (!passes) return;
  try {
    await record(stateDir, { seconds: (Date.now() - startedAt) / 1000, passes });
  } catch (error) {
    log({
      level: "warn",
      source: "installed",
      message: `Замер времени снятия не записан: ${String(error?.message || error).slice(0, 200)}`,
    });
  }
}

export function registerInstalledIpc({
  IPC,
  handleIpc,
  handleGameWrite = handleIpc,
  trusted,
  safeInput,
  findGame,
  withInstallState,
  installOptions,
  gtaSettingsPath,
  gtaSettingsStateDir,
  nativeContext,
  operations,
  activeOperations,
  // Подмены для проверок: менеджер снятия, запись замера и журнал.
  manager = { planUninstall, uninstall },
  recordTiming = recordPassTiming,
  log = (entry) => appLog.record(entry),
  gameFacts = () => import("./game-process-facts.js"),
}) {
  const shared = { withInstallState, gtaSettingsPath, gtaSettingsStateDir, nativeContext, operations, findGame };

  // Игра и папка состояния.
  async function locate(input) {
    const value = safeInput(input);
    const game = await findGame(value.targetId);
    const { stateDir } = await installOptions();
    return { value, game, stateDir };
  }

  // Контекст и инструменты менеджера.
  async function equip({ value, game, stateDir }) {
    const kit = removalTools({ game, stateDir, ...shared });
    const passSeconds = await readPassSeconds(stateDir);
    return {
      value,
      stateDir,
      ctx: { gameRoot: game.path, targetId: game.id, hints: hintsOf(value.hints) },
      tools: { ...kit, verifyEntries: makeVerifier(game), passSeconds },
    };
  }

  const openSession = async (input) => equip(await locate(input));

  // Порядок строк — порядок подписки: список, план, проверка, удаление.
  const work = {
    INSTALLED_LIST: async (input) => {
      const session = await openSession(input);
      return listInstalled(session.ctx, session.tools);
    },
    INSTALLED_PLAN: async (input) => {
      const session = await openSession(input);
      return planUninstall(session.ctx, idsOf(session.value.ids), session.tools);
    },
    INSTALLED_GUARD: async (input) => {
      const value = safeInput(input);
      return inspectInstallRuntime(await findGame(value.targetId));
    },
    /* Зависшая GTA V (26.11.2026): список — только то, что точно похоже на зависшую; закрытие — по нажатию человека и после повторной проверки. Модуль — по вызову. */
    INSTALLED_HUNG: async () => ({ hung: await (await gameFacts()).listHungGames() }),
    INSTALLED_CLOSE_HUNG: async (input) => (await gameFacts()).closeHungGame(safeInput(input).pid),
    INSTALLED_UNINSTALL: async (input) => {
      if (activeOperations?.size) throw new Error(QUEUE_BUSY);
      const { value, stateDir, ctx, tools } = await openSession(input);
      const ids = idsOf(value.ids);
      const startedAt = Date.now();
      const plan = await manager.planUninstall(ctx, ids, tools);
      const result = await manager.uninstall(ctx, ids, tools, { skipBlocked: value.skipBlocked !== false });
      await recordIfUseful({ record: recordTiming, log }, stateDir, plan, result, startedAt);
      return result;
    },
  };

  for (const [key, run] of Object.entries(work)) {
    const handler = (event, input) => trusted(event, () => run(input));
    if (GAME_WRITERS.has(key)) handleGameWrite(IPC[key], handler);
    else handleIpc(IPC[key], handler);
  }
}
