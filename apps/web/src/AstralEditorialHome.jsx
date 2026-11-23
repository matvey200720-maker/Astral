// Главная («Кино»): герой подборки, «Продолжить» и лента «Подборка модов». Страница кончается лентой.
// Классы и порядок узлов — контракт с features/home/home.css; подписи героя и ленты — features/home/home-copy.js,
// остальное — через tr() (locales/ui-text/zone-port-shell-1511-home.js). Новостей, редуксов и ссылок на сообщества
// здесь нет (решение владельца 15.11.2026), и выбора игры тоже: игра выбирается на первом входе.
import { useAttentionAllows } from "./attention.js";
import { shelfCatalogMods } from "./catalog-utils.js";
import { newestFirst } from "./features/catalog/post-order.js";
import { copyByLanguage } from "./features/home/home-copy.js";
import HomeContinue from "./features/home/HomeContinue.jsx";
import { readInstallTimes } from "./features/home/home-data.js";
import { NO_MODS, keep } from "./features/home/home-shared.jsx";
import { leftParts } from "./features/home/home-time.js";
import HomeHero from "./features/home/HomeHero.jsx";
import HomeRibbon, { RibbonSkeleton } from "./features/home/HomeRibbon.jsx";
import {
  HOME_REFRESH_MS,
  bannerOrder,
  homeSelection,
  homeWindow,
  nextHomeRefresh,
} from "./features/home/home-selection.js";
import { useEditorOpening } from "./features/catalog/editor-opening.js";
import { useHomeReturn } from "./features/home/home-return.js";
import { tr } from "./locales/ui.js";
import { trFill } from "./locales/tr-fill.js";
import { useMotionEnabled } from "./motion-preference.js";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";

// Экран «Готовлю редактор…» подгружается, когда вещь открывается (или рука над карточкой): на старте Главной его кода нет.
const EditorSkeleton = lazy(() => import("./components/ui/EditorSkeleton.jsx"));

const MIN_WAIT = 1000;
const NO_LIST = [];
const NO_TIMES = new Map();

export { heroKindOf } from "./features/home/home-shared.jsx";

// Таймер с отменой: возвращает функцию, пригодную как очистка эффекта.
function later(fn, ms) {
  const id = window.setTimeout(fn, ms);
  return () => window.clearTimeout(id);
}

// Когда поставлен каждый мод: одна запись установок на Главную, перечитывается, когда список поставленных меняется.
function useInstallTimes(installed) {
  const [times, setTimes] = useState(NO_TIMES);
  const stamp = installed.join("\n");
  useEffect(() => {
    if (!stamp) {
      setTimes(NO_TIMES);
      return undefined;
    }
    let alive = true;
    void readInstallTimes().then((found) => alive && setTimes(found));
    return () => {
      alive = false;
    };
  }, [stamp]);
  return times;
}

// «через 2 ч 14 мин» до следующего окна подборки; считается при отрисовке — отдельного таймера у подписи нет.
function refreshNote() {
  const { hours, minutes } = leftParts(nextHomeRefresh() - Date.now());
  const left =
    hours > 0
      ? trFill("{0} ч {1} мин", hours, minutes)
      : trFill("{0} мин", minutes);
  return trFill(
    "Подборка обновляется раз в 4 часа · следующая через {0}",
    left,
  );
}

