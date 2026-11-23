/*
 * Источник «проект» в мастерской «Анимации» (14.11.2026, этап 10 «анимации один в один»): словари анимаций серверов — «GTA 5 RP» и «Nova RP» — как готовый список рядом с анимациями игры
 * и своими файлами. Индекс (словарь, клипы, группа, длительность, пол, парность, sha256, размер) строится из дампа (`scripts/server-dump/anim-project-index.mjs`) и лежит рядом с кодом,
 * `project-index/<проект>.json`; читается только главным процессом (потоком чтения), окну он не виден. Сами файлы словарей — с раздачи Astral по sha256: хэш и размер берутся из индекса,
 * файл сверяется и кладётся в кэш приложения (`animations/project/<sha256>.ycd`) — второй раз та же анимация читается с диска.
 *
 * Файл словаря на раздаче: `<ASTRAL_MEDIA_ORIGIN>/sha256/<sha256>/animation.ycd` (ключ — `cdnKey` в `anim-project-index.mjs`). Адрес и список доверенных хостов — из настроек сборки
 * (`ASTRAL_MEDIA_ORIGIN`, `ASTRAL_DOWNLOAD_HOSTS`, `release-config.js`); перенаправление на чужой хост не выполняется. Пока файла на раздаче нет, анимация проекта в списке стоит, а при выборе
 * называет причину. Чужие данные тут не расшифровываются и не меняются: словарь только читается.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { appLog } from "../app-log.js";
import { parseDownloadHostAllowlist } from "../electron-boundary.js";
import {
  animationId,
  classifyOwnClip,
  hiddenClip,
  humanizeAnimation,
} from "./animation-catalog.js";
import { sectionRank } from "./animation-index.js";
import { isPairedName } from "./pair-words.js";

/** Проекты и их имена в окне: имена собственные, на всех языках одни. */
export const PROJECTS = Object.freeze({
  gta5rp: Object.freeze({ title: "GTA 5 RP" }),
  novarp: Object.freeze({ title: "Nova RP" }),
});

const SOURCE = /^project:(gta5rp|novarp)$/;
const HASH = /^[0-9a-f]{64}$/;
/** Раздача по умолчанию — когда сборка не задала `ASTRAL_MEDIA_ORIGIN` (разработка); в закрытой сборке адрес вшит настройками сборки. */
export const PROJECT_CDN_FALLBACK = "https://cdn.astral-mods.online";
/** Предел размера одного словаря, если индекса нет под рукой (самый большой в дампах — 6,7 МБ). Точный размер — из индекса. */
export const PROJECT_MAX_BYTES = 32 * 1024 * 1024;
const FLAG_NOT_HUMAN = 1;
const FLAG_LAYERED = 2;
const FLAG_MOVER = 4;
/** Тишина дольше этого — обрыв: ни ответа, ни очередного куска тела. Общий таймаут на всю загрузку не ставится — медленный канал не обрывается. */
export const DOWNLOAD_IDLE_MS = 30_000;
const DOWNLOAD_TRIES = 3;
const RETRY_DELAYS_MS = [0, 700, 2000];
const MAX_REDIRECTS = 3;

const refusal = (code, message) => Object.assign(new Error(message), { code });

const MESSAGE_OFFLINE =
  "Не получилось скачать анимацию проекта: проверьте интернет и повторите.";
const MESSAGE_MISSING =
  "Эту анимацию проекта ещё не выложили на сервер Astral.";
const MESSAGE_BROKEN =
  "Скачанная анимация проекта не сошлась с описью и не используется.";
const MESSAGE_NO_ENTRY = "Такой анимации проекта нет.";

/** Откуда качаются файлы: адрес раздачи из настроек сборки (чистый HTTPS origin), иначе раздача по умолчанию. */
export function projectOrigin(env = process.env) {
  const raw = String(env?.ASTRAL_MEDIA_ORIGIN || "").trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && !url.username && !url.password)
        return url.origin;
    } catch {
      /* не адрес — остаётся раздача по умолчанию */
    }
  }
  return PROJECT_CDN_FALLBACK;
}

