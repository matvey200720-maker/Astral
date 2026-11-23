import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { isSectionSwitching, setSectionSwitching } from "./components/ui/scroll-gate.js";

/*
 * Память разделов: чем человек был занят, когда ушёл отсюда.
 *
 * ЗАЧЕМ. Разделы приложения меняются подменой компонента: `DesktopPageRouter`
 * выбирает страницу по `page`, а `.desktop-content` стоит с `key={page}` —
 * React выбрасывает всё поддерево старого раздела и собирает новое с нуля.
 * Значит всякое состояние внутри страницы живёт ровно до первого щелчка по
 * соседней иконке в панели: набранный поиск, выбранный пресет, раскрытая
 * категория, вкладка настроек, открытый редактор мастерской. Человек уходит на
 * минуту в каталог, возвращается — и раздел встречает его так, будто он сюда
 * не заходил.
 *
 * ПОЧЕМУ НЕ ПОДНЯТЬ СОСТОЯНИЕ В ОБОЛОЧКУ. Тогда `DesktopShell` знал бы про
 * каждый фильтр каждой страницы поимённо — тридцать с лишним значений сверх
 * тех сорока, что у него уже есть, и любая новая страница обязана была бы
 * дописать себя туда же. Границы разделов (`features/*`) заводились ровно
 * затем, чтобы этого не было.
 *
 * ПОЧЕМУ НЕ ДЕРЖАТЬ СТРАНИЦЫ СМОНТИРОВАННЫМИ. Скрытая страница продолжает
 * жить: у мастерской это цикл кадров three.js, у студии — обработчики Escape и
 * Ctrl+S на `window`, которые срабатывали бы из невидимого раздела. Плата за
 * «ничего не забыть» оказалась бы дороже забывчивости.
 *
 * КАК УСТРОЕНО. Значения лежат в обычной Map рядом с окном, а хук
 * `useRememberedState` — это `useState`, который при первом появлении
 * заглядывает в неё, а закоммиченное состояние кладёт обратно. Компонент
 * работает с ним как с обычным состоянием и ничего про память не знает.
 *
 * ЧТО СЮДА НЕ КЛАДУТ. Всё, что должно исчезнуть само: тосты, «скопировано»,
 * взведённые подтверждения удаления, признаки «идёт запрос». Возвращение в
 * раздел — это не продолжение того мгновения, а новый заход; всплывшее тогда
 * сообщение сейчас уже неправда. Память для намерения человека, а не для
 * отклика приложения на него.
 *
 * СРОК ЖИЗНИ — окно. Ни `localStorage`, ни `sessionStorage`: перезапуск
 * приложения человек и сам считает новым началом, а класть в хранилище
 * пришлось бы только то, что переживает JSON, — без Set, Map и файлов, то есть
 * с отдельным правилом для половины значений.
 */

const memory = new Map();

/** Разделитель пространств имён: `workshop:section`, `catalog:search`. */
const SECTION_SEPARATOR = ":";

export function rememberedValue(key, fallback) {
  return memory.has(key) ? memory.get(key) : fallback;
}

export function remember(key, value) {
  memory.set(key, value);
  return value;
}

/**
 * Забыть раздел целиком.
 *
 * Принимает имя раздела (`"workshop"`) — уходят все ключи с этим началом.
 * Без аргумента забывается всё: так сбрасывается приложение и так же —
 * смена игры, после которой прежний выбор в разделах уже не про эту установку.
 */
export function forgetSection(section = "") {
  if (!section) {
    memory.clear();
    return;
  }
  const prefix = `${section}${SECTION_SEPARATOR}`;
  for (const key of [...memory.keys()]) {
    if (key === section || key.startsWith(prefix)) memory.delete(key);
  }
}

/*
 * Сколько после захода в раздел или «возврата в начало» повторное нажатие на ту
 * же вкладку ничего не сбрасывает. Вход страницы собирается ~340 мс
 * (`astral-primary-page-assemble`), и пересборка посреди него мигает всем
 * содержимым: вкладку «Каталог», нажатую раз за разом, было видно как меню,
 * которое выезжает и прячется. Страница в начале и так — сбрасывать нечего.
 */
export const SAME_PAGE_RESET_GAP_MS = 600;

