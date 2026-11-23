import { useEffect, useLayoutEffect, useRef } from "react";
import { isGunpackCard, isClothingCard } from "./ModCardParts.jsx";
import { modModelUrl } from "../ModModelPreview.jsx";
import { skyCycleOf } from "./SkyCyclePlayer.jsx";
import { modSourceLinks } from "../ModAuthor.jsx";
import { default as useHolds } from "../../../ui/useHolds.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { coverFor, hasOwnCover, isEffectMod, isTimecycleMod } from "../../../../utils/catalogMedia.js";
import { closeEditorOpening, useEditorOpening } from "../../../../features/catalog/editor-opening.js";
import { youtubeVideoId } from "../../../../features/catalog/youtube-video.js";
import { localPartName } from "../../../../features/catalog/part-name.js";
import { partNamePrefixes } from "../../../../features/catalog/pack-contents.js";
import { reduxPartFrames } from "../../../../features/catalog/redux-gallery.js";
import WideCard from "./wide/WideCard.jsx";
import { pultKindOf } from "./wide/wide-model.js";

/*
 * Страница мода: разбор `view` в то, что рисует сцена (`describePage`) и вход в карточку «Пульт» (`wide/WideCard.jsx`) — одну раскладку на все виды модов
 * (чистовой набор 2, 15.11.2026). Прежняя раскладка с левой колонкой списков («Кадры суток», «Вид вещи», звуки) убрана.
 */

// Кадры, которые нельзя открыть во весь экран.
const NOT_VIEWABLE = new Set(["placeholder", "youtube", "clip"]);

/* ---------- кадры и сцена ---------- */

const isVideo = (frame) => frame.type === "video";
const videosOf = (frames) => frames.filter(isVideo);
// Кадры полки: заглушки уходят, при суточном ролике уходят и ролики; ролики первыми,
// картинка, уже видная постером ролика, второй плиткой не нужна.
const shelfFrames = (media, dayClip) => {
  const usable = media.filter((frame) => frame.type !== "placeholder" && !(dayClip && isVideo(frame)));
  const videos = videosOf(usable);
  const posters = new Set(videos.map((frame) => frame.poster).filter(Boolean));
  return videos.concat(usable.filter((frame) => !isVideo(frame) && !posters.has(frame.src)));
};

// Обложка шапки: адрес кадра или постера ролика, равный view.cover; затем первая картинка, затем постер.
const coverAddress = (view, own) =>
  view.media.flatMap((frame) => [frame.src, frame.poster]).find((address) => address && address === view.cover) ||
  own.find((frame) => !isVideo(frame))?.src ||
  own.find((frame) => frame.poster)?.poster ||
  "";

const plainEntry = (key, item, model = "", name = "") => ({ key, item, name, model });

// Записи сцены одной группой за другой; без адреса и с уже встреченным адресом пропускаются.
const dedupeScene = (groups) => {
  const met = new Set();
  return groups.flat().filter(({ item }) => item.src && !met.has(item.src) && met.add(item.src));
};

const clipEntry = (mod) => {
  const { clip } = mod;
  const effect = isEffectMod(mod);
  return plainEntry(`clip:${clip.src}`, {
    type: "clip",
    id: clip.src,
    src: clip.src,
    poster: clip.poster || "",
    mime: clip.mime || "",
    bytes: Number.isFinite(clip.bytes) ? clip.bytes : 0,
    silent: isTimecycleMod(mod) || effect,
    effect,
    caption: clip.caption || "",
  });
};

const youtubeEntries = (mod, view) =>
  modSourceLinks(mod, view.rails?.allMods).map((link) => {
    const id = youtubeVideoId(link.url);
    return plainEntry(`youtube:${id}`, { type: "youtube", id, src: link.url });
  });

const weaponEntry = ({ mod, weapon }) => {
  const origin = typeof mod.coverOrigin === "string" ? { kind: mod.coverOrigin } : mod.coverOrigin;
  const item = { type: "image", src: coverFor(mod), origin, caption: mod.coverCaption, width: mod.coverWidth };
  return plainEntry(`weapon:${mod.id}`, item, modModelUrl(mod), weapon.name);
};

