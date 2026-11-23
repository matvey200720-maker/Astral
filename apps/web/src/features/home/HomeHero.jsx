// Герой Главной («Кино»): кадр мода во всю ширину, плашка «Рекомендуем» с полосками хода, Discord и Telegram справа вверху (поиска здесь нет — владелец, 16.11.2026), название, описание,
// «Установить» / «Подробнее» (или «Установлено» / «Откатить») и лента из пяти модов справа внизу.
// Классы и порядок узлов — контракт с home.css. Кадры — только мода из подборки: у каталога нет парных кадров «до/после».
import { useEffect, useMemo, useReducer, useState } from "react";
import { modCardKicker } from "../../catalog-utils.js";
import { dataLangOf } from "../../components/desktop/catalog/data-lang.js";
import ModKicker from "../../components/desktop/catalog/ModKicker.jsx";
import ModName from "../../components/desktop/catalog/ModName.jsx";
import StockCoverNote from "../../components/desktop/catalog/StockCoverNote.jsx";
import Button from "../../components/ui/Button.jsx";
import { Skeleton } from "../../components/ui/Skeleton.jsx";
import { useFrameCrop } from "../../components/ui/frame-crop.js";
import {
  ArrowClockwise,
  ArrowUUpLeft,
  Check,
  Clock,
  CloudSlash,
  DownloadSimple,
  DiscordLogo,
  ImageBroken,
  TelegramLogo,
} from "../../components/ui/icons.jsx";
import { communityLinks } from "../../components/desktop/desktopShellDefaults.js";
import { openLink } from "../../components/desktop/settings/open-link.js";
import { tr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import { hasOwnCover } from "../../utils/catalogMedia.js";
import { coverThumbUrl, coverThumbWidthAt } from "../../utils/cover-thumb.js";
import { installFromHome } from "./home-data.js";
import { whenText } from "./home-time.js";
import {
  coverOf,
  cx,
  factsOf,
  heroKindOf,
  stateOf,
  swapBroken,
} from "./home-shared.jsx";

// ТЗ 05.10.2026, задачи 10 и 11: витрина меняется раз в семь секунд; пять модов подборки по кругу.
const FEATURED_ROTATION_MS = 7_000;
const SLIDE_COUNT = 5;
const PILL_PX = 118;
// 900 мс равны токену --home-banner-duration в home.css, разводить их нельзя.
const FEATURED_FADE_MS = 900;

// Значок вида на миниатюре: рендер у ствола и одежды, волна у звука.
const PILL_MARKS = {
  weapon: { "data-render": "true" },
  clothing: { "data-render": "true" },
  sound: { "data-wave": "true" },
};

// Таймеры с отменой: возвращают функцию, пригодную как очистка эффекта.
const later = (fn, ms) => {
  const id = window.setTimeout(fn, ms);
  return () => window.clearTimeout(id);
};
const every = (fn, ms) => {
  const id = window.setInterval(fn, ms);
  return () => window.clearInterval(id);
};

// move — функция «откуда → куда»; без неё снимается уходящий кадр.
function slideReducer(state, move) {
  if (move)
    return {
      swaps: state.swaps + 1,
      previous: state.current,
      current: move(state.current),
    };
  return { ...state, previous: null };
}

// Режим кадра: ствол и одежда ждут замера обложки (pending), остальные видны сразу.
function useFrameMode(mod) {
  const kind = heroKindOf(mod);
  const measured = kind === "weapon" || kind === "clothing";
  const crop = useFrameCrop(measured ? coverOf(mod) : "");
  if (!measured) return { map: "map", sound: "wave" }[kind] ?? "photo";
  return crop === undefined
    ? "pending"
    : crop?.field || crop?.transparent
      ? "render"
      : "photo";
}

// Листание: текущий, уходящий и счётчик смен. Интервал заводится заново после каждой смены, новый мод получает полные семь секунд.
// Нажатие на ленту справа внизу останавливает ход насовсем (до перезагрузки Главной): читают то, что выбрали.
function useSlides(banner, live, fallback) {
  const slides = useMemo(() => banner.slice(0, SLIDE_COUNT), [banner]);
  const len = slides.length;
  const [{ current, previous, swaps }, shift] = useReducer(slideReducer, {
    swaps: 0,
    current: 0,
    previous: null,
  });
  const [held, hold] = useState(false);
  const at = current % (len || 1);
  const rotating = len > 1 && live && !held;
  const upcoming = len > 1 ? coverOf(slides[(at + 1) % len]) : "";
  // длина в зависимостях: при смене состава подборки ход заводится заново
  useEffect(
    () =>
      rotating
        ? every(() => shift((c) => (c + 1) % len), FEATURED_ROTATION_MS)
        : undefined,
    [rotating, swaps, len],
  );
  // уходящий кадр снимается эффектом: пока смена не отрисована, таймера нет
  useEffect(
    () =>
      previous === null
        ? undefined
        : later(() => shift(null), FEATURED_FADE_MS),
    [previous, swaps],
  );
  // обложку следующего мода грузим заранее
  useEffect(() => {
    if (upcoming)
      Object.assign(new Image(), { decoding: "async", src: upcoming });
  }, [upcoming]);
  return {
    slides,
    at,
    swaps,
    rotating,
    recommended: slides[at] ?? fallback,
    previousMod: previous === null || !len ? undefined : slides[previous % len],
    pick: (k) => {
      hold(true);
      if (k !== at) shift(() => k);
    },
  };
}

// Кадр витрины считает свой режим сам: уходящий и новый кадр могут отличаться по виду мода.
function HeroFrame({ mod, state }) {
  const mode = useFrameMode(mod);
  return (
    <img
      aria-hidden="true"
      decoding="async"
      alt=""
      src={coverOf(mod)}
      onError={swapBroken}
      className={cx(
        "editorial-featured-media",
        `is-${state}`,
        mode !== "photo" && `is-${mode}`,
      )}
    />
  );
}

// Справа вверху — Discord и Telegram (владелец, 16.11.2026, вместо поиска): адреса из `desktopShellDefaults.js` (`communityLinks`, переменные окружения
// VITE_MODOVIK_DISCORD_URL и VITE_MODOVIK_TELEGRAM_URL), открываются во внешнем браузере тем же `openLink`, что и остальные внешние ссылки окна.
// Знаки — белые, одной формы с набором Astral; подпись — название сети, подсказка и `aria-label` — по-русски и на остальных языках окна.
function HeroCommunity() {
  const nets = [
    [
      "discord",
      communityLinks.discord,
      DiscordLogo,
      "Discord",
      tr("Открыть Discord Astral"),
    ],
    [
      "telegram",
      communityLinks.telegram,
      TelegramLogo,
      "Telegram",
      tr("Открыть Telegram Astral"),
    ],
  ];
  return (
    <div className="astral-home-community">
      {nets.map(([id, url, Icon, name, hint]) => (
        <a
          key={id}
          className="astral-home-net"
          data-net={id}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={hint}
          title={hint}
          onClick={(event) => {
            event.preventDefault();
            openLink(url);
          }}
        >
          <Icon aria-hidden="true" weight="fill" />
          <span>{name}</span>
        </a>
      ))}
    </div>
  );
}

// Полоски хода: пройденные белые, текущая наполняется за семь секунд (transform), остальные тусклые.
function Bars({ count, at, rotating }) {
  return (
    <span aria-hidden="true" className="astral-home-bars">
      {Array.from({ length: count }, (_, k) => (
        <i key={k} className={cx(k < at && "is-done", k === at && "is-on")}>
          {k === at && <b data-running={rotating ? "true" : undefined} />}
        </i>
      ))}
    </span>
  );
}

// Лента пяти модов справа внизу: стоит на месте, текущий выделен.
function Dock({ slides, at, onPick, words }) {
  return (
    <div
      role="group"
      aria-label={words.copy.featuredPager}
      className="astral-home-pager"
    >
      {slides.map((mod, k) => (
        <button
          aria-label={`${words.copy.showFeatured}: ${mod.name}`}
          lang={dataLangOf(mod.name)}
          aria-current={k === at ? "true" : undefined}
          onClick={() => onPick(k)}
          className={cx("astral-home-pager-item", k === at && "is-active")}
          key={mod.id}
          type="button"
        >
          <img
            alt=""
            loading="lazy"
            decoding="async"
            {...PILL_MARKS[heroKindOf(mod)]}
            src={coverThumbUrl(coverOf(mod), coverThumbWidthAt(PILL_PX))}
            onError={swapBroken}
          />
          <b>
            <ModName name={mod.name} />
          </b>
        </button>
      ))}
    </div>
  );
}

// Разряд размера названия на Главной (владелец, 16.11.2026 вечер: мерка — «Серьга Teddy Bear» или меньше): длиннее 24 знаков — «long», длиннее 44 — «very-long».
// Выше разряд — мельче шрифт (home.css), и всё равно не больше двух строк с многоточием.
const heroTitleSize = (name) => {
  const n = Array.from(String(name || "")).length;
  return [undefined, "long", "very-long"][(n > 24) + (n > 44)];
};

const blurb = (mod) =>
  String(mod.description || mod.summary || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

function HeroActions({ mod, state, when, onInstall, onRemove, onOpen }) {
  /* Одна строка без пояснения: про точку возврата нигде не пишем (владелец, 16.11.2026). */
  const [Mark, title] =
    state === "installed"
      ? [Clock, when ? trFill("Установлено {0}", when) : tr("Установлено")]
      : [ArrowUUpLeft, tr("Откат в один клик")];
  return (
    <div className="astral-home-hero-actions">
      {state === "installed" ? (
        <>
          <span className="astral-home-state">
            <Check aria-hidden="true" weight="bold" />
            {tr("Установлено")}
          </span>
          {onRemove && (
            <Button
              size="lg"
              variant="primary"
              icon={<ArrowUUpLeft />}
              onClick={() => onRemove(mod)}
            >
              {tr("Откатить")}
            </Button>
          )}
        </>
      ) : (
        <>
          <Button
            size="lg"
            variant="primary"
            icon={<DownloadSimple />}
            disabled={state === "busy"}
            onClick={onInstall}
          >
            {state === "busy" ? tr("Идёт установка…") : tr("Установить")}
          </Button>
          <Button size="lg" variant="secondary" onClick={onOpen}>
            {tr("Подробнее")}
          </Button>
        </>
      )}
      {state !== "busy" && (
        <span className="astral-home-rollback">
          <span aria-hidden="true">
            <Mark />
          </span>
          <span>{title}</span>
        </span>
      )}
    </div>
  );
}

function HeroCopy({ mod, className, words, actions, titleId, ...rest }) {
  const { language } = words;
  const facts = factsOf(mod, language);
  const text = blurb(mod);
  return (
    <div {...rest} className={cx("editorial-featured-bottom", className)}>
      <div className="editorial-featured-copy">
        {modCardKicker(mod) && (
          <span className="astral-home-hero-kicker" data-audit-ignore="caps">
            <ModKicker mod={mod} language={language} />
          </span>
        )}
        <h2 id={titleId} data-length={heroTitleSize(mod.name)}>
          <ModName name={mod.name}>{mod.name}</ModName>
        </h2>
        {text && <p className="astral-home-hero-text">{text}</p>}
        {actions}
        {facts.length > 0 && (
          <div className="editorial-featured-metrics">{facts}</div>
        )}
      </div>
    </div>
  );
}

// Загрузка каталога: каркас с мерцанием на месте кадра, названия и кнопок. Ничего не прыгает, когда всё приедет.
function HeroSkeleton() {
  return (
    <section
      className="editorial-featured astral-home-hero is-loading"
      aria-busy="true"
    >
      <Skeleton className="astral-home-hero-plate" />
      <div className="editorial-featured-topbar">
        <Skeleton className="astral-home-tag-plate" />
        <HeroCommunity />
      </div>
      <div className="editorial-featured-bottom">
        <div className="editorial-featured-copy">
          <Skeleton className="astral-home-plate-kick" />
          <Skeleton className="astral-home-plate-title" />
          <Skeleton className="astral-home-plate-line" />
          <Skeleton className="astral-home-plate-line is-short" />
          <div className="astral-home-hero-actions">
            <Skeleton className="astral-home-plate-button" />
            <Skeleton className="astral-home-plate-button is-small" />
          </div>
        </div>
      </div>
    </section>
  );
}

// Каталога нет: ещё не загрузился (нет связи) или пуст. Один ответ на оба случая, с «Повторить» только у первого.
function HeroEmpty({ pending, words, onRetry, onNavigate }) {
  const { copy } = words;
  const [key, Icon] = pending
    ? ["catalogPending", CloudSlash]
    : ["catalogEmpty", ImageBroken];
  return (
    <section className="editorial-featured astral-home-hero is-empty">
      <div className="editorial-featured-topbar">
        <span />
        <HeroCommunity />
      </div>
      <div className="editorial-featured-empty astral-home-empty" role="status">
        <span aria-hidden="true" className="astral-home-empty-icon">
          <Icon />
        </span>
        <h2>{copy[key]}</h2>
        <p>{copy[`${key}Text`]}</p>
        {pending && (onRetry || onNavigate) && (
          <div className="astral-home-empty-actions">
            {onRetry && (
              <Button
                variant="primary"
                icon={<ArrowClockwise />}
                onClick={onRetry}
              >
                {tr("Повторить сейчас")}
              </Button>
            )}
            {onNavigate && (
              <Button variant="secondary" onClick={() => onNavigate("library")}>
                {tr("Открыть библиотеку")}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default function Hero({
  banner,
  fallback,
  live,
  words,
  loading,
  catalogPending,
  installed,
  queue,
  times,
  onSelect,
  onInstall,
  onRemove,
  onNavigate,
  onRetryCatalog,
}) {
  const { language } = words;
  const { slides, at, swaps, rotating, recommended, previousMod, pick } =
    useSlides(banner, live, fallback);
  const mode = useFrameMode(recommended);
  if (!recommended)
    return loading ? (
      <HeroSkeleton />
    ) : (
      <HeroEmpty
        pending={catalogPending}
        words={words}
        onRetry={onRetryCatalog}
        onNavigate={onNavigate}
      />
    );
  const state = stateOf(recommended, installed, queue);
  const open = () => onSelect?.(recommended);
  const actions = (
    <HeroActions
      mod={recommended}
      state={state}
      when={whenText(times.get(recommended.id), language)}
      onInstall={() =>
        void installFromHome(recommended, { onInstall, onSelect })
      }
      onRemove={onRemove}
      onOpen={open}
    />
  );
  return (
    /* Имя секции — видимый заголовок (в нём название мода уже помечено языком данных): `aria-label` с русским названием аудит locale на de и pl ловил как непереведённое. */
    <section
      aria-labelledby="astral-home-hero-title"
      className={`editorial-featured astral-home-hero${mode === "photo" ? "" : ` is-${mode === "pending" ? "render" : mode}`}`}
    >
      <div aria-hidden="true" className="astral-home-hero-stage">
        {previousMod && (
          <HeroFrame
            mod={previousMod}
            state="previous"
            key={`previous${swaps}`}
          />
        )}
        <HeroFrame mod={recommended} state="current" key={`current${swaps}`} />
      </div>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="astral-home-hero-open"
        onClick={open}
      />
      <div className="editorial-featured-topbar">
        <div className="astral-home-top-left">
          <em>{words.copy.recommended}</em>
          {slides.length > 1 && (
            <Bars count={slides.length} at={at} rotating={rotating} />
          )}
          {!hasOwnCover(recommended) && (
            <StockCoverNote className="is-inline" language={language} />
          )}
        </div>
        <HeroCommunity />
      </div>
      {previousMod && (
        <HeroCopy
          mod={previousMod}
          words={words}
          key={`previous${swaps}`}
          aria-hidden="true"
          className="is-previous"
        />
      )}
      <HeroCopy
        words={words}
        mod={recommended}
        className={swaps ? "is-entering" : ""}
        key={`current${swaps}`}
        actions={actions}
        titleId="astral-home-hero-title"
      />
      {slides.length > 1 && (
        <Dock slides={slides} at={at} onPick={pick} words={words} />
      )}
    </section>
  );
}

export { heroKindOf };
