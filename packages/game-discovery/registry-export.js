import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/*
 * Чтение строковых значений ключа реестра без зависимости от кодовой страницы консоли.
 *
 * `reg query` при выводе в канал пишет в OEM-странице консоли (cp866 на русской Windows, 850/852 на других), а Node читал вывод как UTF-8: «D:\игры» приходило как «D:\����», и
 * исходный путь терялся безвозвратно (невалидные байты заменяются на U+FFFD, перекодировать потом нечем). `reg export` пишет файл в UTF-16 LE с меткой FF FE — его кодировка от консоли
 * не зависит. Здесь ключ выгружается во временную папку, файл разбирается, и значения-строки отдаются в виде вывода `reg query` (`    имя    REG_SZ    данные`): разборщики вызывающих
 * (`parseRegQuery`, `parseRegistryFonts`, чтение пути RAGE MP) остаются теми же.
 */

const TIMEOUT_MS = 10_000;

/** Текст выгрузки: UTF-16 LE с меткой FF FE (так пишет `reg export`); без метки — UTF-16 LE по нулевым байтам, иначе UTF-8. */
export function decodeRegExport(buffer) {
  if (typeof buffer === "string") return buffer;
  if (!buffer || buffer.length < 2) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer.length >= 4 && buffer[1] === 0 && buffer[3] === 0) return buffer.toString("utf16le");
  return buffer.toString("utf8");
}

/* Строка значения-строки: `"имя"="данные"` или `@="данные"` (значение по умолчанию); внутри обратная черта и кавычка экранированы обратной чертой. */
const STRING_VALUE = /^(?:@|"((?:[^"\\]|\\.)*)")="((?:[^"\\]|\\.)*)"$/;
const unescape = (text) => text.replace(/\\(.)/g, "$1");

/**
 * Значения-строки САМОГО ключа из текста выгрузки — в виде вывода `reg query`. Подразделы (следующие секции `[…]`), числа и двоичные значения пропускаются.
 * @param {string} text текст выгрузки (`decodeRegExport`)
 */
export function exportToQueryText(text) {
  const rows = [];
  let sections = 0;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("[")) {
      sections += 1;
      if (sections > 1) break;
      continue;
    }
    if (sections !== 1) continue;
    const match = STRING_VALUE.exec(line);
    if (!match) continue;
    const name = match[1] === undefined ? "(Default)" : unescape(match[1]);
    rows.push(`    ${name}    REG_SZ    ${unescape(match[2])}`);
  }
  return rows.join("\r\n");
}

const exportWithRegExe = (key, file) =>
  new Promise((resolve, reject) => {
    execFile("reg.exe", ["export", key, file, "/y"], { windowsHide: true, timeout: TIMEOUT_MS }, (error) => (error ? reject(error) : resolve()));
  });

/* Прежний `reg query` — запасной путь: во временные файлы не ходит. Вывод в кодировке консоли, русские буквы в нём портятся (см. шапку). */
const queryWithRegExe = (key) =>
  new Promise((resolve, reject) => {
    execFile("reg.exe", ["query", key], { windowsHide: true, timeout: TIMEOUT_MS }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });

/** Текст выгрузки ключа или `null`, если выгрузка не вышла (нет временной папки, `reg.exe` упал или завис, файл не создан, не читается, пуст или обрезан). */
async function exportedText(key, exportKey) {
  let directory = null;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "astral-reg-"));
    const file = path.join(directory, "key.reg");
    await exportKey(key, file);
    const text = decodeRegExport(await fs.readFile(file));
    /* Настоящая выгрузка всегда содержит секцию `[ключ]`; без неё файл пуст или обрезан (антивирус). */
    return /^\[/m.test(text) ? text : null;
  } catch {
    return null;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Строковые значения ключа в виде вывода `reg query`; нет ключа, нет `reg.exe` или сбой обоих способов — пустая строка (для поиска это «пусто», а не сбой).
 *
 * Запасной путь (24.11.2026). Выгрузка ходит во временную папку, а `reg query` — нет, и раньше любой сбой выгрузки (TEMP закрыта на запись, антивирус держит `reg.exe` или файл, срок 10 с)
 * молча давал пустую строку: «клиент RAGE MP не найден» (режим RP не включался), игра по реестру не находилась, шрифты не читались. Теперь после сбоя выгрузки ключ спрашивается прежним
 * `reg query`. Его ответ годится как «значение есть», но не как верный путь с не-ASCII буквами: он в кодировке консоли (см. шапку).
 *
 * Выгрузка вышла — `reg query` не зовётся, даже если в ключе нет ни одной строки: ключ есть, второй запуск `reg.exe` ничего не добавит. Ключа нет — `reg export` падает с кодом 1, и при
 * настоящем сбое (не записать файл) код тот же, а текст ошибки на языке Windows, поэтому «нет ключа» от сбоя надёжно не отличить: спрашивается и `reg query`. У людей без ключа это один
 * лишний запуск `reg.exe` (~40–50 мс на этом ПК) на вызов; чтение реестра игры держит минутную память (`createRegistryReader`).
 *
 * `exportKey(key, file)` и `queryKey(key)` подменяются в тестах.
 * @param {string} key например `HKCU\Software\RAGE-MP`
 */
export async function readRegistryKeyText(key, { exportKey = exportWithRegExe, queryKey = queryWithRegExe } = {}) {
  const text = await exportedText(key, exportKey);
  if (text !== null) return exportToQueryText(text);
  try {
    return String(await queryKey(key));
  } catch {
    return "";
  }
}
