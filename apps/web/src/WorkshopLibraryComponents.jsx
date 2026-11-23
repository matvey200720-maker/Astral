import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  Check,
  CircleDashed,
  DownloadSimple,
  Image,
  MagnifyingGlass,
  Package,
  PencilSimple,
  Trash,
} from "./components/ui/icons.jsx";
import { WorkshopSlotArtwork } from "./WorkshopSlotArtwork.jsx";
import { WorkshopImage } from "./WorkshopMedia.jsx";
import { shelfTile } from "./utils/tile-thumb.js";
import Button from "./components/ui/Button.jsx";
import MediaCard from "./components/ui/MediaCard.jsx";
import { PhotoSkeleton, skeletonDelay } from "./components/ui/Skeleton.jsx";
import EmptyState from "./components/ui/EmptyState.jsx";
import PageTabs from "./components/ui/PageTabs.jsx";
import { useQueueProgress } from "./features/downloads/live-progress.js";
import { requestDownloadsPanel } from "./features/downloads/open-requests.js";
import { installButtonCopy } from "./features/downloads/install-button-copy.js";
import { failureWords } from "./utils/installFailure.js";
import { tr, useTr } from "./locales/ui.js";

/*
 * Кнопка установки в шапке галереи слота (задача 1 ТЗ 08.10, вечер): ход —
 * на самой кнопке, проценты — из склада хода (перерисовывается кнопка, а не
 * галерея), нажатие на занятую открывает «Загрузки», отказ — «Повторить» и
 * причина под кнопкой.
 */
function GalleryInstallButton({
  activeOperation,
  installed,
  vanillaActive,
  disabled,
  installLabel,
  installedLabel,
  removeLabel,
  locale,
  onInstall,
}) {
  const live = useQueueProgress(activeOperation?.queueId || "");
  const words = installButtonCopy(locale);
  const failure = activeOperation?.failed || null;
  const busy = Boolean(activeOperation) && !failure;
  const removing = activeOperation?.operation === "remove";
  const progress = Math.round(
    Math.min(99, Number(live?.progress ?? activeOperation?.progress) || 0),
  );
  /* Ждёт своей очереди: ещё не взялась и хода нет. */
  const queued = busy && !activeOperation.started && !(progress > 0);
  const reason = failure ? failureWords(failure, locale) : null;
  return (
    <span className="astral-gallery-install">
      <Button
        className={joinClassNames(
          "astral-gallery-install-button",
          installed && !activeOperation && "is-remove",
          vanillaActive && !activeOperation && "is-installed",
          busy && "is-active",
          failure && "is-failed",
        )}
        variant={installed && !activeOperation ? "danger" : "primary"}
        size="lg"
        progress={busy ? (queued ? 0 : progress) : null}
        caption={busy ? (queued ? words.queued : `${progress}%`) : null}
        icon={
          failure ? (
            <ArrowClockwise />
          ) : vanillaActive && !activeOperation ? (
            <Check />
          ) : installed && !activeOperation ? (
            <Trash />
          ) : (
            <DownloadSimple />
          )
        }
        disabled={disabled || (vanillaActive && !activeOperation)}
        title={busy ? words.details : undefined}
        aria-busy={busy || undefined}
        onClick={busy ? () => requestDownloadsPanel() : onInstall}
      >
        {busy
          ? removing
            ? words.removing
            : words.installing
          : failure
            ? words.retry
            : vanillaActive
              ? installedLabel
              : installed
                ? removeLabel
                : installLabel}
      </Button>
      {reason && (
        <span className="astral-gallery-install-failure" role="alert">
          <b>{words.failed}</b> {reason.reason}
        </span>
      )}
    </span>
  );
}

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

/*
 * Знак «снимка нет».
 *
 * Крестом это было ровно до тех пор, пока кто-нибудь не посмотрел на экран
 * глазами человека: крест — знак отказа и сломанной картинки, а здесь речь про
 * пустое место и про «как в игре». Пунктирный круг говорит то же самое, не
 * пугая.
 */
