// Мок моста окна установщика. Окно подставляет его, когда настоящий хост не
// положил window.astralBridge: скриншоты и разработка без Windows. Сценарий,
// ускорение и стоп-кадр берутся из адресной строки один раз, при загрузке.

const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;

const words = (text) => text.split(" ");
// Запись по списку ключей: порядок ключей в ответах и событиях виден снимкам трасс.
const rec = (keys, ...values) => Object.fromEntries(words(keys).map((key, i) => [key, values[i]]));
// base + случайное * spread (порядок вызовов Math.random важен трассам).
const jitter = (base, spread) => base + Math.random() * spread;

const USER_ROOT = ["C:", "Users", "Player", "AppData"];
const appData = (...rest) => [...USER_ROOT, ...rest].join("\\");
const PROGRAMS = appData("Local", "Programs", "");
const INSTALL_DIR = PROGRAMS + "Astral Beta";
const CURRENT = "0.9.0-beta.1";
const UPDATE_TARGET = "0.9.0-beta.2";
const SIDE_VERSION = "0.9.1-alpha.2";
const VERIFY_URL = "https://astral.invalid/beta/confirm?activation=00000000-0000-4000-8000-000000000000";

const CODE_GROUP = "[0-9A-HJKMNP-TV-Z]{4}";
const CODE_PATTERN = new RegExp(`^BETA-${CODE_GROUP}(-${CODE_GROUP}){3}$`);

// После этих кодов окно предлагает повторить.
const RETRYABLE = new Set(
  words(
    "RATE_LIMITED BETA_UNAVAILABLE SERVER_UNAVAILABLE NETWORK_UNAVAILABLE DISK_FULL APP_RUNNING HASH_MISMATCH INSTALL_FAILED",
  ),
);

// Сценарий -> ошибка поля кода.
const FIELD_ERRORS = new Map([
  ["invalid", "BETA_CODE_INVALID"],
  ["used", "BETA_CODE_USED"],
  ["expired", "BETA_CODE_EXPIRED"],
  ["revoked", "BETA_CODE_REVOKED"],
  ["register-first", "BETA_NOT_REGISTERED"],
  ["rate-limit", "RATE_LIMITED"],
  ["unavailable", "BETA_UNAVAILABLE"],
  ["server-down", "SERVER_UNAVAILABLE"],
  ["offline", "NETWORK_UNAVAILABLE"],
]);

// Сценарий -> (код, этап, добавка) отказа, который приходит сразу после старта установки.
const EARLY_FAILS = new Map([
  ["disk-full", ["DISK_FULL", "download"]],
  ["access", ["ACCESS_DENIED", "install", rec("detail", "mkdir app.new: access denied")]],
]);

// Сценарий -> (доля первого файла, ярлык в session) сбоя посреди загрузки.
const GLITCHES = new Map([
  ["ticket", [0.3, "ticketFailed"]],
  ["net-drop", [0.5, "dropped"]],
]);

// Сценарии, где подтверждение с кадра «confirm» всё равно приходит само.
const SELF_CONFIRMING = words("denied act-expired net-drop");

// Что уже стоит у «человека»: сценарий -> номера записей BRANCHES.
const INSTALLED_BY_SCENARIO = new Map([
  ["branches-installed", [0]],
  ["uninstall-shared", [1, 0]],
]);

const BRANCHES = ["release", "beta", "alpha"].map((channel, i) => ({
  channel,
  version: ["0.9.0", "0.9.0-beta.2", null][i],
  folder: ["Astral", "Astral Beta", "Astral Alpha"][i],
}));
const BRANCH_CHANNELS = BRANCHES.map(({ channel, version, folder }) => ({
  channel,
  version,
  installDir: PROGRAMS + folder,
}));
const folderOf = (channel) => BRANCHES.find((b) => b.channel === channel)?.folder ?? "Astral Beta";

const FILES = [
  ["base", 412, 18.4],
  ["pak", 38, 11.2],
].map(([name, size, rate], i) => ({ file: i + 1, name, total: size * MB, rate: rate * MB }));
const OVERALL_TOTAL = FILES.map((item) => item.total).reduce((a, b) => a + b, 0);

