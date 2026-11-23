/*
 * Запись собранного файла набора под тормозом диска (18.11.2026).
 *
 * Сборка растительности и дорог пишет на диск гигабайты (у тестера альфы 0.9.0-beta.108 — 7,4 ГБ россыпью), и шла эта
 * запись мимо всего, что щадит диск при установке: без потолка скорости, без отдыха, включена «Быстрая установка» или
 * нет. Здесь она идёт по тем же правилам, что укладка файлов пакета (`package-payload.js`):
 *
 *   — потолок записи общий с остальными писателями процесса (`write-pacing.js`): записанные байты занимают место на
 *     общей ленте, следующая запись ждёт своей очереди;
 *   — большой файл и любой файл на медленном диске идут своей очередью с отдыхом диска после операции (`disk-care.js`);
 *   — «Быстрая установка» снимает потолок и отдых — на лету: оба читаются на каждой записи.
 *
 * Большой файл (≥ 16 МБ) пишется сквозь кэш системы, блоками (20.11.2026, регулятор диска): прежняя запись одним `fs.writeFile` ложилась в кэш за миллисекунды, отдых `diskTurn` мерил эти
 * миллисекунды, а диск сбрасывал гигабайты лениво уже после — всплесками «в сотку» вне любых наших ограничителей. Блок за блоком сквозь кэш (`disk-care.js: carefulWrite`): время блока — настоящее
 * время диска, отдых и потолок идут по каждому блоку, сбрасывать после нечего. Мелкие файлы — как были.
 *
 * У процесса сборки состояние своё: потолок и отдых ему передаёт главный процесс при старте и при каждой смене
 * (`apps/desktop/src/build-process.js`, `build-install-speed.js`).
 */
import fs from "node:fs/promises";
import { CAREFUL_MIN_BYTES, DISK_BLOCK_BYTES, carefulWriteFlags, diskRestEnabled, diskTurn, throttledOp, writeFully } from "./disk-care.js";
import { sharedWritePacer } from "./write-pacing.js";

/* Диск под сборкой медленный: мелкие файлы тоже идут с отдыхом. Ставит сторона сборки по слову главного процесса. */
let slowDisk = false;
export function setBuiltFileSlowDisk(slow) {
  slowDisk = slow === true;
}
export const builtFileSlowDisk = () => slowDisk;

const careful = (size) => diskRestEnabled() && (slowDisk || size >= CAREFUL_MIN_BYTES);

/* Большой файл: блоками сквозь кэш, каждый блок — своя очередь с отдыхом и свой кусок общего потолка записи. Медленному диску и «Быстрой установке» тот же путь: сквозная запись не копит сброс. */
async function writeThrough(target, bytes, flag) {
  const pacer = sharedWritePacer();
  const handle = await fs.open(target, carefulWriteFlags(flag));
  try {
    for (let at = 0; at < bytes.length; at += DISK_BLOCK_BYTES) {
      const block = bytes.subarray(at, Math.min(bytes.length, at + DISK_BLOCK_BYTES));
      const write = () => writeFully(handle, block);
      await (diskRestEnabled() ? diskTurn(write, { measure: { kind: "write", bytes: block.length, place: target } }) : write());
      await pacer.wrote(block.length);
    }
  } finally {
    await handle.close();
  }
}

/** Записать собранный файл `bytes` в `target`. `flag` — как у `fs.writeFile` (`wx` — файла ещё нет). */
export async function writeBuiltFile(target, bytes, { flag = "w" } = {}) {
  const size = bytes.length;
  if (size >= CAREFUL_MIN_BYTES) return writeThrough(target, bytes, flag);
  const write = async () => {
    await throttledOp(size);
    await fs.writeFile(target, bytes, { flag });
  };
  await (careful(size) ? diskTurn(write) : write());
  await sharedWritePacer().wrote(size);
}

/** Копия собранного файла (другой том, файловая система без ссылок) — под тем же потолком. */
export async function copyBuiltFile(source, target) {
  const size = (await fs.stat(source).catch(() => null))?.size ?? 0;
  const copy = async () => {
    await throttledOp(size);
    await fs.copyFile(source, target);
  };
  await (careful(size) ? diskTurn(copy) : copy());
  await sharedWritePacer().wrote(size);
}
