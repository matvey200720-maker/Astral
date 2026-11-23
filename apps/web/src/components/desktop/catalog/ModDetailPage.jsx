import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import ClipPlayer from "../../ui/ClipPlayer.jsx";
import AuthorPage from "./AuthorPage.jsx";
import ModCard from "./mod-card/ModCard.jsx";
import { catalogDownloadCount, packsContaining, packMembers, catalogCategoryForMod, postMates } from "../../../catalog-utils.js";
import { hasOwnCover, coverFor, usesContainedMedia, usesWeaponMedia } from "../../../utils/catalogMedia.js";
import { modFilesLabel, modActionEditions, modEditionsStated, modActionCopy } from "./modActionCopy.js";
import { modSizeLabel, sizeEstimateNote } from "../../../features/catalog/size-estimate.js";
import { postedTime, similarMods } from "../../../features/catalog/recommend.js";
import { packContents, partReplaces } from "../../../features/catalog/pack-contents.js";
import { modEditor, catalogWorkEditor, openModEditor, openStandardEditor } from "../../../features/catalog/mod-editor.js";
import { useClothingPlacements, placementsOfMod } from "../../../features/library/clothing-placements.js";
import { isClothingCard } from "./mod-card/ModCardParts.jsx";
import { modCardCopy } from "./mod-card/modCardCopy.js";
import { ImageSquare as SquareIcon } from "../../ui/icons.jsx";
import { skyCycleOf } from "./mod-card/SkyCyclePlayer.jsx";
import { modDetailCopy } from "./modDetailCopy.js";
import { animateInstallToDownloads } from "./install-flight.js";
import { modModelUrl } from "./ModModelPreview.jsx";
import { motionEnabled } from "../../../motion-preference.js";
import { useModVariant } from "./useModVariant.js";
import { tr } from "../../../locales/ui.js";
import { clothingInstallKind } from "@modovik/clothing/install-kind";
import { catalogLabel } from "../../../features/catalog/catalog-words.js";
import { isAuthorPage } from "../../../features/catalog/catalog-authors.js";
import { peekEditorReturnPick, rememberEditorReturn, takeEditorReturnTop } from "../../../features/catalog/editor-return.js";
import { claimScroll, remember as rememberSection } from "../../../section-memory.js";
import { openingEditor } from "../../../features/catalog/editor-opening.js";
import { localMediaCaption } from "../../../features/catalog/media-caption.js";
import { reduxOfParts } from "../../../features/catalog/search-bundles.js";
import { isSoundMod } from "../../../features/catalog/sound-packs.js";
import { clothingChangeSummary } from "../../../features/clothing/change-summary.js";
import { shownTargetName } from "../../../features/clothing/item-title.js";
import { clothingOf } from "../../../features/clothing/clothing-catalog.js";
import { withColourViews } from "../../../features/clothing/clothing-views.js";
import { prewarmClothingInstall } from "../../../features/clothing/prewarm.js";
import { useDefaultTarget } from "../../../features/clothing/useDefaultTarget.js";
import { tattooSetOf } from "../../../features/clothing/tattoo-set.js";
import { engineModIds } from "../../../features/library/engine-ids.js";
import { isCatalogWork } from "../../../features/workshop/works/catalog-work.js";
import { installSetFacts, installSetOf } from "../../../features/catalog/effects-install-set.js";
import { effectsSlotOf, partInstallArgs } from "../../../features/catalog/bundles/component-groups.js";

/* ---------- ключи собираемых объектов (порядок ключей — часть контракта) ---------- */

const VIEW_KEYS =
  "mod language locale copy actionCopy reduxes cardCopy returnLabel onBack kicker media framesFrom renderMedia dropMedia captionOf mediaClasses cover hasModel meta plan editor onEdit contents isSound onOpenAuthor parts rails dialogs placed returnPick".split(" ");
const PLAN_KEYS =
  "active actionStatusTitle afterInstallNote changeSummary editionsStated modEditions ready removing waiting variantChoice installMod onInstall onOpenWork".split(" ");
