/*
 * Страховка перевода: русский текст, который попал в разметку мимо `tr()`.
 *
 * Основной путь по-прежнему `tr("…")` в коде. Но строки редакторов часто
 * живут в данных (подписи инструментов, статусы, шаблоны «Слой «{0}» показан»),
 * и обернуть каждое место вывода руками — десятки правок на каждый экран. Этот
 * слой следит за страницей и меняет русский текст узлов и подписи атрибутов
 * (`title`, `aria-label`, `placeholder`, `alt`) на перевод из словаря — точный
 * ключ или шаблон со вставками (`trPattern`). Что в словаре не нашлось, остаётся
 * русским, и это видит сверка языка `window.__astralAudit({rule:'locale'})`.
 *
 * Чего слой не трогает: значения полей ввода и `<textarea>` (их подписи —
 * `aria-label`, `title`, `placeholder` — переводятся, как у кнопок), правимый текст
 * (`contenteditable`), скрипты и стили, куски с чужим `lang` (данные сервера,
 * имена пользователей) и всё, что помечено `data-no-translate`. Для русского
 * языка слой выключен и возвращает исходный текст.
 */

/* Перевод ключа (`trAny` из ui.js) передаётся при включении слоя, а не
   импортируется: ui.js сам импортирует этот модуль, и прямой импорт дал бы цикл. */
let translateKey = null;
/* «Эту строку `tr` уже перевёл сам» (`isUiTranslation` из ui.js): такую целиком не нашли — значит, это не русский, и по словам её не разбирают. */
let isTranslated = null;

const CYRILLIC = /[Ѐ-ӿ]/;
/*
 * Украинский перевод — тоже кириллица, и проверка «остались русские куски»
 * по любой кириллице браковала у него каждый точный перевод: строка шла
 * по фразам и выходила смесью двух языков (12.10.2026). У украинского
 * недопереведённое узнаётся по буквам, которых в нём нет.
 */
