import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@astral/design";
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  DiscordLogo,
  DownloadSimple,
  GearSix,
  TelegramLogo,
} from "../../components/ui/icons.jsx";
import { PhotoSkeleton, Skeleton } from "../../components/ui/Skeleton.jsx";
import ModName from "../../components/desktop/catalog/ModName.jsx";
import { desktopNavigationItems } from "../../components/desktop/navigation/DesktopNavigation.jsx";
import { shelfCatalogMods } from "../../catalog-utils.js";
import { copyByLanguage } from "../home/home-copy.js";
import { HOME_REFRESH_MS, bannerOrder, homeSelection, homeWindow } from "../home/home-selection.js";
import { newestFirst } from "../catalog/post-order.js";
import { tr } from "../../locales/ui.js";
import { BackdropArt } from "./AppBackdrop.jsx";

/*
 * Миниатюра Главной в «Внешнем виде» (ТЗ 23.10.2026, п. L): не набросок из серых коробок, а то, что человек увидит в
 * окне, — шапка со знаком, рейка с теми же значками, большой кадр с настоящей модой из подборки, лента кадров и ряд
 * карточек. Фото и названия — из каталога, а подборка собрана так же, как у самой Главной (`home-selection.js`).
 *
 * Рисуется в натуральную величину окна (1440 × 900) и сжимается одним `scale` (`--look-k`, его ставит
 * ResizeObserver), поэтому все размеры и кегли здесь — окна, а не миниатюры: что на Главной 52 пикселя, то и тут, только
 * мельче. Цвета — токены самого окна: акцент, знак и фон, которые человек выбирает рядом, меняют и настоящее окно, и
 * миниатюру одним и тем же атрибутом на <html> (`look.js`), второй раскраски нет.
 *
 * Не страница: кнопок и ссылок нет (`role="img"`), волны не движутся, фото грузятся поверх серых плит скелета.
 */

/* Размеры окна, из которого делается миниатюра. */
export const WINDOW_WIDTH = 1440;
const SHELF_CARDS = 5;
const PAGER_THUMBS = 5;

/* Кегли окна не из шкалы настроек (52 пикселя на заголовке Главной): отчёт сверки экрана читает их как есть, а не
   по шкале, — объявленное исключение здесь, у причины. */
const WINDOW_TYPE = { "data-audit-ignore": "type-scale" };

const coverOf = (mod) => mod?.resolvedCover || mod?.cover || mod?.image || "";

/** Подборка для миниатюры — та же, что у Главной: баннер, лента кадров, ряд карточек. */
export function previewSelection(mods) {
  const list = Array.isArray(mods) ? mods : [];
  const now = homeWindow() * HOME_REFRESH_MS;
  const selection = homeSelection(list, { now });
  const banner = bannerOrder(selection, { now });
  /* Запасной порядок (самые свежие) нужен, только если подборка пуста: сортировка трёх тысяч модов зря стоила 9 мс из 28 на ×4. */
  const fallback = selection.length && banner.length ? null : newestFirst(shelfCatalogMods(list.filter((mod) => !mod.internal)));
  const featured = banner.length ? banner : fallback;
  return {
    hero: featured[0] || null,
    thumbs: featured.slice(0, PAGER_THUMBS),
    cards: (selection.length ? selection : fallback).slice(0, SHELF_CARDS),
  };
}

/* Во сколько раз сжать окно, чтобы оно встало в ширину рамки; без наблюдателя (тесты) — вполовину. */
function useFit(ref) {
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const width = node.clientWidth;
      if (width > 0) setScale(Math.round((width / WINDOW_WIDTH) * 1000) / 1000);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const watcher = new ResizeObserver(measure);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [ref]);
  return scale;
}

function Photo({ mod, className = "", delay = 0 }) {
  const src = coverOf(mod);
  return (
    <>
      <PhotoSkeleton delay={delay} />
      {src ? <img className={className || undefined} data-photo="" src={src} alt="" decoding="async" draggable="false" /> : null}
    </>
  );
}

/* Окно-образец (≈150 узлов с фото) собирается кадром позже рамки: переключение на раздел «Внешний вид» стоило одной задачей 194–267 мс при ×4 (стиль и раскладка всего
   раздела вместе с образцом), теперь раздел встаёт первым кадром, а образец — вторым. Рамка держит пропорцию окна сама (`aspect-ratio`), поэтому ничего не сдвигается. */
