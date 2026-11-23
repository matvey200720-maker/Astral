import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { lowerBackgroundPriority } from "./child-priority.js";
import { governChild } from "./child-throttle.js";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { appPackaged, appResourcesPath } from "./runtime-paths.js";

import {
  abortedError,
  callNativeEngine,
  explainAppControlBlock,
  explainHostFailure,
  isExpectedEngineAnswer,
} from "./native-engine.js";
import { LAMP_ROUTE_SWITCHES, rustAwcInspectEnabled, rustEngineEnabled, rustLampLodEnabled, rustLampRouteEnabled, rustLampStudioEnabled, rustSoundImportEnabled, rustWeaponsMetaEnabled, rustYptInspectEnabled, rustYptTextureEnabled } from "./native-engine-rust.js";
import { rustYptCloneExportEnabled, rustYptOwnDonorEnabled, rustYptRulesEnabled } from "./native-engine-rust.js";
import { archiveSupportDirectory, configuredKeysDirectory, lastArchiveSupportFailure } from "./loader-provisioner.js";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { ensureStoredFile } from "@modovik/install-engine/chunk-store.js";
import { appLog } from "./app-log.js";
import { padComposedTail } from "./rpf-tail.js";
import { composeWithStreamShaFallback } from "./stream-sha.js";
import { describeYptFacts, explainUnreadableYpt } from "./foreign-archive.js";
import {
  readRpfEntriesWithRpf7,
  readRpfEntryWithRpf7,
} from "./rpf7-entries.js";
import { helperLook } from "./muzzle-look.js";
import { TRACER_INSTALL_UNITS_PER_METRE, normalizeTracerNearHide } from "@modovik/tracer-contract";

const dirname = path.dirname(fileURLToPath(import.meta.url));
/*
 * Потолок ответа helper'а — предохранитель от процесса, который начал сыпать
 * в stdout, а не протокол. У одного режима ответ законно большой: скан
 * звукового архива описывает каждую дорожку каждого банка, а у RESIDENT.rpf
 * их три с лишним тысячи, и общий потолок в мегабайт обрывал его — разделы
 * «Попадания», «Взрывы» и «Интерфейс» переставали открываться вовсе.
 * Поэтому потолок решает режим, а не вызывающий: правило одно и на виду.
 *
 * Так же законно велика выгрузка правил эффектов для движка частиц окна:
 * она описывает правило целиком — эволюции, домены, поведения, сетки моделей
 * частиц, — и одно только ядро с каталогом доноров весит больше семисот
 * килобайт.
 *
 * И сборка с пробой пакета текстур на всю карту (задача 1 ТЗ 05.10.2026):
 * ответ называет каждую из двадцати тысяч записей — больше мегабайта.
 */
const MAX_OUTPUT = 1024 * 1024;
const MAX_SCAN_OUTPUT = 8 * 1024 * 1024;
const LARGE_OUTPUT_MODES = new Set([
  "awc-bank-scan",
  "ypt-rule-export",
  "ypt-clone-export",
  "compose",
  "create",
  "probe",
]);

/** Сколько байт ответа этому режиму позволено. */
export function helperOutputCeiling(mode) {
  return LARGE_OUTPUT_MODES.has(String(mode || ""))
    ? MAX_SCAN_OUTPUT
    : MAX_OUTPUT;
}

async function existingFiles(candidates) {
  const found = [];
  for (const candidate of candidates) {
    try {
      const stat = await fs.lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      found.push({
        file: candidate,
        key: `${candidate}:${stat.size}:${stat.mtimeMs}`,
      });
    } catch {}
  }
  return found;
}

async function firstExisting(candidates) {
  return (await existingFiles(candidates))[0]?.file ?? null;
}

const HELPER_NAME = "modovik-rpf-helper.exe";

/*
 * Дерево разработчика: helper, собранный здесь же (`npm run rpf:build`),
 * промежуточная сборка `dotnet build` и общая для машины папка инструментов
 * Astral. Последняя заведена для ПК без .NET SDK: helper туда кладут
 * собранным в другом месте, и без него ни одна запись в RPF не работает —
 * установка мода падает первым же шагом, а не «почему-то не устанавливается».
 */
function developmentHelperCandidates() {
  return [
    path.resolve(dirname, "../../../tools/rpf-helper/publish", HELPER_NAME),
    path.resolve(
      dirname,
      "../../../tools/rpf-helper/bin/Release/net8.0",
      HELPER_NAME,
    ),
    path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "Astral",
      "tools",
      "rpf-helper",
      HELPER_NAME,
    ),
  ];
}

/*
 * Какой из них. Первый найденный — не ответ: сборка здесь устаревает с первым
 * же `git pull`, который приносит новый режим, а в общей папке лежит сборка
 * месячной давности. Прежде брался первый по списку, и редактор фонарей
 * отвечал «помощник не умеет lamp-studio-inspect», хотя рядом могла лежать
 * сборка, которая умеет. Поэтому helper'ы спрашиваются, что они умеют, и
 * берётся тот, чья опись шире (режимы идут только в прибавку); при равенстве
 * — первый по списку. Выбор помнится по отпечаткам всех файлов: пересобрали
 * helper — выберем заново, не пересобирали — не платим процессами.
 */
let developmentChoice = null;

async function chooseCapableHelper(found, identify) {
  if (found.length < 2) return found[0]?.file ?? null;
  const fingerprint = found.map((entry) => entry.key).join("|");
  if (developmentChoice?.fingerprint === fingerprint)
    return developmentChoice.executable;
  let best = null;
  for (const { file } of found) {
    const capabilities = await identify(file).catch(() => null);
    const score = capabilities?.identity
      ? (capabilities.modes?.length ?? 0) + (capabilities.features?.length ?? 0)
      : -1;
    if (!best || score > best.score) best = { file, score };
  }
  developmentChoice = { fingerprint, executable: best.file };
  return best.file;
}

export async function resolveRpfHelperExecutable({
  /* Не у Electron напрямую: в потоке чтения игры он пуст (`runtime-paths.js`). */
  packaged = appPackaged(),
  resourcesPath = appResourcesPath(),
  candidates = null,
  identify = readRpfHelperCapabilities,
} = {}) {
  if (packaged) {
    if (!path.isAbsolute(String(resourcesPath || "")))
      throw new Error(
        "Production resource path для RPF helper не подтверждён.",
      );
    return firstExisting([
      path.join(path.resolve(resourcesPath), "rpf-helper", HELPER_NAME),
    ]);
  }
  return chooseCapableHelper(
    await existingFiles(candidates || developmentHelperCandidates()),
    identify,
  );
}

async function helperExecutable() {
  return resolveRpfHelperExecutable();
}

/*
 * ЧТО ЭТОТ HELPER УМЕЕТ
 *
 * Helper и приложение обновляются порознь. Его кладут в общую папку
 * инструментов (`%LOCALAPPDATA%\Astral\tools\rpf-helper`) один раз — на машине
 * без .NET SDK это единственный способ его получить, — и через полгода
 * приложение просит у него режим, которого в нём ещё нет. Старый helper на это
 * отвечает «Unsupported RPF helper mode», и человек видит это в редакторе
 * звука: строку, по которой не понять ни что сломалось, ни что делать.
 *
 * Поэтому перед первой операцией helper спрашивается, что он умеет. Ответ
 * кэшируется по пути и отпечатку файла: подменили helper — спросим заново,
 * не подменили — не платим процессом за каждый вызов.
 *
 * Helper старше самого опроса (`--identity` в нём ещё нет) узнаётся по тому,
 * что он читает stdin и падает на пустом JSON. Это тоже ответ: «слишком
 * старый», и он называется словами.
 */
const IDENTITY_TIMEOUT_MS = 30_000;
/*
 * По одной записи на файл: в дереве разработчика helper'ов бывает три.
 * Удачный ответ помнится, пока файл тот же. Неудача — несколько секунд: Windows
 * может пропустить свежий файл со временем (политика управления приложениями),
 * и отказ, застрявший до перезапуска, держал бы человека в тупике, когда
 * помощник уже запускается.
 */
const IDENTITY_FAILURE_TTL_MS = 5_000;
const identityCache = new Map();

/*
 * Ответ `--identity` — `{ identity, failure }`. Почему helper промолчал,
 * помнится: «старый» и «не запустился» лечатся по-разному, а прежний `null`
 * называл оба «помощник старше приложения» (бета 14.10.2026: Windows не дала
 * загрузить свежий .dll помощника, и человек читал про устаревшую сборку).
 */
function runHelperIdentity(executable) {
  return new Promise((resolve) => {
    const child = spawn(executable, ["--identity"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (identity, failure = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ identity, failure });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null, { kind: "timeout" });
    }, IDENTITY_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 64 * 1024) {
        child.kill();
        finish(null, { kind: "overflow" });
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8 * 1024) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) =>
      finish(null, { kind: "spawn", code: error?.code, message: error?.message }),
    );
    child.once("close", (code) => {
      if (code !== 0) return finish(null, { kind: "exit", code, stderr });
      try {
        const parsed = JSON.parse(stdout);
        if (parsed?.status === "ready") finish(parsed);
        else finish(null, { kind: "answer", stderr });
      } catch {
        finish(null, { kind: "answer", stderr });
      }
    });
    /* Старый helper ждёт запрос в stdin: закрываем поток сразу, иначе он
       висит до таймаута вместо того, чтобы честно упасть. */
    child.stdin.end();
  });
}

/** Опись helper'а: путь, отпечаток и список режимов (или `null` у старого). */
export async function readRpfHelperCapabilities(executable) {
  const stat = await fs.stat(executable);
  const key = `${stat.size}:${stat.mtimeMs}`;
  const cached = identityCache.get(executable);
  if (cached?.key === key && (!cached.expires || cached.expires > Date.now()))
    return cached.value;
  const { identity, failure } = await runHelperIdentity(executable);
  const value = {
    executable,
    identity,
    /* Почему промолчал (`null`, если ответил): см. `helperUnavailableError`. */
    failure,
    modes: Array.isArray(identity?.modes) ? identity.modes : null,
    /* Возможности внутри режимов: helper, не знающий про слои клонов, принял
       бы заказ с ними молча и собрал бы один слой. Сборка без списка — старше
       самих возможностей, для неё список пуст. */
    features: Array.isArray(identity?.features) ? identity.features : [],
  };
  identityCache.set(executable, {
    key,
    value,
    expires: identity ? 0 : Date.now() + IDENTITY_FAILURE_TTL_MS,
  });
  return value;
}

/**
 * Возможности helper'а внутри режимов — по имени, словами отказа.
 *
 * Отказ здесь называет, чего helper не умеет, и что делать; `null` — helper
 * не найден вовсе, и об этом скажет сама операция, которой он нужен.
 */
export async function assertRpfHelperFeatures(features) {
  const wanted = [...new Set(features || [])];
  if (!wanted.length) return;
  const executable = await helperExecutable();
  if (!executable) return;
  const capabilities = await readRpfHelperCapabilities(executable);
  /* Не ответил вовсе — это не «нет возможности», а «не запустился» или «очень
     старый»: словами, которые различают. */
  if (!capabilities.identity)
    throw helperUnavailableError(
      executable,
      capabilities.failure,
      wanted.join("», «"),
    );
  const missing = wanted.filter(
    (feature) => !capabilities.features.includes(feature),
  );
  if (missing.length)
    throw new Error(
      `Встроенный помощник Astral не умеет «${missing.join("», «")}» — он старше приложения. ` +
        "Обновите Astral; если помощник лежит отдельно в " +
        "%LOCALAPPDATA%\\Astral\\tools\\rpf-helper, замените его на свежий (npm run rpf:build).",
    );
}

/** Человеческое объяснение, почему этот helper не потянет этот режим. */
export function staleHelperMessage(mode) {
  return (
    `Встроенный помощник Astral не умеет «${mode}» — он старше приложения. ` +
    "Обновите Astral; если помощник лежит отдельно в " +
    "%LOCALAPPDATA%\\Astral\\tools\\rpf-helper, замените его на свежий."
  );
}

/** Помощник не поднялся: слова для человека, в скобках — что он сказал сам. */
export function helperStartMessage(detail) {
  return (
    "Встроенный помощник Astral не запустился: его файлы не загрузились или он не ответил. " +
    "Перезапустите Astral; не помогло — переустановите Astral или добавьте его папку в исключения антивируса. " +
    `(${detail})`
  );
}

