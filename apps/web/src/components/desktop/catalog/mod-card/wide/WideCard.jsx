import "./mod-card-wide.css";
import "./card-gallery.css";
import {
  Fragment,
  Suspense,
  createContext,
  lazy,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { ImageSquare, PencilSimpleLine } from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import DetailTopbar from "../../../../ui/DetailTopbar.jsx";
import EditorSkeleton from "../../../../ui/EditorSkeleton.jsx";
import Skeleton from "../../../../ui/Skeleton.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import {
  isCatalogBundle,
  variantSiblings,
} from "../../../../../catalog-utils.js";
import { cardProjectsOf } from "../../../../../features/catalog/card-projects.js";
import { cardWideCopy } from "../../../../../features/catalog/card-wide-copy.js";
import { packBrowseCopy } from "../../../../../features/catalog/pack-browse-copy.js";
import { useCatalogFavorites } from "../../../../../features/catalog/use-catalog-favorites.js";
import {
  hasPartPackage,
  partWorkshopKind,
} from "../../../../../features/catalog/part-workshop.js";
import { useComponentChoice } from "../../../../../features/catalog/bundles/component-actions.js";
import { modEditor } from "../../../../../features/catalog/mod-editor.js";
import { isReduxPack } from "../../../../../features/catalog/redux-gallery.js";
import { isCatalogWork } from "../../../../../features/workshop/works/catalog-work.js";
import { canPreviewMod } from "../../../../../features/catalog/preview/preview-entry.js";
import { soundWeaponRows } from "../../../../../features/catalog/sound-rows.js";
import { humanFailure } from "../../../../../utils/installFailure.js";
import {
  PLACED_ART_PX,
  pageThumbUrl,
} from "../../../../../utils/cover-thumb.js";
import { useSoundPlayer } from "../../../../../hooks/useSoundPlayer.js";
import ModShareLink from "../../ModShareLink.jsx";
import { modComponentsLabel } from "../../modActionCopy.js";
import ModSounds, { soundCopy } from "../../ModSounds.jsx";
import { bundleComponentTotal } from "../modCardFacts.js";
import { soundRowFacts } from "../sound-row-facts.js";
import { isClothingCard } from "../ModCardParts.jsx";
import ModelWindow from "../ModelWindow.jsx";
import ModComponents, { hasComponents } from "../ModComponents.jsx";
import ModPlaced from "../ModPlaced.jsx";
import ModVariantSwitch from "../ModVariantSwitch.jsx";
import { modColoursOf } from "../../../../../features/clothing/colour-mapping.js";
import ClothingColourPick from "../../../clothing/ClothingColourPick.jsx";
import { ActionNotes, ActionRow, ActionsProvider } from "./WideActions.jsx";
import CardFeed from "./CardFeed.jsx";
import CardGallery from "./CardGallery.jsx";
import CardHead from "./CardHead.jsx";
import { SideDrawer } from "./CardOverlay.jsx";
import { ImagePreview, PlayerPreview } from "./CardPlayers.jsx";
import { RowPlay, RowStudio } from "./WideRowButtons.jsx";
import { usePickReturn } from "../use-pick-return.js";
import { useFrameColour } from "./use-frame-colour.js";
import {
  WIDE_GUN,
  WIDE_PLAIN,
  WIDE_REDUX,
  WIDE_SOUND,
  gunScene,
  gunSelection,
  liveTargetOf,
  posterOf,
  previewTargetOf,
  serverVariants,
  soundSelection,
  stageIndexOf,
  toggledOff,
  weaponTiles,
} from "./wide-model.js";