const PARTS_KEYS = "installed queue open owner replaces install retry remove edit startWork pickPlace".split(" ");
const RAILS_KEYS = "members parents mates related allMods onSelect".split(" ");
const META_KEYS = "size sizeNote date downloads".split(" ");

const pick = (keys, source) => Object.fromEntries(keys.map((key) => [key, source[key]]));

/* ---------- окна одежды: тянутся отдельными кусками ---------- */

const loadInstallDialog = () => import("./ClothingInstallDialog.jsx");
const ClothingInstallDialog = lazy(loadInstallDialog);
const ClothingPlaceDialog = lazy(() => import("./ClothingPlaceDialog.jsx"));
const TattooSetDialog = lazy(() => import("./TattooSetDialog.jsx"));

/* ---------- таблицы ---------- */

const LOCALES = new Map("ru-RU uk-UA en-US de-DE pl-PL fr-FR".split(" ").map((tag) => [tag.slice(0, 2), tag]));

// Слово статуса действия: первая подходящая запись; ключ null — слова нет.
const STATUS_RULES = [
  [({ active, ready }) => !active && ready, "installed"],
  [({ active }) => !active, null],
  [({ active }) => active.failed, "failed"],
  [({ waiting }) => waiting, "queued"],
  [({ removing }) => removing, "busyRemove"],
  [() => true, "busyInstall"],
];

// Строка «Что изменится» по виду мода (одежда и число файлов — отдельно в changeSummaryOf).
const SUMMARY_WORDS = new Map(Object.entries({ interface: "interfaceFiles", sounds: "soundFiles", effects: "effectFiles" }));

// Заметка «после установки»: первая подходящая запись.
const AFTER_RULES = [
  [(kind, ready) => ready, "installedLaunch"],
  [(kind) => kind === "clothing", "availableInWorkshop"],
  [(kind) => kind === "packs" || kind === "improvements", "profileAvailable"],
  [() => true, "launchNormally"],
];

const PLACEHOLDER_FRAME = Object.freeze({ type: "placeholder", src: "" });

/* ---------- мелочи ---------- */

// Значение по умолчанию действует только для undefined: null его не заменяет.
const given = (value, fallback) => (value === undefined ? fallback : value);

const localeOf = (language) => LOCALES.get(language) ?? "ru-RU";
const ownCoverOf = (item) => (hasOwnCover(item) ? coverFor(item) : "");
const cardCoverImage = () => document.querySelector(".mod-card-cover img");

// Каталог страницы: сначала образцы витрины, потом каталог; одинаковый id — одна запись, побеждает поздняя.
const gluedCatalog = (showcase, catalog) => {
  const byId = new Map();
  [...showcase, ...catalog].forEach((entry) => byId.set(entry.id, entry));
  return Array.from(byId.values());
};

const DATE_FORMAT = { day: "numeric", month: "long", year: "numeric" };

const addedDate = (mod, locale) => {
  const stamp = new Date(postedTime(mod) || mod.releaseDate || Number.NaN);
  return Number.isNaN(stamp.getTime()) ? null : new Intl.DateTimeFormat(locale, DATE_FORMAT).format(stamp);
};

/* ---------- кадры мода ---------- */

// Одна запись ленты из строки или объекта; пустое и объект без адреса дают null.
const frameOf = (item, defaultType) => {
  if (!item) return null;
  if (typeof item === "string") return { type: defaultType, src: item };
  const src = item.src || item.url;
  if (!src) return null;
  const rawBytes = typeof item.bytes === "string" ? Number(item.bytes) : item.bytes;
  const extras = {
    source: item.source || undefined,
    loop: item.loop ? true : undefined,
    bytes: typeof rawBytes === "number" && rawBytes > 0 ? rawBytes : undefined,
  };
  const frame = { type: item.type || defaultType, src, ...pick("poster thumbnail title caption origin width".split(" "), item) };
  Object.entries(extras).forEach(([key, value]) => value !== undefined && Object.assign(frame, { [key]: value }));
  return frame;
};