/* Так .NET и его загрузчик сообщают, что программа не поднялась вовсе. */
const STARTUP_CRASH =
  /Unhandled exception\.|Could not load file or assembly|FileLoadException|FileNotFoundException|BadImageFormatException|DllNotFoundException|You must install \.NET|hostfxr|hostpolicy/i;

/**
 * Что сказать, когда helper не ответил на `--identity`.
 *
 * Три разных причины, три разных совета. Windows не дала загрузить файл
 * (политика управления приложениями) — человеку нужна она, а не «обновите».
 * Помощник не запустился по другой причине — перезапуск или переустановка.
 * И только помощник, который запустился, но опроса не знает (сборка старше
 * 21.08.2026), — действительно «старше приложения».
 */
export function helperUnavailableError(executable, failure, mode) {
  const file = path.basename(String(executable || "")) || HELPER_NAME;
  const raw = [failure?.message, failure?.stderr]
    .filter(Boolean)
    .join(" ")
    .trim();
  const blocked = explainAppControlBlock(raw, { file });
  if (blocked) return blocked;
  const failed =
    failure?.kind === "timeout" ||
    failure?.kind === "spawn" ||
    STARTUP_CRASH.test(String(failure?.stderr || ""));
  if (!failed) return new Error(staleHelperMessage(mode));
  const detail =
    raw.replace(/\s+/g, " ").slice(0, 300) ||
    `не ответил за ${IDENTITY_TIMEOUT_MS / 1000} с`;
  return new Error(helperStartMessage(detail));
}

/*
 * Ответ helper'а о неизвестном режиме — техника. Она приходит и от тех
 * сборок, что про свои режимы молчат, и переводить её надо там же, где
 * переводится всё остальное: на выходе из процесса.
 */
const UNSUPPORTED_MODE = /Unsupported RPF helper mode/i;

/**
 * Годится ли helper для этого режима.
 *
 * Два уверенных отказа. Helper назвал свои режимы, и этого среди них нет —
 * отказ. Helper вовсе не отвечает на `--identity` — тоже отказ: опрос
 * появился раньше любого режима, добавленного после него, и «не отвечает»
 * значит «старше их всех». Неуверенности здесь не остаётся, а сборка, которая
 * отвечает, но списка ещё не несёт, идёт дальше — её ответ переводится на
 * выходе.
 */
/* Режимы, которые пишут архив, и возможности, без которых им нельзя. */
const WRITING_MODES = new Set(["compose", "create"]);
export const LOWERCASE_NAMES_FEATURE = "rpf-lowercase-names";
/*
 * Хранение записей, как у игры: прежний helper сжимал всё подряд, и банк
 * weapons.awc (19 МБ) переполнял 24-битное поле оглавления — GTA V падала на
 * загрузке с ERR_GEN_ZLIB_2 («Ошибка вызова zlib»).
 */
export const GAME_STORAGE_FEATURE = "rpf-game-storage";
const WRITING_FEATURES = [LOWERCASE_NAMES_FEATURE, GAME_STORAGE_FEATURE];
/*
 * Банк звука и слот памяти игры: helper меряет таблицу дорожек, служебные
 * чанки и конец данных собранного банка и не отдаёт банк больше слота
 * (`wave-slots.js`). Прежний собирал «на глаз», и служебные чанки банка
 * collision выходили за слот на 4 байта.
 */
export const AWC_SLOT_BUDGET_FEATURE = "awc-slot-budget";
/*
 * Фонари: стекло лампы перекрашивается в цвет света той же правкой модели,
 * а огни вдали радуги красятся по подписи лампы. Прежний helper принял бы
 * такой заказ и молча оставил бы оранжевое стекло и одноцветные огни.
 */
export const LAMP_GLASS_FEATURE = "lamp-studio-glass-texture";
export const LAMP_LOD_PALETTE_FEATURE = "lamp-studio-lod-palette";
/* Режимы, которые пишут, и возможности, без которых им нельзя. */
const MODE_FEATURES = new Map([
  ...[...WRITING_MODES].map((mode) => [mode, WRITING_FEATURES]),
  ["awc-stream-patch", [AWC_SLOT_BUDGET_FEATURE]],
  ["lamp-studio-patch", [LAMP_GLASS_FEATURE]],
  ["lamp-studio-lod", [LAMP_LOD_PALETTE_FEATURE]],
]);

async function assertHelperSupports(executable, mode) {
  const { identity, modes, features, failure } =
    await readRpfHelperCapabilities(executable);
  if (!identity) throw helperUnavailableError(executable, failure, mode);
  if (modes && !modes.includes(String(mode || "compose")))
    throw new Error(staleHelperMessage(mode));
  /*
   * Сборка архива — только helper'ом, который пишет имена строчными и
   * записи так, как их хранит игра, и сверяет результат так, как его
   * прочтёт игра. Прежний оставил бы папку `x64/Astral` как есть (игра
   * падала с ERR_SYS_FILELOAD) или сжал бы большой банк звука мимо поля
   * оглавления (ERR_GEN_ZLIB_2), хотя установка прошла бы «успешно».
   */
  const missing = (MODE_FEATURES.get(String(mode || "compose")) || []).filter(
    (feature) => !features.includes(feature),
  );
  if (missing.length)
    throw new Error(
      `Встроенный помощник Astral не умеет «${missing.join("», «")}» — он старше приложения. ` +
        "Обновите Astral; если помощник лежит отдельно в " +
        "%LOCALAPPDATA%\\Astral\\tools\\rpf-helper, замените его на свежий (npm run rpf:build).",
    );
}

export async function getRpfHelperIdentity() {
  const executable = await helperExecutable();
  if (!executable)
    throw new Error("RPF helper не найден в production resource path.");
  const bytes = await fs.readFile(executable);
  return {
    executable,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const LEGACY_ARCHIVE_KEY_HASHES = Object.freeze({
  aesSha256: "1bc7625fc374717d47fa98c801562180873294a9d9de9eedb18876a208afe077",
  ngKeysSha256:
    "3c956b6220627e4350fc9a4f6da1c0269a7aac180093992296c892de5057dcf2",
  ngDecryptTablesSha256:
    "d6fbef9059284a68f617824ea188c74eae11b89f43c68580290f99ce75bb5fee",
  ngEncryptTablesSha256:
    "976be018215b661872fad6ea42b16d88bf855d72919a537b3bc21685907d909e",
  ngEncryptLutsSha256:
    "2a99d2bb3462399348e6ff9aec942493c5edd5745f459993c46659cf28d197b8",
  lutSha256: "6590a782f6ad62e59d2f41204eb394a2671398509260b7cd9a368d0d9c832010",
});
const ARCHIVE_FIX_SHA256 =
  "83468b4f222ae516fa288f4cc3701950ef6b6a6af23f15dc676b915773941575";

async function sha256(file) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

async function localVerifiedArchiveToolchain() {
  /* Каталог ключей — общее место `loader-provisioner.js` (`MODOVIK_RPF_KEYS_DIR` у стендов, вне упакованной сборки; иначе набор в профиле). */
  const directory = configuredKeysDirectory();
  const configured = directory ? path.resolve(directory) : null;
  const discovered =
    configured ||
    (await firstExisting([
      path.join(archiveSupportDirectory(), "gtav_aes_key.dat"),
      path.join(
        os.homedir(),
        "Desktop",
        "RPF Explorer Portable",
        "gta-v-archive-fix-main",
        "Main",
        "bin",
        "Release",
        "net48",
        "gtav_aes_key.dat",
      ),
    ]));
  if (!configured && !discovered) return null;
  const resolvedDirectory = configured || path.dirname(discovered);
  const configuredHashes = {
    aesSha256: String(process.env.MODOVIK_RPF_AES_SHA256 || "").trim(),
    ngKeysSha256: String(process.env.MODOVIK_RPF_NG_KEYS_SHA256 || "").trim(),
    ngDecryptTablesSha256: String(
      process.env.MODOVIK_RPF_NG_TABLES_SHA256 || "",
    ).trim(),
    ngEncryptTablesSha256: String(
      process.env.MODOVIK_RPF_NG_ENCRYPT_TABLES_SHA256 || "",
    ).trim(),
    ngEncryptLutsSha256: String(
      process.env.MODOVIK_RPF_NG_ENCRYPT_LUTS_SHA256 || "",
    ).trim(),
    lutSha256: String(process.env.MODOVIK_RPF_LUT_SHA256 || "").trim(),
  };
  const values = {
    directory: resolvedDirectory,
    ...(configured ? configuredHashes : LEGACY_ARCHIVE_KEY_HASHES),
  };
  const hashes = Object.entries(values).filter(
    ([name]) => name !== "directory",
  );
  if (hashes.some(([, value]) => !/^[a-f0-9]{64}$/i.test(value))) {
    throw new Error(
      "Локальный набор RPF-ключей требует закреплённые SHA-256 всех файлов.",
    );
  }
  const configuredArchiveFix = String(
    process.env.MODOVIK_ARCHIVE_FIX_PATH || "",
  ).trim();
  const archiveFixExecutable = configuredArchiveFix
    ? path.resolve(configuredArchiveFix)
    : path.join(resolvedDirectory, "ArchiveFix.exe");
  let verifiedArchiveFix = null;
  try {
    if ((await sha256(archiveFixExecutable)) === ARCHIVE_FIX_SHA256) {
      verifiedArchiveFix = archiveFixExecutable;
    }
  } catch {}
  return { keys: values, archiveFixExecutable: verifiedArchiveFix };
}

/*
 * Helper'ы идут по одному. Два процесса разом читают ключи ArchiveFix, и
 * один из них падает «file is being used by another process» — так упал
 * живой прогон, когда скан и превью пришли внахлёст. Очередь дешевле
 * любой блокировки: helper и так занимает процессор целиком.
 */
let helperQueue = Promise.resolve();
const settled = () => {};

/**
 * Ход в очереди helper'ов. Очередь ждёт конец хода, а не держит его ответ
 * (ОЗУ, бета 15.10.2026): прежний `turn.catch(() => {})` хранил разобранный
 * ответ последнего helper'а — выгрузку правил ядра, опись сборки, до 8 МБ
 * JSON — в главном процессе до следующего вызова, то есть и в простое.
 */
export function queueHelperTurn(task) {
  const turn = helperQueue.then(task);
  helperQueue = turn.then(settled, settled);
  return turn;
}

/*
 * РАЗБОР ГОТОВОГО ФАЙЛА ИДЁТ РЯДОМ С ОЧЕРЕДЬЮ
 *
 * Очередь выше стоит из-за ключей: helper, которому нужен архив, читает
 * набор ArchiveFix, а без набора пишет кэш ключей игры. Разбор уже
 * извлечённого ядра (`ypt-inspect`, `ypt-rule-export`) ключей не касается
 * вовсе — helper поднимает их только для режимов с архивом (`selfContained`
 * в Program.cs). В общей очереди такой разбор просто ждал: база эффектов
 * разбирает ядро пятью запусками по секунде, и шли они друг за другом.
 *
 * Рядом идут не больше двух разом: helper занимает ядро процессора целиком,
 * а остальные нужны окну. Без ключей эти режимы работают только у helper'а,
 * который знает `ypt-rule-export` (с 24.09.2026; `ypt-inspect` перестал брать
 * ключи ещё 02.09) — более старая сборка идёт общей очередью, как раньше.
 */
const SIDE_LANE_MODES = new Set(["ypt-inspect", "ypt-rule-export"]);
const SIDE_LANE_LIMIT = 2;
let sideLaneBusy = 0;
const sideLaneWaiting = [];

async function sideLaneOpen(mode) {
  if (!SIDE_LANE_MODES.has(mode)) return false;
  try {
    const executable = await helperExecutable();
    if (!executable) return false;
    const { modes } = await readRpfHelperCapabilities(executable);
    return Array.isArray(modes) && modes.includes("ypt-rule-export");
  } catch {
    return false;
  }
}

async function runOnSideLane(request) {
  /* Место освобождается прямо ждущему, а не в общий счёт: иначе новый
     запуск успевал бы занять его раньше, и разом шло бы три. */
  if (sideLaneBusy >= SIDE_LANE_LIMIT)
    await new Promise((resolve) => sideLaneWaiting.push(resolve));
  else sideLaneBusy += 1;
  try {
    return await runRpfHelperNow(request);
  } finally {
    const next = sideLaneWaiting.shift();
    if (next) next();
    else sideLaneBusy -= 1;
  }
}

async function runRpfHelper(request) {
  /* Основа и сборка могут лежать кусками (`chunk-store.js`): помощнику нужен файл. */
  if (request?.baseArchive) await ensureStoredFile(request.baseArchive, { signal: request.signal ?? null });
  if (await sideLaneOpen(request.mode)) return runOnSideLane(request);
  return queueHelperTurn(() => runRpfHelperNow(request));
}

/*
 * Кто пишет сборку: Rust-движок (по умолчанию) или .NET-помощник.
 *
 * Новый вложенный архив движок создаёт с корнем, названным по файлу (`compose.rs`), и после ArchiveFix смещение имени корня остаётся за
 * последним именем (контейнер `astral_majestic.rpf`, 25.10.2026: 194 записи, смещение 4852 при 4851 знаках имён; строгий читатель `rpf7` такой
 * корень отвергает). Помощник пишет корень на нуле, как архивы игры и рабочие DLC-контейнеры Astral. Поэтому запрос, которому придётся
 * создать вложенный архив — контейнер слоя `x64/astral/*.rpf`, поток пакета дополнения в новом хосте, — идёт помощнику; правка вложенного
 * архива, что уже лежит в основе, остаётся движку: он переписывает корень с нулевым смещением. Запрос с `writer` решает сам: `"helper"` или
 * `"engine"`.
 *
 * 14.11.2026: корень нового вложенного архива движок теперь пишет без имени, на нулевом смещении (`compose.rs`, `container_slot`), но
 * правило оставлено — по замеру на тестовом ПК. Сборка `update.rpf` с новым контейнером: набор эффектов — помощник 8,8 с, движок 15,2 с
 * (запись 7,6 с и отпечаток 4,3 с против 2,0 и 2,1 с у сборки без вложенных правок); набор «Вода» — помощник 20,5 с, движок 18,0 с. Движок
 * пишет изменённый вложенный архив дважды (во временный файл, потом во внешний) и дважды считает отпечаток. Снять правило, когда этот путь
 * станет не медленнее помощника (`scripts/probe-install-speed.mjs --sample` печатает время сборки и фазы движка).
 */
export const composesOnEngine = (request, env = process.env) => request?.writer !== "helper" && composeOnEngine(request?.mode, env);

/** Пути вложенных архивов (`…rpf`), куда запрос что-то кладёт: строчными, от внешнего к внутреннему, без повторов. */
export function nestedWriteTargets(operations) {
  const targets = new Set();
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (operation?.action === "delete") continue;
    const parts = String(operation?.entry || "")
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean);
    for (let index = 0; index < parts.length - 1; index += 1)
      if (/\.rpf$/i.test(parts[index])) targets.add(parts.slice(0, index + 1).join("/").toLowerCase());
  }
  return [...targets];
}

