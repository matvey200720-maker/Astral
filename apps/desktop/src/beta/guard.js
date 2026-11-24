// Защита закрытой беты Astral.
//
// Включается только в сборке с вшитым флагом. На старте, пока окно ещё не поднято,
// проверяет доступ: подписанная лицензия рядом с установкой, тот же компьютер, ключ
// устройства в хранилище Windows, ответ сервера (bind на первом запуске, дальше unlock),
// ключ интерфейса в ответе. Без связи работает по кэшу ключа. Дальше перепроверяет раз
// в шесть часов и после пробуждения, подписывает запросы обновителя и отдаёт ключ для
// расшифровки интерфейса.
//
// Главное правило: лаунчер ничего не стирает — ни себя, ни свои данные (решение владельца
// 23.11.2026). Отзыв доступа и несовпадение установки с компьютером — это остановка: окно
// «доступ закрыт» и выход, файлы остаются. Отзыв от сервера принимается только с его подписью
// на этот самый запрос (api.js); ответ без подписи и любой сбой самой проверки (нет сети,
// 5xx/429, чужой ответ, занятый файл, молчащее хранилище, нечитаемый компьютер, идёт
// обновление) — это «повторить» или работа по кэшу ключа.

import { win32 as win } from "node:path";
import systemFsp from "node:fs/promises";

import { createBetaApi, verdictOf } from "./api.js";
import { resolveLayout } from "./layout.js";
import { betaText, pickBetaLanguage, revokedDialogText, supportCode } from "./messages.js";
import { DEFAULT_BRANCH, branchOfRoot } from "./branches.js";
import { BETA_PRODUCT_NAME, readBetaBuildConfig } from "./build-config.js";
import { generateDeviceKey, validDeviceKey } from "./dpop.js";
import { verifyLicense } from "./license.js";
import { machineHash, readMachineGuid } from "./machine.js";
import { createVault } from "./vault.js";
import { scanPakOffThread } from "./pak-scan.js";
import { loadBetaWebBundle } from "./web-bundle.js";
import { createPakDecryptor as pakDecryptor, pakOpensWith } from "@modovik/beta-pak";

export { BETA_PRODUCT_NAME };
export const BETA_RECHECK_MS = 21600000;

const SERVER_HEADERS_TIMEOUT_MS = 7000;
const LICENSE_REREAD_PAUSES = [700, 1400];
// Файл есть, а подпись не сходится: его могла дописывать установка или трогать антивирус, поэтому ещё два чтения (всего ~9 с).
const LICENSE_INVALID_EXTRA_PAUSES = [2800, 4200];
// Секрет привязки после удачной привязки стирается с повторами (его могла держать антивирусная программа).
const BIND_REMOVE_PAUSES = [200, 600];
const CLOCK_BACK_TOLERANCE_MS = 5 * 60 * 1000;
const UPDATE_MARKERS = ["app.new", "app.old", "beta.new", "beta.old"];
// Метка «не знаем» для ответа «доступ есть» с ключом, которым интерфейс не открывается.
const UNPROVEN_KEY = "pak_key_unproven";

// Ключи текста окна-ошибки и окна «повторить» по причине.
const ERROR_TEXT = Object.fromEntries([
  ["platform", "blockedPlatform"],
  ["build", "blockedBuild"],
  ["layout", "blockedLayout"],
  ["unknown_activation", "blockedUnknown"],
  ["bind_invalid", "blockedBindInvalid"],
  ["bad_request", "blockedBadRequest"],
  ["web", "blockedWeb"],
  ["device_key_missing", "blockedDeviceKey"],
  ["license_missing", "blockedLicenseMissing"],
  ["device_key_unreadable", "blockedDeviceKey"],
]);
// Остановки, в окне которых есть строка «Код причины для поддержки» (причина · serial).
const SUPPORT_CODE_REASONS = new Set(["device_key_missing", "device_key_unreadable", "license_missing"]);
const RETRY_TEXT = Object.fromEntries([
  ["network", ["offlineTitle", "offlineBody"]],
  // Сервер ответил отказом в доступе, но его подписи на ответе нет: не «нет связи» и не «доступ отозван».
  ["unverified", ["blockedTitle", "serverUnverified"]],
  ["proof", ["blockedTitle", "proofRejected"]],
  ["storage", ["blockedTitle", "storageUnavailable"]],
  ["machine", ["blockedTitle", "machineUnreadable"]],
  ["license", ["blockedTitle", "licenseUnreadable"]],
]);