const INSTALL_PHASES = words("verify unpack shortcuts finalize");
const UPDATE_PHASES = words("verify unpack swap start");
const SIDE_PHASES = words("verify unpack files shortcuts registry");
const UNINSTALL_PHASES = words("files shortcuts registry");

// Порядок ключей ответа init.
const INIT_KEYS =
  "version osLocale osLocaleRaw installDir canChooseDir freeBytes requiredBytes existing hintChannel " +
  "installed viaLauncher fromChannel frame window dev mode userDataDirs appRunning fromVersion toVersion channel";

const params = new URLSearchParams(window.location.search);
const pick = (key, fallback) => params.get(key) || fallback;
const scenario = pick("scenario", "happy");
const scene = pick("scene", "");
const askedSpeed = Number(params.get("speed"));
const idleSpeed = scene ? 8 : 1;
const speed = askedSpeed > 0 ? askedSpeed : idleSpeed;
const freeze = pick("freeze", "").split(":");
const rawConfirm = params.get("confirmAfter");
const confirmAfter = rawConfirm === null ? 3500 : Number(rawConfirm);
const hint = pick("hint", null);
// ?access=open — открытый режим (BRIDGE.md, init().open): кода нет, submitCode принимает пустой код.
const openAccess = ["open", "open-nocode"].includes(params.get("access"));
// open-nocode — открытый режим, а в имени файла кода нет: окно просит скачать установщик заново.
const openWithCode = params.get("access") === "open";
// ?access=open-offline — кода в имени нет, а сервер не ответил: «нет связи с сервером» и «Повторить» (init().access).
const offlineAccess = params.get("access") === "open-offline";
const hasBranches = /^branches/.test(scenario);
const sideSite = ["side-site", "side-denied"].includes(scenario);
let mode = pick("mode", words("update uninstall side").find((p) => scenario.startsWith(p)) ?? "install");

const flags = (names) => Object.fromEntries(words(names).map((name) => [name, false]));
const session = {
  attempt: 1,
  confirmed: null,
  polling: 0,
  run: 0,
  ...flags("appClosed dropped hashFailed installing sideDone ticketFailed"),
};

class BridgeError extends Error {
  constructor(code, extra) {
    super(code);
    Object.assign(this, rec("code retryable", code, RETRYABLE.has(code)), extra);
  }
}

const refuse = (code, extra) => {
  throw new BridgeError(code, extra);
};

const scaled = (ms) => Math.max(0, ms / speed);
const wait = (ms) => new Promise((done) => void window.setTimeout(done, scaled(ms)));

const subscribers = new Map();

function on(event, listener) {
  const bucket = subscribers.get(event) ?? new Set();
  subscribers.set(event, bucket.add(listener));
  return () => bucket.delete(listener);
}

function emit(event, data = {}) {
  for (const listener of subscribers.get(event) ?? []) listener(data);
}

const online = (flag) => emit("connection", rec("online", flag));

// Отказ фонового хода: повторяемость берётся из того же списка, что у BridgeError.
const fail = (code, stage, extra) =>
  emit("error", { ...rec("code retryable stage", code, RETRYABLE.has(code), stage), ...extra });

// Все пары [номер фазы, процент] подряд: проценты 0..100 с шагом step.
function grid(count, step) {
  const marks = Array.from({ length: 100 / step + 1 }, (_, i) => i * step);
  return Array.from({ length: count }, (_, index) => marks.map((percent) => [index, percent])).flat();
}

const withDownload = (list, yes) => (yes ? ["download", ...list] : list);

function report(event, phases, index, percent, extra) {
  const overall = (index * 100 + percent) / phases.length;
  emit(event, { ...rec("phase percent overall", phases[index], percent, overall), ...extra });
}

// Остановка кадра: freeze = "вид:номер[:процент]"; для загрузки номера нет.
function frozenAt(kind, phase, percent) {
  const [which, first, second] = freeze;
  if (which !== kind) return false;
  const mark = Number(first);
  return kind === "download"
    ? percent >= mark
    : phase > mark || (phase === mark && percent >= Number(second ?? 0));
}

