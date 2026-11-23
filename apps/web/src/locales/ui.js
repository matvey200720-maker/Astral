/*
 * Перевод интерфейса по тексту. Ключ словаря — русская строка из кода, значение —
 * её перевод на uk, en, de, pl. Русская строка без перевода выводится как есть:
 * её находит сверка языка (`window.__astralAudit()`, правило `locale`).
 *
 *   <button>{tr("Применить")}</button>
 *
 * `tr` — обычная функция. Язык она берёт из модуля: оболочка выставляет его во
 * время отрисовки (`setUiLanguage`), а компонент, который читает строки,
 * подписан через `useTr()` и перерисуется, когда язык сменится. Поэтому `tr`
 * можно звать и в хелперах внутри рендера, и в данных, которые собираются при
 * рендере; в данных уровня модуля (константы, выполняемые при загрузке) — нельзя:
 * там язык ещё ru. Такие строки переводят в месте отрисовки.
 *
 * Скорость 12.10: словарь — отдельным куском, русскому окну он не нужен вовсе.
 * Бюджет бандла 18.10: и не одним куском. Источник правды — `ui-text/index.js` (русская
 * строка → [uk, en, de, pl], 15 тыс. строк по файлу на область экрана), но в окно он не
 * едет: `ui-text-plugin.js` собирает из него куски по языкам (по `UI_TEXT_SHARDS` на язык,
 * ключ в куске — хеш русской строки, `ui-text-hash.js`) и список шаблонов со вставками `{0}`.
 * Окно на немецком тянет шаблоны и четыре куска `de` (~0,3 МБ вместо 4 МБ кода), на
 * русском — ничего; язык сменили в настройках (`useUiLanguageSync`) — подгружается только
 * новый. Окно на другом языке подгружает свой перевод до первой отрисовки
 * (`main.jsx` → `prepareUiText`).
 */

import { useEffect, useSyncExternalStore } from "react";
import { syncDomTranslator } from "./dom-translate.js";
import * as builtSource from "./ui-text-loader.js";
import { uiTextHash, uiTextId, uiTextShard } from "./ui-text-hash.js";

let language = "ru";
const listeners = new Set();
/* Откуда берутся куски: в окне — собранные бандлером (`ui-text-loader.js`), под Node без Vite — подставленные явно. */
let source = builtSource;
/* Подгруженные куски языков: код → массив кусков `{ ключ-хеш: перевод }`. */
const packs = new Map();
const loading = new Map();
/* Уже найденное: язык → строка → перевод («» — перевода нет). Хеш строки на каждый вызов `tr` в отрисовке дороже прямого чтения, а строк в окне немного. */
const found = new Map();
const FOUND_LIMIT = 20000;
/* Что `tr` само выдало: язык → готовые переводы. Слою разметки это не русский текст, а своё же — его нельзя разбирать по словам. */
const produced = new Map();
const PRODUCED_LIMIT = 50000;
/* Русские ключи со вставками `{0}` — общий список для всех языков. */
let templateKeys = null;
let templatesLoading = null;
let patternList = null;

/** Подставить источник кусков вместо собранного бандлером — там, где Vite нет (проверки ядра под Node). */
export function provideUiText(next) {
  source = next || builtSource;
  packs.clear();
  found.clear();
  loading.clear();
  templateKeys = null;
  templatesLoading = null;
  patternList = null;
  produced.clear();
}

function loadTemplates() {
  if (!templatesLoading) {
    const attempt = source.TEMPLATES().then((module) => {
      templateKeys = module.default;
      patternList = null;
    });
    templatesLoading = attempt;
    /* Отказ не запоминается: следующий заход пробует снова. */
    attempt.catch(() => {
      if (templatesLoading === attempt) templatesLoading = null;
    });
  }
  return templatesLoading;
}

function loadPack(code) {
  if (!loading.has(code)) {
    const attempt = Promise.all(source.PACKS[code].map((load) => load())).then((modules) => {
      packs.set(
        code,
        modules.map((module) => module.default),
      );
    });
    loading.set(code, attempt);
    attempt.catch(() => {
      if (loading.get(code) === attempt) loading.delete(code);
    });
  }
  return loading.get(code);
}