/**
 * Нужно ли «вернуть в начало» нажатием на вкладку раздела, в котором уже стоишь.
 *
 * `last` — `{ page, at }`: в какой раздел зашли или вернули в начало в
 * последний раз и когда (`performance.now()`, мс). Нужно, если с тех пор прошло
 * больше `SAME_PAGE_RESET_GAP_MS` или входили в другой раздел. Заход с названной
 * группой (`group`) сбрасывает всегда: страница обязана открыться на ней.
 */
export function sectionResetDue({ last, destination, group = null, now }) {
  if (group) return true;
  if (!last || last.page !== destination) return true;
  return now - last.at >= SAME_PAGE_RESET_GAP_MS;
}

let lastEntry = { page: "", at: -Infinity };

/**
 * Заход в раздел нажатием на вкладку: `true` — страницу надо «вернуть в начало»
 * (`DesktopShell.navigate`: забыть память раздела и собрать страницу заново).
 *
 * Возвращает `true`, только если стоим в этом же разделе, и окно загрузок поверх
 * него не открыто (нажатие сначала закрывает его), и вход не играет прямо
 * сейчас (`sectionResetDue`). Заход в другой раздел ничего не сбрасывает, но
 * запоминается: нажатие на вкладку сразу по приходу — повторное.
 */
export function enterSection(
  destination,
  page,
  downloadsOpen = false,
  group = null,
  now = performance.now(),
) {
  const repeated = destination === page && !downloadsOpen;
  const due =
    repeated && sectionResetDue({ last: lastEntry, destination, group, now });
  if (!repeated || due) lastEntry = { page: destination, at: now };
  return due;
}

/** Для тестов: посмотреть, что раздел о себе помнит. */
export function sectionMemorySnapshot() {
  return Object.fromEntries(memory);
}

/*
 * Спячка окна (`features/hibernation/`, 21.10.2026) — единственное исключение из «срок жизни — окно»: перед сном
 * память уходит главному процессу (в его память, не на диск), а после пробуждения страница получает её обратно до
 * первого кадра. Для человека это то же окно — оно просто поспало.
 */

/** Записи памяти `[ключ, значение]` — что отдать на время сна. */
export function sectionMemoryEntries() {
  return [...memory];
}

/** Вернуть память после сна: до первого кадра, поверх пустой. */
export function seedSectionMemory(entries = []) {
  for (const [key, value] of entries) memory.set(key, value);
}

function firstValue(key, initial) {
  if (memory.has(key)) return memory.get(key);
  return remember(key, typeof initial === "function" ? initial() : initial);
}

/*
 * Почему запись идёт эффектом, а не прямо в сеттере.
 *
 * Обновляющую функцию `useState` React волен вызвать дважды и волен выбросить
 * посчитанный результат — так работают и StrictMode, и прерванный рендер.
 * Запись в общую Map оттуда сохранила бы значение, которого на экране никогда
 * не было. Эффект же выполняется только на закоммиченное состояние, и в память
 * попадает ровно то, что человек видел.
 */

/**
 * `useState`, переживающий уход из раздела.
 *
 * Ключ — постоянная строка вида `"catalog:search"`. Смена ключа на живом
 * компоненте не поддерживается намеренно: это была бы другая память, и
 * состояние пришлось бы переносить — задачи такой ни у одной страницы нет.
 */
export function useRememberedState(key, initial) {
  const [value, setValue] = useState(() => firstValue(key, initial));
  useEffect(() => {
    remember(key, value);
  }, [key, value]);
  return [value, setValue];
}

/**
 * `useReducer`, переживающий уход из раздела.
 *
 * Мастерская держит два десятка своих значений одним состоянием — заводить
 * им двадцать ключей значило бы переписать её редьюсер ради памяти.
 */
export function useRememberedReducer(key, reducer, initialArg, init) {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    firstValue(key, () => (init ? init(initialArg) : initialArg)),
  );
  useEffect(() => {
    remember(key, state);
  }, [key, state]);
  return [state, dispatch];
}

/**
 * `useRef`, переживающий уход из раздела.
 *
 * Заведён ради одного: отпечатка сохранённого проекта в редакторе мастерской.
 * Отпечаток отвечает на вопрос «есть ли несохранённое», и вернуть правку без
 * него нельзя — восстановленный проект выглядел бы сохранённым, а кнопка
 * «Сохранить» — ненужной. Ref, а не состояние, потому что перерисовку смена
 * отпечатка не вызывает и вызывать не должна: его читают рядом с проектом,
 * который перерисовку и так вызвал.
 *
 * Возвращается не сам ref, а объект с тем же `current`: чтение и запись идут
 * прямо в память, и места вроде `savedFingerprint.current = ...` остаются
 * какими были.
 */