// Своя обложка как элемент ленты: с происхождением или шириной оригинала — объектом, без них — адресом. Ширина нужна кадру сцены (`utils/stage-photo.js`): выше родного яруса картинки он не просит.
const coverItemOf = (mod) => {
  if (!hasOwnCover(mod)) return null;
  const src = coverFor(mod);
  const width = Number.isFinite(mod.coverWidth) ? mod.coverWidth : undefined;
  if (mod.coverOrigin) return { src, origin: mod.coverOrigin, caption: mod.coverCaption, width };
  return width ? { src, width } : src;
};

const framesOf = (mod) => {
  const sheet = skyCycleOf(mod)?.url;
  const gallery = mod.gallery ? mod.gallery.filter((item) => !sheet || (item?.url ?? item?.src ?? item) !== sheet) : [];
  const sources = [
    ["image", mod.media ?? []],
    ["image", [coverItemOf(mod)]],
    ["image", gallery],
    ["video", mod.videos ?? []],
    ["video", [mod.video]],
  ];
  const seen = new Set();
  const frames = sources.flatMap(([type, items]) => items.map((item) => frameOf(item, type))).filter((frame) => {
    const fresh = Boolean(frame) && !seen.has(frame.src);
    if (fresh) seen.add(frame.src);
    return fresh;
  });
  return withColourViews(mod, frames);
};

/* ---------- кадр, который рисует страница ---------- */

const clipProps = ({ frame, className, mod, drop, playing }) => ({
  className,
  src: frame.src,
  poster: frame.poster || ownCoverOf(mod),
  label: mod.name,
  bytes: frame.bytes,
  loop: Boolean(frame.loop),
  silent: Boolean(frame.loop),
  /* Петля (мини-карта с играющими полосами и т.п.) на сцене идёт сама, пока анимации Astral включены (ТЗ владельца 10.11.2026). */
  autoStart: playing || (Boolean(frame.loop) && motionEnabled()),
  onError: () => drop(frame.src),
});

const stillProps = ({ frame, className, mod, drop }) => ({
  className,
  src: frame.src,
  poster: frame.poster || ownCoverOf(mod) || undefined,
  loop: Boolean(frame.loop),
  muted: true,
  preload: frame.loop ? "auto" : "metadata",
  playsInline: true,
  onError: () => drop(frame.src),
});

const photoProps = ({ frame, className, mod, drop }) => ({
  className,
  src: frame?.src,
  alt: mod.name,
  "data-photo": "",
  /* Кадр сцены — главное на странице: его просят первым, разжимают не на главном потоке (14.11.2026). */
  fetchPriority: "high",
  decoding: "async",
  onError: () => drop(frame?.src),
});

// Первая подходящая запись решает, чем рисовать кадр; иначе — обычной картинкой.
const FRAME_DRAWERS = [
  [
    (frame) => frame?.type === "placeholder",
    ({ className, copy }) => (
      <div className={`${className} is-placeholder`} role="img" aria-label={copy.noMedia}>
        <SquareIcon aria-hidden="true" />
        <span>{copy.noMedia}</span>
      </div>
    ),
  ],
  [
    (frame, flags) => frame?.type === "video" && (flags.playing || flags.stage),
    (ctx) => <ClipPlayer key={`${ctx.frame.src}-${ctx.playing ? "playing" : "stage"}`} {...clipProps(ctx)} />,
  ],
  [(frame) => frame?.type === "video", (ctx) => <video key={`${ctx.frame.src}-still`} {...stillProps(ctx)} />],
];

const drawFrame = (ctx) => {
  const [, draw] = FRAME_DRAWERS.find(([fits]) => fits(ctx.frame, ctx)) ?? [];
  return draw ? draw(ctx) : <img {...photoProps(ctx)} />;
};

/* ---------- слова плана установки ---------- */

const statusTitleOf = (state, words) => {
  const [, key] = STATUS_RULES.find(([fits]) => fits(state));
  return key ? words[key] : null;
};

const changeSummaryOf = (mod, kind, words, language) => {
  if (kind === "skins") return words.weaponPackage;
  if (kind === "clothing" || mod.catalogSection === "clothing") return clothingChangeSummary(mod);
  if (SUMMARY_WORDS.has(kind)) return words[SUMMARY_WORDS.get(kind)];
  const files = mod.manifest?.files;
  const count = Array.isArray(files) ? files.length : 0;
  if (count === 0) return words.modFiles;
  return count === 1 ? words.oneFile : modFilesLabel(count, language);
};

