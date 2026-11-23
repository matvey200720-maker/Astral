// apps/desktop/src/channels/index.js
// Клей между хабом веток/переключателем и Electron: параметр установки рядом,
// обработка второго запуска, проверка «данные новее этой ветки», IPC окна «Версии».

import { discoverInstalls, isBranch, productNameFor } from "./branches.js";
import { dataCopyFor, switchCopyFor } from "./copy.js";
import { DATA_SCHEMA, checkDataVersion, stampDataVersion } from "./data-version.js";
import { createChannelsHub } from "./hub.js";
import { createBranchSwitcher } from "./switch.js";
import { rustSwitchesForApp } from "../rust-switches.js";
import { applyVegetationThirdPackDefault } from "../vegetation-third-pack-channel.js";
import { applyDiskGovernorDefault, applyDiskGuardDefault } from "../disk-governor-follow.js";
import { applyMoveBuildDefault } from "../install-move-channel.js";
import { applyStreamShaDefault } from "../stream-sha.js";
import { applySoundSlotRaiseDefault } from "../sound-slot-raise-channel.js";
import { applyCatalogAppendDefault } from "../catalog-append-channel.js";
import { applyRpModeDefault } from "../rp-mode-channel.js";
import { applyRpMigrateDefault } from "../rp-migrate-channel.js";
import { applyArenaAlphaDefaults } from "../arena-alpha-channel.js";
import { spawn } from "node:child_process";

export function installChannelArgument(argv = []) {
  const flagAt = argv.indexOf("--install-channel");
  if (flagAt === -1) return null;
  const [, value] = argv.slice(flagAt, flagAt + 2);
  return isBranch(value) ? value : null;
}

const DEFAULT_ACTIONS = Object.freeze({
  install: async () => ({ started: false, reason: "unavailable" }),
  installFromArgument: () => {},
  refresh: async () => {},
});

const LAUNCH_OPTIONS = Object.freeze({ windowsHide: false, stdio: "ignore", detached: true });

const describeError = (err) => (err && err.message ? err.message : String(err));
const asText = (value) => (typeof value === "string" ? value : "");
const branchRow = (ctx, matches) => ctx.hub.getState().branches.find(matches);
const unknownBranch = () => ({ started: false, reason: "unknown-branch" });

function reportLaunchFailure(ctx, err) {
  ctx.log("error", `ветка не запустилась: ${describeError(err)}`);
}

// Запуск ветки отдельным процессом: окно не ждёт её завершения.
function launchDetached(ctx, executablePath) {
  const child = ctx.spawnProcess(executablePath, [], { ...LAUNCH_OPTIONS });
  child.on?.("error", (err) => reportLaunchFailure(ctx, err));
  child.unref?.();
  return child;
}

// Параметры системного окна: одинаковые для обоих вопросов.
const boxOptions = (type, words, message, buttons, cancelId) => ({
  type,
  title: words.title,
  message,
  detail: words.detail,
  buttons,
  defaultId: 0,
  cancelId,
  noLink: true,
});

// Вопрос «Переключить ветку?». Переключатель зовёт ask({ id, from, to }) сразу после onChange();
// ответ в любом случае возвращается через switcher.answer(id, accepted):
// от живого окна — каналом CHANNELS_ANSWER, от системного диалога — отсюда.
function askAboutSwitch(ctx, question) {
  if (ctx.rendererReady()) {
    ctx.raiseWindow();
    return undefined;
  }
  const words = switchCopyFor(ctx.app.getLocale?.());
  const nameOf = (code, fallback) => branchRow(ctx, (row) => row.channel === code)?.name ?? fallback;
  const here = nameOf(question.from, productNameFor("release"));
  const there = nameOf(question.to, question.to);
  const options = boxOptions("question", words, words.message(here, there), [words.confirm(there), words.stay], 1);
  return ctx.showDialog(options).then((picked) => {
    ctx.switcher.answer(question.id, picked.response === 0);
  });
}

function stampOwnMarker(ctx, userData) {
  try {
    stampDataVersion({ userData, channel: ctx.ownChannel, version: ctx.app.getVersion?.() ?? null });
  } catch (err) {
    ctx.log("warn", `метка версии данных не записана: ${describeError(err)}`);
  }
}

// Данные записала более новая версия: объясняем и закрываемся (или отдаём ход той ветке).
async function refuseNewerData(ctx, marker) {
  const author = marker?.writtenBy?.channel ?? null;
  ctx.log(
    "warn",
    `данные новее этой ветки (схема ${marker.schema} > ${DATA_SCHEMA}, записала ${author ?? "неизвестно"}): запуск остановлен`
  );

  const authorName = isBranch(author) ? productNameFor(author) : null;
  const installedElsewhere = ctx.discover().map((found) => found.channel).includes(author);
  const canHandOver = authorName !== null && author !== ctx.ownChannel && installedElsewhere;

  const words = dataCopyFor(ctx.app.getLocale?.());
  const buttons = canHandOver ? [words.open(authorName), words.close] : [words.close];
  const message = words.message(productNameFor(ctx.ownChannel), authorName);
  const { response } = await ctx.showDialog(boxOptions("warning", words, message, buttons, buttons.length - 1));

  let handedOver = false;
  if (response === 0 && canHandOver) {
    const outcome = await ctx.switcher.request({ channel: author, confirm: false });
    handedOver = Boolean(outcome.started);
  }
  if (!handedOver) ctx.app.quit();
  return true;
}

