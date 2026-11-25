/*
 * Можно ли вернуть RAGE MP на запомненный «прежний» путь (24.11.2026). Грузится по вызову из `restoreLaunchers` (`launcher-game-paths.js`): тот модуль входит в старт главного
 * процесса, а тесты держат потолок его исходников (`main-startup-imports.test.js`), поэтому логика и объяснение живут здесь.
 *
 * До правки кодировки реестра (`registry-export.js`) `pointLaunchersAt` читал `game_v_path` выводом `reg query` и запоминал «прежним» то, что получил. `reg query` печатает в кодировке
 * консоли, а Node читал вывод как UTF-8: русские буквы пути на русской Windows (cp866) становились знаками замены U+FFFD или цепочкой случайных знаков, на английской (cp437) — «?».
 * Запись `entry.rage.before` в `launcher-paths.json` с таким путём осталась у людей навсегда, и `restoreLaunchers` при удалении второй папки писал его в реестр как есть: RAGE MP
 * терял игру. Здесь такой путь узнаётся, и в реестр он не пишется: RAGE MP остаётся как есть, запись о второй папке снимается.
 *
 * Правила (путь без букв вне ASCII читается одинаково во всех кодировках, поэтому верен всегда):
 *   — знак замены U+FFFD или знак, которого нет в путях Windows (`< > " | * ?`, кроме префикса `\\?\`) — испорчен;
 *   — латинский путь верен, даже если папки уже нет: она могла уйти, это не причина оставлять RAGE MP на удалённой копии;
 *   — путь с не-ASCII буквами верен, только если в нём на диске есть GTA5.exe: правильный русский путь так и подтверждается, цепочку случайных знаков на диске не найти.
 */

import fs from "node:fs/promises";
import path from "node:path";

/* Знак замены строится кодом: набранный escape инструмент записи файла превращает в сам символ. */
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

/**
 * `true` — «прежний» путь верить нельзя, в реестр его не писать.
 * @param {string} before запомненный «прежний» путь RAGE MP
 * @param {{ fileExists?: (file: string) => Promise<boolean> }} tools `fileExists` подменяется в тестах
 */
export async function untrusted(before, { fileExists = exists } = {}) {
  const text = String(before ?? "");
  if (!text) return false;
  if (text.includes(REPLACEMENT_CHAR) || /[<>"|*?]/.test(text.replace(/^\\\\[?.]\\/, ""))) return true;
  if (!/[^\x20-\x7e]/.test(text)) return false;
  return !(await fileExists(path.join(text, "GTA5.exe")));
}