/** Доверенные хосты загрузки: список настроек сборки (`ASTRAL_DOWNLOAD_HOSTS`), а без него — хост раздачи. */
export function trustedProjectHosts(env = process.env) {
  const listed = parseDownloadHostAllowlist(env?.ASTRAL_DOWNLOAD_HOSTS);
  return new Set(
    listed.length ? listed : [new URL(projectOrigin(env)).hostname],
  );
}

/** Адрес файла словаря по sha256. */
export const projectDictionaryUrl = (sha256, env = process.env) =>
  `${projectOrigin(env)}/sha256/${sha256}/animation.ycd`;

/** Запись из окна → проверенная по формату `{ source, project, clip, sha256 }`; пути и адреса из окна не принимаются, только хэш. Есть ли хэш в индексе проекта — решает `projectDictionaryFile`. */
export function checkProjectEntry(entry) {
  const source = String(entry?.source || "");
  const match = SOURCE.exec(source);
  const clip = String(entry?.clip || "");
  const sha256 = String(entry?.sha256 || "").toLowerCase();
  if (!match || !clip || clip.length > 200 || !HASH.test(sha256))
    throw refusal("ANIMATION_ENTRY", MESSAGE_NO_ENTRY);
  const bytes = Number(entry?.bytes);
  return {
    source,
    project: match[1],
    clip,
    sha256,
    bytes:
      Number.isFinite(bytes) && bytes > 0 && bytes <= PROJECT_MAX_BYTES
        ? bytes
        : 0,
  };
}

/* Индексы проектов: `{ gta5rp, novarp }`, читаются один раз на процесс. Не прочитались — это ошибка, а не «проектов нет»: пишется в журнал приложения, раздел проекта в этот раз пуст. */
let defaultIndexes = null;
async function loadDefaultIndexes() {
  defaultIndexes ||= import("./project-index/index.js").then(
    (module) => module.PROJECT_INDEXES,
    (error) => {
      appLog.record({
        level: "error",
        source: "animations",
        message: `Анимации проектов: индекс не прочитался (${error?.code || error?.message || error})`,
      });
      return {};
    },
  );
  return defaultIndexes;
}

const valid = (index, project) =>
  index?.schema === 1 &&
  index.project === project &&
  Array.isArray(index.dictionaries)
    ? index
    : null;

/** Индекс проекта или `null` (нет или не тот). `indexes` — для проверок. */
export async function readProjectIndex(project, indexes = null) {
  const all = indexes || (await loadDefaultIndexes());
  const index = valid(all?.[project], project);
  if (!index && all?.[project])
    appLog.record({
      level: "error",
      source: "animations",
      message: `Анимации проектов: индекс «${project}» неверного вида — раздел пуст`,
    });
  return index;
}

/** Для проверок: забыть прочитанные индексы. */
export const resetProjectIndexMemo = () => {
  defaultIndexes = null;
};

/** Запись индекса по sha256 внутри проекта источника: `{ sha256, bytes, … }` или `null`. */
const byHash = new WeakMap();
async function indexedDictionary(project, sha256, indexes) {
  const index = await readProjectIndex(project, indexes);
  if (!index) return null;
  if (!byHash.has(index))
    byHash.set(
      index,
      new Map(index.dictionaries.map((item) => [item.sha256, item])),
    );
  return byHash.get(index).get(sha256) || null;
}

