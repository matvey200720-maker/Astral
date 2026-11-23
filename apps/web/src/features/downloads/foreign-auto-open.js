import { useEffect, useRef } from "react";

/*
 * «Загрузки» открываются сами, когда появился вопрос «оставить своё или заменить» (решение владельца 17.11.2026 после разбора
 * `docs/beta/incident-2026-11-17-build-foreign-conflict.md`: уведомление говорило «Выбери в «Загрузках»», а человек его не замечал).
 * Вопрос — строка очереди с отказом `foreign-build` (одиночная установка и часть сборки; `utils/installFailure.js`). Правила:
 *
 * - **один раз на вопрос.** Ключ вопроса: у сборки — она сама (`bundle:<bundleId>`, список файлов у ждущих частей общий, `foreign-hold.js`), у одиночной
 *   установки — её мод (`row:<id>`). О ключе сказано один раз, пока он ждёт ответа: вторая часть сборки с тем же вопросом, повторный отказ и перерисовка
 *   страницу не открывают. Ответили и поставили заново (строка ушла из вопросов) — ключ забыт, следующий вопрос по той же сборке новый;
 * - **не поверх открытых.** Страница уже на экране (и не уходит) — открывать нечего, но ключ считается названным: закрыл её человек — сам и откроет;
 * - **вопрос, что уже был в очереди к моменту первого прохода, не новый** (очередь с самого начала не пустая только в тестах и песочнице);
 * - **фокус не воруется.** Страница при открытии берёт фокус себе (`DownloadsPanel`), и человеку, который печатает в поле поиска, это съело бы буквы.
 *   Фокус в поле ввода и клавиша не раньше `TYPING_IDLE_MS` назад — страница ждёт, пока человек сделает паузу (или уйдёт из поля), и тогда открывается; не
 *   печатает — открывается сразу. Вопрос, на который ответили, пока ждали, страницу не открывает. Слово в уведомлении остаётся и работает без неё.
 *
 * Открывает тем же путём, что кнопка на рейке (`openDownloads` оболочки: закрывает окно настроек, снимает уход страницы и ставит её). Хук лёгкий и по `import`
 * в стартовый кусок оболочки входит: чистые ключи и ожидание — тут же, без зависимостей кроме React.
 */

/** Семейство отказа в `utils/installFailure.js`. */
const QUESTION = "foreign-build";

/** Сколько человек не нажимал клавиш, чтобы страница не вырвала фокус у поля посреди набора. */
export const TYPING_IDLE_MS = 1500;

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);

/** Ключи вопросов очереди: ждущая ответа часть сборки — ключ сборки, одиночная установка — ключ её мода. */
export function foreignQuestionKeys(queue) {
  const keys = new Set();
  for (const row of queue || []) {
    if (row?.failed?.kind !== QUESTION) continue;
    keys.add(row.bundleId ? `bundle:${row.bundleId}` : `row:${row.id || row.queueId}`);
  }
  return keys;
}

/** Ключи, которых не было в `before` (множество или `null` на первом проходе — тогда новых нет). */
export function newForeignQuestions(before, keys) {
  if (!before) return [];
  return [...keys].filter((key) => !before.has(key));
}

/** Поле, куда человек вводит текст: строка, область, редактируемый узел. Кнопки, флажки и переключатели — нет. */
export function isTextEntry(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.isContentEditable) return true;
  const tag = String(node.tagName || "").toLowerCase();
  if (tag === "textarea") return true;
  return tag === "input" && TEXT_INPUT_TYPES.has(String(node.getAttribute("type") || "").toLowerCase());
}

/** Сколько ещё ждать паузы в наборе, мс: 0 — страницу можно открывать (фокус не в поле, либо клавиша была давно). */
export function typingWait(active, lastKeyAt, now) {
  if (!isTextEntry(active)) return 0;
  return Math.max(0, TYPING_IDLE_MS - (now - lastKeyAt));
}

/**
 * Оболочка: открывать «Загрузки» на новый вопрос очереди.
 * @param {object} shell `queue` (строки очереди), `visible` (страница на экране и не уходит), `open` (`openDownloads`)
 */
export function useForeignQuestionOpen({ queue, visible, open }) {
  const latest = useRef({ visible, open });
  latest.current = { visible, open };
  /* Ключи вопросов, что ждут ответа сейчас (`null` — первый проход ещё не был) и ключи, что ждут паузы в наборе. */
  const asked = useRef(null);
  const held = useRef({ keys: new Set(), timer: 0 });
  const lastKeyAt = useRef(0);

  useEffect(() => {
    const slot = held.current;
    const onKey = () => {
      lastKeyAt.current = Date.now();
    };
    document.addEventListener("keydown", onKey, { capture: true, passive: true });
    return () => {
      document.removeEventListener("keydown", onKey, { capture: true });
      window.clearTimeout(slot.timer);
    };
  }, []);

  useEffect(() => {
    const keys = foreignQuestionKeys(queue);
    const fresh = newForeignQuestions(asked.current, keys);
    asked.current = keys;
    if (!fresh.length) return;
    const slot = held.current;
    for (const key of fresh) slot.keys.add(key);
    const settle = () => {
      window.clearTimeout(slot.timer);
      slot.timer = 0;
      /* Ждали паузы, а вопрос уже снят (ответили, отменили) — открывать нечего. */
      for (const key of [...slot.keys]) if (!asked.current.has(key)) slot.keys.delete(key);
      if (!slot.keys.size) return;
      const { visible: shown, open: show } = latest.current;
      if (shown) {
        slot.keys.clear();
        return;
      }
      const wait = typingWait(document.activeElement, lastKeyAt.current, Date.now());
      if (wait > 0) {
        slot.timer = window.setTimeout(settle, wait);
        return;
      }
      slot.keys.clear();
      show?.();
    };
    settle();
  }, [queue]);
}