const afterInstallNoteOf = (kind, ready, words) => {
  const [, key] = AFTER_RULES.find(([fits]) => fits(kind, ready));
  return words[key];
};

// Поля плана установки, которые считаются из записи мода и очереди.
const planFacts = ({ mod, kind, words, language, ready, active }) => {
  const removing = active?.operation === "remove";
  const waiting = Boolean(active) && !active.failed && !active.started && !(active.progress > 0);
  return {
    removing,
    waiting,
    modEditions: modActionEditions(mod),
    editionsStated: modEditionsStated(mod),
    changeSummary: changeSummaryOf(mod, kind, words, language),
    afterInstallNote: afterInstallNoteOf(kind, ready, words),
    actionStatusTitle: statusTitleOf({ active, ready, removing, waiting }, words),
  };
};

// Дата, вес и загрузки для панели ответов.
const metaFacts = (mod, allCatalogMods, detailLocale) => {
  const size = modSizeLabel(mod, allCatalogMods, detailLocale);
  const reduxAddedDate = addedDate(mod, detailLocale);
  const downloads = catalogDownloadCount(mod);
  return pick(META_KEYS, {
    date: reduxAddedDate,
    size: size.text,
    sizeNote: size.approximate ? sizeEstimateNote() : "",
    downloads: downloads > 0 ? downloads.toLocaleString(detailLocale) : null,
  });
};

// Надпись над названием: словарь витрины, а если он слова не знает — общий перевод.
const kickerOf = (mod, language) => {
  const source = mod.catalogSubcategory || mod.categoryLabel || "";
  const word = catalogLabel(source, language);
  return word === source ? tr(source) : word;
};

/* ---------- «Стоит в игре»: чьи установки замененок искать ---------- */

// Группа вариантов мода: непустая строка без учёта регистра, иначе пусто.
const variantGroupOf = (entry) => {
  const group = entry?.domain?.variant?.group;
  return typeof group === "string" && group ? group.toLowerCase() : "";
};

// id мода, цели и (если у мода есть группа вариантов) всех модов каталога той же группы; без повторов.
const placedIdsOf = (mod, target, catalog) => {
  const group = variantGroupOf(mod);
  const siblings = group ? catalog.filter((entry) => variantGroupOf(entry) === group).map((entry) => entry.id) : [];
  return Array.from(new Set([mod.id, target.id, ...siblings]));
};

/* ---------- родня мода ---------- */

const reduxesOf = (mod, catalog, owners) => {
  const owner = owners.get(mod.id);
  if (!owner) return [];
  const others = packsContaining(mod, catalog).filter((pack) => pack.publicationMode === "bundle" && pack.id !== owner.id);
  return [owner, ...others];
};

// «Похожие»: весь каталог без самого мода, состава, паков, соседей по посту и их стволов.
const relatedOf = (mod, kind, catalog, kin) => {
  const skipped = new Set([mod, ...kin.members, ...kin.parents, ...kin.mates].map((entry) => entry.id));
  kin.mates.flatMap((mate) => packMembers(mate, catalog)).forEach((gun) => skipped.add(gun.id));
  const candidates = catalog
    .filter((entry) => !skipped.has(entry.id))
    .map((entry) => (entry.catalogCategory ? entry : { ...entry, catalogCategory: catalogCategoryForMod(entry) }));
  /* Ленте «Подборка модов» нужно больше, чем полке «Похожие» (14 с составом и родителями), поэтому берём 12. */
  return similarMods({ ...mod, catalogCategory: kind }, candidates, { limit: 12 });
};

// Пакет «Эффектов» или «Трейсеров» из строки части — один пакет (`single`), остальные части зовутся как раньше.
const only = partInstallArgs;

