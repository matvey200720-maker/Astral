import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { archiveSupportDirectory } from "./loader-provisioner.js";

/*
 * Записи архива игры — читателем @modovik/rpf7 (только чтение, в процессе).
 *
 * После правки нативным хостом вложенный архив (scaleform_generic.rpf после
 * килл-эффекта, прицела, мини-карты, GPS) остаётся с оглавлением OPEN — его
 * RageLib не пишет NG-оглавление, — а записи в нём по-прежнему зашифрованы
 * NG поштучно. Игра и rpf7 читают их как NG; помощник RPF расшифровывал
 * только AES и NG и отвечал на каждой нетронутой записи «The archive entry
 * was compressed using an unsupported compression method». Так 11.10.2026
 * сначала перестал читаться hud.gfx у прицела, а вечером — mp_gamer_info.gfx
 * у «Полоски HP», 14.10.2026 — «Завод» и «Зоны каптов» после килл-эффекта.
 * Помощник исправлен (`ExportBinaryUncompressed`), а этот читатель — запасной
 * путь для помощника, собранного до исправления (`rpf-composer.js`).
 *
 * Ответ — как у `extractRpfEntries`: `{ extracted: [{ entry, output }] }`;
 * записи, которых в архиве нет, в нём просто не значатся.
 */

const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

async function openArchive(archivePath) {
  const keys = await keysFromDirectory(archiveSupportDirectory()).catch(
    () => null,
  );
  return openRpfFile(archivePath, { keys });
}

export async function readRpfEntriesWithRpf7({
  archivePath,
  entries,
  outputDirectory,
}) {
  const archive = await openArchive(archivePath);
  try {
    await fs.mkdir(outputDirectory, { recursive: true });
    const known = new Set(
      archive.entries.map((item) => normalizeEntry(item.path)),
    );
    const extracted = [];
    for (const [index, raw] of entries.entries()) {
      const entry = normalizeEntry(raw);
      if (!known.has(entry)) continue;
      const output = path.join(
        outputDirectory,
        `${index}-${path.posix.basename(entry)}`,
      );
      const bytes = Buffer.from(await archive.read(entry));
      await fs.writeFile(output, bytes);
      extracted.push({
        /* Путь, как его называет помощник: косые вперёд, без ведущей. */
        entry: String(raw).replaceAll("\\", "/").replace(/^\/+/, ""),
        output,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    return { extracted };
  } finally {
    await archive.close?.();
  }
}

/** Одна запись — в заданный файл (как режим `extract` помощника). */
export async function readRpfEntryWithRpf7({ archivePath, entry, output }) {
  const archive = await openArchive(archivePath);
  try {
    const wanted = normalizeEntry(entry);
    if (!archive.entries.some((item) => normalizeEntry(item.path) === wanted))
      throw new Error(`RPF entry not found: ${entry}`);
    const bytes = Buffer.from(await archive.read(wanted));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, bytes);
    return {
      status: "ready",
      entry: String(entry),
      output,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await archive.close?.();
  }
}
