import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { execFile } from "node:child_process";

const exists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};
const stateDirectory = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Astral", "cache", "backups")
  : path.join(os.homedir(), ".astral", "backups");
const customFile = path.join(stateDirectory, "game-locations.json");
function classify(folder) {
  const enhanced = exists(path.join(folder, "GTA5_Enhanced.exe"));
  const legacy =
    exists(path.join(folder, "GTA5.exe")) ||
    exists(path.join(folder, "PlayGTAV.exe"));
  if (!enhanced && !legacy) return null;
  return {
    edition: enhanced ? "Enhanced" : "Legacy",
    executable: enhanced
      ? "GTA5_Enhanced.exe"
      : exists(path.join(folder, "GTA5.exe"))
        ? "GTA5.exe"
        : "PlayGTAV.exe",
  };
}
/*
 * «Вторая папка игры» Astral (задача 7): копия из жёстких ссылок или полная
 * копия с меткой `astral-linked-copy.json`. Лаунчер Rockstar её не проверяет
 * (он смотрит на свою папку), поэтому `rockstarLauncher` у неё нет.
 */
function linkedCopyOf(folder) {
  try {
    const marker = JSON.parse(
      fs.readFileSync(path.join(folder, "astral-linked-copy.json"), "utf8"),
    );
    return marker?.format === "astral.linked-copy" && marker.source
      ? {
          source: path.resolve(marker.source),
          mode: marker.mode === "copy" ? "copy" : "link",
        }
      : null;
  } catch {
    return null;
  }
}
function entry(store, folder, source, buildId, launcherState = null) {
  const type = classify(folder);
  if (!type) return null;
  const normalized = path.resolve(folder);
  const linkedCopy = linkedCopyOf(normalized);
  const hasModsFolder = exists(path.join(normalized, "mods"));
  const hasNewModsFolder = exists(path.join(normalized, "newmods"));
  const hasOpenIV = exists(path.join(normalized, "OpenIV.asi"));
  const hasOpenRPF = exists(path.join(normalized, "OpenRPF.asi"));
  const hasClosedIV = exists(path.join(normalized, "ClosedIV.asi"));
  const hasRageOpenV = exists(path.join(normalized, "RageOpenV.asi"));
  const hasDinput8 = exists(path.join(normalized, "dinput8.dll"));
  const hasXinput14 = exists(path.join(normalized, "xinput1_4.dll"));
  const hasDsound = exists(path.join(normalized, "dsound.dll"));
  const asiLoader =
    type.edition === "Enhanced"
      ? hasXinput14
        ? "xinput1_4"
        : null
      : hasDinput8
        ? "dinput8"
        : hasDsound
          ? "dsound"
          : null;
  /*
   * Чьё имя стоит в `loader`, когда плагинов архивов несколько.
   *
   * RageOpenV — первым: его требует и ставит сам Astral (`requiredLoader`), а
   * подготовка неготовой игры отказывает, если здесь стоит любое другое имя.
   * Рядом с ним часто остаётся OpenIV.asi от прежних модов, и прежний порядок
   * называл такую установку «OpenIV»: подготовка упиралась в «сторонний
   * loader», хотя нужный файл лежал на месте, и выйти можно было, только
   * удалив чужой плагин руками. Флаги `hasOpenIV`, `hasOpenRPF` и
   * `hasClosedIV` отдаются как есть — порядок решает только имя.
   */
  const loader = hasRageOpenV
    ? "RageOpenV"
    : type.edition === "Enhanced"
      ? hasOpenRPF
        ? "OpenRPF"
        : null
      : hasOpenIV
        ? "OpenIV"
        : hasClosedIV
          ? "ClosedIV"
          : null;
  /*
   * Копия из Rockstar Games Launcher (Т-98): лаунчер проверяет файлы при
   * запуске игры и возвращает изменённый update.rpf — моды Astral из него
   * пропадают. Узнаётся по тому, чего у неё нет: `steam_api64.dll` лежит у
   * копии Steam, папка `.egstore` — у копии Epic. `store` тут не помощник: он
   * говорит, где папка нашлась, а выбранная вручную всегда «Rockstar».
   */
  const rockstarLauncher =
    !linkedCopy &&
    store !== "Steam" &&
    store !== "Epic" &&
    !exists(path.join(normalized, "steam_api64.dll")) &&
    !exists(path.join(normalized, ".egstore"));
  const readinessIssues = [];
  if (launcherState?.busy) readinessIssues.push("launcher-busy");
  if (!loader)
    readinessIssues.push(
      type.edition === "Enhanced"
        ? "archive-loader-enhanced"
        : "archive-loader-legacy",
    );
  if (!asiLoader) readinessIssues.push("asi-loader");
  return {
    /* У второй папки id по отпечатку всего пути: прежний (первые девять
       байт пути) совпал бы с оригиналом рядом. */
    id: linkedCopy
      ? `copy-${createHash("sha256").update(normalized.toLowerCase()).digest("hex").slice(0, 12)}`
      : `${store.toLowerCase()}-${Buffer.from(normalized).toString("base64url").slice(0, 12)}`,
    store,
    ...type,
    path: normalized,
    source,
    buildId: buildId || null,
    launcherState,
    rockstarLauncher,
    ...(linkedCopy ? { linkedCopy } : {}),
    hasModsFolder,
    hasNewModsFolder,
    hasOpenIV,
    hasOpenRPF,
    hasClosedIV,
    hasRageOpenV,
    asiLoader,
    loader,
    requiredLoader: "RageOpenV",
    readinessIssues,
    installReadiness: launcherState?.busy
      ? "launcher-busy"
      : readinessIssues.length
        ? "needs-loader"
        : "ready",
    safetyMode: "isolated-mods",
    onlinePolicy: "follow-server-rules",
  };
}
function parseQuotedValue(text, key) {
  const match = text.match(new RegExp(`"${key}"\\s+"([^"]+)"`));
  return match?.[1];
}
/*
 * Когда Steam действительно трогает файлы игры.
 *
 * `StateFlags` — битовая маска. Раньше «занят» было всё, кроме ровно `4`
 * (установлена), и ещё любая папка `steamapps/downloading/271590`. Но
 * `6` — это «установлена, обновление в очереди»: Steam ничего не пишет,
 * пока игрок не запустит игру через него, а игроки Majestic и GTA5RP
 * запускают её лаунчером проекта — очередь висит неделями. Папка
 * скачивания остаётся после прерванного или отложенного обновления. И то,
 * и другое держало «GTA V обновляется» без конца: ждать было нечего.
 *
 * Занят — когда идёт операция (бит из маски ниже) или игра установлена не
 * целиком (нет бита 4). Пауза (512) — не операция: файлы игры Steam меняет
 * только на фиксации, а возобновление поймает предохранитель установки.
 * Без `StateFlags` в манифесте судить не о чем — не занят.
 */
