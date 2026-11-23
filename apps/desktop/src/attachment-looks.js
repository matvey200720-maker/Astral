/*
 * «Вид из каталога» у обвеса оружия (ТЗ 23.10.2026, п. C, часть 2).
 *
 * У обвеса на стволе (глушитель, прицел, фонарь, рукоять, магазин) можно выбрать не модель из игры, а модель из мода
 * каталога: мод кладёт свой `w_at_pi_supp.ydr` с текстурами, и в кадре и в игре встаёт он. Окно присылает по кости
 * подписанный манифест мода (`{ bone: { manifest, baseUrl } }`), главный процесс качает пакет тем же доверенным путём,
 * что установка (`downloadSignedPackage`: подпись, sha256, разрешённые хосты), и оставляет у себя только `.ydr` и `.ytd`
 * в своей папке (`attachment-looks/<мод@версия>`): второй раз пакет не качается, а скачивается только выбранный мод.
 *
 * Дальше «вид» — это `part.look` у части обвеса: поиск в архивах игры (`locateGameWeaponModelFiles`) для файлов,
 * что вид принёс, не идёт, а модель и словарь берутся из папки вида. Чего вид не принёс (чаще словаря), берётся
 * из игры, как раньше. Модели обвеса, под которую выбран вид, в моде нет — отказ словами, а не молча другая деталь.
 *
 * Пути в папку вида окну не верят. Сборка скина идёт в потоке, куда запрос приходит копией, поэтому «выдан нашим
 * разбором» проверяется по самой папке: она называется `attachment-looks/<ключ мода@версии>` (`trustedLook`), а имена
 * файлов берутся из таблицы обвеса (`componentFiles`), а не из запроса. Подделать так можно разве что путь к
 * файлу с именем модели обвеса в такой же папке — читать из неё нечего, кроме .ydr и .ytd.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { downloadSignedPackage } from "@modovik/install-engine";
import { componentFiles } from "@modovik/rpf-inspector/weapon-attachments";

const MOD_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const BONE = /^[A-Za-z0-9_]{1,48}$/;
const LOOK_FILE = /\.(ydr|ytd)$/i;
const MODEL_NAME = /^[a-z0-9][a-z0-9_]{2,79}$/;
const FOLDER = "attachment-looks";
/* Обвесов в паке — не больше потолка каталога (`@modovik/gunpack`, ATTACHMENT_MODELS_LIMIT). */
const MAX_MODELS = 200;
/* Видов на стволе — не больше, чем костей у самого увешанного MK2. */
const MAX_LOOKS = 8;
/* Папок видов у себя — ровно столько, дальше старые уходят. */
const KEPT_LOOKS = 32;

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Ключ папки вида: мод и его версия. */
export const lookKey = (id, version) =>
  createHash("sha256").update(`${id}@${version}`).digest("hex").slice(0, 24);

/**
 * Запрос окна в границах формы: `{ кость: { id, version, name, manifest, baseUrl } }`. Мод и версию называет
 * подписанный манифест, а не окно.
 */
export function normalizeLookRequests(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [bone, look] of Object.entries(value)) {
    const id = String(look?.manifest?.id || "");
    const version = String(look?.manifest?.version || "");
    if (!BONE.test(bone) || !MOD_ID.test(id) || !version) continue;
    /* Пак (ТЗ 24.10.2026, п. 6): окно называет модели его обвесов — из пакета берутся только их файлы. */
    const models = (Array.isArray(look?.models) ? look.models : [])
      .map((name) => String(name || "").toLowerCase())
      .filter((name) => MODEL_NAME.test(name))
      .slice(0, MAX_MODELS);
    result[bone] = {
      id,
      version,
      name: String(look?.name || id).slice(0, 80),
      manifest: look.manifest,
      baseUrl: String(look?.baseUrl || ""),
      ...(models.length ? { models } : {}),
    };
    if (Object.keys(result).length >= MAX_LOOKS) break;
  }
  return result;
}

const exists = (file) =>
  fs
    .stat(file)
    .then(() => true)
    .catch(() => false);

/* Скачивание одного мода идёт один раз, сколько бы кадров, картинок и установок его ни просило. */
const inFlight = new Map();

async function forgetOldLooks(root, keep) {
  const names = await fs.readdir(root).catch(() => []);
  if (names.length <= KEPT_LOOKS) return;
  const dated = [];
  for (const name of names) {
    if (name === keep || name.endsWith(".partial")) continue;
    const stat = await fs.stat(path.join(root, name)).catch(() => null);
    if (stat) dated.push({ name, time: stat.mtimeMs });
  }
  dated.sort((left, right) => left.time - right.time);
  for (const old of dated.slice(0, Math.max(0, names.length - KEPT_LOOKS)))
    await fs.rm(path.join(root, old.name), { recursive: true, force: true }).catch(() => {});
}

