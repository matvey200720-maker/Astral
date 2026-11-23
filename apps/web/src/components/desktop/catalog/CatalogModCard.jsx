import { createElement, lazy, memo, Suspense } from "react";
import { tr } from "../../../locales/ui.js";
import { ArrowsLeftRight, Pause, Play } from "../../ui/icons.jsx";
import SpriteIcon from "../../ui/SpriteIcon.jsx";
import MediaCard from "../../ui/MediaCard.jsx";
import { PhotoSkeleton } from "../../ui/Skeleton.jsx";
import { useRenderFill, warmFrameCrop } from "../../ui/frame-crop.js";
import { useVirtualScrolled } from "../../ui/virtual-scrolled.js";
import ModName from "./ModName.jsx";
import StockCoverNote from "./StockCoverNote.jsx";
import CartButton from "../../../features/cart/CartButton.jsx";
import { useSoundPlayer } from "../../../hooks/useSoundPlayer.js";
import { catalogDownloadCount } from "../../../catalog-utils.js";
import { coverThumbUrl, useCoverThumbWidth } from "../../../utils/cover-thumb.js";
import { modPhotosAhead } from "../../../utils/photo-ahead.js";
import { catalogMediaPresentation, coverFor, hasOwnCover } from "../../../utils/catalogMedia.js";
import { modSizeLabel, sizeEstimateNote } from "../../../features/catalog/size-estimate.js";
import { localPartName } from "../../../features/catalog/part-name.js";
import { partNamePrefixes } from "../../../features/catalog/pack-contents.js";
import { packBrowseCopy } from "../../../features/catalog/pack-browse-copy.js";
import { packContentsCopy } from "../../../features/catalog/pack-contents-copy.js";
import { burstPlanOfWeapons } from "../../../features/catalog/sound-burst.js";
import { soundPackMembers, soundPackName, soundRow } from "../../../features/catalog/sound-packs.js";
import { mappingSetsOf, mappingSetWords } from "../../../features/catalog/mapping-sets.js";
import { loopOf } from "../../../features/catalog/hover-loop.js";
import { modAuthor } from "../../../features/catalog/catalog-authors.js";
import { weaponsLabel } from "../../../features/catalog/selective/selective-copy.js";
import { isGunpackMod } from "./catalogSections.js";

/* Петля при наведении (10.11.2026): код и лист едут, только когда у плитки есть петля; без наведения в плитке нет ни одного видео. */
const HoverLoop = lazy(() => import("./HoverLoop.jsx"));

const CARD_CLASS = "astral-store-card is-store is-poster";
const RENDER_MARKS = ["is-weapon-media", "is-clothing-media"];
const FILL_OPTIONS = { fallback: "contain", reserve: 0.3, hint: "catalog-store-card" };

// Рисунок карточки: вид и стиль из мода (с подменённой обложкой, если она задана), рендер ли это.
function artLook(mod, cover) {
  const { className, style } = catalogMediaPresentation(cover ? { ...mod, cover } : mod, CARD_CLASS);
  return { className, style, isRender: RENDER_MARKS.some((mark) => className.includes(mark)) };
}

const renderUrl = (mod, cover) => coverThumbUrl(cover || coverFor(mod));

export function warmCatalogCardArt(mod, cover = "") {
  const skipped = !mod || Boolean(mod.showcaseSlot || mod.reduxCard);
  if (!skipped && artLook(mod, cover).isRender) warmFrameCrop(renderUrl(mod, cover));
}

const TOGGLE_KEYS = new Set(["Enter", " "]);

// Названия стволов звука на языке окна; нет перевода — название из каталога.
const weaponNames = (row) => row.weapons.map(({ name, catalog }) => tr(name) || catalog).join(", ");

// Правила имени карточки: ключ — вид карточки, значение — как собирается показанное имя.
const NAME_RULES = {
  pack: ({ mod }) => soundPackName(mod.name),
  set: ({ language, owner }) => [mappingSetWords(language).kind, owner?.name].filter(Boolean).join(" · "),
  part: ({ mod, language }) => localPartName(mod.name, language, partNamePrefixes(mod)),
  plain: ({ mod }) => mod.name,
};