const STEAM_FULLY_INSTALLED = 4;
const STEAM_OPERATION_FLAGS =
  256 | // UpdateRunning
  1024 | // UpdateStarted
  2048 | // Uninstalling
  4096 | // BackupRunning
  65536 | // Reconfiguring
  131072 | // Validating
  262144 | // AddingFiles
  524288 | // Preallocating
  1048576 | // Downloading
  2097152 | // Staging
  4194304 | // Committing
  8388608; // UpdateStopping
export function parseSteamAppState(
  text,
  { downloadDirectoryExists = false } = {},
) {
  const numeric = (key) => {
    const value = Number.parseInt(parseQuotedValue(text, key) || "", 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const stateFlags = numeric("StateFlags");
  const bytesToDownload = numeric("BytesToDownload");
  const bytesDownloaded = numeric("BytesDownloaded");
  const bytesToStage = numeric("BytesToStage");
  const bytesStaged = numeric("BytesStaged");
  const busy =
    stateFlags !== null &&
    ((stateFlags & STEAM_OPERATION_FLAGS) !== 0 ||
      (stateFlags & STEAM_FULLY_INSTALLED) === 0);
  return {
    busy,
    stateFlags,
    downloadDirectoryExists,
    phase: busy ? "launcher-operation" : "idle",
    bytesToDownload,
    bytesDownloaded,
    bytesToStage,
    bytesStaged,
  };
}
const STEAM_APPS = Object.freeze([
  ["271590", "Grand Theft Auto V"],
  ["3240220", "Grand Theft Auto V Enhanced"],
]);
const STEAM_ROOTS = Object.freeze(["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"]);
/** Установки Steam (Legacy и Enhanced) в библиотеках корней `roots`. */
export function steamCandidates(roots = STEAM_ROOTS) {
  const output = [];
  for (const root of roots) {
    const libraryFile = path.join(root, "steamapps", "libraryfolders.vdf");
    let libraries = [root];
    if (exists(libraryFile)) {
      const text = fs.readFileSync(libraryFile, "utf8");
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/g))
        libraries.push(match[1].replace(/\\\\/g, "\\"));
    }
    /* Legacy — приложение 271590, Enhanced — 3240220 (ТЗ 08.10.2026,
       задача 5): у Enhanced своя папка «Grand Theft Auto V Enhanced», и до
       08.10 Steam-версию Enhanced поиск не видел вовсе. */
    for (const library of new Set(libraries))
      for (const [appId, fallbackDir] of STEAM_APPS) {
        const manifest = path.join(
          library,
          "steamapps",
          `appmanifest_${appId}.acf`,
        );
        if (!exists(manifest)) continue;
        const text = fs.readFileSync(manifest, "utf8");
        const installDir = parseQuotedValue(text, "installdir") || fallbackDir;
        const launcherState = parseSteamAppState(text, {
          downloadDirectoryExists: exists(
            path.join(library, "steamapps", "downloading", appId),
          ),
        });
        const item = entry(
          "Steam",
          path.join(library, "steamapps", "common", installDir),
          manifest,
          parseQuotedValue(text, "buildid"),
          launcherState,
        );
        if (item) output.push(item);
      }
  }
  return output;
}
function epicCandidates() {
  const dir = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";
  if (!exists(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".item")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (
        /grand theft auto v|gtav/i.test(`${data.DisplayName} ${data.AppName}`)
      ) {
        const item = entry(
          "Epic",
          data.InstallLocation,
          path.join(dir, file),
          data.BuildVersion,
        );
        if (item) out.push(item);
      }
    } catch {}
  }
  return out;
}
/*
 * Реестр — через одну асинхронную `reg query` на ключ и с короткой памятью.
 *
 * Раньше каждое значение читалось своим синхронным `reg.exe`: три ключа × три
 * значения — девять процессов подряд, 150–350 мс, на которые главный процесс
 * вставал целиком. А зовут поиск часто: предохранитель установки — каждые
 * 750 мс, каждый редактор мастерской перед записью, окно — при каждом
 * возврате фокуса, пока игра не найдена. Всё это время окно не принимало ни
 * перетаскивания, ни ввода, ни ответов по IPC.
 *
 * Теперь ключ читается целиком одним процессом (три вместо девяти), не
 * блокируя цикл событий, и ответ живёт минуту: папки установки в реестре во
 * время сеанса не меняются. Одновременные запросы делят один вызов. Что
 * меняется на глазах — готовность папки, состояние Steam — сюда не входит и
 * читается каждый раз заново. Ручной «Искать снова» идёт мимо памяти
 * (`discoverGames({ fresh: true })`).
 */