// Действия над частью мода; удаление и редактор есть, только если переданы обработчики.
const partActions = ({ installed, catalog, handlers, openEditorFor, openStandardFor, openCatalogFor }) => {
  const { onInstall, onRemove, onRetry, onNavigate } = handlers;
  return {
    replaces: (part) => partReplaces(part, installed, catalog),
    /* Части — по одному пакету (`single`): набор «Эффектов» и «Трейсеров» целиком ставит и снимает кнопка карточки, а не строка части окна «Компоненты». */
    install: (part, source) => animateInstallToDownloads({ source, cover: ownCoverOf(part), label: part.name }).then(() => onInstall?.(...only(part))),
    retry: (queueId) => onRetry?.(queueId),
    remove: onRemove ? (part) => onRemove(...only(part)) : null,
    edit: onNavigate ? (part, options) => openEditorFor(part, options) : null,
    /* «Сделать в мастерской» у компонента сборки: редактор его вида от стандартной основы. */
    startWork: onNavigate && openStandardFor ? (part) => openStandardFor(part) : null,
    /* «Взять из другого редукса»: каталог на полке слота; без перехода по разделам остаётся окно «Заменить компонент». */
    pickPlace: onNavigate && openCatalogFor ? (place) => openCatalogFor(place) : null,
  };
};

/* ---------- хуки страницы ---------- */

// «Установлено» и ход очереди карточки «Эффектов» и «Трейсеров» — по всему набору пакетов (`effects-install-set.js`), а не по одному из четырёх; остальные карточки — как есть.
function useEffectsSetFacts(target, facts, catalog, installed, queue) {
  const set = useMemo(() => (effectsSlotOf(target) ? installSetOf(target, catalog) : null), [target, catalog]);
  return set ? installSetFacts({ mod: target, set, installed, queue }) : facts;
}

// Адреса кадров, которые не загрузились; набор обнуляется после отрисовки при каждой смене мода.
function useDroppedFrames(modId) {
  const [dropped, setDropped] = useState(() => new Set());
  useEffect(() => setDropped(new Set()), [modId]);
  const drop = useCallback((src) => setDropped((seen) => (seen.has(src) ? seen : new Set(seen).add(src))), []);
  return [dropped, drop];
}

// Что показать на полке кадров: свои, кадры редукса или заглушка.
function useFrames(mod, reduxes) {
  const [dropped, drop] = useDroppedFrames(mod.id);
  const ownFrames = useMemo(() => framesOf(mod), [mod]);
  const alive = (frames) => frames.filter((frame) => !dropped.has(frame.src));
  const own = alive(ownFrames);
  const [lead] = reduxes;
  const borrowed = own.length || !lead ? [] : alive(framesOf(lead));
  if (own.length) return { media: own, framesFrom: "", drop };
  return borrowed.length ? { media: borrowed, framesFrom: lead.name, drop } : { media: [PLACEHOLDER_FRAME], framesFrom: "", drop };
}

// Родня мода: состав, паки, соседи по посту, редукс части, «Похожие», «Что внутри».
function useKin(mod, kind, catalog, language) {
  const members = useMemo(() => packMembers(mod, catalog), [mod, catalog]);
  const parents = useMemo(() => packsContaining(mod, catalog), [mod, catalog]);
  const mates = useMemo(() => postMates(mod, catalog), [mod, catalog]);
  const owners = useMemo(() => reduxOfParts(catalog), [catalog]);
  const reduxes = useMemo(() => reduxesOf(mod, catalog, owners), [mod, catalog, owners]);
  const related = useMemo(
    () => relatedOf(mod, kind, catalog, { members, parents, mates }),
    [mod, kind, catalog, members, parents, mates],
  );
  const contents = useMemo(() => packContents(mod, catalog, language), [mod, catalog, language]);
  return { members, parents, mates, related, reduxes, contents };
}

// Окна одежды: три независимых флага в одном состоянии.
function useDialogFlags() {
  const [flags, setFlags] = useState({ install: false, place: false, tattoo: false });
  const set = useCallback((name, value) => setFlags((prev) => ({ ...prev, [name]: value })), []);
  return [flags, set];
}

// Возврат из редактора: ещё до кадра прокручиваем главное окно туда, где стояли.
function useEditorReturn(modId) {
  useLayoutEffect(() => {
    const top = takeEditorReturnTop(modId);
    if (typeof top !== "number") return;
    document.querySelector(".desktop-main")?.scrollTo({ top, left: 0 });
    /* Место заявлено: смена раздела оболочкой не сбросит его наверх кадром позже (`useSectionScrollReset`). */
    claimScroll("detail");
  }, [modId]);
}

