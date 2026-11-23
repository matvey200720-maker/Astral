/*
 * Настройки облака, с которыми собран Astral.
 *
 * Облачный адрес, хосты пакетов и медиа-хост main-процесс читает из
 * `process.env`: ASTRAL_CLOUD_ORIGIN, ASTRAL_DOWNLOAD_HOSTS,
 * ASTRAL_MEDIA_ORIGIN. Runbook велит задавать их «до сборки», но
 * electron-builder окружение сборки в поставку не переносит: у игрока,
 * запустившего Astral.exe, этих переменных нет. Пустой список хостов
 * пакетов запрещает любой хост (`install-engine/network-policy.js`) — ни
 * один мод не скачивается; без медиа-хоста каталог v2 не спрашивается.
 *
 * Поэтому `after-pack.cjs` записывает значения из окружения сборки в
 * `resources/astral-release.json`, а main-процесс при старте дописывает из
 * него в `process.env` то, чего там нет. Переменная окружения по-прежнему
 * главнее — для проверок на машине разработчика.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const RELEASE_CONFIG_FILE = "astral-release.json";

/* Чистый HTTPS origin: без пути, запроса, фрагмента и учётных данных. */
function httpsOrigin(raw, { trailingSlash = false } = {}) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return null;
  return trailingSlash ? `${url.origin}/` : url.origin;
}

/* Точное имя хоста: без схемы, пути, порта, IP и подстановок. */
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function downloadHosts(raw) {
  const hosts = String(raw || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.every((host) => HOSTNAME.test(host)) ? hosts : null;
}

/**
 * Настройки поставки из окружения сборки. Пустое значение — не задано;
 * заданное, но неверное — ошибка сборки со словами, что не так.
 */
export function releaseConfigFromEnv(env = process.env) {
  const config = {};
  const errors = [];
  if (String(env.ASTRAL_CLOUD_ORIGIN || "").trim()) {
    const origin = httpsOrigin(env.ASTRAL_CLOUD_ORIGIN);
    if (origin) config.cloudOrigin = origin;
    else errors.push("ASTRAL_CLOUD_ORIGIN — не чистый HTTPS origin");
  }
  if (String(env.ASTRAL_DOWNLOAD_HOSTS || "").trim()) {
    const hosts = downloadHosts(env.ASTRAL_DOWNLOAD_HOSTS);
    if (hosts) config.downloadHosts = hosts;
    else
      errors.push(
        "ASTRAL_DOWNLOAD_HOSTS — нужны точные имена хостов через запятую, без схемы, пути, IP и *",
      );
  }
  if (String(env.ASTRAL_MEDIA_ORIGIN || "").trim()) {
    const origin = httpsOrigin(env.ASTRAL_MEDIA_ORIGIN, {
      trailingSlash: true,
    });
    if (origin) config.mediaOrigin = origin;
    else errors.push("ASTRAL_MEDIA_ORIGIN — не чистый HTTPS origin");
  }
  if (errors.length)
    throw new Error(`Настройки поставки Astral: ${errors.join("; ")}.`);
  return config;
}

/** Файл поставки, прочитанный и проверенный заново, или null. */
export function readReleaseConfig(resourcesPath) {
  let raw;
  try {
    raw = readFileSync(path.join(resourcesPath, RELEASE_CONFIG_FILE), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw);
  const keys = ["cloudOrigin", "downloadHosts", "mediaOrigin"];
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error(`${RELEASE_CONFIG_FILE}: неизвестные поля.`);
  return releaseConfigFromEnv({
    ASTRAL_CLOUD_ORIGIN: value.cloudOrigin,
    ASTRAL_DOWNLOAD_HOSTS: Array.isArray(value.downloadHosts)
      ? value.downloadHosts.join(",")
      : value.downloadHosts,
    ASTRAL_MEDIA_ORIGIN: value.mediaOrigin,
  });
}

/**
 * Собранный Astral: настройки поставки — в окружение процесса. Битый файл
 * не мешает старту (загрузки закрыты, как и без файла), причина — в журнале.
 */
export function loadReleaseConfig({
  app,
  env = process.env,
  resourcesPath = process.resourcesPath,
}) {
  if (!app?.isPackaged) return [];
  try {
    return applyReleaseConfig(env, readReleaseConfig(resourcesPath));
  } catch (error) {
    console.error(`Astral: ${error.message}`);
    return [];
  }
}

/**
 * Дописывает настройки поставки в окружение процесса — только то, чего
 * там нет. Возвращает имена дописанных переменных.
 */
export function applyReleaseConfig(env, config) {
  if (!config) return [];
  const values = {
    ASTRAL_CLOUD_ORIGIN: config.cloudOrigin,
    ASTRAL_DOWNLOAD_HOSTS: config.downloadHosts?.join(","),
    ASTRAL_MEDIA_ORIGIN: config.mediaOrigin,
  };
  const applied = [];
  for (const [name, value] of Object.entries(values)) {
    if (!value || String(env[name] || "").trim()) continue;
    env[name] = value;
    applied.push(name);
  }
  return applied;
}