export const REGISTRY_TTL_MS = 60_000;

/** Значения ключа из вывода `reg query <ключ>`: имя → данные. */
export function parseRegQuery(text) {
  const values = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s{2,}(REG_[A-Z_]+)(?:\s{2,}(.*))?$/);
    if (match) values.set(match[1], (match[3] ?? "").trim());
  }
  return values;
}

function runReg(args) {
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      args,
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
      /* Нет ключа — `reg` выходит с ошибкой: для поиска это «пусто», а не сбой. */
      (error, stdout) => resolve(error ? "" : stdout),
    );
  });
}

/**
 * Чтение ключей реестра с памятью. Фабрика — ради тестов: запуск `reg` и часы
 * подменяются, и память проверяется без Windows.
 */
export function createRegistryReader({
  run = runReg,
  now = () => Date.now(),
  ttlMs = REGISTRY_TTL_MS,
} = {}) {
  const cache = new Map();
  return function readKey(key, { fresh = false } = {}) {
    const hit = cache.get(key);
    if (!fresh && hit && now() - hit.at < ttlMs) return hit.values;
    const values = Promise.resolve(run(["query", key])).then(parseRegQuery);
    cache.set(key, { at: now(), values });
    return values;
  };
}

const readRegistryKey = createRegistryReader();