/*
 * Страница мода — «карточки» (21.11.2026, макет владельца «Да, очень хорошо, делаем такой дизайн»); до этого — карточка «Пульт» с правой панелью. Одна раскладка на все виды модов.
 *
 *   сверху:  «←», путь и справа «Установить», карандаш (если он есть у этого мода), сердечко, корзина, «Скопировать ссылку»;
 *   галерея: большой кадр и край следующего, листается плавно (`CardGallery`); у сборок, редуксов и звуков первым стоит видео; нажатие на кадр — предпросмотр по виду мода;
 *   название и теги, одна строка об авторе (`CardHead`);
 *   разделитель и лента «Подборка модов» (`CardFeed`).
 *
 * Карандаш. У набора (сборка, редукс, ганпак, пак звуков) открывает панель справа «Состав»: части с тумблерами, «В редактор» там, где редактор часть умеет, внизу «Установить N из M».
 * У одиночного мода (одежда, прицел, эффекты, трассеры) ведёт сразу в редактор мастерской. Если мод редактором не поддерживается, карандаша нет вовсе.
 *
 * Предпросмотр (`openEntry`): ролик, YouTube и сутки играют в карточке; одежда — на персонаже в 3D; ствол — 3D-моделью; миникарта, прицел и таймцикл — живым окном; есть только картинка —
 * картинка. Внутри предпросмотр не листается; крестик — в правом углу карточки (`CardOverlay`).
 *
 * Данные и логика установки те же, что у «Пульта»: `view` страницы мода, `describePage`, `useModInstall`, `useBundleInstall`, `useComponentChoice` — меняется только то, где это стоит.
 */

const PreviewWindow = lazy(
  () => import("../../../../../features/catalog/preview/PreviewWindow.jsx"),
);
const WideComponents = lazy(() => import("./WideComponentsPanel.jsx"));
const ModPreviewWindow = lazy(
  () => import("../../../../../features/catalog/preview/ModPreviewWindow.jsx"),
);

const HIDDEN = { display: "none" };

/* ---------- карандаш: правка в мастерской ---------- */

export function EditButton({
  view,
  size = "sm",
  className = "xw-icon xw-tool",
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  // Вещь с несколькими расцветками: карандаш сперва спрашивает, какую править (владелец, 29.10.2026); с одной — ведёт сразу.
  const [picking, setPicking] = useState(false);
  const colours = useMemo(
    () =>
      isClothingCard(view.mod) ? modColoursOf(view.mod, view.language) : [],
    [view.mod, view.language],
  );
  if (!view.editor) return null;
  const edit = async (colour = "") => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      await view.onEdit(typeof colour === "string" ? colour : "");
    } catch (error) {
      setFailure(
        humanFailure(error, view.language) || String(error?.message || ""),
      );
    } finally {
      setBusy(false);
    }
  };
  const hint =
    view.cardCopy.editor[view.editor.copyKey || view.editor.kind]?.hint ||
    view.cardCopy.edit;
  return (
    <>
      <Button
        variant="secondary"
        size={size}
        className={className}
        icon={<PencilSimpleLine />}
        ariaLabel={view.cardCopy.edit}
        title={hint}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={colours.length > 1 ? () => setPicking(true) : () => edit()}
      />
      {picking && (
        <ClothingColourPick
          mod={view.mod}
          colours={colours}
          onClose={() => setPicking(false)}
          onPick={(letter) => {
            setPicking(false);
            void edit(letter);
          }}
        />
      )}
      {failure && (
        <span className="xw-tool-failure" role="alert">
          {failure}
        </span>
      )}
    </>
  );
}

function ComponentsFallback() {
  return (
    <section className="xw-card xw-components is-loading" aria-hidden="true">
      <Skeleton className="xw-components-skeleton" />
    </section>
  );
}

/* ---------- кадры сцены ---------- */

// Кадры, которые рисует галерея: свои, а у таймцикла без ролика — лист суток.
function useSceneItems({ kind, page }) {
  return useMemo(() => {
    const own =
      kind === WIDE_GUN
        ? gunScene({
            shelf: page.shelf,
            stageItems: page.stageItems,
            cover: page.headCover,
          })
        : page.stageItems;
    const clipFirst = own.find((entry) => entry.item.type === "clip");
    /* Таймцикл и эффекты: сразу ролик, кадров-скриншотов рядом нет (владелец, 15.11.2026). */
    const shots = page.motionOnly && clipFirst ? [clipFirst] : own;
    if (shots.length > 0) return shots;
    if (page.sky)
      return [
        {
          key: `sky:${page.sky.url}`,
          item: { type: "sky", src: page.sky.url, cycle: page.sky },
          name: "",
          model: "",
        },
      ];
    // Без кадров в галерее стоит обложка.
    if (page.headCover)
      return [
        {
          key: `cover:${page.headCover}`,
          item: { type: "image", src: page.headCover },
          name: "",
          model: "",
        },
      ];
    return [];
  }, [kind, page]);
}