function useAfterFrame() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => setReady(true), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);
  return ready;
}

export default function HomePreview({ language = "ru", mods = [], backdrop = "none" }) {
  const frame = useRef(null);
  const scale = useFit(frame);
  const ready = useAfterFrame();
  return (
    <div
      ref={frame}
      className="look-home"
      data-backdrop={backdrop}
      style={{ "--look-k": scale }}
      role="img"
      aria-label={tr("Как будет выглядеть Astral")}
    >
      {ready ? <PreviewWindow language={language} mods={mods} backdrop={backdrop} /> : null}
    </div>
  );
}

function PreviewWindow({ language, mods, backdrop }) {
  const copy = copyByLanguage[language] || copyByLanguage.en;
  const { hero, thumbs, cards } = useMemo(() => previewSelection(mods), [mods]);
  const items = desktopNavigationItems(language, false);
  return (
    <>
      <div className="look-home-window" aria-hidden="true">
        <BackdropArt backdrop={backdrop} mini />
        <div className="look-home-titlebar">
          <Brand className="desktop-titlebar-brand" markClassName="desktop-titlebar-brand-mark" wordmarkAs="b" />
        </div>
        <div className="look-home-rail">
          {items.map(([id, , Icon], index) => (
            <span key={id} className={`look-home-rail-item${index === 0 ? " is-active" : ""}`}>
              <Icon weight={index === 0 ? "fill" : "regular"} />
            </span>
          ))}
          <span className="look-home-rail-gap" />
          <span className="look-home-rail-item">
            <DownloadSimple />
          </span>
          <span className="look-home-rail-item">
            <GearSix />
          </span>
        </div>
        <div className="look-home-hero">
          <div className="look-home-hero-photo">
            {hero ? <Photo mod={hero} /> : <img data-photo="" src="/media/gta-vista.jpg" alt="" decoding="async" draggable="false" />}
            <span className="look-home-hero-shade" />
          </div>
          <span className="look-home-chip" {...WINDOW_TYPE}>
            {copy.recommended}
          </span>
          <span className="look-home-social">
            <span {...WINDOW_TYPE}>
              <DiscordLogo />
              {copy.discord}
            </span>
            <span {...WINDOW_TYPE}>
              <TelegramLogo />
              {copy.telegram}
            </span>
          </span>
          <div className="look-home-copy">
            {hero ? (
              <b className="look-home-title" {...WINDOW_TYPE}>
                <ModName name={hero.name} />
              </b>
            ) : (
              <Skeleton className="look-home-title-skeleton" />
            )}
            <span className="look-home-open" {...WINDOW_TYPE}>
              {copy.open}
              <ArrowRight />
            </span>
          </div>
          <div className="look-home-pager">
            {Array.from({ length: PAGER_THUMBS }, (_, index) => (
              <span key={index} className={`look-home-thumb${index === 0 ? " is-active" : ""}`}>
                {thumbs[index] ? <Photo mod={thumbs[index]} delay={index * 70} /> : <Skeleton fill delay={index * 70} />}
              </span>
            ))}
          </div>
        </div>
        <div className="look-home-shelf">
          <div className="look-home-shelf-head">
            <b {...WINDOW_TYPE}>{copy.latest}</b>
            <span className="look-home-shelf-all" {...WINDOW_TYPE}>
              {copy.allMods}
              <ArrowRight />
            </span>
            <span className="look-home-arrow">
              <CaretLeft />
            </span>
            <span className="look-home-arrow">
              <CaretRight />
            </span>
          </div>
          <div className="look-home-cards">
            {Array.from({ length: SHELF_CARDS }, (_, index) => (
              <span key={index} className="look-home-card">
                <span className="look-home-card-art">
                  {cards[index] ? <Photo mod={cards[index]} delay={index * 80} /> : <Skeleton fill delay={index * 80} />}
                  {cards[index] && index > 0 && index < 4 ? (
                    <span className="look-home-badge" {...WINDOW_TYPE}>
                      {copy.new}
                    </span>
                  ) : null}
                </span>
                {cards[index] ? (
                  <span className="look-home-card-name" {...WINDOW_TYPE}>
                    <ModName name={cards[index].name} />
                  </span>
                ) : (
                  <Skeleton line className="look-home-card-name-skeleton" />
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