async function rockstarCandidates({ fresh = false } = {}) {
  const keys = [
    "HKLM\\SOFTWARE\\Rockstar Games\\Grand Theft Auto V",
    "HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\Grand Theft Auto V",
    "HKCU\\SOFTWARE\\Rockstar Games\\Grand Theft Auto V",
  ];
  const read = await Promise.all(
    keys.map((key) => readRegistryKey(key, { fresh })),
  );
  const out = [];
  keys.forEach((key, index) => {
    for (const name of [
      "InstallFolder",
      "InstallFolderSteam",
      "InstallFolderEpic",
    ]) {
      const folder = read[index].get(name);
      if (folder) {
        const item = entry("Rockstar", folder, `${key}:${name}`);
        if (item) out.push(item);
      }
    }
  });
  const defaults = [
    "C:\\Program Files\\Rockstar Games\\Grand Theft Auto V",
    "C:\\Program Files\\Rockstar Games\\Grand Theft Auto V Enhanced",
  ];
  for (const folder of defaults) {
    const item = entry("Rockstar", folder, "default-path");
    if (item) out.push(item);
  }
  return out;
}
function readCustom() {
  try {
    const data = JSON.parse(fs.readFileSync(customFile, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function writeCustom(items) {
  fs.mkdirSync(stateDirectory, { recursive: true });
  const temp = `${customFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(items, null, 2), "utf8");
  fs.renameSync(temp, customFile);
}
export function inspectGameFolder(
  folder,
  { store = "Rockstar", source = "manual" } = {},
) {
  if (!folder) return null;
  return entry(
    ["Steam", "Epic", "Rockstar"].includes(store) ? store : "Rockstar",
    folder,
    source,
  );
}
export async function addCustomInstallation(folder, store = "Rockstar") {
  const item = inspectGameFolder(folder, { store });
  if (!item)
    throw new Error(
      "В выбранной папке не найден GTA5.exe или GTA5_Enhanced.exe.",
    );
  const items = readCustom().filter(
    (current) =>
      path.resolve(current.path).toLowerCase() !== item.path.toLowerCase(),
  );
  items.push({ path: item.path, store: item.store });
  writeCustom(items);
  return item;
}
/** Убрать папку, добавленную вручную (вторая папка игры удалена). */
export async function removeCustomInstallation(folder) {
  const target = path.resolve(String(folder || "")).toLowerCase();
  const items = readCustom();
  const kept = items.filter(
    (current) => path.resolve(current.path).toLowerCase() !== target,
  );
  if (kept.length !== items.length) writeCustom(kept);
  return kept.length !== items.length;
}
/*
 * Стенд проверок (docs/windows-checks): `ASTRAL_QA_GAME_ONLY=<папка>` — Astral
 * видит ТОЛЬКО эту папку. Нужен, чтобы лаунчер, запущенный на машине с настоящей
 * игрой, не мог выбрать её: «Установить» ляжет в песочницу-копию. Слово
 * принимается, только если в пути есть `sandbox`; иначе игнорируется — этим
 * словом нельзя ни подключить настоящую игру, ни спрятать её от пользователя
 * в обычной работе (в приложении оно не задаётся).
 */
function qaGameOnly() {
  const folder = String(process.env.ASTRAL_QA_GAME_ONLY || "").trim();
  if (!folder || !/sandbox/i.test(folder)) return null;
  /* Магазин песочницы — `ASTRAL_QA_GAME_STORE` (Steam, Epic или Rockstar):
     стенд проверяет поведение Astral для каждого лаунчера. */
  const store = ["Steam", "Epic", "Rockstar"].find(
    (name) =>
      name.toLowerCase() ===
      String(process.env.ASTRAL_QA_GAME_STORE || "")
        .trim()
        .toLowerCase(),
  );
  return inspectGameFolder(folder, {
    store: store || "Rockstar",
    source: "qa-only",
  });
}
export async function discoverGames({ fresh = false } = {}) {
  const only = qaGameOnly();
  if (only) {
    /* Вторые папки этой же песочницы (задача 2 ТЗ 07.10.2026) видны тоже:
       без них стенд не проверит дубликат игры из Rockstar Games Launcher. */
    const root = path.resolve(only.path).toLowerCase();
    const copies = readCustom()
      .map((item) =>
        inspectGameFolder(item.path, { store: item.store, source: "manual" }),
      )
      .filter(
        (item) =>
          item?.linkedCopy &&
          path.resolve(item.linkedCopy.source).toLowerCase() === root,
      );
    return [only, ...copies];
  }
  if (process.platform !== "win32") return [];
  const custom = readCustom().map((item) =>
    inspectGameFolder(item.path, { store: item.store, source: "manual" }),
  );
  const all = [
    ...steamCandidates(),
    ...epicCandidates(),
    ...(await rockstarCandidates({ fresh })),
    ...custom,
  ];
  const seen = new Set();
  return all.filter(
    (item) =>
      item &&
      !seen.has(item.path.toLowerCase()) &&
      seen.add(item.path.toLowerCase()),
  );
}
export const discoveryInfo = {
  supportedStores: ["Steam", "Epic", "Rockstar"],
  home: os.homedir(),
};