/** Записи основы без вложенных архивов (только оглавление): пути строчными. */
async function listBaseEntries(archivePath) {
  const keys = await keysFromDirectory(archiveSupportDirectory()).catch(() => null);
  const archive = await openRpfFile(archivePath, { keys, nested: false });
  try {
    return new Set(archive.entries.map((entry) => String(entry.path).replaceAll("\\", "/").toLowerCase()));
  } finally {
    await archive.close?.();
  }
}

/** `"engine"` или `"helper"`: кто пишет этот запрос (см. выше). Не прочитанная основа — прежнее поведение, движок. */
export async function chooseComposeWriter(request, { env = process.env, listEntries = listBaseEntries } = {}) {
  if (request?.writer === "helper") return "helper";
  if (!composeOnEngine(request?.mode, env)) return "helper";
  if (request.writer === "engine") return "engine";
  if (request.mode !== "compose" && request.mode !== "create") return "engine";
  const targets = nestedWriteTargets(request.operations);
  if (!targets.length) return "engine";
  /* Дозапись (`catalog-append.js`, слово `container`): новый контейнер слоя в хвост файла пишет движок. Полный путь признака не несёт. */
  if (request.appendCreates === true && request.mode === "compose") return "engine";
  if (request.mode === "create" || !request.baseArchive) return "helper";
  try {
    const present = await listEntries(request.baseArchive);
    return targets.some((target) => !present.has(target)) ? "helper" : "engine";
  } catch {
    return "engine";
  }
}

/*
 * stderr помощника — в сообщение ошибки, которое попадает в журнал приложения: коротко и без путей.
 * Пути (`диск:\…`, `\\сервер\…`, `/…/…`) заменяются на «<путь>»: в них имя профиля, папка ключей и игры.
 */
const HELPER_STDERR_LIMIT = 400;
export function sanitizeHelperStderr(text) {
  const clean = String(text ?? "")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>|*?]*/g, "<путь>")
    .replace(/(?<![\w.])\/(?:[\w.-]+\/)+[\w.-]*/g, "<путь>")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > HELPER_STDERR_LIMIT ? `${clean.slice(0, HELPER_STDERR_LIMIT)}…` : clean;
}

/** Код выхода — к сообщению, если помощник сам его не назвал. */
export function withHelperExitCode(message, code) {
  const text = String(message ?? "");
  return /(?:с кодом|exit code|code)\s+\d+/i.test(text) ? text : `${text} (код выхода помощника: ${code})`;
}

async function runRpfHelperNow(request) {
  if ((await chooseComposeWriter(request)) === "engine") return runComposeOnEngine(request);
  if (ytdOnEngine(request)) return runYtdOnEngine(request);
  /* `ypt-patch` берёт весь запрос режима `ypt-texture-patch` и стоит раньше прежнего писателя текстур. */
  const rulesResult = await tryYptRulesOnEngine(request);
  if (rulesResult) return rulesResult;
  const engineResult = await tryYptTextureOnEngine(request);
  if (engineResult) return engineResult;
  const cloneExportResult = await tryYptCloneExportOnEngine(request);
  if (cloneExportResult) return cloneExportResult;
  const ownDonorResult = await tryYptOwnDonorOnEngine(request);
  if (ownDonorResult) return ownDonorResult;
  const lampResult = await tryLampOnEngine(request);
  if (lampResult) return lampResult;
  const executable = await helperExecutable();
  if (!executable) {
    throw new Error(
      "RPF helper не собран. Выполните npm run rpf:build и перезапустите Astral.",
    );
  }
  /* До ключей и до архива: режим, которого helper не знает, стоит отвергнуть
     сразу и словами, а не через минуту непонятной строкой. */
  await assertHelperSupports(executable, request.mode ?? "compose");
  if (!path.isAbsolute(String(request.gameRoot || "")))
    throw new Error("Папка GTA V для пересборки RPF не подтверждена.");
  const gameExecutable = await firstExisting([
    path.join(request.gameRoot, "GTA5_Enhanced.exe"),
    path.join(request.gameRoot, "GTA5.exe"),
    path.join(request.gameRoot, "PlayGTAV.exe"),
  ]);
  if (!gameExecutable)
    throw new Error(
      "Исполняемый файл GTA V для подготовки RPF-ключей не найден.",
    );
  /* `writer` — выбор исполнителя здесь, помощнику он не нужен. */
  const { signal = null, writer: _writer, ...composeRequest } = request;
  const ceiling = helperOutputCeiling(composeRequest.mode);
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Установка отменена пользователем.", "AbortError");
  }
  const toolchain = await localVerifiedArchiveToolchain();
  const keys = composeRequest.keys ?? toolchain?.keys ?? null;
  const archiveFixExecutable =
    composeRequest.archiveFixExecutable ??
    toolchain?.archiveFixExecutable ??
    null;
  if (
    ["compose", "create"].includes(String(composeRequest.mode || "")) &&
    !archiveFixExecutable
  ) {
    /* Почему набор не поставился, помнит поставка: без этого человек видит
       «не прошёл проверку» и не знает, сеть это или антивирус. */
    const reason = lastArchiveSupportFailure("full")?.message;
    throw new Error(
      "ArchiveFix.exe не установлен или не прошёл проверку SHA-256. Выполните подготовку GTA в Astral." +
        (reason ? ` Причина: ${reason}` : ""),
    );
  }
  const payload = {
    ...composeRequest,
    gameExecutable,
    keys,
    archiveFixExecutable,
  };
  return runHelperChild(executable, payload, { signal, ceiling });
}

/*
 * Один запуск помощника: JSON запроса — в stdin, ответ — из stdout. Вынесено, чтобы поддельный помощник
 * (`args` — для `node -e`) проходил в тесте тот же путь, что настоящий.
 */
export function runHelperChild(executable, payload, { signal = null, ceiling = 1024 * 1024, args = [] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    /* Сборка архива — фон: процессор уступается игре и браузеру, а ArchiveFix у помощника наследует приоритет (`child-priority.js`). */
    lowerBackgroundPriority(child);
    /* Регулятор диска: помощник потолков не слышит, его темп задаётся кругом «работа / стоит» (`child-throttle.js`); регулятор выключен — ничего. */
    governChild(child);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout = null;
    const abort = () => {
      child.kill();
      finish(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("Установка отменена пользователем.", "AbortError"),
      );
    };
    const finish = (error, result = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    signal?.addEventListener("abort", abort, { once: true });
    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > ceiling) {
        child.kill();
        finish(new Error("RPF helper вернул слишком большой ответ."));
        return current;
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    /* Windows, не давшая открыть сам файл, говорит «spawn UNKNOWN». */
    child.once("error", (error) =>
      finish(
        explainAppControlBlock(error, { file: path.basename(executable) }) ||
          error,
      ),
    );
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        let message = stderr.trim() ? sanitizeHelperStderr(stderr) : `RPF helper завершился с кодом ${code}.`;
        let detail = "";
        try {
          const parsed = JSON.parse(stderr);
          /* Структурный отказ помощника — как был, с путями (по ним видно, какой файл занят); чистится только сырой stderr. */
          message = parsed.error || message;
          detail = typeof parsed.detail === "string" ? parsed.detail : "";
        } catch {}
        /* Стек помощника — в «Логи», не в окно (бета 14.10: голое «Exception of type
           'System.Exception' was thrown» у мини-карты без зацепки, где упало). */
        if (detail)
          appLog.record({
            level: "warn",
            source: "rpf-helper",
            message: `${payload.mode ?? "compose"}: ${message}`,
            detail,
          });
        message = withHelperExitCode(explainBareHelperException(message, detail), code);
        /* Сборка, которая про свои режимы молчит, узнаётся только отсюда:
           её техническое «Unsupported RPF helper mode» переводится в то же
           объяснение, что и отказ на входе. */
        /* Занятый архив (.NET: «being used by another process») — словами:
           кто его держит, человек знает лучше приложения (фикс 1 ТЗ 07.10). */
        finish(
          explainHostFailure(
            new Error(
              UNSUPPORTED_MODE.test(message)
                ? staleHelperMessage(payload.mode ?? "compose")
                : message,
            ),
          ),
        );
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.status !== "ready")
          throw new Error("RPF helper не подтвердил готовность архива.");
        finish(null, result);
      } catch (error) {
        finish(new Error(`Некорректный ответ RPF helper: ${error.message}`));
      }
    });
    timeout = setTimeout(
      () => {
        child.kill();
        finish(new Error("RPF helper превысил лимит времени пересборки."));
      },
      10 * 60 * 1000,
    );
    /* Помощник, вышедший раньше, чем прочёл запрос, закрывает канал: EPIPE не отказ, решает код выхода. */
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

/*
 * Сборка модов каталога (`compose`/`create`) идёт в Rust-движке (`compose-rpf`, фаза 7А
 * плана переписи). Помощник `ComposeAsync` остаётся запасным путём: переменная
 * ASTRAL_RPF_COMPOSE=helper или движок выключен (ASTRAL_RUST_ENGINE=off).
 */
/*
 * Режимы помощника, которые идут в Rust-движок (фаза 7А плана переписи): запись (compose, create)
 * и проверка без записи (probe). Запасной путь помощника — переменная ASTRAL_RPF_COMPOSE=helper
 * (для записи) или ASTRAL_RPF_HELPER_MODES=probe,… (любой режим по имени).
 */