async function guardNewerData(ctx) {
  if (!ctx.enabled) return false;
  const userData = ctx.app.getPath("userData");
  const verdict = checkDataVersion({ userData });
  if (verdict.mode === "newer") return refuseNewerData(ctx, verdict.marker);
  stampOwnMarker(ctx, userData);
  return false;
}

// Другая ветка просит открыться: поднимаем окно и передаём просьбу переключателю.
function askPeerToOpen(ctx, extra) {
  const peer = extra !== null && typeof extra === "object" ? extra : null;
  const channel = peer?.channel;
  if (!isBranch(channel) || channel === ctx.ownChannel) return false;

  ctx.raiseWindow();
  ctx.switcher.request({ channel, executablePath: asText(peer.executablePath) });
  return true;
}

// Второй запуск: установка рядом или просьба другой ветки.
function routeSecondLaunch(ctx, argv, extra) {
  const wanted = installChannelArgument(argv);
  if (wanted === null) return askPeerToOpen(ctx, extra);
  ctx.actions.installFromArgument(wanted);
  return true;
}

// Каналы окна «Версии»: имя ключа в IPC → работа над входом окна.
function ipcTable(ctx) {
  const snapshot = () => ctx.hub.getState();
  return [
    ["CHANNELS_STATE", snapshot],
    [
      "CHANNELS_REFRESH",
      async () => {
        ctx.hub.refreshInstalls();
        await ctx.actions.refresh();
        return snapshot();
      },
    ],
    ["CHANNELS_OPEN", (input) => ctx.switcher.request({ channel: asText(input?.channel), confirm: input?.confirm !== false })],
    [
      "CHANNELS_ANSWER",
      (input) => {
        ctx.switcher.answer(asText(input?.id), input?.accepted === true);
        return snapshot();
      },
    ],
    [
      "CHANNELS_INSTALL",
      (input) => {
        if (typeof input !== "string" || !isBranch(input)) return unknownBranch();
        return ctx.actions.install(input);
      },
    ],
  ];
}

function bindChannel(wiring, name, work) {
  wiring.handleIpc(wiring.IPC[name], (event, input) => wiring.trusted(event, () => work(input)));
}

// Поля переключателя: discover — как у хаба; ask/quit/spawnDetached/releaseLock/isBusy/onChange/log — его зависимости.
function switcherWiring(ctx) {
  const { app } = ctx;
  return {
    ownChannel: ctx.ownChannel,
    discover: ctx.discover,
    ask: (question) => askAboutSwitch(ctx, question),
    quit: () => app.quit(),
    spawnDetached: (path) => launchDetached(ctx, path),
    releaseLock: () => app.releaseSingleInstanceLock?.(),
    isBusy: (channel) => Boolean(branchRow(ctx, (row) => row.channel === channel)?.busy),
    onChange: () => ctx.hub.switchChanged(),
    log: ctx.log,
  };
}

export function createChannelsService(options) {
  const { app, enabled, ownChannel } = options;
  const ctx = {
    app,
    enabled,
    ownChannel,
    localAppData: options.localAppData === undefined ? process.env.LOCALAPPDATA : options.localAppData,
    log: options.log,
    rendererReady: options.rendererReady,
    showDialog: options.showDialog,
    raiseWindow: options.raiseWindow,
    spawnProcess: options.spawnProcess === undefined ? spawn : options.spawnProcess,
    actions: DEFAULT_ACTIONS,
    discover: () => (enabled ? discoverInstalls({ localAppData: ctx.localAppData }) : []),
    hub: null,
    switcher: null,
  };

  // Хаб берёт поле switchRequest у переключателя (switcher.pending()), поэтому
  // переключатель создаётся первым и передаётся хабу; onChange переключателя
  // зовёт hub.switchChanged() — окна получают свежий снимок.
  ctx.switcher = createBranchSwitcher(switcherWiring(ctx));
  ctx.hub = createChannelsHub({
    enabled,
    ownChannel,
    discover: ctx.discover,
    switcher: ctx.switcher,
    broadcast: options.broadcast,
  });

  const onProcessExit = () => ctx.switcher.runPendingOnExit();
  app.on?.("will-quit", onProcessExit);

  return {
    hub: ctx.hub,
    switcher: ctx.switcher,
    discover: ctx.discover,
    ownChannel,
    localAppData: ctx.localAppData,
    setActions(next) {
      ctx.actions = Object.assign({}, DEFAULT_ACTIONS, next);
    },
    lockData() {
      return enabled && ownChannel ? { channel: ownChannel, executablePath: process.execPath } : undefined;
    },
    cancelPending() {
      return ctx.switcher.cancelPending();
    },
    blockIfDataNewer() {
      return guardNewerData(ctx);
    },
    handleSecondInstance(details = {}) {
      const argv = details.argv === undefined ? [] : details.argv;
      const extra = details.additionalData === undefined ? null : details.additionalData;
      return enabled ? routeSecondLaunch(ctx, argv, extra) : false;
    },
    registerIpc(wiring) {
      for (const [name, work] of ipcTable(ctx)) bindChannel(wiring, name, work);
    },
  };
}