/** Записи окна по индексу проекта: клипы словарей как анимации (`source: "project:<проект>"`); служебные клипы лица в список не идут. */
export function projectEntries(project, index) {
  const title = PROJECTS[project]?.title || project;
  const entries = [];
  const used = new Set();
  for (const dictionary of index.dictionaries) {
    for (const [clip, seconds, flags] of dictionary.clips) {
      if (hiddenClip(clip)) continue;
      const human = !(flags & FLAG_NOT_HUMAN);
      let id = animationId(`project-${project}`, dictionary.name, clip);
      /* Один словарь под одним именем в разных паках — разный хэш: id тогда дополняется началом хэша. */
      if (used.has(id)) id = `${id}~${dictionary.sha256.slice(0, 8)}`;
      used.add(id);
      entries.push({
        id,
        source: `project:${project}`,
        dictionary: dictionary.name,
        clip,
        name: humanizeAnimation("", clip) || clip,
        section: human ? classifyOwnClip(clip) : "other",
        ...(human ? {} : { human: false }),
        pack: title,
        sha256: dictionary.sha256,
        bytes: dictionary.bytes,
        seconds,
        group: dictionary.group,
        ...(dictionary.gender ? { gender: dictionary.gender } : {}),
        /* Парность — по словам имени (границы слов, `pair-words.js`), а не по группе описи с подстроками. */
        ...(isPairedName(dictionary.name, clip) ? { paired: true } : {}),
        ...(flags & FLAG_LAYERED ? { layers: true } : {}),
        ...(flags & FLAG_MOVER ? { mover: true } : {}),
      });
    }
  }
  return entries;
}

/** Все записи проектов, что есть в индексах: людей вперёд, предметы и камеры в конец. */
export async function listProjectEntries(indexes = null) {
  const entries = [];
  for (const project of Object.keys(PROJECTS)) {
    const index = await readProjectIndex(project, indexes);
    if (index) entries.push(...projectEntries(project, index));
  }
  entries.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      sectionRank(a.section) - sectionRank(b.section) ||
      a.name.localeCompare(b.name, "en") ||
      a.id.localeCompare(b.id),
  );
  return entries;
}

export const projectCacheFolder = (stateDir) =>
  path.join(stateDir, "animations", "project");
const cachePath = (stateDir, sha256) =>
  path.join(projectCacheFolder(stateDir), `${sha256}.ycd`);
const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/* Запрос с ручной обработкой перенаправлений: каждый адрес — https и из списка доверенных хостов, иначе запрос не уходит. */
async function requestTrusted(url, fetchImpl, hosts, signal) {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = new URL(at);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      !hosts.has(target.hostname.toLowerCase())
    )
      throw refusal("ANIMATION_PROJECT_BROKEN", MESSAGE_BROKEN);
    const answer = await fetchImpl(target.href, {
      redirect: "manual",
      signal,
      headers: {
        Accept: "application/octet-stream",
        /* Без сжатия: счёт байтов идёт по тому, что пришло, а не по тому, что распаковалось. */
        "Accept-Encoding": "identity",
      },
    });
    if (answer.status >= 300 && answer.status < 400) {
      const location = answer.headers?.get?.("location");
      if (!location || hop === MAX_REDIRECTS)
        throw refusal("ANIMATION_PROJECT_OFFLINE", MESSAGE_OFFLINE);
      at = new URL(location, target).href;
      continue;
    }
    return answer;
  }
  throw refusal("ANIMATION_PROJECT_OFFLINE", MESSAGE_OFFLINE);
}

/* Тело ответа: поток со счётчиком байт — обрыв на `limit`, тишина дольше `idleMs` — обрыв запроса. Ответ без потока (проверки) читается целиком и сверяется после. */
async function readBody(answer, limit, controller, idleMs) {
  const reader = answer.body?.getReader?.();
  if (!reader) {
    const whole = Buffer.from(await answer.arrayBuffer());
    if (whole.length > limit)
      throw refusal("ANIMATION_PROJECT_BROKEN", MESSAGE_BROKEN);
    return whole;
  }
  /* Остановка по тишине рвёт и зависшее чтение, каким бы ни был поток: гонка с сигналом. */
  const stopped = new Promise((_, reject) =>
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("aborted")),
      { once: true },
    ),
  );
  const chunks = [];
  let total = 0;
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleMs);
  };
  try {
    for (;;) {
      arm();
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        controller.abort();
        throw refusal("ANIMATION_PROJECT_BROKEN", MESSAGE_BROKEN);
      }
      chunks.push(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      );
    }
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks, total);
}

