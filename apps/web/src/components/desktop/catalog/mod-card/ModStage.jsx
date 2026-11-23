import "./mod-stage.css";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ArrowsOut, CaretLeft, CaretRight, Cube, Play, YoutubeLogo } from "../../../ui/icons.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { PhotoSkeleton, skeletonDelay } from "../../../ui/Skeleton.jsx";
import { useRenderFill } from "../../../ui/frame-crop.js";
import { STRIP_THUMB_PX, pageThumbUrl } from "../../../../utils/cover-thumb.js";
import FrameTile from "./FrameTile.jsx";
import YoutubeStage from "./YoutubeStage.jsx";
import ClipStage from "./ClipStage.jsx";
import ModelWindow from "./ModelWindow.jsx";
import { canPreviewMod } from "../../../../features/catalog/preview/preview-entry.js";

// Полный предпросмотр мода «Миникарта», «Таймцикл» или «Прицел» (Каталог 2.0): окно грузится, когда его открыли.
const ModPreviewWindow = lazy(() => import("../../../../features/catalog/preview/ModPreviewWindow.jsx"));
import { colourOfImage } from "../../../../features/clothing/colour-mapping.js";
import { coverColourOf } from "../../../../features/clothing/cover-colour.js";

/*
 * Кадры мода — сцена и лента (ТЗ 23.10.2026, п. N).
 *
 * Сверху — одно большое превью на одном уровне с лентой: у ганпака фото, у редукса и звуков видео (оно играет прямо
 * здесь, со своими органами плеера). Свой ролик YouTube мода (25.10.2026) стоит первым кадром настоящим плеером в рамке
 * (`youtube-nocookie.com/embed`), а не пилюлей-ссылкой в шапке. Под ним — лента: сразу пять кадров, а если их больше (ганпак из десяти стволов) —
 * стрелки листают ленту, и каждое оружие можно открыть. Щелчок по большому кадру разворачивает его на весь экран
 * (ModFrameViewer), по кадру в ленте — ставит его на сцену.
 *
 * У ганпаков и одежды в правом верхнем углу сцены кнопка «3D»: она открывает отдельное окно (модальное, закрывается по Esc
 * и крестику) с просмотром модели — её можно крутить и приближать; фото на сцене остаётся на месте (ТЗ 24.10.2026,
 * п. 10: «3D открывает отдельное окно, а не подменяет фото»). У ганпака модель у каждого ствола своя: окно показывает
 * модель того ствола, что стоит на сцене. Там, где модели нет, кнопки нет: обещать 3D без модели нельзя — у общего снимка
 * самого ганпака её нет (24.10.2026 ночью), а стволы смотрят в 3D и на своих кадрах в ленте, и глазом в «Компонентах».
 *
 * Лента стоит под фото всегда, даже когда кадр один (24.10.2026), а сама сцена тянется на высоту правой панели: фото
 * заполняет то, что осталось от ленты, но не ниже своих 16 : 9 (`mod-stage.css`).
 *
 * items — список { key, item, name, model }: item — кадр ({ type, src, poster, … }), name — подпись ствола в ленте,
 * model — адрес его модели или пусто.
 */

/** Кадров в ленте на виду. */
export const STAGE_VISIBLE = 5;

const thumbOf = (entry, cover) =>
  entry.item.thumbnail ||
  entry.item.poster ||
  (entry.item.type === "video" ? cover : entry.item.src);

