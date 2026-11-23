/*
 * Слова Desktop о тату на языке окна (разбор 01.11.2026). Desktop говорит по-русски: `apps/desktop/src/tattoo-paint.js`, отказы и «не легло». Переводит окно: у него словарь, а ответ Desktop живёт и в памяти
 * установки, откуда его показывают уже на другом языке. Имена тату и зон — данные: шаблоны знают их места, а зоны переводятся отдельно.
 *
 * Новая строка в `tattoo-paint.js` — строка здесь и в словаре (`zone-tattoo-review-0111.js`); неизвестная строка показывается как пришла: лучше по-русски, чем никак.
 */

import { tr } from "../../locales/ui.js";

/* Шаблоны с подстановками: то, что Desktop склеивает с именем или числом. Порядок — от длинных к общим. */
const TEMPLATES = Object.freeze([
  [/^Тату «(.+)» мужское: женское тело красится по женским тату игры\.$/, "Тату «{name}» мужское: женское тело красится по женским тату игры."],
  [/^Тату «(.+)» женское: мужское тело красится по мужским тату игры\.$/, "Тату «{name}» женское: мужское тело красится по мужским тату игры."],
  [/^У тату «(.+)» неподходящее имя картинки\.$/, "У тату «{name}» неподходящее имя картинки."],
  [/^В коллекции игры нет тату (.+)\.$/, "В коллекции игры нет тату {name}."],
  [/^За раз — не больше (\d+) тату\.$/, "За раз — не больше {name} тату."],
  [/^установка прервалась: (.+)$/, "установка прервалась: {name}"],
]);

const NOTHING = /^Ни одно тату не легло: (.+)\.$/;

/** Одна фраза Desktop о тату — на языке окна. */
export function tattooWords(text) {
  const message = String(text ?? "");
  const nothing = NOTHING.exec(message);
  if (nothing) return `${tr("Ни одно тату не легло:")} ${nothing[1].split("; ").map(skippedLine).join("; ")}.`;
  for (const [pattern, template] of TEMPLATES) {
    const match = pattern.exec(message);
    if (match) return tr(template).replace("{name}", match[1]);
  }
  return tr(message);
}

/* «Рисунок · Торс» — подпись части тела, которой не хватило тату. */
const drawnLabel = (label) => {
  const zone = /^Рисунок · (.+)$/.exec(String(label ?? ""));
  return zone ? `${tr("Рисунок")} · ${tr(zone[1])}` : String(label ?? "");
};

/* Строка «что — почему» из текста отказа «ни одно не легло». Тире в самой причине бывает («…, — этому нечего нести»), поэтому режем по первому. */
function skippedLine(line) {
  const at = line.indexOf(" — ");
  return at < 0 ? tattooWords(line) : `${drawnLabel(line.slice(0, at))} — ${tattooWords(line.slice(at + 3))}`;
}

/** Строка «не легло» из ответа Desktop: `{ texture, reason }`. */
export const skippedWords = (entry) => `${drawnLabel(entry?.texture)} — ${tattooWords(entry?.reason)}`;

/** Отказ Desktop как ошибка на языке окна: код тот же, слова свои. Незнакомый отказ возвращается как есть. */
export function tattooRefusalInLanguage(error) {
  const message = String(error?.message ?? "");
  const words = tattooWords(message);
  if (words === message) return error;
  return Object.assign(new Error(words), error?.code ? { code: error.code } : {});
}