// Значок-кнопка «послушать»: клик и Enter/пробел включают запись, всплытие до карточки гасится.
function ListenButton({ packId, url, names, browse, burst }) {
  const player = useSoundPlayer(`catalog-hit:${packId}`);
  const sounding = player.playing === url;
  const caption = browse[sounding ? "stop" : "listen"](names);
  /* Найденный звук — выстрел названных стволов: очередь в темпе первого из них (`burst`), у звука без плана — один выстрел. */
  const toggle = () => {
    player.play(url, url, { burst }).catch(() => {});
  };
  const swallow = (event) => {
    event.stopPropagation();
  };
  const handlers = {
    onPointerDown: swallow,
    onClick: (event) => {
      swallow(event);
      toggle();
    },
    onKeyDown: (event) => {
      if (!TOGGLE_KEYS.has(event.key)) return;
      event.preventDefault();
      swallow(event);
      toggle();
    },
  };
  return createElement("span", { className: "sound-pack-play", role: "button", tabIndex: 0, "aria-label": caption, "aria-pressed": sounding, title: caption, ...handlers }, createElement(sounding ? Pause : Play, { weight: "fill" }));
}

function Fact({ kind, icon, extra, children }) {
  return createElement("span", { className: "poster-fact", "data-fact": kind, ...extra }, <SpriteIcon name={icon} />, children);
}

// Рамка с настоящим рендером ствола или вещи: плита пока меряется и сама картинка.
function RenderFrame({ src, art, scrolled }) {
  const img = {
    ref: art.ref,
    "data-photo": "",
    className: `astral-store-render is-${art.mode}${art.ready ? "" : " is-pending"}`,
    alt: "",
    loading: "lazy",
    decoding: "async",
    draggable: "false",
    src,
    style: art.style,
  };
  return createElement("span", { className: "ui-media-card-frame astral-store-art", "aria-hidden": "true" }, scrolled ? null : <PhotoSkeleton held={!art.ready} />, createElement("img", img));
}

// Хуки рисунка по порядку: сетка, ширина превью, замер картинки.
const useArt = (mod, cover) => {
  const scrolled = useVirtualScrolled();
  useCoverThumbWidth();
  const look = artLook(mod, cover);
  const src = look.isRender ? renderUrl(mod, cover) : "";
  return { look, src, scrolled, fill: useRenderFill(src, FILL_OPTIONS) };
};

// Что карточка за вид: пак звуков, ведущий кусок набора, часть редукса или обычный мод.
function classify(mod, mods, redux) {
  const members = soundPackMembers(mod, mods);
  const sets = mappingSetsOf(mods);
  const pieces = sets.members.get(mod.id) || [];
  const kind = members.length ? "pack" : pieces.length ? "set" : redux ? "part" : "plain";
  return { kind, members, pieces, owner: sets.owner.get(mod.id) };
}

// Правый нижний угол: загрузки, затем одно из — звуки пака, части набора или вес.
function cornerOf({ mod, mods, words, language, found }) {
  const { kind, members, pieces } = found;
  const facts = [];
  const downloads = catalogDownloadCount(mod);
  if (downloads > 0) facts.push(<Fact key="downloads" kind="downloads" icon="download">{downloads.toLocaleString(words.locale)}</Fact>);
  if (kind === "pack") return [...facts, <Fact key="contents" kind="contents" icon="speaker">{packBrowseCopy(language).sounds(members.length)}</Fact>];
  if (kind === "set") return [...facts, <Fact key="contents" kind="contents" icon="map">{packContentsCopy(language).parts(pieces.length)}</Fact>];
  const size = modSizeLabel(mod, mods, words.locale);
  const note = size.approximate ? { "data-approximate": "", title: sizeEstimateNote() } : null;
  return size.text ? [...facts, <Fact key="size" kind="size" icon="drives" extra={note}>{size.text}</Fact>] : facts;
}