/* Одна попытка. Всё сетевое — запрос, перенаправления, тело — внутри одной обработки: обрыв на середине тела («terminated») такая же «нет сети», как обрыв запроса. */
async function downloadOnce(record, fetchImpl, env, idleMs) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), idleMs);
  try {
    const answer = await requestTrusted(
      projectDictionaryUrl(record.sha256, env),
      fetchImpl,
      trustedProjectHosts(env),
      controller.signal,
    );
    clearTimeout(timer);
    timer = null;
    if (answer.status === 404 || answer.status === 403)
      throw refusal("ANIMATION_PROJECT_MISSING", MESSAGE_MISSING);
    if (!answer.ok) throw refusal("ANIMATION_PROJECT_OFFLINE", MESSAGE_OFFLINE);
    const declared = Number(answer.headers?.get?.("content-length"));
    if (declared > record.bytes)
      throw refusal("ANIMATION_PROJECT_BROKEN", MESSAGE_BROKEN);
    const bytes = await readBody(answer, record.bytes, controller, idleMs);
    if (bytes.length !== record.bytes || sha256Of(bytes) !== record.sha256)
      throw refusal("ANIMATION_PROJECT_BROKEN", MESSAGE_BROKEN);
    return bytes;
  } catch (error) {
    if (error?.code?.startsWith?.("ANIMATION_PROJECT_")) throw error;
    /* Прочее — сеть: нет соединения, обрыв тела, остановка по тишине. */
    throw refusal("ANIMATION_PROJECT_OFFLINE", MESSAGE_OFFLINE);
  } finally {
    clearTimeout(timer);
  }
}

/* Скачиваемые сейчас: две плитки одного словаря ждут одну загрузку. */
const downloading = new Map();

/**
 * Файл словаря проекта: из кэша приложения или скачанный с раздачи. Хэш и размер берутся из индекса проекта записи (`source`): хэша там нет — «такой анимации нет», и не качается ничего. Скачанное и лежащее в кэше сверяется
 * по размеру и sha256: подмена, обрыв — отказ, файл не остаётся. `fetchImpl` и `options` (`env`, `idleMs`, `retryDelaysMs`, `indexes`) — для проверок.
 */
export async function projectDictionaryFile(
  entry,
  { stateDir, indexes = null, env = process.env } = {},
  fetchImpl = globalThis.fetch,
  { idleMs = DOWNLOAD_IDLE_MS, retryDelaysMs = RETRY_DELAYS_MS } = {},
) {
  const { project, sha256 } = checkProjectEntry(entry);
  const record = await indexedDictionary(project, sha256, indexes);
  if (!record) throw refusal("ANIMATION_ENTRY", MESSAGE_NO_ENTRY);
  const file = cachePath(stateDir, sha256);
  const cached = await fs.readFile(file).catch(() => null);
  if (cached && cached.length === record.bytes && sha256Of(cached) === sha256)
    return file;
  if (!downloading.has(sha256)) {
    const work = (async () => {
      let last;
      for (let attempt = 0; attempt < DOWNLOAD_TRIES; attempt += 1) {
        const wait = retryDelaysMs[attempt] ?? 0;
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        try {
          const bytes = await downloadOnce(record, fetchImpl, env, idleMs);
          await fs.mkdir(path.dirname(file), { recursive: true });
          /* Во временный файл и переименованием: под своим именем в кэше только целый (как у словарей игры). */
          const part = file.replace(
            /\.ycd$/,
            `.${process.pid}-${randomUUID()}.part.ycd`,
          );
          try {
            await fs.writeFile(part, bytes);
            await fs.rename(part, file).catch(async (error) => {
              if (
                !(await fs.readFile(file).then(
                  (got) => sha256Of(got) === sha256,
                  () => false,
                ))
              )
                throw error;
            });
          } finally {
            await fs.rm(part, { force: true }).catch(() => {});
          }
          return file;
        } catch (error) {
          last = error;
          /* Нет файла на раздаче или он не сошёлся — повторять нечего; сеть — ещё раз. */
          if (error?.code !== "ANIMATION_PROJECT_OFFLINE") throw error;
        }
      }
      throw last;
    })();
    downloading.set(sha256, work);
    work.then(
      () => downloading.delete(sha256),
      () => downloading.delete(sha256),
    );
  }
  return downloading.get(sha256);
}