const RUSSIAN_ONLY = /[ЁЫЭЪёыэъ]/;
const unfinished = (text) => (currentLanguage === "uk" ? RUSSIAN_ONLY.test(text) : CYRILLIC.test(text));
const TEXT_ATTRIBUTES = ["title", "aria-label", "placeholder", "alt", "aria-description"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT", "CODE", "PRE"]);
/* Поля ввода: текста в них слой не трогает, но подписи (aria-label, title, placeholder) — такой же интерфейс, как у кнопок: без них у ползунков и полей оставалась русская подпись для чтеца экрана. */
const FIELD_TAGS = new Set(["INPUT", "TEXTAREA"]);

/* Что показано вместо исходного текста: чтобы узнать «это наша подмена» и
   вернуть оригинал при смене языка. */
const textShown = new WeakMap();
const attributeShown = new WeakMap();

let currentLanguage = "ru";
let observer = null;
let pending = new Set();
let scheduled = false;
const cache = new Map();

const edgeSpaces = /^(\s*)([\s\S]*?)(\s*)$/;

/*
 * Смешанные строки: «Lichtfarbe: Натрий», «Darstellung · Стрелка (V)» — часть уже
 * переведена в коде, часть пришла из данных. Переводим каждую русскую фразу
 * отдельно: от первой кириллической буквы до знака, который обрывает фразу
 * (`(`, `)`, `·`, `|`, двоеточие, перевод строки).
 */
const RUSSIAN_RUN = /[Ѐ-ӿ][Ѐ-ӿ0-9 \u00a0'’,.!?—–\-+%/&]*/g;
const RUN_TAIL = /[\s,.!?—–-]+$/;

/* Русский кусок, где данные (описание мода) слиты с фразой интерфейса:
   «серверов с переработанными текстурами в избранное». Целиком ключа нет —
   ищем самый длинный хвост из слов, который есть в словаре; начало остаётся
   данными. */
function translateSuffix(core) {
  for (const word of core.matchAll(/\S+/g)) {
    if (word.index === 0) continue;
    const suffix = core.slice(word.index);
    const translated = lookup(suffix);
    if (translated) return core.slice(0, word.index) + translated;
  }
  return null;
}

function translateRuns(text) {
  let changed = false;
  const result = text.replace(RUSSIAN_RUN, (match) => {
    const tail = RUN_TAIL.exec(match)?.[0] || "";
    const core = tail ? match.slice(0, -tail.length) : match;
    const key = core.replace(/\s+/g, " ");
    const translated = lookup(key) || translateSuffix(key);
    if (!translated) return match;
    changed = true;
    return translated + tail;
  });
  return changed ? result : null;
}

function lookup(key) {
  let result = cache.get(key);
  if (result === undefined) {
    result = translateKey ? translateKey(key) : null;
    cache.set(key, result);
  }
  return result;
}

function translateRaw(raw) {
  const [, lead, core, tail] = edgeSpaces.exec(raw);
  const key = core.replace(/\s+/g, " ");
  if (!key) return null;
  const whole = lookup(key);
  if (!whole && isTranslated?.(key)) return null;
  /* Шаблон мог вернуть смесь: переведённый хвост и русские куски внутри.
     Такую строку сначала пробуем разобрать по фразам, а смесь — лишь запасной вариант. */
  if (whole && !unfinished(whole)) return lead + whole + tail;
  const parts = translateRuns(core);
  if (parts) return lead + parts + tail;
  return whole ? lead + whole + tail : null;
}

function skipped(element, attributes = false) {
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    if (SKIP_TAGS.has(node.tagName) && !(attributes && node === element && FIELD_TAGS.has(node.tagName))) return true;
    if (node.hasAttribute("data-no-translate")) return true;
    if (node.getAttribute("contenteditable") === "true") return true;
    const lang = node.getAttribute("lang");
    if (lang && lang !== currentLanguage) return true;
  }
  return false;
}

function processText(node) {
  const raw = node.nodeValue;
  const shown = textShown.get(node);
  if (shown && shown.after === raw) {
    if (currentLanguage === "ru") {
      node.nodeValue = shown.before;
      textShown.delete(node);
      return;
    }
    /* Если «что показано» всё ещё с русскими кусками, это не готовый перевод:
       такой узел переводим заново ниже, иначе он застрянет по-русски. */
    if (!unfinished(raw)) {
      const again = translateRaw(shown.before);
      if (again && again !== raw) {
        node.nodeValue = again;
        textShown.set(node, { before: shown.before, after: again });
      }
      return;
    }
  }
  if (currentLanguage === "ru" || !raw || !CYRILLIC.test(raw)) return;
  if (skipped(node.parentElement)) return;
  const next = translateRaw(raw);
  if (!next || next === raw) return;
  textShown.set(node, { before: raw, after: next });
  node.nodeValue = next;
}

function processElement(element) {
  if (element.nodeType !== 1) return;
  let record = attributeShown.get(element);
  for (const name of TEXT_ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    const raw = element.getAttribute(name);
    const shown = record && record[name];
    if (shown && shown.after === raw) {
      if (currentLanguage === "ru") {
        element.setAttribute(name, shown.before);
        delete record[name];
        continue;
      }
      if (!unfinished(raw)) {
        const again = translateRaw(shown.before);
        if (again && again !== raw) {
          element.setAttribute(name, again);
          record[name] = { before: shown.before, after: again };
        }
        continue;
      }
    }
    if (currentLanguage === "ru" || !raw || !CYRILLIC.test(raw)) continue;
    if (skipped(element, true)) continue;
    const next = translateRaw(raw);
    if (!next || next === raw) continue;
    if (!record) {
      record = {};
      attributeShown.set(element, record);
    }
    record[name] = { before: raw, after: next };
    element.setAttribute(name, next);
  }
}

function processTree(root) {
  if (!root) return;
  if (root.nodeType === 3) {
    processText(root);
    return;
  }
  if (root.nodeType !== 1) return;
  if (SKIP_TAGS.has(root.tagName) && !FIELD_TAGS.has(root.tagName)) return;
  processElement(root);
  const walker = document.createTreeWalker(root, 1 | 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) processText(node);
    else if (!SKIP_TAGS.has(node.tagName) || FIELD_TAGS.has(node.tagName)) processElement(node);
  }
}

function flush() {
  scheduled = false;
  const batch = pending;
  pending = new Set();
  /* Наши же правки приходят сюда снова — `processText` и `processElement`
     узнают их по сохранённому «что показано» и ничего не делают. */
  for (const node of batch) {
    if (node.isConnected) processTree(node);
  }
}

function schedule(node) {
  pending.add(node);
  if (scheduled) return;
  scheduled = true;
  /* Не `requestAnimationFrame`: в скрытом окне кадры не идут, а подмена должна успеть. */
  window.setTimeout(flush, 0);
}

function onMutations(records) {
  for (const record of records) {
    if (record.type === "childList") {
      record.addedNodes.forEach((node) => schedule(node));
    } else if (record.type === "characterData") {
      schedule(record.target);
    } else if (record.type === "attributes") {
      schedule(record.target);
    }
  }
}

/** Включает слой для не-русского языка, выключает и возвращает оригинал для русского. */
export function syncDomTranslator(language, translate = null, translated = null) {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  if (window.__astralNoDomTranslate) return;
  currentLanguage = language || "ru";
  if (translate) translateKey = translate;
  if (translated) isTranslated = translated;
  cache.clear();
  if (currentLanguage !== "ru" && !observer) {
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: TEXT_ATTRIBUTES,
    });
  }
  /* Полный проход после того, как React дорисует смену языка. */
  window.setTimeout(() => {
    processTree(document.body);
    if (currentLanguage === "ru" && observer) {
      observer.disconnect();
      observer = null;
    }
  }, 0);
}
