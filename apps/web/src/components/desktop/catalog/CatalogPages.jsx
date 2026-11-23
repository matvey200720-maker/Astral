import { installedClothingItems } from "../../../features/workshop/install-queue/tasks/clothing-paint-slots.js";
import { readModFaces, rememberModFaces } from "../../../features/builds/mod-faces.js";
import {
  clothingLibraryCards,
  paintPairOf,
  useClothingPlacements,
} from "../../../features/library/clothing-placements.js";
import { engineModIds } from "../../../features/library/engine-ids.js";
import {
  installedWeaponItems,
  weaponSkinCards,
} from "../../../features/library/weapon-skin-items.js";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
/*
 * Utility chrome comes from Phosphor; the nine catalog sections are drawn for
 * this product in CatalogGlyphs.jsx, because a section vocabulary is content,
 * not chrome, and a stock set makes every launcher's catalog look alike.
 */
import {
  ArrowLeft,
  ArrowRight,
  Cube,
  DownloadSimple,
  FolderSimple,
  Heart,
  MagnifyingGlass,
  Package,
  Play,
  ShieldCheck,
  SquaresFour,
  Trash,
  Warning,
  Wrench,
} from "../../ui/icons.jsx";
import { getLibraryStatus } from "../../../api.js";
import {
  installedBundles,
  useBundleActions,
} from "../../../features/catalog/bundles/index.js";
import { isGunpackMod } from "./catalogSections.js";
import { isAuthorUnknown, modAuthor } from "../../../features/catalog/catalog-authors.js";
import { modelScaleOf, packGuns, packWithoutGun, rememberSize } from "../../../features/library/pack-card-model.js";
import { OPTIMIZER_ROW_ID } from "../../../features/library/optimization-units.js";
import { libraryGroups } from "../../../features/library/library-groups.js";
import { packProgress } from "../../../features/library/gunpack-state.js";
import { rpWordsKey, useRpWords } from "../../../features/library/useRpWords.js";
import {
  libraryOptimizationInstalled,
} from "../../../features/library/LibraryOptimization.jsx";
import {
  LIBRARY_TABS,
  presentLibraryTabs,
} from "../../../features/library/library-tabs.js";
import Button from "../../ui/Button.jsx";
import useHolds from "../../ui/useHolds.js";
import LibraryBundleRows from "../../../features/library/LibraryBundleRows.jsx";
import WaitingMods from "../../../features/library/WaitingMods.jsx";
import { isWaiting } from "../../../features/library/waiting-mods.js";
import { REDUX_EDITOR_SLOTS } from "./reduxEditorSlots.js";
import { SectionTitle } from "../SectionChrome.jsx";
import DetailTopbar from "../../ui/DetailTopbar.jsx";
import EditorSkeleton from "../../ui/EditorSkeleton.jsx";
import PageLoading from "../../ui/PageLoading.jsx";
import MenuButton from "../../ui/MenuButton.jsx";
import { modIsNew, newestFirst } from "../../../features/catalog/post-order.js";
import DesktopOverlayPortal from "../overlays/DesktopOverlayPortal.jsx";
import WorkshopHeroMedia from "./WorkshopHeroMedia.jsx";
import WorkshopToolbar from "../../../WorkshopToolbar.jsx";
import {
  ALL_PROJECTS,
  modFitsProject,
  useProject,
} from "../../../features/catalog/catalog-projects.js";
import {
  WorkshopDetailTabs,
  WorkshopLandingSlotCard,
  WorkshopLibraryEmpty,
  WorkshopLibraryGroup,
  WorkshopVariantGallery,
  WorkshopVisualSlotCard,
  WorkshopWeaponSlotCard,
} from "../../../WorkshopLibraryComponents.jsx";
import { useWorkshopDetailGallery } from "../../../useWorkshopDetailGallery.js";
import { isCatalogBundle } from "../../../catalog-utils.js";
import {
  workshopCopyFor,
  workshopLibraryDriftCopyFor,
  workshopToolbarCopyFor,
} from "../../../workshop-copy.js";
import {
  createWorkshopModIndex,
  resolveWorkshopVariant,
} from "../../../workshop-mod-index.js";
import {
  workshopPreviewFor,
  workshopToneFor,
} from "../../../workshop-visuals.js";
import {
  catalogLandingSlots,
  catalogSections,
  workshopWeaponSlots,
} from "../../../catalog-taxonomy.js";
import { lastWeaponSlot } from "../../../features/workshop/last-weapon-slot.js";
import {
  FEATURED_WEAPON_SLOT_IDS,
  resolveVisibleWeaponSlots,
  weaponPreviewContrastFor,
  weaponPreviewExposureFor,
  weaponPreviewTreatmentFor,
} from "../../../workshop-weapon-display.js";
import { splitWorkshopLibrarySlots } from "../../../workshop-redux-display.js";
import {
  marksFromUnits,
  readParkedWorkshopUnits,
  readWorkshopInstallUnits,
  reconcileWorkshopInstallRecords,
} from "../../../workshop-library.js";
import { coveredWords } from "../../../features/library/covered-words.js";
import { useLibrarySelection } from "../../../features/library/LibraryRemoval.jsx";
import { useLibraryShelfRemoval } from "../../../features/library/useLibraryShelfRemoval.jsx";
import InstalledPreview from "../../../features/workshop/covers/InstalledPreview.jsx";
import { renderSlotCover, renderStockCover, slotCoverSpec } from "../../../features/workshop/covers/slot-cover.jsx";
import { shelfWeaponIcon } from "../../../features/workshop/weapon-shelf-icon.js";
import { useGameWeaponIcons } from "../workshop/gun/useGameWeaponIcons.js";
import { libraryRootSlots } from "../../../features/library/library-sound-slots.js";
import LibraryWorkCard from "../../../features/library/LibraryWorkCard.jsx";
/* Полка библиотеки и карточка ганпака — в куске самой страницы, а не отдельным: первый вход в библиотеку не ждёт второго куска (15.11.2026, `docs/beta/incident-2026-11-15-library-editor-loader.md`). */
import LibraryShelves from "../../../features/library/LibraryShelves.jsx";
import LibraryPackCard from "../../../features/library/LibraryPackCard.jsx";
import { modPicture } from "../../../features/library/mod-picture.js";
import { soundLibraryCards } from "../../../features/library/sound-mods.js";
import { effectsLibraryCards } from "../../../features/library/effects-mods.js";
import {
  isReduxRootSlotId,
  reduxDetailSlotIdsFor,
  reduxDetailSlotsFor,
  reduxGroupIdFor,
  resolveReduxDetailSlotId,
} from "../../../workshop-redux-subcategories.js";
import { createReduxVanillaVariant } from "../../../workshop-redux-vanilla.js";
import {
  clothingPreviewContrastFor,
  clothingPreviewExposureFor,
} from "../../../workshop-clothing-display.js";
import {
  catalogMediaPresentation,
  coverFor,
} from "../../../utils/catalogMedia.js";
import { clothingCatalogItems } from "../workshop/gun/clothing-models.js";
import { wearSlotMods } from "../../../features/catalog/clothing-sections.js";
import { useCatalogDisclosure } from "../../../features/workshop/useCatalogDisclosure.js";
import { useWorkshopState } from "../../../features/workshop/useWorkshopState.js";
import { hasWorkOpenRequest } from "../../../features/workshop/works/work-open-request.js";
import { listWorkshopWorks } from "../../../features/workshop/works/workshop-works.js";
import { WorkshopImage } from "../../../WorkshopMedia.jsx";
import { shelfTile } from "../../../utils/tile-thumb.js";
import WorkshopPoster from "../../../features/workshop/poster/WorkshopPoster.jsx";
import EditorSearch from "../../../features/workshop/poster/EditorSearch.jsx";
import { useWorkshopDoneRevision } from "../../../features/library/useWorkshopDoneRevision.js";
import {
  useRememberedScroll,
  useRememberedState,
} from "../../../section-memory.js";
/*
 * Трёхмерный просмотр оружия — единственный статический путь из точки входа в
 * three.js, и из-за него движок качался и разбирался при СТАРТЕ приложения: 798
 * КБ (206 КБ в сжатии) у каждого, кто ни одного трёхмерного вида не открыл.
 * Граница ожидания под него уже стоит — `React.Suspense` с плашкой «Посмотреть
 * в 3D», — не хватало ровно ленивого импорта.
 */
const WeaponModelViewer = React.lazy(
  () => import("../../../WeaponModelViewer.jsx"),
);
/* «Мои работы» тянут модель проекта студии — своим куском, по нажатию. */
const LibraryOptimizationTile = React.lazy(() => import("../../../features/library/LibraryOptimizationTile.jsx"));
/* «Оптимизация» мастерской — страница под шапкой мастерской (дизайн 15.11.2026), а не редактор на весь экран. */
const WorkshopOptimizer = React.lazy(
  () => import("../workshop/optimizer/OptimizerPage.jsx"),
);
const WorkshopWorks = React.lazy(
  () => import("../../../features/workshop/works/WorkshopWorks.jsx"),
);
import {
  preloadWorkshopImage,
  renderFilteredWorkshopPreview,
  scrollWorkshopSurfaceToTop,
} from "./workshopPreviewUtils.js";
import { ptfxPresetVariants } from "../workshop/effects-catalog.js";
import {
  WorkshopStudioFallback,
  useWorkshopEditors,
  workshopEditorExists,
} from "../../../features/workshop/useWorkshopEditors.jsx";
import {
  useGameEditions,
  workshopEditionNotice,
} from "../../../features/workshop/edition-support.js";
import { EditionNoticeContext } from "../../ui/edition-notice.js";
import { EditorBackContext } from "../../ui/editor-back-context.js";
import { editorReturnLabel, homeReturnLabel } from "../../../features/catalog/editor-return.js";
import { cartReturnLabel } from "../../../features/cart/cart-return.js";
import { downloadsReturnLabel } from "../../../features/downloads/downloads-return.js";
import LibraryRows from "../../../features/library/LibraryRows.jsx";
import WeaponShelfDisclosure from "./WeaponShelfDisclosure.jsx";
import ClothingPairArt from "../clothing/ClothingPairArt.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { dataLangOf } from "./data-lang.js";

/* Имя вещи или работы — данные человека и каталога, не слова интерфейса: язык данных, чтобы сверка языка не принимала его за русский интерфейс. */
const dataName = (name) => (name ? <span lang={dataLangOf(name)}>{name}</span> : name);


