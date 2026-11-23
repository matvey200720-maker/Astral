/*
 * «Интерьеры проектов» — пакеты интерьеров с CDN Astral (решение владельца
 * 17.10.2026, вечер: интерьеры Majestic и GTA 5 РП раздаются всем игрокам).
 *
 * Пак проекта — мод облачного каталога v2 (раздел `project-interiors`), его
 * пакет — файлы проекта под подписью каталога. Окно показывает список из
 * каталога (`climb-contract/recolor/project-interiors-packs.js`), берёт у
 * облака грант и присылает сюда манифест с адресом; всё остальное — здесь:
 *
 *   — подпись манифеста, хосты CDN и sha256 каждого файла проверяет тот же
 *     `downloadSignedPackage`, что у обычной установки (с докачкой после
 *     обрыва, проверкой места на диске и повтором при потере связи);
 *   — манифест обязан быть пакетом данных интерьеров: возможность
 *     `project-interiors-data-v1`, имя `projint-…` своего проекта, слот
 *     проекта. Мод это быть не может: как мод пакет не ставится ни одним путём;
 *   — файлы ложатся в `<хранилище>/project-interiors/cdn/<проект>/<пак>/<версия>/`,
 *     а сам каталог — один источник `astral` проекта: сканер читает каждый пак
 *     отдельно, как папку игрока (`catalog.js`), и дальше всё работает как с
 *     файлами игрока — кадр, цвет и блеск, «Установить».
 *
 * Окно путей не называет и не получает: оно говорит «проект» и «пак».
 */

import fs from "node:fs/promises";
import path from "node:path";
import { downloadSignedPackage } from "@modovik/install-engine";
import { isProjectInteriorsDataManifest } from "@modovik/install-engine/project-interiors-data.js";
import {
  PROJECT_PACK_SLOTS,
  projectOfPackSlug,
} from "@modovik/climb-contract/recolor/project-interiors-packs";
import { SourceError, cdnRootOf, ensureAstralSource, readSources } from "./store.js";

/* Пак — не больше этого (самый крупный у владельца 180 МБ; предел облака — 4 ГиБ). */
export const PACK_BYTES_LIMIT = 1024 ** 3;
export const PACK_FILES_LIMIT = 4999;
/* Сколько паков качается одновременно. */
export const ACTIVE_LIMIT = 2;
const INTERIOR_ID = /^p[0-9a-f]{8}$/;
const VERSION = /^[0-9a-z][0-9a-z.+-]{0,63}$/;

/* Что качается прямо сейчас: `<проект>/<пак>` → { state, percent, downloadedBytes, totalBytes, message, controller }. */
const active = new Map();

const refuse = (code, message) => new SourceError(code, message);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const text = (value, limit) => (typeof value === "string" ? value.replace(CONTROL, " ").trim().slice(0, limit) : "");

/* Имена интерьеров пака из подписанного манифеста: `{ <номер>: { label, place } }`. */
function interiorsOf(manifest) {
  const out = {};
  for (const item of Array.isArray(manifest?.interiors) ? manifest.interiors.slice(0, 200) : []) {
    if (!item || !INTERIOR_ID.test(String(item.id || ""))) continue;
    out[item.id] = {
      label: text(item.label, 80),
      place: (Array.isArray(item.place) ? item.place : []).slice(0, 4).map((word) => text(word, 60)).filter(Boolean),
    };
  }
  return out;
}

/**
 * Пакеты проекта, скачанные целиком: `[{ slug, version, dir, bytes, files,
 * interiors }]`. Целиком — значит, рядом с файлами лежит `manifest.json`: его
 * `downloadSignedPackage` пишет последним, так что недокачанный пак в список
 * не попадает.
 */