async function downloadLook(look, deps) {
  const root = path.join(deps.stateDir, FOLDER);
  const folder = path.join(root, lookKey(look.id, look.version));
  if (await exists(folder)) {
    const now = new Date();
    await fs.utimes(folder, now, now).catch(() => {});
    return folder;
  }
  const downloaded = await (deps.download || downloadSignedPackage)({
    manifest: look.manifest,
    baseUrl: look.baseUrl,
    publicKey: deps.publicKey,
    stateDir: deps.stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: deps.onProgress || null,
  });
  const packageRoot = path.resolve(downloaded.packageRoot);
  /* Файлы обвесов пака по таблице игры: модель, её `_hi`, словарь текстур и `+hi`; остальное из пакета — не нужно. */
  const wanted = look.models?.length
    ? new Set(look.models.flatMap((model) => Object.values(componentFiles(model))))
    : null;
  const files = (downloaded.manifest?.files || look.manifest.files || [])
    .filter((file) => file?.source && file.action !== "delete")
    .map((file) => ({
      from: path.resolve(packageRoot, file.source),
      /* В пакете файл лежит с номером, а в игре называется по `entry`. */
      name: path.basename(String(file.entry || file.source)).toLowerCase(),
    }))
    .filter((file) => file.from.startsWith(packageRoot + path.sep) && LOOK_FILE.test(file.name))
    .filter((file) => !wanted || wanted.has(file.name));
  if (!files.length)
    throw refusal("ATTACHMENT_LOOK_EMPTY", `В моде «${look.name}» нет моделей обвесов (.ydr, .ytd).`);
  const staging = `${folder}.partial`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  const taken = new Set();
  try {
    for (const { from, name } of files) {
      if (taken.has(name)) continue;
      taken.add(name);
      await fs.copyFile(from, path.join(staging, name));
    }
    await fs.rename(staging, folder);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await forgetOldLooks(root, path.basename(folder));
  return folder;
}

function fetchLook(look, deps) {
  const key = lookKey(look.id, look.version);
  if (!inFlight.has(key)) {
    const pending = downloadLook(look, deps).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return inFlight.get(key);
}

/**
 * Запрос окна → готовые виды: `{ кость: { id, version, name, dir, names } }`, где `names` — файлы вида строчными
 * именами. `deps` — `{ stateDir, downloadsDir, publicKey, allowedHosts, allowInsecureLocalhost, download?, onProgress? }`.
 * Пусто, если окно видов не просило.
 */
export async function resolveLooks(value, deps) {
  const requests = normalizeLookRequests(value);
  const looks = {};
  for (const [bone, request] of Object.entries(requests)) {
    const dir = await fetchLook(request, deps);
    looks[bone] = {
      id: request.id,
      version: request.version,
      name: request.name,
      dir,
      names: (await fs.readdir(dir)).map((name) => name.toLowerCase()),
    };
  }
  return looks;
}

/** Запрос `input` с готовыми видами вместо манифестов; без видов — `input` как есть, без поля `looks`. */
export async function withResolvedLooks(input, deps) {
  if (!input || typeof input !== "object" || !input.looks) return input;
  const looks = await resolveLooks(input.looks, deps);
  const { looks: _raw, ...rest } = input;
  return Object.keys(looks).length ? { ...rest, looks } : rest;
}

/**
 * Разборщик запросов для обработчиков IPC: `(input) → input` с готовыми видами. Подпись каталога и хосты пакетов —
 * те же, что у «Взять в «Мои паки»» (`catalogPackages`); запрос без видов не трогается и каталога не требует.
 */
export function createLooksResolver({ installOptions, catalogPackages = null }) {
  return async (input) => {
    if (!input?.looks) return input;
    if (!catalogPackages) throw new Error("Каталог недоступен в этой сборке.");
    const storage = await installOptions();
    const trust = catalogPackages();
    return withResolvedLooks(input, {
      stateDir: storage.stateDir,
      downloadsDir: storage.downloadsDir,
      publicKey: await trust.publicKey(),
      allowedHosts: trust.allowedHosts,
      allowInsecureLocalhost: trust.allowInsecureLocalhost,
    });
  };
}

/* Вид выдан нашим разбором: папка `attachment-looks/<ключ>`, ключ — по моду и версии самого вида. */
function trustedLook(look) {
  const dir = typeof look?.dir === "string" ? look.dir : "";
  return (
    path.isAbsolute(dir) &&
    path.basename(path.dirname(dir)) === FOLDER &&
    path.basename(dir) === lookKey(String(look.id || ""), String(look.version || "")) &&
    Boolean(look.names) &&
    typeof look.names[Symbol.iterator] === "function"
  );
}

/* Файлы вида для модели обвеса: роль → `{ role, name, path }`. */
function lookFilesFor(look, model) {
  const names = componentFiles(model);
  const have = new Set(look.names);
  return [
    ["model", names.model],
    ["texture", names.textures],
    ["model-hi", names.modelHi],
    ["texture-hi", names.texturesHi],
  ]
    .filter(([, name]) => have.has(name))
    .map(([role, name]) => ({ role, name, path: path.join(look.dir, name) }));
}

/**
 * Части обвесов с видом из каталога: `part.look = { id, version, name, files }`. Вид — только у выбранной части той
 * кости, под которую он выбран, и только готовый (`resolveLooks`). Нет модели обвеса в моде — отказ словами.
 */
export function attachLooks(parts, looks) {
  if (!looks || typeof looks !== "object") return parts;
  return parts.map((part) => {
    const look = part.chosen === false ? null : looks[part.bone];
    if (!look || !trustedLook(look)) return part;
    const files = lookFilesFor(look, part.component.model);
    if (!files.some((file) => file.role === "model"))
      throw refusal(
        "ATTACHMENT_LOOK_ABSENT",
        `В моде «${look.name}» нет модели этого обвеса (${part.component.model}.ydr) — выберите другой вид или «Как в игре».`,
      );
    return { ...part, look: { id: look.id, version: look.version, name: look.name, files } };
  });
}

/** Подпись видов частей — в ключ кэша собранной модели: другой мод или версия — другая модель. */
export const looksSignature = (parts) =>
  parts
    .filter((part) => part.look)
    .map((part) => `${part.bone}=${part.look.id}@${part.look.version}`)
    .sort()
    .join(";");

/** Файлы вида части байтами: `[{ name, role, bytes }]` — для ствола пака, где обвесы собираются из байтов. */
export async function readLookFiles(part) {
  const files = [];
  for (const file of part.look?.files || [])
    files.push({ name: file.name, role: file.role, bytes: new Uint8Array(await fs.readFile(file.path)) });
  return files;
}
