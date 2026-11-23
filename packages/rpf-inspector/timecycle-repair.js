/*
 * Починка файла модификаторов таймцикла автора (находка 4 настоящего разбора, 10.11.2026; Хелпер 28).
 *
 * У Грустного редукса `timecycle_mods_4.xml` содержит самозакрытый `<modifier name="drug_flying_base" … />` и сразу за ним лишний `</modifier>`:
 * строгий разбор (`saxes`, он же у слияния слоёв таймцикла в установщике) падает на «unexpected close tag», имена модификаторов не читались, и файл
 * уходил заменой целиком — игрок терял модификаторы других модов. Чинится ровно одна поломка: закрывающий тег, которому не соответствует ни один
 * открытый (его строка удаляется). Всё остальное — модификаторы, значения, порядок — не меняется, поэтому «чужое» чинить нельзя: незакрытый внутренний
 * тег, чужие имена, любой другой изъян — отказ (`null`), и файл идёт как раньше.
 *
 * Чистый модуль: только текст.
 */

/* Комментарий, CDATA, инструкция, либо тег (`/` перед именем — закрывающий, `/` перед `>` — самозакрытый). */
const MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * Лишние закрывающие теги убраны: `{ text, removed }`; чинить нечего — `{ text, removed: 0 }`; починить нельзя — `null`.
 * Закрывающий тег убирается, только если такого имени нет среди открытых вовсе; если он закрывает чужой тег ниже по стеку, значит потерян закрывающий
 * тег внутреннего элемента — это не та поломка, отказ.
 */
export function repairTimecycleXml(input) {
  const text = String(input ?? "");
  const stack = [];
  const cuts = [];
  for (const match of text.matchAll(MARKUP)) {
    const [, closing, name, , selfClosing] = match;
    if (!name) continue;
    if (closing) {
      if (stack.at(-1) === name) stack.pop();
      else if (stack.includes(name)) return null;
      else cuts.push(match);
    } else if (!selfClosing) stack.push(name);
  }
  if (stack.length) return null;
  if (!cuts.length) return { text, removed: 0 };
  let out = "";
  let from = 0;
  for (const match of cuts) {
    let start = match.index;
    let end = start + match[0].length;
    /* Тег один на строке — уходит вся строка с отступом и переводом строки. */
    const before = text.slice(0, start).match(/(?:^|\n)[ \t]*$/);
    const after = text.slice(end).match(/^[ \t]*(?:\r?\n|$)/);
    if (before && after) {
      start -= before[0].replace(/^\n/, "").length;
      end += after[0].length;
    }
    out += text.slice(from, start);
    from = end;
  }
  out += text.slice(from);
  return { text: out, removed: cuts.length };
}

/** Имена модификаторов по тексту без строгого разбора (для отчёта, когда починить нельзя). Строчными, без повторов. */
export function looseModifierNames(input) {
  const names = new Set();
  for (const match of String(input ?? "").matchAll(/<modifier\s[^>]*?\bname\s*=\s*"([^"]+)"/g)) names.add(match[1].trim().toLowerCase());
  return [...names];
}
