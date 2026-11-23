import { useLayoutEffect, useState } from "react";

import { ASSEMBLY_MAX_ROW, assemblyOrder } from "../assembly-order.js";
import { useEditorRoomOpen } from "../components/ui/useEditorRoom.js";
import { useMotionEnabled } from "../motion-preference.js";

/*
 * Кто расставляет карточки по очереди.
 *
 * ДОГОВОР. Сетку помечают атрибутом `data-assembly-grid`, её прямые дети —
 * карточки. Больше от разметки ничего не нужно: ни индексов в `style`, ни
 * классов, ни знания о числе колонок. Задержку каждому ребёнку считает лист
 * assembly-motion.css из двух свойств, которые ставит этот хук:
 * `--reveal-row` и `--reveal-col`.
 *
 * ПОЧЕМУ ХУК ОДИН НА ВСЁ ОКНО. Он вешается на `.desktop-main` и находит все
 * помеченные сетки внутри — каталог, обе полки мастерской, каталог оружия,
 * список загрузок, полку сборок. Иначе тот же вызов пришлось бы повторить в
 * десятке мест, и первая же новая сетка про него бы забыла.
 *
 * Именно на `.desktop-main`, а не на `.desktop-content` под ним: у контента
 * стоит `key={page}`, и при переходе между разделами React меняет сам узел.
 * Наблюдатель, повешенный на него, остался бы смотреть на выброшенный узел, и
 * очередь на новой странице никто бы не расставил. `.desktop-main` живёт
 * столько же, сколько окно, а смена раздела приходит сюда обычной правкой
 * дерева.
 *
 * ПОЧЕМУ КАЖДУЮ КАРТОЧКУ МЕРЯЮТ ОДИН РАЗ. Анимация входа идёт с `backwards`:
 * пока не вышла задержка, карточка держит начальный кадр — то есть невидима.
 * Если переписать задержку карточке, которая уже доиграла, она вернётся в это
 * состояние и пропадёт с экрана. Поэтому измеренная карточка помечается
 * `data-assembly-placed` и больше не трогается — ни при изменении ширины окна,
 * ни когда рядом добавятся новые.
 *
 * ПОЧЕМУ РЯДЫ СЧИТАЮТСЯ ОТ ПЕРВОЙ НЕИЗМЕРЕННОЙ. Каталог оружия за раскрытием
 * добавляет к десяти карточкам ещё тридцать. Считай мы ряды от верха сетки,
 * вся добавка попала бы в потолок задержки и приехала одним куском. Ряды
 * нумеруются внутри партии, поэтому и первое открытие, и раскрытие каталога
 * собираются одинаково — сверху вниз, ряд за рядом.
 */

export const ASSEMBLY_GRID_ATTRIBUTE = "data-assembly-grid";
export const ASSEMBLY_PLACED_ATTRIBUTE = "data-assembly-placed";
/* Сетка, которая сама знает свои колонки (`VirtualGrid`: число колонок и номер первой карточки окна), отдаёт их атрибутами — ряд и место в ряду считаются по номеру карточки,
   раскладку читать не нужно (подмена выдачи в поиске, 31.10.2026: `offsetTop` у свежих карточек — принудительный пересчёт стиля и раскладки, ~40 мс при ×4). */
export const ASSEMBLY_COLUMNS_ATTRIBUTE = "data-assembly-columns";
const FIRST_ATTRIBUTE = "data-virtual-first";

const GRID_SELECTOR = `[${ASSEMBLY_GRID_ATTRIBUTE}]`;
const UNPLACED_SELECTOR = `:scope > :not([${ASSEMBLY_PLACED_ATTRIBUTE}])`;

/** Расставляет очередь в одной сетке. Возвращает число размеченных карточек. */
export function placeAssemblyGrid(grid) {
  const known = Number(grid.getAttribute(ASSEMBLY_COLUMNS_ATTRIBUTE)) || 0;
  if (known) return placeByIndex(grid, known);
  const pending = [...grid.querySelectorAll(UNPLACED_SELECTOR)];
  if (pending.length === 0) return 0;

  /* Сначала читаем всё, потом пишем: чтение `offsetTop` заставляет браузер
     разложить страницу, и вперемежку с записью это была бы одна раскладка на
     каждую карточку. */
  const boxes = pending.map((card) => ({
    top: card.offsetTop,
    left: card.offsetLeft,
  }));

  const places = assemblyOrder(boxes);
  places.forEach((place, index) => {
    const card = pending[index];
    card.style.setProperty("--reveal-row", String(place.row));
    card.style.setProperty("--reveal-col", String(place.column));
    card.setAttribute(ASSEMBLY_PLACED_ATTRIBUTE, "");
  });

  /* Числом колонок лист считает шаг ряда. Без него шаг пришлось бы задать
     постоянным, а он обязан быть длиннее, чем ряд едет: на сетке из шести
     колонок ряд занимает 150 мс, и следующий, тронувшись через 130, обгонял бы
     предыдущий — волна шла бы наискось вместо «ряд, потом ряд». */
  const columns = places.reduce((max, place) => Math.max(max, place.column), 0);
  grid.style.setProperty("--reveal-columns", String(columns + 1));

  return pending.length;
}