// Прогрев окна «Сделать заменёнку»: у цели с блоком одежды; остановка — то, что вернул прогрев.
function usePrewarm(target, block, catalog) {
  useEffect(() => {
    if (!block) return undefined;
    return prewarmClothingInstall({ mod: target, mods: catalog, loadDialog: loadInstallDialog });
  }, [block, target, catalog]);
}

/* ---------- установка и окна одежды ---------- */

// Нажатие «Установить» / «Удалить» / «Повторить» и три окна одежды с их подтверждениями.
function useInstallFlow({ mod, target, ready, active, catalog, handlers }) {
  const { onInstall, onRemove, onRetry } = handlers;
  const [open, setOpen] = useDialogFlags();
  const block = clothingOf(target);
  const tattooParts = tattooSetOf(target);
  usePrewarm(target, block, catalog);
  /* Цель по умолчанию (владелец 15.11.2026, ~23:40): «Установить» у одежды ВСЕГДА открывает «Сделать заменёнку» — «как с футболкой», хоть причёска, хоть ногти, хоть борода. Штатная вещь по умолчанию — только
     предложение: её плитка в окне выбрана заранее, стоит первой и подписана; ставит человек, нажав «Установить» (режима «сразу» без окна больше нет). */
  /* Ключ перечитывания занятости меняется при установке и снятии вещи: цель по умолчанию не считается по устаревшему списку (ревью 14.11, №5). */
  const preset = useDefaultTarget(
    block ? target : null,
    catalog,
    `${ready ? "on" : "off"}:${active?.queueId ?? ""}`,
  );

  // Полёт обложки владельца (по умолчанию — мода страницы); обещание наружу не отдаётся.
  const flyThen = (source, label, finish, owner = mod) => {
    animateInstallToDownloads({ source, cover: ownCoverOf(owner), label }).then(finish);
  };
  const flyFromCard = (label, finish) => flyThen(cardCoverImage() || document.body, label, finish);
  const installTarget = () => {
    onInstall?.(target);
  };

  // Какое окно одежды нужно этой установке: имя флага или пусто.
  const dialogFor = () => {
    const installKind = clothingInstallKind(mod);
    if (["pick", "gloves"].includes(installKind) && block?.component) return "install";
    if (installKind === "tattoo" && tattooParts) return "tattoo";
    return installKind || isClothingCard(mod) ? "place" : "";
  };

  // Ветви по порядку; ничего не возвращает ни одна: наружу не уходит ни полёт, ни ответ обработчиков.
  const handleInstall = (event) => {
    const grab = () => cardCoverImage() || event?.currentTarget;
    if (active?.failed && onRetry) {
      flyThen(grab(), target.name, () => {
        onRetry(active.queueId);
      });
    } else if (ready) {
      onRemove?.(target);
    } else if (isCatalogWork(mod)) {
      onInstall?.(mod);
    } else {
      const dialog = dialogFor();
      /* Вещь одежды ставится только после выбора, «на что поставить»: окно открывается всегда, без тихой установки. */
      if (dialog) setOpen(dialog, true);
      else flyThen(grab(), target.name, installTarget);
    }
  };

  const confirmations = {
    install: ({ installs = [], ...choice }) => {
      const steps = installs.length
        ? installs.map(({ modId, ...record }) => ({
            mod: catalog.find((entry) => entry.id === modId) ?? target,
            choice: { ...choice, ...record, targets: record.targets ?? [record.target] },
          }))
        : [{ mod: target, choice }];
      const chosen = steps.map((step) => (step.choice.target ? shownTargetName(step.choice.target) : "")).join(", ");
      flyFromCard(`${target.name} → ${chosen}`, () => {
        steps.forEach((step) => onInstall?.({ ...step.mod, clothingChoice: step.choice }));
      });
    },
    place: () => {
      flyFromCard(target.name, installTarget);
    },
    tattoo: ({ picks }) => {
      flyFromCard(target.name, () => {
        onInstall?.({ ...target, tattooSetChoice: { picks } });
      });
    },
  };
  const confirmDialog = (name) => (selection) => {
    setOpen(name, false);
    confirmations[name](selection);
  };
  const closeDialog = (name) => () => {
    setOpen(name, false);
  };

  const dialogs = (
    <>
      {open.install && Boolean(block) && (
        <Suspense fallback={null}>
          <ClothingInstallDialog mod={target} mods={catalog} preset={preset.state === "ready" ? preset.target?.key ?? null : null} onClose={closeDialog("install")} onConfirm={confirmDialog("install")} />
        </Suspense>
      )}
      {open.place && (
        <Suspense fallback={null}>
          <ClothingPlaceDialog mod={target} mods={catalog} onClose={closeDialog("place")} onConfirm={confirmDialog("place")} />
        </Suspense>
      )}
      {open.tattoo && Boolean(tattooParts) && (
        <Suspense fallback={null}>
          <TattooSetDialog mod={target} parts={tattooParts} onClose={closeDialog("tattoo")} onConfirm={confirmDialog("tattoo")} />
        </Suspense>
      )}
    </>
  );
  return { handleInstall, dialogs };
}