const ENGINE_MODES = new Set(["compose", "create", "probe", "search", "extract", "extract-many", "ytd-inspect"]);
const helperModesFrom = (env) =>
  new Set(
    String(env.ASTRAL_RPF_HELPER_MODES || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
export function composeOnEngine(mode, env = process.env) {
  const name = String(mode || "");
  if (!ENGINE_MODES.has(name)) return false;
  if (WRITING_MODES.has(name) && String(env.ASTRAL_RPF_COMPOSE || "").trim().toLowerCase() === "helper")
    return false;
  if (helperModesFrom(env).has(name)) return false;
  return rustEngineEnabled(env);
}

async function runComposeOnEngine(request) {
  const { signal = null, ...composeRequest } = request;
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Установка отменена пользователем.", "AbortError");
  }
  if (!path.isAbsolute(String(composeRequest.gameRoot || "")))
    throw new Error("Папка GTA V для пересборки RPF не подтверждена.");
  const gameExecutable = await firstExisting([
    path.join(composeRequest.gameRoot, "GTA5_Enhanced.exe"),
    path.join(composeRequest.gameRoot, "GTA5.exe"),
    path.join(composeRequest.gameRoot, "PlayGTAV.exe"),
  ]);
  if (!gameExecutable)
    throw new Error(
      "Исполняемый файл GTA V для подготовки RPF-ключей не найден.",
    );
  const toolchain = await localVerifiedArchiveToolchain();
  const keys = composeRequest.keys ?? toolchain?.keys ?? null;
  const archiveFix =
    composeRequest.archiveFixExecutable ??
    toolchain?.archiveFixExecutable ??
    null;
  if (!archiveFix) {
    const reason = lastArchiveSupportFailure("full")?.message;
    throw new Error(
      "ArchiveFix.exe не установлен или не прошёл проверку SHA-256. Выполните подготовку GTA в Astral." +
        (reason ? ` Причина: ${reason}` : ""),
    );
  }
  /* Запрос файлом: операций бывает сотни тысяч, в командной строке они не уместятся.
     Файл лежит рядом с выходом и удаляется после ответа. */
  const outputDirectory = path.dirname(path.resolve(composeRequest.outputArchive));
  const token = randomUUID();
  const requestFile = path.join(outputDirectory, `.astral-compose-request-${token}.json`);
  /* Промежуточная сборка — в папке, которую знает и JS: отмена убирает её вместе с процессом. */
  const stagingDirectory = path.join(outputDirectory, `.astral-compose-${token}`);
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    requestFile,
    JSON.stringify({ mode: "compose", ...composeRequest, keys: undefined, stagingDirectory }),
  );
  try {
    /* Отмена во время сборки убивает процесс движка (`executeNativeHost`), а не ждёт конца. */
    const compose = () =>
      callNativeEngine(
        "compose-rpf",
        {
          requestFile,
          baseArchive: composeRequest.baseArchive ?? null,
          gameRoot: composeRequest.gameRoot,
          keys: typeof keys === "string" ? keys : (keys?.directory ?? null),
          archiveFix,
        },
        { signal },
      );
    /* Отпечаток по ходу записи (`stream-sha.js`): отказ проверки результата — та же сборка прежним порядком и строка в журнале.
       Вторые шаги установки (`commit`, `discard`) архив не собирают и не повторяются. */
    const secondStep = typeof composeRequest.install?.commit === "string" || typeof composeRequest.install?.discard === "string";
    const fallback = {
      beforeRetry: () => fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {}),
      note: (error) =>
        appLog.record({
          level: "warn",
          source: "install",
          message: `Сборка ${path.basename(String(composeRequest.outputArchive || ""))} с отпечатком по ходу записи отказана проверкой результата (${String(error?.message || error).slice(0, 200)}): отпечаток по ходу записи выключен до перезапуска, сборка повторяется прежним порядком.`,
        }),
    };
    const result = secondStep ? await compose() : await composeWithStreamShaFallback(compose, fallback);
    /* Установка в два шага (`install.hold` / `commit` / `discard`, `INSTALL-RUST-HOLD.md`): первый шаг отвечает «удержан», отказ —
       «убрано». Что ответ шага тот, которого ждали, сверяет вызывающий (`transactions.js`): прежний движок на `hold` ответил бы «готово». */
    const answers = new Set(["ready"]);
    if (composeRequest.install?.hold === true) answers.add("held");
    if (typeof composeRequest.install?.discard === "string") answers.add("discarded");
    if (!answers.has(result?.status))
      throw new Error("RPF engine не подтвердил готовность архива.");
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    /* Код отказа движка (`HoldBusy`, `StageChanged`…) нужен вызывающему и после перевода ошибки в слова. */
    const explained = explainHostFailure(error);
    if (error?.engineCode && explained && typeof explained === "object" && !explained.engineCode) explained.engineCode = error.engineCode;
    throw explained;
  } finally {
    await fs.rm(requestFile, { force: true }).catch(() => {});
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * Правка словарей текстур Legacy (`ytd-texture-patch`, `ytd-texture-set`) идёт в Rust-движке
 * (фаза 7Б плана переписи). У помощника остаются Enhanced, DXT1→DXT5 (`alphaFormat`: движок
 * это пока не умеет) и переменная ASTRAL_YTD_WRITE=helper.
 */
const YTD_ENGINE_MODES = new Set(["ytd-texture-patch", "ytd-texture-set"]);

export function ytdOnEngine(request, env = process.env) {
  if (!YTD_ENGINE_MODES.has(String(request?.mode || ""))) return false;
  if (request.edition !== "Legacy") return false;
  if (String(env.ASTRAL_YTD_WRITE || "").trim().toLowerCase() === "helper") return false;
  if ((request.texturePatches ?? []).some((patch) => patch.alphaFormat)) return false;
  return rustEngineEnabled(env);
}

async function runYtdOnEngine(request) {
  const { signal = null, mode } = request;
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Установка отменена пользователем.", "AbortError");
  }
  const input = path.resolve(String(request.inputFile || ""));
  const output = path.resolve(String(request.outputFile || ""));
  /* Список правок файлом, как у сборки: в командной строке он не уместится. Файл лежит рядом с выходом. */
  const directory = path.dirname(output);
  const listFile = path.join(directory, `.astral-ytd-${randomUUID()}.json`);
  const textures = (request.texturePatches ?? []).map((patch) => ({
    texture: patch.texture,
    source: patch.source,
    sha256: patch.sha256 ?? null,
  }));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(listFile, JSON.stringify(textures));
  try {
    const args =
      mode === "ytd-texture-set"
        ? { input, output, family: request.textureFamily, additions: listFile }
        : { input, output, patches: listFile };
    const result = await callNativeEngine(mode, args, { signal });
    if (result?.status !== "ready")
      throw new Error("Rust-движок не подтвердил правку словаря текстур.");
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw explainHostFailure(error);
  } finally {
    await fs.rm(listFile, { force: true }).catch(() => {});
  }
}

/*
 * Правка текстур ядра YPT (`ypt-texture-patch`) прежним писателем движка (`write-ypt-texture-patch`). Только правки
 * текстур, по умолчанию выключено (`ASTRAL_RUST_YPT_TEXTURE=on`). Писатель портит слова-хеши ядра (замер 16.11.2026: на ядрах
 * из `update.rpf` слово `0x6232E25A` 133 → 0) и не чинится, поэтому при включённом `ASTRAL_RUST_YPT_RULES` запрос из одних
 * текстур берёт `ypt-patch` (`yptRulesOnEngine`), а не он. Отказ движка и пустой ответ — помощнику, без ошибки для установки.
 */
export function yptTextureOnEngine(request, env = process.env) {
  if (String(request?.mode || "") !== "ypt-texture-patch") return false;
  if (!rustYptTextureEnabled(env)) return false;
  if (yptRulesOnEngine(request, env)) return false;
  if (!(request.texturePatches ?? []).length) return false;
  /* Слоты следа (`slotReservations`) и кадры штатных правил (`stockKeyframes`) этот писатель не знает: их берёт `ypt-patch` либо помощник. */
  if (
    (request.rulePatches ?? []).length ||
    (request.effectClones ?? []).length ||
    (request.effectCloneReset ?? []).length ||
    (request.slotReservations ?? []).length ||
    (request.stockKeyframes ?? []).length
  )
    return false;
  return rustEngineEnabled(env);
}

export async function tryYptTextureOnEngine(request, { env = process.env, call = callNativeEngine } = {}) {
  if (!yptTextureOnEngine(request, env)) return null;
  const { signal = null } = request;
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Установка отменена пользователем.", "AbortError");
  }
  const input = path.resolve(String(request.inputFile || ""));
  const output = path.resolve(String(request.outputFile || ""));
  /* Список правок файлом, как у `ytd-texture-patch`: в командной строке он не уместится. Файл лежит рядом с выходом. */
  const directory = path.dirname(output);
  const listFile = path.join(directory, `.astral-ypt-${randomUUID()}.json`);
  const textures = (request.texturePatches ?? []).map((patch) => ({
    texture: patch.texture,
    source: patch.source,
    sha256: patch.sha256 ?? null,
  }));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(listFile, JSON.stringify(textures));
  try {
    const result = await call("write-ypt-texture-patch", { input, output, patches: listFile }, { signal });
    if (result?.status === "ready") return result;
    appLog.record({
      level: "warn",
      source: "ptfx",
      message: "Правка текстур ядра YPT: движок не подтвердил запись, пишет помощник.",
    });
    return null;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    appLog.record({
      level: "warn",
      source: "ptfx",
      message: "Правка текстур ядра YPT: движок не справился, пишет помощник.",
      detail: String(error?.message || error),
    });
    return null;
  } finally {
    await fs.rm(listFile, { force: true }).catch(() => {});
  }
}

/*
 * Весь запрос режима `ypt-texture-patch` помощника — правки правил следа (`rulePatches`), кадры штатных правил
 * (`stockKeyframes`, `stockKeyframesFrom`), слоты следа (`slotReservations`), клоны эффектов и их сброс (`effectClones`,
 * `effectCloneReset`), подмена текстур (`texturePatches`) — командой движка `ypt-patch`: один проход по ядру в порядке
 * помощника, форма ответа помощника (`parity/host-port/ypt-patch/README.md`). Запрос из одних текстур тоже идёт сюда.
 * По умолчанию выключено (`ASTRAL_RUST_YPT_RULES=on`). Редакция Enhanced и запрос без единой правки — помощнику, не
 * дожидаясь отказа движка; отказ, ошибка и пустой ответ движка — тот же запрос помощнику, без ошибки для установки.
 */
const YPT_PATCH_WORK = ["texturePatches", "rulePatches", "stockKeyframes", "effectClones", "effectCloneReset", "slotReservations"];
const listed = (request, name) => Array.isArray(request?.[name]) && request[name].length > 0;
const isEnhancedEdition = (request) => /^enhanced$/i.test(String(request?.edition || ""));

export function yptRulesOnEngine(request, env = process.env) {
  if (String(request?.mode || "") !== "ypt-texture-patch") return false;
  if (!rustYptRulesEnabled(env)) return false;
  if (isEnhancedEdition(request)) return false;
  if (!YPT_PATCH_WORK.some((name) => listed(request, name))) return false;
  return rustEngineEnabled(env);
}

export async function tryYptRulesOnEngine(
  request,
  { env = process.env, call = callNativeEngine, log = (entry) => appLog.record(entry) } = {},
) {
  if (!yptRulesOnEngine(request, env)) return null;
  const { signal = null } = request;
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Установка отменена пользователем.", "AbortError");
  }
  /* Файл запроса кладётся рядом с выходом: без абсолютного пути выхода его некуда положить, и запрос разбирает помощник. */
  if (!path.isAbsolute(String(request.outputFile || ""))) return null;
  const directory = path.dirname(path.resolve(String(request.outputFile)));
  const requestFile = path.join(directory, `.astral-ypt-${randomUUID()}.json`);
  /* Тело помощника целиком, как его читает движок (`YptTexturePatchAsync`, `commands/ypt_patch.rs`). Ключи, ArchiveFix, корень игры и служебные поля моста в файл не идут. */
  const body = {
    inputFile: request.inputFile,
    outputFile: request.outputFile,
    edition: request.edition,
    texturePatches: request.texturePatches,
    rulePatches: request.rulePatches,
    slotReservations: request.slotReservations,
    effectClones: request.effectClones,
    effectCloneReset: request.effectCloneReset,
    stockKeyframes: request.stockKeyframes,
    stockKeyframesFrom: request.stockKeyframesFrom,
  };
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(requestFile, JSON.stringify(body));
    const result = await call("ypt-patch", { request: requestFile }, { signal });
    if (result?.status === "ready") {
      log({ level: "info", source: "ptfx", message: "Правки правил ядра YPT: пишет движок." });
      return result;
    }
    log({ level: "warn", source: "ptfx", message: "Правки правил ядра YPT: движок не подтвердил запись, пишет помощник." });
    return null;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log({
      level: "warn",
      source: "ptfx",
      message: "Правки правил ядра YPT: движок не справился, пишет помощник.",
      detail: String(error?.message || error),
    });
    return null;
  } finally {
    await fs.rm(requestFile, { force: true }).catch(() => {});
  }
}

