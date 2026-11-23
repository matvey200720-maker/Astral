/*
 * Где лежит «образ» режима Rockstar: архивы с модами, пока игра закрыта,
 * копии оригинала Rockstar, журнал фаз, метки (05.11.2026).
 *
 * Раньше образ жил в `<игра>\.astral-swap` — внутри папки, которую сверяет
 * лаунчер Rockstar. Теперь он лежит снаружи, на ТОМ ЖЕ диске (переименование
 * между папками одного диска мгновенное и ничего не пишет):
 *
 *   1. `<диск игры>\Astral\rockstar-mode\<id игры>`;
 *   2. запасное место, если корень диска писать нельзя, —
 *      `%LOCALAPPDATA%\Astral\rockstar-mode\<id игры>` (но только на том же диске:
 *      копировать гигабайты на другой диск молча нельзя — отказ словами).
 *
 * Адрес выводится из пути игры, а не из привязки: его находят и окно, и
 * агент, не зная настроек друг друга. Образ узнаётся по метке `store.json`
 * (кто писал последним — тот и привязал). Пока метки нет, а в игре лежит
 * прежний `.astral-swap`, работаем в нём; `migrateLegacyImage` переносит
 * его переименованием.
 *
 * `ASTRAL_ROCKSTAR_MODE_ROOT` — свой корень образов (тесты и отладка).
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MODE_ROOT_ENV = "ASTRAL_ROCKSTAR_MODE_ROOT";
export const STORE_MARKER = "store.json";
export const LEGACY_FOLDER = ".astral-swap";

/** Короткое имя образа игры: имя папки и отпечаток полного пути. */
export function imageId(gameRoot) {
  const root = path.resolve(String(gameRoot || ""));
  const slug = path.basename(root).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 24).toLowerCase() || "game";
  return `${slug}-${createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 10)}`;
}

/** Прежнее место образа — внутри папки игры. */
export const legacyFolder = (gameRoot) => path.join(path.resolve(String(gameRoot || "")), LEGACY_FOLDER);

/** Места для образа в порядке предпочтения. */
export function imageFolderCandidates(gameRoot, env = process.env) {
  const root = path.resolve(String(gameRoot || ""));
  const id = imageId(root);
  if (env[MODE_ROOT_ENV]) return [path.join(path.resolve(env[MODE_ROOT_ENV]), id)];
  if (process.platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return [path.join(path.parse(root).root, "Astral", "rockstar-mode", id), path.join(local, "Astral", "rockstar-mode", id)];
  }
  return [path.join(os.homedir(), ".astral", "rockstar-mode", id)];
}

/**
 * Папка образа, как её видят сейчас: привязанная (с меткой), иначе прежняя
 * внутри игры (если есть), иначе первое из мест. Не создаёт ничего.
 */
export function imageFolderSync(gameRoot, env = process.env) {
  const candidates = imageFolderCandidates(gameRoot, env);
  for (const folder of candidates) if (existsSync(path.join(folder, STORE_MARKER))) return folder;
  const legacy = legacyFolder(gameRoot);
  if (existsSync(legacy)) return legacy;
  return candidates[0];
}

/** Образ уже на новом месте (а не в прежнем `.astral-swap`)? */
export const imageBound = (gameRoot, env = process.env) => imageFolderCandidates(gameRoot, env).some((folder) => existsSync(path.join(folder, STORE_MARKER)));

async function nearestExisting(target) {
  let current = path.resolve(target);
  for (;;) {
    const stat = await fs.stat(current).catch(() => null);
    if (stat?.isDirectory()) return { folder: current, stat };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function writeMarker(folder, gameRoot, now) {
  const stage = path.join(folder, `${STORE_MARKER}.${process.pid}.stage`);
  await fs.writeFile(stage, JSON.stringify({ format: "astral.rockstar-mode", version: 1, gameRoot: path.resolve(gameRoot), boundAt: now().toISOString() }, null, 2));
  await fs.rename(stage, path.join(folder, STORE_MARKER));
}

const DENIED = new Set(["EACCES", "EPERM", "EROFS"]);

/**
 * Привязать образ: найти или создать папку на том же диске и поставить метку.
 * Отказ — с кодом `ROCKSTAR_MODE_OTHER_VOLUME` (негде, кроме другого диска) или
 * `ROCKSTAR_MODE_NOT_WRITABLE` (нет прав ни в корне диска, ни в запасном месте).
 */
export async function bindImageFolder(gameRoot, { env = process.env } = {}) {
  const root = path.resolve(String(gameRoot || ""));
  const candidates = imageFolderCandidates(root, env);
  for (const folder of candidates) if (existsSync(path.join(folder, STORE_MARKER))) return { folder, created: false };
  const game = await fs.stat(root);
  const problems = new Set();
  for (const folder of candidates) {
    const parent = await nearestExisting(path.dirname(folder));
    if (!parent || parent.stat.dev !== game.dev) {
      problems.add("other-volume");
      continue;
    }
    try {
      await fs.mkdir(folder, { recursive: true });
      /* Метка ставится позже: до неё образ «ещё не привязан» (перенос прежнего). */
      await fs.access(folder, fs.constants.W_OK);
      return { folder, created: true, pending: true };
    } catch (error) {
      if (!DENIED.has(error?.code)) throw error;
      problems.add("not-writable");
    }
  }
  const code = problems.has("not-writable") ? "ROCKSTAR_MODE_NOT_WRITABLE" : "ROCKSTAR_MODE_OTHER_VOLUME";
  throw Object.assign(new Error(code === "ROCKSTAR_MODE_NOT_WRITABLE" ? "Нет прав на папку образа режима Rockstar." : "Образ режима Rockstar можно держать только на диске игры."), { code, candidates });
}

/* Перенос содержимого `from` в `to` переименованиями; существующее в `to` не затирается. */
async function moveInto(from, to) {
  await fs.mkdir(to, { recursive: true });
  let leftovers = 0;
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    const there = await fs.stat(target).catch(() => null);
    if (!there) await fs.rename(source, target);
    else if (entry.isDirectory() && there.isDirectory()) {
      leftovers += await moveInto(source, target);
      await fs.rmdir(source).catch(() => {});
    } else leftovers += 1;
  }
  return leftovers;
}

/**
 * Привязать образ и перенести в него прежний `.astral-swap` (если он есть).
 * Идемпотентна: прерванный перенос при следующем вызове доносит остальное.
 * `{ folder, migrated }`.
 */
export async function ensureImageFolder(gameRoot, { env = process.env, now = () => new Date() } = {}) {
  const bound = await bindImageFolder(gameRoot, { env });
  const legacy = legacyFolder(gameRoot);
  let migrated = false;
  if (existsSync(legacy)) {
    const leftovers = await moveInto(legacy, bound.folder);
    if (!leftovers) await fs.rm(legacy, { recursive: true, force: true });
    migrated = true;
  }
  if (!existsSync(path.join(bound.folder, STORE_MARKER))) await writeMarker(bound.folder, gameRoot, now);
  return { folder: bound.folder, migrated };
}

/** Убрать образ целиком (режим выключен, моды вернулись): метка и папка уходят вместе. */
export async function removeImageFolder(gameRoot, { env = process.env } = {}) {
  for (const folder of imageFolderCandidates(gameRoot, env)) await fs.rm(folder, { recursive: true, force: true });
  await fs.rm(legacyFolder(gameRoot), { recursive: true, force: true });
}