function Thumb({ entry, index, active, view, cover, onPick }) {
  /* Ролик YouTube (25.10.2026): картинки у него нет — адрес YouTube окну по политике контента закрыт, — поэтому плитка
     рисуется сама: тёмное поле, знак YouTube и «играть». */
  const youtube = entry.item.type === "youtube";
  /* Ролик со звуком (25.10.2026, `mod.clip`): плитка — его кадр-обложка со значком «играть». */
  const clip = entry.item.type === "clip";
  const video = entry.item.type === "video" || youtube || clip;
  /* Ствол ленты — с подписью-именем: рендер на матовом поле, крупно по центру. Кадр части редукса тоже с именем, но он —
     настоящий кадр (мини-карта, арена…), а не рендер на матовом поле: рисуется как обычный. */
  const weapon = Boolean(entry.name) && !entry.part;
  const src = youtube ? "" : clip ? entry.item.poster || cover : thumbOf(entry, cover);
  /* Рендер на прозрачном (вещь, обвес, ствол пака) — в ленте так же, как на сцене: рисунок вписан в плитку с полем не больше
     6 %, а не «cover» (25.10.2026, владелец: при листании цветов часть кадров крупнее). Обложка 1200 × 675 и кадры
     расцветок 512 × 512 одной вещи иначе ложились в плитку 16 : 9 по-разному — квадрат режется по высоте и вещь
     вырастает, а обложка стоит как есть. Фото и кадр без рамки рисунка остаются «cover». У ствола ленты — свой «contain». */
  /* Плитка ленты — 161 css px: берём превью API (`?w=360`), а не оригинал 1200 × 800; выбывает кадр по его настоящему адресу (14.11.2026). */
  const shown = pageThumbUrl(src, STRIP_THUMB_PX);
  const art = useRenderFill(video || weapon ? "" : shown, { fallback: "cover" });
  const label =
    entry.name ||
    (youtube ? tr("Обзор на YouTube") : clip ? (entry.item.effect ? tr("Стрельба из карабина") : entry.item.silent ? tr("Сутки таймцикла") : tr("Ролик со звуком")) : video ? view.cardCopy.watchVideo : `${tr("Кадр")} ${index + 1}`);
  return (
    <li>
      <button
        type="button"
        className={`mod-stage-thumb${active ? " is-active" : ""}${weapon ? " is-weapon" : ""}${video ? " is-video" : ""}`}
        aria-label={label}
        aria-current={active ? "true" : undefined}
        onClick={() => onPick(index)}
      >
        {src ? (
          <>
            {/* Серое место, пока кадр ленты едет: плиты идут волной слева направо (скелет, `docs/3D.md`, правило 22). */}
            <PhotoSkeleton delay={skeletonDelay(index)} />
            <img
              ref={art.ref}
              className={`is-${art.mode}${art.ready ? "" : " is-pending"}`}
              style={art.style}
              src={shown}
              alt=""
              data-photo=""
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              draggable="false"
              onError={(event) => {
                /* Кадр не загрузился: из набора мода он выбывает, а в ленте остаётся пустая плитка, не значок битой картинки. */
                view.dropMedia?.(src);
                event.currentTarget.hidden = true;
              }}
            />
          </>
        ) : (
          <span className={`mod-stage-thumb-empty${youtube ? " is-youtube" : ""}`} aria-hidden="true">
            {youtube && <YoutubeLogo weight="fill" />}
          </span>
        )}
        {video && !youtube && (
          <span className="mod-stage-thumb-badge" aria-hidden="true">
            <Play weight="fill" />
          </span>
        )}
        {entry.name && (
          <span className="mod-stage-thumb-name">{entry.name}</span>
        )}
      </button>
    </li>
  );
}

