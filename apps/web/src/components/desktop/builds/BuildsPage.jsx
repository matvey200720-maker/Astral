import { useEffect, useMemo, useState } from "react";
import {
  useInstalledWorkCards,
  useInstalledWorkItems,
} from "../../../features/library/useMyMods.js";
import { BuildsGrid, CopiedToast, DeleteBuildDialog } from "./BuildsParts.jsx";
import { countEnabled, unblockedSet } from "./build-lists.js";
import { useLibrary } from "./use-library.js";
import BuildCreatePage from "./BuildCreatePage.jsx";
import {
  NO_MODS,
  cardViews,
  codableOnly,
  followLive,
  importedCards,
  kindNamesOf,
  leavingOf,
  openedContents,
  sizeFormatterOf,
  standingOf,
  visibleProfiles,
} from "./build-views.js";
import Button from "../../ui/Button.jsx";
import { useUntickMissing } from "../../../features/builds/build-mods.js";
import { useNewBuildPicks } from "../../../features/builds/use-new-build-picks.js";
import { buildWorksEnabled } from "../../../features/builds/works-switch.js";
import { copyFlow, createFlow, deleteFlow, importFlow, installFlow, removeFlow } from "./build-flows.js";
import { useCopiedBuildToast } from "../../../features/builds/use-copied-build-toast.js";
import Showcase from "../../../features/showcase/Showcase.jsx";
import { cardPropsOf, createPropsOf, openedPropsOf } from "./build-props.js";
import { buildWorksCopyFor } from "../../../features/builds/build-works-copy.js";
import BuildCard from "./BuildCard.jsx";
import BuildsHero from "./BuildsHero.jsx";
import BuildsTiles from "./BuildsTiles.jsx";
import { buildIsInstalled } from "../../../features/builds/build-state.js";
import {
  remember,
  useRememberedScroll,
  useRememberedState,
} from "../../../section-memory.js";
import BuildsEmptyTiles from "./BuildsEmptyTiles.jsx";
import {
  useBuildCodeText,
  useBuildImportPreview,
  useBuildImportWorks,
} from "../../../features/builds/use-import-preview.js";
import BuildOpenedPage from "./BuildOpenedPage.jsx";
import { buildsCopyFor } from "../../../features/builds/builds-copy.js";
import { useCodePicks } from "../../../features/builds/use-code-picks.js";
import { ClipboardText, Plus } from "../../ui/icons.jsx";
import { isFromCode, readFromCode, splitByOrigin } from "../../../features/builds/code-history.js";
import { tr, useTr } from "../../../locales/ui.js";
import BuildsHead from "./BuildsHead.jsx";
import { canEdit, useEditBuild } from "./use-edit-build.js";
import { useBuildChoices } from "./use-build-choices.js";
import BuildsGot from "./BuildsGot.jsx";

// Окно сборки показывает плитки порциями: столько сразу и на столько растёт «Показать ещё».
const PAGE_SIZE = 10;
// Место показа стоит после этой по счёту карточки (после последней, если их меньше).
const SHOWCASE_AFTER = 2;

// Общие пустые значения: свойства не меняются от отрисовки к отрисовке.
const NO_ITEMS = [];
const NO_QUEUE = [];
function noModSize() {
  return 0;
}

function newSet() {
  return new Set();
}

/* ---------- страница ---------- */