// Строка под именем плитки сетки (доска Cat): «18 стволов · @автор» — сколько внутри и чьё. Без автора и без «внутри» строки нет.
const handle = (name) => (/\s/.test(name) ? name : `@${name}`);
function tileMeta({ mod, found, language }) {
  const { kind, members, pieces } = found;
  const inside =
    kind === "pack"
      ? packBrowseCopy(language).sounds(members.length)
      : kind === "set"
        ? packContentsCopy(language).parts(pieces.length)
        : isGunpackMod(mod) && mod.includedModIds?.length
          ? weaponsLabel(mod.includedModIds.length, language)
          : "";
  /* У части редукса автор — автор всего редукса, а имя уже называет редукс («<редукс> <вид>», 28.10.2026): строка автора у неё пустая. */
  const author = kind === "part" ? "" : modAuthor(mod);
  return [inside, author ? handle(author) : ""].filter(Boolean).join(" · ") || null;
}

const CatalogModCard = (props) => {
  const { mod, mods, liked, language, words, onFavorite, onSelect } = props;
  const { redux = null, soundHits = null, cover = "" } = props;
  /* Режим выбора («Взять из другого редукса», `component-pick.js`): "on" — карточку можно выбрать, "off" — нельзя (часть самой сборки или другой вид); сердца и корзины нет. */
  const { picking = "", tile = false } = props;
  const { look, src, scrolled, fill } = useArt(mod, cover);
  const found = classify(mod, mods, redux);
  const { kind } = found;
  const shownName = NAME_RULES[kind]({ mod, language, owner: found.owner });
  // Подпись сердца: у части редукса — переведённое название, у пака и набора — имя записи.
  const favoriteName = kind === "part" ? shownName : mod.name;

  const hit = kind === "pack" ? found.members.find((one) => one.id === soundHits?.[0]) : undefined;
  const row = hit && soundRow(hit);
  const names = row ? weaponNames(row) : "";
  const browse = hit ? packBrowseCopy(language) : null;
  const corner = cornerOf({ mod, mods, words, language, found });

  const picture = look.isRender ? { media: <RenderFrame src={src} art={fill} scrolled={scrolled} /> } : { mediaStyle: look.style };
  const named = <ModName name={shownName} />;
  const cardProps = {
    className: [kind === "pack" ? `${look.className} sound-pack-card` : look.className, picking === "off" && "is-pick-off"].filter(Boolean).join(" "),
    ...picture,
    frameClassName: "astral-store-art",
    copyClassName: "astral-store-copy",
    trailingClassName: "astral-store-size",
    likeClassName: "astral-store-like",
    title: kind === "part" ? <span data-no-translate="">{named}</span> : named,
    description: hit ? browse.soundHit(names) : tile ? tileMeta({ mod, found, language }) : null,
    trailing: corner.length ? corner : null,
    liked,
    favoriteLabel: liked ? words.favoriteRemove(favoriteName) : words.favoriteAdd(favoriteName),
    onFavorite: picking
      ? null
      : () => {
          onFavorite(mod.id);
        },
    onClick: () => {
      onSelect(mod, hit ? hit.id : "");
    },
    /* Фото мода у API заранее: на наведении и нажатии страница мода открывается с готовой лентой (`utils/photo-ahead.js`). */
    ...modPhotosAhead(mod),
    "data-sound-hit": hit?.id,
    "data-pick": picking || undefined,
    "aria-disabled": picking === "off" ? "true" : undefined,
  };
  const listen = row?.sound ? <ListenButton packId={mod.id} url={row.sound.url} names={names} browse={browse} burst={burstPlanOfWeapons(row.weapons)} /> : null;
  const loop = loopOf(mod);
  const alive = loop ? (
    <Suspense fallback={null}>
      <HoverLoop loop={loop} />
    </Suspense>
  ) : null;
  /* «Через карандаш»: годная карточка под курсором говорит, что с ней будет (чистовой набор 2, 15.11.2026). */
  const put =
    picking === "on" ? (
      <span className="astral-pick-put" aria-hidden="true">
        <ArrowsLeftRight weight="bold" />
        {tr("Поставить вместо части")}
      </span>
    ) : null;
  return createElement(MediaCard, cardProps, hasOwnCover(mod) ? null : <StockCoverNote language={language} />, listen, picking ? null : <CartButton mod={mod} compact />, alive, put);
};

export default memo(CatalogModCard);
