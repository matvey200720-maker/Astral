import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { VirtualScrolledProvider } from "./virtual-scrolled.js";
import { isPhotoShown, watchShownPhotos } from "../../utils/shown-photos.js";
import { setVirtualFling } from "./virtual-fling.js";
import { isSectionSwitching } from "./scroll-gate.js";

/*
 * Сетка карточек, у которой в документе только видимые ряды.
 *
 * Каталог рисовал все карточки сразу. На шести модах этого не видно, а
 * выгрузка Discord приносит тысячи: на синтетике в 3000 модов открытие
 * каталога стоило 28 с (одна задача — 16 с), смена раздела — 24 с, прокрутка
 * шла четырьмя кадрами в секунду, в документе было 49 тысяч узлов. Почти всё —
 * раскладка и стили карточек, которых никто не видит.
 *
 * Здесь рядов в документе столько, сколько видно, плюс запас сверху и снизу.
 * Сетка остаётся той же сеткой: число колонок и высоту ряда задаёт её лист
 * (медиазапросы, `aspect-ratio` карточки, `gap`), а не пропсы, — компонент
 * читает их с живой сетки. Поэтому и вёрстка, и адаптив живут в CSS, как без
 * виртуализации.
 *
 * КОНТРАКТ
 *
 *  • колонки — дорожки CSS-сетки корня (`grid-template-columns`); высота ряда
 *    одна на всю сетку — самая высокая из нарисованных карточек, и сетка
 *    задаёт её всем рядам (`grid-auto-rows`). Карточки бывают разной высоты:
 *    у вещи одежды строка пола, у части редукса — имя сборки (12.10). Мерка по
 *    первой нарисованной карточке давала шаг то короткой, то высокой, отступы
 *    ошибались на каждом сдвиге рядов, а перемер на смене высоты сетки
 *    качал шаг туда-обратно: «когда скроллишь вниз, всё равно дёргается»
 *    (владелец 22.10.2026; «Для редуксов» на 3000 модах — рывки по 340–790 px,
 *    высота прокрутки 41 400 ↔ 44 856 через кадр). Поэтому при той же ширине
 *    сетки высота ряда только растёт, а заново снимается со сменой ширины;
 *    карточки в ряду не растягиваются (`align-items: start`), чтобы мерка
 *    видела их собственную высоту;
 *  • сетка не заводит свою прокрутку — едет в прокрутке колонки
 *    (`.desktop-main`), над ней стоят шапка и фильтры;
 *  • невидимые ряды держат место отступами корня (`padding-block`), а не
 *    сдвигом: у сеток каталога своя анимация появления на `transform`, и
 *    сдвиг спорил бы с ней. Свои отступы по вертикали корню задавать нельзя;
 *  • якорь прокрутки браузера (`overflow-anchor`) у корня выключен (бета
 *    14.10.2026, fufel: «листаешь вниз, а скролл возвращается»). Когда ряды
 *    сдвигаются, верхний отступ растёт, а карточка-якорь уходит из документа;
 *    браузер «удерживал» её место и отматывал прокрутку на ряд-два назад,
 *    сетка пересчитывала ряды под новое место — и прокрутка качалась
 *    (замер на 600 модах: 1874 → 1405 → 1874 раз в секунду). Отступы и так
 *    держат высоту точно, якорь здесь не нужен;
 *  • `renderItem(item, index)` возвращает карточку с `key`;
 *  • очередь появления (`data-assembly-grid`, useAssemblyOrder) — только у
 *    первого экрана: ряды, доехавшие прокруткой, встают сразу, без волны;
 *  • `data-virtual-scrolled` — окно рядов хоть раз сдвинулось прокруткой. Карточки,
 *    которые приезжают после этого, встают без плит скелета под фото
 *    (`assembly-motion.css`): серая плита с бликом на каждой въехавшей карточке
 *    стоила трети кадра прокрутки (стенд 30.10.2026, ×4, 3000 модов: пересчёт
 *    стилей −50 %, сборка слоёв −40 %), а фото ложится на тёмную подложку
 *    карточки и проявляется как всегда. Сетка отдаёт это значение карточкам
 *    (`useVirtualScrolled`, `virtual-scrolled.js`): карточка с плитой под фото
 *    в прокрученной сетке плиту не ставит вовсе — скрытый узел со своим стилем
 *    и тремя эффектами тоже стоил кадра;
 *  • `onAhead(карточки)` — карточки сразу за краем окна, по `aheadRows` рядов с
 *    каждой стороны, пока их нет в документе: вызывающий готовит им то, что
 *    иначе делалось бы вторым проходом после монтирования (замер рисунка,
 *    `warmFrameCrop`). Один вызов на сдвиг окна, без чтения раскладки;
 *  • рывок (прокрутка быстрее 3 px/мс: ползунок, End, колесо с разгона) —
 *    `data-virtual-fling` у сетки. Карточки, что встали в документ посреди
 *    рывка, пролетают мимо и ничего не просят: у них `data-virtual-held`
 *    (CSS убирает фон и прячет ещё не готовую картинку,
 *    `assembly-motion.css`), замер рисунка ждёт конца рывка (`virtual-fling.js`),
 *    `onAhead` молчит. Рывок кончился (160 мс без быстрых событий) — признаки
 *    сняты, `onAhead` зовётся для места остановки, и просят картинки уже только те
 *    карточки, что остались. Браузер отменить запрос стоящей в очереди
 *    картинки не умеет: на холодном кэше сотня лишних загрузок ставила
 *    последний экран в хвост очереди. Карточки, стоявшие до рывка, не
 *    трогаются, как и те, чьи картинки в этом окне уже показывали: у них
 *    готовый файл в кэше браузера и API, холодного запроса не будет, а
 *    ждать конца рывка — пустые карточки при прокрутке своего каталога;
 *  • `progressive` — подмена выдачи (поиск, порядок, раздел: окно целиком из других карточек) не монтирует окно одним коммитом: первый ряд (`FIRST_ROWS`) новых
 *    карточек встают сразу, дальше — по ряду за кадр, пока окно не дойдёт до своего места (пока идёт печать, ряды ждут: `TYPING_HOLD_MS`). Карточки, что уже стояли в окне, в счёт не идут (догрузка страниц каталога
 *    ничего не подрезает). Стиль и раскладка свежих узлов — ~290 мкс на узел при ×4, 28 карточек по 19 узлов — ~150 мс одного кадра; по ряду за кадр это 4 карточки
 *    за ~25 мс. Прокрутка, смена размера и новая подмена обрывают недосчитанное;
 *  • фокус не теряется: карточка с фокусом, уходящая за край, отдаёт его
 *    корню, прежде чем пропасть из документа (как у VirtualList);
 *  • `onGeometry({ columns, step, viewport })` — сетка сообщает, сколько у неё
 *    колонок, шаг ряда и высоту окна прокрутки: ленте с местами показа это
 *    нужно, чтобы на экран не попадало два места сразу;
 *  • где сетку не измерить (jsdom, колонка без высоты, сетка вне
 *    прокрутки), рисуются все карточки: деградация до обычной сетки, а не
 *    до пустой. До первого замера рисуется первый экран. Свёрнутое окно —
 *    не «не измерить»: сетка ждёт видимости с тем, что уже было.
 */