export function useRememberedRef(key, initial) {
  const holder = useRef(null);
  if (!holder.current) {
    firstValue(key, initial);
    holder.current = {
      get current() {
        return memory.get(key);
      },
      set current(value) {
        remember(key, value);
      },
    };
  }
  return holder.current;
}

/*
 * Где сейчас стоит прокрутка узла, не читая раскладку. Первый вопрос про узел читает `scrollTop` (один раз за жизнь узла) и вешает на него слушателя, который держит
 * значение по каждому событию прокрутки — любой страницы, а не только той, что спрашивает: общий `.desktop-main` переживает все разделы.
 */
const scrollTops = new WeakMap();
function knownScrollTop(node) {
  if (!scrollTops.has(node)) {
    scrollTops.set(node, node.scrollTop);
    node.addEventListener("scroll", () => scrollTops.set(node, node.scrollTop), { passive: true });
  }
  return scrollTops.get(node);
}

/**
 * Куда была прокручена страница.
 *
 * Прокрутка — тоже «что я тут делал»: человек ушёл с середины полки
 * редакторов, а возвращался к её началу. Позиция возвращается в
 * `useLayoutEffect`, до первого кадра: в обычном эффекте раздел успевал бы
 * мигнуть верхом списка.
 *
 * Элемент ищется по селектору, а не приходит ref'ом: прокручивается общий
 * `.desktop-main` оболочки, а помнит про него страница внутри.
 *
 * Позиция пишется на каждое событие прокрутки, а не при уходе со страницы.
 * Запись при уходе пришлась бы ровно на тот момент, когда оболочка уже
 * отмотала общий контейнер наверх, — и память сохранила бы этот ноль. Запись
 * в Map стоит дешевле сравнения, ради которого её стоило бы откладывать.
 */
export function useRememberedScroll(key, selector = ".desktop-main") {
  useLayoutEffect(() => {
    const node = document.querySelector(selector);
    if (!node) return undefined;
    /* Запись `scrollTop` заставляет браузер разложить страницу тут же, в коммите, ещё до того, как новый раздел дострой (вход в мастерскую, ×4: 57 мс из 164 в двух
       раскладках подряд). Там, где место и так то, что нужно (чаще всего — верх), запись не нужна: `knownScrollTop` помнит его по событиям прокрутки. */
    const wanted = rememberedValue(key, 0);
    /* Только верх: оболочка отматывает общий контейнер при уходе, а событие прокрутки приходит позже, чем новый раздел встанет, — «известное» место 420 при уходе
       могло быть уже нулём, и вернуть его надо записью. Верх, о котором мы знаем, что он верх, переписывать незачем. */
    if (wanted !== 0 || knownScrollTop(node) !== 0) node.scrollTop = wanted;
    scrollClaimed = true;
    /* Страница ещё короче, чем место, которое помнили (сетка собирается кусками, каталог догружается): браузер зажал место, и событие прокрутки с зажатым значением не должно
       затирать память — её «терпеливое» возвращение (`patientRestore`) ждёт, пока страница вырастет, и ставит место, как только оно достижимо. */
    const patience = wanted > 0 && node.scrollTop < wanted - 1 ? patientRestore(node, wanted, () => remember(key, node.scrollTop)) : null;
    const onScroll = () => {
      if (isSectionSwitching()) return;
      if (patience?.waiting()) return;
      remember(key, node.scrollTop);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      patience?.stop();
      node.removeEventListener("scroll", onScroll);
    };
  }, [key, selector]);
}

/** Сколько страница может расти, пока место ждёт, — и сколько мы ждём его (мс). */
export const RESTORE_PATIENCE_MS = 2500;
const RESTORE_INPUT = ["wheel", "touchstart", "pointerdown"];

/*
 * Место зажато: ждём, пока страница вырастет, и ставим его. Идёт кадрами (чтение `scrollHeight` — одна раскладка, и только пока ждём). Кончается, когда место достигнуто, когда
 * человек сам тронул прокрутку (колесо, касание, клавиша, нажатие на полосу), когда вышло время — тогда в память пишется то, что есть, — или когда страница ушла (`stop`).
 * `waiting()` — пока ждём, события прокрутки память не пишут: зажатое значение — не то, где человек остановился.
 */