/**
 * Подгрузить перевод для языков (без аргумента — для всех четырёх, как раньше целым
 * словарём; окну нужен один — `prepareUiText`). Ответ — когда куски на месте.
 */
export function loadUiText(languages = source.LANGUAGES) {
  const wanted = [].concat(languages).filter((code) => code in source.PACKS);
  return Promise.all([loadTemplates(), ...wanted.map(loadPack)]).then(() => undefined);
}

/** Перевод языка (по умолчанию — языка окна) на месте — `tr` переводит. */
export function uiTextReady(code = language) {
  return packs.has(code);
}

/** Окну на языке `next` нужен перевод — подгрузить его до того, как окно заговорит. */
export function prepareUiText(next) {
  return next && next !== "ru" ? loadUiText([next]) : Promise.resolve();
}

/** Перевод точной строки на язык `code`; `undefined`, если куска или строки в словаре нет. */
function lookup(code, text) {
  const shards = packs.get(code);
  if (!shards || typeof text !== "string") return undefined;
  let memo = found.get(code);
  if (!memo) found.set(code, (memo = new Map()));
  const known = memo.get(text);
  if (known !== undefined) return known || undefined;
  const hash = uiTextHash(text);
  const translation = shards[uiTextShard(hash)][uiTextId(hash)];
  /* Строки с данными (имена, числа) бесконечны: потолок, чтобы запоминание не росло без конца. */
  if (memo.size >= FOUND_LIMIT) memo.clear();
  memo.set(text, translation || "");
  if (translation) rememberProduced(code, translation);
  return translation;
}

function rememberProduced(code, text) {
  let own = produced.get(code);
  if (!own) produced.set(code, (own = new Set()));
  if (own.size >= PRODUCED_LIMIT) own.clear();
  own.add(text);
}

/**
 * Строка, собранная кодом на языке окна (функция словаря по языку, как `reshade-copy.js`): слою разметки
 * (`dom-translate.js`) она не русская — по словам не разбирается, даже если в ней есть русское имя из данных.
 */
export function ownUiText(text) {
  if (typeof text === "string" && text) rememberProduced(language, text);
  return text;
}

/**
 * Строка — готовый перевод, который `tr` выдал на языке окна. Слой разметки (`dom-translate.js`) по ней не
 * ходит по словам: у украинского «картинка» в конце «Емблема / власна картинка» пишется так же, как по-русски, и
 * уезжала в «зображення» — выходило «власна зображення» (23.10.2026).
 */
export function isUiTranslation(text) {
  return produced.get(language)?.has(text) === true;
}

/** Оболочка ставит язык окна во время отрисовки — до того, как читают дети. */
export function setUiLanguage(next) {
  language = next || "ru";
}

/** Оболочка после фиксации дерева сообщает подписанным компонентам о смене языка. */
export function notifyUiLanguage() {
  for (const listener of listeners) listener();
}

/** Оболочка: язык окна для `tr` — во время отрисовки; хранилище, `lang` страницы и подписчики — после фиксации. */
export function useUiLanguageSync(next) {
  setUiLanguage(next);
  useEffect(() => {
    localStorage.setItem("modovik-language", next);
    document.documentElement.lang = next;
    notifyUiLanguage();
    syncDomTranslator(next, trAny, isUiTranslation);
    /* Язык сменили в настройках, а перевода ещё нет: пришёл — подписанные
       перерисовываются, а разметка проходится переводом заново. */
    if (next === "ru" || packs.has(next)) return;
    let current = true;
    void loadUiText([next]).then(() => {
      if (!current) return;
      notifyUiLanguage();
      syncDomTranslator(next, trAny, isUiTranslation);
    });
    return () => {
      current = false;
    };
  }, [next]);
}

export function tr(text) {
  return lookup(language, text) || text;
}

/**
 * Перевод точной строки на язык `code`, не обязательно окна: код, который выбирает язык сам (`failureWords(failure, "de")`,
 * `downloadsCopyFor("de")`). Русский — сама строка. Перевод языка должен быть подгружен (`loadUiText`): иначе, как у `tr`,
 * выходит русская строка.
 */
