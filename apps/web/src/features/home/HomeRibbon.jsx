// «Подборка модов»: бесконечная лента. Два одинаковых комплекта карточек едут одним сдвигом `transform` ровно на комплект
// (`-50%`, home.css), поэтому стык без шва и ни слова про раскладку каждый кадр. Лента едет и под курсором (владелец, 16.11.2026: не останавливается при наведении);
// «меньше движения» (настройка окна или система) — лента стоит, второго комплекта нет, листается колесом и перетаскиванием.
import { useEffect, useMemo, useRef, useState } from "react";
import { modCardKicker } from "../../catalog-utils.js";
import { dataLangOf } from "../../components/desktop/catalog/data-lang.js";
import ModKicker from "../../components/desktop/catalog/ModKicker.jsx";
import ModName from "../../components/desktop/catalog/ModName.jsx";
import { stockCoverHint } from "../../components/desktop/catalog/StockCoverNote.jsx";
import Button from "../../components/ui/Button.jsx";
import { PhotoSkeleton, Skeleton } from "../../components/ui/Skeleton.jsx";
import { useRenderFill } from "../../components/ui/frame-crop.js";
import {
  ArrowRight,
  Check,
  DownloadSimple,
} from "../../components/ui/icons.jsx";
import { isNewMod } from "../catalog/recommend.js";
import { tr } from "../../locales/ui.js";
import { useMotionEnabled } from "../../motion-preference.js";
import { hasOwnCover, usesWeaponMedia } from "../../utils/catalogMedia.js";
import { coverThumbUrl, coverThumbWidthAt } from "../../utils/cover-thumb.js";
import { modPhotosAhead } from "../../utils/photo-ahead.js";
import { installFromHome } from "./home-data.js";
import { coverOf, cx, factsOf, stateOf, swapBroken } from "./home-shared.jsx";

// Ширина карточки и промежуток считает CSS (ярусы по высоте окна — home.css, «Высокие окна»); сюда нужен лишь круг и ширина превью. Комплект — десять карточек, круг 52 с (42 пикселя в секунду, как в макете):
// на каждую карточку 5,2 с (десятые секунды: 52). Больше десяти модов в подборке — едут первые десять, остальные листаются в покое.
const [CARD_PX, LAP_TENTHS_PER_CARD, MIN_ANIMATED, SET_SIZE, DRAG_PX] = [
  206, 52, 6, 10, 6,
];
const NO_QUEUE = [];

// Ширина карточки по ярусу окна: те же 206 / 264 / 340 px, что в home.css, чтобы превью было резким и на 1080p, и на 1440p.
const cardWidthNow = () =>
  typeof window === "undefined" || window.innerHeight < 1000
    ? CARD_PX
    : window.innerHeight < 1300
      ? 264
      : 340;

const REDUCED = "(prefers-reduced-motion: reduce)";

// Лента стоит: человек выключил движение в окне или в системе.
function useCalm() {
  const motion = useMotionEnabled();
  const [reduced, setReduced] = useState(() =>
    Boolean(window.matchMedia?.(REDUCED)?.matches),
  );
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED);
    if (!query?.addEventListener) return undefined;
    const sync = () => setReduced(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return !motion || reduced;
}

// Модов мало для круга (шесть-девять): комплект набирается повтором до десяти, чтобы он был шире окна и край ленты не пустел. Меньше шести — карточки стоят рядом, без круга.
const repeatTo = (list, size) =>
  Array.from({ length: Math.ceil(size / list.length) }, () => list).flat();

function RibbonCard({ mod, duplicate, words, state, onOpen, onInstall }) {
  const { copy, language } = words;
  const isGun = usesWeaponMedia(mod);
  const {
    mode: fillMode,
    ready,
    ref: imageRef,
    style: fillStyle,
  } = useRenderFill(isGun ? coverOf(mod) : "", {
    deferRead: true,
    fallback: "contain",
    reserve: 0.3,
  });
  const measuring = isGun && !ready;
  let imageStyle;
  if (isGun)
    imageStyle =
      fillMode === "cover" ? { filter: "none", objectFit: "cover" } : fillStyle;
  const factProps = (fact) => ({
    className: "astral-home-card-fact",
    "data-fact": fact,
  });
  const skip = duplicate ? { tabIndex: -1 } : null;
  return (
    <article
      aria-hidden={duplicate ? "true" : undefined}
      title={hasOwnCover(mod) ? undefined : stockCoverHint(language)}
      className={cx(
        "editorial-latest-card astral-home-card",
        isGun && "is-weapon-media",
        duplicate && "is-duplicate",
      )}
      data-mod-id={mod.id}
    >
      <button
        aria-label={mod.name}
        lang={dataLangOf(mod.name)}
        className="editorial-latest-open"
        type="button"
        onClick={() => onOpen(mod)}
        {...skip}
        {...modPhotosAhead(mod)}
      />
      <div className="astral-home-card-art">
        <PhotoSkeleton held={measuring} />
        <img
          alt=""
          className={cx("editorial-latest-media", measuring && "is-pending")}
          data-photo=""
          data-render={isGun ? fillMode : undefined}
          decoding="async"
          loading="lazy"
          onError={swapBroken}
          ref={imageRef}
          src={coverThumbUrl(coverOf(mod), coverThumbWidthAt(cardWidthNow()))}
          style={imageStyle}
        />
      </div>
      {isNewMod(mod) && (
        <span className="editorial-fresh-badge">{copy.new}</span>
      )}
      <div className="astral-home-card-quick">
        {state === "installed" ? (
          <span className="astral-home-card-done">
            <Check aria-hidden="true" weight="bold" />
            {tr("Установлено")}
          </span>
        ) : (
          <button
            type="button"
            className="astral-home-card-install"
            disabled={state === "busy"}
            onClick={() => onInstall(mod)}
            {...skip}
          >
            <DownloadSimple aria-hidden="true" weight="bold" />
            {state === "busy" ? tr("Идёт установка…") : tr("Установить")}
          </button>
        )}
      </div>
      <div className="astral-home-card-copy">
        <h3>
          <ModName name={mod.name}>{mod.name}</ModName>
        </h3>
        <p className="astral-home-card-facts">
          {Boolean(modCardKicker(mod)) && (
            <span className="astral-home-card-kind">
              <ModKicker language={language} mod={mod} />
            </span>
          )}
          {factsOf(mod, language, factProps)}
        </p>
      </div>
    </article>
  );
}

