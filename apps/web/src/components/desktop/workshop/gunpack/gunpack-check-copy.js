import { tr } from "../../../../locales/ui.js";
import { fill, trKey } from "../gun/gun-copy.js";

// Пакет проверок пишет замечания готовой русской фразой. Здесь фраза узнаётся по
// одному из девяти шаблонов, из неё достаются вставки {a} и {b}, и текст
// собирается заново на языке окна. Ключ перевода — сам шаблон дословно.

// Вставка шаблона: сколько знаков берёт, какие знаки ей разрешены, тянется ли
// до последнего подходящего места (по умолчанию) или останавливается на первом.
function slot(min, { accepts = () => true, max = Infinity, lazy = false } = {}) {
  return { min, max, accepts, lazy };
}

const isDigit = (ch) => ch >= "0" && ch <= "9";
const isEllipsis = (ch) => ch === "…";

// Список текстур: «как можно короче» и необязательное многоточие в конце.
const TEXTURE_LIST = {
  a: slot(0, { lazy: true }),
  b: slot(0, { accepts: isEllipsis, max: 1 }),
};

// Порядок важен: побеждает первый подошедший шаблон.
const RULES = [
  { template: trKey("«{a}» лежит в паке дважды — взята копия побольше."), slots: { a: slot(1) } },
  {
    template: trKey("«{a}» сделан для GTA V Enhanced — в обычной GTA V такой файл не загрузится."),
    slots: { a: slot(1) },
  },
  { template: trKey("«{a}» не читается: {b}"), slots: { a: slot(1, { lazy: true }), b: slot(0) } },
  {
    template: trKey(
      "У ствола нет цветной текстуры {a}{b}: ни в пакете, ни в самой модели. В игре он остался бы без цвета (белым или розовым), поэтому в каталог такой ствол не идёт.",
    ),
    slots: TEXTURE_LIST,
  },
  {
    template: trKey(
      "В паке нет текстуры {a}{b}: игра возьмёт их из своих файлов, а если там таких нет — часть ствола станет розовой.",
    ),
    slots: TEXTURE_LIST,
  },
  {
    template: trKey(
      "В паке нет текстур {a}{b}: игра возьмёт их из своих файлов, а если там таких нет — часть ствола станет розовой.",
    ),
    slots: TEXTURE_LIST,
  },
  {
    template: trKey(
      "Очень детальная модель — {a} тыс. вершин (у штатного ствола 10–20 тыс.). На слабом ПК в перестрелке может проседать FPS.",
    ),
    slots: { a: slot(1, { accepts: isDigit }) },
  },
  {
    template: trKey("Ствол занимает в памяти игры {a}. На слабом ПК с таким паком возможны вылеты."),
    slots: { a: slot(1) },
    prepareA: localizeSizeUnits,
  },
  { template: trKey("Автор скрыл деталь ствола ({a}) — в игре их не будет видно."), slots: { a: slot(0) } },
  { template: trKey("Автор скрыл детали ствола ({a}) — в игре их не будет видно."), slots: { a: slot(0) } },
].map(compile);

// Единицы переводятся по одному разу каждая; знаки подстановки в переводе
// действуют как в обычной замене подстроки.
function localizeSizeUnits(value) {
  return value.replace("МБ", tr("МБ")).replace("КБ", tr("КБ"));
}

// Шаблон -> цепочка из литералов и вставок.
function compile(rule) {
  const tokens = [];
  for (const piece of rule.template.split(/(\{[ab]\})/)) {
    const marker = /^\{([ab])\}$/.exec(piece);
    if (marker) tokens.push({ name: marker[1], ...rule.slots[marker[1]] });
    else if (piece) tokens.push(piece);
  }
  return { ...rule, tokens };
}

// Совпадение со всей строкой: литералы точные, вставки перебирают длину с
// нужного конца. Возвращает значения вставок или null.
function matchFrom(tokens, index, text, pos, found) {
  if (index === tokens.length) return pos === text.length ? found : null;
  const token = tokens[index];
  if (typeof token === "string") {
    return text.startsWith(token, pos) ? matchFrom(tokens, index + 1, text, pos + token.length, found) : null;
  }
  let reach = 0;
  while (reach < token.max && pos + reach < text.length && token.accepts(text[pos + reach])) reach += 1;
  if (reach < token.min) return null;
  const step = token.lazy ? 1 : -1;
  for (let len = token.lazy ? token.min : reach; len >= token.min && len <= reach; len += step) {
    found[token.name] = text.slice(pos, pos + len);
    const hit = matchFrom(tokens, index + 1, text, pos + len, found);
    if (hit) return hit;
  }
  return null;
}

export function checkMessage(message) {
  const text = message ? String(message) : "";
  for (const rule of RULES) {
    const found = matchFrom(rule.tokens, 0, text, 0, {});
    if (!found) continue;
    const a = rule.prepareA ? rule.prepareA(found.a) : found.a;
    return fill(tr(rule.template), { a, b: found.b ?? "" });
  }
  return tr(text);
}