/*
 * Режимы помощника `ypt-clone-export` (клоны эффектов в памяти, без записи) и `ypt-own-donor` (словарь-донор своих
 * правил автора редукса) — командами движка с теми же именами: тело запроса файлом (`--request`), ответ той формы, что у
 * помощника (`parity/host-port/ypt-clones`, `ypt-own-donor`). Каждый режим за своим выключателем, по умолчанию выключен
 * (`ASTRAL_RUST_YPT_CLONE_EXPORT=on`, `ASTRAL_RUST_YPT_OWN_DONOR=on`). Редакция Enhanced, отказ, ошибка и ответ без нужного
 * раздела (`export` у выгрузки, `donor` у словаря) — тот же запрос помощнику, без ошибки для вызывающего; отмена уважается.
 */
export function yptCloneExportOnEngine(request, env = process.env) {
  if (String(request?.mode || "") !== "ypt-clone-export") return false;
  if (!rustYptCloneExportEnabled(env)) return false;
  if (isEnhancedEdition(request)) return false;
  /* Без клонов помощник отказывает своими словами (`exportYptClones` проверяет это раньше). */
  if (!listed(request, "effectClones")) return false;
  return rustEngineEnabled(env);
}

export function yptOwnDonorOnEngine(request, env = process.env) {
  if (String(request?.mode || "") !== "ypt-own-donor") return false;
  if (!rustYptOwnDonorEnabled(env)) return false;
  if (isEnhancedEdition(request)) return false;
  if (!listed(request, "ruleNames")) return false;
  return rustEngineEnabled(env);
}

const isObject = (value) => typeof value === "object" && value !== null;

/* Файл запроса: рядом с выходом, а у режима без выхода — в своей временной папке. Убирается всегда. */
async function askEngineByRequestFile(command, body, { directory, signal, call }) {
  const folder = directory ?? (await fs.mkdtemp(path.join(os.tmpdir(), "astral-ypt-")));
  const requestFile = path.join(folder, directory ? `.astral-ypt-${randomUUID()}.json` : "request.json");
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(requestFile, JSON.stringify(body));
    return await call(command, { request: requestFile }, { signal });
  } finally {
    if (directory) await fs.rm(requestFile, { force: true }).catch(() => {});
    else await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

async function tryYptModeOnEngine(request, { command, what, body, directory, accepts, call, log }) {
  const { signal = null } = request;
  try {
    const result = await askEngineByRequestFile(command, body, { directory, signal, call });
    if (result?.status === "ready" && accepts(result)) {
      log({ level: "info", source: "ptfx", message: `${what}: считает движок.` });
      return result;
    }
    log({ level: "warn", source: "ptfx", message: `${what}: движок не подтвердил ответ, считает помощник.` });
    return null;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log({ level: "warn", source: "ptfx", message: `${what}: движок не справился, считает помощник.`, detail: String(error?.message || error) });
    return null;
  }
}

export async function tryYptCloneExportOnEngine(
  request,
  { env = process.env, call = callNativeEngine, log = (entry) => appLog.record(entry) } = {},
) {
  if (!yptCloneExportOnEngine(request, env)) return null;
  if (request.signal?.aborted) throw abortedError(request.signal);
  /* Ядро по относительному пути движок не читает, помощник отказывает такому запросу в своих словах. */
  if (!path.isAbsolute(String(request.inputFile || ""))) return null;
  /* Тело помощника целиком (`YptCloneExportAsync`); ключи, корень игры и служебные поля моста в файл не идут. */
  const body = {
    inputFile: request.inputFile,
    edition: request.edition,
    effectClones: request.effectClones,
    effectCloneReset: request.effectCloneReset,
    texturePatches: request.texturePatches,
  };
  return tryYptModeOnEngine(request, { command: "ypt-clone-export", what: "Выгрузка клонов ядра YPT", body, directory: null, accepts: (result) => isObject(result.export), call, log });
}

export async function tryYptOwnDonorOnEngine(
  request,
  { env = process.env, call = callNativeEngine, log = (entry) => appLog.record(entry) } = {},
) {
  if (!yptOwnDonorOnEngine(request, env)) return null;
  if (request.signal?.aborted) throw abortedError(request.signal);
  /* Файл запроса кладётся рядом с выходом: без абсолютных путей запрос разбирает помощник. */
  if (!path.isAbsolute(String(request.inputFile || "")) || !path.isAbsolute(String(request.outputFile || ""))) return null;
  const body = {
    inputFile: request.inputFile,
    outputFile: request.outputFile,
    edition: request.edition,
    ruleNames: request.ruleNames,
    ownTextures: request.ownTextures,
  };
  return tryYptModeOnEngine(request, { command: "ypt-own-donor", what: "Словарь-донор своих правил ядра YPT", body, directory: path.dirname(path.resolve(String(request.outputFile))), accepts: (result) => isObject(result.donor), call, log });
}

/*
 * Фонари помощника (`lamp-*`) на Rust-движке: одна развилка на все команды. Выключатель команды (группа «Фонари»,
 * по умолчанию выключены) и `ASTRAL_RUST_ENGINE` — включены: команда идёт движку тем же каналом, что у
 * `weapons-meta-tracer-patch`. Отказ движка или ошибка — `null`: запрос уходит помощнику с теми же аргументами.
 * Путь (движок или помощник) и причина отката — в журнал.
 */
export function lampOnEngine(request, env = process.env) {
  const mode = String(request?.mode || "");
  if (!Object.prototype.hasOwnProperty.call(LAMP_ROUTE_SWITCHES, mode)) return false;
  return rustLampRouteEnabled(mode, env) && rustEngineEnabled(env);
}

export async function tryLampOnEngine(
  request,
  { env = process.env, call = callNativeEngine, log = (entry) => appLog.record(entry) } = {},
) {
  if (!lampOnEngine(request, env)) return null;
  const mode = String(request.mode);
  const { signal = null, ...body } = request;
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Установка отменена пользователем.", "AbortError");
  }
  let directory = null;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "astral-lamp-"));
    const requestPath = path.join(directory, "request.json");
    await fs.writeFile(requestPath, JSON.stringify(body), "utf8");
    const result = await call(mode, { input: requestPath }, { signal });
    if (result?.status === "ready") {
      log({ level: "info", source: "lamp", message: `${mode}: пишет движок` });
      return result;
    }
    log({ level: "warn", source: "lamp", message: `${mode}: движок не подтвердил, пишет помощник` });
    return null;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    /* «пока на хосте» — движок не берёт этот запрос и сам отдаёт его помощнику (журнал тестера 03.11.2026: «Число моделей вне 1…64: пока на хосте»):
       так задумано, это событие, а не предупреждение. Настоящий отказ движка остаётся предупреждением с причиной. */
    const handedOver = isExpectedEngineAnswer(mode, error);
    log({
      level: handedOver ? "info" : "warn",
      source: "lamp",
      message: handedOver ? `${mode}: движок отдал запрос помощнику, пишет помощник` : `${mode}: движок не справился, пишет помощник`,
      detail: String(error?.message ?? error),
    });
    return null;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function composeRpfArchive(request) {
  /* Без основы (`baseArchive: null`, подпакет штатного пакета `dlc<N>.rpf`, `resource-composition.js`) корневой архив создаётся с нуля: помощник, режим `create`; имя файла из `archiveTarget` идёт в ключ оглавления, ArchiveFix доводит. */
  const result = await runRpfHelper({ ...request, mode: request?.baseArchive ? "compose" : "create" });
  /* Хвост `update.rpf` (20.11.2026, `rpf-tail.js`): запас нулей после последней записи; отпечаток после добавки пересчитает вызывающий. */
  return padComposedTail({ request: { ...request, mode: "compose" }, result });
}

/*
 * Установка готового архива движком (шаг 3 ядра фазы 7): блок `install` в `compose-rpf` кладёт
 * копию рядом с живым архивом, пишет точку с `replay.json` и проводит общую транзакцию. Помощник
 * блока `install` не знает и записал бы базу поверх игры — поэтому без движка отказ до любой записи.
 */
export function installRpfPrebuilt(request) {
  if (!composeOnEngine("compose"))
    throw new Error("Установка готового архива движком выключена: Rust-движок не включён.");
  return composeRpfArchive(request);
}

/*
 * Опись пары карт света LOD на движке (`lamp-lod-inspect-pair`): те же два файла, что у помощника, и тот же ответ.
 * Выключатель `ASTRAL_RUST_LAMP_LOD`. Любой отказ движка — `null`: опись делает помощник, он эталон.
 */
export async function inspectLampLodPairOnEngine(
  { lodInputFile, distantInputFile },
  { env = process.env, call = callNativeEngine } = {},
) {
  if (!lodInputFile || !distantInputFile || !rustLampLodEnabled(env)) return null;
  try {
    const result = await call("lamp-lod-inspect-pair", {
      lod: path.resolve(String(lodInputFile)),
      distant: path.resolve(String(distantInputFile)),
    });
    return result?.status === "ready" ? result : null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "lamp-lod",
      message: "Опись пары LOD: движок не взял пару, опись делает помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  }
}

/*
 * Правка пары карт света LOD на месте (`lamp-lod-patch`) на движке: тот же запрос, что у помощника, и тот же ответ.
 * Выключатель `ASTRAL_RUST_LAMP_LOD`. Любой отказ движка — `null`: правку делает помощник, он эталон.
 */
export async function patchLampLodPairOnEngine(request, { env = process.env, call = callNativeEngine } = {}) {
  if (!rustLampLodEnabled(env)) return null;
  const absolute = (value) => (value ? path.resolve(String(value)) : value);
  const body = {
    ...request,
    lodInputFile: absolute(request.lodInputFile),
    distantInputFile: absolute(request.distantInputFile),
    lodOutputFile: absolute(request.lodOutputFile),
    distantOutputFile: absolute(request.distantOutputFile),
  };
  let directory = null;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "astral-lod-patch-"));
    const requestPath = path.join(directory, "request.json");
    await fs.writeFile(requestPath, JSON.stringify(body), "utf8");
    const result = await call("lamp-lod-patch", { request: requestPath });
    return result?.status === "ready" ? result : null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "lamp-lod",
      message: "Правка пары LOD: движок не взял пару, правит помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

export function runStreetLightRpfHelper(request) {
  const allowedModes = new Set([
    "lamp-inspect",
    "lamp-plan",
    "lamp-patch",
    "lamp-verify",
    "lamp-lod-inspect-pair",
    "lamp-lod-patch",
  ]);
  if (!allowedModes.has(request?.mode))
    throw new Error("Street-light helper mode is not allowlisted.");
  return runRpfHelper(request);
}

/*
 * Редактор фонарей мастерской (`LampStudioCommands.cs`): опись света моделей,
 * правка байтов света на местах, огни вдали по правилу и частицы у ламп в
 * описании пропов. Все четыре — над файлами, уже вынутыми из игры: архивов
 * игры они не открывают.
 */
export function inspectLampModels({ models, ...request }) {
  return runRpfHelper({
    ...request,
    mode: "lamp-studio-inspect",
    lampStudioModels: models,
  });
}

/*
 * Правка огней и стекла моделей мастерской на движке (`lamp-studio-patch`): те же правки, что у помощника, и тот же
 * ответ. Выключатель `ASTRAL_RUST_LAMP_STUDIO`. Любой отказ движка — `null`: правит помощник, он эталон.
 */
export async function patchLampModelsOnEngine({ patches }, { env = process.env, call = callNativeEngine } = {}) {
  if (!rustLampStudioEnabled(env)) return null;
  const absolute = (item) => ({
    ...item,
    input: path.resolve(String(item.input)),
    output: path.resolve(String(item.output)),
    textures: (item.textures ?? []).map((texture) => ({ ...texture, source: path.resolve(String(texture.source)) })),
  });
  let directory = null;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "astral-lamp-studio-"));
    const requestPath = path.join(directory, "request.json");
    await fs.writeFile(requestPath, JSON.stringify({ lampStudioPatches: patches.map(absolute) }), "utf8");
    const result = await call("lamp-studio-patch", { request: requestPath });
    return result?.status === "ready" ? result : null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "lamp-studio",
      message: "Правка огней мастерской: движок не взял модели, правит помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function patchLampModels({ patches, ...request }) {
  const engine = await patchLampModelsOnEngine({ patches });
  if (engine) return engine;
  return runRpfHelper({
    ...request,
    mode: "lamp-studio-patch",
    lampStudioPatches: patches,
  });
}