// То же, но фаза названа по имени (обновление и «рядом»).
const frozenNamed = (kind, phase, percent) => {
  const [which, name, from] = freeze;
  return which === kind && name === phase && percent >= Number(from ?? 0);
};

const installedNow = () => {
  const picks = INSTALLED_BY_SCENARIO.get(scenario) ?? [];
  return picks.map((i) => Object.assign({}, BRANCH_CHANNELS[i]));
};

function confirmedData() {
  const lowDisk = scenario === "disk-low";
  const data = rec(
    "accountName serial version channel downloadBytes requiredBytes freeBytes",
    "Никита",
    "AB7F-3KQ2",
    CURRENT,
    "beta",
    450 * MB,
    1.4 * GB,
    (lowDisk ? 0.9 : 54.2) * GB,
  );
  if (!hasBranches) return data;
  return Object.assign(data, rec("channels hintChannel installed", BRANCH_CHANNELS, hint, installedNow()));
}

// Удаление: фазы идут шагом 20%, «data» только с удалением данных пользователя.
const runUninstall = async (deleteUserData) => {
  const phases = [...UNINSTALL_PHASES];
  if (deleteUserData) phases.push("data");
  for (const [index, percent] of grid(phases.length, 20)) {
    await wait(150);
    emit("uninstall.progress", rec("phase percent", phases[index], percent));
    if (frozenAt("uninstall", index, percent)) return;
  }
  emit("uninstall.done", rec("removedUserData", Boolean(deleteUserData)));
};

// Установка «рядом»: с сайта добавляется скачивание в начале.
const runSide = async () => {
  const denied = scenario === "side-denied";
  await wait(900);
  if (denied) return wait(900).then(() => fail("BETA_CHANNEL_DENIED", "side"));
  const phases = withDownload(SIDE_PHASES, sideSite);
  const failFrom = scenario === "side-fail" ? 40 : Infinity;
  for (const [index, percent] of grid(phases.length, 10)) {
    if (percent === 0 && index === 0 && sideSite) {
      emit("side.progress", rec("phase", "download"));
      await wait(900);
    }
    await wait(150);
    report("side.progress", phases, index, percent, rec("version", SIDE_VERSION));
    if (frozenNamed("side", phases[index], percent)) return;
    if (phases[index] === "files" && percent >= failFrom) {
      fail("INSTALL_FAILED", "side", rec("detail", "swap app.new: access denied"));
      return;
    }
  }
  session.sideDone = true;
  emit("side.done", rec("channel version", "alpha", SIDE_VERSION));
};

const runUpdate = async () => {
  await wait(900);
  const phases = withDownload(UPDATE_PHASES, scenario === "update-full");
  const rollback = scenario === "update-rollback";
  const pace = [140, 140, 140, rollback ? 90 : 140];
  for (const [index, percent] of grid(phases.length, 10)) {
    await wait(pace[index] ?? 140);
    report("update.progress", phases, index, percent);
    if (frozenNamed("update", phases[index], percent)) return;
  }
  if (!rollback) {
    emit("update.done", rec("version", UPDATE_TARGET));
    return;
  }
  await wait(1200);
  emit("update.rolledback", rec("version restored reason", UPDATE_TARGET, CURRENT, "BOOT_TIMEOUT"));
};

// Опрос подтверждения активации. Каждый вызов гасит предыдущий (токен в session.polling).
const startPolling = async () => {
  session.polling += 1;
  const token = session.polling;
  const stale = () => session.polling !== token;
  const expiring = scenario === "act-expired";
  const flaky = scenario === "net-drop";
  const refused = scenario === "denied";
  await wait(3000);
  if (stale()) return;
  if (expiring) {
    await wait(1500);
    if (!stale()) emit("activation.expired");
    return;
  }
  if (flaky) {
    online(false);
    await wait(3500);
    if (stale()) return;
    online(true);
  }
  await wait(confirmAfter);
  if (stale()) return;
  if (refused) {
    fail("BETA_ACTIVATION_DENIED", "poll", rec("httpStatus", 410));
    return;
  }
  const outcome = confirmedData();
  session.confirmed = outcome;
  emit("activation.confirmed", outcome);
};