// Лента в «меньше движения»: колесо и перетаскивание листают её, щелчок после перетаскивания карточку не открывает.
function useStillScroll(viewRef, still) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const view = viewRef.current;
    if (!still || !view) return undefined;
    const wheel = (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const next = view.scrollLeft + event.deltaY;
      if (next < 0 || next > view.scrollWidth - view.clientWidth) return;
      view.scrollLeft = next;
      event.preventDefault();
    };
    view.addEventListener("wheel", wheel, { passive: false });
    return () => view.removeEventListener("wheel", wheel);
  }, [viewRef, still]);
  if (!still) return { dragging: false };
  return {
    dragging,
    onPointerDown(event) {
      const view = viewRef.current;
      if (event.button !== 0 || !view) return;
      const press = { x: event.clientX, left: view.scrollLeft, moved: false };
      const move = (next) => {
        const shift = next.clientX - press.x;
        if (!press.moved && Math.abs(shift) > DRAG_PX) {
          press.moved = true;
          setDragging(true);
        }
        if (press.moved) view.scrollLeft = press.left - shift;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        setDragging(false);
        // щелчок придёт сразу после отпускания: пока он не прошёл, его глотаем
        if (press.moved) view.dataset.moved = "true";
        window.setTimeout(() => delete view.dataset.moved, 0);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    onClickCapture(event) {
      if (!viewRef.current?.dataset.moved) return;
      event.stopPropagation();
      event.preventDefault();
    },
  };
}

// Загрузка и «нет связи»: шесть серых плит на месте ленты.
export function RibbonSkeleton() {
  return (
    <div aria-hidden="true" className="astral-home-skeletons">
      {Array.from({ length: 6 }, (_, k) => (
        <Skeleton key={k} delay={k * 90} />
      ))}
    </div>
  );
}

export default function HomeRibbon({
  selection,
  live,
  words,
  installed,
  queue = NO_QUEUE,
  onSelect,
  onInstall,
  onNavigate,
}) {
  const still = useCalm();
  const count = selection.length;
  const animated = !still && count >= MIN_ANIMATED;
  const cards = useMemo(() => {
    if (!animated) return selection;
    return count >= SET_SIZE
      ? selection.slice(0, SET_SIZE)
      : repeatTo(selection, SET_SIZE);
  }, [selection, count, animated]);
  // второй комплект встаёт кадром позже первого: на старте окна отрисовка сорока карточек разом стоила худший кадр
  const [twin, setTwin] = useState(false);
  useEffect(() => {
    if (!animated) return undefined;
    const frame = window.requestAnimationFrame(() => setTwin(true));
    return () => window.cancelAnimationFrame(frame);
  }, [animated]);
  const viewRef = useRef(null);
  const scroll = useStillScroll(viewRef, still);
  const open = (mod) => onSelect?.(mod);
  const install = (mod) => void installFromHome(mod, { onInstall, onSelect });
  const setOf = (duplicate) => (
    <div
      className="astral-home-ribbon-set"
      aria-hidden={duplicate ? "true" : undefined}
    >
      {cards.map((mod, k) => (
        <RibbonCard
          key={`${duplicate ? "copy" : "own"}-${k}-${mod.id}`}
          mod={mod}
          duplicate={duplicate || k >= count}
          words={words}
          state={stateOf(mod, installed, queue)}
          onOpen={open}
          onInstall={install}
        />
      ))}
    </div>
  );
  return (
    <section
      className="editorial-latest astral-home-section astral-home-ribbon-section"
      aria-labelledby="astral-home-ribbon-title"
    >
      <header className="astral-home-section-head">
        <h2 id="astral-home-ribbon-title">{words.copy.latest}</h2>
        {onNavigate && (
          <Button
            size="sm"
            variant="link"
            onClick={() => onNavigate("catalog")}
            trailing={<ArrowRight />}
          >
            {words.copy.allMods}
          </Button>
        )}
      </header>
      <div
        className={cx(
          "astral-home-ribbon",
          !animated && "is-still",
          scroll.dragging && "is-dragging",
        )}
        data-paused={live ? undefined : "true"}
        style={
          animated
            ? {
                "--home-lap": `${Math.round(cards.length * LAP_TENTHS_PER_CARD) / 10}s`,
              }
            : undefined
        }
      >
        <div
          ref={viewRef}
          className="astral-home-ribbon-view"
          onPointerDown={scroll.onPointerDown}
          onClickCapture={scroll.onClickCapture}
        >
          <div
            className="astral-home-ribbon-track editorial-latest-track"
            data-screen-group=""
          >
            {setOf(false)}
            {animated && twin && setOf(true)}
          </div>
        </div>
        <i aria-hidden="true" className="astral-home-fade is-left" />
        <i aria-hidden="true" className="astral-home-fade is-right" />
      </div>
    </section>
  );
}
