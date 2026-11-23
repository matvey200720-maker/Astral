import {
  BILLBOARD_GLOW,
  billboard,
  billboardLookOf,
  changedBillboards,
  normalizeBillboardsProject,
} from "@modovik/climb-contract/recolor/billboards";
import { billboardPlan } from "./recolor-billboards.js";

/*
 * Сколько щитов работы видно на GTA 5 RP (21.11.2026, `packages/install-engine/billboards-rp-parts.js`): «видно N из M щитов». Щит работы — полотно описи, чей облик изменён и для которого сборка
 * кладёт файлы: листы вблизи, HD, листы дальних планов (`billboardPlan`), копия словаря щита (если щиту нужна своя) и модель со свечением. Щит виден, только если ВСЕ эти файлы едут контейнером
 * (имя среди `kept`): один лист в пакете игры, одна копия словаря без типа района, и щит на GTA 5 RP остаётся штатным (дыры нет, но и своего вида нет). Щит без единого файла (облик как в игре,
 * лист крупнее предела записи) в счёт не идёт: показывать и скрывать нечего.
 *
 * Считается по проекту набора (`input.project`), а не по файлам: файл листа общий у нескольких щитов, и по одним именам не сказать, сколько щитов осталось штатными.
 */

/** Файлы, нужные каждому щиту проекта: `Map(id щита → Set(имя файла строчными))`. */
export function billboardsRpFilesByBoard(project) {
  const normalized = normalizeBillboardsProject(project);
  const byBoard = new Map();
  const need = (id, file) => {
    if (!byBoard.has(id)) byBoard.set(id, new Set());
    byBoard.get(id).add(String(file).toLowerCase());
  };
  for (const entry of billboardPlan(normalized).files)
    for (const sheet of entry.sheets)
      for (const item of sheet.items) need(item.board.id, entry.file);
  for (const id of changedBillboards(normalized)) {
    if (billboardLookOf(normalized, id).glow === BILLBOARD_GLOW.standard)
      continue;
    for (const item of billboard(id).glowShaders || []) need(id, item.file);
  }
  return byBoard;
}

/** `{ seen, total }`: сколько щитов проекта видно на GTA 5 RP при едущих файлах `keptNames`, из скольких. */
export function billboardsRpShields(project, keptNames) {
  const kept = new Set(
    [...keptNames].map((name) => String(name).toLowerCase()),
  );
  let seen = 0;
  let total = 0;
  for (const files of billboardsRpFilesByBoard(project).values()) {
    if (!files.size) continue;
    total += 1;
    if ([...files].every((file) => kept.has(file))) seen += 1;
  }
  return { seen, total };
}

/**
 * Что оставить в контейнере, когда едущие файлы не влезают в предел (21.11.2026, `viaUpdate` без общего отказа): щиты берутся целиком, меньшие по размеру файлов раньше (больше щитов в тот же объём), пока `fits(файлы)` отвечает «да».
 * `files` — `[{ name, size }]` едущих файлов, `fits(files)` — влезает ли набор (`selectPlacesSet`). Файлы вне щитов (живые плашки, типы и карта) остаются всегда. Файл, общий у нескольких щитов, ложится один раз. Ответ:
 * `{ names: Set имён (строчные) оставленных файлов, seen, total, limited }` — оставлено щитов, всего щитов проекта, видимых по файлам, но не влезших.
 */
export function billboardsRpFit({ project, files, fits }) {
  const bySize = new Map(
    files.map((file) => [String(file.name).toLowerCase(), file]),
  );
  const byBoard = billboardsRpFilesByBoard(project);
  const boardFiles = new Set();
  const boards = [];
  let total = 0;
  for (const [id, names] of byBoard) {
    if (!names.size) continue;
    total += 1;
    for (const name of names) boardFiles.add(name);
    if ([...names].every((name) => bySize.has(name)))
      boards.push({
        id,
        names,
        size: [...names].reduce((sum, name) => sum + bySize.get(name).size, 0),
      });
  }
  boards.sort((a, b) => a.size - b.size || (a.id < b.id ? -1 : 1));
  const selected = new Set(
    [...bySize.keys()].filter((name) => !boardFiles.has(name)),
  );
  let seen = 0;
  for (const board of boards) {
    const added = [...board.names].filter((name) => !selected.has(name));
    for (const name of added) selected.add(name);
    if (fits([...selected].map((name) => bySize.get(name)))) seen += 1;
    else for (const name of added) selected.delete(name);
  }
  return { names: selected, seen, total, limited: boards.length - seen };
}