export async function listFetched(stateDir, project) {
  const root = cdnRootOf(stateDir, project);
  const found = [];
  for (const slug of await fs.readdir(root).catch(() => [])) {
    if (projectOfPackSlug(slug) !== project) continue;
    for (const version of await fs.readdir(path.join(root, slug)).catch(() => [])) {
      if (!VERSION.test(version)) continue;
      const dir = path.join(root, slug, version);
      let manifest;
      try {
        manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
      } catch {
        continue;
      }
      if (manifest?.id !== slug || !isProjectInteriorsDataManifest(manifest) || !Array.isArray(manifest.files)) continue;
      found.push({
        slug,
        version,
        dir,
        bytes: manifest.files.reduce((sum, file) => sum + (Number(file?.size) || 0), 0),
        files: manifest.files.length,
        interiors: interiorsOf(manifest),
      });
    }
  }
  /* Две версии одного пака — читается свежая (по порядку версий). */
  const latest = new Map();
  for (const pack of found.sort((a, b) => a.version.localeCompare(b.version, "en", { numeric: true }))) latest.set(pack.slug, pack);
  return [...latest.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Что окну нужно знать про пакеты: скачанные и идущие сейчас. */
export async function readCdnState(input, stateDir) {
  const project = projectIn(input);
  return {
    project,
    fetched: (await listFetched(stateDir, project)).map(({ slug, version, bytes, files }) => ({ slug, version, bytes, files })),
    active: [...active.entries()]
      .filter(([key]) => key.startsWith(`${project}/`))
      .map(([key, entry]) => ({ slug: key.slice(project.length + 1), state: entry.state, percent: entry.percent, downloadedBytes: entry.downloadedBytes, totalBytes: entry.totalBytes, message: entry.message })),
  };
}

function projectIn(input) {
  const project = String(input?.project || "");
  if (!PROJECT_PACK_SLOTS[project]) throw refuse("bad-project", "Неизвестный проект.");
  return project;
}

function slugIn(input, project) {
  const slug = String(input?.slug || "");
  if (projectOfPackSlug(slug) !== project) throw refuse("bad-pack", "Такого пакета интерьеров нет.");
  return slug;
}

/** Манифест — пакет данных именно этого пака этого проекта (подпись проверит скачивание). */
export function checkPackManifest(manifest, project, slug) {
  if (!manifest || typeof manifest !== "object" || manifest.id !== slug) throw refuse("bad-pack", "Манифест не этого пакета.");
  if (!isProjectInteriorsDataManifest(manifest)) throw refuse("not-a-pack", "Это не пакет интерьеров проекта.");
  if (!Array.isArray(manifest.slots) || !manifest.slots.includes(PROJECT_PACK_SLOTS[project])) throw refuse("bad-pack", "Пакет не этого проекта.");
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > PACK_FILES_LIMIT) throw refuse("bad-pack", "В пакете нет файлов или их слишком много.");
  if (!VERSION.test(String(manifest.version || ""))) throw refuse("bad-pack", "Версия пакета не по форме.");
}

/**
 * Скачивает пак. `input`: `{ project, slug, manifest, baseUrl }` — манифест и
 * адрес из гранта облака. `deps`: `{ publicKey, allowedHosts,
 * allowInsecureLocalhost, download? }` — ключ каталога и хосты CDN, как у
 * остальных скачиваний каталога. Повтор после обрыва продолжает с того байта,
 * где встало; готовый пак повторно не качается.
 */
export async function fetchPack(input, stateDir, deps = {}) {
  const project = projectIn(input);
  const slug = slugIn(input, project);
  checkPackManifest(input?.manifest, project, slug);
  const key = `${project}/${slug}`;
  if (active.has(key)) throw refuse("busy", "Этот пакет уже скачивается.");
  if (active.size >= ACTIVE_LIMIT) throw refuse("busy", "Сначала дождитесь, пока докачаются другие пакеты.");
  const totalBytes = input.manifest.files.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
  if (totalBytes > PACK_BYTES_LIMIT) throw refuse("too-big", "Пакет больше допустимого размера.");
  const controller = new AbortController();
  const entry = { state: "downloading", percent: 0, downloadedBytes: 0, totalBytes, message: "", controller };
  active.set(key, entry);
  try {
    await (deps.download || downloadSignedPackage)({
      manifest: input.manifest,
      baseUrl: String(input.baseUrl || ""),
      publicKey: deps.publicKey,
      stateDir,
      downloadsDir: cdnRootOf(stateDir, project),
      allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
      allowedHosts: deps.allowedHosts ?? null,
      maxFileBytes: PACK_BYTES_LIMIT,
      maxTotalBytes: PACK_BYTES_LIMIT,
      projectInteriorsData: true,
      signal: controller.signal,
      onProgress: (progress) => {
        entry.percent = Math.max(0, Math.min(100, Math.round((progress.fraction ?? 0) * 100)));
        entry.downloadedBytes = Number(progress.downloadedBytes) || entry.downloadedBytes;
        if (progress.retrying) entry.message = "retrying";
        else if (entry.message === "retrying") entry.message = "";
      },
    });
    await ensureAstralSource(stateDir, project);
    return { slug, version: String(input.manifest.version), files: input.manifest.files.length, bytes: totalBytes };
  } catch (error) {
    if (controller.signal.aborted) throw refuse("cancelled", "Скачивание отменено.");
    throw error;
  } finally {
    active.delete(key);
  }
}

/** Отменяет идущее скачивание пака (начатый файл стирается: докачка нужна только после обрыва связи). */
export function cancelFetch(input) {
  const project = projectIn(input);
  const slug = slugIn(input, project);
  const entry = active.get(`${project}/${slug}`);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

/** Убирает скачанный пак с диска; интерьеры из него пропадают из каталога при следующем чтении. */
export async function removeFetched(input, stateDir) {
  const project = projectIn(input);
  const slug = slugIn(input, project);
  if (active.has(`${project}/${slug}`)) throw refuse("busy", "Пакет ещё скачивается — отмените загрузку.");
  const root = cdnRootOf(stateDir, project);
  const target = path.join(root, slug);
  if (path.dirname(target) !== root) throw refuse("bad-pack", "Такого пакета нет.");
  const existed = await fs.stat(target).then((stat) => stat.isDirectory(), () => false);
  await fs.rm(target, { recursive: true, force: true });
  return existed;
}

/** Есть ли у проекта источник «Астрал» (после первого скачанного пакета). */
export async function hasAstralSource(stateDir, project) {
  return (await readSources(stateDir)).some((item) => item.project === project && item.kind === "astral");
}