export function WorkshopEmptyMark({
  className = "",
  icon = "image",
  note = "",
}) {
  const EmptyIcon = icon === "cross" ? CircleDashed : Image;

  return (
    <span
      className={joinClassNames("workshop-empty-mark", className)}
      data-empty-mark={icon}
      aria-hidden={note ? undefined : "true"}
    >
      <span>
        <EmptyIcon />
      </span>
      {/* Кадра нет по причине — она написана, а не спрятана за значком. */}
      {note && <small className="workshop-empty-note">{note}</small>}
    </span>
  );
}

/*
 * Знак статуса на карточке.
 *
 * «Установлено» было плашкой со словом: она занимала пол-угла кадра, закрывала
 * обложку и повторяла то, что зелёная галочка говорит без слов. Теперь то, что
 * стоит в игре, отмечено круглой галочкой в углу — одинаково на полке
 * мастерской, в библиотеке и в «Моих работах». Слово осталось подписью для
 * читалки экрана и подсказкой под курсором.
 *
 * Остальные статусы (черновик в «Моих работах») галочкой не скажешь — они
 * остаются плашкой со словом.
 */
/*
 * Отметка «в игре» на превью-карточках убрана (владелец, 24.10.2026, п. 2: «галочки в левом верхнем углу каждой превьюшки —
 * не отображать»): на карточке полки, работы и оружия или одежды остаётся только слово-плашка («Не в игре»). Факт «в игре»
 * человек слышит читалкой экрана (`aria-description` на карточке) и видит в списке; на строке сборки (`LibraryBundleRows`)
 * галочка стоит как стояла — это строка списка, а не превью.
 */
export const tileStatus = (status) => (status === "installed" ? null : status);

export function WorkshopCardStatus({ status = null, label = "" }) {
  if (!status) return null;
  if (status !== "installed")
    return (
      <span className="workshop-card-status" data-status={status}>
        {label}
      </span>
    );
  return (
    <span
      className="workshop-card-status"
      data-status="installed"
      role="img"
      aria-label={label || undefined}
      title={label || undefined}
    >
      <Check weight="bold" aria-hidden="true" />
    </span>
  );
}

/*
 * The workshop's slot card is the shared MediaCard with the workshop's own
 * picture logic in front of it: a real preview when a slot is filled, a
 * representative still when it is empty, an artwork glyph for clothing slots.
 * The plate it sits on is no longer this file's business.
 *
 * `status` is the one fact the library exists to answer — is something in
 * the game for this slot or not — so it sits on the picture as a check mark
 * (`WorkshopCardStatus`) and not in the caption, where an installed mod's
 * name already lives. `kind`
 * tells an editor tile (a pencil in the corner) from a catalog card (an
 * arrow): the first opens a studio, the second a list of published mods.
 *
 * Сердечка на карточке больше нет (2026-09-15): в мастерской и библиотеке
 * лайкать нечего — там собирают и снимают, а избранное живёт в каталоге.
 */