function ModGrid({
  mods,
  installed = [],
  favorites = [],
  onFavorite,
  onSelect,
  onRemove,
  showFavorite = true,
  emptyText = "Модификаций пока нет",
  language = "ru",
}) {
  useTr();
  const localizedEmpty =
    emptyText !== "Модификаций пока нет"
      ? emptyText
      : language === "ru"
        ? tr("Модификаций пока нет")
        : language === "de"
          ? "Noch keine Mods"
          : language === "pl"
            ? "Brak modyfikacji"
            : language === "fr"
              ? "Aucun mod pour le moment"
              : "No modifications yet";
  const cardCopy = {
    ru: {
      installed: tr("Установлен"),
      remove: tr("Удалить"),
      unlike: tr("Убрать из понравившихся"),
      like: tr("Добавить в понравившиеся"),
    },
    en: {
      installed: "Installed",
      remove: "Remove",
      unlike: "Remove from favorites",
      like: "Add to favorites",
    },
    de: {
      installed: "Installiert",
      remove: "Entfernen",
      unlike: "Aus Favoriten entfernen",
      like: "Zu Favoriten hinzufügen",
    },
    pl: {
      installed: "Zainstalowano",
      remove: "Usuń",
      unlike: "Usuń z ulubionych",
      like: "Dodaj do ulubionych",
    },
    fr: {
      installed: "Installé",
      remove: "Supprimer",
      unlike: "Retirer des favoris",
      like: "Ajouter aux favoris",
    },
  }[language] || {
    installed: "Installed",
    remove: "Remove",
    unlike: "Remove from favorites",
    like: "Add to favorites",
  };
  if (!mods.length)
    return (
      <div className="desktop-empty compact-empty">
        <Package />
        <h2>{localizedEmpty}</h2>
      </div>
    );
  return (
    <div className="desktop-catalog-grid" data-assembly-grid>
      {mods.map((mod) => {
        const ready = installed.includes(mod.id);
        const liked = favorites.includes(mod.id);
        const media = catalogMediaPresentation(mod, "catalog-mod-card");
        const open = () => onSelect?.(mod);
        return (
          <article
            className={media.className}
            key={mod.id}
            onClick={open}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && onSelect) {
                event.preventDefault();
                open();
              }
            }}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
          >
            <div className="desktop-catalog-cover" style={media.style}>
              <div className="catalog-card-shade" />
              <div className="catalog-card-copy">
                <small>
                  {mod.categoryLabel} · {mod.platformLabel}
                </small>
                <h3>{mod.name}</h3>
                {/* Оценок в каталоге нет (владелец, 16.10): звезда с
                    числом ушла и отсюда. */}
                <span>
                  {mod.downloads}
                  {ready && !onRemove ? ` · ${cardCopy.installed}` : ""}
                </span>
              </div>
              {modIsNew(mod) && <b>NEW</b>}
              {onRemove ? (
                <button
                  className="catalog-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(mod);
                  }}
                  title={`${cardCopy.remove} ${mod.name}`}
                >
                  <Trash />
                  <span>{cardCopy.remove}</span>
                </button>
              ) : showFavorite && onFavorite ? (
                <button
                  className={`catalog-like ${liked ? "liked" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onFavorite(mod);
                  }}
                  title={liked ? cardCopy.unlike : cardCopy.like}
                >
                  <Heart weight={liked ? "fill" : "regular"} />
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
const reduxPreviewPacks = [
  [
    "astral-redux-aether",
    "Aezer Redux",
    "Nova lab",
    18420,
    1260,
    ["gta5rp", "majestic"],
    ["rp"],
  ],
  [
    "astral-redux-noir",
    "Noir District",
    "Astral curation",
    15210,
    984,
    ["gta5rp"],
    ["combat"],
  ],
  [
    "astral-redux-vista",
    "Vista Natural",
    "North studio",
    12980,
    815,
    ["majestic"],
    ["rp", "fps"],
  ],
  [
    "astral-redux-ember",
    "Ember City",
    "Astral curation",
    11470,
    742,
    ["gta5rp", "majestic"],
    ["fps"],
  ],
  [
    "astral-redux-pulse",
    "Pulse Redux",
    "Voidworks",
    9360,
    618,
    ["gta5rp"],
    ["knockout", "combat"],
  ],
].map(([id, name, author, downloads, likes, servers, purposes], index) => ({
  id,
  name,
  author,
  downloads,
  likes,
  publishedAt: `2026-07-${String(21 - index).padStart(2, "0")}`,
  description:
    tr("Готовая графическая сборка с совместимыми визуальными заменами."),
  cover: `/media/catalog/redux/redux-${index + 1}.jpg`,
  servers,
  purposes,
  previewOnly: true,
}));

const gunpackPreviewPacks = [
  [
    "astral-gunpack-obsidian",
    "Obsidian Arsenal",
    "Astral creator",
    12840,
    936,
    ["gta5rp", "majestic"],
  ],
  [
    "astral-gunpack-crimson",
    "Crimson Pack",
    "North studio",
    11260,
    814,
    ["majestic"],
  ],
  [
    "astral-gunpack-mint",
    "Mint Collection",
    "Voidworks",
    9740,
    705,
    ["gta5rp"],
  ],
  [
    "astral-gunpack-urban",
    "Urban Weapons",
    "Astral creator",
    8260,
    591,
    ["gta5rp", "majestic"],
  ],
  ["astral-gunpack-noir", "Noir Pack", "Nova lab", 7180, 478, ["gta5rp"]],
  [
    "astral-gunpack-violet",
    "Violet Arsenal",
    "North studio",
    6420,
    416,
    ["majestic"],
  ],
].map(([id, name, author, downloads, likes, servers], index) => ({
  id,
  name,
  author,
  downloads,
  likes,
  publishedAt: `2026-07-${String(21 - index).padStart(2, "0")}`,
  description:
    tr("Готовый комплект совместимых моделей оружия для быстрой установки."),
  cover: `/media/catalog/gunpacks/gunpack-${index + 1}.png`,
  servers,
  previewOnly: true,
}));

/* Каталог — своим файлом (ТЗ 05.10, задача 14: полки, фильтры, поиск на
   месте). Отсюда — прежние имена для тех, кто их импортирует. */
export { PublicCatalog, publicCatalogPreviewMods } from "./PublicCatalog.jsx";

const workshopLocalVariantPresets = {
  minimap: [
    {
      name: "Стандартная мини-карта",
    },
  ],
  "large-map": [
    {
      name: "Стандартная карта",
    },
  ],
};

function readLocalMinimapWorkVariants(locale = "ru") {
  if (typeof localStorage === "undefined") return [];
  try {
    const projects = JSON.parse(
      localStorage.getItem("astral-workshop-projects-v1") || "[]",
    );
    if (!Array.isArray(projects)) return [];
    return projects
      .filter((project) => project?.modules?.minimap && project.sourceModId)
      .map((project) => {
        const name =
          project.name ||
          (locale === "ru"
            ? tr("Моя мини-карта")
            : locale === "fr"
              ? "Ma minicarte"
              : "My minimap");
        const labelledName = /твоя работа|your work|votre création/i.test(name)
          ? name
          : `${name} · ${locale === "ru" ? tr("твоя работа") : locale === "fr" ? "votre création" : "your work"}`;
        return {
          id: `workshop-user-minimap-${project.id}`,
          sourceModId: project.sourceModId,
          workshopProjectId: project.id,
          name: labelledName,
          author: locale === "ru" ? tr("Ты") : locale === "fr" ? "Vous" : "You",
          description:
            locale === "ru"
              ? tr("Сохранённая пользовательская настройка мини-карты")
              : locale === "fr"
                ? "Configuration personnalisée de la minicarte enregistrée"
                : "Saved custom minimap configuration",
          cover: "/media/redux/minimap.png",
          catalogSection: "redux",
          catalogSlot: "minimap",
          categoryLabel:
            locale === "ru"
              ? tr("Твоя работа")
              : locale === "fr"
                ? "Votre création"
                : "Your work",
          isUserWork: true,
          previewOnly: false,
          sizeBytes: 0,
        };
      });
  } catch {
    return [];
  }
}

function workshopFallbackOptions(section, slotId, title, slot, locale = "ru") {
  if (section === "redux") {
    return [
      createReduxVanillaVariant({ slotId, title, locale }),
      ...ptfxPresetVariants(slotId, title, locale),
    ];
  }

  if (["gunpacks", "clothing"].includes(section)) {
    const isClothing = section === "clothing";
    return [
      {
        id: `workshop-preview-${section}-${slotId}-default`,
        name: title || "GTA V",
        author: "GTA V",
        description: isClothing
          ? slot?.model
            ? tr("Оригинальная 3D-модель одежды GTA V с сохранёнными материалами и текстурами.")
            : tr("Оригинальная категория одежды GTA V. Локальная 3D-модель доступна только в сборке с разрешённым набором ассетов.")
          : tr("Оригинальная модель оружия GTA V без визуальных замен."),
        cover: isClothing
          ? slot?.image
          : `/assets/catalog/weapons/${slotId}.webp`,
        fallbackCover: isClothing ? slot?.fallbackImage : undefined,
        model: slot?.model,
        fallbackModel: isClothing ? slot?.fallbackModel : undefined,
        catalogSection: section,
        catalogSlot: slotId,
        categoryLabel: title || (isClothing ? tr("Одежда") : tr("Оружие")),
        previewOnly: false,
        isVanilla: true,
        sizeBytes: 0,
      },
    ];
  }

  const presetVariants = ["minimap", "large-map"].includes(slotId)
    ? workshopLocalVariantPresets[slotId]?.slice(0, 1)
    : [];
  if (presetVariants?.length) {
    return presetVariants.map((variant, index) => ({
      id: `workshop-preview-${section}-${slotId}-${index}`,
      name: variant.name,
      author: index === 0 ? "GTA V" : "Astral workshop",
      description:
        index === 0
          ? tr("Оригинальный вариант игры без визуальных замен.")
          : `Готовый вариант для слота «${title || tr("Модификация")}».`,
      cover: variant.cover,
      imageFilter: variant.imageFilter || "",
      catalogSection: section,
      catalogSlot: slotId,
      categoryLabel: title || tr("Мастерская"),
      previewOnly: false,
      isVanilla: ["minimap", "large-map"].includes(slotId) && index === 0,
      sizeBytes:
        ["minimap", "large-map"].includes(slotId) && index === 0
          ? 0
          : ["tracers", "effects", "kill-effects"].includes(slotId)
            ? (4 + index * 2) * 1024 * 1024
            : slotId === "large-map"
              ? (12 + index * 3) * 1024 * 1024
              : (6 + index * 2) * 1024 * 1024,
    }));
  }

  const media = [];
  const namesBySlot = {
    "large-map": [
      tr("Стандартная карта"),
      tr("Контурная карта"),
      tr("Тёмный атлас"),
      tr("Спутниковая карта"),
    ],
    roads: [
      tr("Чистый асфальт"),
      tr("Белая разметка"),
      tr("Городские дороги"),
      tr("Контрастные дороги"),
    ],
    timecycle: [
      tr("Мягкое небо"),
      tr("Ясный день"),
      tr("Закатный профиль"),
      tr("Холодная атмосфера"),
    ],
    vegetation: [
      tr("Стандартный мир"),
      tr("Зелёный мир"),
      tr("Осенний мир"),
      tr("Светлая растительность"),
    ],
    lights: [
      tr("Холодный свет"),
      tr("Белые фонари"),
      tr("Фиолетовые фонари"),
      tr("Ночной профиль"),
    ],
    water: [tr("Стандартная вода"), tr("Чистая вода"), tr("Бирюзовая вода"), tr("Тёмная вода")],
    tracers: [
      tr("Стандартные трассеры"),
      tr("Тонкие трассеры"),
      tr("Яркие трассеры"),
      tr("Мягкие трассеры"),
    ],
    effects: [
      tr("Стандартные эффекты"),
      tr("Чистые попадания"),
      tr("Мягкий импакт"),
      tr("Контрастный импакт"),
    ],
    clothing: [
      tr("Стандарт"),
      tr("Городской вариант"),
      tr("Тёмный вариант"),
      tr("Спортивный вариант"),
    ],
  };
  const names = namesBySlot[slotId] || namesBySlot[section] || [];
  return media.map((cover, index) => ({
    id: `workshop-preview-${section}-${slotId}-${index}`,
    name:
      names[index % Math.max(1, names.length)] ||
      `${title || tr("Вариант")} ${index + 1}`,
    author: index === 0 ? "GTA V" : "Astral workshop",
    description:
      index === 0
        ? tr("Оригинальный вариант игры без визуальных замен.")
        : `Совместимый вариант для слота «${title || tr("Модификация")}».`,
    cover,
    catalogSection: section,
    catalogSlot: slotId,
    categoryLabel: title || tr("Мастерская"),
    previewOnly: true,
    sizeBytes: (6 + index * 2) * 1024 * 1024,
  }));
}

function expandWorkshopPreviewRows(variants) {
  return variants;
}

/* Слоты, которые открывают редактор карты, и имя нового проекта для каждого. */

export function Catalog({
  data,
  installed,
  /* «Чья запись» (`origin.bundleId`): Загрузки стоят вне `BundleContext`, поэтому оболочка отдаёт её свойством — по ней строки библиотеки встают под заголовок своего ганпака или сборки. */
  bundleOf = {},
  queue = [],
  favorites = [],
  initialGroup,
  onSelect,
  onFavorite,
  onInstall,
  onLaunch,
  onRemove,
  onNavigate,
  onNotice,
  onRestoreGame,
  language = "ru",
  /* Одна полка на два экрана: `workshop` — где собирают, `library` — что уже
     стоит в игре. Карточки, галерея слота и кнопка «Удалить» у них общие,
     поэтому библиотека выглядит и ведёт себя как мастерская, а не как
     отдельный список со своими правилами. Своя у каждой только память. */
  mode = "workshop",
  /* Какую игру сверять с тем, что поставил Astral, — выбранную в оболочке. */
  gameTargetId = "",
  /* Корзина библиотеки сняла моды: оболочке пора перечитать установленное. */
  onLibraryChanged = null,
  /* Куратор: студиям — «В каталог» (во входящие публикации). */
  isAdmin = false,
  /* Снятое проверкой файлов игры (задача 2 ТЗ 10.10.2026): моды движка,
     номер перечитывания отметок, сверка точек работ и «Установить снова». */
  checkRemoved = [],
  checkRevision = 0,
  onLibraryStatus = null,
  onReinstallChecked = null,
  /* Библиотека строками справа на «Загрузках» (16.11.2026, `features/downloads/DownloadsLibrary.jsx`): та же полка и то же удаление, но вместо плиток — `LibraryRows`. */
  rows = false,
}) {
  useTr();
  const isLibrary = mode === "library";
  const {
    normalizedInitial,
    requestedWorkshopSlot,
    entryRequested,
    section,
    setSection,
    weaponMode,
    setWeaponMode,
    reduxMode,
    setReduxMode,
    clothingMode,
    setClothingMode,
    selectedSlot,
    setSelectedSlot,
    slotSearch,
    setSlotSearch,
    weaponCatalogExpanded,
    setWeaponCatalogExpanded,
    reduxDetailSlot,
    setReduxDetailSlot,
    packSearch,
    setPackSearch,
    packSort,
    setPackSort,
    packFavoritesOnly,
    setPackFavoritesOnly,
    packServerFilter,
    setPackServerFilter,
    packPurposeFilter,
    setPackPurposeFilter,
    selectedVariant,
    setSelectedVariant,
    slotEntryMode,
    setSlotEntryMode,
    weaponViewerOpen,
    setWeaponViewerOpen,
    slotPreviewOverrides,
    setSlotPreviewOverrides,
  } = useWorkshopState(initialGroup, mode);
  const workshopPageRef = useRef(null);
  /*
   * Какая это страница — меткой на каркасе окна (`useHolds.js`), а не `:has()` в листах: его браузер перепроверял
   * на каждую правку в окне. Корень ветки говорит о себе сам (`data-hold-as`); полка с разделом мастерской
   * (`data-workshop-section`) — ещё и оболочке, каталог паков — своей ссылкой.
   */
  const pageRootRef = useRef(null);
  const packCatalogRef = useRef(null);
  const setWorkshopRoot = useCallback((node) => {
    workshopPageRef.current = node;
    pageRootRef.current = node;
  }, []);
  useHolds(pageRootRef, (node) => node.dataset.holdAs, [".desktop-main", ".desktop-content"]);
  useHolds(pageRootRef, (node) => (node.hasAttribute("data-workshop-section") ? "workshop-section" : ""), [".desktop-app"]);
  useHolds(packCatalogRef, "astral-pack-catalog", [".desktop-main", ".desktop-content"]);
  /* Иконки стволов из игры игрока: плитке без своего кадра (Т-145б). */
  const gameWeaponIcons = useGameWeaponIcons();
  const weaponCatalogDisclosure = useCatalogDisclosure(
    weaponCatalogExpanded,
    setWeaponCatalogExpanded,
  );
  const locale = ["ru", "en", "de", "pl", "fr"].includes(language) ? language : "en";
  /* Тексты мастерской знают и украинский; остальные экраны по-прежнему читают locale. */
  const copyLocale = ["ru", "uk", "en", "de", "pl", "fr"].includes(language) ? language : "en";
  /* Вещи каталога предмета для смены ствола или категории одежды прямо в
     мастерской: индекс модов собирается ниже, поэтому — через ссылку. */
  const slotCatalogRef = useRef(null);
  const slotCatalog = useCallback(
    (section, slot) => slotCatalogRef.current?.(section, slot),
    [],
  );
  /* Издание GTA V (ТЗ 08.10, задача 5): пометка в полосе каждого редактора. */
  const editions = useGameEditions();
  const editionNotice = useMemo(
    () => workshopEditionNotice(editions),
    [editions],
  );
  const editors = useWorkshopEditors({
    locale,
    onNotice,
    memoryKey: `${mode}:editor`,
    /* «Редактировать» на странице мода: выход из редактора — обратно к моду. */
    onReturn: onNavigate,
    slotCatalog,
    /* Обвесы скачанных ганпаков — в «Вид из каталога» студии ствола. */
    installed,
    /* Полка оружия мастерской на экране: стволы пака греются у Desktop (`pack-warm.js`). */
    weaponsOpen: mode === "workshop" && section === "gunpacks",
  });
  /* Названный переход и «Открыть в мастерской» уходят из редакторов
     совсем, а не в тот, из которого редактор открыли. */
  const { leave: closeEditors } = editors;
  /* «Мои работы» — экран мастерской поверх полки; помнится, как открытый
     редактор: из редактора, открытого со списка, человек возвращается к
     списку, а не на полку. */
  const [worksOpen, setWorksOpen] = useRememberedState(`${mode}:works`, false);
  /* Что набрано в поиске редакторов шапки мастерской. */
  const [editorQuery, setEditorQuery] = useState("");
  /* Вкладки библиотеки (ТЗ 10.10): выбранная; «просмотренные» — те, что уже
     открывали или что были в библиотеке до этого захода. Точка стоит на тех,
     что появились без человека — за время, пока его не было. */
  const [libraryTab] = useRememberedState("library:tab", "all");
  const [libraryTabsSeen, setLibraryTabsSeen] = useRememberedState(
    "library:tabs-seen",
    [],
  );
  const libraryFreshTabs = useRef(null);
  const libraryTabsNow = useRef([]);
  const bundleActions = useBundleActions();
  useEffect(() => {
    if (!isLibrary) return;
    setLibraryTabsSeen((seen) => [
      ...new Set([...seen, ...libraryTabsNow.current]),
    ]);
  }, [isLibrary, setLibraryTabsSeen]);
  /* Каталог попросил открыть работу («Открыть в мастерской»): её редактор
     открывается из «Моих работ», поэтому сначала — они. */
  useEffect(() => {
    if (mode !== "workshop" || !hasWorkOpenRequest()) return;
    closeEditors();
    setWorksOpen(true);
  }, [mode, closeEditors, setWorksOpen]);
  /* Библиотека открывает работу карточкой, а не сразу редактором: с неё
     видно, что стоит в игре, и с неё же это правят и снимают. */
  const [workCardSlot, setWorkCardSlot] = useRememberedState(
    `${mode}:workCard`,
    "",
  );
  /* У полки и у редактора своя высота и своя прокрутка: одна память на двоих
     возвращала бы человека в редактор на позицию полки. */
  useRememberedScroll(
    editors.isOpen ? `${mode}:editorScroll` : `${mode}:scroll`,
  );
  const libraryCopy = workshopCopyFor(copyLocale);
  const copy = {
    ru: {
      nav: tr("Разделы каталога"),
      searchWeapon: tr("Поиск по оружию"),
      searchSection: tr("Поиск в разделе"),
      packs: tr("Ганпаки"),
      reduxPacks: tr("Редуксы"),
      selective: tr("Кастомизация"),
      installed: tr("Установлено"),
      install: tr("Установить"),
      launch: tr("Запустить"),
      remove: tr("Удалить"),
      back: tr("Назад к"),
      variants: tr("вариантов"),
      choose:
        tr("Выберите вариант ниже. Одновременно активна только одна модификация этого слота."),
      emptyTitle: tr("Пока нет опубликованных вариантов"),
      emptyText:
        tr("Здесь появятся только реальные модификации, которым в админ-панели назначены этот раздел и слот."),
      packsEmptyTitle: tr("Ганпаки будут добавлены через админ-панель"),
      packsEmptyText:
        tr("Демонстрационные модификации удалены. Здесь появятся только готовые проверенные паки."),
      pack: tr("Ганпак"),
    },
    en: {
      nav: "Catalog sections",
      searchWeapon: "Search weapons",
      searchSection: "Search this section",
      packs: "Gunpacks",
      reduxPacks: "Redux packs",
      selective: "Customization",
      installed: "Installed",
      install: "Install",
      launch: "Launch",
      remove: "Remove",
      back: "Back to",
      variants: "variants",
      choose:
        "Choose an option below. Only one modification can be active in this slot.",
      emptyTitle: "No published options yet",
      emptyText:
        "Only real modifications assigned to this section and slot in the admin panel will appear here.",
      packsEmptyTitle: "Gunpacks will be added through the admin panel",
      packsEmptyText:
        "Demo modifications were removed. Only complete verified packs will appear here.",
      pack: "Gunpack",
    },
    de: {
      nav: "Katalogbereiche",
      searchWeapon: "Waffen suchen",
      searchSection: "Bereich durchsuchen",
      packs: "Waffenpacks",
      reduxPacks: "Redux-Pakete",
      selective: "Anpassen",
      installed: "Installiert",
      install: "Installieren",
      launch: "Starten",
      remove: "Entfernen",
      back: "Zurück zu",
      variants: "Varianten",
      choose:
        "Wähle unten eine Variante. Pro Slot kann nur eine Modifikation aktiv sein.",
      emptyTitle: "Noch keine Varianten veröffentlicht",
      emptyText:
        "Hier erscheinen nur echte Modifikationen, die im Adminbereich diesem Bereich und Slot zugeordnet wurden.",
      packsEmptyTitle: "Waffenpacks werden über den Adminbereich hinzugefügt",
      packsEmptyText:
        "Demo-Modifikationen wurden entfernt. Hier erscheinen nur vollständige geprüfte Pakete.",
      pack: "Waffenpack",
    },
    pl: {
      nav: "Sekcje katalogu",
      searchWeapon: "Szukaj broni",
      searchSection: "Szukaj w sekcji",
      packs: "Paczki broni",
      reduxPacks: "Paczki Redux",
      selective: "Personalizacja",
      installed: "Zainstalowano",
      install: "Zainstaluj",
      launch: "Uruchom",
      remove: "Usuń",
      back: "Wróć do",
      variants: "wariantów",
      choose:
        "Wybierz wariant poniżej. W jednym slocie może być aktywna tylko jedna modyfikacja.",
      emptyTitle: "Brak opublikowanych wariantów",
      emptyText:
        "Pojawią się tu tylko prawdziwe modyfikacje przypisane do tej sekcji i slotu w panelu administratora.",
      packsEmptyTitle: "Paczki broni zostaną dodane przez panel administratora",
      packsEmptyText:
        "Mody demonstracyjne zostały usunięte. Pojawią się tu tylko kompletne, zweryfikowane paczki.",
      pack: "Paczka broni",
    },
    fr: {
      nav: "Sections du catalogue",
      searchWeapon: "Rechercher une arme",
      searchSection: "Rechercher dans cette section",
      packs: "Gunpacks",
      reduxPacks: "Redux",
      selective: "Personnalisation",
      installed: "Installé",
      install: "Installer",
      launch: "Lancer",
      remove: "Supprimer",
      back: "Retour à",
      variants: "variantes",
      choose:
        "Choisissez une variante ci-dessous. Un seul mod peut être actif par emplacement.",
      emptyTitle: "Aucune variante publiée pour le moment",
      emptyText:
        "Seuls les vrais mods affectés à cette section et à cet emplacement dans le panneau d'administration apparaîtront ici.",
      packsEmptyTitle: "Les Gunpacks seront ajoutés via le panneau d'administration",
      packsEmptyText:
        "Les mods de démonstration ont été supprimés. Seuls les packs complets et vérifiés apparaîtront ici.",
      pack: "Gunpack",
    },
  }[locale];
  const localized = (labels) => labels?.[copyLocale] || labels?.en || "";
  const reduxVisualSlots = [
    ...(catalogLandingSlots.redux || []).filter(
      (slot) => slot.id !== "redux-pack",
    ),
    ...REDUX_EDITOR_SLOTS,
  ];
  const reduxRootVisualSlots = reduxVisualSlots.filter((slot) =>
    isReduxRootSlotId(slot.id),
  );
  const selectedReduxGroupId =
    section === "redux" ? reduxGroupIdFor(selectedSlot) : null;
  const activeWorkshopSlotId =
    section === "redux"
      ? resolveReduxDetailSlotId(selectedReduxGroupId, reduxDetailSlot)
      : selectedSlot;
  const activeReduxDetailSlots =
    section === "redux"
      ? reduxDetailSlotsFor(selectedReduxGroupId, reduxVisualSlots)
      : [];
  /*
   * Сброс полки — на названный переход, а не на каждое появление страницы.
   *
   * Пока сброс стоял без условия, он срабатывал и при обычном возвращении:
   * человек уходил из мастерской на минуту в загрузки, возвращался — и полка
   * встречала его начальным разделом, пустым поиском и снятым выделением,
   * будто он сюда не заходил. Теперь всё это переживает уход (память раздела
   * в section-memory.js), а сброс остаётся там, ради чего был написан: когда в
   * мастерскую приходят из каталога с названным слотом, страница обязана
   * открыться на нём и ни на чём другом.
   */
  useEffect(() => {
    if (!entryRequested) return;
    /* Названный слот показывают на полке, а не поверх открытого редактора. */
    closeEditors();
    const requestedReduxGroupId =
      normalizedInitial === "redux"
        ? reduxGroupIdFor(requestedWorkshopSlot)
        : null;
    setSection(normalizedInitial);
    setSelectedSlot(requestedReduxGroupId || requestedWorkshopSlot);
    setReduxDetailSlot(
      normalizedInitial === "redux"
        ? resolveReduxDetailSlotId(requestedReduxGroupId, requestedWorkshopSlot)
        : null,
    );
    setWeaponMode(normalizedInitial === "gunpacks" ? "selective" : null);
    setReduxMode(normalizedInitial === "redux" ? "selective" : null);
    setClothingMode(normalizedInitial === "clothing" ? "selective" : null);
    setPackSearch("");
    setPackFavoritesOnly(false);
    setPackServerFilter("all");
    setPackPurposeFilter("all");
    setSelectedVariant(null);
    setSlotEntryMode(requestedWorkshopSlot ? "catalog" : null);
    setWeaponCatalogExpanded(false);
    setWorksOpen(false);
  }, [
    closeEditors,
    setWorksOpen,
    entryRequested,
    normalizedInitial,
    requestedWorkshopSlot,
    setClothingMode,
    setPackFavoritesOnly,
    setPackPurposeFilter,
    setPackSearch,
    setPackServerFilter,
    setReduxDetailSlot,
    setReduxMode,
    setSection,
    setSelectedSlot,
    setSelectedVariant,
    setSlotEntryMode,
    setWeaponCatalogExpanded,
    setWeaponMode,
  ]);

  useEffect(() => {
    setSelectedVariant(null);
    setSlotSearch("");
    setSlotEntryMode(activeWorkshopSlotId ? "catalog" : null);
  }, [
    activeWorkshopSlotId,
    section,
    setSelectedVariant,
    setSlotEntryMode,
    setSlotSearch,
  ]);

  const previousInstalledIdsRef = useRef(new Set(installed));
  useEffect(() => {
    const nextInstalledIds = new Set(installed);
    const selectedId = selectedVariant?.id;
    if (
      selectedId &&
      previousInstalledIdsRef.current.has(selectedId) &&
      !nextInstalledIds.has(selectedId)
    ) {
      setSelectedVariant(null);
    }
    previousInstalledIdsRef.current = nextInstalledIds;
  }, [installed, selectedVariant?.id, setSelectedVariant]);

  useEffect(() => {
    if (!activeWorkshopSlotId) return undefined;
    const frame = window.requestAnimationFrame(scrollWorkshopSurfaceToTop);
    return () => window.cancelAnimationFrame(frame);
  }, [activeWorkshopSlotId, slotEntryMode]);

  useWorkshopDetailGallery({
    pageRef: workshopPageRef,
    active: Boolean(
      selectedSlot && slotEntryMode === "catalog" && !editors.isOpen,
    ),
    resetKey: `${section}:${activeWorkshopSlotId || ""}:${slotSearch}`,
  });

  /* Проект приложения (ТЗ 05.10, задача 14) — на полках мастерской: моды из
     каталога, что не подходят выбранному проекту, на полку не встают;
     установленные видны при любом проекте. Работы редакторов ставятся в файлы
     игры и подходят всем проектам. В библиотеке строки проекта нет (06.10):
     она ничего не меняла — там только установленное, а оно видно при любом
     проекте, — а выбор, сделанный в другом разделе, не должен тихо сужать
     галерею слота, у которой органа для него нет. */
  const [chosenProject] = useProject();
  const project = isLibrary ? ALL_PROJECTS : chosenProject;
  const workshopModIndex = useMemo(() => {
    if (project === ALL_PROJECTS)
      return createWorkshopModIndex(data.mods, installed);
    const byId = new globalThis.Map(data.mods.map((mod) => [mod.id, mod]));
    return createWorkshopModIndex(data.mods, installed, {
      offers: (mod) => modFitsProject(mod, project, byId),
    });
  }, [data.mods, installed, project]);
  /*
   * Каталог одежды в мастерской — весь (ТЗ 30.10.2026, владелец: «каталог подключить весь»): в списках слотов все вещи одежды, у которых есть пакет, а не только подходящие выбранному серверному
   * проекту (там фильтр «подходит проекту» прячет вещи другого проекта). Человек одевает персонажа сам — какую вещь куда ставить, решает он.
   */
  const clothingModIndex = useMemo(() => createWorkshopModIndex(data.mods, installed), [data.mods, installed]);
  /* Одежда в «Библиотеке» — карточка на каждую вещь в игре: мод каталога
     своим пакетом и мод на вещи сервера (`clothing-placements.js`). */
  const clothingPlaced = useClothingPlacements(engineModIds(installed), gameTargetId);
  /* Фото модов на вещах, пока каталог их знал (`mod-faces.js`): карточка не пустеет, когда каталог ещё не пришёл (25.10.2026). */
  const [clothingFaces, setClothingFaces] = useState(readModFaces);
  const catalogModsById = useMemo(
    () => new globalThis.Map(data.mods.map((mod) => [mod.id, mod])),
    [data.mods],
  );
  useEffect(() => {
    const ids = clothingPlaced.map((placed) => placed.catalogModId).filter(Boolean);
    if (ids.length)
      setClothingFaces((known) => rememberModFaces(ids, catalogModsById, known));
  }, [clothingPlaced, catalogModsById]);
  const libraryClothing = useMemo(
    () =>
      clothingLibraryCards({
        installedMods: workshopModIndex.installedWorkshopMods,
        placements: clothingPlaced,
        modsById: catalogModsById,
        faces: clothingFaces,
        categories: catalogLandingSlots.clothing || [],
      }),
    // `language` — подпись «На «вещь»» карточки переводится здесь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workshopModIndex, clothingPlaced, catalogModsById, clothingFaces, language],
  );
  /* Звуки из каталога — карточкой каждый (`features/library/sound-mods.js`): их раздел `other`, и слоты полки их не находили. */
  const librarySounds = useMemo(
    () => soundLibraryCards({ installedMods: workshopModIndex.installedWorkshopMods }),
    // `language` — имя оружия и подпись карточки переводятся здесь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workshopModIndex, language],
  );
  /* «Эффекты» и «Трейсеры» редукса — по карточке на набор пакетов (`features/library/effects-mods.js`): у пакетов разбора слоты без плиток, и на слотах полки их не было. */
  const libraryEffects = useMemo(
    () => effectsLibraryCards({ installedMods: workshopModIndex.installedWorkshopMods, mods: data.mods }),
    // `language` — подпись карточки переводится здесь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workshopModIndex, data.mods, language],
  );
  /* Отметки об установке из редакторов: перечитываются, когда меняется список
     установленного и когда закрывается редактор — ровно тогда они и меняются. */
  const [installUnits, setInstallUnits] = useState(() =>
    readWorkshopInstallUnits(),
  );
  const workshopDone = useWorkshopDoneRevision(); /* работа мастерской дошла до конца — записи установок читаются заново */
  const installMarks = useMemo(
    () => marksFromUnits(installUnits),
    [installUnits],
  );
  useEffect(() => {
    setInstallUnits(readWorkshopInstallUnits());
  }, [installed, editors.isOpen, checkRevision, workshopDone]);
  /* Слова про GTA 5 RP у плитки работы («Дороги · Поставлено … · На GTA 5 RP видно: …»): из записи установки, пока мод стоит (`useRpWords.js`); режим выключен — пусто. */
  const rpWords = useRpWords(installUnits, copyLocale);
  /*
   * Стоит ли установленное в игре на самом деле — только в библиотеке.
   *
   * Проверка идёт в фоне и экран не держит: полка рисуется сразу, а
   * предупреждение появляется, если архив игры оказался не тем, что оставил
   * Astral. Перепроверяется там же, где меняются отметки: после установки,
   * снятия и закрытия редактора.
   */
  const [libraryStatus, setLibraryStatus] = useState(null);
  const [restoring, setRestoring] = useState(false);
  /* Открытая карточка ганпака в библиотеке v2: `{ mod, slotId }` (`features/library/LibraryPackCard.jsx`). */
  const [packCard, setPackCard] = useState(null);
  const [packBusy, setPackBusy] = useState(false);
  const librarySelection = useLibrarySelection(
    `${section}:${selectedSlot || ""}:${editors.isOpen}`,
  );
  const installedSignature = installed.join("\n");
  /* «Заменён»: место мода целиком занял более новый слой («новый мод старше», 18.11.2026; `covered-words.js`). */
  const coveredWordsOf = (modId) => (isLibrary ? coveredWords({ covered: libraryStatus?.covered, modId, mods: data.mods, units: installUnits }) : "");
  useEffect(() => {
    /* Мастерская сверяет точки работ тоже: ушедшие с проверкой файлов игры
       работы не должны значиться стоящими в игре (задача 2 ТЗ 10.10.2026). */
    if (!isLibrary) {
      if (!gameTargetId || !onLibraryStatus) return undefined;
      let cancelled = false;
      getLibraryStatus({ targetId: gameTargetId })
        .then((status) => !cancelled && onLibraryStatus(status))
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    getLibraryStatus({ targetId: gameTargetId || "" })
      .then((status) => {
        if (cancelled) return;
        setLibraryStatus(status || null);
        onLibraryStatus?.(status);
        /* Записи, чьи точки переставила корзина, а ответ до окна не дошёл,
           находят свою точку по патчу. */
        if (
          reconcileWorkshopInstallRecords(
            globalThis.localStorage,
            status?.native?.items,
          )
        )
          setInstallUnits(readWorkshopInstallUnits());
      })
      .catch(() => {
        if (!cancelled) setLibraryStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isLibrary,
    gameTargetId,
    installedSignature,
    editors.isOpen,
    restoring,
    onLibraryStatus,
    workshopDone,
  ]);
  const installedWorkshopSlotSignature = workshopModIndex.installedWorkshopMods
    .map((mod) => mod.catalogSlot)
    .filter(Boolean)
    .sort()
    .join("\n");
  useEffect(() => {
    const installedSlots = new Set(
      installedWorkshopSlotSignature.split("\n").filter(Boolean),
    );
    setSlotPreviewOverrides((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([slotId]) =>
          installedSlots.has(slotId),
        ),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [installedWorkshopSlotSignature, setSlotPreviewOverrides]);
  const sectionMods = workshopModIndex.modsForSection(section);
  /*
   * Слот и то, что в нём стоит, — в названном разделе. Библиотека держит
   * одну полку на все разделы сразу (владелец, 25.09.2026), и карточка
   * оружия на ней обязана искать свой мод в оружии, даже когда открытым
   * разделом осталась графика. Имена без раздела — те же вопросы про
   * открытый раздел.
   */
  const slotIdsIn = (sectionId, slotId) => {
    if (sectionId !== "redux") return [slotId];
    const detailSlotIds = reduxDetailSlotIdsFor(slotId);
    return detailSlotIds.length ? detailSlotIds : [slotId];
  };
  const installedIn = (sectionId, slotId) =>
    slotIdsIn(sectionId, slotId)
      .map((detailSlotId) =>
        workshopModIndex.installedForSlot(sectionId, detailSlotId),
      )
      .find(Boolean);
  const workshopSlotIdsFor = (slotId) => slotIdsIn(section, slotId);
  const resolvedActiveSlot =
    section === "gunpacks"
      ? workshopWeaponSlots.find((slot) => slot.id === activeWorkshopSlotId)
      : section === "redux"
        ? reduxVisualSlots.find((slot) => slot.id === activeWorkshopSlotId)
        : (catalogLandingSlots[section] || []).find(
            (slot) => slot.id === activeWorkshopSlotId,
          );
  const activeSlot = resolvedActiveSlot;
  const activeSlotGroup =
    section === "redux"
      ? reduxVisualSlots.find((slot) => slot.id === selectedReduxGroupId)
      : activeSlot;
  const publishedSlotMods =
    section === "gunpacks" && weaponMode === "packs"
      ? sectionMods.filter((mod) => mod.catalogMode === "pack")
      : section === "clothing" && clothingMode === "packs"
        ? sectionMods.filter(
            (mod) =>
              mod.catalogMode === "pack" || mod.catalogSlot === "outfit-pack",
          )
        : workshopModIndex.modsForSlot(section, activeWorkshopSlotId);
  const activeSlotNameForFallback =
    section === "gunpacks"
      ? localized(activeSlot?.labels)
      : localized(activeSlot?.title);
  const fallbackSlotMods = activeWorkshopSlotId
    ? workshopFallbackOptions(
        section,
        activeWorkshopSlotId,
        activeSlotNameForFallback,
        activeSlot,
        locale,
      )
    : [];
  const vanillaResetOption = fallbackSlotMods.find((mod) => mod.isVanilla);
  const baseSelectedMods = publishedSlotMods.length
    ? [vanillaResetOption, ...publishedSlotMods].filter(Boolean)
    : fallbackSlotMods;
  const localMinimapWorks =
    activeWorkshopSlotId === "minimap"
      ? readLocalMinimapWorkVariants(locale)
      : [];
  const selectedMods = expandWorkshopPreviewRows(
    [...baseSelectedMods, ...localMinimapWorks],
    activeWorkshopSlotId,
  );
  const deferredSlotSearch = useDeferredValue(slotSearch);
  const normalizedSlotSearch = deferredSlotSearch
    .trim()
    .toLocaleLowerCase(locale);
  const normalizedModSearchText = (mod) =>
    [
      mod.name,
      mod.author,
      mod.description,
      ...(Array.isArray(mod.tags) ? mod.tags : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase(locale);
  /* Полка без поиска и сортировки: что на ней стоит, решает раздел, а в
     библиотеке — ещё и то, что установлено. */
  const displayedWeaponCatalogSlots = resolveVisibleWeaponSlots(
    workshopWeaponSlots,
    {
      expanded: weaponCatalogDisclosure.renderedExpanded,
      hasActiveFilter: false,
    },
  );
  const sectionSlots = catalogLandingSlots[section] || [];
  /* Полка редакторов. Какая плитка — редактор, знает реестр редакторов: тот
     же, что открывает её по нажатию. Полки «Каталог модов» в мастерской
     больше нет (2026-09-15): готовые моды ставят из каталога, а что из них
     стоит в игре, показывает библиотека. */
  const editorSlotIn = (sectionId) => (slot) =>
    workshopEditorExists({ slotId: slot.id, section: sectionId });
  const isWorkshopEditorSlot = editorSlotIn(section);
  const reduxEditorSlots = splitWorkshopLibrarySlots(
    reduxRootVisualSlots,
    isWorkshopEditorSlot,
  ).editors;
  /* Число редакторов в шапке мастерской не зависит от открытой вкладки: «Редакторы 39» на любой. */
  const reduxEditorCount = splitWorkshopLibrarySlots(
    reduxRootVisualSlots,
    editorSlotIn("redux"),
  ).editors.length;
  const otherEditorSlots = splitWorkshopLibrarySlots(
    sectionSlots,
    isWorkshopEditorSlot,
  ).editors;
  const inferModServers = (mod) => {
    if (Array.isArray(mod.servers) && mod.servers.length) return mod.servers;
    const text = normalizedModSearchText(mod);
    const servers = [];
    if (/majestic|мажест/i.test(text)) servers.push("majestic");
    if (/gta\s*5\s*rp|gta5rp|5rp/i.test(text)) servers.push("gta5rp");
    return servers.length ? servers : ["gta5rp", "majestic"];
  };
  const filteredSelectedMods = selectedMods
    .filter(
      (mod) =>
        packServerFilter === "all" ||
        inferModServers(mod).includes(packServerFilter),
    )
    .filter((mod) => {
      if (!normalizedSlotSearch) return true;
      return normalizedModSearchText(mod).includes(normalizedSlotSearch);
    });
  const installedSelectedSlotMod = workshopModIndex.installedForSlot(
    section,
    activeWorkshopSlotId,
  );
  const primaryVariant = resolveWorkshopVariant({
    mods: selectedMods,
    visibleMods: filteredSelectedMods,
    selectedVariant,
    installedVariant: installedSelectedSlotMod,
  });
  const workshopPreviewSourceKey = selectedMods
    .filter((mod) => !mod.isVanilla)
    .map((mod) => coverFor(mod))
    .join("\n");
  useEffect(() => {
    if (!activeWorkshopSlotId) return;
    workshopPreviewSourceKey
      .split("\n")
      .filter(Boolean)
      .forEach((source) => void preloadWorkshopImage(source));
  }, [activeWorkshopSlotId, workshopPreviewSourceKey]);
  const primaryVariantInstalled = Boolean(
    primaryVariant && installed.includes(primaryVariant.id),
  );
  const primaryVariantVanillaActive = Boolean(
    primaryVariant?.isVanilla && !installedSelectedSlotMod,
  );
  const activeWorkshopOperation = queue.find(
    (item) =>
      item.id ===
        (primaryVariant?.isVanilla
          ? installedSelectedSlotMod?.id
          : primaryVariant?.id) &&
      (item.operation === "install" || item.operation === "remove"),
  );
  const workshopSectionNames = {
    ru: {
      redux: tr("Редуксы"),
      gunpacks: tr("Оружие"),
      clothing: tr("Одежда"),
      other: tr("Другое"),
    },
    en: {
      redux: "Graphics",
      gunpacks: "Weapons",
      clothing: "Clothing",
      other: "Other",
    },
    de: {
      redux: "Grafik",
      gunpacks: "Waffen",
      clothing: "Kleidung",
      other: "Andere",
    },
    pl: {
      redux: "Grafika",
      gunpacks: "Broń",
      clothing: "Ubrania",
      other: "Inne",
    },
    fr: {
      redux: "Redux",
      gunpacks: "Armes",
      clothing: "Vêtements",
      other: "Autre",
    },
  };
  const sectionLabels = Object.fromEntries(
    catalogSections.map((item) => [
      item.id,
      workshopSectionNames[locale]?.[item.id] ||
        item.labels[language] ||
        item.labels.en,
    ]),
  );
  const catalogRootCopy = {
    ru: {
      eyebrow: tr("Библиотека Astral"),
      title: tr("Выберите направление"),
      description:
        tr("Редуксы, оружие, одежда и настройки игры — в отдельных понятных разделах."),
      cards: {
        redux: [tr("Редуксы"), tr("Все установленные визуальные улучшения по слотам")],
        gunpacks: [tr("Оружие"), tr("Установленные модели для каждого оружия")],
        clothing: [tr("Одежда"), tr("Элементы образа и экипировка")],
        settings: [tr("Настройки"), tr("Готовые игровые пресеты")],
      },
    },
    en: {
      eyebrow: "Astral library",
      title: "Choose a direction",
      description:
        "Graphics, weapons, clothing and game settings live in clear dedicated sections.",
      cards: {
        redux: [
          "Graphics",
          "Every installed visual upgrade, organized by slot",
        ],
        gunpacks: ["Weapons", "Installed models for each weapon slot"],
        clothing: ["Clothing", "Outfits and equipment"],
        settings: ["Settings", "Ready-to-use game presets"],
      },
    },
    de: {
      eyebrow: "Astral-Bibliothek",
      title: "Bereich auswählen",
      description:
        "Grafik, Waffen, Kleidung und Spieleinstellungen in klaren Bereichen.",
      cards: {
        redux: ["Grafik", "Alle installierten visuellen Slots"],
        gunpacks: ["Waffen", "Installierte Modelle für jeden Waffen-Slot"],
        clothing: ["Kleidung", "Outfits und Ausrüstung"],
        settings: ["Einstellungen", "Fertige Spielprofile"],
      },
    },
    pl: {
      eyebrow: "Biblioteka Astral",
      title: "Wybierz kategorię",
      description:
        "Grafika, broń, ubrania i ustawienia gry w przejrzystych sekcjach.",
      cards: {
        redux: ["Grafika", "Wszystkie zainstalowane ulepszenia według slotów"],
        gunpacks: ["Broń", "Zainstalowane modele dla każdego slotu broni"],
        clothing: ["Ubrania", "Stylizacje i wyposażenie"],
        settings: ["Ustawienia", "Gotowe profile gry"],
      },
    },
    fr: {
      eyebrow: "Bibliothèque Astral",
      title: "Choisissez une catégorie",
      description:
        "Redux, armes, vêtements et paramètres du jeu, dans des sections claires.",
      cards: {
        redux: ["Redux", "Toutes les améliorations visuelles installées, par emplacement"],
        gunpacks: ["Armes", "Modèles installés pour chaque arme"],
        clothing: ["Vêtements", "Tenues et équipement"],
        settings: ["Paramètres", "Préréglages de jeu prêts à l'emploi"],
      },
    },
  }[locale];
  const catalogRootCards = [
    { id: "redux", image: "/media/showcase/sky-dawn.webp" },
    { id: "gunpacks", image: "/media/mod-cannabis.webp" },
    { id: "clothing", image: "/media/gta-hero.jpg" },
  ];

  const catalogModeCopy = {
    ru: {
      title: {
        redux: tr("Как настроить графику?"),
        gunpacks: tr("Как подобрать оружие?"),
        clothing: tr("Как собрать образ?"),
      },
      description:
        tr("Выберите готовый вариант или соберите всё по отдельным элементам."),
      packs: {
        redux: [
          tr("Готовые сборки"),
          tr("Полный Redux с совместимыми визуальными заменами"),
        ],
        gunpacks: [tr("Ганпаки"), tr("Готовые комплекты моделей оружия")],
        clothing: [tr("Готовые комплекты"), tr("Собранные образы и экипировка")],
      },
      custom: {
        redux: [tr("Кастомизация"), tr("Настройте окружение по отдельным категориям")],
        gunpacks: [tr("Кастомизация"), tr("Выберите модель для каждого оружия")],
        clothing: [tr("Кастомизация"), tr("Соберите одежду по отдельным элементам")],
      },
    },
    en: {
      title: {
        redux: "How would you like to tune graphics?",
        gunpacks: "How would you like to choose weapons?",
        clothing: "How would you like to build an outfit?",
      },
      description:
        "Choose a complete option or customize every element separately.",
      packs: {
        redux: [
          "Complete packs",
          "A full Redux with compatible visual replacements",
        ],
        gunpacks: ["Gunpacks", "Complete weapon model collections"],
        clothing: ["Complete outfits", "Ready-made looks and equipment"],
      },
      custom: {
        redux: ["Customization", "Tune the environment category by category"],
        gunpacks: ["Customization", "Choose a model for each weapon"],
        clothing: ["Customization", "Build an outfit element by element"],
      },
    },
    de: {
      title: {
        redux: "Wie möchtest du die Grafik anpassen?",
        gunpacks: "Wie möchtest du Waffen auswählen?",
        clothing: "Wie möchtest du dein Outfit erstellen?",
      },
      description:
        "Wähle ein komplettes Paket oder passe jedes Element einzeln an.",
      packs: {
        redux: [
          "Fertige Pakete",
          "Ein vollständiges Redux mit passenden Ersetzungen",
        ],
        gunpacks: ["Waffenpacks", "Fertige Sammlungen von Waffenmodellen"],
        clothing: ["Fertige Outfits", "Komplette Looks und Ausrüstung"],
      },
      custom: {
        redux: ["Anpassen", "Passe die Umgebung Kategorie für Kategorie an"],
        gunpacks: ["Anpassen", "Wähle für jede Waffe ein Modell"],
        clothing: [
          "Anpassen",
          "Stelle dein Outfit Element für Element zusammen",
        ],
      },
    },
    pl: {
      title: {
        redux: "Jak chcesz ustawić grafikę?",
        gunpacks: "Jak chcesz wybrać broń?",
        clothing: "Jak chcesz stworzyć strój?",
      },
      description: "Wybierz gotowy zestaw albo dostosuj każdy element osobno.",
      packs: {
        redux: ["Gotowe zestawy", "Pełny Redux ze zgodnymi zamiennikami"],
        gunpacks: ["Paczki broni", "Gotowe kolekcje modeli broni"],
        clothing: ["Gotowe stroje", "Kompletne stylizacje i wyposażenie"],
      },
      custom: {
        redux: ["Personalizacja", "Dostosuj otoczenie według kategorii"],
        gunpacks: ["Personalizacja", "Wybierz model dla każdej broni"],
        clothing: ["Personalizacja", "Zbuduj strój element po elemencie"],
      },
    },
    fr: {
      title: {
        redux: "Comment régler les graphismes\u00a0?",
        gunpacks: "Comment choisir vos armes\u00a0?",
        clothing: "Comment composer votre tenue\u00a0?",
      },
      description:
        "Choisissez un ensemble prêt à l'emploi ou personnalisez chaque élément séparément.",
      packs: {
        redux: [
          "Builds prêts à l'emploi",
          "Un Redux complet avec des remplacements visuels compatibles",
        ],
        gunpacks: ["Gunpacks", "Collections de modèles d'armes prêtes à l'emploi"],
        clothing: ["Ensembles prêts à l'emploi", "Tenues complètes et équipement"],
      },
      custom: {
        redux: ["Personnalisation", "Réglez l'environnement catégorie par catégorie"],
        gunpacks: ["Personnalisation", "Choisissez un modèle pour chaque arme"],
        clothing: ["Personnalisation", "Composez votre tenue élément par élément"],
      },
    },
  }[locale];

  const catalogModeCards = {
    redux: [
      { mode: "packs", image: "/media/astral-redux-packs.jpg" },
      { mode: "selective", image: "/media/showcase/sky-dawn.webp" },
    ],
    gunpacks: [
      { mode: "packs", image: "/media/astral-gunpacks.webp" },
      { mode: "selective", image: "/media/mod-rifle.png" },
    ],
    clothing: [
      { mode: "packs", image: "/media/astral-outfit-packs.webp" },
      {
        mode: "selective",
        image: "/assets/catalog/clothing/armor.svg",
        fit: "contain",
      },
    ],
  };

  const activeMode =
    section === "redux"
      ? reduxMode
      : section === "gunpacks"
        ? weaponMode
        : section === "clothing"
          ? clothingMode
          : null;

  const setActiveMode = (mode) => {
    if (section === "redux") setReduxMode(mode);
    if (section === "gunpacks") setWeaponMode(mode);
    if (section === "clothing") setClothingMode(mode);
    setSelectedSlot(null);
    setSlotSearch("");
    setPackSearch("");
    setPackFavoritesOnly(false);
    setPackServerFilter("all");
    setPackPurposeFilter("all");
    setSelectedVariant(null);
    setSlotEntryMode(null);
  };

  /*
   * «Оружие» — сразу мастерская (ТЗ 06.10.2026, вечер, задача 2): сетки
   * стволов больше нет, ствол выбирают карточкой «Ствол» на самом кадре.
   * Мастерская открывается на последнем стволе (впервые — на карабине), а
   * выход из неё ведёт в «Редакторы» — раздел под ней уже стоит.
   */
  slotCatalogRef.current = (section, slot) =>
    section === "clothing"
      ? clothingCatalogItems(wearSlotMods(clothingModIndex, slot))
      : workshopModIndex.modsForSection(section);

  /*
   * «Одежда» — тоже сразу мастерская: персонаж в белье, и сразу выбрано
   * «Тело» (фикс 2 ТЗ 07.10.2026) — инструменты работают с порога. Другую
   * категорию человек берёт в «Редактирую» слева в углу кадра, как ствол у
   * оружия. Выход — в «Редакторы».
   */
  const openClothingStudio = () => {
    setSection("redux");
    setReduxMode("selective");
    editors.request({
      slotId: "tattoos",
      section: "clothing",
      catalog: clothingCatalogItems(
        clothingModIndex.modsForSlot("clothing", "tattoos"),
      ),
    });
  };

  /*
   * «Оптимизация» — тоже сразу студия (ТЗ 22.10.2026, п. F): инструменты слева, кадр, настройки справа, как у
   * оружия и одежды. Выход — в «Редакторы».
   */
  const openOptimizerStudio = () => {
    setSection("redux");
    setReduxMode("selective");
    editors.request({ section: "optimization" });
  };

  /* «Анимации» — тоже сразу студия (ТЗ 29.10.2026-d): список слева, два окна проигрывания справа. Выход — в «Редакторы». */
  const openAnimationsStudio = () => {
    setSection("redux");
    setReduxMode("selective");
    editors.request({ section: "animations" });
  };

  const openWeaponStudio = () => {
    setSection("redux");
    setReduxMode("selective");
    editors.request({
      slotId: lastWeaponSlot((slot) =>
        workshopWeaponSlots.some((item) => item.id === slot),
      ),
      section: "gunpacks",
      catalog: workshopModIndex.modsForSection("gunpacks"),
    });
  };

  /* Вход в «Оружие» откуда угодно — именованный переход, память раздела —
     тоже сразу мастерская. */
  useEffect(() => {
    if (isLibrary || editors.isOpen) return;
    if (section === "gunpacks") openWeaponStudio();
    else if (section === "clothing") openClothingStudio();
    else if (section === "animations") openAnimationsStudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLibrary, section, editors.isOpen]);

  const chooseSection = (id) => {
    if (!isLibrary && id === "gunpacks") {
      openWeaponStudio();
      return;
    }
    if (!isLibrary && id === "clothing") {
      openClothingStudio();
      return;
    }
    if (!isLibrary && id === "animations") {
      openAnimationsStudio();
      return;
    }
    setSection(id);
    setSelectedSlot(null);
    setSlotSearch("");
    setWeaponCatalogExpanded(false);
    setPackSearch("");
    setPackFavoritesOnly(false);
    setPackServerFilter("all");
    setPackPurposeFilter("all");
    setSelectedVariant(null);
    setSlotEntryMode(null);
    if (id === "redux") setReduxMode("selective");
    if (id === "gunpacks") setWeaponMode("selective");
    if (id === "clothing") setClothingMode("selective");
  };

  const packCatalogCopy = {
    ru: {
      eyebrow: tr("Готовые сборки"),
      title: tr("Выберите готовый Redux"),
      description:
        tr("Полные графические наборы с единым стилем. Откройте сборку, чтобы посмотреть состав и установить её."),
      search: tr("Поиск по названию или автору"),
      newest: tr("Сначала новые"),
      oldest: tr("Сначала старые"),
      downloads: tr("По скачиваниям"),
      likes: tr("По лайкам"),
      modifications: tr("модификаций"),
      favorites: tr("Понравившиеся"),
      noFavorites: tr("Здесь появятся понравившиеся модификации"),
      preview: tr("Предпросмотр"),
    },
    en: {
      eyebrow: "Complete packs",
      title: "Choose a ready-made Redux",
      description:
        "Complete graphics collections with one visual direction. Open a pack to review and install it.",
      search: "Search by title or author",
      newest: "Newest first",
      oldest: "Oldest first",
      downloads: "Most downloaded",
      likes: "Most liked",
      modifications: "modifications",
      favorites: "Favorites",
      noFavorites: "Liked modifications will appear here",
      preview: "Preview",
    },
    de: {
      eyebrow: "Fertige Pakete",
      title: "Fertiges Redux auswählen",
      description:
        "Vollständige Grafikpakete mit einem einheitlichen Stil. Öffne ein Paket, um es anzusehen und zu installieren.",
      search: "Nach Name oder Autor suchen",
      newest: "Neueste zuerst",
      oldest: "Älteste zuerst",
      downloads: "Meiste Downloads",
      likes: "Meiste Likes",
      modifications: "Modifikationen",
      favorites: "Favoriten",
      noFavorites: "Deine favorisierten Modifikationen erscheinen hier",
      preview: "Vorschau",
    },
    pl: {
      eyebrow: "Gotowe zestawy",
      title: "Wybierz gotowy Redux",
      description:
        "Kompletne zestawy graficzne w jednym stylu. Otwórz zestaw, aby go sprawdzić i zainstalować.",
      search: "Szukaj po nazwie lub autorze",
      newest: "Najnowsze",
      oldest: "Najstarsze",
      downloads: "Najwięcej pobrań",
      likes: "Najwięcej polubień",
      modifications: "modyfikacji",
      favorites: "Ulubione",
      noFavorites: "Tutaj pojawią się polubione modyfikacje",
      preview: "Podgląd",
    },
    fr: {
      eyebrow: "Builds prêts à l'emploi",
      title: "Choisissez un Redux prêt à l'emploi",
      description:
        "Des ensembles graphiques complets au style unifié. Ouvrez un build pour voir son contenu et l'installer.",
      search: "Rechercher par titre ou auteur",
      newest: "Plus récents d'abord",
      oldest: "Plus anciens d'abord",
      downloads: "Plus téléchargés",
      likes: "Plus aimés",
      modifications: "mods",
      favorites: "Favoris",
      noFavorites: "Les mods que vous aimez apparaîtront ici",
      preview: "Aperçu",
    },
  }[locale];
  const actualPackMods = sectionMods.filter((mod) => {
    if (section === "redux") {
      return mod.catalogMode === "pack" || mod.catalogSlot === "redux-pack";
    }
    if (section === "clothing") {
      return mod.catalogMode === "pack" || mod.catalogSlot === "outfit-pack";
    }
    return mod.catalogMode === "pack";
  });
  const previewPackItemsBySection = {
    redux: reduxPreviewPacks,
    gunpacks: gunpackPreviewPacks,
  };
  const packItems = actualPackMods.length
    ? actualPackMods
    : previewPackItemsBySection[section] || [];
  const packSearchText = (mod) =>
    [
      mod.name,
      mod.author,
      mod.description,
      ...(Array.isArray(mod.tags) ? mod.tags : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase(locale);
  const getPackServers = (mod) => {
    if (Array.isArray(mod.servers) && mod.servers.length) return mod.servers;
    const text = packSearchText(mod);
    const servers = [];
    if (/majestic|мажест/i.test(text)) servers.push("majestic");
    if (/gta\s*5\s*rp|gta5rp|5rp/i.test(text)) servers.push("gta5rp");
    return servers.length ? servers : ["gta5rp", "majestic"];
  };
  const getPackPurposes = (mod) => {
    if (Array.isArray(mod.purposes) && mod.purposes.length) return mod.purposes;
    const text = packSearchText(mod);
    const purposes = [];
    if (/fps|boost|оптим/i.test(text)) purposes.push("fps");
    if (/выбив|knock/i.test(text)) purposes.push("knockout");
    if (/тулив|pvp|combat/i.test(text)) purposes.push("combat");
    if (/rp|redux/i.test(text)) purposes.push("rp");
    return purposes.length ? purposes : ["rp", "fps", "knockout", "combat"];
  };
  const normalizedPackSearch = packSearch.trim().toLocaleLowerCase(locale);
  const foundPackItems = packItems
    .filter((mod) => !packFavoritesOnly || favorites.includes(mod.id))
    .filter(
      (mod) =>
        packServerFilter === "all" ||
        getPackServers(mod).includes(packServerFilter),
    )
    .filter(
      (mod) =>
        section !== "redux" ||
        packPurposeFilter === "all" ||
        getPackPurposes(mod).includes(packPurposeFilter),
    )
    .filter((mod) => packSearchText(mod).includes(normalizedPackSearch));
  /* Новые и старые — по дате исходного поста, как в Discord (Т-71). */
  const visiblePackItems =
    packSort === "downloads" || packSort === "likes"
      ? foundPackItems.sort(
          (left, right) =>
            Number(right[packSort] || 0) - Number(left[packSort] || 0),
        )
      : newestFirst(foundPackItems, { oldest: packSort === "oldest" });

  const packSortOptions = [
    { value: "newest", label: packCatalogCopy.newest },
    { value: "oldest", label: packCatalogCopy.oldest },
    { value: "downloads", label: packCatalogCopy.downloads },
    { value: "likes", label: packCatalogCopy.likes },
  ];
  const selectedPackSort =
    packSortOptions.find((option) => option.value === packSort) ||
    packSortOptions[0];
  const packServerFilters = [
    {
      value: "all",
      label: { ru: tr("Все"), en: "All", de: "Alle", pl: "Wszystkie", fr: "Tous" }[locale],
    },
    { value: "gta5rp", label: "GTA 5 rp", mark: "5RP" },
    { value: "majestic", label: "Majestic", mark: "✦" },
  ];
  const reduxPurposeFilters = [
    {
      value: "all",
      label: {
        ru: tr("Все сборки"),
        en: "All packs",
        de: "Alle Pakete",
        pl: "Wszystkie",
        fr: "Tous les builds",
      }[locale],
    },
    { value: "rp", label: "RP Redux" },
    { value: "fps", label: "FPS Boost" },
    {
      value: "knockout",
      label: {
        ru: tr("Для выбивания"),
        en: "Knockout",
        de: "Knockout",
        pl: "Knockout",
        fr: "Knockout",
      }[locale],
    },
    {
      value: "combat",
      label: {
        ru: tr("Для тулива"),
        en: "Combat",
        de: "Combat",
        pl: "Combat",
        fr: "Combat",
      }[locale],
    },
  ];

  const renderPackCatalog = () => (
    <section ref={packCatalogRef} className="astral-pack-catalog">
      <div className="astral-pack-toolbar">
        <label className="astral-pack-search">
          <MagnifyingGlass />
          <input
            value={packSearch}
            onChange={(event) => setPackSearch(event.target.value)}
            placeholder={packCatalogCopy.search}
          />
        </label>
        <div className="astral-pack-actions">
          <button
            type="button"
            className={`astral-pack-favorites-filter${packFavoritesOnly ? " is-active" : ""}`}
            aria-label={packCatalogCopy.favorites}
            aria-pressed={packFavoritesOnly}
            title={packCatalogCopy.favorites}
            onClick={() => setPackFavoritesOnly((active) => !active)}
          >
            <Heart weight={packFavoritesOnly ? "fill" : "regular"} />
          </button>
          <MenuButton
            className="astral-pack-sort"
            variant="ghost"
            label={selectedPackSort.label}
            options={packSortOptions}
            value={packSort}
            onSelect={setPackSort}
            align="end"
          />
        </div>
      </div>
      <div className="astral-pack-filters">
        <div
          className="astral-pack-filter-group is-server"
          aria-label={
            locale === "ru"
              ? tr("Фильтр по серверу")
              : locale === "fr"
                ? "Filtre par serveur"
                : "Server filter"
          }
        >
          {packServerFilters.map((option) => (
            <button
              key={option.value}
              type="button"
              className={packServerFilter === option.value ? "is-active" : ""}
              aria-pressed={packServerFilter === option.value}
              onClick={() => setPackServerFilter(option.value)}
            >
              {option.mark && (
                <span
                  className={`astral-pack-filter-mark${option.value === "majestic" ? " is-majestic" : ""}`}
                >
                  {option.mark}
                </span>
              )}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        {section === "redux" && (
          <div
            className="astral-pack-filter-group is-purpose"
            aria-label={
              locale === "ru"
                ? tr("Назначение сборки")
                : locale === "fr"
                  ? "Usage du build"
                  : "Pack purpose"
            }
          >
            {reduxPurposeFilters.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  packPurposeFilter === option.value ? "is-active" : ""
                }
                aria-pressed={packPurposeFilter === option.value}
                onClick={() => setPackPurposeFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="astral-pack-grid">
        {visiblePackItems.map((mod) => {
          const ready = installed.includes(mod.id);
          const liked = favorites.includes(mod.id);
          /* Сборку ставят её части (Т-81c) — кнопка у каждой части на
             странице сборки; своей, пока нет Т-81d, у неё нет. */
          const action = !mod.previewOnly && !isCatalogBundle(mod);
          return (
            <article
              key={mod.id}
              onClick={() => onSelect(mod)}
              className={mod.previewOnly ? "is-preview" : ""}
            >
              <div className="astral-pack-media">
                <img src={coverFor(mod)} alt="" />
                <div className="astral-pack-product-meta" aria-hidden="true">
                  <span>Redux</span>
                  <span>GTA V</span>
                  <span>Majestic</span>
                </div>
                <div className="astral-pack-media-copy">
                  <h3>{mod.name}</h3>
                </div>
                <div
                  className={`astral-pack-media-stats${action ? " has-action" : ""}`}
                >
                  <div className="astral-pack-downloads">
                    <DownloadSimple />
                    <span>
                      {Number(mod.downloads || 0).toLocaleString(locale)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`astral-pack-like${liked ? " is-liked" : ""}`}
                    aria-label={packCatalogCopy.favorites}
                    aria-pressed={liked}
                    title={packCatalogCopy.favorites}
                    onClick={(event) => {
                      event.stopPropagation();
                      onFavorite?.(mod);
                    }}
                  >
                    <Heart weight={liked ? "fill" : "regular"} />
                  </button>
                </div>
                {action && (
                  <button
                    className="astral-pack-media-action"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (ready) onLaunch(mod);
                      else onInstall(mod);
                    }}
                  >
                    {ready ? <Play /> : <DownloadSimple />}
                    {ready ? copy.launch : copy.install}
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!visiblePackItems.length && (
          <div className="astral-pack-filter-empty">
            {packFavoritesOnly ? <Heart /> : <MagnifyingGlass />}
            <b>
              {packFavoritesOnly
                ? packCatalogCopy.noFavorites
                : {
                    ru: tr("По этим фильтрам ничего не найдено"),
                    en: "Nothing matches these filters",
                    de: "Keine passenden Ergebnisse",
                    pl: "Brak wyników dla tych filtrów",
                    fr: "Aucun résultat pour ces filtres",
                  }[locale]}
            </b>
          </div>
        )}
      </div>
    </section>
  );

  const activeSlotTitle =
    section === "gunpacks"
      ? localized(activeSlot?.labels)
      : localized(activeSlot?.title);
  const activeSlotDescription = localized(activeSlot?.description);
  const handleWorkshopMediaLoad = (event) => {
    event.currentTarget.removeAttribute("data-media-error");
    event.currentTarget.parentElement?.classList.remove("is-missing");
  };

  const handleWorkshopMediaError = (event) => {
    event.currentTarget.dataset.mediaError = "true";
    event.currentTarget.parentElement?.classList.add("is-missing");
  };

  /*
   * Галерея слота в названном разделе. С полки библиотеки карточка оружия
   * открывает галерею оружия, а карточка работы — свою, какой бы раздел ни
   * остался открытым: раздел переключается вместе со слотом, и галерея,
   * заголовок и «Удалить» читают его уже новым.
   */
  const openSlotIn = (sectionId, slotId) => {
    if (sectionId !== section) {
      setSection(sectionId);
      if (sectionId === "redux") setReduxMode("selective");
      if (sectionId === "gunpacks") setWeaponMode("selective");
      if (sectionId === "clothing") setClothingMode("selective");
    }
    const groupId = sectionId === "redux" ? reduxGroupIdFor(slotId) : slotId;
    scrollWorkshopSurfaceToTop();
    setSelectedVariant(null);
    setSelectedSlot(groupId);
    setReduxDetailSlot(
      sectionId === "redux" ? resolveReduxDetailSlotId(groupId, slotId) : null,
    );
    setSlotEntryMode("catalog");
  };
  const openWorkshopSlot = (slotId) => openSlotIn(section, slotId);

  const selectReduxDetailSlot = (slotId) => {
    if (slotId === activeWorkshopSlotId) return;
    setReduxDetailSlot(slotId);
  };

  const installWorkshopVariant = async (mod = primaryVariant) => {
    if (!mod) return;
    if (mod.isVanilla && !installedSelectedSlotMod) return;
    if (!mod.isVanilla && installed.includes(mod.id)) {
      onRemove?.(mod);
      return;
    }
    if (mod.isVanilla) {
      setSlotPreviewOverrides((current) => {
        const next = { ...current };
        delete next[activeWorkshopSlotId];
        return next;
      });
      if (installedSelectedSlotMod) onRemove?.(installedSelectedSlotMod);
      setSelectedVariant(mod);
      return;
    }
    const preview = await renderFilteredWorkshopPreview(
      coverFor(mod),
      mod.imageFilter,
    );
    setSlotPreviewOverrides((current) => ({
      ...current,
      [activeWorkshopSlotId]: preview,
    }));
    onInstall?.(mod);
  };

  const activeVariantModel =
    primaryVariant?.modelUrl ||
    primaryVariant?.model ||
    (["gunpacks", "clothing"].includes(section) && primaryVariant?.isVanilla
      ? activeSlot?.model
      : "");
  const activeVariantFallbackModel =
    primaryVariant?.fallbackModel ||
    (section === "clothing" ? activeSlot?.fallbackModel : "");
  const activeVariantSupports3D = Boolean(
    (section === "gunpacks" && activeVariantModel && primaryVariant) ||
    (section === "clothing" && activeVariantModel && primaryVariant),
  );
  useEffect(() => {
    setWeaponViewerOpen(false);
  }, [primaryVariant?.id, section, selectedSlot, setWeaponViewerOpen]);
  const primaryVariantDownloads = Number(
    primaryVariant?.downloads ??
      primaryVariant?.downloadCount ??
      primaryVariant?.installs ??
      0,
  );

  /*
   * Карточка слота — одна на мастерскую и на библиотеку.
   *
   * Плитка редактора отличается карандашом в углу, а её «установлено»
   * берётся и из записей самих редакторов: работа человека уезжает в игру
   * патчем, а не модом с id из каталога.
   */
  const editorMarkIn = (sectionId, slot) =>
    slotIdsIn(sectionId, slot.id)
      .map((slotId) => installMarks.get(slotId))
      .find(Boolean) || null;
  const slotInstalledIn = (sectionId) => (slot) =>
    Boolean(installedIn(sectionId, slot.id) || editorMarkIn(sectionId, slot));
  const workshopEditorMarkFor = (slot) => editorMarkIn(section, slot);

  /*
   * Куда ведёт карточка библиотеки.
   *
   * Опубликованный мод — в галерею своего слота, ту же, что в мастерской, с
   * кнопкой «Удалить». Работа редактора, у которой мода в каталоге нет (своё
   * небо, свой прицел, своя мини-карта), — на карточку самой работы: с неё
   * видно, что стоит в игре, и с неё же работу правят и снимают. Раньше
   * плитка открывала редактор сразу, и человек оказывался среди ползунков,
   * не увидев ни работы, ни кнопки «Удалить из игры».
   */
  const openLibrarySlot = (slot, sectionId = section) => {
    /* Опубликованный мод, что стоит в игре, — его собственная карточка,
       ровно тот мод, а не галерея слота со стандартным описанием раздела
       (задача 4 ТЗ 08.10, вечер). «Назад» вернёт в библиотеку. */
    const installedMod = installedIn(sectionId, slot.id);
    if (installedMod && onSelect) {
      onSelect(installedMod);
      return;
    }
    if (
      installedMod ||
      !editorMarkIn(sectionId, slot) ||
      !workshopEditorExists({ slotId: slot.id, section: sectionId })
    ) {
      openSlotIn(sectionId, slot.id);
      return;
    }
    /* Карточка работы читает отметку и редактор по открытому разделу — он
       становится разделом работы. */
    if (sectionId !== section) setSection(sectionId);
    scrollWorkshopSurfaceToTop();
    setWorkCardSlot(slot.id);
  };

  /*
   * Плитка редактора открывает сам редактор, а не галерею слота.
   *
   * Галерея — витрина каталога: варианты, «Установить», счётчик скачиваний и
   * карандаш сбоку. На полке, где остались одни редакторы, она ставила между
   * плиткой и работой лишний экран с чужими модами, и главным действием на нём
   * было «Установить», а не «править». Своя работа, уже поставленная в игру,
   * открывается на том же проекте; без неё редактор заводит новую.
   */
  const openSlotEditor = (slot) => {
    const mark = workshopEditorMarkFor(slot);
    editors.request({
      slotId: slot.id,
      section,
      variant: mark?.sourceModId
        ? {
            id: mark.sourceModId,
            sourceModId: mark.sourceModId,
            name: mark.name,
            isUserWork: true,
          }
        : null,
    });
  };

  /* «Поставлено 8 октября 2026 г.» — или «Стоит в игре», если дата не
     записана: те же слова, что на карточке работы (`LibraryWorkCard`). */
  const libraryWorkLine = (slot, sectionId) => {
    const words = libraryCopy.library.work;
    const unit = installUnits.find((item) =>
      slotIdsIn(sectionId, slot.id).some((id) => item.slots?.includes(id)),
    );
    const rp = rpWords[rpWordsKey(unit)] || "";
    const time = Date.parse(unit?.installedAt || "");
    if (!Number.isFinite(time)) return rp ? `${words.installedUnknown} · ${rp}` : words.installedUnknown;
    const date = new Date(time).toLocaleDateString(
      { ru: "ru-RU", uk: "uk-UA", en: "en-US", de: "de-DE", pl: "pl-PL", fr: "fr-FR" }[copyLocale] || "en-US",
      { day: "numeric", month: "long", year: "numeric" },
    );
    const line = words.installedAt.replace("{date}", date);
    return rp ? `${line} · ${rp}` : line;
  };

  const renderWorkshopSlotCard = (
    slot,
    index,
    { kind, extraClass = "", onOpen = null, sectionId = section, poster = false },
  ) => {
    const installedMod = installedIn(sectionId, slot.id);
    const installedDetailSlotId = installedMod?.catalogSlot || slot.id;
    const slotPreview =
      slotPreviewOverrides[installedDetailSlotId] ||
      (installedMod ? coverFor(installedMod) : "");
    const slotInstalled = Boolean(installedMod);
    const editorMark = editorMarkIn(sectionId, slot);
    /* Работа без своего имени в библиотеке подписана тем, что о ней правда
       известно, — когда встала в игру, — а не стандартным описанием
       раздела (задача 4 ТЗ 08.10, вечер). */
    const workLine =
      isLibrary && editorMark && !editorMark.name
        ? libraryWorkLine(slot, sectionId)
        : "";
    /* Галочка «стоит в игре» — только в мастерской, где стоит не всё. В
       библиотеке установлено всё, что на полке, и галочка на каждой карточке
       ничего не различала (владелец, 24.09.2026). */
    const statusInstalled =
      !isLibrary && (slotInstalled || Boolean(editorMark));
    /* После отката update.rpf лаунчером полка не делает вид, что всё в игре. */
    const statusReverted =
      isLibrary && slotInstalled && libraryStatus?.status === "reverted";
    const coveredNote = coveredWordsOf(installedMod?.id);
    const slotTitle = localized(slot.title);
    const slotType = localized(slot.description);
    const selection = librarySelectionFor(slot);
    /* Плитка редактора на полке мастерской — штатная картинка вида, она не меняется от работы человека (владелец,
       25.10.2026); в библиотеке — работа, что стоит в игре: снимок кадра редактора, снятый при «Сохранить».
       Опубликованный мод в слоте показывается своей обложкой из каталога, как и раньше. */
    const cover =
      !slotInstalled && (kind === "editor" || isLibrary)
        ? isLibrary
          ? renderSlotCover(slot.id, installUnits)
          : renderStockCover(slot.id)
        : null;
    /* Мод из каталога стоит в слоте редактора, а его картинка не приехала или чёрная пустышка (ТЗ 44А, п. 0):
       плитка показывает обложку самого редактора, а не чёрный прямоугольник. */
    const installedPicture =
      slotInstalled && slotPreview && kind === "editor" && slotCoverSpec(slot.id, installUnits)
        ? (
            <InstalledPreview
              src={slotPreview}
              index={index}
              className={`redux-visual-image${String(slotPreviewOverrides[installedDetailSlotId] || "").startsWith("data:") ? " has-custom-workshop-preview" : ""}`}
              fallback={isLibrary ? renderSlotCover(slot.id, installUnits) : renderStockCover(slot.id)}
            />
          )
        : null;
    /* «Афиша» мастерской (дизайн 15.11.2026): те же данные плитки — обложка, «стоит в игре», открытие редактора, — но рисует их
       `WorkshopPoster`, а не карточка полки. */
    if (poster) {
      const posterPreview = slotInstalled ? slotPreview : "";
      const posterFallback = posterPreview || workshopPreviewFor(sectionId, slot.id, index);
      return {
        slot,
        title: slotTitle,
        description: installedMod ? dataName(installedMod.name) : editorMark?.name ? dataName(editorMark.name) : slotType,
        cover:
          cover ||
          installedPicture ||
          (posterFallback ? <WorkshopImage className="redux-visual-image" src={posterFallback} alt="" index={index} tile={shelfTile} /> : null),
        installed: statusInstalled,
        open: () => (onOpen ? onOpen(slot, sectionId) : openSlotIn(sectionId, slot.id)),
        warm: () => editors.warm({ slotId: slot.id, section: sectionId }),
      };
    }
    return (
      <WorkshopVisualSlotCard
        className={`redux-visual-card redux-visual-card-${slot.id}${extraClass ? ` ${extraClass}` : ""} ${slotInstalled ? "is-installed" : "is-empty"}`}
        key={slot.id}
        kind={kind}
        /* Чип только на том, что стоит в игре.
           «Не установлено» — состояние по умолчанию: им была подписана
           двадцать одна плитка из двадцати трёх, и полка читалась как список
           отказов. Отмечают исключение, а не правило; счётчик над полкой
           отвечает на тот же вопрос одной строкой. */
        status={statusInstalled ? "installed" : statusReverted ? "reverted" : coveredNote ? "covered" : null}
        statusLabel={statusInstalled ? libraryCopy.library.status.installed : statusReverted ? workshopLibraryDriftCopyFor(copyLocale).notInGame : coveredNote}
        preview={slotInstalled ? slotPreview : ""}
        // An empty slot still gets a representative preview. The card marks
        // it "is-suggested-preview", which reads as "nothing installed yet"
        // instead of the broken-image cross.
        fallbackPreview={workshopPreviewFor(sectionId, slot.id, index)}
        emptyMark="cross"
        tone={workshopToneFor(sectionId, slot.id, index)}
        customPreview={String(
          slotPreviewOverrides[installedDetailSlotId] || "",
        ).startsWith("data:")}
        /* В библиотеке стоит всё, что на полке, и карточка называет саму вещь:
           имя мода из каталога или то, что человек дал своей работе, а слот —
           подписью под ним (задача 4 ТЗ 08.10, вечер). В мастерской плитка —
           вход в редактор, и её имя — имя редактора. */
        title={
          isLibrary
            ? installedMod?.name || editorMark?.name
              ? dataName(installedMod?.name || editorMark?.name)
              : slotTitle
            : slotTitle
        }
        description={
          isLibrary
            ? installedMod?.name || editorMark?.name
              ? slotTitle
              : workLine || slotType
            : installedMod
              ? dataName(installedMod.name)
              : editorMark?.name
                ? dataName(editorMark.name)
                : slotType
        }
        mediaIndex={index}
        mediaNode={cover || installedPicture}
        {...selection}
        /* Плитка редактора: код редактора (и база эффектов из игры) начинают
           грузиться, пока рука идёт к щелчку. */
        onIntent={
          kind === "editor" && !selection.onToggle
            ? () => editors.warm({ slotId: slot.id, section: sectionId })
            : undefined
        }
        onClick={() =>
          selection.onToggle
            ? selection.onToggle()
            : onOpen
              ? onOpen(slot, sectionId)
              : openSlotIn(sectionId, slot.id)
        }
      />
    );
  };

  const renderWeaponSlotCard = (slot, index, catalogTier) => {
    const installedMod = workshopModIndex.installedForSlot("gunpacks", slot.id);
    const selection = librarySelectionFor(slot);
    const gameIcon = installedMod ? "" : shelfWeaponIcon(gameWeaponIcons, slot);
    return (
      <WorkshopWeaponSlotCard
        className={`weapon-slot-card${installedMod ? " is-installed" : ""}`}
        key={slot.id}
        preview={
          slotPreviewOverrides[slot.id] ||
          (installedMod ? coverFor(installedMod) : slot.image || gameIcon)
        }
        previewTreatment={weaponPreviewTreatmentFor(slot.id)}
        previewExposure={weaponPreviewExposureFor(slot.id)}
        previewContrast={weaponPreviewContrastFor(slot.id)}
        previewFailureNote={localized({
          ru: tr("Кадр не загрузился — ствол откроется в мастерской"),
          en: "Preview failed to load — the weapon still opens",
          fr: "Aperçu non chargé — l'arme s'ouvrira dans l'Atelier",
        })}
        tone={workshopToneFor("gunpacks", slot.id, index)}
        title={localized(slot.labels)}
        type={
          isLibrary && installedMod
            ? /* Сверху скин мастерской (Т-107b): ствол ждёт под ним. */
              libraryStatus?.covered?.some(
                (item) => item.modId === installedMod.id,
              )
              ? `${installedMod.name} · ${workshopLibraryDriftCopyFor(copyLocale).underMod}`
              : installedMod.name
            : /* Ствол без кадра в поставке: вместо рисунка — слова о том,
                 откуда придёт модель. */
              localized(slot.fromGame ? slot.note : slot.types)
        }
        mediaIndex={index}
        catalogTier={catalogTier}
        {...selection}
        onClick={
          selection.onToggle ||
          /* В мастерской ствол открывает свою мастерскую сразу — каталог
             модов этого ствола живёт в «Каталоге» и в библиотеке. */
          (isLibrary
            ? () => openSlotIn("gunpacks", slot.id)
            : () =>
                editors.request({
                  slotId: slot.id,
                  section: "gunpacks",
                  /* Скины стволов из каталога — у ствола свои готовые. */
                  catalog: workshopModIndex.modsForSection("gunpacks"),
                }))
        }
      />
    );
  };

  const renderClothingSlotCard = (slot, index) => {
    const installedMod = workshopModIndex.installedForSlot("clothing", slot.id);
    const selection = librarySelectionFor(slot);
    return (
      <WorkshopWeaponSlotCard
        className={`weapon-slot-card clothing-slot ${installedMod ? "is-installed" : "is-empty"}`}
        key={slot.id}
        preview={
          slotPreviewOverrides[slot.id] ||
          (installedMod ? coverFor(installedMod) : slot.image)
        }
        fallbackPreview={installedMod ? undefined : slot.fallbackImage}
        artworkKey={slot.id}
        previewTreatment="studio-transparent"
        previewExposure={clothingPreviewExposureFor(slot.id)}
        previewContrast={clothingPreviewContrastFor(slot.id)}
        tone={workshopToneFor("clothing", slot.id, index)}
        title={localized(slot.title)}
        type={installedMod ? [installedMod.name, coveredWordsOf(installedMod.id)].filter(Boolean).join(" · ") : localized(slot.description)}
        mediaIndex={index}
        {...selection}
        onClick={
          selection.onToggle ||
          /* В мастерской вещь открывает мастерскую покраски; готовые вещи
             каталога — в «Каталоге» и в библиотеке. */
          (isLibrary
            ? () => openSlotIn("clothing", slot.id)
            : () =>
                editors.request({
                  slotId: slot.id,
                  section: "clothing",
                  /* Вещи каталога этой категории — в «Вид» мастерской:
                     кофту из каталога берут за основу. */
                  catalog: clothingCatalogItems(
                    clothingModIndex.modsForSlot("clothing", slot.id),
                  ),
                }))
        }
      />
    );
  };

  const renderEditorShelf = (slots, { headless = false, ...options } = {}) =>
    slots.length > 0 && (
      <WorkshopLibraryGroup
        id="editors"
        title={libraryCopy.library.editors.title}
        summary={libraryCopy.library.editors.summary}
        headless={headless}
      >
        <div
          className="redux-visual-grid"
          data-workshop-shelf="editors"
          data-assembly-grid
        >
          {slots.map((slot, index) =>
            renderWorkshopSlotCard(slot, index, {
              onOpen: openSlotEditor,
              ...options,
              kind: "editor",
            }),
          )}
        </div>
      </WorkshopLibraryGroup>
    );


  /* «Афиша редакторов»: плитки полки редакторов и поиск из шапки мастерской. Большой шапки с последним редактором нет (владелец, 16.11.2026). */
  const renderEditorPoster = () => {
    const entries = reduxEditorSlots.map((slot, index) =>
      renderWorkshopSlotCard(slot, index, { kind: "editor", onOpen: openSlotEditor, poster: true }),
    );
    return <WorkshopPoster entries={entries} query={editorQuery} />;
  };

  /* Компоненты, которые после обновления игры ждут новой версии (А10, шаг 3): строка с причиной и «Обновить», кнопок «поставить силой» нет. */
  const renderLibraryWaiting = () =>
    isLibrary && checkRemoved.some(isWaiting) ? <WaitingMods items={checkRemoved} mods={data?.mods} language={language} onInstall={onInstall} /> : null;

  /* Архив игры не тот, что оставил Astral: карточки ниже могут врать, и
     библиотека говорит об этом первой строкой, а не прячет за «Установлено». */
  const renderLibraryDrift = ({ skipChecked = false } = {}) => {
    const status = libraryStatus?.status;
    const words = workshopLibraryDriftCopyFor(copyLocale);
    /* Проверка файлов игры сняла моды (задача 2 ТЗ 10.10.2026): работы и
       настройки на месте, и всё возвращается одной кнопкой. */
    const checked = isLibrary && !skipChecked
      ? checkRemoved.filter((item) => !isWaiting(item)).length + readParkedWorkshopUnits().length
      : 0;
    if (checked && onReinstallChecked)
      return (
        <section
          className="ui-panel workshop-library-drift"
          role="status"
          data-drift="checked"
        >
          <Warning aria-hidden="true" />
          <div>
            <b>{words.checked.title}</b>
            <p>
              {words.checked.text} {words.checked.count(checked)}.
            </p>
          </div>
          <Button
            variant="primary"
            disabled={restoring}
            onClick={async () => {
              setRestoring(true);
              await onReinstallChecked().catch(() => null);
              setRestoring(false);
            }}
          >
            {restoring ? words.checked.working : words.checked.action}
          </Button>
        </section>
      );
    /* «Моды при запуске игры» у копии Rockstar (задача 7): моды ждут рядом
       с игрой — это не поломка, а способ; строка об этом, без «Вернуть». */
    if (isLibrary && status === "intact" && libraryStatus?.parked)
      return (
        <section
          className="ui-panel workshop-library-drift"
          role="status"
          data-drift="parked"
        >
          <ShieldCheck aria-hidden="true" />
          <div>
            <b>{words.parked.title}</b>
            <p>{words.parked.text}</p>
          </div>
        </section>
      );
    if (!isLibrary || !["reverted", "changed"].includes(status)) return null;
    /* Откат лаунчером Rockstar называется своим именем, и «Вернуть» собирает
       моды каталога заново (Т-98). */
    const copy =
      status === "reverted" && libraryStatus.rockstarLauncher
        ? words.rockstar
        : words[status];
    const restore = async () => {
      setRestoring(true);
      await onRestoreGame?.().catch(() => {});
      setRestoring(false);
    };
    return (
      <section
        className="ui-panel workshop-library-drift"
        role="status"
        data-drift={status}
      >
        <Warning aria-hidden="true" />
        <div>
          <b>{copy.title}</b>
          <p>{copy.text}</p>
        </div>
        {status === "reverted" && onRestoreGame && (
          <Button variant="secondary" disabled={restoring} onClick={restore}>
            {restoring ? words.restoring : words.restore}
          </Button>
        )}
      </section>
    );
  };

  const renderLibraryEmpty = (sectionId = "redux") => (
    <WorkshopLibraryEmpty
      title={libraryCopy.library.empty.title}
      text={
        libraryCopy.library.empty[sectionId] || libraryCopy.library.empty.redux
      }
      actions={[
        {
          id: "workshop",
          label: libraryCopy.library.empty.openWorkshop,
          variant: "primary",
          icon: <Wrench />,
          onClick: () => onNavigate?.("workshop", { section: sectionId }),
        },
        /* Слои оптимизации ставятся из мастерской, в каталоге их нет — и
           вести туда было бы тупиком. */
        ...(sectionId === "optimization"
          ? []
          : [
              {
                id: "catalog",
                label: libraryCopy.library.empty.openCatalog,
                icon: <SquaresFour />,
                onClick: () => onNavigate?.("catalog"),
              },
            ]),
      ]}
    />
  );

  /*
   * Установленное — одной полкой на все разделы.
   *
   * До 25.09.2026 библиотека повторяла полосу мастерской: «Редуксы»,
   * «Оружие», «Одежда», «Оптимизация», и стоящее в игре приходилось искать
   * по четырём вкладкам. Владелец свёл их в одну: библиотека отвечает на один
   * вопрос — что сейчас в игре, — и отвечает одной полкой. Мастерской эти
   * списки не нужны, и считать их там незачем.
   */
  const libraryReduxSlots = () => {
    const { editors: editorSlots, catalog } = splitWorkshopLibrarySlots(
      libraryRootSlots(reduxRootVisualSlots, reduxVisualSlots).filter(
        slotInstalledIn("redux"),
      ),
      editorSlotIn("redux"),
    );
    return [...editorSlots, ...catalog];
  };
  /* Раздел «other» — старые плитки каталога, и часть из них (трейсеры,
     звуки, положение мини-карты) давно живёт на полке графики — плиткой или
     её детальным слотом: одна вещь — одна карточка. */
  const libraryOtherSlots = () => {
    const onGraphicsShelf = new Set(
      [...reduxVisualSlots, ...(catalogLandingSlots.redux || [])].map(
        (slot) => slot.id,
      ),
    );
    return (catalogLandingSlots.other || []).filter(
      (slot) => !onGraphicsShelf.has(slot.id) && slotInstalledIn("other")(slot),
    );
  };
  /*
   * Плитка, открытая карточкой, и установка за ней.
   *
   * Слот ищется по всем плиткам раздела, а установка — по тем же детальным
   * слотам, какими её находит корзина: общий патч эффектов лежит сразу на
   * нескольких плитках, и карточка обязана показать ту же установку, что
   * снимет «Удалить из игры».
   */
  const workCardSlotModel = () => {
    const slot = [
      ...libraryRootSlots(reduxRootVisualSlots, reduxVisualSlots),
      ...reduxRootVisualSlots,
      ...sectionSlots,
    ].find((item) => item.id === workCardSlot);
    if (!slot || !workshopEditorMarkFor(slot)) return null;
    const slotIds = workshopSlotIdsFor(slot.id);
    return {
      slot,
      unit:
        installUnits.find((unit) =>
          unit.slots.some((slotId) => slotIds.includes(slotId)),
        ) || null,
    };
  };
  const libraryWeaponSlots = () =>
    resolveVisibleWeaponSlots(
      workshopWeaponSlots.filter((slot) =>
        workshopModIndex.installedForSlot("gunpacks", slot.id),
      ),
      { expanded: true },
    );
  /* Установленный каталожный ганпак (библиотека v2) — плиткой пака: открывается карточкой со стволами и размером, снимается своей корзиной. Прежде пак на полке не стоял совсем:
     слоты оружия — это стволы, а у пака слот «gunpack». */
  const libraryPackSlots = () =>
    data.mods
      /* Пак по стволам (`gunpack-state.js`) своей плиткой не стоит: его стволы — строки под заголовком; плитка — у пака, что стоит прежней одной записью. */
      .filter((mod) => mod.includedModIds?.length && isGunpackMod(mod) && workshopModIndex.installedIdSet.has(mod.id) && !packProgress(mod, bundleOf, installed).standing.length)
      .map((mod) => ({
        id: `gunpack-pack:${mod.id}`,
        placed: true,
        mod,
        title: { [copyLocale]: mod.name, en: mod.name },
        types: { [copyLocale]: tr("Ганпак"), en: tr("Ганпак") },
        image: modPicture(mod),
      }));
  const libraryPackUnits = () =>
    libraryPackSlots().map((slot) => ({ key: `mod:${slot.mod.id}`, kind: "mod", modId: slot.mod.id, name: slot.mod.name, slots: [slot.id] }));
  /* Скины стволов и стволы паков из мастерской — карточкой каждый, рядом с
     модами каталога на слотах стволов (ТЗ 24.10.2026, п. 5). */
  const libraryWeaponSkins = () =>
    weaponSkinCards(installedWeaponItems(), workshopWeaponSlots, { mods: data.mods });
  const openWeaponSkin = (slot) =>
    editors.request({
      slotId:
        slot.weaponSlot ||
        lastWeaponSlot((id) => workshopWeaponSlots.some((item) => item.id === id)),
      section: "gunpacks",
      catalog: workshopModIndex.modsForSection("gunpacks"),
    });
  /* Мод одежды из каталога — карточкой на каждую вещь в игре (14.10: прежде
     одна карточка на категорию, и «Удалить» снимало все её моды). Своя
     покраска — карточкой самой вещи, работа тату — своей (ТЗ 06.10, вечер,
     задача 3: каждая вещь в библиотеке отдельно). */
  const libraryClothingSlots = () => libraryClothing.cards;
  const libraryClothingItems = () => {
    const categories = new Map(
      (catalogLandingSlots.clothing || []).map((slot) => [slot.id, slot]),
    );
    return installedClothingItems().map((item) => {
      const category = categories.get(item.slot) || null;
      const kind = localized(category?.labels || category?.title) || "";
      const title = item.name || kind || tr("Вещь");
      const pair = paintPairOf(item, data.mods);
      const placedOn = pair?.item
        ? [`${tr("вместо «{item}»").replace("{item}", pair.item)}${pair.more ? ` +${pair.more}` : ""}`, tr("в игре")].join(" | ")
        : "";
      return {
        id: item.id,
        category: item.slot,
        title: { ru: title, en: title },
        description: placedOn
          ? { ru: placedOn, uk: placedOn, en: placedOn, de: placedOn, pl: placedOn, fr: placedOn }
          : {
              ru: [kind, tr("своя покраска в игре")].filter(Boolean).join(" · "),
              en: [kind, "own paint in game"].filter(Boolean).join(" · "),
              fr: [kind, "peinture personnalisée en jeu"].filter(Boolean).join(" · "),
            },
        image: category?.image || "",
        fallbackImage: category?.fallbackImage,
        ...(pair ? { pair } : {}),
      };
    });
  };

  /*
   * Оружие и одежда на полке библиотеки — той же карточкой, что работы
   * редакторов: полка одна, и карточки на ней одного вида. Картинка у них —
   * рендер вещи на прозрачном фоне, и она вписывается в кадр целиком
   * (`is-object-art`), а не обрезается, как снимок.
   */
  const renderLibraryObjectCard = (slot, index, sectionId) => {
    /* Карточка одежды несёт свой мод и свои подписи (`clothing-placements.js`). */
    const installedMod = slot.placed
      ? slot.mod
      : workshopModIndex.installedForSlot(sectionId, slot.id);
    const selection = librarySelectionFor(slot);
    const picture =
      slotPreviewOverrides[slot.id] ||
      (installedMod
        ? slot.preferImage
          ? slot.image || modPicture(installedMod)
          : modPicture(installedMod) || slot.image
        : slot.image);
    return (
      <WorkshopVisualSlotCard
        className={`redux-visual-card redux-visual-card-${slot.id} is-object-art is-installed${slot.pair ? " is-clothing-pair" : ""}`}
        key={`${sectionId}:${slot.id}`}
        kind="catalog"
        preview={picture}
        /* Одежда на вещи сервера — пара «вещь → заменёнка» (`ClothingPairArt`, 25.10.2026). */
        mediaNode={slot.pair ? <ClothingPairArt itemImage={slot.pair.itemImage} game={slot.pair.game} lookup={slot.pair.lookup} modImage={slot.pair.modImage || picture} /> : null}
        fallbackPreview={slot.fallbackImage}
        status={coveredWordsOf(installedMod?.id) ? "covered" : null}
        statusLabel={coveredWordsOf(installedMod?.id)}
        tone={workshopToneFor(sectionId, slot.id, index)}
        /* Имя — сама вещь из каталога, слот — подписью (задача 4). */
        title={
          slot.placed
            ? localized(slot.title)
            : installedMod?.name || localized(slot.labels || slot.title)
        }
        description={
          slot.placed || !installedMod?.name
            ? localized(slot.types || slot.description)
            : localized(slot.labels || slot.title)
        }
        mediaIndex={index}
        {...selection}
        onClick={
          selection.onToggle ||
          (() =>
            slot.weaponSlot !== undefined
              ? openWeaponSkin(slot)
              : installedMod && isLibrary && installedMod.includedModIds?.length && isGunpackMod(installedMod)
                ? setPackCard({ mod: installedMod, slotId: slot.id })
                : installedMod && onSelect
                ? onSelect(installedMod)
                : openSlotIn(sectionId, slot.category || slot.id))
        }
      />
    );
  };

  /* Карточки графики: работа редактора — плиткой редактора, мод из каталога —
     плиткой каталога; раздел у каждой свой. */
  const renderLibrarySlotCards = (slots, sectionId, extraClass = "") =>
    slots.map((slot, index) =>
      renderWorkshopSlotCard(slot, index, {
        kind:
          installedIn(sectionId, slot.id) || !editorSlotIn(sectionId)(slot)
            ? "catalog"
            : "editor",
        extraClass,
        sectionId,
        onOpen: openLibrarySlot,
      }),
    );

  /* Полка библиотеки: графика, оружие, одежда — одной сеткой, оптимизация —
     строками под ней. Ничего не стоит — одна пустая полка с дорогой туда,
     где это берут. */
  /* Вкладка библиотеки выбрана (ТЗ 10.10): у неё гаснет точка «новое» и она
     становится «просмотренной». «all» — первая вкладка, «Библиотека». */

  /*
   * Всё, что стоит в игре, — разложенное по вкладкам библиотеки (ТЗ 10.10):
   * «Графика» (редуксы, трейсеры, мини-карта, сборки…), «Оружие», «Одежда»,
   * «Оптимизация». Вкладка есть, когда в ней что-то стоит; ряд вкладок — когда
   * таких две и больше. Считается один раз за отрисовку: шапка берёт отсюда
   * вкладки, полка — вещи.
   */
  const libraryShelfModel = () => {
    const reduxSlots = libraryReduxSlots();
    const otherSlots = libraryOtherSlots();
    const weaponSlots = [...libraryPackSlots(), ...libraryWeaponSlots(), ...libraryWeaponSkins()];
    const clothingSlots = [
      ...libraryClothingSlots(),
      ...libraryClothingItems(),
    ];
    const reduxNodes = renderLibrarySlotCards(reduxSlots, "redux");
    const otherNodes = renderLibrarySlotCards(
      otherSlots,
      "other",
      "other-slot",
    );
    const weaponNodes = weaponSlots.map((slot, index) =>
      renderLibraryObjectCard(slot, index, "gunpacks"),
    );
    const clothingNodes = clothingSlots.map((slot, index) =>
      renderLibraryObjectCard(slot, index, "clothing"),
    );
    /* Звуки из каталога — на полке графики рядом с «Звуками оружия» мастерской. */
    const soundNodes = librarySounds.cards.map((slot, index) =>
      renderLibraryObjectCard(slot, index, "sounds"),
    );
    /* Порядок полки прежний: графика, оружие, одежда. */
    /* Имя плитки — то же, что на самой карточке: вещь из каталога, а не слот. */
    const named = (slot, sectionId) => {
      const mod = slot.placed ? slot.mod : workshopModIndex.installedForSlot(sectionId, slot.id);
      return slot.placed ? localized(slot.title) : mod?.name || localized(slot.labels || slot.title);
    };
    /* Строка библиотеки на «Загрузках» (`LibraryRows.jsx`): какой мод стоит (размер) и что делает карандаш — окно выбора цели у одежды из каталога, редактор у работы мастерской, у остальных ничего. */
    const rowMeta = (slot, sectionId, tab) => {
      const mod = slot.placed ? slot.mod : installedIn(sectionId, slot.id) || null;
      let edit = null;
      if (tab === "clothing") {
        if (slot.placed && mod) edit = { type: "clothing", mod };
        else if (slot.category && workshopEditorExists({ slotId: slot.category, section: "clothing" })) edit = { type: "editor", slotId: slot.category, section: "clothing" };
      } else if (slot.weaponSlot !== undefined) {
        edit = { type: "editor", slotId: slot.weaponSlot || lastWeaponSlot((id) => workshopWeaponSlots.some((item) => item.id === id)), section: "gunpacks", catalog: workshopModIndex.modsForSection("gunpacks") };
      } else if (tab === "graphics" && !mod) {
        const mark = editorMarkIn(sectionId, slot);
        if (mark && workshopEditorExists({ slotId: slot.id, section: sectionId })) edit = { type: "editor", slotId: slot.id, section: sectionId, variant: mark.sourceModId ? { id: mark.sourceModId, sourceModId: mark.sourceModId, name: mark.name, isUserWork: true } : null };
      }
      return { mod, edit };
    };
    const tiles = (nodes, slots, tab, sectionId) => nodes.map((node, at) => ({ tab, node, id: slots[at].id, name: named(slots[at], sectionId), meta: rowMeta(slots[at], sectionId, tab) }));
    const cards = [
      ...tiles(reduxNodes, reduxSlots, "graphics", "redux"),
      ...tiles(otherNodes, otherSlots, "graphics", "other"),
      ...soundNodes.map((node, at) => ({ tab: "graphics", node, id: librarySounds.cards[at].id, name: localized(librarySounds.cards[at].title) })),
      ...libraryEffects.cards.map((slot, index) => ({ tab: "graphics", node: renderLibraryObjectCard(slot, index, "effects"), id: slot.id, name: localized(slot.title) })),
      ...tiles(weaponNodes, weaponSlots, "weapons", "gunpacks"),
      ...tiles(clothingNodes, clothingSlots, "clothing", "clothing"),
    ];
    const bundles = bundleActions
      ? installedBundles(data.mods, bundleActions.installed)
      : [];
    const optimization = libraryOptimizationInstalled();
    const counts = {};
    for (const { tab } of cards) counts[tab] = (counts[tab] || 0) + 1;
    /* Сборки редуксов — тоже графика. */
    if (bundles.length)
      counts.graphics = (counts.graphics || 0) + bundles.length;
    if (optimization) counts.optimization = 1;
    /* Где что-то стоит — для точки «новое». */
    const filled = presentLibraryTabs(counts);
    libraryTabsNow.current = filled;
    /* Снимок «новых» — один раз за заход: точка не гаснет от того, что
       вкладку открыли, пока человек не нажмёт на неё сам. */
    if (libraryFreshTabs.current === null)
      libraryFreshTabs.current = filled.filter(
        (name) => !libraryTabsSeen.includes(name),
      );
    const tab = LIBRARY_TABS.includes(libraryTab) ? libraryTab : "all";
    return {
      cards,
      bundles,
      optimization,
      tab,
      /* Разделы — всегда все четыре (владелец, 19.10.2026: «нету снова
         разделения… по дефолту эти категории»). Пустой раздел говорит, что
         пуст, и ведёт туда, где это берут. */
      tabs: LIBRARY_TABS.map((id) => ({
        id,
        fresh: Boolean(libraryFreshTabs.current?.includes(id)),
      })),
      empty: !cards.length && !bundles.length && !optimization,
    };
  };

  /* Корзина библиотеки — `features/library/useLibraryShelfRemoval.jsx`. */
  const library = useLibraryShelfRemoval({
    isLibrary,
    selectedSlot,
    selection: librarySelection,
    /* Карточки одежды держат свои пакеты движка (`clothing-placements.js`). */
    installUnits: [...installUnits, ...libraryClothing.units, ...librarySounds.units, ...libraryEffects.units, ...libraryPackUnits()],
    setInstallUnits,
    installed,
    bundleOf,
    workshopModIndex,
    slotIdsIn,
    localized,
    shelves: {
      redux: libraryReduxSlots,
      other: libraryOtherSlots,
      gunpacks: () => [...libraryPackSlots(), ...libraryWeaponSlots(), ...libraryWeaponSkins()],
      clothing: () => [...libraryClothingSlots(), ...libraryClothingItems()],
      sounds: () => librarySounds.cards,
      effects: () => libraryEffects.cards,
    },
    data,
    libraryCopy,
    locale,
    gameTargetId,
    onRemove,
    onNotice,
    onLibraryChanged,
  });
  const {
    removalCopy,
    librarySelectionFor,
    libraryActions,
    askRemoval,
    trash,
    removingIds,
    renderLibraryRemoval,
    removalFor,
  } = library;

  const worksCopy = libraryCopy.works;
  /* Шапка — как у каталога (ТЗ 05.10, задача 18): вкладки и справа органы
     шапки тем же контейнером. Строки проекта у мастерской нет (06.10). */
  const toolbarActions = isLibrary ? (
    libraryActions
  ) : (
    <>
      {section === "redux" && <EditorSearch value={editorQuery} onChange={setEditorQuery} />}
      <Button
        className="workshop-works-button"
        variant="secondary"
        icon={<FolderSimple />}
        trailing={<span className="workshop-works-count">{listWorkshopWorks().length}</span>}
        onClick={() => setWorksOpen(true)}
        aria-label={worksCopy.openLabel}
        title={worksCopy.openLabel}
      >
        {worksCopy.open}
      </Button>
    </>
  );

  /* Открытый редактор занимает всю страницу каталога целиком. Какой именно —
     решает реестр в features/workshop/useWorkshopEditors.jsx. Пока его кусок
     едет — каркас редактора серыми плашками, а не сетка карточек. */
  if (editors.open) {
    const { Component, props, key } = editors.open;
    return (
      <EditorBackContext.Provider
        value={editors.returnPage === "detail" ? editorReturnLabel(locale) : editors.returnPage === "home" ? homeReturnLabel(locale) : editors.returnPage === "cart" ? cartReturnLabel(locale) : editors.returnPage === "downloads" ? downloadsReturnLabel(locale) : ""}
      >
        <EditionNoticeContext.Provider value={editionNotice}>
          <React.Suspense fallback={<EditorSkeleton />}>
            <Component
              key={key}
              onNotice={onNotice}
              onNavigate={onNavigate}
              isAdmin={isAdmin}
              {...props}
            />
          </React.Suspense>
        </EditionNoticeContext.Provider>
      </EditorBackContext.Provider>
    );
  }

  if (!isLibrary && worksOpen) {
    return (
      <React.Suspense fallback={<WorkshopStudioFallback />}>
        <WorkshopWorks
          locale={copyLocale}
          onBack={() => setWorksOpen(false)}
          onOpenEditor={editors.request}
          onNotice={onNotice}
          isAdmin={isAdmin}
          onNavigate={onNavigate}
        />
      </React.Suspense>
    );
  }

  /* Библиотека строками справа на «Загрузках»: те же карточки и то же удаление, что у полки, без плиток, галерей и карточек — страница «Загрузки» не редакторская. */
  if (isLibrary && rows) {
    const shelfModel = libraryShelfModel();
    const cards = shelfModel.optimization
      ? [
          ...shelfModel.cards,
          {
            id: OPTIMIZER_ROW_ID,
            name: tr("Оптимизация"),
            node: (
              <React.Suspense fallback={null}>
                <LibraryOptimizationTile onOpen={() => {}} selection={librarySelectionFor({ id: OPTIMIZER_ROW_ID })} />
              </React.Suspense>
            ),
            meta: { edit: { type: "editor", section: "optimization" } },
          },
        ]
      : shelfModel.cards;
    return (
      <LibraryRows
        cards={cards}
        mods={data.mods}
        language={language}
        removingIds={removingIds}
        onNavigate={onNavigate}
        onInstall={onInstall}
        onSelect={onSelect}
        onNotice={onNotice}
        onRemove={(card) => askRemoval(card.id)}
        /* Ганпак и сборка редукса — заголовком над своими строками; «Удалить ганпак» / «Снять сборку» — то же окно подтверждения со всеми строками группы. */
        groups={libraryGroups(cards, { mods: data.mods, installed, bundleOf })}
        onRemoveGroup={(group) => askRemoval(group.cardIds)}
        notices={<>{renderLibraryDrift({ skipChecked: true })}{renderLibraryWaiting()}</>}
        dialogs={renderLibraryRemoval()}
        onOpenCatalog={() => onNavigate?.("catalog")}
      />
    );
  }

  /* Карточка работы, которая стоит в игре: библиотека открывает её вместо
     редактора, а редактор ждёт кнопки на самой карточке. */
  const workCard = isLibrary && workCardSlot ? workCardSlotModel() : null;
  if (workCard) {
    return (
      <React.Suspense fallback={<WorkshopStudioFallback />}>
        <LibraryWorkCard
          slotId={workCard.slot.id}
          title={localized(workCard.slot.title || workCard.slot.labels)}
          /* Чем сделана работа — редактор словами плитки («Килл-эффект»), а не
             стандартное описание раздела (задача 4 ТЗ 08.10, вечер). */
          sectionTitle={
            localized(workCard.slot.title || workCard.slot.labels) ||
            sectionLabels[section]
          }
          unit={workCard.unit}
          copy={{ ...libraryCopy.library.work, removal: removalCopy }}
          locale={locale}
          targetId={gameTargetId}
          installUnits={installUnits}
          removalFor={removalFor}
          onBack={() => setWorkCardSlot("")}
          onEdit={() => openSlotEditor(workCard.slot)}
          onNotice={onNotice}
          onRemoved={(units) => {
            setInstallUnits(units);
            setWorkCardSlot("");
            onLibraryChanged?.();
          }}
        />
      </React.Suspense>
    );
  }

  /*
   * Библиотека без открытой галереи — одна полка: разделов у неё нет
   * (владелец, 25.09.2026). Полка одета в вид полки редуксов
   * (`data-workshop-section="redux"`): все карточки на ней — карточки
   * редуксов, и оружию с одеждой достаётся та же рамка, подпись и отметка
   * корзины. Раздел, открытый галереей, полке не мешает: нажатая карточка
   * сама переключает его на свой.
   */
  if (isLibrary && !selectedSlot && packCard) {
    const { mod: pack, slotId } = packCard;
    const guns = packGuns(pack, data.mods);
    return (
      <div ref={pageRootRef} className="desktop-page catalog-v3" data-hold-as="catalog-v3" data-workshop-section="gunpacks" data-library-shelf="pack">
        {/* Запасной кадр — строка страницы, а не каркас редактора: тот прячет рейку страниц (`editor-layout`), и из зависшей загрузки не выйти. */}
        <React.Suspense fallback={<PageLoading />}>
          <LibraryPackCard
            pack={pack}
            guns={guns}
            author={isAuthorUnknown(pack) ? "" : `@${modAuthor(pack)}`}
            busy={packBusy}
            onBack={() => setPackCard(null)}
            /* Размер ставится пересборкой пака: та же установка с размером (главный процесс перешивает модели), после неё нужен перезапуск игры. */
            onApplySize={(percent) => {
              rememberSize(pack.id, percent);
              setPackBusy(true);
              Promise.resolve(onInstall?.(pack, { modelScale: modelScaleOf(percent) })).finally(() => setPackBusy(false));
            }}
            /* Один ствол: пак снимается, пакеты остальных стволов ставятся (у каждого ствола свой пакет). */
            onRemoveGun={(gun) => {
              const plan = packWithoutGun(pack, gun, data.mods);
              setPackBusy(true);
              Promise.resolve(onRemove?.(pack))
                .then(() => plan.install.reduce((chain, child) => chain.then(() => onInstall?.(child)), Promise.resolve()))
                .finally(() => {
                  setPackBusy(false);
                  setPackCard(null);
                });
            }}
            onRemovePack={() => askRemoval(slotId)}
            onOpenStudio={() => openWeaponSkin({})}
          />
        </React.Suspense>
        {renderLibraryRemoval()}
      </div>
    );
  }

  if (isLibrary && !selectedSlot) {
    const shelfModel = libraryShelfModel();
    /* Библиотека v2 (14.11.2026): группы и ряды; вкладок нет. Корзина — в шапке, с режимом выделения на всех плитках (владелец, 15.11.2026). */
    const byTab = (tab) => shelfModel.cards.filter((card) => card.tab === tab).map(({ id, name, node }) => ({ id, name, node }));
    const bundleCount = shelfModel.bundles.length;
    const groups = [
      {
        id: "graphics",
        title: tr("Графика и карта"),
        items: byTab("graphics"),
        extra: <LibraryBundleRows mods={data.mods} language={language} onSelect={onSelect} />,
      },
      { id: "weapons", title: tr("Оружие"), items: byTab("weapons") },
      { id: "clothing", title: tr("Одежда"), items: byTab("clothing") },
      {
        id: "optimization",
        title: tr("Оптимизация"),
        /* Оптимизация — одна плитка и одна запись корзины на всё, что стоит от неё (`optimization-units.js`); щелчок — в раздел оптимизации мастерской. */
        items: shelfModel.optimization
          ? [
              {
                id: OPTIMIZER_ROW_ID,
                name: tr("Оптимизация"),
                node: (
                  <React.Suspense fallback={null}>
                    <LibraryOptimizationTile onOpen={openOptimizerStudio} selection={librarySelectionFor({ id: OPTIMIZER_ROW_ID })} />
                  </React.Suspense>
                ),
              },
            ]
          : [],
      },
    ];
    return (
      <div
        ref={pageRootRef}
        className="desktop-page catalog-v3"
        data-hold-as="catalog-v3"
        data-workshop-section="redux"
        data-library-shelf="all"
        data-shelf-mode={mode}
        data-library-selecting={librarySelection.active || undefined}
      >
        {/* Библиотека — не редактор: пока что-то на полке ещё едет (плитка «Оптимизация» — отдельным куском), на месте строка «Загружаю…», рейка страниц остаётся (15.11.2026). */}
        <React.Suspense fallback={<PageLoading />}>
          <LibraryShelves
            groups={groups.map((group) => (group.id === "graphics" && !bundleCount ? { ...group, extra: null } : group))}
            total={shelfModel.cards.length + bundleCount + (shelfModel.optimization ? 1 : 0)}
            bundles={shelfModel.bundles}
            targetId={gameTargetId}
            removingIds={removingIds}
            trash={trash}
            notices={
              <>
                {renderLibraryDrift()}
                {renderLibraryWaiting()}
              </>
            }
            empty={renderLibraryEmpty("redux")}
          />
        </React.Suspense>
        {renderLibraryRemoval()}
      </div>
    );
  }

  if (!section) {
    return (
      <div ref={pageRootRef} className="desktop-page catalog-root-page" data-hold-as="catalog-root-page">
        <header className="catalog-root-heading">
          <span>{catalogRootCopy.eyebrow}</span>
          <h1>{catalogRootCopy.title}</h1>
          <p>{catalogRootCopy.description}</p>
          {editionNotice ? (
            <p
              className={`catalog-edition-note${editionNotice.tone === "warning" ? " is-warning" : ""}`}
              role="note"
            >
              <b>{editionNotice.label}.</b> {editionNotice.detail}
            </p>
          ) : null}
        </header>
        <section className="catalog-root-accordion">
          {catalogRootCards.map((card) => {
            const labels = catalogRootCopy.cards[card.id];
            return (
              <button
                className="catalog-root-card"
                key={card.id}
                onClick={() => chooseSection(card.id)}
                aria-label={`${labels[0]}: ${labels[1]}`}
              >
                <span
                  className="catalog-root-card-image"
                  style={{ backgroundImage: `url('${card.image}')` }}
                />
                {card.id === "settings" && (
                  <span
                    className="catalog-settings-document"
                    aria-hidden="true"
                  >
                    <span className="catalog-settings-sheet">
                      <i />
                      <i />
                      <i />
                      <i />
                      <em>TXT</em>
                    </span>
                  </span>
                )}
                <span className="catalog-root-card-shade" />
                <span className="catalog-root-card-copy">
                  <b>{labels[0]}</b>
                  <small>{labels[1]}</small>
                </span>
                <ArrowRight />
              </button>
            );
          })}
        </section>
      </div>
    );
  }

  if (
    ["redux", "gunpacks", "clothing"].includes(section) &&
    activeMode === null
  ) {
    return (
      <div ref={pageRootRef} className="desktop-page catalog-mode-page" data-hold-as="catalog-mode-page">
        <header className="catalog-v3-context catalog-mode-context">
          <button
            onClick={() => {
              setSection(null);
              setSelectedSlot(null);
              setSlotSearch("");
            }}
            aria-label={
              locale === "ru"
                ? tr("К направлениям каталога")
                : locale === "fr"
                  ? "Sections du catalogue"
                  : "Catalog sections"
            }
          >
            <ArrowLeft />
          </button>
          <b>{sectionLabels[section]}</b>
        </header>

        <header className="catalog-mode-heading">
          <h1>{catalogModeCopy.title[section]}</h1>
          <p>{catalogModeCopy.description}</p>
        </header>

        <section className="catalog-mode-cards" data-assembly-grid>
          {catalogModeCards[section].map((card) => {
            const labels =
              card.mode === "packs"
                ? catalogModeCopy.packs[section]
                : catalogModeCopy.custom[section];
            return (
              <button
                className={`catalog-mode-card ${card.fit === "contain" ? "is-contain" : ""}`}
                key={card.mode}
                onClick={() => setActiveMode(card.mode)}
                aria-label={`${labels[0]}: ${labels[1]}`}
              >
                <span
                  className="catalog-mode-card-image"
                  style={{ backgroundImage: `url('${card.image}')` }}
                />
                <span className="catalog-mode-card-shade" />
                <span className="catalog-mode-card-copy">
                  <b>{labels[0]}</b>
                  <small>{labels[1]}</small>
                </span>
                <ArrowRight />
              </button>
            );
          })}
        </section>
      </div>
    );
  }

  /*
   * Оптимизация — семь карточек (улицы, транспорт, прохожие, растительность,
   * тени, погода, эффекты), каждая сразу ставится в игру своим переключателем
   * и так же снимается (`workshop/optimizer/OptimizerPage.jsx`, 03.10.2026).
   * Стоит под вкладками мастерской — см. ниже, в самой странице.
   */
  return (
    <div
      ref={setWorkshopRoot}
      data-hold-as="catalog-v3"
      className={`desktop-page catalog-v3${
        selectedSlot && slotEntryMode === "catalog"
          ? " workshop-local-catalog-active"
          : ""
      }`}
      data-workshop-section={section}
      data-workshop-slot={selectedSlot || ""}
      data-workshop-detail-slot={activeWorkshopSlotId || ""}
      data-shelf-mode={mode}
      data-library-selecting={librarySelection.active || undefined}
    >
      {/* Шапка, как у «Каталога» и «Библиотеки»: сначала заголовок раздела, под ним ряд вкладок (ТЗ 24.10.2026, ночь, п. 3;
          раньше вкладки стояли выше заголовка). Заголовок — по выбранной вкладке: у «Редакторов» с описанием, у остальных — имя
          вкладки. */}
      {!selectedSlot && (
        <WorkshopToolbar
          locale={copyLocale}
          section={section}
          mode={mode}
          editorCount={reduxEditorCount}
          onSectionChange={chooseSection}
          actions={toolbarActions}
        />
      )}
      {!selectedSlot && renderLibraryDrift()}
      {!selectedSlot && renderLibraryWaiting()}

      {selectedSlot && (
        <DetailTopbar
          className="catalog-v3-context catalog-section-context workshop-slot-context"
          /* Из библиотеки в галерею попадают с одной полки — туда и возврат,
             а не в раздел, которого у библиотеки нет. */
          backLabel={
            isLibrary
              ? workshopToolbarCopyFor(copyLocale).library
              : sectionLabels[section]
          }
          onBack={() => {
            scrollWorkshopSurfaceToTop();
            setSelectedSlot(null);
            setReduxDetailSlot(null);
            setSlotSearch("");
            setSelectedVariant(null);
          }}
          trail={
            <strong className="workshop-slot-title">
              {localized(activeSlotGroup?.title || activeSlotGroup?.labels)}
            </strong>
          }
          actions={
            <>
              <WorkshopDetailTabs
                items={activeReduxDetailSlots.map((slot) => ({
                  id: slot.id,
                  label: localized(slot.title),
                }))}
                activeId={activeWorkshopSlotId}
                ariaLabel={
                  locale === "ru"
                    ? tr("Дополнительные разделы модификации")
                    : locale === "fr"
                      ? "Sections détaillées du mod"
                      : "Modification detail sections"
                }
                onChange={selectReduxDetailSlot}
              />
              {activeVariantSupports3D && (
                <button
                  type="button"
                  className="workshop-context-3d-button"
                  onClick={() => setWeaponViewerOpen(true)}
                  aria-label={libraryCopy.view3D}
                  title={libraryCopy.view3D}
                >
                  <Cube />
                  <span aria-hidden="true">3D</span>
                </button>
              )}
            </>
          }
        />
      )}

      {section === "gunpacks" &&
        !selectedSlot &&
        weaponMode === "selective" && (
          <>
            {/* Сохранённые скины живут только в «Моих работах»: вкладка —
                это выбор ствола, а не вторая полка работ. */}
            {workshopWeaponSlots.length > FEATURED_WEAPON_SLOT_IDS.length && (
              <WeaponShelfDisclosure
                expanded={weaponCatalogExpanded}
                copy={libraryCopy}
                onToggle={weaponCatalogDisclosure.toggle}
              />
            )}
            <section
              id="weapon-catalog-grid"
              className="weapon-slot-grid"
              data-assembly-grid
              data-expanded={
                weaponCatalogDisclosure.renderedExpanded || undefined
              }
              data-collapsing={weaponCatalogDisclosure.collapsing || undefined}
            >
              {displayedWeaponCatalogSlots.map((slot, index) =>
                renderWeaponSlotCard(
                  slot,
                  index,
                  index >= FEATURED_WEAPON_SLOT_IDS.length
                    ? "extended"
                    : "featured",
                ),
              )}
            </section>
          </>
        )}

      {["redux", "gunpacks", "clothing"].includes(section) &&
        !selectedSlot &&
        activeMode === "packs" &&
        renderPackCatalog()}

      {section === "redux" && !selectedSlot && reduxMode === "selective" && (
        <section
          className="redux-visual-catalog workshop-library"
          data-shelf-mode={mode}
        >
          {isLibrary ? renderEditorShelf(reduxEditorSlots, { headless: true }) : renderEditorPoster()}
        </section>
      )}

      {section === "clothing" &&
        !selectedSlot &&
        clothingMode === "selective" && (
          <section className="workshop-clothing-catalog workshop-clothing-weapon-catalog">
            <div
              className="weapon-slot-grid workshop-clothing-weapon-grid"
              data-assembly-grid
            >
              {sectionSlots.map(renderClothingSlotCard)}
            </div>
          </section>
        )}

      {section === "other" && !selectedSlot && (
        <section className="redux-visual-catalog workshop-other-catalog workshop-library">
          {renderEditorShelf(otherEditorSlots, { extraClass: "other-slot" })}
        </section>
      )}

      {!isLibrary && section === "optimization" && !selectedSlot && (
        <React.Suspense fallback={<WorkshopStudioFallback />}>
          <WorkshopOptimizer embedded locale={copyLocale} onNotice={onNotice} />
        </React.Suspense>
      )}

      {section !== "gunpacks" &&
        section !== "settings" &&
        section !== "optimization" &&
        section !== "redux" &&
        section !== "clothing" &&
        section !== "other" &&
        !selectedSlot && (
          <section className="catalog-v3-landing-grid" data-assembly-grid>
            {sectionSlots
              .filter((slot) => section !== "redux" || slot.id !== "redux-pack")
              .map((slot, index) => {
                const installedMod = workshopModIndex.installedForSlot(
                  section,
                  slot.id,
                );
                return (
                  <WorkshopLandingSlotCard
                    className={section === "clothing" ? "clothing-slot" : ""}
                    key={slot.id}
                    preview={
                      slotPreviewOverrides[slot.id] ||
                      (installedMod
                        ? coverFor(installedMod)
                        : workshopPreviewFor(section, slot.id, index))
                    }
                    tone={workshopToneFor(section, slot.id, index)}
                    title={localized(slot.title)}
                    description={
                      installedMod
                        ? installedMod.name
                        : localized(slot.description)
                    }
                    mediaIndex={index}
                    onClick={() => openWorkshopSlot(slot.id)}
                  />
                );
              })}
          </section>
        )}

      {selectedSlot && slotEntryMode === "catalog" && (
        <WorkshopVariantGallery
          selectedSlot={activeWorkshopSlotId}
          detailGroupId={selectedReduxGroupId}
          section={section}
          eyebrow={activeSlotTitle}
          title={primaryVariant?.name || activeSlotTitle}
          description={
            activeSlotDescription || libraryCopy.fallbackDescription
          }
          primaryVariant={primaryVariant}
          downloads={primaryVariantDownloads}
          locale={locale}
          installLabel={libraryCopy.install}
          removeLabel={
            locale === "ru"
              ? tr("Удалить")
              : locale === "fr"
                ? "Supprimer"
                : "Remove"
          }
          installed={primaryVariantInstalled}
          vanillaActive={primaryVariantVanillaActive}
          installedLabel={
            locale === "ru"
              ? tr("Установлено")
              : locale === "fr"
                ? "Installé"
                : "Installed"
          }
          activeOperation={activeWorkshopOperation}
          variants={filteredSelectedMods}
          searchValue={slotSearch}
          searchPlaceholder={
            locale === "ru"
              ? tr("Поиск модификаций")
              : locale === "de"
                ? "Modifikationen suchen"
                : locale === "pl"
                  ? "Szukaj modyfikacji"
                  : locale === "fr"
                    ? "Rechercher des mods"
                    : "Search modifications"
          }
          emptyLabel={
            locale === "ru"
              ? tr("Подходящих модификаций не найдено")
              : locale === "de"
                ? "Keine passenden Modifikationen"
                : locale === "pl"
                  ? "Nie znaleziono pasujących modyfikacji"
                  : locale === "fr"
                    ? "Aucun mod correspondant"
                    : "No matching modifications"
          }
          onSearchChange={setSlotSearch}
          getCover={coverFor}
          canCustomize={workshopEditorExists({
            slotId: activeWorkshopSlotId,
            section,
          })}
          onCustomize={() =>
            editors.request({
              slotId: activeWorkshopSlotId,
              section,
              variant: primaryVariant,
            })
          }
          onInstall={() => installWorkshopVariant()}
          onSelect={setSelectedVariant}
          onPreload={(cover) => void preloadWorkshopImage(cover)}
          onMediaLoad={handleWorkshopMediaLoad}
          onMediaError={handleWorkshopMediaError}
          heroMedia={
            <WorkshopHeroMedia
              primaryVariant={primaryVariant}
              activeSlot={activeSlot}
              activeSlotTitle={activeSlotTitle}
              coverFor={coverFor}
              locale={locale}
              onLoad={handleWorkshopMediaLoad}
              onError={handleWorkshopMediaError}
            />
          }
        />
      )}
      {weaponViewerOpen && activeVariantSupports3D && (
        <React.Suspense
          fallback={
            <DesktopOverlayPortal>
              <div className="weapon-viewer-backdrop" aria-live="polite">
                <div className="weapon-viewer-module-loading">
                  <Cube />
                  <span>{libraryCopy.view3D}</span>
                </div>
              </div>
            </DesktopOverlayPortal>
          }
        >
          <WeaponModelViewer
            modelUrl={activeVariantModel}
            fallbackModelUrl={activeVariantFallbackModel}
            previewUrl={coverFor(primaryVariant)}
            previewFallbackUrl={
              primaryVariant?.fallbackCover || activeSlot?.fallbackImage
            }
            title={primaryVariant?.name || activeSlotTitle}
            language={locale}
            kind={section === "clothing" ? "clothing" : "weapon"}
            finish={
              section === "clothing" && selectedSlot === "hats"
                ? "dark-cap"
                : "default"
            }
            onClose={() => setWeaponViewerOpen(false)}
          />
        </React.Suspense>
      )}
      {renderLibraryRemoval()}
    </div>
  );
}

export function Installed({ data, installed, onSelect, onRemove }) {
  useTr();
  const mods = data.mods.filter((mod) => installed.includes(mod.id));
  return (
    <div className="desktop-page installed-page">
      <SectionTitle
        eyebrow={tr("Ваша библиотека")}
        title={tr("Модификации")}
        action={
          mods.length ? (
            <button
              className="library-remove-all"
              onClick={() => onRemove(mods.map((mod) => mod.id))}
            >
              <Trash />
              Удалить все
            </button>
          ) : null
        }
      />
      <>
        <div className="installed-status">
          <ShieldCheck />
          <span>
            <b>{tr("Защита файлов включена")}</b>
            <small>
              {tr("Нажмите карточку, чтобы открыть мод. Удаление выполняется через безопасную очередь с откатом.")}
            </small>
          </span>
        </div>
        <ModGrid
          mods={mods}
          installed={installed}
          onSelect={onSelect}
          onRemove={(mod) => onRemove([mod.id])}
          showFavorite={false}
          emptyText={tr("Установленных модов пока нет")}
        />
      </>
    </div>
  );
}