// Скачивание обоих файлов. true — дошли до конца; false — отмена, остановка кадра или сбой.
const downloadFiles = async (alive) => {
  const glitch = GLITCHES.get(scenario);
  let before = 0;
  for (const { file, name, total, rate } of FILES) {
    const halted = (got) => frozenAt("download", 0, ((before + got) / OVERALL_TOTAL) * 100);
    for (let got = 0; got < total; ) {
      await wait(200);
      if (!alive()) return false;
      got = Math.min(total, got + rate * 0.2 * jitter(0.85, 0.3));
      emit(
        "download.progress",
        rec(
          "file name received total bytesPerSec etaSec attempt overallReceived overallTotal",
          file,
          name,
          got,
          total,
          rate * jitter(0.9, 0.2),
          (total - got) / rate,
          session.attempt,
          before + got,
          OVERALL_TOTAL,
        ),
      );
      if (halted(got)) return false;
      const hit = glitch && file === 1 && got / total > glitch[0] && !session[glitch[1]];
      if (!hit) continue;
      session[glitch[1]] = true;
      if (scenario === "ticket") {
        session.installing = false;
        fail("BETA_TICKET_INVALID", "download", rec("httpStatus", 403));
        return false;
      }
      online(false);
      await wait(3500);
      online(true);
    }
    before += total;
    if (file === 1 && scenario === "hash" && !session.hashFailed) {
      Object.assign(session, { hashFailed: true, installing: false });
      emit("install.progress", rec("phase percent overall", "verify", 60, 4));
      await wait(500);
      fail("HASH_MISMATCH", "install", rec("detail", "sha256 mismatch for base.zip"));
      return false;
    }
  }
  return true;
};

const runInstall = async () => {
  const early = EARLY_FAILS.get(scenario);
  session.installing = true;
  const token = (session.run += 1);
  const alive = () => session.run === token;
  if (early) {
    return wait(700).then(() => {
      session.installing = false;
      fail(...early);
    });
  }
  // scenario=queue: сервер занят — «ждём своей очереди» с отсчётом; кадр стоит на ожидании (download.queue).
  if (scenario === "queue") {
    emit("download.queue", rec("file waitSec tries", "base", 47, 2));
    return;
  }
  if (!(await downloadFiles(alive))) return;
  for (const [index, percent] of grid(INSTALL_PHASES.length, 10)) {
    await wait(130);
    if (!alive()) return;
    report("install.progress", INSTALL_PHASES, index, percent);
    if (frozenAt("install", index, percent)) return;
  }
  session.installing = false;
  emit("done", rec("installDir version", INSTALL_DIR, CURRENT));
};

// Фоновый ход окна, который init запускает сам (настоящим таймером, без speed).
const BACKGROUND_JOBS = new Map([
  ["update", runUpdate],
  ["side", runSide],
]);

// Готовые кадры: имя -> шаги по очереди (описаны в runScene).
const SCRIPTS = new Map(
  Object.entries({
    "welcome-filled": "fillShort",
    "welcome-error": "signIn",
    confirm: "signIn",
    ready: "signIn toReady",
    download: "signIn toReady start",
    install: "signIn toReady start",
    done: "signIn toReady start doneScreen",
    error: "signIn toReady start errorScreen",
    closing: "signIn toReady start enough closeWindow",
    cancel: "signIn toReady start enough cancelRequest",
    branch: "signIn toBranch",
    "branch-ready": "signIn toBranch pickAlpha",
    "side-closing": "sideFiles closeWindow",
    "uninstall-progress": "uninstall",
    "uninstall-done": "uninstall uninstalled",
    "uninstall-checked": "checkData",
  }).map(([name, list]) => [name, words(list)]),
);

