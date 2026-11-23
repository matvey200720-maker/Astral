/*
 * Коды исключений Windows, которые встречаются в падениях GTA V, Majestic и RAGE MP, — человеческим языком.
 * `code` — ключ для окна (оно переводит сам, `GameCrashSection`), `text` — русская строка для журнала поддержки.
 */

const TABLE = new Map([
  ["c0000005", { code: "access-violation", text: "обращение к недоступной памяти (access violation)" }],
  ["c0000409", { code: "fail-fast", text: "аварийное завершение процесса (fail-fast: abort, переполнение буфера или проверка целостности)" }],
  ["c000001d", { code: "illegal-instruction", text: "недопустимая инструкция процессора (чаще всего перекрытый или битый модуль)" }],
  ["c00000fd", { code: "stack-overflow", text: "переполнение стека" }],
  ["c0000374", { code: "heap-corruption", text: "повреждена куча памяти (heap corruption)" }],
  ["c0000094", { code: "divide-by-zero", text: "целочисленное деление на ноль" }],
  ["c000008e", { code: "divide-by-zero", text: "деление на ноль с плавающей точкой" }],
  ["c0000096", { code: "illegal-instruction", text: "привилегированная инструкция в пользовательском режиме" }],
  ["c0000006", { code: "in-page-error", text: "ошибка чтения страницы с диска (файл недоступен или диск не отвечает)" }],
  ["c0000017", { code: "out-of-memory", text: "не хватило памяти" }],
  ["c000012d", { code: "out-of-memory", text: "не хватило памяти или файла подкачки" }],
  ["c0000142", { code: "dll-init", text: "библиотека не смогла запуститься" }],
  ["c0000135", { code: "dll-missing", text: "не найдена нужная библиотека" }],
  ["c0000139", { code: "dll-missing", text: "в библиотеке нет нужной функции" }],
  ["e06d7363", { code: "cpp-exception", text: "необработанное исключение C++" }],
  ["80000003", { code: "breakpoint", text: "остановка по точке останова (отладочная сборка)" }],
  ["c00000e5", { code: "internal-error", text: "внутренняя ошибка системы" }],
]);

/** Нормальный вид кода: восемь знаков, нижний регистр, без «0x». */
export function normalizeException(value) {
  const hex = String(value ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,8}$/.test(hex)) return "";
  return hex.padStart(8, "0");
}

/** Описание кода; незнакомый код остаётся кодом. */
export function describeException(value) {
  const code = normalizeException(value);
  if (!code) return { code: "unknown", text: "причина не указана", hex: "" };
  const known = TABLE.get(code);
  return known ? { ...known, hex: code } : { code: "unknown", text: `исключение 0x${code}`, hex: code };
}