function textOf(error) {
  return (error && error.message) || String(error);
}

function missing(error) {
  return error && ["ENOENT", "ENOTDIR"].includes(error.code);
}

function stripLicense(text) {
  return text.replace(/^\uFEFF/, "").trim();
}

// Какое окно «повторить» показать, когда сервер не дал ответа, которому можно верить.
function retryReasonOf(verdict) {
  if (verdict.reason === "proof" || verdict.reason === "unverified") return verdict.reason;
  return "network";
}

function decodePakKey(text) {
  try {
    return Buffer.from(text, "base64url");
  } catch {
    return null;
  }
}

// Описание окна для showMessageBox: порядок полей задан.
function dialogSpec(type, title, message, buttons, cancelId) {
  return { type, title, message, buttons, defaultId: 0, cancelId, noLink: true };
}

// Пары «поле — значение» из источника по списку имён.
function entriesOf(source, keys) {
  return keys.map((key) => [key, source[key]]);
}

export function createBetaGuard(overrides = {}) {
  const option = (key, fallback) => (overrides[key] === undefined ? fallback() : overrides[key]);
  const fs = option("fs", () => systemFsp);
  const platform = option("platform", () => process.platform);
  const env = option("env", () => process.env);
  const now = option("now", () => Date.now);
  const readBuildConfig = option("readBuildConfig", () => readBetaBuildConfig);
  const readGuid = option("readMachineGuid", () => readMachineGuid);
  const createApi = option("createApi", () => createBetaApi);
  const fetchImpl = option("fetchImpl", () => (...args) => fetch(...args));
  // Процессов сторож не запускает и ничего не стирает: ни запуска программ, ни реестра, ни временных сценариев у него нет.
  const setTimer = option("setInterval", () => setInterval);
  const clearTimer = option("clearInterval", () => clearInterval);
  const sleep = option("sleep", () => (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const loadBundle = option("loadBundle", () => (opts) => loadBetaWebBundle({ ...opts, scan: scanPakOffThread }));
  const checkPakKey = option("checkPakKey", () => pakOpensWith);

  let buildConfig = null;
  let state = null;
  let stopping = false; // доступ закрыт: окно показано или показывается, новых запросов не принимаем
  let rechecking = false;
  let timer = null;
  let resumeHandler = null;
  let session = null; // снимок окружения текущего start (electron, язык, продукт, журнал)

  function log(level, message, detail = "") {
    try {
      const entry = { level, message: `бета: ${message}`, detail };
      session?.electron?.log?.(entry);
    } catch {
      // сбой журнала не мешает проверке
    }
  }

  async function showDialog(options) {
    try {
      const answer = await session.electron.dialog.showMessageBox(options);
      return answer.response;
    } catch (error) {
      log("warn", "диалог не показался", textOf(error));
      return options.cancelId ?? 0;
    }
  }

  // Немецкие тексты ставят название в составное слово через дефис — отдаём обе формы.
  const textParams = () => ({ product: session.product, productCompound: session.product.replace(/ /g, "-") });
  const dialogText = (key) => betaText(session.lang, key, textParams());

  function errorDialog(reason, serial = "") {
    const spec = dialogSpec(
      "error",
      dialogText("blockedTitle"),
      dialogText(ERROR_TEXT[reason]),
      [betaText(session.lang, "ok")],
      0,
    );
    if (SUPPORT_CODE_REASONS.has(reason)) {
      spec.detail = betaText(session.lang, "reasonLine", { code: supportCode(reason, serial) });
    }
    return spec;
  }

  function retryDialog(reason) {
    const [titleKey, bodyKey] = RETRY_TEXT[reason];
    return dialogSpec(
      "warning",
      dialogText(titleKey),
      dialogText(bodyKey),
      [betaText(session.lang, "retry"), betaText(session.lang, "quit")],
      1,
    );
  }

  // Окно-ошибка: причина в журнал, окно, выход. Результат вызывающему — { ok: false, reason }.
  async function blockAndExit(reason, ctx = {}, detail = "") {
    log("error", `лаунчер остановлен: ${reason}`, detail);
    await showDialog(errorDialog(reason, ctx.serial ?? ""));
    session.electron.app.exit(0);
    return { ok: false, reason };
  }

  function destroyQuietly(window) {
    try {
      window.destroy();
    } catch {
      // окна могли уже закрыться
    }
  }

  function closeWindows() {
    const windows = session.electron.BrowserWindow?.getAllWindows?.() ?? [];
    for (const window of windows) destroyQuietly(window);
  }

  // Пока окно «доступ закрыт» на экране, выход приложения отложен. Окна лаунчера к этому мигу уже закрыты, а закрытие
  // последнего окна само просит выход (main.js, window-all-closed): без задержки процесс завершился бы раньше, чем
  // человек увидит причину, и лаунчер просто исчез бы. Возвращает функцию, которая снимает задержку.
  function holdQuit() {
    const app = session.electron.app;
    const hold = (event) => event?.preventDefault?.();
    try {
      app.on?.("before-quit", hold);
    } catch {
      return () => {};
    }
    return () => {
      try {
        app.removeListener?.("before-quit", hold);
      } catch {
        // подписки могло не быть
      }
    };
  }

  function clearTimers() {
    if (timer) clearTimer(timer);
    timer = null;
    if (resumeHandler) {
      try {
        session.electron.powerMonitor?.removeListener?.("resume", resumeHandler);
      } catch {
        // подписки могло не быть
      }
    }
    resumeHandler = null;
  }

  function vaultAt(file) {
    return createVault({ file, safeStorage: session.electron.safeStorage, fsImpl: fs });
  }

  function apiFor(origin, deviceKey, version) {
    const userAgent = `AstralBeta/${version || "0"}`;
    return createApi({
      origin,
      getKey: () => deviceKey,
      fetchImpl,
      now,
      userAgent,
      headersTimeoutMs: SERVER_HEADERS_TIMEOUT_MS,
      // Тем же ключом, что и лицензия, сервер подписывает отзыв доступа: без его подписи отзыв не принимается.
      verdictKey: buildConfig?.licensePublicKey,
    });
  }

  // Папки, которые охранник читает у Electron на каждом проходе (запуск, перепроверка).
  function appPaths() {
    const app = session.electron.app;
    const asked = [["userDataPath", "userData"], ["appDataPath", "appData"]];
    return Object.fromEntries(asked.map(([field, name]) => [field, app.getPath(name)]));
  }

  // Тело запроса к серверу: одно и то же при запуске и перепроверке.
  function launcherBody(ctx) {
    return { activation_id: ctx.activationId, machine: ctx.machine, app_version: ctx.appVersion };
  }

  // Открывает ли ключ интерфейс на диске: "fits" — да; "wrong" — файл на вид цел, но этим ключом не открывается;
  // "unknown" — файл не прочитать (занят, пропал, обрезан). Читается только начало файла.
  async function pakKeyFit(pakFile, key) {
    try {
      return (await checkPakKey(pakFile, key)) ? "fits" : "wrong";
    } catch {
      return "unknown";
    }
  }

  function logTransient(verdict) {
    if (verdict.code === UNPROVEN_KEY) {
      log("warn", "сервер прислал ключ интерфейса, которым интерфейс не открывается: ответ не принят, кэш ключа не тронут");
      return;
    }
    if (verdict.reason === "unverified") {
      log("warn", `сервер ответил отказом в доступе (${verdict.code}), но его подписи на ответе нет: доступ не отзываем`);
      return;
    }
    const label = verdict.status ? `${verdict.reason} ${verdict.status}` : verdict.reason;
    log("info", `сервер недоступен (${label})`);
  }

  // --- доступ закрыт ------------------------------------------------------
  // Отзыв доступа (подписанный сервером) или установка не от этого компьютера: окно с причиной и выход.
  // Ничего не стирается: ни установка, ни данные, ни ключи. Следующий запуск снова спросит сервер.
  async function stopRevoked(reason, ctx) {
    if (stopping) return { ok: false, reason };
    stopping = true;
    log("warn", `доступ закрыт: ${reason}`);
    clearTimers();
    state = null;

    // Порядок важен: сначала задержка выхода, потом закрытие окон (интерфейс больше не работает), потом окно с причиной.
    const releaseQuit = holdQuit();
    closeWindows();

    const text = revokedDialogText(session.lang, reason, ctx.serial ?? "");
    await showDialog({
      type: "warning",
      title: text.title,
      message: text.message,
      detail: text.detail,
      buttons: [text.ok],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    releaseQuit();
    session.electron.app.exit(0); // exit, не quit: событие before-quit он не шлёт
    return { ok: false, reason };
  }

  // --- кэш ключа ----------------------------------------------------------
  function cacheValid(value, ctx) {
    if (!value || value.v !== 1 || value.aid !== ctx.activationId || value.mh !== ctx.machine) return false;
    if (typeof value.serial !== "string") return false;
    const key = decodePakKey(value.pakKey);
    if (key === null || key.length !== 32) return false;
    if (!["checkedAt", "expiresAt", "lastSeen"].every((field) => Number.isFinite(value[field]))) return false;
    const current = now();
    return current < value.expiresAt && current >= value.lastSeen - CLOCK_BACK_TOLERANCE_MS;
  }

  async function writeCache(ctx, result) {
    try {
      const current = now();
      await ctx.cacheVault.write(Object.fromEntries([
        ["v", 1],
        ["aid", ctx.activationId],
        ["mh", ctx.machine],
        ["pakKey", result.pakKey.toString("base64url")],
        ["serial", result.serial],
        ["channels", result.channels],
        ["checkedAt", current],
        ["expiresAt", current + result.checkTtlSeconds * 1000],
        ["lastSeen", current],
      ]));
    } catch (error) {
      log("warn", "кэш ключа не записался", textOf(error));
    }
  }

  function activate(ctx, granted) {
    const { pakKey, serial, channels, expiresAt } = granted;
    clearTimers();
    const fromCtx = (key, field = key) => [field, ctx[key]];
    state = Object.fromEntries([
      fromCtx("activationId"),
      fromCtx("machine"),
      ["channels", channels],
      fromCtx("appVersion", "version"),
      ["serial", serial],
      ["pakKey", pakKey],
      ["expiresAt", expiresAt],
      fromCtx("apiOrigin"),
      fromCtx("deviceKey"),
      fromCtx("layout"),
    ]);
    timer = setTimer(() => {
      void recheck();
    }, BETA_RECHECK_MS);
    resumeHandler = () => {
      void recheck();
    };
    session.electron.powerMonitor?.on?.("resume", resumeHandler);
  }

  // --- ключ устройства ----------------------------------------------------
  const canonFolder = (folder) => win.normalize(folder).replace(/\\+$/, "").toLowerCase();
  const sameFolder = (a, b) => canonFolder(a) === canonFolder(b);

  function legacyDirsOf(ctx) {
    const dirs = [ctx.userDataPath];
    const betaData = ctx.appDataPath ? win.join(ctx.appDataPath, "Astral Beta") : null;
    if (betaData && !sameFolder(betaData, ctx.userDataPath)) dirs.push(betaData);
    return dirs;
  }

  const vaultNotReady = (read) => ["unavailable", "unreadable"].includes(read.status);
  const holdsOwnKey = (read, ctx) =>
    read.status === "found" && validDeviceKey(read.value) && read.value.aid === ctx.activationId;

  // Возвращает { key } при успехе, { retry: "storage" } для «повторить» либо { stop, detail } — остановку без стирания.
  // Новый ключ заводится только при секрете привязки (первый запуск): после привязки секрета в папке нет, и сервер
  // ответил бы 403 BETA_DEVICE_MISMATCH любому новому ключу. Нет ключа и нет секрета — это другой профиль Windows
  // (обычная учётка и пароль администратора в UAC) или пропавший файл: не заводим ключ, к серверу не ходим, не стираем.
  async function obtainDeviceKey(ctx, canBind) {
    const deviceFile = win.join(ctx.userDataPath, `beta-device.${ctx.activationId}.bin`);
    const vault = vaultAt(deviceFile);
    const read = await vault.read();

    // Файл есть, а эта учётка Windows его не расшифровывает (профиль восстановлен из копии, пароль сброшен администратором):
    // это не вина человека и не вердикт сервера. Ключ не трогаем и не заменяем, к серверу не ходим, не стираем.
    if (read.status === "undecryptable")
      return { stop: "device_key_unreadable", detail: `ключ устройства (${win.basename(deviceFile)}) есть, но эта учётная запись Windows его не расшифровывает; ключ не тронут, сервер не спрашивали` };
    if (vaultNotReady(read)) return { retry: "storage" };
    if (holdsOwnKey(read, ctx)) {
      return { key: read.value };
    }

    // своего ключа нет — ищем ключ прежней раскладки без id активации
    for (const dir of legacyDirsOf(ctx)) {
      const legacyVault = vaultAt(win.join(dir, "beta-device.bin"));
      const legacy = await legacyVault.read();
      if (vaultNotReady(legacy)) return { retry: "storage" };
      if (holdsOwnKey(legacy, ctx)) {
        try {
          await vault.write(legacy.value);
        } catch (error) {
          log("warn", "ключ устройства прежней раскладки не перенёсся", textOf(error));
          return { retry: "storage" };
        }
        await legacyVault.remove();
        await vaultAt(win.join(dir, "beta-cache.bin")).remove();
        log("info", "ключ устройства перенесён из прежней раскладки", dir);
        return { key: legacy.value };
      }
    }

    // ничего пригодного: без секрета привязки нового ключа не будет
    if (!canBind) {
      const name = `beta-device.${ctx.activationId}.bin`;
      return { stop: "device_key_missing", detail: `нет ключа устройства (${name}: ${read.status}), секрета привязки нет, сервер не спрашивали` };
    }
    const fresh = { v: 1, aid: ctx.activationId, ...generateDeviceKey() };
    try {
      await vault.write(fresh);
    } catch (error) {
      log("warn", "ключ устройства не записался", textOf(error));
      return { retry: "storage" };
    }
    return { key: fresh, fresh: true, vault };
  }

  // --- одна попытка проверки ----------------------------------------------
  // Исход: { active }, { cache }, { revoked }, { stop }, { retry }. Ни один исход ничего не стирает.
  async function attempt(ctx) {
    // лицензия с перечитываниями: после каждой неудачи, кроме последней, пауза
    let license = null;
    let licenseErr = null;
    const pauses = [...LICENSE_REREAD_PAUSES];
    let extended = false;
    for (let tries = 0; ; tries += 1) {
      try {
        const text = stripLicense(await fs.readFile(ctx.layout.licenseFile, "utf8"));
        const check = verifyLicense(text, buildConfig.licensePublicKey);
        if (check.ok) {
          license = check.claims;
          break;
        }
        licenseErr = { kind: "invalid" };
      } catch (error) {
        if (missing(error)) {
          licenseErr = { kind: "missing" };
        } else {
          licenseErr = { kind: "unreadable" };
          break; // другую ошибку перечитыванием не лечим
        }
      }
      if (!extended && tries >= pauses.length && licenseErr.kind === "invalid") {
        extended = true;
        pauses.push(...LICENSE_INVALID_EXTRA_PAUSES);
      }
      if (tries >= pauses.length) break;
      await ctx.sleep(pauses[tries]);
    }

    if (!license) {
      if (licenseErr.kind === "unreadable") return { retry: "license" };
      const updating = await hasUpdateMarker(ctx.layout.root);
      if (updating) return { retry: "license" };
      // Файла нет (антивирус, чистильщик, недоделанная установка) — остановка и просьба поставить заново.
      // Подпись не сходится — окно «файлы доступа повреждены» и выход; сами файлы остаются.
      if (licenseErr.kind === "missing") {
        return { stop: "license_missing", detail: "нет файла лицензии (beta/license), перечитан три раза, обновления нет" };
      }
      return { revoked: "license_invalid" };
    }

    ctx.activationId = license.activationId;
    ctx.serial = license.serial;
    ctx.apiOrigin = license.apiOrigin;

    // reg.exe запускает сам machine.js (execFile). Свой запускатель сюда не передаём: 12.11 подставной
    // runReg без spawn возвращал null — у всех выходило «Не удалось прочитать идентификатор компьютера».
    const guid = await readGuid({ platform, env });
    if (!guid) return { retry: "machine" };
    ctx.machine = machineHash(guid);
    if (ctx.machine !== license.machineHash) return { revoked: "machine_mismatch" };

    // секрет привязки читаем первым: от него зависит, можно ли заводить ключ устройства
    let bindSecret = "";
    try {
      bindSecret = stripLicense(await fs.readFile(ctx.layout.bindFile, "utf8"));
    } catch (error) {
      if (!missing(error)) return { retry: "license" };
    }
    if (bindSecret && !/^[A-Za-z0-9_-]{16,128}$/.test(bindSecret)) return { stop: "bind_invalid" };

    const device = await obtainDeviceKey(ctx, Boolean(bindSecret));
    if (device.stop) return { stop: device.stop, detail: device.detail };
    if (device.retry) return { retry: device.retry };
    ctx.deviceKey = device.key;

    const cacheFile = win.join(ctx.userDataPath, `beta-cache.${ctx.activationId}.bin`);
    ctx.cacheVault = vaultAt(cacheFile);
    const cacheRead = await ctx.cacheVault.read();
    // Кэш ключа — удобство для работы без сети, а не доказательство: не расшифровался — считаем пустым и идём к серверу.
    if (cacheRead.status === "undecryptable") log("warn", "кэш ключа не расшифровался, берём ответ сервера");
    const cache = cacheRead.status === "found" && cacheValid(cacheRead.value, ctx) ? cacheRead.value : null;

    const api = apiFor(ctx.apiOrigin, ctx.deviceKey, ctx.appVersion);
    const body = launcherBody(ctx);
    if (bindSecret) body.bind_secret = bindSecret;
    const verdict = await api.launcher(bindSecret ? "bind" : "unlock", body);

    if (verdict.kind === "revoked" && verdict.reason === "server_bind_conflict" && device.fresh) {
      // Привязка уже сделана другим ключом, а своего у нас нет (потерян после привязки, секрет остался в папке): ключ, который мы
      // только что завели, пустой. Убираем его и остаток секрета и останавливаемся с просьбой поставить заново.
      await device.vault.remove();
      await blankBindSecret(ctx);
      return { stop: "device_key_missing", detail: "сервер ответил, что установка уже привязана другим ключом, а своего ключа нет; новый ключ убран, секрет привязки обнулён" };
    }
    if (verdict.kind === "revoked") return { revoked: verdict.reason };
    if (verdict.kind === "blocked") return { stop: verdict.reason };
    if (verdict.kind === "transient") {
      logTransient(verdict);
      if (cache) return { cache, verdict };
      return { retry: retryReasonOf(verdict) };
    }

    // kind === "ok"
    // Ключ интерфейса в ответе — ещё не доказательство, что отвечал наш сервер: у ответа «доступ есть» подписи нет.
    // Доказательство — сам интерфейс: наш ключ его открывает. Ключ, которым он не открывается, в кэш не идёт.
    if ((await pakKeyFit(ctx.layout.pakFile, verdict.pakKey)) === "wrong") {
      const cachedKey = cache ? decodePakKey(cache.pakKey) : null;
      if (cachedKey && (await pakKeyFit(ctx.layout.pakFile, cachedKey)) === "fits") {
        // Прежний ключ интерфейс открывает, значит файл цел, а не тот — ответ: работаем по кэшу, как без связи.
        logTransient({ code: UNPROVEN_KEY });
        return { cache };
      }
      // Сравнить не с чем: повреждён сам интерфейс либо ответ чужой. Кэш и секрет привязки не трогаем.
      return { stop: "web", detail: "ключ из ответа сервера не открывает интерфейс, годного ключа в кэше нет; кэш не записан" };
    }
    await writeCache(ctx, verdict);
    if (bindSecret) await removeBindSecret(ctx);
    log("info", "доступ подтверждён сервером");
    return {
      active: {
        ...Object.fromEntries(entriesOf(verdict, ["pakKey", "serial", "channels"])),
        expiresAt: now() + verdict.checkTtlSeconds * 1000,
      },
    };
  }

  // Пустой файл — не секрет: его читают как «секрета нет». Лучше пустой файл, чем оставшийся секрет при потерянном ключе.
  async function blankBindSecret(ctx) {
    try {
      await fs.rm(ctx.layout.bindFile, { force: true });
      return;
    } catch {
      // занят — пробуем обнулить
    }
    try {
      await fs.writeFile(ctx.layout.bindFile, "");
    } catch (error) {
      log("warn", "секрет привязки не обнулился", textOf(error));
    }
  }

  async function removeBindSecret(ctx) {
    let failure = null;
    for (let tries = 0; ; tries += 1) {
      try {
        await fs.rm(ctx.layout.bindFile, { force: true });
        return;
      } catch (error) {
        failure = error;
      }
      if (tries >= BIND_REMOVE_PAUSES.length) break;
      await ctx.sleep(BIND_REMOVE_PAUSES[tries]);
    }
    log("warn", "секрет привязки не стёрся", textOf(failure));
    try {
      await fs.writeFile(ctx.layout.bindFile, "");
    } catch (error) {
      log("warn", "секрет привязки не обнулился", textOf(error));
    }
  }

  async function hasUpdateMarker(root) {
    for (const name of UPDATE_MARKERS) {
      try {
        await fs.stat(win.join(root, name));
        return true;
      } catch {
        // нет папки — не признак обновления
      }
    }
    return false;
  }

  async function workByCache(ctx, cache) {
    const lastSeen = Math.max(cache.lastSeen, now());
    ctx.cacheVault.write({ ...cache, lastSeen }).catch(() => {});
    log("info", "доступ подтверждён по кэшу ключа");
    const pakKey = Buffer.from(cache.pakKey, "base64url");
    return { pakKey, serial: cache.serial, channels: cache.channels ?? [], expiresAt: cache.expiresAt };
  }

  // Полный проход с окнами «повторить».
  async function runCheck(ctx) {
    for (;;) {
      let outcome;
      try {
        outcome = await attempt(ctx);
      } catch (error) {
        log("error", "проверка доступа упала", error?.stack ?? textOf(error));
        outcome = { retry: "network" };
      }

      if (outcome.active) {
        activate(ctx, outcome.active);
        return { ok: true, active: true };
      }
      if (outcome.cache) {
        const result = await workByCache(ctx, outcome.cache);
        activate(ctx, result);
        return { ok: true, active: true };
      }
      if (outcome.revoked) return stopRevoked(outcome.revoked, ctx);
      if (outcome.stop) return blockAndExit(outcome.stop, ctx, outcome.detail ?? "");

      const choice = await showDialog(retryDialog(outcome.retry));
      if (choice !== 0) {
        session.electron.app.exit(0);
        return { ok: false, reason: "quit" };
      }
    }
  }

  // --- публичные методы ---------------------------------------------------
  function configure(options = {}) {
    const { app } = options;
    buildConfig = readBuildConfig({ app });
    return buildConfig.gate === true;
  }

  async function start(electron) {
    if (!buildConfig || !buildConfig.gate) return { ok: true, active: false };

    const app = electron.app;
    const lang = pickBetaLanguage(app.getLocale?.());
    session = { electron, lang, product: BETA_PRODUCT_NAME };

    const gates = [
      ["platform", () => platform === "win32"],
      ["build", () => Boolean(buildConfig.licensePublicKey)],
    ];
    const refused = gates.find(([, passes]) => !passes());
    if (refused) return blockAndExit(refused[0]);

    const layout = resolveLayout(app.getPath("exe"));
    if (!layout) return blockAndExit("layout");

    session.product = (branchOfRoot(layout.root) ?? DEFAULT_BRANCH).product;

    const ctx = Object.assign({ layout }, appPaths(), {
      appVersion: app.getVersion?.() ?? "",
      sleep,
    });
    return runCheck(ctx);
  }

  function stop() {
    clearTimers();
  }

  async function recheck() {
    if (!state || stopping || rechecking) return;
    rechecking = true;
    try {
      const ctx = Object.assign(
        Object.fromEntries([
          ...entriesOf(state, ["layout", "activationId", "machine", "serial", "apiOrigin", "deviceKey"]),
          ["appVersion", state.version],
        ]),
        appPaths(),
      );
      ctx.cacheVault = vaultAt(win.join(ctx.userDataPath, `beta-cache.${ctx.activationId}.bin`));
      const api = apiFor(ctx.apiOrigin, ctx.deviceKey, ctx.appVersion);
      let verdict = await api.launcher("unlock", launcherBody(ctx));

      // Интерфейс открыт и работает на нынешнем ключе. Другой ключ принимаем, только если он тоже его открывает;
      // иначе ответу верить нечем — это «не знаем»: ни состояние, ни кэш не меняются.
      if (verdict.kind === "ok" && state && !verdict.pakKey.equals(state.pakKey)) {
        if ((await pakKeyFit(ctx.layout.pakFile, verdict.pakKey)) !== "fits")
          verdict = { kind: "transient", reason: "unverified", status: 200, code: UNPROVEN_KEY };
      }

      if (verdict.kind === "revoked") {
        await stopRevoked(verdict.reason, ctx);
        return;
      }
      if (verdict.kind === "blocked") {
        await blockAndExit(verdict.reason);
        return;
      }
      if (verdict.kind === "transient") {
        logTransient(verdict);
        // пока ждали ответа, доступ мог закрыть подписанный отзыв на запросе обновителя: состояния уже нет
        if (!state || now() < state.expiresAt) return;
        const choice = await showDialog(retryDialog(retryReasonOf(verdict)));
        if (choice !== 0) {
          session.electron.app.exit(0);
          return;
        }
        rechecking = false;
        return recheck();
      }
      await writeCache(ctx, verdict);
      if (state) {
        Object.assign(state, {
          pakKey: verdict.pakKey,
          serial: verdict.serial,
          channels: verdict.channels,
          expiresAt: now() + verdict.checkTtlSeconds * 1000,
        });
      }
    } finally {
      rechecking = false;
    }
  }

  function active() {
    if (!state) return state;
    return Object.fromEntries([
      ...entriesOf(state, ["activationId", "machine"]),
      ["channel", state.channels[0] ?? "beta"],
      ["channels", [...state.channels]],
      ...entriesOf(state, ["version", "serial"]),
    ]);
  }

  async function signedFetch(pathOrUrl, init = {}) {
    if (!state || stopping) throw new Error("beta guard is not active");
    const api = apiFor(state.apiOrigin, state.deviceKey, state.version);
    const response = await api.send(pathOrUrl, init);
    if (response.ok) return response;
    const verdict = await verdictOf(response);
    // пока первый ответ уже закрывает доступ, второй застаёт пустое состояние — игнорируем
    if (verdict.kind !== "revoked" || !state || stopping) return response;
    void stopRevoked(verdict.reason, { serial: state.serial });
    return response;
  }

  function pakKey() {
    return state ? Buffer.from(state.pakKey) : null;
  }

  function createPakDecryptor(key) {
    return pakDecryptor(key);
  }

  async function loadWeb() {
    if (!state) return null;
    try {
      return await loadBundle({ pakFile: state.layout.pakFile, key: state.pakKey });
    } catch (error) {
      log("error", "интерфейс не расшифровался", textOf(error));
      await blockAndExit("web");
      return null;
    }
  }

  return { configure, start, stop, recheck, active, signedFetch, pakKey, createPakDecryptor, loadWeb };
}

export const betaGuard = createBetaGuard();
export default betaGuard;