export function WorkshopVisualSlotCard({
  className = "",
  preview,
  fallbackPreview,
  artworkKey,
  customPreview = false,
  tone = "blue",
  title,
  description,
  badge,
  meta,
  status = null,
  statusLabel = "",
  kind = null,
  emptyMark = "image",
  onClick,
  mediaIndex = 0,
  catalogTier = "featured",
  /* Готовая обложка вместо картинки: работа мастерской рисуется так, как
     стоит в игре (мини-карта со своими полосами), а не снимком слота. */
  mediaNode = null,
  /* Режим выбора корзины библиотеки: нажатие отмечает карточку. */
  selecting = false,
  selected = false,
  /* Карточка уходит из игры прямо сейчас: она гаснет и не нажимается, пока
     удаление не кончится. */
  removing = false,
  /* Рука идёт к карточке (наведение, фокус): то, что откроется по щелчку,
     можно начать грузить заранее. */
  onIntent = undefined,
}) {
  const media = mediaNode ? (
    mediaNode
  ) : !preview && artworkKey ? (
    <WorkshopSlotArtwork slotId={artworkKey} />
  ) : preview || fallbackPreview ? (
    <WorkshopImage
      className={joinClassNames(
        "redux-visual-image",
        customPreview && "has-custom-workshop-preview",
        !preview && fallbackPreview && "is-suggested-preview",
      )}
      src={preview || fallbackPreview}
      alt=""
      index={mediaIndex}
      tile={shelfTile}
    />
  ) : (
    <WorkshopEmptyMark icon={emptyMark} />
  );

  /* Орган полки (`ui-shelf-card`, 17.10.2026): кадр в чёрной рамке, подпись
     под ним. Кадр собран в свою рамку вместе с отметкой «в игре» и знаком
     действия — карандаш у редактора, стрелка у каталога; знак проявляется
     под рукой. Старые листы полки до кадра в рамке не дотягиваются: они
     брали картинку прямым потомком карточки. */
  const action = selecting ? null : kind === "editor" ? (
    <PencilSimple aria-hidden="true" />
  ) : (
    <ArrowRight aria-hidden="true" />
  );
  return (
    <MediaCard
      className={joinClassNames("ui-shelf-card", className)}
      data-workshop-tone={tone}
      data-catalog-tier={catalogTier}
      data-workshop-kind={kind || undefined}
      data-workshop-status={status || undefined}
      aria-description={status === "installed" ? statusLabel || undefined : undefined}
      media={
        <span className="ui-shelf-card-art">
          {media}
          <WorkshopCardStatus status={tileStatus(status)} label={statusLabel} />
          {action && <span className="ui-shelf-card-go">{action}</span>}
        </span>
      }
      shadeClassName="redux-visual-shade"
      copyClassName="workshop-card-copy ui-shelf-card-copy"
      title={title}
      description={description}
      editing={selecting}
      selected={selected}
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      disabled={removing || undefined}
      aria-busy={removing || undefined}
      data-library-removing={removing || undefined}
    >
      {(badge || meta) && (
        <span className="workshop-card-meta">
          {badge && <small>{badge}</small>}
          {meta && <small>{meta}</small>}
        </span>
      )}
    </MediaCard>
  );
}

/*
 * A shelf of the workshop library: a heading, one line on what stands on it
 * and the count of installed slots — the answer the library is opened for,
 * given before the eye reaches the cards.
 */
export function WorkshopLibraryGroup({ id, title, summary, headless = false, children }) {
  return (
    <section
      className="workshop-library-group"
      data-workshop-shelf={id}
      aria-label={title}
    >
      {/* `headless`: имя полки уже сказано заголовком страницы над вкладками (мастерская, ТЗ 24.10.2026, ночь, п. 3). */}
      {!headless && (
        <header className="workshop-library-group-heading">
          <div>
            <h2>{title}</h2>
            {summary && <p>{summary}</p>}
          </div>
        </header>
      )}
      {children}
    </section>
  );
}

/*
 * Пустая библиотека.
 *
 * Пустой раздел — не ошибка и не «ничего не найдено»: человек ещё ничего не
 * ставил. Поэтому здесь не лупа и не крест, а короткий ответ — что здесь
 * появится — и дорога туда, где это берут: мастерская и каталог.
 */
export function WorkshopLibraryEmpty({ title, text, actions = [] }) {
  return (
    <EmptyState
      icon={Package}
      title={title}
      text={text}
      actions={
        actions.length > 0
          ? actions.map((item) => (
              <Button
                key={item.id}
                variant={item.variant || "secondary"}
                icon={item.icon}
                onClick={item.onClick}
              >
                {item.label}
              </Button>
            ))
          : null
      }
    />
  );
}

export function WorkshopLandingSlotCard({
  className = "",
  preview,
  tone = "blue",
  title,
  description,
  onClick,
  mediaIndex = 0,
}) {
  return (
    <button
      type="button"
      className={className}
      data-workshop-tone={tone}
      onClick={onClick}
    >
      {preview ? (
        <WorkshopImage src={preview} alt="" index={mediaIndex} />
      ) : (
        <WorkshopEmptyMark />
      )}
      <div className="workshop-card-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <ArrowRight />
    </button>
  );
}