/** Тот же порядок, что у `assemblyOrder`, из номеров карточек: ряды — от первого ещё не расставленного, место — по порядку в своём ряду, потолок рядов тот же. Ничего не читает. */
function placeByIndex(grid, columns) {
  const first = Number(grid.getAttribute(FIRST_ATTRIBUTE)) || 0;
  let rows = 0;
  let rowOf = -1;
  let column = 0;
  let widest = 0;
  let placed = 0;
  let at = 0;
  for (const card of grid.children) {
    const index = first + at;
    at += 1;
    if (card.hasAttribute(ASSEMBLY_PLACED_ATTRIBUTE)) continue;
    const row = Math.floor(index / columns);
    if (row !== rowOf) {
      if (rowOf >= 0) rows += 1;
      rowOf = row;
      column = 0;
    }
    card.style.setProperty("--reveal-row", String(Math.min(rows, ASSEMBLY_MAX_ROW)));
    card.style.setProperty("--reveal-col", String(column));
    card.setAttribute(ASSEMBLY_PLACED_ATTRIBUTE, "");
    widest = Math.max(widest, column);
    column += 1;
    placed += 1;
  }
  if (placed) grid.style.setProperty("--reveal-columns", String(widest + 1));
  return placed;
}

function placeAll(scope) {
  if (scope.matches?.(GRID_SELECTOR)) placeAssemblyGrid(scope);
  for (const grid of scope.querySelectorAll(GRID_SELECTOR)) {
    placeAssemblyGrid(grid);
  }
}

/**
 * Возвращает ref для контейнера окна. Вешать на `.desktop-main`.
 *
 * Именно возвращает функцию, а не принимает `useRef`. Окно доходит до
 * `.desktop-main` не сразу: до него на экране успевают побывать загрузка,
 * вход и первый запуск. Эффект с обычным ref-объектом сработал бы один раз —
 * на пустом месте, ничего не нашёл бы и больше не запустился, потому что
 * заполнение `ref.current` перерисовки не вызывает. Функция-ref приходит с
 * узлом, и эффект начинается тогда, когда есть что мерить.
 */
export default function useAssemblyOrder() {
  const [scope, setScope] = useState(null);
  /* Не «прочитать один раз», а подписка: выключатель движения — настройка,
     которую меняют при открытом окне, и с ним меняется решение хука. */
  const motionOn = useMotionEnabled();
  /* Открыт редактор — сеток сборки в нём нет, а наблюдатель на всём окне получал бы каждую правку кадра: щелчок набора
     подписей большой карты — сотни путей SVG, и на каждую пачку — поиск сеток по всему редактору (21.10.2026).
     Закрылся редактор — эффект встаёт заново и расставляет то, что появилось. */
  const editorOpen = useEditorRoomOpen();

  useLayoutEffect(() => {
    if (!scope) return undefined;

    /* Движение выключено — не считаем и раскладку не трогаем: задержки всё
       равно обнулит motion-switch.css, а лишняя принудительная раскладка
       остаётся лишней. */
    if (!motionOn || editorOpen) return undefined;

    placeAll(scope);

    if (typeof MutationObserver === "undefined") return undefined;

    /* Карточки приезжают не только с первым кадром: меняется раздел,
       раскрывается каталог оружия, отвечает поиск, доезжает список модов.

       Замер идёт прямо в ответе наблюдателя, без переноса в кадр. Перенос был
       бы соблазнителен — «собрать все правки за кадр и посчитать один раз», —
       но кадр приходит не всегда: в свёрнутом или перекрытом окне отрисовка
       придержана, `requestAnimationFrame` не срабатывает вовсе, и очередь так
       и осталась бы нерасставленной. Ответ наблюдателя приходит сразу после
       правки дерева и до отрисовки — то самое место, где нужно.

       Правки без новых узлов пропускаются сразу: под наблюдением всё окно, и в
       нём весь день что-то меняется — идёт превью редактора, тикает прогресс
       загрузки. Раскладку заставляет пересчитаться только чтение `offsetTop`,
       и до него дело доходит лишь там, где действительно появились карточки. */
    const observer = new MutationObserver((records) => {
      if (!records.some((record) => record.addedNodes.length > 0)) return;
      placeAll(scope);
    });
    observer.observe(scope, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [scope, motionOn, editorOpen]);

  return setScope;
}
