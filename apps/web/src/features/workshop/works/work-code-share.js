/*
 * Короткий код: длинный код работы или сборки — на сервере, в сообщение — адрес.
 *
 * Код работы с картинками весит сотни тысяч символов и не лезет в сообщение
 * Telegram или Discord (владелец, 01.11.2026). «Скопировать код» выкладывает
 * такой код и кладёт в буфер `ASTRAL-7KQ2M9XDQF`; короткие работы остаются
 * полным кодом и живут без сервера.
 *
 * ЧТО С ОТКАЗОМ. Сервер не ответил или человек не вошёл — в буфер идёт полный
 * код (он рабочий), и одна строка говорит, почему он длинный. Молчать нельзя:
 * иначе человек решит, что короткие коды сломаны, когда мессенджер превратит
 * вставку в файл.
 *
 * ЧЕМУ ВЕРИМ. Ничему: запись с сервера — такой же чужой текст, как вставленный.
 * Здесь проверяется только, что это длинный код (а не короткий: запись не может
 * вести на другую запись); дальше она идёт прежним разбором `decodeWorkCode` и
 * проверкой данных редактора с теми же потолками.
 */

import { tr } from "../../../locales/ui.js";
import { WorkCodeError, findWorkCode } from "./work-code.js";

/** Код не длиннее этого остаётся полным: он влезает в сообщение и живёт без сервера. */
export const SHORTEN_ABOVE = 1500;
/** Потолок записи на сервере (`workshare.MaxCodeBytes`): код длиннее не выложить. */
export const MAX_SHARED_CODE = 1 << 20;

/* Что вообще может лежать в записи: код работы или код сборки целиком. */
const LONG_CODE = /^(?:ASTRAL-[A-Z]+\d{1,3}-|ASTR[12]-)[A-Za-z0-9_.-]+$/;

const loadApi = () => import("../../../api.js");

/* Строка о длинном коде — своя у каждой причины; `{count}` — длина кода. */
const longCodeNote = {
  unavailable: () =>
    tr("Код длинный (знаков: {count}), потому что сервер недоступен: мессенджер может отправить его файлом."),
  signin: () =>
    tr("Код длинный (знаков: {count}), потому что вы не вошли в аккаунт: короткий код выдаётся после входа."),
  quota: () =>
    tr("Код длинный (знаков: {count}), потому что сервер его не принял: лимит коротких кодов исчерпан."),
  "too-large": () =>
    tr("Код длинный (знаков: {count}): он больше 1 МиБ, короткий код для такого не выдаётся. Мессенджер может отправить его файлом."),
  busy: () =>
    tr("Код длинный (знаков: {count}), потому что запросов было слишком много: попробуйте через минуту."),
};

/**
 * Что положить в буфер вместо `code`: `{ code, short, note }`. `note` — строка
 * для человека, если код остался длинным не по своей воле.
 *
 * Сюда приходит и код сборки (`ASTR1-…`): адрес у них общий, а чей код лежит по
 * адресу, узнаёт тот, кто его откроет.
 */
export async function shortenCode(code, { share = null } = {}) {
  const text = String(code ?? "");
  if (text.length <= SHORTEN_ABOVE) return { code: text, short: false, note: "" };
  let answer;
  if (text.length > MAX_SHARED_CODE) answer = { status: "too-large" };
  else {
    try {
      const send = share || (await loadApi()).shareWorkCode;
      answer = await send(text);
    } catch {
      answer = { status: "unavailable" };
    }
  }
  const found = answer?.status === "ok" ? findWorkCode(answer.code) : null;
  if (found?.format === "short")
    return { code: found.code, short: true, note: "" };
  const note = (longCodeNote[answer?.status] || longCodeNote.unavailable)();
  return {
    code: text,
    short: false,
    note: note.replace("{count}", String(text.length)),
  };
}

/* Скачанные записи — на время окна: короткий код проверяется на каждую паузу в
   наборе и ещё раз по кнопке, и гонять сотни килобайт дважды незачем. Мало и по
   очереди: держать в памяти чужие мегабайты дольше нужного тоже незачем. */
const OPENED_LIMIT = 4;
const opened = new Map();

function remember(id, code) {
  opened.delete(id);
  opened.set(id, code);
  if (opened.size > OPENED_LIMIT) opened.delete(opened.keys().next().value);
}

export function forgetOpenedCodesForTests() {
  opened.clear();
}

/**
 * Текст с кодом → полный код. Не короткий код возвращается как есть, без сети.
 * Отказ — `WorkCodeError` со словами на языке окна: `short-missing` (нет такого
 * кода), `short-busy` (много запросов), `short-unavailable` (сервер недоступен),
 * `damaged` (запись не код).
 */
export async function expandWorkCode(text, { open = null } = {}) {
  const found = findWorkCode(text);
  if (found?.format !== "short") return String(text ?? "");
  if (opened.has(found.id)) return opened.get(found.id);
  let answer;
  try {
    const fetchCode = open || (await loadApi()).openSharedWorkCode;
    answer = await fetchCode(found.id);
  } catch {
    answer = { status: "unavailable" };
  }
  if (answer?.status === "missing")
    throw new WorkCodeError(
      "short-missing",
      tr("Такого кода нет: он набран с ошибкой или не открывался больше 180 дней. Попросите новый."),
    );
  if (answer?.status === "busy")
    throw new WorkCodeError("short-busy", tr("Слишком много запросов, попробуйте через минуту."));
  if (answer?.status !== "ok")
    throw new WorkCodeError(
      "short-unavailable",
      tr("Сервер недоступен, короткий код сейчас не открыть. Попробуйте ещё раз позже."),
    );
  const code = answer.code;
  if (
    typeof code !== "string" ||
    code.length > MAX_SHARED_CODE ||
    !LONG_CODE.test(code)
  )
    throw new WorkCodeError(
      "damaged",
      tr("Сервер вернул испорченную запись этого кода. Попросите новый код."),
    );
  remember(found.id, code);
  return code;
}

/** Код сборки это или работы — по первым знакам: чей код лежал по адресу, не знал никто. */
export const isBuildCodeText = (code) => /^ASTR[12]-/.test(String(code ?? ""));
