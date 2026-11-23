/*
 * Облачные шапки из игры игрока — для кадра неба.
 *
 * Выбор «какие облака бывают» без настоящих облаков в кадре — выбор вслепую:
 * «перистые» и «барашки» отличаются рисунком, а рисунок лежит в листах
 * `v_clouds.rpf`. Нативный хост выкладывает модели шапок и их листы
 * (`extract-cloud-hats`), здесь выкладка кэшируется и отдаётся окну: опись с
 * вершинами — одним ответом, листы — по имени, когда шапку показывают.
 *
 * Данные Rockstar никуда не уезжают: выкладка лежит в кэше на машине игрока
 * под хешем папки игры (путь содержит имя пользователя Windows) и читается
 * его же окном. В поставке Astral их нет.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  archiveKeysDirectory,
  provisionArchiveSupport,
} from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
});

/* Опись шапок — пара мегабайт вершин; десятки — уже не опись. */
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
/* Лист шапки — до 2048×1024 PNG; больше — не лист шапки. */
const MAX_TEXTURE_BYTES = 12 * 1024 * 1024;
const TEXTURE_NAME = /^[\w-]{1,96}$/;

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

const cacheDirectory = (stateDir, gameRoot) =>
  path.join(
    stateDir || os.tmpdir(),
    "cloud-hats",
    createHash("sha256")
      .update(path.resolve(gameRoot).toLowerCase())
      .digest("hex")
      .slice(0, 16),
  );

async function archiveKeys(input, stateDir, tools) {
  const { archiveSupport } = { ...defaultTools(), ...tools };
  return archiveKeysDirectory({
    keys: input?.keys,
    stateDir,
    provision: archiveSupport,
  });
}

async function readManifest(directory) {
  const file = path.join(directory, "hats.json");
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  if (stat.size > MAX_MANIFEST_BYTES)
    throw new RangeError("Опись облачных шапок неправдоподобно велика.");
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/**
 * Опись облачных шапок: модели с вершинами и имена листов.
 *
 * Первый вызов вскрывает архив (три-четыре секунды), дальнейшие читают кэш.
 * `refresh` — выложить заново (игру обновили или поставили мод облаков).
 */
const usable = (manifest) => Boolean(manifest?.drawables && manifest?.textures);
/* Версия выкладки (`version` в hats.json, CloudHatCommands.cs). До 2 листы
   нормалей BC5 выкладывались испорченными (декодер CodeWalker писал зелёный
   в красный) — такой кэш выкладываем заново. */
const MANIFEST_VERSION = 2;
const current = (manifest) =>
  usable(manifest) && Number(manifest.version) >= MANIFEST_VERSION;

export async function readCloudHats(input, context, stateDir, tools = {}) {
  const { native } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const directory = cacheDirectory(stateDir, gameRoot);
  let manifest = input?.refresh ? null : await readManifest(directory).catch(() => null);
  let source = "cache";
  /* Битая или устаревшая выкладка в кэше не должна держать ошибку вечно:
     выкладываем заново. */
  if (!current(manifest)) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(directory, { recursive: true });
    const keys = await archiveKeys(input, stateDir, tools);
    await native("extract-cloud-hats", { gameRoot, output: directory, keys }, context);
    manifest = await readManifest(directory);
    source = "game";
  }
  if (!usable(manifest))
    throw new Error("В архивах игры не нашлось облачных шапок.");
  return { source, manifest };
}

/** Один лист шапки по имени — байты PNG. */
export async function readCloudHatTexture(input, context, stateDir) {
  const gameRoot = requireGameRoot(input);
  const name = String(input?.name || "");
  if (!TEXTURE_NAME.test(name)) throw new Error("Недопустимое имя листа облаков.");
  const directory = cacheDirectory(stateDir, gameRoot);
  const manifest = await readManifest(directory);
  const entry = Object.entries(manifest?.textures || {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  if (!entry?.file || !/^[\w-]+\.png$/i.test(entry.file))
    throw new Error(`Лист облаков «${name}» не выложен.`);
  const file = path.join(directory, entry.file);
  const stat = await fs.stat(file);
  if (stat.size > MAX_TEXTURE_BYTES)
    throw new RangeError(`Лист облаков «${name}» неправдоподобно велик.`);
  const bytes = await fs.readFile(file);
  // Отдельный ArrayBuffer: Buffer из fs может смотреть в общий пул, и срез
  // по IPC утащил бы за собой чужую память.
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