const SCROLLABLE = new Set(["auto", "scroll", "overlay"]);

/* Карточек до первого замера: экран каталога с запасом. */
const FIRST_SCREEN = 24;
/* Монтаж подмены выдачи (`progressive`): столько рядов новых карточек встаёт сразу, остальные — по ряду за кадр. Один ряд, а не два (замер 1.11.2026, ×4, «ni», 8 кругов чередой: первые ряды +253 → +214 мс без входной анимации, +225 → +207 с ней; вся сетка +401 → +345 и +383 → +351). Пол ряда и две карточки за кадр — хуже: коммитов больше, блокировка 29–31 мс вместо 7. */
const FIRST_ROWS = 1;
const idOf = (item) => item?.id ?? item?.key ?? item;

/* Печать идёт, пока от последней клавиши не прошло столько: ряды подмены выдачи не дорастают на ходу (коммит ряда — ~30 мс при ×4, и буква, пришедшая в его разгар, ждёт его конца). */
const TYPING_HOLD_MS = 100;
let lastKeyAt = -Infinity;
if (typeof window !== "undefined")
  window.addEventListener("keydown", () => { lastKeyAt = performance.now(); }, { capture: true, passive: true });

/* Правая граница окна `[first, last)` подмены выдачи: не дальше ряда, на котором новых карточек (которых нет в `known`) становится больше `rows` рядов. */
function leadingRows(list, first, last, columns, known, rows) {
  const room = columns * rows;
  let added = 0;
  for (let at = first; at < last; at += 1) {
    if (known.has(idOf(list[at]))) continue;
    added += 1;
    if (added > room) return Math.max(first + columns, at - ((at - first) % columns));
  }
  return last;
}
/* Рывок: быстрее 3 px/мс (более 12 рядов в секунду); признак держится, пока 100 мс нет быстрых событий прокрутки. */
const FLING_PX_PER_MS = 3;
const FLING_CALM_MS = 100;

