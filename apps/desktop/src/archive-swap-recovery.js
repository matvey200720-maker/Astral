/*
 * Подмена архива, оборванная посреди (задача 1 ТЗ 10.10.2026).
 *
 * Архив игры подменяется переименованиями: нативный хост переносит живой
 * `update.rpf` в `update.rpf.astral-backup`, собранный — на его место и
 * удаляет прежний; транзакция движка — живой в `<архив>.astral-old-<id>`,
 * собранный из `<архив>.astral-stage-<id>`. Между двумя переименованиями
 * архива в игре нет вовсе. Выключили свет, упала система, закрыли Astral из
 * диспетчера задач — и игра оставалась без update.rpf, а Astral при
 * следующем запуске говорил «update/update.rpf is missing. Repair GTA V»
 * (журнал транзакции движок восстанавливает сам, хост журнала не ведёт).
 * Рядом оставались двухгигабайтные временные файлы.
 *
 * Откат Rust-движка (`restore-rpf-point`) окна без файла не оставляет: рядом
 * с живым архивом готовится копия точки (`<архив>.astral-restore`), прежний
 * живой файл остаётся жёсткой ссылкой (`<архив>.astral-current`), затем копия
 * переименовывается поверх живого. Оборванный откат оставляет эти имена.
 *
 * При запуске, до любой записи в игру, здесь:
 *   • архива нет, а прежний лежит рядом (`.astral-backup`, `.astral-current`,
 *     единственный `.astral-old-*`) — прежний возвращается на место: игра как
 *     была до оборванной операции;
 *   • архив на месте — прежний рядом лишний (подмена прошла, удаление не
 *     успело), он уходит; уходят и брошенные `.astral-stage-*` и
 *     `.astral-restore` (недокопированную копию точки подставлять нельзя).
 *
 * Смотрятся только папки, где Astral подменяет архивы: корень игры и
 * `update`. Своя идущая транзакция в этот момент невозможна: восстановление
 * идёт при запуске, до окна.
 *
 * «До» рядом (`<архив>.astral-before-<точка>`, установка из операций,
 * `restore-point-beside.js`) — не остаток подмены, а копия живой точки: её тут
 * не возвращают и не убирают как остаток. Убираются только брошенные, чья
 * точка уже убрана или недописана дольше шести часов, и только если папка точек
 * на месте (`sweepOrphanBeforeBeside`, `sweepBesideCopies`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { defaultRestorePointsRoot, nativeRestorePointsRoot } from "./native-restore-chain.js";
import { sweepBesideCopies } from "./restore-point-beside.js";

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

const STAGE_DIRECTORY = /^\.astral-stage-[0-9a-f-]{8,}$/i;
const ENGINE_LEFTOVER = /^(.+?\.rpf)\.astral-(old|stage)-[0-9a-f-]{8,}$/i;
/*
 * Недописанная подготовка архива: `<архив>.astral-stage-<id>.<id>.stage` (живой Electron, 31.10.2026: Astral закрыли посреди подготовки игры — рядом с `update.rpf` осталось 1,8 ГБ, и ни одно из
 * имён выше его не узнавало: `ENGINE_LEFTOVER` ждёт имя без хвоста `.<id>.stage`). Недописанный файл подставлять нельзя — он только уходит, есть архив или нет.
 */
const STAGE_PARTIAL = /^(.+?\.rpf)\.astral-stage-[0-9a-f-]{8,}\.[0-9a-f-]{8,}\.stage$/i;
const HOST_BACKUP = /^(.+?\.rpf)\.astral-backup$/i;
const ENGINE_SWAP = /^(.+?\.rpf)\.astral-(current|restore)$/i;

/**
 * Возвращает игре архивы, оставшиеся без замены, и убирает остатки подмены.
 * `games` — папки игр (`gameRoot`). Отчёт: `{ restored, removed }` (пути).
 * `pointsRoot` — папка точек отката, по которой решается, чьи «до» рядом
 * брошены (по умолчанию нынешняя папка «Хранилища»); `defaultPointsRoot` —
 * прежняя папка точек: пока в ней лежат точки, ещё не переехавшие в
 * нынешнюю, «до» рядом не убираются.
 */
export async function recoverArchiveSwaps(
  games = [],
  { log = () => {}, pointsRoot = nativeRestorePointsRoot(), defaultPointsRoot = defaultRestorePointsRoot() } = {},
) {
  const report = { restored: [], removed: [] };
  const seen = new Set();
  for (const root of games) {
    if (!root) continue;
    const key = path.resolve(root).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const directory of [path.resolve(root), path.join(path.resolve(root), "update")]) {
      let entries = [];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
      const old = new Map();
      for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory() && STAGE_DIRECTORY.test(entry.name)) {
          await fs.rm(full, { recursive: true, force: true }).catch(() => {});
          report.removed.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (STAGE_PARTIAL.test(entry.name)) {
          await fs.rm(full, { force: true }).catch(() => {});
          report.removed.push(full);
          continue;
        }
        const host = HOST_BACKUP.exec(entry.name);
        const engine = ENGINE_LEFTOVER.exec(entry.name);
        const swap = ENGINE_SWAP.exec(entry.name);
        const archive =
          host?.[1] ||
          (engine?.[2] === "old" ? engine[1] : null) ||
          (swap?.[2].toLowerCase() === "current" ? swap[1] : null);
        if (archive) {
          const list = old.get(archive.toLowerCase()) || [];
          list.push({ full, archive });
          old.set(archive.toLowerCase(), list);
          continue;
        }
        if (engine?.[2] === "stage" || swap?.[2].toLowerCase() === "restore") {
          await fs.rm(full, { force: true }).catch(() => {});
          report.removed.push(full);
        }
      }
      for (const [archiveKey, list] of old) {
        const live = path.join(directory, list[0].archive);
        if (!names.has(archiveKey) && !(await exists(live))) {
          /* Архива нет — возвращается прежний; два кандидата — новее. */
          const ordered = await Promise.all(
            list.map(async (item) => ({ ...item, mtime: (await fs.stat(item.full).catch(() => null))?.mtimeMs || 0 })),
          );
          ordered.sort((a, b) => b.mtime - a.mtime);
          try {
            await fs.rename(ordered[0].full, live);
            report.restored.push(live);
            log(`Архив ${live} возвращён после оборванной подмены.`);
          } catch (error) {
            log(`Архив ${live} не возвращён: ${error?.message || error}`);
            continue;
          }
          for (const item of ordered.slice(1)) {
            await fs.rm(item.full, { force: true }).catch(() => {});
            report.removed.push(item.full);
          }
          continue;
        }
        for (const item of list) {
          await fs.rm(item.full, { force: true }).catch(() => {});
          report.removed.push(item.full);
        }
      }
    }
    /* «До» рядом, чья точка уже убрана: архива игры нет — ничего не трогаем, возвращать нужно сначала его. */
    const live = path.join(path.resolve(root), "update", "update.rpf");
    if (await exists(live)) {
      const swept = await sweepBesideCopies(live, pointsRoot, { defaultRoot: defaultPointsRoot, log });
      report.removed.push(...swept);
    }
  }
  return report;
}