/* ---------- редактор в том же кадре ---------- */

// Открывает редактор для записи (цели или части) под экраном загрузки; результат — обещание true/false.
function useEditorOpener({ mod, catalog, installed, language, cardCopy, onNavigate }) {
  return (subject, { weapon = "", colour = "", pick = "" } = {}) => {
    const editorInfo = modEditor(subject) || catalogWorkEditor(subject);
    const key = editorInfo ? editorInfo.copyKey || editorInfo.kind : "";
    const title = Object.hasOwn(cardCopy.editor, key) ? cardCopy.editor[key].name : "";
    const top = document.querySelector(".desktop-main")?.scrollTop ?? 0;
    const label = tr("Готовлю редактор по файлам мода…");
    const settings = { mods: catalog, navigate: onNavigate, locale: language, returnTo: mod, returnTop: top, returnPick: pick, installed, weapon, colour };
    return openingEditor({ title, label, top }, () => openModEditor(subject, settings));
  };
}

// Открывает редактор вида компонента от стандартной основы под тем же экраном загрузки; результат — обещание true/false.
function useStandardEditorOpener({ mod, language, onNavigate }) {
  return (part) => {
    const top = document.querySelector(".desktop-main")?.scrollTop ?? 0;
    const label = tr("Готовлю редактор по файлам мода…");
    return openingEditor({ title: "", label, top }, () => openStandardEditor(part, { navigate: onNavigate, locale: language, returnTo: mod, returnTop: top }));
  };
}

// «Взять из другого редукса»: запоминает, куда вернуться и где была прокрутка (возврат — `useEditorReturn`), и открывает каталог на полке слота (`component-pick.js`).
// Полка открывается с начала: прокрутка прежней полки каталога на этой не нужна.
function useCatalogOpener({ mod, onNavigate }) {
  return (place) => {
    rememberEditorReturn(mod, document.querySelector(".desktop-main")?.scrollTop ?? 0);
    rememberSection("catalog:scroll", 0);
    onNavigate("catalog", place);
  };
}

/* ---------- страница мода ---------- */

