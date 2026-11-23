/*
 * «Access to the path … is denied» от нативного хоста — словами и с причиной.
 *
 * Бета 14.10.2026 (Windows 10, игра на `D:\Grand Theft Auto V Legacy`): три
 * установки подряд (килл-эффект, эффекты попадания) падали строкой .NET
 * «Access to the path '…\update\.astral-stage-…' is denied» — хост не смог
 * создать рабочую папку рядом с `update.rpf`. Окно отвечало общим «нет прав»,
 * а в журнале не было ничего, что отличает три разных причины:
 *   — у учётной записи нет прав на папку игры (чужой владелец, права из
 *     Program Files): не даёт Windows всем, и приложению тоже;
 *   — антивирус или «Контролируемый доступ к папкам» блокирует именно
 *     помощника: приложение создаёт файл и папку там же без труда;
 *   — папка только для чтения.
 * Различает их проба из самого приложения: после отказа оно пробует создать
 * в той же папке пустую папку и пустой файл и тут же убирает их.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DENIED = /Access to the path '([^']+)' is denied|Отказано в доступе по пути ['«]([^'»]+)['»]/i;

/* Папка, где хост получил отказ: у `…\update\.astral-stage-…` — это `update`. */
export function deniedFolder(message) {
  const match = DENIED.exec(String(message || ""));
  const target = match?.[1] || match?.[2];
  if (!target) return null;
  /* Путь из ответа хоста всегда виндовый, где бы ни шёл разбор (тесты на Mac). */
  return /\.astral-stage/i.test(path.win32.basename(target)) ? path.win32.dirname(target) : target;
}

/** Что приложению можно в папке: создать папку, создать файл. Следов не оставляет. */
export async function probeFolderAccess(folder, { id = randomUUID().slice(0, 8) } = {}) {
  const found = { exists: true, createFolder: false, createFile: false };
  try {
    await fs.access(folder);
  } catch {
    return { ...found, exists: false };
  }
  const probeFolder = path.join(folder, `.astral-probe-${id}`);
  try {
    await fs.mkdir(probeFolder);
    found.createFolder = true;
  } catch {
    /* отказ — и есть ответ */
  } finally {
    if (found.createFolder) await fs.rmdir(probeFolder).catch(() => {});
  }
  const probeFile = path.join(folder, `.astral-probe-${id}.tmp`);
  try {
    await fs.writeFile(probeFile, "");
    found.createFile = true;
  } catch {
    /* отказ — и есть ответ */
  } finally {
    if (found.createFile) await fs.rm(probeFile, { force: true }).catch(() => {});
  }
  return found;
}

const REMEDY =
  "Откройте Свойства → Безопасность папки игры и дайте своей учётной записи «Полный доступ» " +
  "(с заменой прав во вложенных папках) либо запустите Astral от имени администратора, затем нажмите «Повторить».";

function adviceFor(folder, found) {
  if (!found?.exists) return null;
  if (found.createFolder && found.createFile)
    return (
      `Windows не дал помощнику Astral создать рабочую папку в ${folder}, хотя самому приложению это ` +
      "разрешено. Так делает антивирус или «Контролируемый доступ к папкам» Защитника Windows: " +
      "добавьте папку %LOCALAPPDATA%\\Astral и Astral в исключения (разрешённые приложения), затем нажмите «Повторить»."
    );
  if (found.createFile)
    return `Windows разрешает Astral создавать в ${folder} файлы, но не папки — у вашей учётной записи нет прав на эту папку игры. ${REMEDY}`;
  return (
    `Windows не даёт Astral создавать файлы и папки в ${folder}: у вашей учётной записи нет прав на эту папку игры ` +
    `(её скопировали с чужими правами, она в Program Files или принадлежит другому пользователю). ${REMEDY}`
  );
}

/**
 * Ошибка хоста с отказом в доступе — ошибкой со словами и причиной; всё
 * остальное возвращается как есть. Исходная строка остаётся в скобках: по ней
 * окно относит отказ к семейству «нет прав на запись».
 */
export async function explainFolderDenied(error, { probe = probeFolderAccess } = {}) {
  const raw = String(error?.message || error || "");
  const folder = deniedFolder(raw);
  if (!folder) return error;
  let found = null;
  try {
    found = await probe(folder);
  } catch {
    /* проба — подсказка, а не условие */
  }
  const advice = adviceFor(folder, found);
  if (!advice) return error;
  const explained = new Error(`${advice} (${raw})`);
  explained.code = "ASTRAL_FOLDER_DENIED";
  explained.cause = error;
  explained.probe = found;
  return explained;
}