/* Текстуры светящегося стекла моделей — DDS в папку `output` каждой модели. */
export function exportLampGlass({ models, ...request }) {
  return runRpfHelper({
    ...request,
    mode: "lamp-studio-glass",
    lampStudioGlassModels: models,
  });
}

/*
 * Правка огней LOD по правилу мастерской на движке (`lamp-studio-lod`): те же пары и правило, что у помощника, и тот же
 * ответ с отчётом по парам. Выключатель `ASTRAL_RUST_LAMP_LOD`. Любой отказ движка — `null`: правит помощник.
 */
export async function patchLampStudioLodOnEngine(request, { env = process.env, call = callNativeEngine } = {}) {
  if (!rustLampLodEnabled(env)) return null;
  const absolute = (pair) => ({
    lodInput: path.resolve(String(pair.lodInput)),
    distantInput: path.resolve(String(pair.distantInput)),
    lodOutput: path.resolve(String(pair.lodOutput)),
    distantOutput: path.resolve(String(pair.distantOutput)),
  });
  const body = {
    lampStudioLodPairs: request.lampStudioLodPairs.map(absolute),
    lampStudioLodRule: request.lampStudioLodRule,
  };
  let directory = null;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "astral-studio-lod-"));
    const requestPath = path.join(directory, "request.json");
    await fs.writeFile(requestPath, JSON.stringify(body), "utf8");
    const result = await call("lamp-studio-lod", { request: requestPath });
    return result?.status === "ready" ? result : null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "lamp-lod",
      message: "Правило огней LOD: движок не взял пары, правит помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function patchLampLodPairs({ pairs, rule, ...request }) {
  const engine = await patchLampStudioLodOnEngine({ lampStudioLodPairs: pairs, lampStudioLodRule: rule });
  if (engine) return engine;
  return runRpfHelper({
    ...request,
    mode: "lamp-studio-lod",
    lampStudioLodPairs: pairs,
    lampStudioLodRule: rule,
  });
}

export function patchLampArchetypes({
  input,
  output,
  extensions,
  prefix,
  ...request
}) {
  return runRpfHelper({
    ...request,
    mode: "lamp-studio-ytyp",
    inputFile: input,
    outputFile: output,
    lampStudioExtensions: extensions,
    lampStudioExtensionPrefix: prefix,
  });
}

export function createRpfArchive(request) {
  return runRpfHelper({ ...request, mode: "create" });
}

export function probeRpfArchive({ archivePath, ...request }) {
  if (composeOnEngine("probe"))
    return runReadOnEngine(
      "probe-rpf",
      { ...request, baseArchive: archivePath },
      {
        mode: "probe",
        baseArchive: archivePath,
        archiveTarget: request.archiveTarget ?? null,
        operations: request.operations ?? [],
      },
      "проверку архива",
    );
  return runRpfHelper({
    ...request,
    mode: "probe",
    baseArchive: archivePath,
  });
}

/*
 * Режимы «только чтение» в движке (`probe`, `search`): общий путь. Движок ставит чтение за записью
 * того же архива (`archiveTargets`), поэтому своя очередь здесь не нужна. Ключи — как у сборки.
 */
async function runReadOnEngine(command, request, body, label) {
  const { signal = null, ...rest } = request;
  if (signal?.aborted) throw abortedError(signal);
  if (body?.baseArchive) await ensureStoredFile(body.baseArchive, { signal });
  const toolchain = await localVerifiedArchiveToolchain();
  const keys = rest.keys ?? toolchain?.keys ?? null;
  const requestFile = path.join(os.tmpdir(), `astral-${command}-${randomUUID()}.json`);
  await fs.writeFile(requestFile, JSON.stringify(body));
  try {
    const result = await callNativeEngine(
      command,
      {
        requestFile,
        baseArchive: rest.baseArchive ?? null,
        gameRoot: rest.gameRoot ?? null,
        keys: typeof keys === "string" ? keys : (keys?.directory ?? null),
      },
      { signal },
    );
    if (result?.status !== "ready") throw new Error(`RPF engine не подтвердил ${label}.`);
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw explainHostFailure(error);
  } finally {
    await fs.rm(requestFile, { force: true }).catch(() => {});
  }
}

export function searchRpfArchive({
  archivePath,
  query,
  prefixes,
  maxMatches,
  maxNestedDepth,
  ...request
}) {
  const body = {
    mode: "search",
    baseArchive: archivePath,
    query,
    prefixes,
    maxMatches,
    maxNestedDepth,
  };
  const run = composeOnEngine("search")
    ? runReadOnEngine("search-rpf", { ...request, baseArchive: archivePath }, body, "поиск")
    : runRpfHelper({ ...request, ...body });
  return run.then((result) => {
    /* Вложенный архив, который помощник не открыл, поиск пропускает (Hubby,
       16.10: из-за одного waterfog_txds_dx.rpf падали GPS и мини-карта), а
       причина — в «Логи»: по ней видно, какой архив игры испорчен. */
    const unreadable = Array.isArray(result?.unreadable) ? result.unreadable : [];
    if (unreadable.length)
      appLog.record({
        level: "warn",
        source: "rpf-helper",
        message: `search: ${unreadable.length} nested archive(s) could not be opened`,
        detail: unreadable
          .slice(0, 20)
          .map((item) => `${item?.entry}: ${item?.error}`)
          .join("\n"),
      });
    return result;
  });
}

/*
 * ЗАПИСЬ, КОТОРУЮ ПОМОЩНИК НЕ РАЗДУВАЕТ
 *
 * После правки нативным хостом (килл-эффект, прицел, мини-карта, GPS)
 * вложенный `scaleform_generic.rpf` остаётся с оглавлением OPEN, а записи в
 * нём — зашифрованными NG. Игра их читает, помощник, собранный до
 * исправления `ExportBinaryUncompressed`, — нет: на каждой нетронутой записи
 * он отвечал «The archive entry was compressed using an unsupported
 * compression method». Следом падала любая установка, которой нужна такая
 * запись, — «Завод» и «Зоны каптов» 14.10.2026 у бета-тестера.
 *
 * Чтение на этом отказе берёт читатель игры — `@modovik/rpf7`. Другие отказы
 * (нет ключей, нет записи, занятый файл) идут наверх как есть.
 */
const UNREADABLE_ENTRY = /compressed using an unsupported compression method/i;

export const isUnreadableEntryFailure = (error) =>
  UNREADABLE_ENTRY.test(String(error?.message ?? error ?? ""));

export async function extractRpfEntry(
  { archivePath, entry, output, ...request },
  {
    run = runRpfHelper,
    readWithRpf7 = readRpfEntryWithRpf7,
    useEngine = composeOnEngine("extract"),
  } = {},
) {
  try {
    const body = { mode: "extract", baseArchive: archivePath, entry, extractOutput: output };
    return await (useEngine
      ? runReadOnEngine("extract-rpf", { ...request, baseArchive: archivePath }, body, "выгрузку записи")
      : run({ ...request, ...body }));
  } catch (error) {
    if (!isUnreadableEntryFailure(error)) throw error;
    return readWithRpf7({ archivePath, entry, output }).catch(() => {
      throw error;
    });
  }
}

/*
 * ЧИТАТЬ ЗАПИСИ УМЕЕТ НЕ ТОЛЬКО ПОМОЩНИК
 *
 * `modovik-rpf-helper.exe` заведён ради ЗАПИСИ: он собирает и пересобирает
 * архивы игры вместе с ArchiveFix. Чтение достаётся ему заодно — и в
 * собранном приложении это правильно, там он лежит рядом.
 *
 * А в дереве разработчика его может не быть вовсе: `npm run rpf:build`
 * требует .NET SDK, и на машине с одним runtime помощник не собирается. До
 * сих пор это означало, что редактор интерьеров показывает схему вместо
 * настоящего магазина 24/7 — при установленной игре и разложенных ключах.
 * Причина при этом видна только в логе главного процесса, а человек видит
 * коробки и «помещение читается из игры только в Astral Desktop».
 *
 * Нативный хост читает те же записи той же связкой ключей и собран всегда:
 * без него не работает ни одна модель предпросмотра. Он ходит по записи за
 * запуск (помощник берёт партию), поэтому это именно запасной путь — восемь
 * файлов комнаты вместо одного вызова, но восемь настоящих стен вместо схемы.
 *
 * Пишущие режимы сюда не попадают и попасть не должны: собирать архив умеет
 * только помощник, и подменять его чтением было бы обманом.
 */
const nativeHostContext = () => ({
  packaged: appPackaged(),
  resourcesPath: appResourcesPath(),
  projectRoot: path.resolve(dirname, "../../.."),
});

/*
 * Имя записи для хоста: он адресует архив двоеточием (`x64h:/levels/...`), а
 * путь без двоеточия читает как запись в `update.rpf`. Двоеточие ставится
 * после ПУТИ архива от корня игры, поэтому слой OpenIV адресуется тем же
 * правилом: `mods/x64h:/levels/...` — проверено на живой игре.
 *
 * Всё остальное отсюда не адресуется вовсе (пакеты DLC, чужие папки): такой
 * случай возвращает пустоту, и заказ уходит помощнику, который честно скажет,
 * что не собран, — вместо тихого чтения не того архива.
 */
const ADDRESSABLE_ARCHIVE =
  /^(?:mods\/)?(?:[a-z0-9_]+\.rpf|update\/update\.rpf)$/i;

export function nativeArchivePrefix(archivePath, gameRoot) {
  if (!archivePath || !gameRoot) return null;
  const relative = path
    .relative(gameRoot, archivePath)
    .split(path.sep)
    .join("/");
  return ADDRESSABLE_ARCHIVE.test(relative)
    ? `${relative.slice(0, -4)}:`
    : null;
}

async function readEntriesWithNativeHost({
  archivePath,
  entries,
  outputDirectory,
  gameRoot,
}) {
  const prefix = nativeArchivePrefix(archivePath, gameRoot);
  if (!prefix) return null;
  const toolchain = await localVerifiedArchiveToolchain();
  const extracted = [];
  for (const entry of entries) {
    const inner = String(entry || "")
      .split("\\")
      .join("/")
      .replace(/^\/+/, "");
    if (!inner) continue;
    const output = path.join(outputDirectory, path.basename(inner));
    await callNativeEngine(
      "read-archive-file",
      {
        gameRoot,
        entry: `${prefix}/${inner}`,
        output,
        /* Ключи те же, что у помощника: на свежих Steam-сборках хост не
           находит их в исполняемом файле игры сам. */
        keys: toolchain?.keys?.directory || null,
      },
      nativeHostContext(),
    );
    extracted.push({ entry: inner, output });
  }
  return { extracted };
}

export async function extractRpfEntries(
  { archivePath, entries: wanted, outputDirectory, ...request },
  {
    run = runRpfHelper,
    readWithRpf7 = readRpfEntriesWithRpf7,
    haveHelper = () => helperExecutable().catch(() => null),
    useEngine = composeOnEngine("extract-many"),
  } = {},
) {
  /* Один файл дважды в партии (два мода берут одну запись): движок и помощник отказывают всей партии
     словами «Duplicate RPF extraction entry». Файл на диске один, поэтому и просим его один раз. */
  const entries = [...new Map(wanted.map((entry) => [String(entry).replace(/\\/g, "/").toLowerCase(), entry])).values()];
  if (useEngine) {
    /* Партия в движке: одним запуском и одной распаковкой архива, как у помощника. */
    try {
      return await runReadOnEngine(
        "extract-many-rpf",
        { ...request, baseArchive: archivePath },
        {
          mode: "extract-many",
          baseArchive: archivePath,
          extractEntries: entries,
          extractOutputDirectory: outputDirectory,
        },
        "выгрузку партии",
      );
    } catch (error) {
      if (!isUnreadableEntryFailure(error)) throw error;
      return readWithRpf7({ archivePath, entries, outputDirectory }).catch(() => {
        throw error;
      });
    }
  }
  /* Помощник первый: он берёт партию одним запуском и одной распаковкой
     архива. Запасной путь включается только там, где его нет. */
  const helper = await haveHelper();
  if (!helper) {
    const read = await readEntriesWithNativeHost({
      archivePath,
      entries,
      outputDirectory,
      gameRoot: request.gameRoot,
    });
    if (read) return read;
  }
  try {
    return await run({
      ...request,
      mode: "extract-many",
      baseArchive: archivePath,
      extractEntries: entries,
      extractOutputDirectory: outputDirectory,
    });
  } catch (error) {
    if (!isUnreadableEntryFailure(error)) throw error;
    /* Партия целиком: записи, которых в архиве нет, читатель пропускает, а
       вызывающий сверяет ответ со своим списком. */
    return readWithRpf7({ archivePath, entries, outputDirectory }).catch(() => {
      throw error;
    });
  }
}

