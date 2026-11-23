// Блок кириллицы целиком: русские, украинские, белорусские, сербские буквы.
const CYRILLIC_BLOCK = /[\u0400-\u04ff]/;

/**
 * Подсказка для атрибута `lang` у имён модов, ников и названий редуксов:
 * "ru", если в тексте есть кириллица, иначе undefined (атрибута нет).
 */
export function dataLangOf(text) {
  return CYRILLIC_BLOCK.test(String(text || "")) ? "ru" : undefined;
}
