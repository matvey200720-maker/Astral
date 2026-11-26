/*
 * Замечания разбора о зашифрованных банках пака звуков. Каждая фраза — ключ словаря окна с подстановкой `{0}` (имена банков): разбор
 * пишет её по шаблону, слой перевода разметки (`apps/web/src/locales/dom-translate.js`) узнаёт по тому же шаблону и переводит.
 * Поменялась фраза — поменяйте ключ в `ui-text/zone-sound-sealed-banks-2511.js` и во французской зоне (сторож —
 * `apps/web/src/test/sound-sealed-banks-languages.test.js`). Модуль без зависимостей: его читает и тест окна.
 */
export const SEALED_BANK_TEXT = Object.freeze({
  /* Открыватель есть, сверить не вышло: причина названа в самой фразе. */
  "no-table":
    "Зашифрованные банки не взяты, пак может быть неполным: в Astral нет отпечатков их штатного звука — {0}.",
  "not-decrypted":
    "Зашифрованные банки не взяты, пак может быть неполным: ключом игры они не расшифровались — {0}.",
  unsealed:
    "Банки были зашифрованы, но звук в них изменён: расшифрованы и взяты в пак — {0}.",
  /* Открывателя нет (в собранном приложении): банки считаются нетронутыми, как раньше; это только справка. */
  unchecked:
    "Зашифрованные банки не сверялись с игрой и считаются нетронутыми — {0}.",
});

const UNVERIFIED_REASONS = ["no-table", "not-decrypted"];

const note = (code, severity, text, banks) =>
  banks.length
    ? [{ code, severity, message: text.replace("{0}", () => banks.join(", ")) }]
    : [];

/**
 * Замечания по записям банков одной папки пака. Предупреждение — только когда расшифровка была возможна, а сверить не вышло
 * (`unverified` — причина); расшифрованные изменённые (`unsealed`) и не сверявшиеся (`unchecked`) — справки.
 */
export function sealedBankProblems(records) {
  const banks = (test) => records.filter(test).map((record) => record.bank);
  return [
    ...UNVERIFIED_REASONS.flatMap((reason) =>
      note(
        "sound-bank-unverified",
        "warn",
        SEALED_BANK_TEXT[reason],
        banks((record) => record.unverified === reason),
      ),
    ),
    ...note(
      "sound-bank-unsealed",
      "info",
      SEALED_BANK_TEXT.unsealed,
      banks((record) => record.unsealed),
    ),
    ...note(
      "sound-bank-unchecked",
      "info",
      SEALED_BANK_TEXT.unchecked,
      banks((record) => record.unchecked),
    ),
  ];
}