export function trIn(code, text) {
  return code === "ru" ? text : lookup(code, text) || text;
}

/*
 * Шаблоны со вставками: ключ словаря `"Слой «{0}» показан"`, где `{n}` — любое
 * значение. Нужны слою перевода разметки (`dom-translate.js`): строку,
 * собранную в коде шаблоном, не поймать точным ключом. Перевод вставки
 * подставляется, если у неё самой есть перевод (имя набора, единица, слово).
 */
const PLACEHOLDER = /\{(\d+)\}/g;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patterns() {
  if (!templateKeys) return [];
  if (patternList) return patternList;
  patternList = [];
  for (const key of templateKeys) {
    const literals = key.split(/\{\d+\}/);
    const order = [...key.matchAll(PLACEHOLDER)].map((match) => Number(match[1]));
    patternList.push({
      key,
      order,
      longest: literals.reduce((best, part) => (part.length > best.length ? part : best), ""),
      weight: literals.join("").length,
      re: new RegExp(`^${literals.map(escapeRegExp).join("([\\s\\S]*?)")}$`),
    });
  }
  patternList.sort((a, b) => b.weight - a.weight);
  return patternList;
}

/*
 * Вставка шаблона: слово, фраза или другой шаблон («Картина 3» в «{0}: размер
 * картинки»); список через запятую — по частям («пол, стены» в «…свой облик —
 * {1}.»). Нечего переводить — вставка как есть.
 */
function trValue(value, depth) {
  const exact = tr(value);
  if (exact !== value || depth > 2 || !/[Ѐ-ӿ]/.test(value)) return exact;
  const nested = trPattern(value, depth + 1);
  if (nested) return nested;
  if (value.includes(", ")) {
    const parts = value.split(", ");
    const done = parts.map((part) => trValue(part, depth + 1));
    if (done.some((part, i) => part !== parts[i])) return done.join(", ");
  }
  return value;
}

/** Перевод строки, собранной по шаблону из словаря; `null`, если шаблона нет. */
export function trPattern(text, depth = 0) {
  if (!packs.has(language) || !templateKeys || typeof text !== "string") return null;
  for (const pattern of patterns()) {
    if (pattern.longest && !text.includes(pattern.longest)) continue;
    const match = pattern.re.exec(text);
    if (!match) continue;
    const template = lookup(language, pattern.key);
    if (!template) continue;
    const values = [];
    pattern.order.forEach((slot, i) => {
      values[slot] = match[i + 1];
    });
    return template.replace(PLACEHOLDER, (_, slot) => {
      const value = values[Number(slot)] ?? "";
      return trValue(value, depth);
    });
  }
  return null;
}

/**
 * Перевод точной строки или шаблона; `null`, если перевода нет.
 *
 * Готовый перевод по шаблонам не ходит: у украинского с русским общие короткие слова («по», «в», «Все»), и
 * «Ведіть мишею по карті» совпадало с шаблоном «{0} {1} по {2}» → «до карті» (23.10.2026, обход uk).
 */
export function trAny(text) {
  const exact = tr(text);
  if (exact !== text) return exact;
  return isUiTranslation(text) ? null : trPattern(text);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* Снимок подписки `useTr`: язык и то, пришёл ли его перевод, — иначе пришедший
   перевод не перерисовал бы подписанных (язык тот же). */
const trSnapshot = () => (packs.has(language) ? language : `${language}~`);

/** Подписка компонента на язык окна; возвращает `tr` для удобства. */
export function useTr() {
  useSyncExternalStore(subscribe, trSnapshot);
  return tr;
}

/**
 * Язык окна для кода, который выбирает свой словарь (`reshadeCopyFor(language)`, `downloadsCopyFor(language)`). Слова из словаря по этому
 * языку (`trIn`) приходят куском языка позже самого языка, поэтому подписка и на приход перевода — как у `useTr`.
 */
export function useUiLanguage() {
  useSyncExternalStore(subscribe, trSnapshot);
  return useSyncExternalStore(subscribe, () => language);
}

/** Язык окна вне компонента: ключ готовой обложки (`cover-bake.js`). */
export function currentUiLanguage() {
  return language;
}
