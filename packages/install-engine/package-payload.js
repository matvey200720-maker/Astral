import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { abortError } from "./buffered-copy.js";
import { WORKER_MIN_BYTES, copyFileOffThread } from "./copy-off-thread.js";
import { diskTurn, throttledOp } from "./disk-care.js";
import { governedPause } from "./disk-governor.js";
import { diskKind, smallFileLimit } from "./disk-profile.js";
import { renameWithRetry } from "./engine-state.js";
import { copyWriteLimitBytes, sharedWritePacer } from "./write-pacing.js";
import { createSymlinkGuard } from "./fs-guards.js";
import { mapLimit } from "./map-limit.js";
import { throwIfAborted } from "./runtime-guard.js";
import { exists } from "./storage-state.js";
import { resolveInside } from "./manifest.js";
import { fingerprintSha256, rememberSha256 } from "./file-fingerprint.js";

/*
 * Файл пакета — в хранилище движка (05.10.2026). Пакет растительности,
 * собранный самим Astral в его же папке состояния, ложится туда жёсткой
 * ссылкой (`link`): вторая копия двух с половиной гигабайт была ни к чему.
 * Остальное — копией: файл, который его хозяин может переписать на месте,
 * не должен переписать заодно и хранилище того, что установлено.
 */
async function storePayload(sourcePath, cachePath, stateDir, { link = false, move = false, size = 0, sha256 = "", signal = null } = {}) {
  const owned = path.relative(path.resolve(stateDir), path.resolve(sourcePath));
  const ours = owned && !owned.startsWith("..") && !path.isAbsolute(owned);
  /*
   * Загрузка, которую после установки всё равно удалят (кэш загрузок выключен, 02.11.2026):
   * она переезжает в хранилище переименованием — минус чтение и запись размера пакета.
   * Отпечаток сверен до этого (`fingerprintSha256` в `preparePackageFiles`), а переименование
   * атомарно: под именем-отпечатком не бывает недописанного файла. Другой том, файл занят —
   * копия, как прежде.
   */
  if (move && ours) {
    if (signal?.aborted) throw abortError(signal);
    try {
      await fs.rename(sourcePath, cachePath);
      return "move";
    } catch {
      /* Копия ниже. */
    }
  }
  if (link && ours) {
    try {
      await fs.link(sourcePath, cachePath);
      return "link";
    } catch {
      /* Другой том или файловая система без ссылок — копия, как прежде. */
    }
  }
  /* Копия — под временным именем и переименованием: недописанный файл под именем-отпечатком выдал бы себя за готовый (`exists` ниже). */
  const temporary = `${cachePath}.${randomUUID()}.stage`;
  try {
    if (size >= WORKER_MIN_BYTES && (copyWriteLimitBytes() || process.platform === "win32")) {
      /* Большой файл идёт потоком (`disk-care.js`, `write-pacing.js`): по одному, сквозь кэш системы, потолок общий с остальными копиями, отмена доходит до куска, а отпечаток считается
         по тем же байтам, что пишутся, — второго чтения нет, и подмену файла между проверкой и укладкой это ловит. Без потолка на Windows так же: системная копия пишет всё разом. */
      const copied = await copyFileOffThread(sourcePath, temporary, { signal });
      if (sha256 && copied.sha256 !== sha256) throw new Error("Контрольная сумма не совпала при укладке файла пакета.");
    } else {
      if (signal?.aborted) throw abortError(signal);
      const copy = async () => {
        await throttledOp(size);
        await fs.copyFile(sourcePath, temporary);
      };
      /* Медленный диск: мелкие тоже своей очередью и с отдыхом (`disk-care.js`). Остальным — как раньше. */
      await (diskKind(cachePath) === "slow" ? diskTurn(copy, { signal }) : copy());
      /* Мелкие файлы и запись без потолка — целым вызовом системы; потолок учитывает их после, и следующая копия ждёт своей очереди на общей ленте. */
      await sharedWritePacer().wrote(size);
    }
    await renameWithRetry(temporary, cachePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return "copy";
}

/*
 * Проверка и укладка файлов пакета — разом (ТЗ 06.10.2026, вечер): у пакета
 * «Ухудшения текстур» сорок с лишним тысяч файлов, и проверки путей,
 * отпечатки и ссылки в хранилище по одному занимали минуту. Те же проверки
 * идут параллельно (каталоги пути проверяются один раз за операцию),
 * одинаковые файлы укладываются один раз, первая ошибка останавливает
 * остальное. Ответ — по файлу пакета в его порядке: `null` у удаления,
 * иначе `{ actualHash, cachePath }`; состояние установка меняет сама и
 * строго по порядку.
 */
export async function preparePackageFiles({ files, root, sourceRoot, payloadDir, stateDir, link = false, moveSources = false, signal }) {
  const guard = createSymlinkGuard();
  const storing = new Map();
  /* Переезжает только файл, который назван в пакете один раз: второму его упоминанию нужен тот же файл на месте. */
  const named = new Map();
  const sourceKey = (file) => {
    try {
      return path.resolve(resolveInside(sourceRoot, file.source)).toLowerCase();
    } catch {
      return null;
    }
  };
  /* Путь, который не разобрался, — никто не переезжает: нельзя сказать, не тот же ли это файл. */
  let moves = moveSources;
  if (moves)
    for (const file of files) {
      if (file.action === "delete") continue;
      const key = sourceKey(file);
      if (!key) moves = false;
      else named.set(key, (named.get(key) || 0) + 1);
    }
  const movable = (file) => moves && named.get(sourceKey(file)) === 1;
  const folders = new Map();
  const folder = (directory) => {
    if (!folders.has(directory)) folders.set(directory, fs.mkdir(directory, { recursive: true }));
    return folders.get(directory);
  };
  /* Сколько файлов разом — по диску, куда они ложатся: на жёстком диске 64 — это сплошные перемещения головок (`disk-profile.js`). */
  return mapLimit(files, smallFileLimit(payloadDir), async (file) => {
    throwIfAborted(signal);
    /* Регулятор диска: диск занят больше цели — пачка ждёт (`disk-governor.js`); без регулятора это ничего не стоит. */
    await governedPause(payloadDir, { signal });
    if (file.action === "delete") {
      await guard(root, file.target);
      return null;
    }
    await guard(sourceRoot, file.source, { includeLeaf: true });
    const sourcePath = resolveInside(sourceRoot, file.source);
    /* Одно чтение записи вместо «есть ли» + «что это». */
    const sourceStat = await fs.lstat(sourcePath).catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`Файл пакета не найден: ${file.source}`);
      throw error;
    });
    if (!sourceStat.isFile()) throw new Error(`Payload должен быть обычным файлом: ${file.source}`);
    await guard(root, file.target);
    /* Отпечаток, который приложение запомнило, когда писало пакет, — без
       второго чтения (растительность — два с половиной гигабайта). */
    const actualHash = await fingerprintSha256(sourcePath);
    if (file.sha256 && file.sha256 !== actualHash) throw new Error(`Контрольная сумма не совпала: ${file.source}`);
    const cachePath = path.join(payloadDir, actualHash);
    if (!storing.has(cachePath))
      storing.set(
        cachePath,
        (async () => {
          if (await exists(cachePath)) return;
          await folder(path.dirname(cachePath));
          await storePayload(sourcePath, cachePath, stateDir, { link, move: movable(file), size: sourceStat.size, sha256: actualHash, signal });
          await rememberSha256(cachePath, actualHash);
        })(),
      );
    await storing.get(cachePath);
    return { actualHash, cachePath };
  });
}