export default function ModStage({
  view,
  items,
  kind = "weapon",
  cover = "",
  onOpen,
}) {
  useTr();
  const [active, setActive] = useState(0);
  /* Вторая сторона вещи (25.10.2026): у главного кадра цвета — `back`, показывается по кнопке «Сзади» / «Спереди», а не отдельным кадром ленты. */
  const [back, setBack] = useState(false);
  /* Номер ствола, чью модель показывает окно «3D»; `null` — окно закрыто. */
  const [modelIndex, setModelIndex] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: true });
  const listRef = useRef(null);
  const count = items.length;
  const current = items[Math.min(active, count - 1)] || items[0];
  const modelEntry = modelIndex === null ? null : items[modelIndex];
  const side = back && current?.item.back ? current.item.back : null;
  /* Цвет выбранного кадра (28.10.2026): кадр цвета мода — его главная картинка; «3D» открывается этим цветом. Кадр не цвета (обложка, ролик) цвет не меняет:
     помнится последний выбранный цвет. */
  /* Обложка — тоже кадр цвета (28.10.2026, вечер): на ней нарисована одна из расцветок («Free Fire» белая), и «3D» открывается ею, а не прошлым выбором. Какая
     именно — `coverColourOf` (сама карточка называет её, иначе сличаются краски обложки и кадров); определяется в тихую минуту после открытия страницы. */
  const onCover = kind === "clothing" && Boolean(cover) && current?.item.src === cover;
  const [coverColour, setCoverColour] = useState("");
  useEffect(() => {
    if (!onCover) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      coverColourOf(view.mod, cover).then((letter) => alive && setCoverColour(letter));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [onCover, cover, view.mod]);
  const frameColour = kind === "clothing" ? colourOfImage(view.mod, current?.item.src) || (onCover ? coverColour : "") : "";
  const [pickedColour, setPickedColour] = useState("");
  useEffect(() => {
    if (frameColour) setPickedColour(frameColour);
  }, [frameColour]);
  const youtube = current?.item.type === "youtube";
  const clip = current?.item.type === "clip";
  const video = current?.item.type === "video" || youtube || clip;
  /* Происхождение петли мода — подсказкой на видео, видимой подписи нет (владелец, 25.10.2026). */
  const rawCaption = video && current.item.loop ? view.captionOf?.(current.item) : "";
  const clipCaption = rawCaption ? tr(rawCaption) : "";

  /* Набор кадров сменился (другой мод, кадр не загрузился): сцена не уходит за край. */
  useEffect(() => {
    if (active > count - 1) setActive(0);
  }, [active, count]);
  useEffect(() => setBack(false), [active]);

  const measure = () => {
    const list = listRef.current;
    if (!list) return;
    setEdges({
      start: list.scrollLeft <= 1,
      end: list.scrollLeft + list.clientWidth >= list.scrollWidth - 1,
    });
  };
  useEffect(() => {
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return undefined;
    const watcher = new ResizeObserver(measure);
    watcher.observe(list);
    return () => watcher.disconnect();
  }, [count]);

  const slide = (direction) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy?.({ left: direction * list.clientWidth, behavior: "smooth" });
  };
  const pick = (index) => {
    setActive(index);
    /* Выбранный кадр виден в ленте целиком. */
    listRef.current?.children[index]?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  };
  const open3D = () => {
    if (current?.model) setModelIndex(Math.min(active, count - 1));
  };

  if (!current) return null;
  /* «3D» — только у кадра со своей моделью. У общего снимка пака её нет, и кнопки нет (владелец, 24.10.2026 ночью: «у самого
     ганпака 3D нет»); она остаётся у кадров стволов в ленте — у каждого своя модель. */
  const canModel = Boolean(current.model);
  return (
    <div className="mod-stage" data-count={count}>
      <div className={`mod-stage-view${video ? " is-video" : ""}`}>
        {clip ? (
          /* Ролик со звуком, сутки таймцикла, эффект — наш проигрыватель «как в YouTube» (`ClipStage` → `ui/ClipPlayer.jsx`): без штатных controls, качается по нажатию. */
          <ClipStage key={current.item.id} clip={current.item} />
        ) : youtube ? (
          /* Ролик YouTube — настоящий плеер в рамке, первым кадром галереи: человек смотрит прямо на карточке. Рамка
             стоит без `sandbox`-урезки, но только на домене без кук (`frame-src` окна). Запретил автор встраивание —
             кадр с картинкой ролика и своей кнопкой «Смотреть на YouTube» (`YoutubeStage`). */
          <YoutubeStage key={current.item.id} id={current.item.id} />
        ) : video ? (
          /* Ролик играет прямо на сцене: звук включается самим человеком. */
          <figure className="mod-card-frame mod-stage-video" title={clipCaption || undefined}>
            {view.renderMedia(current.item, "mod-stage-media", { stage: true })}
          </figure>
        ) : (
          <FrameTile
            item={side ? { ...current.item, src: side.src, caption: side.caption || current.item.caption } : current.item}
            index={active}
            view={view}
            onOpen={() => onOpen(active)}
          />
        )}
        {current.part && current.name && !current.bare && (
          /* Название части — на самом кадре, чтобы было видно, чья это часть (владелец, 25.10.2026). У таймцикла и частей-эффектов кадр без подписи
             (28.10.2026): их название — на плитке ленты. */
          <span className="mod-stage-part-name">{current.name}</span>
        )}
        {current.item.back && !video && (
          <button type="button" className="mod-stage-side" aria-pressed={back} onClick={() => setBack((value) => !value)}>
            {back ? tr("Спереди") : tr("Сзади")}
          </button>
        )}
        {canModel && (
          <button
            type="button"
            className="mod-stage-3d"
            aria-haspopup="dialog"
            aria-label={tr("Показать модель в 3D")}
            title={tr("Показать модель в 3D")}
            onClick={open3D}
          >
            <Cube aria-hidden="true" />
            <span>3D</span>
          </button>
        )}
        {canPreviewMod(view.mod) && (
          /* У мода «Миникарта», «Таймцикл» или «Прицел» — живой предпросмотр на весь экран из его файлов, а не галерея картинок. */
          <button
            type="button"
            className="mod-stage-3d"
            aria-haspopup="dialog"
            title={tr("Предпросмотр")}
            onClick={() => setPreviewing(true)}
          >
            <ArrowsOut aria-hidden="true" />
            <span>{tr("Предпросмотр")}</span>
          </button>
        )}
      </div>
      {count > 0 && (
        <div
          className="mod-stage-strip"
          role="group"
          aria-label={view.cardCopy.frames}
        >
          {count > STAGE_VISIBLE && (
            <button
              type="button"
              className="mod-stage-arrow is-left"
              aria-label={view.copy.previous}
              disabled={edges.start}
              onClick={() => slide(-1)}
            >
              <CaretLeft aria-hidden="true" />
            </button>
          )}
          <ul
            ref={listRef}
            className="mod-stage-thumbs"
            role="list"
            onScroll={measure}
          >
            {items.map((entry, index) => (
              <Thumb
                key={entry.key}
                entry={entry}
                index={index}
                active={index === active}
                view={view}
                cover={cover}
                onPick={pick}
              />
            ))}
          </ul>
          {count > STAGE_VISIBLE && (
            <button
              type="button"
              className="mod-stage-arrow is-right"
              aria-label={view.copy.next}
              disabled={edges.end}
              onClick={() => slide(1)}
            >
              <CaretRight aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {previewing && (
        <Suspense fallback={null}>
          <ModPreviewWindow mod={view.mod} language={view.language} onClose={() => setPreviewing(false)} />
        </Suspense>
      )}
      {modelEntry?.model && (
        <ModelWindow
          model={modelEntry.model}
          preview={modelEntry.item.src}
          name={modelEntry.name || view.mod.name}
          kind={kind}
          mod={kind === "clothing" ? view.mod : null}
          colour={onCover ? frameColour : pickedColour || frameColour}
          language={view.language}
          onClose={() => setModelIndex(null)}
        />
      )}
    </div>
  );
}