const PLAYED = new Set(["clip", "youtube", "video", "sky"]);

// Подпись ролика — та же, что у него в предпросмотре: сутки таймцикла, очередь карабина или ролик со звуком.
const clipName = (item) =>
  item.effect
    ? tr("Стрельба из карабина")
    : item.silent
      ? tr("Сутки таймцикла")
      : tr("Ролик со звуком");

/* ---------- панель «Состав» ---------- */

// Выбор компонентов сборки живёт на карточке, а не в панели: закрытая панель не должна терять слежение за ходом очереди (`ModComponents`).
const ChoiceContext = createContext(null);

function ChoiceHost({ view, onReturn, children }) {
  const choice = useComponentChoice({
    bundle: view.mod,
    catalog: view.rails?.allMods || [],
    parts: view.parts,
  });
  /* Возврат из каталога («Взять из другого редукса») забирает страница, а не окно «Компоненты»: панель «Состав» закрыта, пока человек ходил в каталог, и окна на странице нет.
     Выбор применяется сразу, панель открывается на сборке, а слот запоминается — окно «Компоненты» встанет на его запись. */
  const [pickedSlot, setPickedSlot] = useState("");
  usePickReturn({
    view,
    choice,
    onReturn: (slot) => {
      setPickedSlot(slot);
      onReturn?.(slot);
    },
  });
  const inner = useMemo(
    () => ({ ...view, choice, pickedSlot }),
    [view, choice, pickedSlot],
  );
  return (
    <ChoiceContext.Provider value={inner}>{children}</ChoiceContext.Provider>
  );
}

// Слова панели по виду набора: заголовок и подпись.
function drawerWords(view, packKind) {
  if (packKind === WIDE_GUN)
    return {
      title: tr("Стволы пака"),
      hint: tr(
        "Ставьте все или только нужные; любой можно открыть в студии оружия",
      ),
    };
  if (packKind === WIDE_SOUND)
    return {
      title: tr("Звуки пака"),
      hint: tr(
        "Ставьте все звуки или только нужные; любой можно открыть в студии звука",
      ),
    };
  return isReduxPack(view.mod)
    ? {
        title: tr("Состав редукса"),
        hint: tr("Что поставить, что заменить своим"),
      }
    : {
        title: tr("Состав сборки"),
        hint: tr("Оставьте нужное, остальное замените или выключите"),
      };
}

// Окно «Компоненты» (3D, версии, полный список) — значок в шапке панели «Состав»; у сборки оно видит тот же выбор, что и панель (`ChoiceContext`). Замена и правка части — кнопка «Изменить» в её строке.
function DrawerComponents({ view }) {
  const inner = useContext(ChoiceContext) ?? view;
  return <ModComponents view={inner} size="sm" reopen={false} />;
}