function ModPage(props) {
  const { onBack, onInstall, onRemove, onRetry, onSelect, onNavigate } = props;
  const language = given(props.language, "ru");
  const installed = given(props.installed, []);
  const queue = given(props.queue, []);
  const returnTo = given(props.returnTo, "catalog");
  const backName = given(props.backName, "");
  const showcase = given(props.catalogMods, []);
  const stock = given(props.allMods, []);
  const detailLocale = localeOf(language);
  const copy = modDetailCopy(language);
  const words = modActionCopy(language);
  const cardCopy = modCardCopy(language);
  const allCatalogMods = useMemo(() => gluedCatalog(showcase, stock), [stock, showcase]);
  /* Карточка с вариантами (редукс под GTA 5 RP / Majestic): страница целиком — выбранная версия, а не та запись, что открыли с полки. */
  const variant = useModVariant({ mod: props.mod, allMods: allCatalogMods, installed, queue });
  const { target, shown, variantChoice } = variant;
  const { ready, active } = useEffectsSetFacts(target, variant, allCatalogMods, installed, queue);
  const mod = shown;
  const kind = mod.catalogCategory || catalogCategoryForMod(mod);

  const kin = useKin(mod, kind, allCatalogMods, language);
  const { media, framesFrom, drop } = useFrames(mod, kin.reduxes);
  const placements = useClothingPlacements(engineModIds(installed), "");
  /* Выбранное на карточке до ухода в редактор (ствол пака): один id — тот, под которым запись сделана и забирается (`props.mod`), а не показанный вариант `mod` (ревью 16.11.2026, находка 4); считается один раз за карточку, до того как `useEditorReturn` заберёт запись. */
  const returnPick = useMemo(() => peekEditorReturnPick(props.mod.id), [props.mod.id]);
  useEditorReturn(props.mod.id);
  const { handleInstall, dialogs } = useInstallFlow({
    mod,
    target,
    ready,
    active,
    catalog: allCatalogMods,
    handlers: { onInstall, onRemove, onRetry },
  });
  const openEditorFor = useEditorOpener({ mod: props.mod, catalog: allCatalogMods, installed, language, cardCopy, onNavigate });
  const openStandardFor = useStandardEditorOpener({ mod: props.mod, language, onNavigate });
  const openCatalogFor = useCatalogOpener({ mod: props.mod, onNavigate });

  const plan = pick(PLAN_KEYS, {
    ...planFacts({ mod, kind, words, language, ready, active }),
    onInstall: handleInstall,
    /* Работа-набор ставится кнопкой «Установить», а в мастерскую ведёт вторая (`DesktopShell`: `options.openInWorkshop`). */
    onOpenWork: () => onInstall?.(mod, { openInWorkshop: true }),
    installMod: target,
    variantChoice,
    ready,
    active,
  });

  const parts = pick(PARTS_KEYS, {
    installed,
    queue,
    open: onSelect,
    /* Мод, чьи это части: в корзине часть лежит как «часть мода» (`features/cart/`). */
    owner: props.mod,
    ...partActions({ installed, catalog: allCatalogMods, handlers: { onInstall, onRemove, onRetry, onNavigate }, openEditorFor, openStandardFor, openCatalogFor }),
  });

  const view = pick(VIEW_KEYS, {
    mod,
    language,
    locale: detailLocale,
    copy,
    cardCopy,
    onBack,
    media,
    framesFrom,
    dialogs,
    plan,
    parts,
    reduxes: kin.reduxes,
    contents: kin.contents,
    actionCopy: kin.reduxes.length ? { ...words, install: tr("Установить отдельно") } : words,
    returnLabel: backName || copy.backTo[returnTo] || copy.backTo.catalog,
    returnPick,
    kicker: kickerOf(mod, language),
    renderMedia: (frame, className, { playing = false, stage = false } = {}) =>
      drawFrame({ frame, className, playing, stage, mod, copy, drop }),
    dropMedia: drop,
    captionOf: (frame) => localMediaCaption(frame, language),
    mediaClasses:
      (usesContainedMedia(mod) ? " is-contained-media" : "") + (usesWeaponMedia(mod) ? " is-weapon-media" : ""),
    cover: ownCoverOf(mod),
    hasModel: Boolean(modModelUrl(mod)),
    meta: metaFacts(mod, allCatalogMods, detailLocale),
    editor: onNavigate ? modEditor(target) : null,
    onEdit: (colour = "") => openEditorFor(target, { colour }),
    isSound: isSoundMod(mod) || kind === "sounds" || Boolean(kin.contents[0]?.sound),
    onOpenAuthor: onSelect || null,
    rails: pick(RAILS_KEYS, { ...kin, allMods: allCatalogMods, onSelect }),
    placed: placementsOfMod(placements, placedIdsOf(mod, target, allCatalogMods)),
  });

  return <ModCard view={view} />;
}

export default function ModDetailPage(props) {
  return isAuthorPage(props.mod) ? <AuthorPage {...props} /> : <ModPage {...props} />;
}
