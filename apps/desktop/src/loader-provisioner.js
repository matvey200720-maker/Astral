import fs from "node:fs/promises";
import { constants as fsConstants, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readResponsePaced } from "@modovik/install-engine/download-pacing.js";
import unzipper from "unzipper";
import { installPinnedLoaderPackage } from "@modovik/install-engine";
import { appPackaged } from "./runtime-paths.js";
/* Инструменты сверяются при каждой подготовке: отпечаток по записи файла
   (задача 6 ТЗ 10.10.2026), а не чтение 53 МБ каждый раз. */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_SUPPORT_BYTES = 64 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([
  "cdn.astral-mods.online",
  "github.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

/*
 * Свои копии на CDN Astral — первыми (решение владельца 15.10.2026): из РФ
 * GitHub и raw.githubusercontent.com отвечают через раз или никак, и набор
 * ключей с загрузчиками не доезжал («could not discover the RPF keys»).
 * Копия лежит по своему sha256 и сверяется теми же размером и суммой, что и
 * файл с GitHub; GitHub остаётся запасным путём, если CDN недоступен.
 */
const ASTRAL_MIRROR_ORIGIN = "https://cdn.astral-mods.online";
const mirrorUrl = (sha256, name) =>
  `${ASTRAL_MIRROR_ORIGIN}/sha256/${sha256}/${name}`;
const sourceUrls = (source) =>
  source.urls?.length ? source.urls : [source.url];

const archiveSupportSource = (name, size, sha256) => {
  const url = `https://raw.githubusercontent.com/dedanab/ArchiveFix-for-GTA/main/${name}`;
  return Object.freeze({
    name,
    size,
    sha256,
    url,
    urls: Object.freeze([mirrorUrl(sha256, name), url]),
  });
};
export const ARCHIVE_SUPPORT_FILES = Object.freeze([
  archiveSupportSource(
    "ArchiveFix.exe",
    682_496,
    "83468b4f222ae516fa288f4cc3701950ef6b6a6af23f15dc676b915773941575",
  ),
  archiveSupportSource(
    "gtav_aes_key.dat",
    32,
    "1bc7625fc374717d47fa98c801562180873294a9d9de9eedb18876a208afe077",
  ),
  archiveSupportSource(
    "gtav_ng_key.dat",
    27_472,
    "3c956b6220627e4350fc9a4f6da1c0269a7aac180093992296c892de5057dcf2",
  ),
  archiveSupportSource(
    "gtav_ng_decrypt_tables.dat",
    278_528,
    "d6fbef9059284a68f617824ea188c74eae11b89f43c68580290f99ce75bb5fee",
  ),
  archiveSupportSource(
    "gtav_ng_encrypt_tables.dat",
    278_528,
    "976be018215b661872fad6ea42b16d88bf855d72919a537b3bc21685907d909e",
  ),
  archiveSupportSource(
    "gtav_ng_encrypt_luts.dat",
    53_477_376,
    "2a99d2bb3462399348e6ff9aec942493c5edd5745f459993c46659cf28d197b8",
  ),
  archiveSupportSource(
    "gtav_hash_lut.dat",
    256,
    "6590a782f6ad62e59d2f41204eb394a2671398509260b7cd9a368d0d9c832010",
  ),
]);

/*
 * Чтение архивов и запись в них — разные потребности одного набора.
 *
 * Открыть NG-архив игры (`update.rpf`, `x64h.rpf`) хосту и окну хватает четырёх
 * мелких файлов — три сотни килобайт. `ArchiveFix.exe` и таблицы шифрования
 * (51 МБ одним файлом) нужны только записи. Раньше набор выдавался целиком или
 * никак: не доехал большой файл, убрал `.exe` антивирус — и мастерская не
 * читала вовсе («could not discover the RPF keys» на свежей машине, фонари,
 * шрифты и эффекты не открывались), хотя всё нужное для чтения лежало бы на
 * диске через секунду.
 */
const READ_KEY_NAMES = Object.freeze([
  "gtav_aes_key.dat",
  "gtav_ng_key.dat",
  "gtav_ng_decrypt_tables.dat",
  "gtav_hash_lut.dat",
]);
export const ARCHIVE_READ_KEY_FILES = Object.freeze(
  ARCHIVE_SUPPORT_FILES.filter(({ name }) => READ_KEY_NAMES.includes(name)),
);

async function fileMatchesSource(directory, { name, size, sha256 }) {
  try {
    const file = path.join(directory, name);
    return (
      (await fs.stat(file)).size === size && (await sha256File(file)) === sha256
    );
  } catch {
    return false;
  }
}

async function verifiedArchiveSupportDirectory(
  directory,
  files = ARCHIVE_SUPPORT_FILES,
) {
  if (!directory) return null;
  const resolved = path.resolve(directory);
  for (const source of files)
    if (!(await fileMatchesSource(resolved, source))) return null;
  return resolved;
}

/*
 * Почему набор не поставился — для человека. Сеть Node отвечает «fetch failed»
 * и прячет настоящий код в `cause` (ENOTFOUND, ETIMEDOUT, UND_ERR_…): без него
 * в журнале «не вышло» и непонятно, сеть это, DNS или сертификат.
 */
function describeFailure(error) {
  const message = String(error?.message || error || "").trim();
  const code = String(error?.cause?.code || error?.code || "").trim();
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

/* Последняя неудача поставки: мост к хосту называет её, когда архив не
   открылся без ключей, — иначе человек видит «не найдены ключи» и не знает,
   что именно не скачалось. Успешная поставка её стирает. `scope` — чья это
   неудача: ключам чтения нужна причина чтения, а не фонового набора записи. */
let lastSupportFailure = null;
export const lastArchiveSupportFailure = (scope = null) =>
  !scope || lastSupportFailure?.scope === scope ? lastSupportFailure : null;

const DOWNLOAD_ATTEMPTS = 3;
/* Предел на файл: минута и ещё секунда на каждые 200 КБ — сеть в 200 КБ/с
   считается нижней границей, ниже загрузка 51 МБ всё равно бессмысленна. */
const downloadTimeoutMs = (size) => 60_000 + Math.ceil(size / 200_000) * 1000;
const pause = (ms) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/* Отказы всех источников одной строкой: «CDN не ответил» и «GitHub не
   ответил» — разные беды, и человеку с поддержкой нужны обе. */
function describeFailures(failures) {
  if (failures.length === 1) return describeFailure(failures[0].error);
  return failures
    .map(({ url, error }) => `${new URL(url).hostname} — ${describeFailure(error)}`)
    .join("; ");
}

async function downloadWithRetries(source, destination, options) {
  const { fetchImpl, signal, retryDelayMs } = options;
  const urls = sourceUrls(source);
  let failures = [];
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    failures = [];
    /* Свой предел каждому источнику: зависший CDN не должен съедать время,
       отведённое запасному. */
    for (const url of urls) {
      signal?.throwIfAborted?.();
      try {
        const limit = AbortSignal.timeout(downloadTimeoutMs(source.size));
        await downloadArchiveSupportFile(
          source,
          url,
          destination,
          fetchImpl,
          signal ? AbortSignal.any([signal, limit]) : limit,
        );
        return;
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push({ url, error });
      }
    }
    if (attempt < DOWNLOAD_ATTEMPTS) await pause(retryDelayMs * attempt);
  }
  throw new Error(
    `ArchiveFix: не удалось скачать ${source.name}: ${describeFailures(failures)}`,
    { cause: failures.at(-1)?.error },
  );
}

async function downloadArchiveSupportFile(
  source,
  url,
  destination,
  fetchImpl,
  signal,
) {
  const response = await fetchImpl(trustedUrl(url), { signal });
  if (!response.ok) {
    throw new Error(
      `ArchiveFix support download failed: HTTP ${response.status}.`,
    );
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (
    declared &&
    (declared !== source.size || declared > MAX_ARCHIVE_SUPPORT_BYTES)
  ) {
    throw new Error(`ArchiveFix support size changed: ${source.name}.`);
  }
  const buffer = await readResponsePaced(response);
  if (
    buffer.length !== source.size ||
    buffer.length > MAX_ARCHIVE_SUPPORT_BYTES ||
    hashBuffer(buffer) !== source.sha256
  ) {
    throw new Error(`ArchiveFix support checksum mismatch: ${source.name}.`);
  }
  const stage = `${destination}.${process.pid}.${randomUUID()}.download`;
  try {
    await fs.writeFile(stage, buffer, { flag: "wx" });
    await fs.rm(destination, { force: true });
    await fs.rename(stage, destination);
  } catch (error) {
    await fs.rm(stage, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Каталог ключей для разработки и стендов (20.11.2026): `MODOVIK_RPF_KEYS_DIR`. Задан и каталог есть — ВСЕ чтения ключей приложения
 * (`archiveSupportDirectory()`: выбор писателя сборки, хвост `rpf-tail.js`, проверка DLC, `rpf7-entries.js`, сборщик RPF) идут туда, а
 * `provisionArchiveSupport` его только читает. В упакованной сборке (бета и альфа у людей) переменная не действует.
 */
export const KEYS_DIR_ENV = "MODOVIK_RPF_KEYS_DIR";

/**
 * Значение переменной как записано (без проверки, что каталог есть: сборщик RPF проверяет его сам и по-прежнему называет отказ); в упакованной
 * сборке — пусто. Упаковку узнаёт `appPackaged` (главный поток — по Электрону, потоки и процессы сборки — по `ASTRAL_APP_PACKAGED`).
 */
export function configuredKeysDirectory({ env = process.env, packaged = appPackaged({ env }) } = {}) {
  if (packaged) return "";
  return String(env?.[KEYS_DIR_ENV] ?? "").trim();
}

const isDirectory = (directory) => {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
};

/** Каталог ключей из переменной: полный путь, если она задана вне упакованной сборки и папка есть; иначе пустая строка (прежнее поведение). */
export function archiveKeysDirectoryOverride(options = {}) {
  const configured = configuredKeysDirectory(options);
  if (!configured) return "";
  const resolved = path.resolve(configured);
  return isDirectory(resolved) ? resolved : "";
}

/**
 * Где лежит набор ArchiveFix. Раздел настроек показывает этот путь человеку, а
 * поставка кладёт файлы туда же: два разных ответа на вопрос «куда» означали
 * бы, что настройки говорят про одну папку, а мастерская читает другую.
 * Единственное исключение — `MODOVIK_RPF_KEYS_DIR` вне упакованной сборки (`archiveKeysDirectoryOverride`).
 */
export function archiveSupportDirectory(options = {}) {
  const override = archiveKeysDirectoryOverride(options);
  if (override) return override;
  const env = options.env ?? process.env;
  const localAppData =
    env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "Astral", "tools", "ArchiveFix");
}

/*
 * Одна поставка на всех. Мастерская читает архивы пачками — окно открывает
 * раздел и спрашивает несколько баз сразу, — и каждое чтение приходило сюда
 * само: десяток одновременных загрузок одних и тех же файлов в одни и те же
 * временные имена. Идущая поставка принимает всех, кто пришёл за ней; с
 * `signal` поставка своя — отмена одного не должна обрывать другого.
 */
const inflightSupport = new Map();

/*
 * Остальной набор — в фоне, когда ключи для чтения уже на месте. Читать он не
 * мешает, а записи (`ArchiveFix.exe`, таблицы шифрования) нужен: раньше он
 * приезжал попутно с первым чтением, и без этого «Применить» в редакторе,
 * который только читал, упиралось бы в «ArchiveFix.exe не установлен». После
 * неудачи следующая попытка — не раньше чем через полчаса: 51 МБ без конца по
 * плохой сети — это не помощь, а нагрузка.
 */
const BACKGROUND_FULL_COOLDOWN_MS = 30 * 60 * 1000;
const backgroundFullAt = new Map();

function warmFullSupport(destination, options) {
  const last = backgroundFullAt.get(destination) || 0;
  if (Date.now() - last < BACKGROUND_FULL_COOLDOWN_MS) return;
  backgroundFullAt.set(destination, Date.now());
  provisionArchiveSupport({ ...options, scope: "full", signal: null }).catch(
    () => {},
  );
}

/**
 * `scope: "read"` — только то, чем читают архивы (4 мелких файла); по умолчанию
 * весь набор, как нужно записи. Уже лежащее на месте и сошедшееся по хешу не
 * качается повторно: оборванная поставка продолжается с того файла, где встала.
 * `files`, `retryDelayMs` и `background` — для тестов: настоящий набор весит
 * 54 МБ, а фоновая догрузка в тесте — лишний хвост после его конца.
 */
export async function provisionArchiveSupport({
  stateDir,
  fetchImpl = globalThis.fetch,
  signal = null,
  scope = "full",
  files = ARCHIVE_SUPPORT_FILES,
  retryDelayMs = 1500,
  background = true,
} = {}) {
  const destination = archiveSupportDirectory();
  const wanted =
    scope === "read"
      ? files.filter(({ name }) => READ_KEY_NAMES.includes(name))
      : files;
  /* Каталог из `MODOVIK_RPF_KEYS_DIR` (стенды, вне упакованной сборки): только чтение — ни докачки, ни копии, ни фоновой поставки полного набора. */
  if (archiveKeysDirectoryOverride()) return readExternalArchiveSupport({ directory: destination, wanted, scope });
  const run = () =>
    stageArchiveSupport({
      destination,
      wanted,
      stateDir,
      fetchImpl,
      signal,
      scope,
      retryDelayMs,
    });
  let result;
  if (signal) result = await run();
  else {
    const key = `${scope}|${destination}`;
    if (!inflightSupport.has(key))
      inflightSupport.set(
        key,
        run().finally(() => inflightSupport.delete(key)),
      );
    result = await inflightSupport.get(key);
  }
  if (scope === "read" && background)
    warmFullSupport(destination, { stateDir, fetchImpl, files, retryDelayMs });
  return result;
}

/**
 * Чужой каталог ключей (`MODOVIK_RPF_KEYS_DIR`): набор сверяется по размеру и контрольной сумме, и всё. Не сошёлся — ошибка с названием
 * переменной, папки и файлов; причина остаётся в `lastArchiveSupportFailure` (мост к хосту называет её, когда архив не открылся).
 */
async function readExternalArchiveSupport({ directory, wanted, scope }) {
  if (await verifiedArchiveSupportDirectory(directory, wanted)) {
    return { status: "ready", directory, cached: true, scope, external: true };
  }
  const missing = [];
  for (const item of wanted) if (!(await fileMatchesSource(directory, item))) missing.push(item.name);
  const error = new Error(
    `Каталог ключей из ${KEYS_DIR_ENV} (${directory}): нет или не сошлись по размеру и сумме: ${missing.join(", ")}. В этом режиме ничего не докачивается и не пишется.`,
  );
  lastSupportFailure = { at: Date.now(), scope, message: describeFailure(error) };
  throw error;
}

async function stageArchiveSupport({
  destination,
  wanted,
  stateDir,
  fetchImpl,
  signal,
  scope,
  retryDelayMs,
}) {
  if (await verifiedArchiveSupportDirectory(destination, wanted)) {
    return { status: "ready", directory: destination, cached: true, scope };
  }
  /* В упакованной сборке `MODOVIK_RPF_KEYS_DIR` не источник (`configuredKeysDirectory`); вне её каталог, который есть, сюда не доходит: его только читают (`readExternalArchiveSupport`). */
  const configured =
    configuredKeysDirectory() ||
    String(process.env.MODOVIK_GTA_KEYS_PATH || "").trim();
  const candidates = [
    configured,
    path.join(
      os.homedir(),
      "Desktop",
      "RPF Explorer Portable",
      "gta-v-archive-fix-main",
      "Main",
      "bin",
      "Release",
      "net48",
    ),
  ].filter(Boolean);
  let source = null;
  for (const candidate of candidates) {
    source = await verifiedArchiveSupportDirectory(candidate, wanted);
    if (source) break;
  }
  try {
    await fs.mkdir(destination, { recursive: true });
    /* Мелкие первыми: ключи для чтения появляются сразу, а не после 51 МБ. */
    for (const item of [...wanted].sort((a, b) => a.size - b.size)) {
      const { name } = item;
      const output = path.join(destination, name);
      if (await fileMatchesSource(destination, item)) continue;
      if (!source) {
        await downloadWithRetries(item, output, {
          fetchImpl,
          signal,
          retryDelayMs,
        });
        continue;
      }
      const stage = `${output}.${process.pid}.${randomUUID()}.stage`;
      try {
        await fs.copyFile(
          path.join(source, name),
          stage,
          fsConstants.COPYFILE_EXCL,
        );
        await fs.rm(output, { force: true });
        await fs.rename(stage, output);
      } catch (error) {
        await fs.rm(stage, { force: true }).catch(() => {});
        throw error;
      }
    }
    if (!(await verifiedArchiveSupportDirectory(destination, wanted))) {
      const missing = [];
      for (const item of wanted)
        if (!(await fileMatchesSource(destination, item)))
          missing.push(item.name);
      throw new Error(
        `Astral ArchiveFix support verification failed after staging: ${missing.join(", ")} — файл не сошёлся или пропал сразу после записи (так делает антивирус).`,
      );
    }
  } catch (error) {
    lastSupportFailure = {
      at: Date.now(),
      scope,
      message: describeFailure(error),
    };
    throw error;
  }
  /* Полная поставка закрывает любой прошлый отказ; чтение — только свой. */
  if (scope === "full" || lastSupportFailure?.scope === "read")
    lastSupportFailure = null;
  return { status: "ready", directory: destination, cached: false, stateDir, scope };
}

/**
 * Каталог ключей, с которым читаются архивы игрока.
 *
 * Чтение зашифрованной записи RPF без ключей на свежих сборках падает с
 * «Astral could not discover the RPF keys»: автопоиск внутри игры находит
 * только AES-ключ, а таблиц NG в ней нет. До этой функции ключи доходили лишь
 * до записи (`install-rpf-patch` брал их у ArchiveFix), а до чтения базы — нет,
 * и «Подготовить» в мастерской умирала на первом же файле: ни воды, ни неба,
 * ни травы, ни оптимизации.
 *
 * Явно переданный каталог побеждает: тесты и probe-скрипты ходят своим.
 * Провал поставки не считается концом — на старых сборках автопоиск работает,
 * и отнимать у них чтение из-за недоступного CDN незачем. Причина провала не
 * теряется: она в `lastArchiveSupportFailure()`, и мост к хосту называет её,
 * когда архив без ключей так и не открылся.
 *
 * Читают архивы четыре мелких файла набора (`scope: "read"`), а не весь набор
 * вместе с 51 МБ таблиц шифрования и `ArchiveFix.exe`, которые нужны записи.
 */
export async function archiveKeysDirectory({
  keys,
  stateDir,
  provision = provisionArchiveSupport,
} = {}) {
  const given = String(keys || "").trim();
  if (given) return given;
  try {
    const support = await provision({ stateDir, scope: "read" });
    return support?.directory || undefined;
  } catch {
    return undefined;
  }
}

/* Архив загрузчика: копия на CDN Astral по сумме архива, затем релиз на
   GitHub (см. ASTRAL_MIRROR_ORIGIN). */
const pinnedLoader = (source) =>
  Object.freeze({
    ...source,
    urls: Object.freeze([
      mirrorUrl(
        source.archiveSha256,
        path.posix.basename(new URL(source.url).pathname),
      ),
      source.url,
    ]),
  });

export const loaderSources = Object.freeze({
  Legacy: Object.freeze([
    pinnedLoader({
      project: "Ultimate ASI Loader",
      version: "9.7.2",
      /* Архив версии, а не тег `x64-latest`: под ним автор перевыпускает
         архив с каждой версией, и закреплённая сумма переставала сходиться —
         «Подготовка GTA V» на новой машине падала (фикс 1 ТЗ 07.10.2026). */
      url: "https://github.com/ThirteenAG/Ultimate-ASI-Loader/releases/download/v9.7.2/Ultimate-ASI-Loader_x64.zip",
      archiveSha256:
        "1c1f9ebf3996df4a4bcf9be0785b9de8f934ef6497f73145602488fc7d8c2909",
      entry: "dinput8.dll",
      output: "dinput8.dll",
      sha256:
        "22fda9c71eaae02460f311bf3441638340ab591586d78f1de213c4819dcb883c",
      size: 3_615_648,
    }),
    pinnedLoader({
      project: "RageOpenV",
      version: "1.0",
      url: "https://github.com/Chiheb-Bacha/RageOpenV/releases/download/v1.0/RageOpenV.zip",
      archiveSha256:
        "c39d574caa9db4462b20110e87a8229e48deeb2819883800c8e54f1c6c80548c",
      entry: "RageOpenV.asi",
      output: "RageOpenV.asi",
      sha256:
        "951d53952dedcfd9375a0cb37814cb8a783f39880b68de8b22f23535deda56f1",
      size: 134_144,
    }),
  ]),
  Enhanced: Object.freeze([
    pinnedLoader({
      project: "Ultimate ASI Loader",
      version: "9.7.2",
      /* Тот же загрузчик под именем xinput1_4.dll (у Enhanced dinput8 не грузится). */
      url: "https://github.com/ThirteenAG/Ultimate-ASI-Loader/releases/download/v9.7.2/Ultimate-ASI-Loader_x64.zip",
      archiveSha256:
        "1c1f9ebf3996df4a4bcf9be0785b9de8f934ef6497f73145602488fc7d8c2909",
      entry: "dinput8.dll",
      output: "xinput1_4.dll",
      sha256:
        "22fda9c71eaae02460f311bf3441638340ab591586d78f1de213c4819dcb883c",
      size: 3_615_648,
    }),
    pinnedLoader({
      project: "RageOpenV",
      version: "1.0",
      url: "https://github.com/Chiheb-Bacha/RageOpenV/releases/download/v1.0/RageOpenV.zip",
      archiveSha256:
        "c39d574caa9db4462b20110e87a8229e48deeb2819883800c8e54f1c6c80548c",
      entry: "RageOpenV.asi",
      output: "RageOpenV.asi",
      sha256:
        "951d53952dedcfd9375a0cb37814cb8a783f39880b68de8b22f23535deda56f1",
      size: 134_144,
    }),
  ]),
});

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function trustedUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !ALLOWED_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new Error("Источник загрузчика не входит в доверенный allowlist.");
  }
  return url;
}

async function fetchPinnedArchive(
  source,
  destination,
  { fetchImpl = globalThis.fetch, signal = null } = {},
) {
  try {
    if ((await sha256File(destination)) === source.archiveSha256) {
      return { cached: true, destination };
    }
  } catch {}

  const failures = [];
  for (const url of sourceUrls(source)) {
    signal?.throwIfAborted?.();
    try {
      const limit = AbortSignal.timeout(downloadTimeoutMs(MAX_ARCHIVE_BYTES));
      const buffer = await fetchPinnedArchiveFrom(
        source,
        url,
        fetchImpl,
        signal ? AbortSignal.any([signal, limit]) : limit,
      );
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.${randomUUID()}.download`;
      try {
        await fs.writeFile(temporary, buffer, { flag: "wx" });
        await fs.rename(temporary, destination);
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      return { cached: false, destination };
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push({ url, error });
    }
  }
  if (failures.length === 1) throw failures[0].error;
  throw new Error(
    `Не удалось скачать ${source.project}: ${describeFailures(failures)}`,
    { cause: failures.at(-1)?.error },
  );
}

async function fetchPinnedArchiveFrom(source, first, fetchImpl, signal) {
  let url = trustedUrl(first);
  let response = null;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetchImpl(url, {
      redirect: "manual",
      headers: { Accept: "application/zip, application/octet-stream" },
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 5) {
        throw new Error(
          `Слишком много перенаправлений при загрузке ${source.project}.`,
        );
      }
      url = trustedUrl(new URL(location, url).toString());
      continue;
    }
    break;
  }
  if (!response?.ok) {
    throw new Error(
      `Не удалось скачать ${source.project}: HTTP ${response?.status || 0}.`,
    );
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_ARCHIVE_BYTES) {
    throw new Error(`Архив ${source.project} превышает допустимый размер.`);
  }
  const buffer = await readResponsePaced(response);
  if (!buffer.length || buffer.length > MAX_ARCHIVE_BYTES) {
    throw new Error(`Архив ${source.project} имеет недопустимый размер.`);
  }
  if (hashBuffer(buffer) !== source.archiveSha256) {
    throw new Error(`Контрольная сумма архива ${source.project} не совпала.`);
  }
  return buffer;
}

async function extractPinnedEntry(source, archivePath, destination) {
  const archive = await unzipper.Open.file(archivePath);
  const matches = archive.files.filter(
    (entry) => entry.type === "File" && entry.path === source.entry,
  );
  if (matches.length !== 1) {
    throw new Error(`В архиве ${source.project} не найден ожидаемый файл.`);
  }
  const entry = matches[0];
  if (entry.uncompressedSize !== source.size) {
    throw new Error(`Размер файла ${source.output} в архиве изменился.`);
  }
  const buffer = await entry.buffer();
  if (buffer.length !== source.size || hashBuffer(buffer) !== source.sha256) {
    throw new Error(`Контрольная сумма файла ${source.output} не совпала.`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.stage`;
  try {
    await fs.writeFile(temporary, buffer, { flag: "wx" });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function provisionOfficialLoaders({
  gameRoot,
  targetId,
  edition,
  stateDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Astral", "cache", "backups")
    : path.join(os.homedir(), ".astral", "backups"),
  fetchImpl = globalThis.fetch,
  signal = null,
  onProgress = null,
  assertRuntimeSafety = null,
}) {
  const sources = loaderSources[edition];
  if (!sources) throw new Error(`Неподдерживаемая редакция GTA V: ${edition}.`);
  const cacheRoot = path.join(stateDir, "loader-cache");
  const packageRoot = path.join(
    stateDir,
    "loader-packages",
    edition.toLowerCase(),
    "1.0.0-pinned.1",
  );
  const acquired = [];
  for (const [index, source] of sources.entries()) {
    await assertRuntimeSafety?.({ phase: "loader-download" });
    onProgress?.({
      phase: "loader-download",
      percent: Math.round((index / sources.length) * 70),
      project: source.project,
    });
    const archivePath = path.join(cacheRoot, `${source.archiveSha256}.zip`);
    const downloaded = await fetchPinnedArchive(source, archivePath, {
      fetchImpl,
      signal,
    });
    const destination = path.join(packageRoot, source.output);
    await extractPinnedEntry(source, archivePath, destination);
    acquired.push({
      project: source.project,
      version: source.version,
      cached: downloaded.cached,
      archiveSha256: source.archiveSha256,
      sha256: source.sha256,
    });
  }
  await assertRuntimeSafety?.({ phase: "loader-install" });
  const result = await installPinnedLoaderPackage({
    packageRoot,
    gameRoot,
    targetId,
    edition,
    stateDir,
    signal,
    assertRuntimeSafety,
    onProgress: (progress) =>
      onProgress?.({
        ...progress,
        percent: 70 + Math.round(progress.percent * 0.3),
      }),
  });
  onProgress?.({ phase: "complete", percent: 100 });
  return {
    manifestId: `astral-loader-${edition.toLowerCase()}`,
    edition,
    acquired,
    result,
  };
}
