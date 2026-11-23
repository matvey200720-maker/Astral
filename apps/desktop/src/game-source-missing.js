/*
 * «Источника нет в игре» — ошибка, а не пустое место на обложке (решение владельца: всё один к одному с игрой; находка лида 3 на печи обложек, 20.11.2026).
 *
 * Печь читает папку игры, которую ей дали. Не нашёлся архив (`x64b.rpf`, `x64h.rpf`, `update/update.rpf`) — раньше чтение возвращало `null`, и обложка выходила без облаков,
 * воды, шрифтов, а печь заканчивала с кодом 0. Здесь два правила:
 *   • штатная очерёдность источников — не ошибка: «нет в update.rpf — берём из базового архива» (`readFirstPlace`), ошибка только когда не нашлось ни в одном
 *     и хотя бы одного архива нет на диске (имена — в тексте ошибки);
 *   • архив есть, а записи в нём нет — игра этой версии её не держит, это честное «нет» (`null`), а не отсутствие источника.
 * Игры нет вовсе (корень не задан) — прежнее состояние «обложка без сравнения с игрой», сюда не заходит.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const GAME_SOURCE_MISSING = "ASTRAL_GAME_SOURCE_MISSING";

/** Метка архива адреса `метка:путь` (`update/update.rpf`, `x64b.rpf`); адрес без двоеточия метки не имеет. */
export function archiveLabelOf(at) {
  const text = String(at || "");
  const cut = text.indexOf(":");
  return cut > 0 ? text.slice(0, cut) : "";
}

/** Метка архива, которого нет в папке игры; `null`, если архив на месте (или адрес без метки). */
export async function missingArchiveLabel(root, at) {
  const label = archiveLabelOf(at);
  if (!root || !label) return null;
  const info = await fs.stat(path.join(root, label)).catch(() => null);
  return info?.isFile() ? null : label;
}

/** Ошибка «источника нет»: имена архивов — в тексте, `code` — для тех, кто отличает её от прочих сбоев чтения. */
export function gameSourceMissing(labels, what = "") {
  const names = [...new Set(labels)];
  const failure = new Error(
    `В папке игры нет ${names.length > 1 ? "архивов" : "архива"} ${names.join(", ")}${what ? `: он нужен для ${what}` : ""}. Обложка не выпускается: полной копии игры не хватает.`,
  );
  failure.code = GAME_SOURCE_MISSING;
  failure.archives = names;
  return failure;
}

export const isGameSourceMissing = (error) => error?.code === GAME_SOURCE_MISSING;

/** Для `.catch(...)` на местах, где прочее глотается в `null`: «источника нет» проходит дальше, остальное — `null`. */
export function keepMissing(error) {
  if (isGameSourceMissing(error)) throw error;
  return null;
}

/**
 * Первое место из очереди, где нашлись байты. Не нашлись нигде: нет какого-то архива на диске — ошибка с его именем, архивы на месте — `null`.
 * `read(at)` отдаёт байты или `null`; сбой чтения (не «нет архива») — как «нет в этом месте».
 */
export async function readFirstPlace(root, places, read, what = "") {
  const gone = [];
  for (const at of places) {
    const bytes = await Promise.resolve(read(at)).catch(() => null);
    if (bytes?.length) return bytes;
    const label = await missingArchiveLabel(root, at);
    if (label) gone.push(label);
  }
  if (gone.length) throw gameSourceMissing(gone, what);
  return null;
}

/** Одно место без очереди: архива нет — ошибка с именем, записи нет — `null`. */
export async function readOnePlace(root, at, read, what = "") {
  return readFirstPlace(root, [at], read, what);
}
