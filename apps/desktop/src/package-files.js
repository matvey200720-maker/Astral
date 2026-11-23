/*
 * Файлы пакета мастерской на диск — разом и без переименования свежих
 * файлов (ТЗ 06.10.2026, вечер, задача 1).
 *
 * Сборщики наборов (места, вода, шрифты…) писали каждый файл пакета через
 * временный и переименование — по одному. Только что записанный файл держит
 * проверка Защитника Windows, и переименование ждёт её конца: на ПК
 * владельца 3000 свежих файлов переименовывались 16 с. Здесь:
 *   • новый файл пишется сразу на своё место (флаг `wx`): папка пакета
 *     названа отпечатком его содержимого, а оборванная запись не пройдёт
 *     сверку SHA-256 манифеста при установке — и перепишется заново;
 *   • меняется существующий — через временный файл с повтором подмены;
 *   • файлы пишутся параллельно, а их отпечатки запоминаются: движок при
 *     установке берёт их из памяти, а не перечитывает пакет.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { renameWithRetry } from "@modovik/install-engine/engine-state.js";
import { rememberSha256 } from "@modovik/install-engine/file-fingerprint.js";
import { mapLimit } from "@modovik/install-engine/map-limit.js";
import { governedPause } from "@modovik/install-engine/disk-governor.js";
import { smallFileLimit } from "@modovik/install-engine/disk-profile.js";

async function replaceFile(target, bytes) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await renameWithRetry(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * `entries` — `[{ target, bytes, sha256? }]`. Одинаковый файл не
 * переписывается; отпечаток (переданный или посчитанный) запоминается.
 */
export async function writePackageFiles(entries, { limit = entries[0] ? smallFileLimit(entries[0].target, { fast: 16 }) : 16 } = {}) {
  for (const directory of new Set(entries.map((entry) => path.dirname(entry.target))))
    await fs.mkdir(directory, { recursive: true });
  await mapLimit(entries, limit, async ({ target, bytes, sha256 }) => {
    await governedPause(target);
    const digest = sha256 || createHash("sha256").update(bytes).digest("hex");
    const current = await fs.readFile(target).catch(() => null);
    if (!current || !current.equals(bytes)) {
      if (!current) {
        try {
          await fs.writeFile(target, bytes, { flag: "wx" });
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          await replaceFile(target, bytes);
        }
      } else await replaceFile(target, bytes);
    }
    await rememberSha256(target, digest);
  });
}