/* Адреса картинок карточки: `<img src>` и фон кадра. Читаются атрибуты и встроенный стиль — раскладка не нужна. */
const BACKGROUND_URL = /url\((['"]?)(.*?)\1\)/;
function photosOf(card) {
  const urls = [];
  for (const image of card.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src");
    if (src) urls.push(src);
  }
  const match = BACKGROUND_URL.exec(card.querySelector(".ui-media-card-frame")?.style.backgroundImage || "");
  if (match?.[2]) urls.push(match[2]);
  return urls;
}

/* Все картинки карточки уже были показаны в этом окне: холодного запроса не будет, и на рывке ей нечего ждать (`virtual-fling.js`). */
function isShownCard(card) {
  const urls = photosOf(card);
  return urls.length > 0 && urls.every(isPhotoShown);
}

/* Геометрия последней измеренной сетки по её классу. Вернувшийся в раздел
   получает полную высоту сетки с первого кадра — иначе память прокрутки
   раздела (`useRememberedScroll`) упёрлась бы в короткий первый экран. */
const lastGeometry = new Map();

function scrollParentOf(element) {
  /* Коробка, что объявила свою прокрутку (`data-scroll-own`), находится без `getComputedStyle` у каждого предка: тот посреди фиксации
     досчитывал стили всей новой комнаты тут же (вход в «Анимации», 2.11.2026: 302 элемента, 40 мс при ×4). */
  const own = element?.parentElement?.closest?.("[data-scroll-own]");
  if (own) return own;
  for (let node = element?.parentElement; node; node = node.parentElement) {
    if (SCROLLABLE.has(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/* Колонки и шаг ряда с живой сетки; `null`, если мерить не по чему. Высота
   ряда — самая высокая из нарисованных карточек; при той же ширине и тех же
   колонках, что у мерки `known`, она не опускается ниже прежней — иначе шаг
   качался бы с тем, какие карточки сейчас в документе. */
function readGeometry(grid, known = null) {
  const style = getComputedStyle(grid);
  const columns = style.gridTemplateColumns
    .split(/\s+/)
    .filter((track) => /^\d/.test(track)).length;
  const width = grid.clientWidth || 0;
  let height = 0;
  for (const card of grid.children)
    height = Math.max(height, card.getBoundingClientRect().height || 0);
  if (!columns || !height) return null;
  if (known && known.columns === columns && known.width === width)
    height = Math.max(height, known.rowHeight);
  const gap = parseFloat(style.rowGap) || 0;
  return { columns, width, rowHeight: height, gap, step: height + gap };
}

function keepFocus(grid, shownFirst, next) {
  const active = grid.ownerDocument.activeElement;
  if (!active || active === grid || !grid.contains(active)) return;
  const offset = [...grid.children].findIndex((card) => card.contains(active));
  if (offset < 0) return;
  const index = shownFirst + offset;
  if (index < next.first || index >= next.last)
    grid.focus({ preventScroll: true });
}

export default function VirtualGrid({
  items,
  renderItem,
  overscanRows = 2,
  assembly = true,
  className = "",
  style = undefined,
  tabIndex = -1,
  onGeometry = null,
  onAhead = null,
  aheadRows = 2,
  progressive = false,
  ...rest
}) {
  const gridRef = useRef(null);
  const scrollerRef = useRef(null);
  /*
   * Колонки и шаг ряда меняются только с размером сетки (их задаёт её лист),
   * а не с прокруткой: замер стилей и первой карточки на каждом кадре
   * прокрутки — лишняя раскладка. Мерка живёт здесь и снимается заново
   * при смене размера (наблюдатель) и когда её ещё нет (задача 6 ТЗ 08.10).
   */
  const geometryRef = useRef(null);
  /* Коммит, который вызвал сам замер, не перемеряется: диапазон уже
     посчитан по свежему замеру, а чтение раскладки сразу после вставки
     карточек — принудительный пересчёт всей сетки на каждом шаге прокрутки
     (профиль: 1,4 с из 6 с прокрутки каталога в 100 модов). */
  const selfRenderRef = useRef(false);
  /* Рывок идёт (скорость прокрутки выше `FLING_PX_PER_MS`) и вызов «карточки за краем» для текущего окна. */
  const flingRef = useRef(false);
  const announceAheadRef = useRef(null);
  const itemsRef = useRef(items);
  const count = items.length;
  const [view, setView] = useState(() => {
    const known = lastGeometry.get(className);
    return {
      geometry: known || null,
      first: 0,
      last: Math.min(count, FIRST_SCREEN),
      scrolled: false,
    };
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  /* Запас рядов за краем окна на первом замере не рисуется (холодный вход): он дорисовывается в простое. */
  const toppedUpRef = useRef(Boolean(lastGeometry.get(className)));
  const topUpRef = useRef(0);
  const measureRef = useRef(null);
  /* Окно, что дорастает по ряду за кадр после подмены выдачи (`progressive`): рука кадра. */
  const growRef = useRef(0);

  const measure = useCallback(
    (fromScroll = false, fresh = false, replaced = null) => {
      const grid = gridRef.current;
      if (!grid) return;
      if (growRef.current) {
        cancelAnimationFrame(growRef.current);
        growRef.current = 0;
      }
      const scroller = scrollerRef.current;
      const viewport = scroller?.clientHeight || 0;
      /* Мерка — первая настоящая карточка; без неё — прошлая мерка. Новая
         снимается при смене размера и пока своей ещё нет. */
      if (fresh || !geometryRef.current)
        geometryRef.current =
          (count && readGeometry(grid, geometryRef.current)) || null;
      const geometry = geometryRef.current || viewRef.current.geometry;
      if (!viewport || !geometry) {
        /* Окно свёрнуто или спрятано: у прокрутки нет высоты. Измеренная
           сетка остаётся какой была, неизмеренная ждёт видимости первым
           экраном. Откат ко всем карточкам здесь стоил бы на выгрузке в
           5 000 модов секунд и десятков тысяч узлов на каждой догрузке
           страниц каталога в свёрнутом окне (Т-99). */
        if (grid.ownerDocument.visibilityState === "hidden") {
          if (!viewRef.current.geometry)
            setView((current) =>
              current.first === 0 && current.last <= FIRST_SCREEN
                ? current
                : { ...current, first: 0, last: FIRST_SCREEN },
            );
          return;
        }
        setView((current) =>
          current.geometry === null && current.last === count
            ? current
            : { ...current, geometry: null, first: 0, last: count },
        );
        return;
      }
      lastGeometry.set(className, geometry);
      if (!toppedUpRef.current && !topUpRef.current) {
        const idle = window.requestIdleCallback || ((run) => window.setTimeout(run, 120));
        topUpRef.current = idle(
          () => {
            toppedUpRef.current = true;
            topUpRef.current = 0;
            measureRef.current?.(false, false);
          },
          { timeout: 500 },
        );
      }
      const rows = Math.ceil(count / geometry.columns);
      /* Сколько сетки ушло выше окна прокрутки. */
      const hidden =
        scroller.getBoundingClientRect().top - grid.getBoundingClientRect().top;
      const firstRow = Math.max(
        0,
        Math.min(rows, Math.floor(hidden / geometry.step) - (toppedUpRef.current ? overscanRows : 0)),
      );
      const lastRow = Math.max(
        firstRow,
        Math.min(
          rows,
          Math.ceil((hidden + viewport) / geometry.step) + (toppedUpRef.current ? overscanRows : 0),
        ),
      );
      const next = {
        first: firstRow * geometry.columns,
        last: Math.min(count, lastRow * geometry.columns),
      };
      /* Подмена выдачи: сразу — окно до `FIRST_ROWS` рядов новых карточек, остальное дорастает по ряду за кадр. */
      let target = null;
      if (replaced && geometry.columns) {
        const cut = leadingRows(itemsRef.current, next.first, next.last, geometry.columns, replaced, FIRST_ROWS);
        if (cut < next.last) {
          target = { last: next.last };
          next.last = cut;
        }
      }
      const shown = viewRef.current;
      keepFocus(grid, shown.first, next);
      if (
        shown.first !== next.first ||
        shown.last !== next.last ||
        !shown.geometry ||
        shown.geometry.columns !== geometry.columns ||
        shown.geometry.step !== geometry.step
      )
        selfRenderRef.current = true;
      setView((current) => {
        const moved =
          current.first !== next.first || current.last !== next.last;
        const sameGeometry =
          current.geometry &&
          current.geometry.columns === geometry.columns &&
          current.geometry.step === geometry.step;
        if (!moved && sameGeometry) return current;
        return {
          geometry,
          ...next,
          scrolled: current.scrolled || (fromScroll && moved),
        };
      });
      if (target) {
        let reached = next.last;
        const grow = () => {
          growRef.current = 0;
          if (performance.now() - lastKeyAt < TYPING_HOLD_MS) {
            growRef.current = requestAnimationFrame(grow);
            return;
          }
          reached = Math.min(target.last, reached + geometry.columns);
          const upTo = reached;
          selfRenderRef.current = true;
          setView((current) => ({ ...current, last: upTo }));
          if (reached < target.last) growRef.current = requestAnimationFrame(grow);
        };
        growRef.current = requestAnimationFrame(grow);
      }
    },
    [className, count, overscanRows],
  );

  measureRef.current = measure;
  useEffect(
    () => () => {
      const cancel = window.cancelIdleCallback || window.clearTimeout;
      if (topUpRef.current) cancel(topUpRef.current);
      if (growRef.current) cancelAnimationFrame(growRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    /* Колонка прокрутки та же, пока сетка в ней: поиск родителя — `getComputedStyle` на каждом предке, а эффект встаёт заново на каждое число карточек (набор в поиске:
       80 мс из ~860 за слово при ×4). */
    if (!(scrollerRef.current?.isConnected && scrollerRef.current.contains(grid))) scrollerRef.current = scrollParentOf(grid);
    const target = scrollerRef.current;
    if (!target) return undefined;
    /* Прокрутка шлёт события чаще кадра — замер один на кадр. Смена
       размера просит заново снять колонки и шаг ряда. */
    let frame = 0;
    let scrolled = false;
    let resized = false;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const fromScroll = scrolled;
        const fresh = resized;
        scrolled = false;
        resized = false;
        measure(fromScroll, fresh);
      });
    };
    /* Быстрая прокрутка (рывок): пока она идёт, у сетки `data-virtual-fling`, а карточки, что пришли в документ во время рывка, помечены `data-virtual-held` и не просят
       ни фон, ни картинку (`assembly-motion.css`, `virtual-fling.js`); те, что стояли до рывка, и те, чьи картинки в этом окне уже показывали, остаются как были.
       Скорость — по соседним событиям, без чтения раскладки; признаки пишутся прямо в DOM, перерисовки нет. */
    watchShownPhotos();
    let lastTop = target.scrollTop;
    let lastAt = performance.now();
    let calm = 0;
    let calmFrame = 0;
    /* Таймер успокоения мог сработать, пока главный поток стоял на долгой задаче, а прокрутка шла своим ходом (на слабом ПК так бывает посреди рывка): события
       прокрутки догонят в ближайшем кадре и раньше его обратных вызовов, поэтому решает кадр — прошло ли с последнего события `FLING_CALM_MS` на самом деле. */
    const settle = () => {
      calm = 0;
      calmFrame = requestAnimationFrame(() => {
        calmFrame = 0;
        if (performance.now() - lastAt < FLING_CALM_MS) {
          calm = setTimeout(settle, FLING_CALM_MS);
          return;
        }
        endFling();
        announceAheadRef.current?.();
      });
    };
    const startFling = () => {
      flingRef.current = true;
      setVirtualFling(true);
      const grid = gridRef.current;
      if (!grid) return;
      grid.setAttribute("data-virtual-fling", "");
      for (const card of grid.children) card.setAttribute("data-virtual-seen", "");
    };
    const endFling = () => {
      flingRef.current = false;
      const grid = gridRef.current;
      if (grid) {
        grid.removeAttribute("data-virtual-fling");
        for (const card of grid.children) {
          card.removeAttribute("data-virtual-seen");
          card.removeAttribute("data-virtual-held");
        }
      }
      setVirtualFling(false);
    };
    const onScroll = () => {
      /* Оболочка отматывает общий контейнер наверх при нажатии на другой раздел, а эта страница ещё кадр-другой слушает — окно рядов за этим не едет. */
      if (isSectionSwitching()) return;
      const now = performance.now();
      const top = target.scrollTop;
      const speed = Math.abs(top - lastTop) / Math.max(1, now - lastAt);
      lastTop = top;
      lastAt = now;
      if (speed > FLING_PX_PER_MS) {
        if (!flingRef.current) startFling();
        clearTimeout(calm);
        cancelAnimationFrame(calmFrame);
        calmFrame = 0;
        calm = setTimeout(settle, FLING_CALM_MS);
      }
      scrolled = true;
      schedule();
    };
    const onResize = () => {
      resized = true;
      schedule();
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(onResize)
        : null;
    observer?.observe(target);
    observer?.observe(grid);
    return () => {
      target.removeEventListener("scroll", onScroll);
      /* Страница каталога догрузилась посреди рывка и пересняла подписку: признак без таймера остался бы навсегда. */
      clearTimeout(calm);
      cancelAnimationFrame(calmFrame);
      if (flingRef.current) endFling();
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure]);

  /* Число карточек, шапка над сеткой и прокрутка, которую раздел вернул из
     памяти в своём эффекте, меняются без события прокрутки; лишней
     перерисовки нет — диапазон сравнивается с прежним. Коммит самого замера
     (сдвиг диапазона прокруткой) не перемеряется: читать раскладку сразу
     после вставки карточек — пересчитывать всю сетку на каждом шаге. */
  useLayoutEffect(() => {
    const sameItems = itemsRef.current === items;
    /* Что стояло в окне до подмены: новые карточки считаются против этого (`progressive`). */
    const before =
      !sameItems && progressive && viewRef.current.geometry
        ? new Set(itemsRef.current.slice(viewRef.current.first, viewRef.current.last).map(idOf))
        : null;
    itemsRef.current = items;
    if (selfRenderRef.current && sameItems) {
      selfRenderRef.current = false;
      return;
    }
    selfRenderRef.current = false;
    measure(false, !sameItems, before);
  });

  /* Карточки, что встали в документ посреди рывка, — под замком до его конца (`data-virtual-held`): они пролетают мимо и ничего не просят. Только в рывок, иначе — ни одного обхода. */
  useLayoutEffect(() => {
    if (!flingRef.current) return;
    for (const card of gridRef.current?.children || []) {
      if (card.hasAttribute("data-virtual-seen")) continue;
      card.setAttribute("data-virtual-seen", "");
      if (!isShownCard(card)) card.setAttribute("data-virtual-held", "");
    }
  });

  const measuredColumns = view.geometry?.columns || 0;
  const measuredStep = view.geometry?.step || 0;
  useLayoutEffect(() => {
    if (!onGeometry || !measuredColumns) return;
    onGeometry({
      columns: measuredColumns,
      step: measuredStep,
      viewport: scrollerRef.current?.clientHeight || 0,
    });
  }, [onGeometry, measuredColumns, measuredStep]);

  /* Без мерки рисуется то, что решил замер: первый экран до него и все
     карточки, если мерить не по чему. */
  const { geometry } = view;
  const first = geometry ? Math.min(view.first, count) : 0;
  let last = Math.min(view.last, count);
  /* Первый рендер с подменой выдачи (`progressive`): окно целиком из других карточек не монтируется одним коммитом — только первые ряды, остальное дорастает по кадру (`measure`). */
  if (progressive && geometry && itemsRef.current !== items) {
    const known = new Set(itemsRef.current.slice(view.first, view.last).map(idOf));
    last = Math.min(last, leadingRows(items, first, last, geometry.columns, known, FIRST_ROWS));
  }

  /* Карточки сразу за краем окна (по `aheadRows` рядов с каждой стороны) отдаются вызывающему, пока их нет в документе: он готовит им то, что иначе
     делалось бы вторым проходом после монтирования (замер рисунка, `warmFrameCrop`). Окно сдвинулось — один вызов, без чтения раскладки. */
  const aheadRef = useRef(onAhead);
  aheadRef.current = onAhead;
  const aheadColumns = geometry?.columns || 0;
  /* На рывке карточки за краем пролетают мимо — им замер (а с ним и загрузка картинки) не готовят; рывок кончился — готовят тем, что осталось у края. */
  announceAheadRef.current = () => {
    if (!aheadRef.current || !aheadColumns || flingRef.current) return;
    const span = aheadRows * aheadColumns;
    aheadRef.current([
      ...itemsRef.current.slice(Math.max(0, first - span), first),
      ...itemsRef.current.slice(last, last + span),
    ]);
  };
  useEffect(() => {
    announceAheadRef.current();
  }, [first, last, aheadColumns, aheadRows, count]);

  let padding;
  if (geometry) {
    const rows = Math.ceil(count / geometry.columns);
    const firstRow = Math.floor(first / geometry.columns);
    const lastRow = Math.ceil(last / geometry.columns);
    padding = {
      paddingTop: firstRow * geometry.step,
      paddingBottom: Math.max(0, rows - lastRow) * geometry.step,
    };
  }

  return (
    <div
      ref={gridRef}
      className={className}
      tabIndex={tabIndex}
      data-assembly-grid={assembly && !view.scrolled ? "" : undefined}
      data-virtual-scrolled={view.scrolled ? "" : undefined}
      data-virtual-first={first}
      data-assembly-columns={assembly && geometry ? geometry.columns : undefined}
      style={{
        ...style,
        ...padding,
        ...(geometry && {
          gridAutoRows: `minmax(${geometry.rowHeight}px, auto)`,
          alignItems: "start",
        }),
        overflowAnchor: "none",
      }}
      {...rest}
    >
      <VirtualScrolledProvider value={view.scrolled}>
        {items
          .slice(first, last)
          .map((item, offset) => renderItem(item, first + offset))}
      </VirtualScrolledProvider>
    </div>
  );
}