const journalLogger = (journal) => (level, message) => journal.record({ level, source: "channels", message });

export const createDesktopChannels = (parts) => {
  const rustSwitches = rustSwitchesForApp({ app: parts.app, channel: parts.ownChannel });
  /* Третий пакет растительности: в альфе включён, когда двух мало; в бете и релизе — выключен (19.11.2026). */
  applyVegetationThirdPackDefault({ channel: parts.ownChannel });
  /* «Одна запись вместо двух»: собранный update.rpf в игру переносится, а не копируется — в альфе включено (19.11.2026). */
  applyMoveBuildDefault({ channel: parts.ownChannel });
  /* Отпечаток по ходу записи: движок не читает собранный update.rpf второй раз ради SHA-256 — в альфе включено (19.11.2026). */
  applyStreamShaDefault({ channel: parts.ownChannel });
  /* Подъём слота памяти звуков оружия: в альфе включён, в бете и релизе выключен до отзывов альфы (20.11.2026). */
  applySoundSlotRaiseDefault({ channel: parts.ownChannel });
  /* Дозапись мода каталога в update.rpf: в альфе включена, в бете и релизе выключена; аварийно — ASTRAL_ENGINE_CATALOG_APPEND=0 (20.11.2026). */
  applyCatalogAppendDefault({ channel: parts.ownChannel });
  /* Арена Majestic: замена аирдропов, плита перед экраном и свои модели внутри зала — в альфе включены (заход владельца на arena10, 21.11.2026), в бете и релизе выключены; аварийно — ASTRAL_ARENA_SLABS=0, ASTRAL_ARENA_SCREEN_PLATES=0, ASTRAL_ARENA_HALL_ENTITIES=0. */
  applyArenaAlphaDefaults({ channel: parts.ownChannel });
  /* Режим «RP»: в альфе, бете и релизе (22.11.2026) при найденном клиенте RAGE MP и ненайденном Majestic оружие, одежда, дороги, растительность, места и наложения тела ставятся через контейнер/носитель в update.rpf; иначе и вне канала (dev-сборка) — прежний путь; аварийно ASTRAL_RP_MODE=off или выключатель вида (20.11.2026). */
  applyRpModeDefault({ channel: parts.ownChannel, note: (line) => parts.appLog.record({ level: "warn", source: "channels", message: line }) }).catch(() => {});
  /* Регулятор диска: в обычном режиме установки держит занятость диска около половины на любом носителе — в альфе включён, в бете и релизе выключен до приёмки на трёх носителях (20.11.2026). */
  applyDiskGovernorDefault({ channel: parts.ownChannel });
  /* Мягкий сторож «Быстрой установки» (`ASTRAL_DISK_GUARD`): отдельный выключатель, по умолчанию — только альфа и только когда замеры цены приняты (`DISK_GUARD_ALPHA_DEFAULT`). */
  applyDiskGuardDefault({ channel: parts.ownChannel });
  /* Перенос стоящего в контейнеры RP: пока не проверен на настоящих архивах — нигде не включён (`rp-migrate-channel.js`, константа ведущей). */
  applyRpMigrateDefault({ channel: parts.ownChannel });

  // Страница считается готовой, если она есть, не уничтожена, не грузится и не упала.
  const pageIsLive = () => {
    const page = parts.appWindow()?.webContents;
    return Boolean(page) && ["isDestroyed", "isLoading", "isCrashed"].every((probe) => !page[probe]?.());
  };
  const parentThenOptions = (options) => [parts.appWindow(), options].filter(Boolean);

  const service = createChannelsService({
    app: parts.app,
    enabled: parts.betaGate,
    ownChannel: parts.ownChannel,
    broadcast: parts.broadcast,
    log: journalLogger(parts.appLog),
    rendererReady: pageIsLive,
    showDialog: (options) => parts.dialog.showMessageBox(...parentThenOptions(options)),
    raiseWindow: parts.raiseAppWindow,
  });

  return Object.assign({}, service, {
    registerIpc: (options) => [service, rustSwitches].forEach((part) => part.registerIpc(options)),
  });
};