export default function AstralEditorialHome(props) {
  const {
    onSelect,
    onNavigate,
    onInstall,
    onRemove,
    onRetryCatalog,
    catalogPending = false,
    catalogLoading = false,
  } = props;
  const {
    language = "ru",
    mods = NO_MODS,
    decorateMod = keep,
    installed = NO_LIST,
    queue = NO_LIST,
  } = props;
  const words = useMemo(
    () => ({ language, copy: copyByLanguage[language] || copyByLanguage.en }),
    [language],
  );
  // Лента и ход витрины идут, пока движение разрешено и на окно смотрят (WCAG 2.2.2); без этого стоят.
  const live = [useMotionEnabled(), useAttentionAllows("motion")].every(
    Boolean,
  );
  const times = useInstallTimes(installed);
  // Вещь с карточки «Мастерской» открывается под тем же экраном, что и со страницы мода: Главная прячется, пока редактор поднимается.
  const opening = useEditorOpening();
  // «Назад» из такого редактора приходит на Главную: прокрутка и карточка возвращаются (`home-return.js`).
  const rootRef = useRef(null);
  useHomeReturn(rootRef);
  // Подборка и порядок баннера для четырёхчасового окна. Окно сверяем сразу после монтирования
  // (спрятанная Главная не пересобирается) и ставим таймер на начало следующего.
  const [slot, setSlot] = useState(homeWindow);
  useEffect(() => {
    setSlot(homeWindow());
    const timeLeft = Math.max(nextHomeRefresh() - Date.now(), MIN_WAIT);
    return later(() => setSlot(homeWindow()), timeLeft);
  }, [slot]);
  const [selection, banner] = useMemo(() => {
    const opts = { now: slot * HOME_REFRESH_MS };
    const picked = homeSelection(mods, opts).map(decorateMod);
    return [picked, bannerOrder(picked, opts)];
  }, [slot, mods, decorateMod]);
  // Список каталога нужен лишь затем, чтобы знать, есть ли лента, и взять запасного героя;
  // запасной одевается при каждом расчёте списка, даже если подборка не пуста.
  const { hasShelf, fallback } = useMemo(() => {
    const list = newestFirst(
      shelfCatalogMods(mods.filter(({ internal }) => !internal)),
    );
    return {
      hasShelf: list.length > 0,
      fallback: list.length ? decorateMod(list[0]) : undefined,
    };
  }, [mods, decorateMod]);
  const waiting = !hasShelf && (catalogLoading || catalogPending);
  const note = hasShelf
    ? refreshNote()
    : catalogLoading
      ? tr("Загружаем подборку…")
      : catalogPending
        ? tr("Не удалось получить подборку")
        : "";
  return (
    <>
      {opening && (
        <Suspense fallback={null}>
          <EditorSkeleton title={opening.title} label={opening.label} />
        </Suspense>
      )}
      <div
        ref={rootRef}
        className={`astral-editorial-home astral-home${waiting ? " is-waiting" : ""}`}
        style={opening ? { display: "none" } : undefined}
      >
        <h1 className="astral-home-title">{words.copy.title}</h1>
        <HomeHero
          banner={banner}
          fallback={fallback}
          live={live}
          words={words}
          loading={catalogLoading}
          catalogPending={catalogPending}
          installed={installed}
          queue={queue}
          times={times}
          onSelect={onSelect}
          onInstall={onInstall}
          onRemove={onRemove}
          onNavigate={onNavigate}
          onRetryCatalog={onRetryCatalog}
        />
        <div className="astral-home-below">
          <p className="astral-home-meta">{note}</p>
          <HomeContinue
            language={language}
            mods={mods}
            installed={installed}
            times={times}
            loading={catalogLoading && !hasShelf}
            offline={catalogPending && !hasShelf}
            onSelect={onSelect}
            onNavigate={onNavigate}
          />
          {hasShelf ? (
            <HomeRibbon
              selection={selection}
              live={live}
              words={words}
              installed={installed}
              queue={queue}
              onSelect={onSelect}
              onInstall={onInstall}
              onNavigate={onNavigate}
            />
          ) : (
            waiting && (
              <section
                className="astral-home-section astral-home-ribbon-section"
                aria-label={words.copy.latest}
              >
                <header className="astral-home-section-head">
                  <h2>{words.copy.latest}</h2>
                  {catalogPending && (
                    <span className="astral-home-note">
                      {tr("Не загрузилось · Astral повторит сам")}
                    </span>
                  )}
                </header>
                <RibbonSkeleton />
              </section>
            )
          )}
        </div>
      </div>
    </>
  );
}
