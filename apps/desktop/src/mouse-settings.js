/*
 * Чувствительность мыши игры (ТЗ 29.10.2026, круг 6): ниже нижней строки меню.
 *
 * Мышь GTA V хранит не в `settings.xml` (там графика), а в профиле игрока —
 * `Documents\Rockstar Games\GTA V\Profiles\<профиль>\pc_settings.bin`: пары
 * «номер, значение» по два u32 (как у безопасной зоны, `game-screen.js`), без
 * заголовка и суммы. Номера — таблица профильных настроек GTA V (FiveM,
 * `GetProfileSetting`) и профили на этом компьютере: 754 «Mouse Look
 * Sensitivity» (обзор и прицел), 755 «Mouse Driving Sensitivity»; по умолчанию
 * у обоих 50, у владельца обзор стоит на 10 (меню игры, нижняя строка).
 *
 * Меню рисует ползунок по числу в файле, а число в файле — целое, и писать его
 * можно, пока игра закрыта. Запись меняет ровно четыре байта на месте
 * (размер и порядок пар не трогаются): ничего не добавляется, чужие настройки
 * профиля остаются как были. Перед первой записью профиль копируется целиком
 * (`pc_settings.original.bin`), а «как было» возвращает значения по ключам —
 * то, что человек успел поменять в игре после, остаётся его.
 *
 * Чего здесь нет и быть не должно: чтения и записи памяти игры, подмены
 * ввода и системных настроек мыши — RP-серверы и античит видят такое сразу.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { MOUSE_MENU_MIN, MOUSE_SETTINGS, MOUSE_VALUE_MAX, MOUSE_VALUE_MIN } from "@modovik/optimizer/mouse.js";
import { latestProfileFile } from "./game-screen.js";

export { MOUSE_MENU_MIN, MOUSE_SETTINGS, MOUSE_VALUE_MAX, MOUSE_VALUE_MIN };

const FOLDER = "mouse-settings";
const ORIGINAL_BINARY = "pc_settings.original.bin";
const ORIGINAL_VALUES = "original.json";

const mouseFolder = (stateDir, profile) => path.join(path.resolve(stateDir), FOLDER, profile);

/** Смещение значения настройки с этим номером в файле (или `-1`). */
function valueOffset(buffer, id) {
  for (let offset = 0; offset + 8 <= buffer.length; offset += 8) if (buffer.readUInt32LE(offset) === id) return offset + 4;
  return -1;
}

/** Числа мыши из файла профиля: `{ look, driving }` — `null`, если такой пары в файле нет. */
export function readMouseValues(buffer) {
  const values = {};
  for (const { key, id } of MOUSE_SETTINGS) {
    const offset = valueOffset(buffer, id);
    values[key] = offset < 0 ? null : buffer.readUInt32LE(offset);
  }
  return values;
}

/** Целое от 1 до 100 или отказ словами: в файл игры уходит только то, что игра может прочитать. */
export function normalizeMouseValues(input) {
  const values = {};
  for (const { key } of MOUSE_SETTINGS) {
    if (input?.[key] === undefined) continue;
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < MOUSE_VALUE_MIN || value > MOUSE_VALUE_MAX)
      throw new Error(`Чувствительность мыши — целое число от ${MOUSE_VALUE_MIN} до ${MOUSE_VALUE_MAX}.`);
    values[key] = value;
  }
  if (!Object.keys(values).length) throw new Error("Не выбрана чувствительность мыши.");
  return values;
}

/** Копия файла с новыми числами на местах прежних; пары не находится — отказ, а не дописанный хвост. */
export function withMouseValues(buffer, values) {
  const next = Buffer.from(buffer);
  for (const { key, id } of MOUSE_SETTINGS) {
    if (values[key] === undefined) continue;
    const offset = valueOffset(next, id);
    if (offset < 0)
      throw new Error("В профиле игры нет настроек мыши. Откройте в игре «Настройки → Управление», выйдите из игры и попробуйте снова.");
    next.writeUInt32LE(values[key], offset);
  }
  return next;
}