export default function BuildsPage(props) {
  const { installed, data, onNotice, profiles } = props;
  const { setProfiles, onInstallBuild, onNavigate } = props;
  const { onCreateProfile, onDeleteProfile, onImportProfile } = props;
  const { cloudMode = false, catalogMods = NO_MODS, catalogConnection = null } = props;
  const { getModSize = noModSize, animateInstall, queue = NO_QUEUE, language = "ru" } = props;

  useTr();
  const creatingMemo = useRememberedState("builds:creating", false);
  const nameMemo = useRememberedState("builds:name", "");
  const importMemo = useRememberedState("builds:import", "");
  const openedMemo = useRememberedState("builds:opened", null);
  const visibleMemo = useRememberedState("builds:visible", PAGE_SIZE);
  const enabledMemo = useRememberedState("builds:enabled", newSet);
  const tabMemo = useRememberedState("builds:tab", "mine");
  const [tab, setTab] = tabMemo;
  const [creating, setCreating] = creatingMemo;
  const [name, setName] = nameMemo;
  const [importCode, setImportCode] = importMemo;
  const [opened, setOpened] = openedMemo;
  const [visibleModCount, setVisibleModCount] = visibleMemo;
  const [enabledIds, setEnabledIds] = enabledMemo;
  const [deleting, setDeleting] = useState(null);
  // Короткий код, который лёг в буфер при копировании: «билет» открытой сборки показывает его вместо начала полного кода.
  const [shownCodes, setShownCodes] = useState({});
  useRememberedScroll("builds:scroll");

  const copy = useMemo(function pageCopy() {
    return buildsCopyFor(language);
  }, [language]);
  const worksCopy = useMemo(function worksText() {
    return buildWorksCopyFor(language);
  }, [language]);
  const workKinds = useMemo(function kindNames() {
    return kindNamesOf(language);
  }, [language]);
  const sizeOf = useMemo(function sizeFormatter() {
    return sizeFormatterOf(language);
  }, [language]);

  const library = useLibrary({
    catalogMods,
    libraryMods: data?.mods || NO_MODS,
    installed,
    profiles,
    catalogConnection,
  });
  const { availableMods, modsById, installedIds } = library;
  const { catalogState, blockOf, entriesOf } = library;

  // Работы выключены: страница видит сборки без работ и установок мастерской.
  const worksOn = buildWorksEnabled();
  const shown = useMemo(function shownList() {
    return visibleProfiles(profiles, worksOn);
  }, [profiles, worksOn]);

  const liveWorkItems = useInstalledWorkItems(installed, creating);
  const workItems = worksOn ? liveWorkItems : NO_ITEMS;
  const codableWorks = useMemo(function codableList() {
    return codableOnly(workItems);
  }, [workItems]);
  const workCardsInfo = useInstalledWorkCards(workItems, codableWorks);
  const { installOrder, installedWorkCards } = workCardsInfo;

  const toast = useCopiedBuildToast();
  const picks = useNewBuildPicks({
    installed,
    modsById,
    catalogState,
    cloud: cloudMode,
    blockOf,
    entriesOf,
  });
  const edit = useEditBuild({
    shown,
    entriesOf,
    blockOf,
    libraryIds: picks.ids,
    setProfiles,
  });
  const pastedCode = useBuildCodeText(importCode);
  const importMods = useBuildImportPreview({
    importCode: pastedCode.code,
    entriesOf,
    modsById,
  });
  const rawImportWorks = useBuildImportWorks({ importCode: pastedCode.code });
  const importWorks = useMemo(function importedList() {
    return importedCards(rawImportWorks, installOrder);
  }, [rawImportWorks, installOrder]);
  const codePicks = useCodePicks({
    importCode: pastedCode.code,
    importMods,
    blockOf,
    cloud: cloudMode,
  });
  useUntickMissing(catalogState, modsById, blockOf, setEnabledIds);

  const cards = useMemo(function cardList() {
    return cardViews(shown, entriesOf, modsById, installOrder, workItems);
  }, [shown, entriesOf, modsById, workItems, installOrder]);
  // «Мои» и «По коду»: что пришло из кода, помнит `code-history.js`; список пересчитывается, когда меняются сборки.
  const origin = useMemo(function originList() {
    return splitByOrigin(shown, readFromCode());
  }, [shown]);
  const codeIds = useMemo(function codeIdList() {
    return new Set(origin.byCode.map((item) => item.id));
  }, [origin]);
  const mineCards = useMemo(() => cards.filter((card) => !codeIds.has(card.profile.id)), [cards, codeIds]);
  const codeCards = useMemo(() => cards.filter((card) => codeIds.has(card.profile.id)), [cards, codeIds]);
  const byCodeTab = tab === "code";
  const tabCards = byCodeTab ? codeCards : mineCards;
  const openedView = useMemo(function openedList() {
    return openedContents(opened, entriesOf, modsById, installOrder, workItems);
  }, [opened, entriesOf, modsById, workItems, installOrder]);

  const isOpen = Boolean(opened);
  const standingIds = useMemo(function standingList() {
    return standingOf(isOpen, installed, modsById, catalogState);
  }, [isOpen, installed, modsById, catalogState]);
  const leavingMods = useMemo(function leavingList() {
    return leavingOf(standingIds, enabledIds, entriesOf);
  }, [standingIds, enabledIds, entriesOf]);
  const enabledCount = countEnabled(openedView, enabledIds);
  /* Выбор цели у вещей одежды этой сборки: кнопка «Выбрать цели (N)», подписи на плитках, окна по очереди (`use-build-choices.js`). */
  const choose = useBuildChoices({
    build: opened,
    mods: openedView?.mods,
    enabledIds,
    installedIds,
    catalog: availableMods,
    setProfiles,
  });

  useEffect(function followOpened() {
    followLive(shown, opened, setOpened);
  }, [shown, opened, setOpened]);

  // Слова и списки страницы, общие для действий и свойств дочерних частей.
  const words = { copy, worksCopy, language, onNotice };
  const lists = { blockOf, getModSize, availableMods, installedIds };

  // Пустой итог не показывается.
  function announce(text) {
    if (text) onNotice(text);
  }

  // Название по умолчанию для новой сборки: номер следующей по счёту.
  function nextName() {
    return copy.defaultName(profiles.length + 1);
  }

  function openBuild(profile) {
    setOpened(profile);
    setVisibleModCount(PAGE_SIZE);
    setEnabledIds(unblockedSet(profile.modIds, blockOf));
  }

  /* «Изменить» у открытой сборки: страница создания с составом этой сборки; «Отмена» и сохранение возвращают на её страницу. */
  function startEditing(build) {
    setOpened(null);
    edit.start(build);
  }

  function cancelEditing() {
    const build = edit.profile;
    edit.stop();
    if (build) openBuild(build);
  }

  function saveEditing() {
    const saved = edit.save();
    if (!saved) return;
    announce(tr("Изменения сохранены"));
    openBuild(saved);
  }

  // Поля нового черновика очищаются перед началом создания.
  function clearDraft() {
    setName("");
    setImportCode("");
  }

  // Создание закончено: окно закрыто, поле имени и выбор сброшены.
  function finishCreation() {
    setCreating(false);
    setName("");
    picks.reset();
  }

  function startCreating() {
    clearDraft();
    picks.reset();
    remember("builds:create-mode", "save");
    setCreating(true);
  }

  /* «Ввести код друга»: та же страница «Новая сборка», сразу на вкладке «По коду». */
  function startPasting() {
    clearDraft();
    picks.reset();
    remember("builds:create-mode", "code");
    setCreating(true);
  }

  function createBuild() {
    const input = { name, picks, installed, modsById, workItems: codableWorks };
    return createFlow(input, words, { onCreateProfile, setProfiles, finishCreation, nextName });
  }

  function importBuild() {
    const source = { importCode, pastedCode, codePicks, cloudMode, onImportProfile };
    return importFlow(source, words, { setProfiles, setImportCode, setCreating, openBuild });
  }

  function installOpened(event) {
    const current = { build: opened, view: openedView, enabledIds };
    const calls = { animateInstall, setOpened, onInstallBuild, onNotice, announce, worksCopy };
    return installFlow(event, current, calls);
  }

  async function copyBuild(profile) {
    const result = await copyFlow(profile, toast, { copy, onNotice });
    if (result?.short) setShownCodes((prev) => ({ ...prev, [profile.id]: result.code }));
  }

  /* Чужой код из «билета» открытой сборки: то же окно создания на вкладке «По коду», код уже в поле. */
  function pasteCode(code) {
    clearDraft();
    picks.reset();
    remember("builds:create-mode", "code");
    setImportCode(code);
    setOpened(null);
    setCreating(true);
  }

  function removeWorks(profile) {
    return removeFlow(profile, announce, worksCopy);
  }

  function deleteBuild() {
    const given = { target: deleting, profiles, opened };
    return deleteFlow(given, words, { onDeleteProfile, setProfiles, setOpened, setDeleting });
  }

  // Свойства окна открытой сборки; считаются только при открытой сборке.
  function openedProps() {
    const open = { build: opened, view: openedView, leavingMods, enabledCount };
    const marks = { enabledIds, setEnabledIds, visibleModCount, setVisibleModCount };
    const extra = { workItems, workKinds, copiedBuildId: toast.copiedBuildId, choice: choose };
    extra.installed = buildIsInstalled(opened, installedIds);
    extra.fromCode = isFromCode(opened);
    extra.shownCode = shownCodes[opened.id] || "";
    const acts = { onCopy: copyBuild, onInstall: installOpened, onNavigate };
    acts.onPasteCode = pasteCode;
    acts.onRemoveWorks = removeWorks;
    acts.onDelete = setDeleting;
    acts.onEdit = canEdit(opened, cloudMode) ? startEditing : undefined;
    acts.onClose = () => setOpened(null);
    marks.pageSize = PAGE_SIZE;
    return openedPropsOf(open, marks, extra, acts, words, lists);
  }

  // Окно создания и карточка первой сборки получают одно и то же; закрыть умеет только окно.
  function createProps(onClose) {
    const draft = { picks, installedWorkCards, name, importCode, nextName };
    const imports = { pastedCode, importMods, importWorks, codePicks, workItems };
    const acts = { onName: setName, onImportCode: setImportCode };
    acts.onCreate = createBuild;
    acts.onImport = importBuild;
    return createPropsOf(onClose, draft, imports, acts, words, lists);
  }

  // Страница «Изменить»: те же свойства, что у создания, но состав и название — этой сборки, а действие — «Сохранить».
  function editProps() {
    const base = createProps(cancelEditing);
    return {
      ...base,
      editing: true,
      installedMods: edit.mods,
      installedWorks: NO_ITEMS,
      installedCount: edit.enabledIds.size,
      installedWorksCount: 0,
      name: edit.name,
      onName: edit.setName,
      defaultName: edit.profile.name,
      selection: edit.selection,
      onCreate: saveEditing,
      importMods: NO_ITEMS,
      importWorks: NO_ITEMS,
    };
  }

  // Свойства карточки: то, что известно о сборке, и общие для всех карточек данные и действия.
  function cardProps(card) {
    const extra = { sizeOf, copiedBuildId: toast.copiedBuildId, queue };
    const acts = { onOpen: openBuild, onCopy: copyBuild };
    acts.onRemoveWorks = removeWorks;
    acts.onDelete = setDeleting;
    return cardPropsOf(card, extra, acts, words, lists);
  }

  // Карточки сборок; после заданной по счёту стоит место показа.
  const showcaseAfter = Math.min(SHOWCASE_AFTER, tabCards.length) - 1;
  const showcaseProps = { place: "builds", screen: "builds", language };
  showcaseProps.className = "builds-showcase";
  const shelf = [];
  tabCards.forEach((card, index) => {
    shelf.push(<BuildCard key={card.profile.id} {...cardProps(card)} />);
    if (index === showcaseAfter) shelf.push(<Showcase key="showcase" {...showcaseProps} />);
  });

  /* Афиша (дизайн 15.11.2026): сборка, что стоит в игре, — крупно над сеткой; плитка «Создать сборку» — первой в сетке (владелец 16.11.2026). */
  const heroCard = tabCards.find((card) => buildIsInstalled(card.profile, installedIds));
  const closeDeleting = () => setDeleting(null);
  const deleteProps = { copy, build: deleting, onCancel: closeDeleting, onConfirm: deleteBuild };
  const empty = shown.length === 0;
  const startProps = { variant: "primary", icon: <Plus />, onClick: startCreating };
  const startButton = <Button {...startProps}>{copy.newBuild}</Button>;
  const headProps = { title: copy.title, tab, onTab: setTab, mineCount: mineCards.length, codeCount: codeCards.length };
  /* Ввод кода друга не теряется, пока сборки есть: компактная кнопка в шапке рядом с «Новой сборкой». */
  const pasteButton = (
    <Button variant="secondary" icon={<ClipboardText />} onClick={startPasting}>
      {tr("Ввести код друга")}
    </Button>
  );
  headProps.actions = (
    <div className="builds-head-actions">
      {pasteButton}
      {startButton}
    </div>
  );

  if (opened) {
    return (
      <div className="desktop-page builds-page builds-library-page is-bleed">
        <BuildOpenedPage key={opened.id} {...openedProps()} />
        {choose.dialog}
        {deleting ? <DeleteBuildDialog {...deleteProps} /> : null}
        {toast.copiedBuildId ? <CopiedToast leaving={toast.copyToastLeaving} label={copy.copied} /> : null}
      </div>
    );
  }

  if (edit.profile) {
    return (
      <div className="desktop-page builds-page builds-library-page is-bleed">
        <BuildCreatePage {...editProps()} />
      </div>
    );
  }

  if (creating) {
    return (
      <div className="desktop-page builds-page builds-library-page is-bleed">
        <BuildCreatePage {...createProps(() => setCreating(false))} />
        {toast.copiedBuildId ? <CopiedToast leaving={toast.copyToastLeaving} label={copy.copied} /> : null}
      </div>
    );
  }

  return (
    <div className={`desktop-page builds-page builds-library-page${empty ? " is-empty" : ""}`}>
      {empty ? null : <BuildsHead {...headProps} />}
      {empty ? (
        <BuildsEmptyTiles copy={copy} onCreate={startCreating} onPaste={startPasting} />
      ) : (
        <>
          {byCodeTab && codeCards.length === 0 ? (
            <p className="builds-code-empty">{tr("Сборки, прочитанные по коду, появятся здесь.")}</p>
          ) : null}
          {heroCard ? <BuildsHero card={cardProps(heroCard)} copy={copy} onOpen={openBuild} onCopy={copyBuild} /> : null}
          <BuildsGrid label={copy.gridLabel}>
            {byCodeTab ? null : <BuildsTiles copy={copy} onNew={startCreating} />}
            {shelf}
          </BuildsGrid>
          {byCodeTab ? null : <BuildsGot cards={codeCards.map(cardProps)} onOpen={openBuild} />}
        </>
      )}
      {deleting ? <DeleteBuildDialog {...deleteProps} /> : null}
      {toast.copiedBuildId ? (
        <CopiedToast leaving={toast.copyToastLeaving} label={copy.copied} />
      ) : null}
    </div>
  );
}