function patientRestore(node, wanted, giveUp) {
  let live = true;
  let frame = 0;
  const until = performance.now() + RESTORE_PATIENCE_MS;
  const stop = () => {
    if (!live) return;
    live = false;
    cancelAnimationFrame(frame);
    for (const type of RESTORE_INPUT) node.removeEventListener(type, onInput, true);
    document.removeEventListener("keydown", onInput, true);
  };
  /* Человек взял прокрутку сам — место, которого он ждал, больше не наше дело. */
  function onInput() {
    stop();
  }
  const step = () => {
    frame = 0;
    if (!live) return;
    if (node.scrollHeight - node.clientHeight >= wanted) {
      node.scrollTop = wanted;
      if (node.scrollTop >= wanted - 1) {
        stop();
        return;
      }
    }
    if (performance.now() >= until) {
      stop();
      giveUp();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  for (const type of RESTORE_INPUT) node.addEventListener(type, onInput, { capture: true, passive: true });
  document.addEventListener("keydown", onInput, { capture: true, passive: true });
  frame = requestAnimationFrame(step);
  return { waiting: () => live, stop };
}

/**
 * `useDeferredValue` для раздела окна: тело раздела идёт за срочным `page`, а пока оно не догнало, память прокрутки чужие движения не пишет.
 */
export function useDeferredSection(page) {
  const section = useDeferredValue(page);
  useLayoutEffect(() => {
    setSectionSwitching(page !== section);
    return () => setSectionSwitching(false);
  }, [page, section]);
  return section;
}

/*
 * Раздел вернул своё место прокрутки в этом коммите — сброс наверх при смене
 * раздела его не трогает (`useSectionScrollReset`).
 */
let scrollClaimed = false;

/**
 * Страница вернула место прокрутки сама, без `useRememberedScroll` (карточка мода после «назад» из редактора кладёт прокрутку, которую запомнила, —
 * `useEditorReturn`): сброс наверх при смене раздела этот коммит не трогает. Без заявки возврат из мастерской приходил в начало карточки.
 */
export function claimScroll(section = "detail", ms = 3000) {
  returnClaim = { section, until: performance.now() + ms };
}

/*
 * Заявка возврата живёт не один коммит, а до смены раздела (не дольше `ms`): смена идёт отложенно (`useDeferredSection`), и между заявкой и сбросом проходят другие коммиты. Заявка — на конкретный раздел
 * (ревью 16.11.2026, находка 5): без заявки на раздел, в который вошли, она ничего не гасит — переход в чужой раздел сразу после возврата отматывается наверх как обычно.
 */
let returnClaim = null; // { section, until }
const claimedFor = (section) => returnClaim !== null && returnClaim.section === section && performance.now() < returnClaim.until;

/**
 * Новый раздел начинается сверху — кроме того, который сам вернул место.
 *
 * Оболочка сбрасывала общую прокрутку наверх кадром позже смены раздела, то
 * есть уже после `useRememberedScroll` нового раздела: возвращение в каталог
 * со страницы мода всегда приходило в начало, а память тут же записывала
 * этот ноль. На каталоге в тысячи модов это «потерял, где был, после каждого
 * открытого мода».
 *
 * Эффекты раскладки детей идут раньше, чем у оболочки, поэтому к её эффекту
 * раскладки заявка раздела уже лежит; он забирает её каждый коммит — старая
 * заявка не доживает до чужой смены раздела. Сам сброс остаётся кадром позже:
 * в этот кадр новый раздел уже разложен.
 */
export function useSectionScrollReset(section, selector = ".desktop-main") {
  const restored = useRef(false);
  useLayoutEffect(() => {
    restored.current = scrollClaimed || claimedFor(section);
    scrollClaimed = false;
  });
  useEffect(() => {
    if (restored.current) {
      returnClaim = null;
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      /* Страница могла заявить место уже после того, как кадр запланирован (карточка мода ставит его в своём коммите, а кадр ждёт длинной задачи). */
      if (claimedFor(section)) {
        returnClaim = null;
        return;
      }
      document.querySelector(selector)?.scrollTo({ top: 0, left: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [section, selector]);
}