// Готовые кадры для скриншотов: app = { actions, store } интерфейса, query = адресная строка.
const runScene = async ({ actions, store }, query) => {
  const name = query.get("scene");
  const at = (id) => () => id === store.get().screen;
  const until = (predicate, limit = 30000) =>
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const look = () => {
        if (predicate()) return resolve();
        if (Date.now() - startedAt > limit) return reject(new Error("mock: не дождались кадра «" + name + "»"));
        window.setTimeout(look, 30);
      };
      look();
    });
  const fill = (body = "7K3MQ9XD2PWFH8RT") => actions.editCode(rec("body", body));
  // Шаг без ожидания: вызывает действия и ничего не возвращает.
  const fire =
    (...calls) =>
    () => {
      for (const [method, ...args] of calls) actions[method](...args);
    };

  const steps = {
    fillShort: () => {
      fill("7K3MQ9XD2P");
    },
    signIn: () => {
      fill();
      return actions.submitCode();
    },
    toReady: () => until(at("ready")),
    start: () => actions.startInstall(),
    enough: () => until(() => 40 * MB < store.get().download.overallReceived),
    doneScreen: () => until(at("done")),
    errorScreen: () => until(at("error")),
    closeWindow: () => actions.windowClose(),
    cancelRequest: fire(["requestCancel"]),
    toBranch: () => until(at("branch")),
    pickAlpha: fire(["chooseBranch", "alpha"], ["continueFromBranch"]),
    sideFiles: () => until(() => "files" === store.get().side.phase),
    uninstall: () => actions.uninstall(),
    uninstalled: () => until(at("uninstall-done")),
    checkData: fire(["setDeleteUserData", true]),
  };

  for (const key of SCRIPTS.get(name) ?? []) await steps[key]();
};

const startBackground = () => {
  const job = BACKGROUND_JOBS.get(mode);
  if (job) window.setTimeout(job, 0);
};

function initReply() {
  const side = mode === "side";
  const toAlpha = side || scenario === "uninstall-shared";
  const values = {
    ...rec(
      "channel fromChannel fromVersion toVersion",
      toAlpha ? "alpha" : "beta",
      "beta",
      CURRENT,
      side ? (sideSite ? "" : SIDE_VERSION) : UPDATE_TARGET,
    ),
    ...rec("mode canChooseDir appRunning viaLauncher", mode, mode === "install", scenario === "uninstall-running", sideSite),
    ...rec(
      "version osLocale osLocaleRaw frame dev",
      "1.0.6",
      pick("os", "ru"),
      "ru-RU",
      params.get("frame") === "native" ? "native" : "custom",
      true,
    ),
    ...rec(
      "installDir freeBytes requiredBytes window userDataDirs",
      INSTALL_DIR,
      54.2 * GB,
      null,
      rec("width height", 960, 600),
      [appData("Roaming", "Astral"), appData("Local", "Astral")],
    ),
    ...rec(
      "existing hintChannel installed",
      scenario === "existing" ? rec("version channel", CURRENT, "beta") : null,
      hasBranches ? hint : null,
      installedNow(),
    ),
  };
  // Открытый режим — обычный человек с веткой release: папка Astral, версия установщика 1.0.16, чипа ветки нет.
  if (offlineAccess) values.access = "unreachable";
  if (openAccess) {
    // ?hint=alpha — установщик с именем AstralSetup-alpha-….exe: ветка и папка по подсказке из имени.
    const branch = ["alpha", "beta"].includes(hint) ? hint : "release";
    const folder = { alpha: "Astral Alpha", beta: "Astral Beta", release: "Astral" }[branch];
    Object.assign(values, rec("channel version installDir hintChannel", branch, "1.0.16", PROGRAMS + folder, branch));
    if (scenario === "existing") values.existing = rec("version channel", "1.0.0", branch);
  }
  return Object.fromEntries(words(openAccess ? INIT_KEYS + (openWithCode ? " open openCode" : " open") : offlineAccess ? INIT_KEYS + " access" : INIT_KEYS).map((key) => [key, key === "open" || key === "openCode" ? true : values[key]]));
}

const init = () =>
  wait(120).then(() => {
    startBackground();
    return initReply();
  });