function DrawerBody({
  view,
  packKind,
  shown,
  selection,
  actions,
  onCounts,
  onEntries,
}) {
  const inner = useContext(ChoiceContext) ?? view;
  const { items, current, onShow, onPreview } = shown;
  if (packKind === WIDE_GUN)
    return (
      <Suspense fallback={<ComponentsFallback />}>
        <WideComponents
          kind={WIDE_GUN}
          view={view}
          selection={selection}
          items={items}
          current={current}
          onToggleGun={actions.toggleGun}
          onShow={onShow}
          pen={(row, title) =>
            view.parts.edit && modEditor(row.mod) ? (
              <RowStudio
                tip={title}
                onClick={() =>
                  view.parts.edit(row.mod, { pick: `weapon:${row.id}` })
                }
              />
            ) : null
          }
        />
      </Suspense>
    );
  if (packKind === WIDE_SOUND)
    return (
      <Suspense fallback={<ComponentsFallback />}>
        <WideComponents
          kind={WIDE_SOUND}
          view={view}
          selection={selection}
          items={items}
          current=""
          onToggle={actions.toggleSound}
          onShow={onShow}
          play={actions.play}
          pen={(item) =>
            view.parts.edit && modEditor(item.part) ? (
              <RowStudio
                tip={tr("Откроется студия звука на этом оружии")}
                onClick={() =>
                  view.parts.edit(
                    item.part,
                    item.weapon ? { weapon: item.weapon.id } : undefined,
                  )
                }
              />
            ) : null
          }
        />
      </Suspense>
    );
  return (
    <Suspense fallback={<ComponentsFallback />}>
      <WideComponents
        kind={WIDE_REDUX}
        view={inner}
        items={items}
        current={current}
        onShow={onShow}
        onPreview={onPreview}
        onCounts={onCounts}
        onEntries={onEntries}
      />
    </Suspense>
  );
}

/* ---------- карточка ---------- */