export function provideLegacyDlcList({
  baseArchive = null,
  gameRoot,
  edition,
  output,
}) {
  return extractRpfEntry({
    archivePath: baseArchive || path.join(gameRoot, "update", "update.rpf"),
    entry: "common/data/dlclist.xml",
    output,
    archiveTarget: "update/update.rpf",
    gameRoot,
    edition,
  });
}

export function provideUpdateContentXml({
  baseArchive,
  gameRoot,
  edition,
  output,
}) {
  return extractRpfEntry({
    archivePath: baseArchive,
    entry: "content.xml",
    output,
    archiveTarget: "mods/update/update.rpf",
    gameRoot,
    edition,
  });
}

/**
 * Помощник отвечает на нечитаемый `.ypt` текстом исключения CodeWalker — сорок
 * строк стека. Отказ идёт дальше словами (`foreign-archive.js`), с версией
 * ресурса из заголовка файла; стек остаётся в журнале («Логи» в настройках) —
 * во всплывашке окна ему места нет.
 */
/*
 * Пустое исключение CodeWalker (`DDSIO.assert` — `throw new Exception()` без текста):
 * текстура в формате, которого кодировщик DDS не знает. В штатной игре таких нет;
 * так выглядят текстуры, заменённые чужим модом (бета 14.10, мини-карта у
 * doshriak и kevake: «Exception of type 'System.Exception' was thrown»). Отказ —
 * в семействе «архив переделан другой сборкой», окно переводит его на свой язык.
 */
const BARE_EXCEPTION = /^Exception of type 'System\.Exception' was thrown\.?$/;
export function explainBareHelperException(message, detail = "") {
  if (!BARE_EXCEPTION.test(String(message || "").trim())) return message;
  if (!/DDSIO/.test(String(detail || ""))) return message;
  return (
    "Архив игры переделан другой сборкой: текстура в файлах игры записана в формате, который Astral не читает " +
    "(так бывает, когда файлы игры заменил другой мод). Верните оригинал — проверка файлов игры в Steam, " +
    "Epic Games или Rockstar Games Launcher — и повторите. (" + String(message).trim() + ")"
  );
}

const explainingUnreadable = (input) => (error) =>
  explainUnreadableYpt(error, input).then((explained) => {
    if (explained !== error)
      appLog.record({
        level: "warn",
        source: "ptfx",
        message: explained.message,
        detail: `${describeYptFacts(explained.facts)}\n${String(error?.message || error)}`.trim(),
      });
    throw explained;
  });

export function convertYptToXml({
  input,
  output,
  assetsDirectory,
  ...request
}) {
  return runRpfHelper({
    ...request,
    mode: "ypt-to-xml",
    inputFile: input,
    outputFile: output,
    assetsDirectory,
  }).catch(explainingUnreadable(input));
}

export function convertXmlToYpt({
  input,
  output,
  assetsDirectory,
  ...request
}) {
  return runRpfHelper({
    ...request,
    mode: "ypt-from-xml",
    inputFile: input,
    outputFile: output,
    assetsDirectory,
  });
}

/*
 * Опись ядра на движке (`inspect-ypt`) выключена: размеры мелких mip у двух текстур core.ypt
 * (ptfx_blood_spurt, ptfx_insects_rgb) считаются иначе, чем у помощника (паритет 19.10, 167 + 6 ядер).
 * Опись ядра идёт на движок за выключателем `ASTRAL_RUST_YPT_INSPECT` (проверено на core.ypt, см. rustYptInspectEnabled).
 */
export function inspectYptOnEngine(request, env = process.env) {
  return rustEngineEnabled(env) && rustYptInspectEnabled(env) && !/^enhanced$/i.test(String(request.edition || ""));
}

export function inspectYpt({ input, ...request }) {
  const pending = inspectYptOnEngine(request)
    ? runYptInspectOnEngine(input, request)
    : runRpfHelper({
        ...request,
        mode: "ypt-inspect",
        inputFile: input,
      });
  return pending.catch(explainingUnreadable(input));
}

/*
 * Опись ядра без папки игры — для скриптов конвейера редуксов (опись ядра автора, карточки «нашего Core»):
 * помощнику нужна игра ради ключей, движку для отдельного .ypt — нет.
 */
export function inspectYptWithoutGame(input) {
  if (!rustEngineEnabled())
    throw new Error("Опись ядра без папки игры умеет только движок Astral, а он выключен (ASTRAL_RUST_ENGINE).");
  return runYptInspectOnEngine(input, {}).catch(explainingUnreadable(input));
}

async function runYptInspectOnEngine(input, request) {
  const { signal = null } = request;
  if (signal?.aborted) throw abortedError(signal);
  try {
    const result = await callNativeEngine("inspect-ypt", { input }, { signal });
    if (result?.status !== "ready") throw new Error("RPF engine не подтвердил опись ядра эффектов.");
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw explainHostFailure(error);
  }
}

/**
 * Выписка правил эффектов по именам (`tools/rpf-helper/YptRuleDigest.cs`):
 * числа, по которым окно мастерской проигрывает попадание. Отвечает
 * `{ rules: { имя: выписка | null } }`.
 */
export function digestYptRules({ input, rules, ...request }) {
  if (!Array.isArray(rules) || !rules.length) {
    throw new Error("YPT rule digest needs at least one rule name.");
  }
  const names = rules.map((name) => String(name || "").trim());
  if (yptOnEngine("ypt-rule-digest"))
    return runYptOnEngine("ypt-rule-digest", input, names, request).catch(explainingUnreadable(input));
  return runRpfHelper({
    ...request,
    mode: "ypt-rule-digest",
    inputFile: input,
    ruleNames: names,
  }).catch(explainingUnreadable(input));
}

/*
 * Правила эффектов целиком — для движка частиц окна: эмиттеры, частицы,
 * эволюции, домены, поведения и переменные шейдера, как их пишет CodeWalker
 * (`YptRuleExport`). В отличие от выписки ничего не выбрасывается.
 */
export function exportYptRules({ input, rules, ...request }) {
  if (!Array.isArray(rules) || !rules.length) {
    throw new Error("YPT rule export needs at least one rule name.");
  }
  const names = rules.map((name) => String(name || "").trim());
  if (yptOnEngine("ypt-rule-export"))
    return runYptOnEngine("ypt-rule-export", input, names, request).catch(explainingUnreadable(input));
  return runRpfHelper({
    ...request,
    mode: "ypt-rule-export",
    inputFile: input,
    ruleNames: names,
  }).catch(explainingUnreadable(input));
}

/*
 * Выписка и выгрузка правил движком (фаза 7, маршрут 20.10): `read-ypt-digest` и `read-ypt-export` отдают
 * те же разделы, что помощник (сверено по корпусу, сценам и JS-вызовам). По умолчанию — движок; выключатель
 * ASTRAL_RUST_PTFX_RULES=off, запасной путь — ASTRAL_RPF_HELPER_MODES=ypt-rule-digest,ypt-rule-export или
 * ASTRAL_RUST_ENGINE=off.
 */
const YPT_ENGINE_COMMANDS = new Map([
  ["ypt-rule-digest", "read-ypt-digest"],
  ["ypt-rule-export", "read-ypt-export"],
]);

export function yptOnEngine(mode, env = process.env) {
  const name = String(mode || "");
  if (!YPT_ENGINE_COMMANDS.has(name)) return false;
  /* По умолчанию — движок (сверено: корпус, сцены, импакт и JS-вызовы). Выключатель: ASTRAL_RUST_PTFX_RULES=off — помощник. */
  if (String(env.ASTRAL_RUST_PTFX_RULES ?? "").trim().toLowerCase() === "off") return false;
  if (helperModesFrom(env).has(name)) return false;
  return rustEngineEnabled(env);
}

/* Ответ помощника по форме: выписка — `{ rules }`, выгрузка — `{ export }` (тот же объект разделов). */
async function runYptOnEngine(mode, input, names, { signal = null } = {}) {
  if (signal?.aborted) throw abortedError(signal);
  const inputFile = path.resolve(String(input || ""));
  const result = await callNativeEngine(YPT_ENGINE_COMMANDS.get(mode), { input: inputFile, names }, { signal });
  if (mode === "ypt-rule-digest") {
    if (!result?.rules) throw new Error("Rust-движок не отдал выписку правил.");
    return result;
  }
  if (!result || typeof result !== "object") throw new Error("Rust-движок не отдал выгрузку правил.");
  return { status: "ready", mode, input: inputFile, export: result };
}

/**
 * Клоны правил эффектов попадания — в памяти помощника, без записи в ядро:
 * собираются тем же кодом, что при установке, и выписываются как
 * `ypt-rule-export`. Сверка сборки клона в окне с установщиком
 * (`scripts/probe-effect-clones.mjs`).
 */
export function exportYptClones({
  input,
  effectClones,
  patches = [],
  effectCloneReset = [],
  ...request
}) {
  if (!Array.isArray(effectClones) || !effectClones.length) {
    throw new Error("YPT clone export needs at least one effect clone.");
  }
  return runRpfHelper({
    ...request,
    mode: "ypt-clone-export",
    inputFile: input,
    effectClones,
    effectCloneReset,
    texturePatches: patches,
  }).catch(explainingUnreadable(input));
}

/*
 * Словарь-донор своих правил автора редукса («наш Core», этап 2, `tools/rpf-helper/YptOwnDonor.cs`): из ядра автора —
 * только названные правила, их эмиттеры и частицы и листы; листы игры — пустые той же раскладки.
 */
export function buildYptOwnDonor({ input, output, rules, ownTextures = [], ...request }) {
  if (!Array.isArray(rules) || !rules.length) throw new Error("YPT own donor needs at least one rule name.");
  return runRpfHelper({
    ...request,
    mode: "ypt-own-donor",
    inputFile: input,
    outputFile: output,
    ruleNames: rules.map((name) => String(name || "").trim()),
    ownTextures: ownTextures.map((name) => String(name || "").trim()),
  }).catch(explainingUnreadable(input));
}

export function patchYptTextures({
  input,
  output,
  patches,
  rules = [],
  /* Клоны правил эффектов попадания и приставки имён, под которыми прежние
     клоны удаляются перед сборкой (`tools/rpf-helper/YptEffectClones.cs`). */
  effectClones = [],
  effectCloneReset = [],
  /* Кадры штатных правил ядра игрока — числа автора редукса (слой каталога
     «правила автора», `tools/rpf-helper/YptStockKeyframes.cs`). */
  stockKeyframes = [],
  ...request
}) {
  if (!Array.isArray(patches)) {
    throw new Error("YPT texture patches must be a list.");
  }
  /* Клон без своей текстуры (вода, искры) патча текстур не несёт, и сброс
     прежних клонов — тоже правка сама по себе; кадры штатных правил — тоже. */
  if (!patches.length && !effectClones.length && !effectCloneReset.length && !stockKeyframes.length) {
    throw new Error("At least one YPT texture patch is required.");
  }
  if (!Array.isArray(rules)) {
    throw new Error("YPT rule patches must be a list.");
  }
  return runRpfHelper({
    ...request,
    mode: "ypt-texture-patch",
    inputFile: input,
    outputFile: output,
    ...(effectClones.length ? { effectClones } : {}),
    ...(effectCloneReset.length ? { effectCloneReset } : {}),
    ...(stockKeyframes.length ? { stockKeyframes } : {}),
    texturePatches: patches.map((patch) => ({
      texture: String(patch.texture || "").trim(),
      source: path.resolve(String(patch.source || "")),
      sha256: patch.sha256 || null,
    })),
    /* Размер спрайта правила идёт тем же проходом, что и текстура: ядро в
       тринадцать мегабайт читается и пишется один раз, а не дважды. */
    rulePatches: rules.map(yptRulePatch),
  }).catch(explainingUnreadable(input));
}

/* Правка правила в запросе helper-у (`YptRulePatch` в Program.cs). Белые кадры
   цвета (`neutralColour` из packages/ptfx-studio/compile.js) раньше терялись
   здесь, и цвет следа умножался на оранжевый донора. */
