import { useEffect, useRef } from "react";

import { animateInstallToDownloads } from "../../components/desktop/catalog/install-flight.js";

/*
 * «Применить» в мастерской: работа улетает в «Загрузки», экран не открывается.
 *
 * Раньше новая работа в очереди сама раскрывала «В процессе» поверх
 * мастерской: человек нажимал «Применить» и получал во весь экран окно, которое
 * надо ещё закрывать, — а сама запись в игру идёт сорок пять секунд и в его
 * присутствии не нуждается. Теперь так же, как у загрузок в браузере: работа
 * уходит в кнопку «Загрузки» на рельсе, а счётчик у неё показывает, сколько
 * готово.
 *
 * Что именно летит. Нажали в редакторе — летит сам кадр редактора: он
 * сминается в комок и уходит к кнопке (`work-crumple.js`, просьба владельца
 * 06.10.2026). Кадра нет (нажали не в редакторе) или браузер переход не
 * умеет — летит прежняя карточка с названием из того, на что нажали.
 * Что работа встала в очередь, что установилась и что не вышло, говорят
 * уведомления (`applyWorkshopWork`); подробности — по нажатию на иконку.
 */

/*
 * Смятие нужно только мастерской, а оболочка живёт в стартовом куске, который
 * и без того за бюджетом. Модуль догружается своим куском сразу после
 * старта; пока он не приехал (первые доли секунды), летит плашка.
 */
let crumpleLoad = null;
let crumple = null;
function loadCrumple() {
  crumpleLoad ||= import("./work-crumple.js").then(
    (module) => {
      crumple = module.crumpleWorkToDownloads;
    },
    () => {
      crumpleLoad = null;
    },
  );
  return crumpleLoad;
}

/* Нажатие и появление работы в очереди разделены сохранением правки
   (студия пишет проект до постановки), так что запас с головой. */
const PRESS_FRESH_MS = 6000;

/*
 * Кадр редактора, в котором нажали. Кнопка диалога из того же редактора
 * лежит в портале вне каркаса — тогда кадр того единственного редактора, что
 * открыт на странице.
 */
function stageOf(target) {
  const shell =
    target.closest(".ui-editor-shell") ||
    document.querySelector(".desktop-content .ui-editor-shell");
  return shell?.querySelector(".ui-editor-canvas") || null;
}

/**
 * Запоминает, куда человек нажимал последним: рамку кнопки, а не саму кнопку.
 * Диалог подтверждения, из которого нажали «Применить», к моменту полёта уже
 * размонтирован, и по самой кнопке рамку было бы не взять.
 *
 * Кадр редактора — слабой ссылкой (`WeakRef`): нажатие, которым редактор
 * закрыли («назад»), иначе держало бы его целиком (панели, список, холст) в
 * памяти до следующего нажатия на странице. Закрытый редактор уходит сам.
 *
 * @param {{current: {rect: DOMRect, stage: WeakRef<Element>|null, at: number}|null}} pressRef
 * @returns {() => void} снять слушатель
 */
export function rememberPresses(pressRef) {
  const onClick = (event) => {
    const target = event.target?.closest?.(
      'button, a[href], [role="button"], [role="menuitem"]',
    );
    if (!target) return;
    const stage = stageOf(target);
    pressRef.current = {
      rect: target.getBoundingClientRect(),
      stage: stage ? new WeakRef(stage) : null,
      at: Date.now(),
    };
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

/**
 * Облёт новой работы очереди мастерской до иконки «Загрузки».
 *
 * Новой считается попытка, которой ещё не видели: повторное «Применить» по
 * неудавшейся работе — тоже новая, и тоже не молчит. Работы, что уже стояли в
 * очереди к первому кадру, не летят: их никто не нажимал.
 *
 * @param {Array<{id: string, attempt: number, title: string}>} jobs
 * @param {boolean} paused окно «В процессе» уже открыто — строка и так видна,
 *   а повторное «Применить» из самого окна лететь никуда не должно
 */
export function useWorkInstallFlight(jobs, paused) {
  const seenRef = useRef(null);
  const pressRef = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => rememberPresses(pressRef), []);
  useEffect(() => {
    void loadCrumple();
  }, []);

  useEffect(() => {
    const keys = new Set(jobs.map((job) => `${job.id}:${job.attempt}`));
    const previous = seenRef.current;
    seenRef.current = keys;
    if (!previous || pausedRef.current) return;
    const fresh = jobs.filter(
      (job) => !previous.has(`${job.id}:${job.attempt}`),
    );
    if (!fresh.length) return;
    const press = pressRef.current;
    const pressed = press && Date.now() - press.at < PRESS_FRESH_MS;
    if (pressed && crumple?.({ stage: press.stage?.deref() ?? null })) return;
    void animateInstallToDownloads({
      source: pressed ? { getBoundingClientRect: () => press.rect } : null,
      cover: "",
      label:
        fresh.length > 1
          ? `${fresh[0].title} +${fresh.length - 1}`
          : fresh[0].title,
    });
  }, [jobs]);
}
