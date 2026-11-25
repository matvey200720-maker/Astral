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

/**
 * Строковые значения ключа в виде вывода `reg query`; нет ключа, нет `reg.exe` или сбой — пустая строка (для поиска это «пусто», а не сбой).
 * `exportKey(key, file)` подменяется в тестах.
 * @param {string} key например `HKCU\Software\RAGE-MP`
 */
export async function readRegistryKeyText(key, { exportKey = exportWithRegExe } = {}) {
  let directory = null;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "astral-reg-"));
    const file = path.join(directory, "key.reg");
    await exportKey(key, file);
    return exportToQueryText(decodeRegExport(await fs.readFile(file)));
  } catch {
    return "";
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