export function WorkshopWeaponSlotCard({
  className = "",
  preview,
  fallbackPreview,
  artworkKey,
  previewTreatment,
  previewExposure = 1,
  previewContrast = 0.94,
  tone = "blue",
  title,
  type,
  status = null,
  statusLabel = "",
  onClick,
  mediaIndex = 0,
  catalogTier = "featured",
  selecting = false,
  selected = false,
  removing = false,
  /* Что сказать, если кадр не загрузился (файла нет, адрес битый). */
  previewFailureNote = "",
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [preview]);
  return (
    <article
      className={className}
      data-workshop-tone={tone}
      data-catalog-tier={catalogTier}
      data-selected={selecting ? String(selected) : undefined}
      aria-description={status === "installed" ? statusLabel || undefined : undefined}
      data-library-removing={removing || undefined}
      aria-busy={removing || undefined}
      data-preview-treatment={previewTreatment || undefined}
      style={{
        "--weapon-preview-exposure": previewExposure,
        "--weapon-preview-contrast": previewContrast,
      }}
    >
      <button
        type="button"
        className="weapon-slot-open"
        aria-label={title}
        aria-pressed={selecting ? selected : undefined}
        disabled={removing || undefined}
        onClick={onClick}
      >
        {!preview && artworkKey ? (
          <WorkshopSlotArtwork slotId={artworkKey} />
        ) : preview && !failed ? (
          <WorkshopImage
            className="weapon-slot-image"
            src={preview}
            fallbackSrc={fallbackPreview}
            alt=""
            index={mediaIndex}
            onError={() => setFailed(true)}
          />
        ) : (
          <WorkshopEmptyMark note={failed ? previewFailureNote : ""} />
        )}
        <div className="weapon-slot-copy">
          <h3>{title}</h3>
          <span>{type}</span>
        </div>
        <ArrowRight className="workshop-card-arrow" aria-hidden="true" />
      </button>
      <WorkshopCardStatus status={tileStatus(status)} label={statusLabel} />
      {selecting && (
        <span className="library-card-check" aria-hidden="true">
          {selected && <Check />}
        </span>
      )}
    </article>
  );
}

/*
 * Разделы открытой карточки мастерской («Мини-карта», «Отдаление», «Положение»)
 * — та же полоса вкладок шапки, что разделы мастерской над ней (`PageTabs`,
 * 06.10.2026): прежние плашки в рамке были третьим видом вкладок на одном
 * экране. Стрелки и одна остановка таба — у органа (`role="tablist"`).
 */
export function WorkshopDetailTabs({
  items = [],
  activeId,
  ariaLabel = "Detail sections",
  onChange,
}) {
  if (items.length < 2) return null;
  return (
    <PageTabs
      className="workshop-detail-tabs"
      role="tablist"
      label={ariaLabel}
      value={activeId}
      onChange={onChange}
      options={items.map((item) => ({ value: item.id, label: item.label }))}
    />
  );
}