export default function WideCard({ view, page, kind, opening, pageRef }) {
  useTr();
  const copy = cardWideCopy(view.language);
  const items = useSceneItems({ kind, page });
  /* После «назад» из редактора выбранный ствол тот же, а не первый кадр (`editor-return.js`: выбор запоминается вместе с прокруткой). */
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      items.findIndex((entry) => entry.key === view.returnPick),
    ),
  );
  // Что открыто поверх страницы: панель «Состав», ролик или картинка в предпросмотре и окна готовых предпросмотров.
  const [drawer, setDrawer] = useState(false);
  const [layer, setLayer] = useState(null);
  const [model, setModel] = useState(null);
  const [person, setPerson] = useState(false);
  const [preview, setPreview] = useState(null);
  // Сколько частей сборки включено из скольких (приезжает из панели «Состав»): «Установить 7 из 8» в шапке и внизу панели.
  const [counts, setCounts] = useState(null);
  const entriesRef = useRef([]);
  const [modPreview, setModPreview] = useState(null);
  const [off, setOff] = useState(() => new Set());
  const [offSounds, setOffSounds] = useState(() => new Set());
  const [favorites, toggleFavorite] = useCatalogFavorites();
  const { playing, play } = useSoundPlayer(`pult-sounds:${view.mod.id}`);

  const tiles = useMemo(() => weaponTiles(page.contents), [page.contents]);
  const selection = useMemo(
    () => gunSelection(tiles, off, hasPartPackage),
    [tiles, off],
  );
  const trackCopy = soundCopy(view.language);
  const soundEntries = useMemo(
    () =>
      kind === WIDE_SOUND
        ? soundWeaponRows(page.contents).map((item) => ({
            id: item.key,
            item,
            facts: soundRowFacts(item, view, trackCopy, ""),
          }))
        : [],
    [kind, page.contents, view, trackCopy],
  );
  const soundSel = useMemo(
    () => soundSelection(soundEntries, offSounds),
    [soundEntries, offSounds],
  );
  const current = items[Math.min(active, items.length - 1)] ?? null;
  const frameColour = useFrameColour({
    mod: view.mod,
    current,
    cover: page.headCover,
    enabled: Boolean(page.clothing),
  });
  const like = {
    on: favorites.has(view.mod.id),
    toggle: () => toggleFavorite(view.mod.id),
  };

  const variants = useMemo(
    () => variantSiblings(view.mod, view.rails?.allMods ?? []),
    [view.mod, view.rails],
  );
  const servers = useMemo(
    () => serverVariants(variants, (variant) => cardProjectsOf(variant)),
    [variants],
  );
  const choice = view.plan.variantChoice;
  // Остальные версии (серые таймциклы и т. п.) — компактный выбор под тегами; версии по серверам стоят тегами-переключателями.
  const variantSwitch =
    choice && !servers ? <ModVariantSwitch view={view} /> : null;

  /* ---------- предпросмотр по виду мода ---------- */

  /* Что открывает нажатие на кадр: ролик, YouTube и сутки играют в карточке; одежда — на персонаже (если у вещи есть модель); мод с живым видом (миникарта, прицел, таймцикл) — он; ствол с
     моделью — 3D; часть редукса с видом — её окно; остальное — картинка. */
  const previewFor = (entry) => {
    if (!entry) return { type: "image" };
    if (PLAYED.has(entry.item.type)) return { type: "player" };
    if (page.clothing)
      return page.frameModel ? { type: "person" } : { type: "image" };
    const target =
      kind === WIDE_PLAIN && canPreviewMod(view.mod)
        ? { type: "mod" }
        : previewTargetOf({
            kind,
            current: entry,
            contents: page.contents,
            kindOfPart: partWorkshopKind,
          });
    return liveTargetOf({ current: entry, target }) ?? { type: "image" };
  };
  const badgeOf = (entry) => {
    const { item } = entry;
    if (item.type === "clip") return { play: true, label: clipName(item) };
    if (item.type === "youtube")
      return { play: true, label: tr("Обзор на YouTube") };
    if (item.type === "video")
      return { play: true, label: view.cardCopy.watchVideo };
    if (item.type === "sky")
      return { play: false, label: tr("Сутки таймцикла") };
    const found = previewFor(entry);
    if (found.type === "model")
      return { play: false, label: tr("3D-предпросмотр") };
    if (found.type === "person")
      return { play: false, label: tr("Примерка на персонаже") };
    if (found.type === "mod" || found.type === "part")
      return { play: false, live: true, label: tr("Живой предпросмотр") };
    return null;
  };
  const openEntry = (entry) => {
    const found = previewFor(entry);
    const poster = posterOf(entry?.item, page.headCover);
    if (found.type === "player") setLayer({ type: "player", entry });
    else if (found.type === "person") setPerson(true);
    else if (found.type === "mod") setModPreview({ poster });
    else if (found.type === "model")
      setModel({
        model: found.model,
        name: found.name || view.mod.name,
        preview: entry?.item?.src || "",
      });
    else if (found.type === "part") setPreview({ ...found, poster });
    else setLayer({ type: "image", entry });
  };
  const openAt = (index) => openEntry(items[index]);

  // Строка панели «Состав» показывает свой кадр: его предпросмотр открывается поверх панели; часть редукса без кадра, но с видом, открывает окно вида.
  const showComponent = (id) => {
    const index = stageIndexOf(items, id);
    if (index < 0) return;
    setActive(index);
    openAt(index);
  };
  const previewOf = (id) =>
    previewTargetOf({
      kind: WIDE_REDUX,
      current: { key: `part:${id}` },
      contents: page.contents,
      kindOfPart: partWorkshopKind,
    });
  const previewComponent = {
    can: (id) => Boolean(previewOf(id)),
    open: (id) => {
      const wanted = previewOf(id);
      if (!wanted) return;
      const own = items[stageIndexOf(items, id)];
      setPreview({
        ...wanted,
        poster: posterOf(own?.item, page.headCover),
      });
    },
  };

  /* ---------- слова тегов ---------- */

  const soundSummary = () => {
    const words = packBrowseCopy(view.language);
    const weapons = new Set(
      soundEntries.map((entry) => entry.item.weapon?.id).filter(Boolean),
    ).size;
    return [words.sounds(soundSel.total), weapons ? words.weapons(weapons) : ""]
      .filter(Boolean)
      .join(" · ");
  };
  const plainSummary = () => {
    if (page.sky || page.dayClip) return tr("сутки");
    if (page.motionOnly && current?.item.type === "clip") return tr("ролик");
    return "";
  };
  const kicker =
    kind === WIDE_GUN
      ? tr("Ганпак")
      : kind === WIDE_REDUX
        ? tr("Редукс")
        : view.kicker;
  const summary =
    kind === WIDE_GUN
      ? copy.weapons(selection.total)
      : kind === WIDE_REDUX
        ? modComponentsLabel(
            bundleComponentTotal(view.mod, page.contents),
            view.language,
          )
        : kind === WIDE_SOUND
          ? soundSummary()
          : plainSummary();
  const title = page.shownName;

  /* ---------- карандаш ---------- */

  /* Набор — то, что собрано из частей: сборка каталога и редукс (части с тумблерами и заменой), ганпак (стволы), пак звуков. У остальных карандаш — сразу правка в мастерской. */
  const bundled = kind === WIDE_REDUX || isCatalogBundle(view.mod);
  const packKind = bundled
    ? hasComponents(view)
      ? WIDE_REDUX
      : null
    : kind === WIDE_GUN || kind === WIDE_SOUND
      ? kind
      : null;
  const packSelection =
    packKind === WIDE_GUN
      ? selection
      : packKind === WIDE_SOUND
        ? soundSel
        : null;
  const toggleSound = (facts) => () => {
    play(facts.url, facts.url, { burst: facts.burst }).catch(() => {});
  };
  const pencil = packKind ? (
    <Button
      variant="secondary"
      size="sm"
      className="xw-icon xw-tool"
      icon={<PencilSimpleLine />}
      ariaLabel={tr("Изменить состав")}
      title={tr("Изменить состав")}
      aria-haspopup="dialog"
      aria-expanded={drawer}
      onClick={() => setDrawer(true)}
    />
  ) : hasComponents(view) ? (
    <ModComponents view={view} size="sm" reopen={false} pencil />
  ) : (
    <EditButton view={view} />
  );

  /* «Как было»: у ганпака и звуков — все отмеченные снова; у сборки — включить выключенные части (замены остаются: их возвращает «Вернуть родную часть» в строке). */
  const resettable =
    packKind === WIDE_REDUX
      ? Boolean(counts && counts.marked < counts.total)
      : (packKind === WIDE_GUN || packKind === WIDE_SOUND) &&
        packSelection.toggles &&
        !packSelection.all;
  const reset = () => {
    setOff(new Set());
    setOffSounds(new Set());
    if (packKind === WIDE_REDUX)
      for (const entry of entriesRef.current)
        if (entry.check && !entry.check.checked) entry.check.onChange(true);
  };
  const words = packKind ? drawerWords(view, packKind) : null;
  // У сборки с выключенными частями кнопка говорит, сколько встанет: «Установить 7 из 8» (выключенные при установке пропускаются).
  const countCaption =
    packKind === WIDE_REDUX &&
    counts &&
    counts.marked > 0 &&
    counts.marked < counts.total
      ? copy.installSome(counts.marked, counts.total)
      : "";

  const crumbs = [view.returnLabel, view.kicker].filter(Boolean).join(" · ");
  const body = (
    <>
      {opening && (
        <EditorSkeleton title={opening.title} label={opening.label} />
      )}
      <div
        ref={pageRef}
        className={`desktop-page catalog-product-page mod-wide${view.mediaClasses}`}
        style={opening ? HIDDEN : undefined}
        data-kind={kind}
        data-clothing={isClothingCard(view.mod) || undefined}
      >
        <DetailTopbar
          className="xw-topbar"
          backLabel={view.returnLabel}
          backIconOnly
          onBack={view.onBack}
          trail={
            crumbs ? (
              <span className="xw-crumbs" data-audit-ignore="caps">
                {crumbs}
              </span>
            ) : null
          }
          actions={
            <ActionRow
              layout="bar"
              like={like}
              caption={countCaption}
              lead={pencil}
              tail={
                <ModShareLink modId={view.mod.id} copy={view.copy} compact />
              }
            />
          }
        />
        <ActionNotes className="xw-notes-bar" />
        {items.length > 0 ? (
          <CardGallery
            view={view}
            items={items}
            active={active}
            onActive={setActive}
            onOpen={openAt}
            badgeOf={badgeOf}
            cover={page.headCover}
          />
        ) : (
          <div
            className="xw-gallery is-empty"
            role="img"
            aria-label={view.copy.noMedia}
          >
            <ImageSquare aria-hidden="true" />
          </div>
        )}
        <CardHead
          view={view}
          servers={servers}
          kicker={kicker}
          summary={summary}
          title={title}
          sizeTag={
            isCatalogWork(view.mod)
              ? {
                  text: `${view.actionCopy.workFiles}: ${view.actionCopy.workFilesValue}`,
                  note: view.actionCopy.workFilesNote,
                }
              : null
          }
          extra={
            <>
              {variantSwitch}
              <ModPlaced
                placed={view.placed}
                cover={pageThumbUrl(page.headCover, PLACED_ART_PX)}
              />
              {/* Звуки самого мода (не пака): список дорожек с волной под названием. */}
              {!view.contents?.[0]?.sound && (
                <ModSounds
                  mod={view.mod}
                  language={view.language}
                  id="mod-detail-sounds"
                />
              )}
            </>
          }
        />
        <CardFeed view={view} />
        {drawer && packKind && (
          <SideDrawer
            label={words.title}
            title={words.title}
            hint={words.hint}
            extra={<DrawerComponents view={view} />}
            onClose={() => setDrawer(false)}
            footer={
              <>
                {resettable && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="xw-reset"
                    onClick={reset}
                  >
                    {tr("Как было")}
                  </Button>
                )}
                <ActionRow layout="footer" caption={countCaption} />
              </>
            }
          >
            <DrawerBody
              view={view}
              packKind={packKind}
              selection={packSelection}
              onEntries={(entries) => {
                entriesRef.current = entries;
              }}
              onCounts={(next) =>
                setCounts((prev) =>
                  prev &&
                  prev.total === next.total &&
                  prev.marked === next.marked
                    ? prev
                    : next,
                )
              }
              shown={{
                items,
                current: current?.key,
                onShow: showComponent,
                onPreview: previewComponent,
              }}
              actions={{
                toggleGun: (id, on) =>
                  setOff((value) => toggledOff(value, id, on)),
                toggleSound: (id, on) =>
                  setOffSounds((value) => toggledOff(value, id, on)),
                play: (facts) => (
                  <RowPlay
                    on={facts.url === playing}
                    label={
                      facts.url === playing
                        ? soundCopy(view.language).stop
                        : soundCopy(view.language).play
                    }
                    onToggle={toggleSound(facts)}
                  />
                ),
              }}
            />
          </SideDrawer>
        )}
        {layer?.type === "image" && (
          <ImagePreview
            view={view}
            entry={layer.entry}
            onClose={() => setLayer(null)}
          />
        )}
        {layer?.type === "player" && (
          <PlayerPreview
            view={view}
            entry={layer.entry}
            page={page}
            onClose={() => setLayer(null)}
          />
        )}
        {person && page.frameModel && (
          <ModelWindow
            model={page.frameModel}
            preview={current?.item?.src || page.headCover}
            name={view.mod.name}
            kind="clothing"
            language={view.language}
            mod={view.mod}
            colour={frameColour}
            onClose={() => setPerson(false)}
          />
        )}
        {model && (
          <ModelWindow
            model={model.model}
            preview={model.preview}
            name={model.name}
            kind="weapon"
            language={view.language}
            onClose={() => setModel(null)}
          />
        )}
        {modPreview && (
          <Suspense fallback={null}>
            <ModPreviewWindow
              mod={view.mod}
              language={view.language}
              poster={modPreview.poster}
              onClose={() => setModPreview(null)}
            />
          </Suspense>
        )}
        {preview && (
          <Suspense fallback={null}>
            <PreviewWindow
              title={view.mod.name}
              kind={preview.kind}
              part={preview.part}
              language={view.language}
              poster={preview.poster}
              onClose={() => setPreview(null)}
            />
          </Suspense>
        )}
        <Fragment>{view.dialogs}</Fragment>
      </div>
    </>
  );

  const hosted = bundled ? (
    <ChoiceHost view={view} onReturn={() => setDrawer(true)}>
      {body}
    </ChoiceHost>
  ) : (
    body
  );
  return (
    <ActionsProvider view={view} kind={kind} selection={packSelection}>
      {hosted}
    </ActionsProvider>
  );
}