// Отказ по введённому коду: формат, затем ошибка поля кода из сценария.
function refusalFor(code) {
  const typed = openAccess && !code ? null : String(code).toUpperCase();
  if (typed !== null && !CODE_PATTERN.test(typed)) return new BridgeError("CODE_FORMAT");
  const field = FIELD_ERRORS.get(scenario);
  if (!field) return null;
  return new BridgeError(field, field === "RATE_LIMITED" ? rec("retryAfterSec httpStatus", 17, 429) : undefined);
}

const newTicket = () =>
  rec(
    "userCode verifyUrl expiresAt expiresInSec pollIntervalSec",
    "KQ7M-2PXD",
    VERIFY_URL,
    new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    600,
    3,
  );

async function submitCode({ code } = {}) {
  await wait(jitter(400, 800));
  const refusal = refusalFor(code);
  if (refusal) throw refusal;
  const heldOnFrame = scene === "confirm" && !SELF_CONFIRMING.includes(scenario);
  if (scenario !== "hold" && !heldOnFrame) startPolling();
  return newTicket();
}

const started = () => rec("started", true);

function startInstall() {
  if (!session.confirmed) return refuse("INVALID_STATE");
  void runInstall();
  const carriesOver = session.hashFailed || session.ticketFailed;
  session.attempt += carriesOver ? 1 : 0;
  return started();
}

function cancelInstall() {
  Object.assign(session, {
    run: session.run + 1,
    installing: false,
    confirmed: null,
    hashFailed: false,
    ticketFailed: false,
  });
}

function windowClose() {
  const idle = !session.installing && (mode === "side" ? session.sideDone : mode === "install");
  if (idle) document.title = "closed";
  else emit("window.closeRequested", rec("busy", true));
}

// Папка из адреса: null — окно выбора закрыли, иначе путь без хвостовых слэшей.
function pickedBase() {
  const raw = params.get("pick");
  if (raw === "protected") refuse("FOLDER_NOT_ALLOWED");
  return raw ? raw.replace(/[\\/]+$/, "") : null;
}

async function chooseInstallDir({ channel } = {}) {
  await wait(200);
  const base = pickedBase();
  if (base === null) return { canceled: true };
  const under = (folder) => base + "\\" + folder;
  const reply = {
    canceled: false,
    installDir: under(folderOf(channel || "beta")),
    freeBytes: 412.5 * GB,
  };
  if (!hasBranches) return reply;
  const channels = BRANCHES.map((branch) => ({
    channel: branch.channel,
    version: branch.version,
    installDir: under(branch.folder),
  }));
  return { ...reply, channels };
}

function uninstall({ deleteUserData } = {}) {
  const blocked = scenario === "uninstall-running" && !session.appClosed;
  if (blocked) {
    session.appClosed = true;
    refuse("APP_RUNNING");
  }
  void runUninstall(deleteUserData);
  return started();
}

function enterCode() {
  if (mode === "side") {
    mode = "install";
    return {};
  }
  return refuse("INVALID_STATE");
}

function launch({ channel } = {}) {
  document.title = channel ? "launch:" + channel : "launch";
}

function cancelActivation() {
  session.polling++;
}

const quit = () => {
  document.title = "quit";
};
const opened = () => rec("opened", true);
const nothing = () => undefined;

// Имена методов через пробел -> обработчик.
const METHOD_TABLE = [
  ["init", init],
  ["submitCode", submitCode],
  ["startInstall", startInstall],
  ["cancelInstall", cancelInstall],
  ["windowClose", windowClose],
  ["chooseInstallDir", chooseInstallDir],
  ["uninstall", uninstall],
  ["enterCode", enterCode],
  ["launch", launch],
  ["quit", quit],
  ["cancelActivation", cancelActivation],
  ["openVerifyUrl openSite openLogs", opened],
  ["setLocale fitWindow windowDrag windowMinimize", nothing],
];
const METHODS = Object.fromEntries(
  METHOD_TABLE.flatMap(([names, handler]) => words(names).map((name) => [name, handler])),
);

const unsupported = () => refuse("UNSUPPORTED");
const call = async (method, args) => (METHODS[method] ?? unsupported)(args);

window.astralBridge = { version: 1, call, on, __mock: { scenario, emit, runScene } };