export function WorkshopVariantGallery({
  section,
  selectedSlot,
  detailGroupId,
  artworkKey,
  // eyebrow is still passed by callers and deliberately ignored — see below.
  eyebrow: _eyebrow,
  title,
  description,
  primaryVariant,
  downloads = 0,
  locale = "en",
  installLabel = "Install",
  installedLabel = "Installed",
  removeLabel = "Remove",
  installed = false,
  vanillaActive = false,
  activeOperation = null,
  heroMedia,
  variants,
  getCover,
  onCustomize,
  canCustomize = true,
  onInstall,
  onSelect,
  onPreload,
  onMediaLoad,
  onMediaError,
  searchValue = "",
  searchPlaceholder = "Search modifications",
  emptyLabel = "No matching modifications",
  onSearchChange,
}) {
  useTr();
  const visualSlotId = detailGroupId || selectedSlot;
  const isMapDetail = ["minimap", "large-map"].includes(visualSlotId);
  const isWorldMap = visualSlotId === "large-map";
  /* Подпись кнопки правки видна (17.10.2026), поэтому — на всех пяти
     языках через словарь, а не «ru или английский». */
  const customizeLabel = tr("Редактировать");

  /*
   * Редизайн 17.10.2026 (владелец показал «Футболки» снимком: «какая-то
   * левая херня»): вместо липкого героя на полэкрана с огромным чёрным
   * значком на чёрном — та же раскладка, что у страницы мода. Выбранный
   * вариант крупно слева, панель с именем, описанием и кнопками справа,
   * ниже поиск и варианты карточками витрины. Классы свои: прежние
   * `workshop-local-*` держали около восьмисот правил в пятнадцати листах.
   * Прокрутка обычная, без «складывающегося» героя.
   */
  return (
    <section
      className={joinClassNames(
        "astral-gallery",
        isMapDetail && "is-map-media",
        isWorldMap ? "is-world-map-media" : isMapDetail && "is-minimap-media",
        section === "redux" && !isMapDetail && "is-photo-media",
        ["gunpacks", "clothing"].includes(section) && "is-weapon-media",
        artworkKey && "is-artwork-media",
      )}
    >
      <div className="astral-gallery-top">
        <div className="astral-gallery-stage">{heroMedia}</div>
        <aside className="astral-gallery-panel">
          <h1>{title}</h1>
          {description && <p>{description}</p>}
          <div className="astral-gallery-actions">
            <GalleryInstallButton
              activeOperation={activeOperation}
              installed={installed}
              vanillaActive={vanillaActive}
              disabled={!primaryVariant}
              installLabel={installLabel}
              installedLabel={installedLabel}
              removeLabel={removeLabel}
              locale={locale}
              onInstall={onInstall}
            />
            {/* Кнопка правки стоит только там, где за ней есть редактор:
                у «Транспорта», «Анимаций» и прочих каталожных плиток его нет,
                и раньше она отвечала на нажатие красным отказом. */}
            {!primaryVariant?.isUserWork && canCustomize && (
              <Button
                className="astral-gallery-customize"
                variant="secondary"
                icon={<PencilSimple />}
                disabled={!primaryVariant}
                onClick={onCustomize}
                title={customizeLabel}
              >
                {customizeLabel}
              </Button>
            )}
          </div>
          {downloads > 0 && (
            <span className="astral-gallery-downloads">
              <DownloadSimple aria-hidden="true" />
              {downloads.toLocaleString(locale)}
            </span>
          )}
        </aside>
      </div>

      <div className="astral-gallery-tools">
        <label className="astral-gallery-search">
          <MagnifyingGlass aria-hidden="true" />
          <input
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </label>
      </div>

      <div className="astral-gallery-grid" data-screen-group="">
        {variants.map((variant, index) => {
          const selected = primaryVariant?.id === variant.id;
          const cover = getCover(variant);
          const vanillaUsesCross =
            variant.isVanilla && variant.catalogSection === "redux";
          return (
            <article
              className={joinClassNames(
                "astral-gallery-variant",
                selected && "is-selected",
              )}
              key={variant.id}
            >
              <button
                type="button"
                className="astral-gallery-variant-select"
                aria-pressed={selected}
                onClick={() => onSelect(variant)}
                onPointerEnter={() => onPreload(cover)}
                onFocus={() => onPreload(cover)}
              >
                <span
                  className={joinClassNames(
                    "astral-gallery-variant-art",
                    /\.svg(?:$|\?)/i.test(cover || "") && "is-glyph",
                  )}
                >
                  {/* Стандартный вариант — не отказ, а состояние «как в
                      игре»: крест здесь читался сломанной картинкой. */}
                  {vanillaUsesCross ? (
                    <span
                      className="astral-gallery-vanilla-card"
                      aria-hidden="true"
                    >
                      <CircleDashed />
                    </span>
                  ) : (
                    <>
                      {/* Серое место, пока вариант едет: плиты сетки идут волной (скелет, `docs/3D.md`, правило 22). */}
                      <PhotoSkeleton delay={skeletonDelay(index)} />
                      <WorkshopImage
                        src={cover}
                        alt={variant.name}
                        data-photo=""
                        index={index}
                        selected={selected}
                        onLoad={onMediaLoad}
                        onError={onMediaError}
                      />
                    </>
                  )}
                </span>
                <span className="astral-gallery-variant-name">
                  {variant.name}
                </span>
              </button>
            </article>
          );
        })}
        {!variants.length && (
          <EmptyState
            className="astral-gallery-empty"
            icon={MagnifyingGlass}
            size="panel"
            title={emptyLabel}
          />
        )}
      </div>
    </section>
  );
}
