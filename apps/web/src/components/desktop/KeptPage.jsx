import { Activity, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { rememberedValue } from "../../section-memory.js";
import { useEditorRoomOpen } from "../ui/useEditorRoom.js";
import { PREWARM_BOOT_MS, prewarmAllowed, trackInput } from "../ui/idle-gate.js";
import { hold } from "../ui/useHolds.js";

/*
 * Страница, которую оболочка не разбирает при уходе (31.10.2026, «вход в каталог»).
 *
 * Тёплый вход в каталог при ×4 стоил задачу React ~205 мс и кадр до 283 мс: ключ `.desktop-content` менялся со страницей, и каждый возврат
 * собирал заново ~530 узлов — стиль новых узлов (79 мс), раскладка (26), второй и третий проходы. Это не повторный пересчёт, а цена самих
 * новых узлов; слой раскладки сетки её не режет (пять кругов, три варианта VirtualGrid — одна медиана). Поэтому узлы не выбрасываются: каталог
 * остаётся смонтированным, пока человек в другом разделе, и возвращается тем же деревом — худший кадр входа 283 → 100–117 мс, первая задача
 * 205 → ~80 мс.
 *
 * ПРЯТАТЬ НАДО НЕ ЧЕРЕЗ `display: none`. Узлы под ним браузер теряет вместе со стилем, и при показе пересчитывает все ~530 заново — те же 79 мс.
 * `content-visibility: hidden` (`desktop.css`, `[data-kept]`) пропускает раскладку и отрисовку, а вычисленный стиль оставляет: показ — это
 * раскладка, без пересчёта стиля.
 *
 * ЭФФЕКТЫ ВЫКЛЮЧАЕТ `Activity`. Скрытая страница не слушает прокрутку общего `.desktop-main` (иначе `useRememberedScroll` писал бы в память
 * каталога прокрутку чужого раздела, а окно сетки пересчитывалось бы по чужим событиям), не держит наблюдателей, таймеров и слушателей окна;
 * состояние и узлы остаются. При показе эффекты встают заново, как при монтировании: прокрутка возвращается из памяти раздела до первого кадра,
 * сетка перемеряется. Но `Activity` прячет верхние узлы страницы тем же `display: none !important` в строке стиля, а он — то самое, чего мы
 * избегаем: после каждого скрытия строка стиля чистится (`stripHiddenDisplay`), и скрытым остаётся только контейнер. Это единственное место,
 * которое зависит от того, КАК React прячет узлы; держит его `kept-page.test.jsx` (узлы не `display: none`, состояние и узел сохранились).
 *
 * ЗАМОРОЖЕННЫЕ ДЕТИ. Пока страница скрыта, оболочка перерисовывается (очередь, избранное, данные), и каждый раз отдавала бы странице новые свойства.
 * Скрытой странице отдаётся тот элемент, что был при уходе: React не заходит в поддерево, пока оно скрыто, а при показе приходят свежие свойства.
 *
 * ВХОДНОЕ ДВИЖЕНИЕ ПОВТОРЯЕТСЯ. Страница и её панели собираются CSS-анимацией на появлении узла (`astral-page-enter`, `astral-panel-assemble`),
 * очередь карточек — анимацией по `data-assembly-grid`, поле поиска и экран ожидания — своими. Тот же узел во второй раз не появляется, и анимация
 * молчала бы. Узлы с анимацией запоминаются, пока страница играет вход (событие `animationstart`, без обхода поддерева: `getAnimations` по ~660 узлам Главной стоил
 * ~30 мс на показ), а не ищутся при уходе обходом всего поддерева с `getComputedStyle` (+30–45 мс при ×4 на каждый уход). Пока страница скрыта, им ставится `animation: none !important` и стиль
 * сбрасывается в вычисленный на простом процессоре (`getComputedStyle` одного узла, под `content-visibility` пересчёт идёт по грязным узлам); при показе строка
 * снимается — анимация стартует заново с теми же задержками (`--reveal-row` уже стоят).
 *
 * БЕЗ `inert`. Атрибут на контейнере красит всё поддерево (наследуемые `pointer-events` и `user-select`): пересчёт 413–443 узлов, ~40 мс при уходе
 * и ~65 мс из 114 при показе — половина выигрыша. Он и не нужен: `content-visibility: hidden` выводит содержимое из обхода фокуса и дерева доступности
 * (проверено на сборке: `focus()` в спрятанную кнопку не берёт, Tab×80 ни разу не входит внутрь, из дерева доступности в контейнере остаётся один
 * безымянный `generic` — сам контейнер). `aria-hidden` — для читалок, которые лист не видят; на стиль он не влияет.
 *
 * УХОДЯЩАЯ СТРАНИЦА НЕ ПЕРЕРИСОВЫВАЕТСЯ (`leaving`). Пока тело нового раздела собирается кусками, срочная страница уже новая, а каталог ещё на экране, и оболочка
 * кормит его свежими свойствами. Каждая такая отрисовка гонит эффект раскладки сетки: тот читает прокрутку общего контейнера, который оболочка уже отмотала
 * наверх, и сдвигает окно рядов к началу. Страница уходила с окном у начала, а на возврате собирала его у прежнего места заново: 36 карточек, две задачи
 * по ~100 мс при ×4. Теперь с нажатия и до конца ухода каталогу отдаётся тот же элемент, что был, и он не перерисовывается.
 *
 * ПОВТОР ДВИЖЕНИЯ МОЖНО ОТКЛЮЧИТЬ (`replay: false`). Полка мастерской — 39 плиток с `content-visibility: auto`: повтор их движения тратил ~50 мс из ~160 на показ
 * (проходы стиля по ~120 узлам, `DisplayLock` на каждую плитку). Спрятанная полка возвращается без движения, на первом входе оно играет как раньше.
 *
 * ПРОКРУТКА ВОЗВРАЩАЕТСЯ ДО ЭФФЕКТОВ СТРАНИЦЫ. Контейнер прокрутки общий, оболочка при нажатии отматывает его наверх. Сетка каталога на показе мерит окно рядов в своём эффекте
 * раскладки; если место ещё не вернули, она сдвигала окно к началу, а страница потом (`useRememberedScroll`, эффект родителя, то есть позже детей)
 * возвращала место — второй сдвиг окна: две задачи по ~100 мс при ×4. `scrollKey` — ключ памяти прокрутки страницы: брат `Activity`, стоящий перед ней,
 * ставит место раньше эффектов её детей (порядок эффектов — по дереву, братья по очереди).
 *
 * МЕТКА СТРАНИЦЫ. `holds` стоит у контейнера с первого кадра и не снимается вместе с эффектами страницы: страница ставит её слоевым эффектом, а
 * эффекты детей идут раньше эффектов родителя, и первый замер сетки видел поля 31,68 px вместо 18 — сетка 996 px, потом 1023, лишние проходы. Счётчик
 * (`hold`) гарантирует, что уход страницы метку не уберёт.
 */

/**
 * Узлы страницы, у которых есть входное движение: корни, их дети и карточки сеток очереди (по ним страницу собирает лист) и всё, что запомнено
 * во время показа (`played`). Узел с собственной строкой `animation` не трогаем: её поставила страница.
 */
function entranceNodes(host, played) {
  const nodes = new Set();
  for (const root of host.children) {
    nodes.add(root);
    for (const panel of root.children) nodes.add(panel);
  }
  for (const card of host.querySelectorAll("[data-assembly-grid] > *")) nodes.add(card);
  for (const node of played) if (node.isConnected && host.contains(node)) nodes.add(node);
  return [...nodes].filter((node) => !node.style.animation && !node.style.animationName);
}

/** Узлы, которые `Activity` спрятала: строка стиля `display: none !important`. Чистим её — прячет контейнер, не узлы. */
function stripHiddenDisplay(host) {
  for (const node of host.children) {
    const style = node.style;
    if (style.display === "none" && style.getPropertyPriority("display") === "important") style.removeProperty("display");
  }
}

/** Сколько после показа слушаем начало анимаций: задержки очереди карточек доходят до ~0,6 с, сама анимация — до ~0,5 с. */
const CAPTURE_MS = 1500;

/** Дело на простое процессора; возвращает отмену. */
function later(task) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(task, { timeout: 800 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(task, 400);
  return () => clearTimeout(id);
}

/**
 * Страницы, которые оболочка не разбирает при уходе: метка ширины и ключ памяти прокрутки каждой (и `unlessEditor` — не держать, если на уходе открыт
 * редактор). Три и не больше — память не растёт дальше них: каталог (~530 узлов, вход при ×4 стоил кадр до 300 мс), Главная (~660 узлов, собирается
 * пошагово ~1,2 с: 20 задач по 30–90 мс, на каждой стиль всей страницы) и полка мастерской (~550 узлов: стиль 160–220 мс и раскладка 80–105 мс за вход).
 * Библиотеки как страницы больше нет (16.11.2026: она справа на «Загрузках»). Мастерская держит редакторы с WebGL — открытый редактор скрытым не держим: уходящая страница с редактором
 * разбирается, как раньше (`releaseGpu`, один контекст на окно), а спрятанной остаётся только полка без кадра.
 */
export const KEPT_PAGES = Object.freeze({
  catalog: { holds: "catalog-wide", scrollKey: "catalog:scroll" },
  overview: {},
  /* Полка мастерской помнит прокрутку (`workshop:scroll`, пишет `useRememberedScroll` полки): возврат с другой страницы — на то же место, а не в начало, где стоят «Мои работы». */
  workshop: { unlessEditor: true, replay: false, scrollKey: "workshop:scroll" },
});

/**
 * Какие из этих страниц уже были на экране (после первого показа страница остаётся смонтированной и прячется) и сколько раз каждую просили собрать
 * заново. Заново она собирается только когда сам раздел просит начать сначала (повторное нажатие на него) или приходит с фильтром ссылки: тот
 * читается при сборке. Возврат с другой страницы — тем же деревом. Флаг ставит эффект, то есть после первого показа.
 *
 * `blocked` — страницы с `unlessEditor`, которые не держим: пока такая страница на экране, помним, открыт ли в ней редактор; на уходе решает последнее
 * значение (редактор при этом ещё стоит, и узнать это в момент ухода по документу нельзя — он снимает метку, когда страница уже разбирается).
 */
export function useKeptPages(contentPage) {
  const visitedRef = useRef(new Set());
  const blockedRef = useRef(new Set());
  const [epochs, setEpochs] = useState({});
  const editorOpen = useEditorRoomOpen();
  if (KEPT_PAGES[contentPage]?.unlessEditor) {
    if (editorOpen) blockedRef.current.add(contentPage);
    else blockedRef.current.delete(contentPage);
  }
  useEffect(() => {
    if (KEPT_PAGES[contentPage]) visitedRef.current.add(contentPage);
  }, [contentPage]);
  const restart = useCallback((id) => {
    if (KEPT_PAGES[id]) setEpochs((current) => ({ ...current, [id]: (current[id] || 0) + 1 }));
  }, []);
  return { visited: visitedRef.current, blocked: blockedRef.current, epochs, restart };
}

/** Спрятанные страницы оболочки: `render(id)` рисует тело раздела; `page` — срочная страница, `contentPage` — та, что на экране. */
/**
 * Страницы, которые собираются скрытыми ДО первого захода (31.10.2026, обход плавности): холодный первый вход на полку мастерской при ×4 — 250–283 мс (сборка ~550 узлов, стиль и
 * раскладка новых узлов, `placeAssemblyGrid` читает раскладку), тёплый возврат — 67–83. Страница собирается в простое тем же `KeptPage`, что и после первого показа, но скрытой с
 * самого начала: React строит скрытую `Activity` на низшем приоритете кусками по 5 мс, эффекты (запросы, таймеры, подписки) не стартуют; дерево в документе одной задачей ~50 мс при ×4.
 * Первый заход — 183 мс (медианы трёх прогонов закрытой сборки): работа React и создание узлов уже сделаны, остаётся стиль (130–140 мс) и раскладка (80–90) новых узлов.
 * Стиль впрок не держится: `getComputedStyle` по всем 554 узлам спрятанной страницы и счёт кусками (скрытие снимается, потом возвращается `content-visibility: hidden`) на показе
 * дают те же 130–140 мс стиля — под скрытием вычисленный стиль потомков при показе пересчитывается; без `content-visibility`, то есть видимой за кадром, страница держала бы
 * стиль, но её контролы попали бы в обход Tab (`inert` и `visibility` — наследуемые, красят потомков и ломают то же самое).
 * Условия те же, что у окна настроек (`ui/idle-gate.js`): не раньше 10 с после старта окна, 2 с без ввода, нет редактора и открытого окна, не идёт установка.
 * Каталог и Главная прогрева не ждут: Главная — первая страница окна, каталог греет своё (данные выдачи) отдельно; `WARM_PAGES` — список, куда добавляют страницу.
 */
export const WARM_PAGES = Object.freeze(["workshop"]);
const WARM_POLL_MS = 1_000;

export function useKeptWarm(contentPage, busy = false) {
  const [warm, setWarm] = useState(() => new Set());
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const next = WARM_PAGES.find((id) => id !== contentPage && !warm.has(id));
  useEffect(() => {
    if (!next) return undefined;
    trackInput();
    let timer = 0;
    const tick = () => {
      if (!busyRef.current && performance.now() >= PREWARM_BOOT_MS && prewarmAllowed()) {
        setWarm((current) => new Set(current).add(next));
        return;
      }
      timer = window.setTimeout(tick, WARM_POLL_MS);
    };
    timer = window.setTimeout(tick, WARM_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [next]);
  return warm;
}

export function KeptPages({ kept, page, contentPage, render, busy = false }) {
  const warm = useKeptWarm(contentPage, busy);
  return Object.entries(KEPT_PAGES).map(([id, { unlessEditor: _unlessEditor, ...config }]) =>
    contentPage === id || ((kept.visited.has(id) || warm.has(id)) && !kept.blocked.has(id)) ? (
      <KeptPage key={`${id}:${kept.epochs[id] || 0}`} active={contentPage === id} page={id} leaving={page !== id} {...config}>
        {render(id)}
      </KeptPage>
    ) : null,
  );
}

/** Ставит место прокрутки страницы из памяти до эффектов её детей (брат `Activity` перед ней). */
function RestoreScroll({ active, scrollKey }) {
  useLayoutEffect(() => {
    if (!active || !scrollKey) return;
    const node = document.querySelector(".desktop-main");
    if (node) node.scrollTop = rememberedValue(scrollKey, 0);
  }, [active, scrollKey]);
  return null;
}

export default function KeptPage({ active, page, holds = "", scrollKey = "", leaving = false, replay = true, children }) {
  const hostRef = useRef(null);
  const frozenRef = useRef(children);
  const stilledRef = useRef([]);
  const playedRef = useRef(new Set());
  if (active && !leaving) frozenRef.current = children;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !holds) return undefined;
    return hold(host, holds);
  }, [holds]);

  /* Пока вход играет, узлы с CSS-анимацией запоминаются для следующего ухода: по событию `animationstart`, а не обходом поддерева (`getAnimations` по ~660 узлам Главной — ~30 мс на показ). */
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!replay || !active || !host) return undefined;
    const played = new Set();
    const onStart = (event) => {
      if (event.target instanceof Element) played.add(event.target);
    };
    host.addEventListener("animationstart", onStart, true);
    const stop = setTimeout(() => host.removeEventListener("animationstart", onStart, true), CAPTURE_MS);
    return () => {
      clearTimeout(stop);
      host.removeEventListener("animationstart", onStart, true);
      if (played.size) playedRef.current = played;
    };
  }, [active, replay]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    if (active) {
      for (const node of stilledRef.current) node.style.removeProperty("animation");
      stilledRef.current = [];
      return undefined;
    }
    stripHiddenDisplay(host);
    if (!replay) return undefined;
    const nodes = entranceNodes(host, playedRef.current);
    for (const node of nodes) node.style.setProperty("animation", "none", "important");
    stilledRef.current = nodes;
    /* Сброс в вычисленный стиль — не в задаче ухода (~20 мс при ×4 на 65 узлов): на простое. Вернулись раньше — вход сыграет без повтора. */
    return later(() => {
      if (nodes.length) void getComputedStyle(nodes[0]).animationName;
    });
  }, [active, replay]);

  return (
    <div
      className="desktop-content page-assembly-active"
      data-page={page}
      data-holds={holds || undefined}
      data-kept={active ? undefined : ""}
      aria-hidden={active ? undefined : "true"}
      ref={hostRef}
    >
      <RestoreScroll active={active} scrollKey={scrollKey} />
      <Activity mode={active ? "visible" : "hidden"}>{active && !leaving ? children : frozenRef.current}</Activity>
    </div>
  );
}