export function yptRulePatch(rule) {
  /* Размер в проекте — метры в игре, а помощник считает в своих единицах: вдвое крупнее (`TRACER_INSTALL_UNITS_PER_METRE`). */
  const installed = (metres) => (metres == null ? null : Number((metres * TRACER_INSTALL_UNITS_PER_METRE).toFixed(6)));
  return {
    rule: String(rule.rule || "").trim(),
    width: installed(rule.width),
    length: installed(rule.length),
    neutralColour: rule.neutralColour === true ? true : null,
    /* Свой выстрел без следа (задача 14 ТЗ 10.10.2026). */
    nearHide: rule.nearHide ? normalizeTracerNearHide(rule.nearHide) : null,
  };
}

export function inspectYtd({ input, ...request }) {
  /* Enhanced-словарь читает только помощник: движок читает Legacy. */
  if (composeOnEngine("ytd-inspect") && !/^enhanced$/i.test(String(request.edition || ""))) {
    return runYtdInspectOnEngine(input, request);
  }
  return runRpfHelper({
    ...request,
    mode: "ytd-inspect",
    inputFile: input,
  });
}

/* Опись словаря текстур в движке (`inspect-ytd`): файл на входе, ключи не нужны. */
async function runYtdInspectOnEngine(input, request) {
  const { signal = null } = request;
  if (signal?.aborted) throw abortedError(signal);
  try {
    const result = await callNativeEngine("inspect-ytd", { input }, { signal });
    if (result?.status !== "ready") throw new Error("RPF engine не подтвердил опись словаря.");
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw explainHostFailure(error);
  }
}

export function patchYtdTextures({ input, output, patches, ...request }) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("At least one YTD texture patch is required.");
  }
  return runRpfHelper({
    ...request,
    mode: "ytd-texture-patch",
    inputFile: input,
    outputFile: output,
    texturePatches: patches.map((patch) => ({
      texture: String(patch.texture || "").trim(),
      source: path.resolve(String(patch.source || "")),
      sha256: patch.sha256 || null,
      /* Прозрачная деталь ствола: DXT1 → DXT5 того же размера. */
      ...(patch.alphaFormat === true ? { alphaFormat: true } : {}),
    })),
  });
}

/**
 * Своё семейство текстур в словаре (`ytd-texture-set`): прежние текстуры с
 * приставкой `family` снимаются, `textures` кладутся рядом со штатными.
 * Пустой список просто снимает семейство — так уходит знак на килле.
 */
export function setYtdTextureFamily({
  input,
  output,
  family,
  textures = [],
  ...request
}) {
  return runRpfHelper({
    ...request,
    mode: "ytd-texture-set",
    inputFile: input,
    outputFile: output,
    textureFamily: String(family || ""),
    texturePatches: textures.map((texture) => ({
      texture: String(texture.texture || "").trim(),
      source: path.resolve(String(texture.source || "")),
      sha256: texture.sha256 || null,
    })),
  });
}

/*
 * Поле, которого у привязки нет, помощник не трогает (`weapons-meta-flash`):
 * ствол, привязанный только ради вспышки, сохраняет свой след, и наоборот.
 * Пустое имя следа — ствол без следа (`weapons-meta-tracer-clear`).
 */
export const weaponBinding = (binding) => ({
  weapon: String(binding.weapon || "").trim(),
  ...(binding.tracerFx != null
    ? {
        tracerFx: String(binding.tracerFx).trim(),
        chanceSP: binding.chanceSP ?? null,
        chanceMP: binding.chanceMP ?? null,
      }
    : {}),
  ...(binding.flashFx != null
    ? { flashFx: String(binding.flashFx).trim() }
    : {}),
  /* Вид выстрела (`weapons-meta-muzzle-look`): размер и свет вспышки, дым,
     гильзы — только поля, которые меняются. */
  ...(binding.look && Object.keys(binding.look).length
    ? { look: helperLook(binding.look) }
    : {}),
});

/**
 * Привязка следа к стволам в нескольких файлах оружия — одним запуском
 * помощника (`weapons-meta-tracer-batch`): у «всего оружия» их десятки.
 */
/*
 * Привязка следа и вспышки на движке (`weapons-meta-tracer-patch`): тот же weapons.meta, что у помощника, по тем же
 * правилам. Выключатель `ASTRAL_RUST_WEAPONS_META`. Любой отказ движка — `null`: правку делает помощник, он эталон.
 */
export async function patchWeaponsMetaOnEngine(request, { env = process.env, call = callNativeEngine } = {}) {
  if (!rustWeaponsMetaEnabled(env)) return null;
  const absolute = (file) => ({
    ...file,
    inputFile: path.resolve(String(file.inputFile)),
    outputFile: path.resolve(String(file.outputFile)),
  });
  const body = request.weaponMetaFiles
    ? { weaponMetaFiles: request.weaponMetaFiles.map(absolute) }
    : absolute(request);
  let directory = null;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "astral-weapons-meta-"));
    const requestPath = path.join(directory, "request.json");
    await fs.writeFile(requestPath, JSON.stringify(body), "utf8");
    const result = await call("weapons-meta-tracer-patch", { request: requestPath });
    return result?.status === "ready" ? result : null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "weapons-meta",
      message: "weapons.meta: правку не взял движок, правит помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function patchWeaponTracerFiles({ files, ...request }) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("At least one weapons metadata file is required.");
  }
  const weaponMetaFiles = files.map((file) => {
    if (!Array.isArray(file.bindings) || file.bindings.length === 0)
      throw new Error("Every weapons metadata file needs a binding.");
    return {
      inputFile: file.input,
      outputFile: file.output,
      bindings: file.bindings.map(weaponBinding),
    };
  });
  const engine = await patchWeaponsMetaOnEngine({ weaponMetaFiles });
  if (engine) return engine;
  return runRpfHelper({ ...request, mode: "weapons-meta-tracer-patch", weaponMetaFiles });
}

export async function patchWeaponTracerBindings({
  input,
  output,
  bindings,
  ...request
}) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    throw new Error("At least one weapon tracer binding is required.");
  }
  const weaponTracerBindings = bindings.map((binding) => ({
    weapon: String(binding.weapon || "").trim(),
    tracerFx: String(binding.tracerFx || "").trim(),
    chanceSP: binding.chanceSP ?? null,
    chanceMP: binding.chanceMP ?? null,
  }));
  const engine = await patchWeaponsMetaOnEngine({ inputFile: input, outputFile: output, weaponTracerBindings });
  if (engine) return engine;
  return runRpfHelper({
    ...request,
    mode: "weapons-meta-tracer-patch",
    inputFile: input,
    outputFile: output,
    weaponTracerBindings,
  });
}

/**
 * Пакетный скан звукового архива: все .awc корня (или только `entries`)
 * извлекаются в `<outputDirectory>/<bank>/bank.awc` и описываются одним
 * процессом helper'а. Сбой одного банка приходит полем `error` в его
 * элементе, а не валит весь список.
 */
export function scanAwcBanks({
  archivePath,
  outputDirectory,
  entries = null,
  ...request
}) {
  return runRpfHelper({
    ...request,
    mode: "awc-bank-scan",
    baseArchive: archivePath,
    scanOutputDirectory: outputDirectory,
    scanEntries: Array.isArray(entries) && entries.length ? entries : null,
  });
}

/*
 * Опись банка: движок на Rust, если выключатель `ASTRAL_RUST_AWC_INSPECT` включён и банк плоский. Зашифрованный и
 * многоканальный банк движок отказывает словами «пока на хосте» — опись делает помощник. Любой отказ движка уходит
 * помощнику: он эталон, и тот же вход даёт тот же ответ.
 */
export async function inspectAwc({ input, ...request }) {
  const engine = await tryAwcInspectOnEngine(input);
  if (engine) return engine;
  return runRpfHelper({
    ...request,
    mode: "awc-inspect",
    inputFile: input,
  });
}

export async function tryAwcInspectOnEngine(input, { env = process.env, call = callNativeEngine } = {}) {
  if (!input || !rustAwcInspectEnabled(env)) return null;
  try {
    const result = await call("awc-inspect", { input: path.resolve(String(input)) });
    if (result?.status === "ready") return result;
    return null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "awc",
      message: "Опись банка звуков: движок не взял банк, опись делает помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  }
}

/*
 * Импорт WAV без XML: опись банка движка (шаблоны потоков) и сборка слоя. Выключатель `ASTRAL_RUST_SOUND_IMPORT`.
 * Отказ движка (зашифрованный банк, чужой чанк, не PCM WAV) — `null`: слой собирает хост по XML.
 */
export async function readAwcOnEngine(input, { env = process.env, call = callNativeEngine } = {}) {
  if (!input || !rustSoundImportEnabled(env)) return null;
  try {
    const result = await call("read-awc", { input: path.resolve(String(input)) });
    return result?.bank ? result : null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "sound-import",
      message: "Импорт звука: опись банка не взял движок, слой соберёт помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  }
}

export async function layerFromWavOnEngine({ request, output }, { env = process.env, call = callNativeEngine } = {}) {
  if (!request || !output || !rustSoundImportEnabled(env)) return null;
  try {
    const result = await call("awc-layer-from-wav", {
      request: path.resolve(String(request)),
      output: path.resolve(String(output)),
    });
    return result?.status === "ready" ? result : null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "sound-import",
      message: "Импорт звука: слой не собрал движок, слой соберёт помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  }
}

export function convertAwcToXml({
  input,
  output,
  assetsDirectory,
  ...request
}) {
  return runRpfHelper({
    ...request,
    mode: "awc-to-xml",
    inputFile: input,
    outputFile: output,
    assetsDirectory,
  });
}

export function convertXmlToAwc({
  input,
  output,
  assetsDirectory,
  ...request
}) {
  return runRpfHelper({
    ...request,
    mode: "awc-from-xml",
    inputFile: input,
    outputFile: output,
    assetsDirectory,
  });
}

/**
 * Банк из основы и слоёв дорожек. `drop` слоя — дорожки основы, которые
 * уходят из банка целиком; `limits` — пределы слота памяти игры
 * (`waveSlotBudget`): helper не отдаёт банк, который в слот не помещается.
 */
/*
 * Правка банка потоками на движке (`awc-stream-patch`): тот же запрос, что у помощника, и тот же ответ. Выключатель
 * `ASTRAL_RUST_SOUND_IMPORT` (тот же, что у импорта звука). Движок берёт плоский банк без пика и без шифрования; любой
 * отказ — `null`: банк собирает помощник, он эталон.
 */
export async function patchAwcStreamsOnEngine(
  { input, output, streamPatches, limits },
  { env = process.env, call = callNativeEngine } = {},
) {
  if (!input || !output || !rustSoundImportEnabled(env)) return null;
  let directory = null;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "astral-awc-patch-"));
    const patchesPath = path.join(directory, "patches.json");
    await fs.writeFile(patchesPath, JSON.stringify(streamPatches), "utf8");
    const body = {
      input: path.resolve(String(input)),
      output: path.resolve(String(output)),
      patches: patchesPath,
    };
    if (limits) {
      body.limits = path.join(directory, "limits.json");
      await fs.writeFile(body.limits, JSON.stringify(limits), "utf8");
    }
    const result = await call("awc-stream-patch", body);
    return result?.status === "ready" ? result : null;
  } catch (error) {
    appLog.record({
      level: "info",
      source: "sound-import",
      message: "Правка банка звуков: движок не взял банк, банк собирает помощник.",
      detail: String(error?.message ?? error),
    });
    return null;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function patchAwcStreams({ input, output, patches, limits = null, ...request }) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("At least one AWC stream patch is required.");
  }
  const streamPatches = patches.map((patch) => ({
    source: path.resolve(String(patch.source || "")),
    sha256: patch.sha256 || null,
    streams: [...new Set((patch.streams || []).map(String))],
    drop: [...new Set((patch.drop || []).map(String))],
  }));
  const awcLimits = limits
    ? {
        bytes: limits.bytes ?? null,
        header: limits.header ?? null,
        metadata: limits.metadata ?? null,
        slot: limits.slot ?? null,
      }
    : null;
  const engine = await patchAwcStreamsOnEngine({ input, output, streamPatches, limits: awcLimits });
  if (engine) return engine;
  return runRpfHelper({
    ...request,
    mode: "awc-stream-patch",
    inputFile: input,
    outputFile: output,
    awcStreamPatches: streamPatches,
    awcLimits,
  });
}