// Список записей сцены для ModStage.
const sceneOf = (view, facts) => {
  const { mod, isSound, framesFrom } = view;
  const { shelf, modelOnly, frameModel, headCover, contents } = facts;
  const tied = isSound || framesFrom;
  const parts = tied ? [] : reduxPartFrames({ mod, contents, language: view.language, translate: tr });
  const frames = isSound ? videosOf(shelf) : shelf;
  const fromShelf = modelOnly ? [] : parts.length ? videosOf(frames) : frames;
  const groups = [
    mod.clip?.src && !modelOnly ? [clipEntry(mod)] : [],
    modelOnly ? [] : youtubeEntries(mod, view),
    fromShelf.map((frame) => plainEntry(frame.src, frame, frameModel)),
    parts,
    tied ? [] : contents.filter((tile) => tile.weapon?.kind === "weapon" && hasOwnCover(tile.mod)).map(weaponEntry),
  ];
  const scene = dedupeScene(groups);
  if (scene.length) return scene;
  if (frameModel) {
    const item = headCover ? { type: "image", src: headCover } : { type: "placeholder", src: "" };
    return [plainEntry("cover", item, frameModel)];
  }
  return modelOnly && headCover ? [plainEntry("cover", { type: "image", src: headCover })] : [];
};

/* ---------- всё, что страница выводит из view ---------- */

// Шаги идут по порядку: каждый видит view и то, что накопили прошлые; порядок вызовов соседей сохранён.
const PAGE_STEPS = [
  (view) => ({ part: view.reduxes?.length > 0 }),
  (view, got) => ({
    shownName: got.part ? localPartName(view.mod.name, view.language, partNamePrefixes(view.mod)) : view.mod.name,
  }),
  (view) => ({ clothing: isClothingCard(view.mod) }),
  (view) => ({ dayClip: isTimecycleMod(view.mod) && Boolean(view.mod.clip?.src) }),
  /* Таймцикл и эффекты (попадания, трассеры, килл-эффект): со своим роликом на сцене сразу он, кадров-скриншотов рядом нет (владелец, 15.11.2026). */
  (view) => ({ motionOnly: (isTimecycleMod(view.mod) || isEffectMod(view.mod)) && Boolean(view.mod.clip?.src) }),
  (view, got) => ({ shelf: shelfFrames(view.media, got.dayClip) }),
  (view, got) => ({ headCover: coverAddress(view, view.framesFrom ? [] : got.shelf) }),
  (view) => ({ contents: view.contents ?? [] }),
  (view, got) => ({ weaponPack: got.contents.some((tile) => tile.weapon?.kind === "weapon") }),
  (view, got) => ({ modelOnly: got.weaponPack || isGunpackCard(view.mod) }),
  (view, got) => ({ frameModel: view.isSound || view.framesFrom || got.weaponPack ? "" : modModelUrl(view.mod) }),
  (view, got) => ({ sky: view.isSound || view.framesFrom || got.dayClip ? null : skyCycleOf(view.mod) }),
  (view, got) => ({ stageItems: sceneOf(view, got) }),
  (view, got) => ({
    viewable: got.stageItems.map((entry) => entry.item).filter((item) => !NOT_VIEWABLE.has(item.type)),
  }),
];

const describePage = (view) => PAGE_STEPS.reduce((got, step) => Object.assign(got, step(view, got)), {});

/* ---------- экран открытия редактора ---------- */

const scrollMain = (top) => {
  document.querySelector(".desktop-main")?.scrollTo({ top, left: 0 });
};

const closeOnLeave = () => {
  closeEditorOpening();
};

// Страница прячется, прокрутка запоминается и возвращается.
const useEditorCurtain = () => {
  const opening = useEditorOpening();
  const memo = useRef(null);
  useLayoutEffect(() => {
    if (opening) {
      memo.current = opening.top;
      scrollMain(0);
      return;
    }
    if (memo.current == null) return;
    scrollMain(memo.current);
    memo.current = null;
  }, [opening]);
  useEffect(() => closeOnLeave, []);
  return opening;
};

/* ---------- страница ---------- */

export default function ModCard({ view }) {
  useTr();
  const opening = useEditorCurtain();
  const pageRef = useRef(null);
  /* Карточка тянется до края окна, как выдача каталога (правка владельца 14.11.2026): зазор справа тот же, что у остальных страниц. */
  useHolds(pageRef, "catalog-product-page catalog-wide", [".desktop-content"]);

  const page = describePage(view);
  /* Одна раскладка на все виды: ганпак, редукс, пак звуков и всё остальное отличаются сценой и правой панелью, а не страницей. */
  return <WideCard key={view.mod.id} view={view} page={page} kind={pultKindOf(view)} opening={opening} pageRef={pageRef} />;
}