async function readOriginal(stateDir, profile) {
  try {
    const saved = JSON.parse(await fs.readFile(path.join(mouseFolder(stateDir, profile), ORIGINAL_VALUES), "utf8"));
    return saved?.values && typeof saved.values === "object" ? saved : null;
  } catch {
    return null;
  }
}

/* Первый раз Astral трогает мышь этого профиля: профиль целиком — копией, значения — для «как было». */
async function rememberOriginal(stateDir, profile, buffer) {
  if (await readOriginal(stateDir, profile)) return;
  const folder = mouseFolder(stateDir, profile);
  await fs.mkdir(folder, { recursive: true });
  const copy = path.join(folder, ORIGINAL_BINARY);
  try {
    await fs.access(copy);
  } catch {
    await fs.writeFile(copy, buffer);
  }
  await fs.writeFile(
    path.join(folder, ORIGINAL_VALUES),
    `${JSON.stringify({ values: readMouseValues(buffer), savedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

/* Рядом и переименованием: недописанный файл профиля игра прочла бы как сброс настроек. */
async function writeProfile(file, buffer) {
  const temp = `${file}.astral-tmp`;
  await fs.writeFile(temp, buffer);
  try {
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

/**
 * Что сейчас в профиле: `{ found, profile, values, original, canRestore, supported }`. `supported` —
 * обе пары есть в файле; без профиля `found: false`, и страница говорит «запустите игру».
 */
export async function readMouseSettings(settingsFile, stateDir) {
  const latest = settingsFile ? await latestProfileFile(settingsFile) : null;
  if (!latest) return { found: false, profile: "", values: {}, original: null, canRestore: false, supported: false };
  const buffer = await fs.readFile(latest.file).catch(() => null);
  if (!buffer) return { found: false, profile: latest.profile, values: {}, original: null, canRestore: false, supported: false };
  const values = readMouseValues(buffer);
  const saved = stateDir ? await readOriginal(stateDir, latest.profile) : null;
  return {
    found: true,
    profile: latest.profile,
    values,
    original: saved?.values || null,
    canRestore: Boolean(saved),
    supported: MOUSE_SETTINGS.every(({ key }) => values[key] !== null),
  };
}

/** Записать числа в профиль. Игра должна быть закрыта (проверяет вызывающий): при выходе она перепишет файл своими. */
export async function applyMouseSettings(input, settingsFile, stateDir) {
  if (!stateDir) throw new Error("Astral backup directory is required.");
  const values = normalizeMouseValues(input);
  const latest = settingsFile ? await latestProfileFile(settingsFile) : null;
  if (!latest) throw new Error("Профиль игры не найден. Сначала запустите GTA V хотя бы один раз.");
  const buffer = await fs.readFile(latest.file);
  const next = withMouseValues(buffer, values);
  await rememberOriginal(stateDir, latest.profile, buffer);
  const previous = readMouseValues(buffer);
  await writeProfile(latest.file, next);
  return { applied: true, profile: latest.profile, values: readMouseValues(next), previous };
}

/** «Как было»: числа мыши — по значениям, снятым перед первой записью; остальное в профиле не трогается. */
export async function restoreMouseSettings(settingsFile, stateDir) {
  if (!stateDir) throw new Error("Astral backup directory is required.");
  const latest = settingsFile ? await latestProfileFile(settingsFile) : null;
  if (!latest) throw new Error("Профиль игры не найден. Сначала запустите GTA V хотя бы один раз.");
  const saved = await readOriginal(stateDir, latest.profile);
  if (!saved) throw new Error("Astral ещё не менял чувствительность мыши — возвращать нечего.");
  const buffer = await fs.readFile(latest.file);
  const back = {};
  for (const { key } of MOUSE_SETTINGS) if (Number.isInteger(saved.values[key])) back[key] = saved.values[key];
  await writeProfile(latest.file, withMouseValues(buffer, back));
  await fs.rm(path.join(mouseFolder(stateDir, latest.profile), ORIGINAL_VALUES), { force: true });
  return { restored: true, profile: latest.profile, values: back };
}
