import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQaQueueSeed } from "../../dev/use-qa-queue-seed.js";
import { usePrefetchNext } from "../../features/downloads/usePrefetchNext.js";
import { useDeferredResume } from "../../features/downloads/useDeferredResume.js";
import { connectPartMapSource } from "../../features/catalog/part-map.js";
import { scheduleCatalogWarm } from "../../features/catalog/warm-schedule.js";
import { cloudItemsOf } from "../../features/builds/cloud-items.js";
import { CheckCircle, WarningCircle } from "../ui/icons.jsx";
import { Brand } from "@astral/design";
if (
  typeof document !== "undefined" &&
  typeof window !== "undefined" &&
  window.location.pathname.startsWith("/app")
) {
  document.title = "Astral";
}
import { PreparationDock, ProductOnboardingScreen, loadProductOnboarding } from "../../pages/ProductStartup.jsx";
import { installDesktopInteractionGuards } from "../../desktop-interaction-guards.js";
import DesktopNavigation from "./navigation/DesktopNavigation.jsx";
import GuardedDesktopPageRouter from "./GuardedDesktopPageRouter.jsx";
import { KEPT_PAGES, KeptPages, useKeptPages } from "./KeptPage.jsx";
import DesktopOverlayPortal from "./overlays/DesktopOverlayPortal.jsx";
import {
  cancelWorkshopInstall,
  dismissWorkshopInstall,
  holdWorkshopInstalls,
  releaseWorkshopInstalls,
  retryWorkshopInstall,
  setWorkshopBatchPartner,
  useWorkshopInstalls,
  workshopInstallsWriting,
} from "../../features/workshop/install-queue/index.js";
import { modIdFromDeepLink, modSizeBytes } from "../../catalog-utils.js";
import { packageUrlForRegion } from "../../network-regions.js";
import { normalizeLanguage } from "../../locales/desktop.js";
import { prepareUiText, tr, useUiLanguageSync } from "../../locales/ui.js";
import { ShellScene, shellSurfaceProps } from "./DesktopShellSurface.jsx";
import { useAppearancePreferences } from "../../hooks/useAppearancePreferences.js";
import useAssemblyOrder from "../../hooks/useAssemblyOrder.js";
import { useDocumentHolds } from "../ui/useHolds.js";
import { usePreparationFlow } from "../../hooks/usePreparationFlow.js";
import useSingleFlight from "../../hooks/useSingleFlight.js";
import { motionEnabled as motionIsEnabled } from "../../motion-preference.js";
import {
  forgetSection,
  remember,
  enterSection,
  useDeferredSection, useSectionScrollReset,
} from "../../section-memory.js";
import { readStartPage } from "./settings/useGeneralPreferences.js";
import SettingsWindow from "./settings/SettingsWindow.jsx";
import { planConflicts } from "../../utils/catalogConflicts.js";
import { replacedNamesOf, replacedNotice, underWorkNames, withEngineReplaced } from "../../features/downloads/newest-wins.js";
import { modPicture } from "../../features/library/mod-picture.js";
import { loadStartup } from "../../features/onboarding/startup.js";
import { startupFlow } from "../../features/onboarding/splash/startup-flow.js";
import { bundleFieldsOf, installOrigin } from "../../features/library/install-origin.js";
import { useStartupRecovery } from "../../features/library/startup-recovery.js";
import { useGameGate } from "../../features/onboarding/game-gate.js";
import { forgetWorkshopInstallsAfterReset } from "../../workshop-library.js";
import { resetWindowClock } from "../../features/downloads/reset-window-log.js"; // сброс 12.10
import { joinSentences } from "../../utils/join-sentences.js";
import { useReconcileNotices } from "../../hooks/reconcile-notices.js";
import { useGameCrashWatch } from "../../features/game-crash/use-game-crash-watch.js";
import { useCheckRemoved } from "../../hooks/useCheckRemoved.js";
import { applyQueueOrder } from "../../features/downloads/queue-order.js";
import { isPageHidden } from "./navigation/hidden-pages.js";
import { useRestorableMods } from "../../features/library/restorable-mods.js";
import { useWaitingUpdates } from "../../hooks/useWaitingUpdates.js";
import { waitingCopyFor } from "../../features/library/waiting-copy.js";
import { preparationStop, shellNoticesFor } from "./shell-notices.js";
import { sessionAccount, useCloudSession } from "../../features/onboarding/useCloudSession.js";
import { shellRestored, useShellHibernation } from "../../features/hibernation/useShellHibernation.js";
import CloudConnectionStatus from "../../features/onboarding/CloudConnectionStatus.jsx";
import FocusTip from "../../features/a11y/FocusTip.jsx";
import CommandPalette from "../../features/search/CommandPaletteLauncher.jsx";
import {
  finishOnboarding,
  rememberConfirmedGame,
} from "../../features/onboarding/confirmed-game.js";
import {
  migrateBuildWorks,
  persistProfiles,
  withStoredWorks,
} from "../../features/builds/build-works-store.js";
import * as catalogWork from "../../features/workshop/works/catalog-work.js";
import { useDetailTrail } from "../../features/catalog/detail-trail.js";
import { useMouseNavigation } from "./useMouseNavigation.js";
import {
  animateInstallToDownloads,
  BundleContext,
  bundleMembers,
  bundleOriginsOf,
  bundleRemoval,
  publicCatalogPreviewMods,
  usePrefetchCatalogPages,
} from "../../features/catalog/index.js";
import { isCatalogBundle } from "../../catalog-utils.js";
import {
  buildBlockedNotice,
  encodePortableBuild,
  prepareBuildInstallPlan,
  separateRemovals,
} from "../../features/builds/logic.js";
import {
  DownloadsPanel,
  FastInstallOffer, CloseAskHost,
  downloadsRailMetrics,
  humanFailure,
  pending,
  queueRowBytes,
  recordDownloadDone,
  successNotice,
  useDownloadsRequests, useForeignQuestionOpen,
  useInstallProgressBridge,
  useSimulatedProgress,
  useWorkInstallFlight,
} from "../../features/downloads/index.js";
import {
  recordDesktopCatalogDownload,
  useDesktopTelemetry,
} from "../../features/telemetry/index.js";
import {
  cancelLocalOperation,
  chooseGameInstallation,
  createCloudBuild,
  deleteCloudBuild,
  detectInstallations,
  getAuthSession,
  getCloudCatalog,
  getCloudDownloadGrant,
  getCloudFavorites,
  getLocalInstallProfile,
  getVanillaStatus,
  installRemotePackage as installRemotePayload,
  launchGame,
  logoutAccount,
  listCloudBuilds,
  onCloudCatalog,
  planLocalPackage,
  resetLocalTarget,
  setCloudFavorite,
  uninstallLocalPackage,
  onVanillaStatus,
} from "../../api.js";
import {
  cloudCatalogIDPattern,
  covers,
  localDeveloperAccount,
  localFirstRunQaAccount,
  FAR_PLATE_WORK_NAMES,
  readStoredLocalProfiles,
} from "./desktopShellDefaults.js";
import { resolveGameTarget } from "../../features/workshop/install-queue/game-root.js";
import { guardRebuiltArenas } from "../../features/workshop/arena-editor/rebuilt-arena.js";
import { rememberInstallRecords, useCatalogInstalled } from "../../features/library/engine-ids.js";
import { applyCatalogChoice, looksLikeClothing, withSavedChoice } from "../../features/clothing/apply-choice.js";
import CartPanel from "../../features/cart/CartPanel.jsx";
import { followAlias } from "../../features/navigation/destination-alias.js";

/* Сколько живёт уходящая страница загрузок: обязано совпадать с `dl-page-out` в downloads-ribbon.css (иначе она оборвётся на полукадре или повисит пустой). Сверяет test/downloads-motion.test.js. */
const DOWNLOADS_CLOSE_MS = 160;

/* Без движения ждать нечего, но нулём ставить нельзя: класс `is-closing` должен
   успеть дожить до кадра, иначе React снимет панель тем же тактом. */
const DOWNLOADS_CLOSE_STILL_MS = 20;

export default function DesktopApp() {
  const onboardingQuery = new URLSearchParams(window.location.search);
  const previewState = onboardingQuery.get("preview");
  const previewBeforeRegistration = previewState === "before-registration";
  const previewAfterRegistration = previewState === "after-registration";
  const localDeveloperMode =
    onboardingQuery.get("developer") === "local" &&
    Boolean(window.modovik?.localDeveloperMode);
  const localFirstRunQaMode =
    onboardingQuery.get("qa-auth") === "local" &&
    Boolean(window.modovik?.localFirstRunQaMode);
  const previewAccount = previewAfterRegistration
    ? {
        id: "astral-preview-user",
        name: "Astral Preview",
        email: "preview@astral.local",
        role: "user",
      }
    : null;
  const demoMode = Boolean(window.modovik?.demoMode);
  // Electron contextBridge exposes deeply frozen values. Keep an application-owned
  // copy because game and catalog records receive transient UI state later on.
  const demoContext = useMemo(() => {
    const value = window.modovik?.demoContext;
    return value ? JSON.parse(JSON.stringify(value)) : {};
  }, []);
  const freshOnboarding = !previewState && onboardingQuery.get("fresh") === "1";
  /* Страница запуска — из «Настройки › Общее» (Т-160); после спячки окна — где был (`features/hibernation/`). */
  /* Убранные страницы («library» с 16.11.2026, «optimization») из старого снимка окна не восстанавливаются: на их месте была бы пустота. */
  const [page, setPage] = useState(() => {
    const restored = shellRestored("page", readStartPage);
    return isPageHidden(restored) ? readStartPage() : restored;
  });
  const [settingsOpen, setSettingsOpen] = useState(() => Boolean(shellRestored("settingsOpen", false))); // окно, не страница
  /* Профиль открыли из «Настроек» — слева вверху у него стрелка «‹ Настройки» (владелец, 16.11.2026): запоминается страница под окном настроек. */
  const [profileOrigin, setProfileOrigin] = useState(null);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloadsClosing, setDownloadsClosing] = useState(false);
  const downloadsCloseTimerRef = useRef(null);
  useEffect(() => installDesktopInteractionGuards(), []);
  /* Новому человеку страница входа понадобится сразу после заставки: её кусок едет вместе с запуском. */
  useEffect(() => { if (!onboardingComplete) void loadProductOnboarding(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => window.clearTimeout(downloadsCloseTimerRef.current),
    [],
  );
  const [catalogGroup, setCatalogGroup] = useState(() => shellRestored("catalogGroup", null));
  const [data, setData] = useState({ mods: [], platforms: [] });
  const [bootstrapped, setBootstrapped] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    if (previewBeforeRegistration) return false;
    if (previewAfterRegistration) return true;
    if (demoMode || localDeveloperMode) return true;
    const forced = onboardingQuery.has("onboarding");
    return (
      !forced && localStorage.getItem("modovik-onboarding-complete") === "1"
    );
  });
  const [games, setGames] = useState([]);
  const [selectedGameId, setSelectedGameId] = useState(
    () =>
      (demoMode && demoContext.game?.id) ||
      localStorage.getItem("modovik-game-target") ||
      "",
  );
  /* Что стоит и чьи это части сборок — id движка; окну — id каталога (`engine-ids.js`, 19.10). */
  const [engineInstalled, setInstalled] = useState([]);
  const [engineBundleOf, setBundleOf] = useState({});
  const { installed, bundleOf } = useCatalogInstalled(engineInstalled, data.mods, engineBundleOf);
  const [vanillaGuard, setVanillaGuard] = useState({
    active: false,
    phase: "inactive",
    moved: [],
  });
  const [vanillaBusy, setVanillaBusy] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("modovik-favorites") || "[]");
    } catch {
      return [];
    }
  });
  const [detailMod, setDetailMod] = useState(() => shellRestored("detailMod", null));
  const [detailReturnPage, setDetailReturnPage] = useState(() => shellRestored("detailReturnPage", "catalog"));
  const trail = useDetailTrail();
  const { reset: resetTrail } = trail;
  const [pendingDeepLink, setPendingDeepLink] = useState("");
  const [queue, setQueue] = useState([]);
  const [queueBatch, setQueueBatch] = useState({
    total: 0,
    completed: 0,
  });
  /* Очередь мастерской: строки, счётчик рельса и замок для каталога. */
  const workshopInstalls = useWorkshopInstalls();
  useShellHibernation({ page, settingsOpen, catalogGroup, detailMod, detailReturnPage, queue, bootstrapped, workshopWriting: workshopInstallsWriting() });
  const [notice, setNotice] = useState(null);
  const noticeTimerRef = useRef(null);
  /* Первый запуск без сохранённого языка — ru (умолчание normalizeLanguage);
     сохранённый выбор действует и на экране входа. */
  const [language, setLanguage] = useState(() =>
    normalizeLanguage(localStorage.getItem("modovik-language")),
  );
  useUiLanguageSync(language);
  /* Всплывашки оболочки — на языке окна (shell-notices.js). */
  const notices = shellNoticesFor(language);
  const {
    motionChoice,
    setMotionChoice,
    motionEnabled,
    scenePalette,
    appearanceState,
  } = useAppearancePreferences();
  /* Очередь карточек считается по разложенной странице (колонки знает раскладка, не React). Хук вешается на
     `.desktop-main`, живущий столько же, сколько окно, и расставляет очередь во всех помеченных сетках сразу. */
  const assemblyScopeRef = useAssemblyOrder();
  useDocumentHolds("desktop-app"); /* `body` и `#root` знают об окне меткой, а не `:has()` (`useHolds.js`). */
  const region = useMemo(
    () => localStorage.getItem("modovik-download-region") || "eu",
    [],
  );
  const [profiles, setProfiles] = useState(() => {
    /* Песочница с данными (`qa-fixtures=full`, Т-163): шесть сборок. */
    const fixtureProfiles = import.meta.env.DEV || import.meta.env.MODE === "perf"
      ? window.__astralQaFixtures?.profiles
      : null;
    if (previewAfterRegistration && fixtureProfiles?.length)
      return fixtureProfiles;
    if (previewAfterRegistration) {
      return [
        {
          id: "majestic",
          name: tr("RP — чистый город"),
          code: "ASTR-7K9M-L2QX",
          modIds: ["dragon-minimap", "dragon-revolver"],
        },
        {
          id: "night",
          name: tr("Ночная графика"),
          code: "ASTR-NIGHT-46PK",
          modIds: ["dragon-minimap"],
        },
        {
          id: "stable",
          name: tr("Стабильный FPS"),
          code: "ASTR-STABLE-88QF",
          modIds: ["dragon-carbine-rifle"],
        },
      ];
    }
    return readStoredLocalProfiles();
  });
  const [profilesMode, setProfilesMode] = useState(() =>
    previewAfterRegistration || demoMode ? "preview" : "local",
  );
  /* Аккаунт, облачная библиотека и переподключение — features/onboarding/useCloudSession.js. */
  const localOnly =
    demoMode || previewState || localDeveloperMode || localFirstRunQaMode;
  const cloud = useCloudSession({
    initialAccount:
      previewAccount ||
      (localDeveloperMode
        ? localDeveloperAccount
        : demoMode
          ? demoContext.account
          : null),
    localOnly,
    loadSession: getAuthSession,
    loadLibrary: () => [getCloudFavorites(), listCloudBuilds()],
    loadCatalog: getCloudCatalog,
    onLibrary: ({ favorites: cloudFavorites, builds }) => {
      if (cloudFavorites) setFavorites(cloudFavorites);
      /* Облачная запись знает только моды: работы возвращаются из своего
         хранилища, иначе они терялись при каждой синхронизации. */
      if (builds) setProfiles(withStoredWorks(builds));
      if (builds) setProfilesMode("cloud");
    },
    onCatalog: setData,
    /* Демо кладёт в каталог свои моды один раз, на старте. */
    subscribeCatalog: demoMode ? null : onCloudCatalog,
  });
  const { account, activateCloudAccount, acceptCatalog, awaitCatalog } = cloud;
  const gameGate = useGameGate({ bootstrapped, onboardingComplete, signedIn: Boolean(account), exempt: localOnly, gameTargetId: selectedGameId });
  useDesktopTelemetry({
    active: bootstrapped && Boolean(account) && !localOnly,
    page,
  });
  const bootstrapContextRef = useRef({
    previewState,
    previewAccount,
    previewBeforeRegistration,
    demoMode,
    localDeveloperMode,
    localDeveloperAccount,
    localFirstRunQaMode,
    localFirstRunQaAccount,
    demoAccount: demoContext.account,
    demoGame: demoContext.game,
    demoMods: demoContext.mods,
    freshOnboarding,
    selectedGameId,
  });
  useEffect(() => {
    const bootstrap = bootstrapContextRef.current;
    /* Сессия — с повторами, остальное её не валит (`startup.js`). */
    const sessionRequest = () =>
      bootstrap.previewState
        ? Promise.resolve({ user: bootstrap.previewAccount })
        : bootstrap.localDeveloperMode
          ? Promise.resolve({ user: bootstrap.localDeveloperAccount })
          : bootstrap.localFirstRunQaMode
            ? Promise.resolve({ user: null })
            : bootstrap.demoMode
              ? Promise.resolve({ user: bootstrap.demoAccount })
              : bootstrap.freshOnboarding
                ? logoutAccount()
                    .catch(() => null)
                    .then(() => ({ user: null }))
                : getAuthSession();
    /* Первые страницы каталога пришли событием — окно открывается с ними,
       не дожидаясь остальных (Т-27). */
    let stopWaiting = () => {};
    const catalogShown = new Promise((resolve) => {
      stopWaiting = onCloudCatalog(resolve);
    });
    loadStartup(
      {
        catalog: () => getCloudCatalog(),
        installations: () =>
          bootstrap.demoMode
            ? Promise.resolve(bootstrap.demoGame ? [bootstrap.demoGame] : [])
            : bootstrap.previewBeforeRegistration
              ? Promise.resolve([])
              : detectInstallations(),
        profile: () =>
          bootstrap.demoMode || bootstrap.previewBeforeRegistration
            ? Promise.resolve({ installed: [] })
            : getLocalInstallProfile(),
        session: sessionRequest,
      },
      { catalogShown, onStage: startupFlow.stage },
    )
      .then(async (start) => {
        const { catalog, catalogLater, found, profile, session } = start;
        start.failures.forEach((error) => console.error(error));
        const resolvedCatalog = bootstrap.demoMode
          ? {
              ...catalog,
              mods: [...(bootstrap.demoMods || []), ...(catalog.mods || [])],
            }
          : catalog;
        const selected = resolveGameTarget(found, bootstrap.selectedGameId);
        /* Не успевший каталог — пустышка, и её не кладут: первые страницы
           могли уже прийти событием (Т-27). */
        if (bootstrap.demoMode) setData(resolvedCatalog);
        else if (catalogLater) awaitCatalog(catalogLater);
        else acceptCatalog(catalog);
        setGames(found);
        setSelectedGameId(
          selected?.id || (start.foundKnown ? "" : bootstrap.selectedGameId),
        );
        const user = sessionAccount(session);
        await activateCloudAccount(user, session);
        if (user) {
          localStorage.setItem("modovik-onboarding-complete", "1");
          setOnboardingComplete(true);
        }
        rememberInstallRecords(profile.installed || []);
        setInstalled([
          ...new Set(
            (profile.installed || [])
              .filter((item) => !selected || item.targetId === selected.id)
              .map((item) => item.modId),
          ),
        ]);
      })
      .catch(console.error)
      .finally(() => {
        stopWaiting();
        setBootstrapped(true);
        startupFlow.ready();
      });
  }, [acceptCatalog, activateCloudAccount, awaitCatalog]);
  useEffect(() => {
    if (selectedGameId)
      localStorage.setItem("modovik-game-target", selectedGameId);
    else localStorage.removeItem("modovik-game-target");
  }, [selectedGameId]);
  useEffect(() => {
    if (profilesMode !== "cloud") {
      localStorage.setItem("modovik-favorites", JSON.stringify(favorites));
    }
  }, [favorites, profilesMode]);
  /* Раздел под рейкой — отложенное значение (30.10.2026, «переключался между вкладками — не 30 кадров, а 144»). Рейка, заголовки и всё остальное меняются сразу, а
     тело нового раздела React собирает кусками по 5 мс в фоне: пока оно не готово, на месте остаётся прежний раздел и окно не замирает. Раньше смена раздела была одним
     синхронным кадром — каталог на 3000 модах стоил 3–4 с замершего окна при ×4. */
  const contentPage = useDeferredSection(page);
  useSectionScrollReset(contentPage);
  const kept = useKeptPages(contentPage), splashGone = useSyncExternalStore(startupFlow.subscribe, startupFlow.isGone, startupFlow.isGone); // заставка на экране: под ней куски разделов не подтягиваются и мастерская не собирается скрытой
  usePrefetchCatalogPages();
  useEffect(
    () => window.modovik?.onDeepLink?.((value) => setPendingDeepLink(value)),
    [],
  );
  useEffect(() => {
    const modId = modIdFromDeepLink(pendingDeepLink);
    if (!modId) return;
    const target = [...publicCatalogPreviewMods, ...data.mods].find(
      (item) => item.id === modId,
    );
    if (!target) return;
    resetTrail();
    setDetailMod(target);
    setDetailReturnPage("catalog");
    setPage("detail");
    setPendingDeepLink("");
    document.querySelector(".desktop-main")?.scrollTo({ top: 0, left: 0 });
  }, [data.mods, pendingDeepLink, resetTrail]);
  /* Песочница с данными (`qa-fixtures=full`, Т-163): очередь «Загрузок». */
  useQaQueueSeed({ mods: data.mods, setQueue, language, notify: (...args) => showNotice(...args) });
  usePrefetchNext(queue); // «Ускоренная загрузка»: следующий мод качается, пока ставится текущий
  /* «Карта из мода»: геометрию большой карты части даёт каталог окна; кэши каталога греются в простое после тишины ответа (`warm-schedule.js`). */
  useEffect(() => void connectPartMapSource(data.mods), [data.mods]);
  useEffect(() => scheduleCatalogWarm(data.mods), [data.mods]);
  useEffect(() => {
    if (profilesMode === "local") {
      /* Работы живут отдельно, а переполненное хранилище не роняет окно. */
      migrateBuildWorks(profiles);
      persistProfiles("modovik-builds", profiles);
    }
  }, [profiles, profilesMode]);
  useEffect(() => {
    if (bootstrapped && !account && profilesMode === "cloud") {
      setProfiles(readStoredLocalProfiles());
      setProfilesMode("local");
    }
  }, [account, bootstrapped, profilesMode]);
  /* Проценты — мимо оболочки (features/downloads/live-progress.js): сюда
     приходит только смена строки, а не каждый шаг загрузки (задача 1). */
  /* Размер пакета строки — для ровного хода числа (память запусков по размеру, `progress-pace.js`). */
  const queueSnapshot = useRef(queue);
  queueSnapshot.current = queue;
  useInstallProgressBridge(setQueue, (queueId) =>
    queueRowBytes(queueSnapshot.current.find((row) => row.queueId === queueId)),
  );
  useEffect(
    () =>
      onVanillaStatus((status) => {
        setVanillaGuard(status);
        if (status.error) showNotice(status.error);
        else if (status.reason === "game-exited")
          showNotice(shellNoticesFor(language).gameClosedRestored);
      }),
    [language],
  );
  useSimulatedProgress({ queue, setQueue, demoMode });
  /* Партии каталога и мастерской — одна на рельсе: кончается, когда
     опустели обе очереди, иначе счётчик шёл бы назад. */
  const queuePending = pending(queue);
  useEffect(() => {
    setWorkshopBatchPartner(queuePending > 0);
    if (!queuePending) {
      if (!workshopInstallsWriting()) setQueueBatch({ total: 0, completed: 0 });
      return;
    }
    setQueueBatch((current) => {
      const total = Math.max(current.total, current.completed + queuePending);
      return total === current.total ? current : { ...current, total };
    });
  }, [queuePending, workshopInstalls]);
  const showNotice = (text, tone = "info") => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice({ text, tone, id: Date.now() });
    /* Отказ читают дольше: в нём ещё и что делать. Длинную строку —
       тоже («Astral навёл порядок сам: …»). */
    const readFor = tone === "error" || String(text || "").length > 120 ? 7000 : 3200;
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), readFor);
  };
  useStartupRecovery({
    active: bootstrapped && Boolean(account),
    notify: showNotice,
    language,
  });
  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);
  const refreshGames = useCallback(
    async (preferredId = selectedGameId) => {
      if (demoMode || previewBeforeRegistration) {
        const demoGames = demoContext.game ? [demoContext.game] : [];
        setGames(demoGames);
        setSelectedGameId(demoContext.game?.id || "");
        return demoGames;
      }
      const found = await detectInstallations();
      setGames(found);
      setSelectedGameId(resolveGameTarget(found, preferredId)?.id || "");
      return found;
    },
    [demoContext.game, demoMode, previewBeforeRegistration, selectedGameId],
  );
  useEffect(() => {
    if (
      !bootstrapped ||
      demoMode ||
      previewBeforeRegistration ||
      games.length
    ) {
      return undefined;
    }
    const detectOnResume = () => {
      refreshGames().catch((error) => {
        console.warn("Automatic GTA V detection failed", error);
      });
    };
    const retry = window.setTimeout(detectOnResume, 900);
    window.addEventListener("focus", detectOnResume);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("focus", detectOnResume);
    };
  }, [
    bootstrapped,
    demoMode,
    games.length,
    previewBeforeRegistration,
    refreshGames,
  ]);
  /* Пока очередь пишет в игру, установку GTA V не меняют. */
  const queueBlocksGameChange = () => {
    if (!queuePending) return false;
    showNotice(notices.finishBeforeGameChange);
    return true;
  };
  async function chooseGameTarget() {
    if (demoMode) {
      showNotice(notices.demoVirtualGame);
      return demoContext.game || null;
    }
    if (queueBlocksGameChange()) return null;
    const selected = await chooseGameInstallation();
    if (selected) {
      setSelectedGameId(selected.id);
      /* Папка, выбранная руками, — то же подтверждение: спрашивать о ней
         при следующем входе не о чем. */
      rememberConfirmedGame(selected);
      await refreshGames(selected.id);
    }
    return selected;
  }
  function selectGameTarget(id) {
    if (queueBlocksGameChange()) return;
    /* Разделы помнят, чем человек в них занимался, — но занимался он этим с
       прежней установкой. Смена игры — новый заход, и память уходит с целью. */
    if (id !== selectedGameId) forgetSection();
    setSelectedGameId(id);
  }
  const game =
    games.find((item) => item.id === selectedGameId) || games[0] || null;
  /* Что Astral исправил сам (задача 1 ТЗ 10.10.2026) и снятое проверкой файлов игры с «Установить снова» (задача 2). */
  const announceReconcile = useReconcileNotices({ language, notify: showNotice });
  const syncProfileRef = useRef(null);
  const checkRemoval = useCheckRemoved({ gameId: game?.id, language, notify: showNotice, refreshProfile: () => syncProfileRef.current?.() });
  const onCheckProfile = checkRemoval.onProfile;
  const restoreMods = useRestorableMods(checkRemoval); /* пропали после проверки файлов: строка в «Настройки → GTA V» и точка на шестерёнке */
  const syncInstalledProfile = useCallback(
    async (targetId = game?.id) => {
      const profile = await getLocalInstallProfile();
      const nextInstalled = [
        ...new Set(
          (profile.installed || [])
            .filter((item) => !targetId || item.targetId === targetId)
            .map((item) => item.modId),
        ),
      ];
      rememberInstallRecords(profile.installed || []);
      setInstalled(nextInstalled);
      /* Чья часть — из записи установки движка (Т-97), не из профиля окна. */
      setBundleOf(bundleOriginsOf(profile.installed || [], targetId));
      if (targetId) {
        announceReconcile(profile.reconcile?.[targetId], targetId);
        onCheckProfile(profile, targetId).catch(() => {});
      }
      return nextInstalled;
    },
    [game?.id, announceReconcile, onCheckProfile],
  );
  syncProfileRef.current = syncInstalledProfile;
  const { preparation, prepareGame } = usePreparationFlow({
    account,
    bootstrapped,
    demoMode,
    game,
    language,
    localFirstRunQaMode,
    onboardingComplete,
    setGames,
    /* Вторая папка игры из Rockstar Games Launcher (задача 2). */
    onSwitchGame: setSelectedGameId,
    onSharedFarPlates: (works) =>
      showNotice(
        shellNoticesFor(language).sharedFarPlates(
          works.map((work) => tr(FAR_PLATE_WORK_NAMES[work.set] || work.set)).join(", "),
        ),
      ),
    /* Арена до 20.11.2026 роняет Majestic: сторож снимает её сам (не вышло — прежнее сообщение и строка с кнопками в мастерской). */
    onRebuiltShells: (works) =>
      guardRebuiltArenas(works, { nameOf: (work) => tr(FAR_PLATE_WORK_NAMES[work.set] || work.set), notices: shellNoticesFor(language), showNotice }),
    onHeavyShells: (works) =>
      showNotice(
        shellNoticesFor(language).heavyArenaShells(
          works.map((work) => tr(FAR_PLATE_WORK_NAMES[work.set] || work.set)).join(", "),
        ),
      ),
  });
  /* По номеру игры, а не по объекту: список игр при запуске пересобирается
     трижды, и каждый раз профиль и проверка шли заново (задача 6 ТЗ 10.10.2026). */
  const gameId = game?.id || "";
  useEffect(() => {
    if (demoMode) {
      setInstalled([]);
      return;
    }
    syncInstalledProfile().catch(() => {});
  }, [demoMode, gameId, syncInstalledProfile]);
  useEffect(() => {
    if (demoMode || !gameId) {
      setVanillaGuard({ active: false, phase: "inactive", moved: [] });
      return;
    }
    getVanillaStatus({ targetId: gameId })
      .then(setVanillaGuard)
      .catch(() =>
        setVanillaGuard({ active: false, phase: "inactive", moved: [] }),
      );
  }, [gameId, demoMode]);
  async function startGameSession() {
    if (demoMode) {
      showNotice(notices.demoNoLaunch);
      return;
    }
    if (!game || vanillaBusy) {
      if (!game) {
        showNotice(notices.chooseInstalledGame);
        navigate("settings");
      }
      return;
    }
    if (vanillaGuard.active) {
      showNotice(notices.restoreBeforeLaunch);
      return;
    }
    setVanillaBusy(true);
    try {
      await launchGame({ targetId: game.id });
      showNotice(notices.launching);
    } catch (error) {
      showNotice(humanFailure(error, language), "error");
    } finally {
      setVanillaBusy(false);
    }
  }
  useEffect(() => {
    /* Неудачная строка ждёт «Повторить» и очередь не держит. */
    const current = queue.find((item) => !item.failed);
    if (demoMode) {
      if (!current || current.progress < 100) return;
      const timer = setTimeout(() => {
        if (current.operation === "install") {
          setInstalled((previous) => [
            ...previous.filter((id) => !current.replaceIds?.includes(id)),
            ...(previous.includes(current.id) ? [] : [current.id]),
          ]);
          completeHomeProgress(current.progressSource);
        } else if (current.operation === "remove") {
          setInstalled((previous) =>
            previous.filter((id) => id !== current.id),
          );
        } else if (current.operation === "reset") {
          setInstalled([]);
        }
        setQueueBatch((batch) => {
          const total = Math.max(batch.total, batch.completed + pending(queue));
          return {
            total,
            completed: Math.min(total, batch.completed + 1),
          };
        });
        setQueue((previous) =>
          previous.filter((item) => item.queueId !== current.queueId),
        );
        showNotice(shellNoticesFor(language).demoOperationDone);
      }, 180);
      return () => clearTimeout(timer);
    }
    if (!current || current.started) return;
    /* Мастерская пишет в тот же update.rpf: ждём, пока её очередь опустеет
       (эффект перезапустится по её снимку), и держим её на время своей
       установки. Почему — в install-queue/queue.js. */
    if (workshopInstallsWriting()) return;
    holdWorkshopInstalls("catalog", current.name || "");
    setQueue((previous) =>
      previous.map((item) =>
        item.queueId === current.queueId
          ? {
              ...item,
              started: true,
              startedAt: item.startedAt || Date.now(),
              phaseStartedAt: Date.now(),
              cancellable: true,
              phase: item.operation === "install" ? "download" : "commit",
            }
          : item,
      ),
    );
    (async () => {
      let completedSuccessfully = false;
      let failure = null;
      let installWords = null;
      let guard = null, installed = null; /* итог сторожа моделей-пустышек (`modelGuard`): строка — `features/catalog/model-guard-note.js` по `import()`, только если что-то снято */
      let failKit = null; /* исход отказа части сборки (`bundle-failure.js`, разбор 17.11.2026): модуль берётся по `import()` при первом отказе */
      /* Тихая попытка поставить новую версию ждущего компонента (`useWaitingUpdates`): отказ «в каталоге пока прежняя версия» — без уведомления и строки «Не удалось». */
      let quietRefusal = false;
      try {
        if (current.operation === "install" && (current.clothingChoice || current.tattooSetChoice)) {
          installWords = await applyCatalogChoice(current, game);
          await syncInstalledProfile(game?.id);
          completeHomeProgress(current.progressSource);
        } else if (current.operation === "install") {
          /* Пачка пакетов — одна транзакция движка: несколько пакетов и снятие других модов, отказ ничего не меняет. */
          guard = (installed = await (current.batch ? (await import("../../features/catalog/bundles/batch-install.js")).runInstallBatch(current, game) : installRemotePayload({
            operationId: current.queueId,
            manifest: current.manifest,
            baseUrl: current.packageBaseUrl,
            retainDownloads:
              localStorage.getItem("astral-cache-packages") !== "0" &&
              localStorage.getItem("modovik-cache-packages") !== "0",
            gameRoot: game.path,
            targetId: game.id,
            edition: game.edition,
            replaceModIds: current.replaceIds || [],
            allowGameRootWrites: current.manifest?.scope === "game-root",
            origin: installOrigin(current),
            ...(current.modelScale ? { modelScale: current.modelScale } : {}),
          })))?.modelGuard;
          await syncInstalledProfile(game?.id);
          completeHomeProgress(current.progressSource);
        } else if (current.operation === "remove") {
          await uninstallLocalPackage({
            operationId: current.queueId,
            modId: current.id,
            targetId: game?.id,
          });
          await syncInstalledProfile(game?.id);
        } else if (current.operation === "reset") {
          await resetLocalTarget({
            operationId: current.queueId,
            targetId: game?.id,
          });
          /* Игра вернулась к основе — записи о работах мастерской тоже. */
          forgetWorkshopInstallsAfterReset();
          setQueue((previous) =>
            previous.map((item) =>
              item.queueId === current.queueId
                ? {
                    ...item,
                    phase: "components",
                    progress: 99,
                    cancellable: false,
                    phaseStartedAt: Date.now(),
                  }
                : item,
            ),
          );
          const resetWindowDone = resetWindowClock(); // сброс 12.10: шаги окна после сброса — в журнал
          await prepareGame(game, { force: true });
          await syncInstalledProfile(game?.id).then(resetWindowDone);
        }
        completedSuccessfully = true; recordDownloadDone(current); // «Готово сегодня» в «Загрузках»: строка очереди уходит, след остаётся
        showNotice([installWords?.text || (current.waitingAuto ? waitingCopyFor(language).notice(current.name || current.id) : successNotice(withEngineReplaced(current, installed), language)), installed?.scaleSkipped && (await import("../../features/catalog/model-scale-note.js").then((m) => m.modelScaleNote(installed.scaleSkipped, current.id)).catch(() => "")), guard && (await import("../../features/catalog/model-guard-note.js").then((m) => m.modelGuardNote(guard)).catch(() => "")), installed?.hostStanding && (await import("../../features/catalog/host-standing-note.js").then((m) => m.hostStandingNote(installed)).catch(() => ""))].filter(Boolean).reduce(joinSentences, ""), installWords?.tone);
      } catch (error) {
        await syncInstalledProfile(game?.id).catch(() => {});
        /* Разбор отказа и слово человеку — `bundle-failure.js` (по `import()`, в стартовом куске его нет): часть сборки не встала — сборка останавливается (Т-81d), но вопрос о чужих файлах и «оставил своё» её не останавливают. */
        failKit = await import("../../features/catalog/bundles/bundle-failure.js");
        const settled = await failKit.settleInstallFailure({ error, current, language, notify: showNotice, cancelled: shellNoticesFor(language).cancelled });
        ({ failure, quiet: quietRefusal } = settled);
      } finally {
        releaseWorkshopInstalls("catalog");
        setQueueBatch((batch) => {
          const total = Math.max(batch.total, batch.completed + pending(queue));
          if (completedSuccessfully) {
            return {
              total,
              completed: Math.min(total, batch.completed + 1),
            };
          }
          return {
            total: Math.max(batch.completed, total - 1),
            completed: batch.completed,
          };
        });
        /* Отказ остаётся строкой «Не удалось» с причиной и «Повторить». */
        setQueue((previous) =>
          failure && !quietRefusal
            ? failKit.afterFailure(previous, current, failure)
            : (failKit ? failKit.withoutDependents(previous, current) : previous).filter((item) => item.queueId !== current.queueId),
        );
      }
    })();
  }, [
    queue,
    game,
    demoMode,
    language,
    prepareGame,
    syncInstalledProfile,
    workshopInstalls,
  ]);
  /* Пока идёт сеанс Vanilla Guard, профиль модов не трогают. */
  const vanillaGuardBlocks = () => {
    if (!vanillaGuard.active) return false;
    showNotice(notices.finishVanillaGuard);
    return true;
  };
  /* Профиль ушёл со страницы — стрелка больше не нужна; назад из него: страница, что была под настройками, и окно настроек на том же пункте (раздел помнится). */
  useEffect(() => { if (page !== "profile") setProfileOrigin(null); }, [page]);
  function backToSettings() {
    const at = profileOrigin?.page || "overview";
    setProfileOrigin(null);
    navigate(at);
    setSettingsOpen(true);
  }
  function openDownloads() {
    window.clearTimeout(downloadsCloseTimerRef.current);
    setDownloadsClosing(false);
    setSettingsOpen(false); // окно настроек выше страницы загрузок (z 240 против 74): открытое, оно прячет её под собой, и нажатие «ничего не делает»
    setDownloadsOpen(true);
  }
  /* «Применить» и «Установить» не раскрывают «В процессе»: работа летит в
     угол, как в браузере (features/downloads/work-flight.js). Панель
     открывает только человек: рейкой или нажатием на «Идёт установка…». */
  useWorkInstallFlight(
    workshopInstalls.jobs,
    downloadsOpen && !downloadsClosing,
  );
  useDownloadsRequests(openDownloads);
  /* Вопрос «оставить своё или заменить» (сборка или одиночная установка): «Загрузки» открываются сами, один раз на вопрос, не под набор в поле (`features/downloads/foreign-auto-open.js`, 17.11.2026). */
  useForeignQuestionOpen({ queue, visible: downloadsOpen && !downloadsClosing, open: openDownloads });
  /* Падения игры (ТЗ 11.11.2026): одно ненавязчивое уведомление после падения и переход в Библиотеку из «Логов». */
  useGameCrashWatch({ language, notify: showNotice });
  function closeDownloads() {
    if (!downloadsOpen || downloadsClosing) return;
    window.clearTimeout(downloadsCloseTimerRef.current);
    setDownloadsClosing(true);
    downloadsCloseTimerRef.current = window.setTimeout(
      () => {
        setDownloadsOpen(false);
        setDownloadsClosing(false);
      },
      motionIsEnabled() ? DOWNLOADS_CLOSE_MS : DOWNLOADS_CLOSE_STILL_MS,
    );
  }
  /* Нажатие на раздел, в котором уже стоишь, возвращает в его начало, как в iOS:
     память раздела забывается, но нажатия подряд страницу не пересобирают. */
  const [sectionResets, setSectionResets] = useState(0);

  /* Роль сменилась в живой сессии (вышел админ, вошёл обычный) — со страницы публикации уходим (Т-151). */
  useEffect(() => {
    if (page === "publisher" && account?.role !== "admin") setPage("overview");
  }, [page, account?.role]);

  function navigate(destination, group = null) {
    if (destination === "downloads" || destination === "library") {
      /* Пока окно уходит, оно всё ещё «открыто», и повторное нажатие на ту же
         иконку раньше проваливалось в `closeDownloads` — тот выходил ни с чем,
         и щелчок пропадал. Уходящее окно нажатие возвращает. Страница под
         окном настроек глазу не видна, и закрывать её нечего: нажатие
         показывает её (`openDownloads` закрывает настройки). «library» — старое
         имя: библиотека справа на «Загрузках», туда и ведёт (открытые остаются
         открытыми). */
      if (destination === "library" && downloadsOpen && !downloadsClosing && !settingsOpen) return;
      if (downloadsOpen && !downloadsClosing && !settingsOpen) closeDownloads();
      else openDownloads();
      return;
    }
    /* Псевдонимы назначений («account», «home», «cart») — `features/navigation/destination-alias.js`. */
    if (followAlias(destination, navigate)) return;
    if (destination === "settings") {
      closeDownloads();
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen(false);
    /* Публикация в каталог — только администрации (Т-151): обычному
       пользователю в неё не попасть ни с рельсы, ни из чужой кнопки. */
    if (destination === "publisher" && account?.role !== "admin") return;
    const reset = enterSection(destination, page, downloadsOpen, group);
    /* Главная под нажатием на свою же вкладку не пересобирается: возвращать в ней нечего, кроме прокрутки (она ниже), а пересборка стоила 217–733 мс при ×4. */
    const rebuild = reset && !(destination === "overview" && !group);
    if (reset) forgetSection(destination);
    if (rebuild) setSectionResets((value) => value + 1);
    if (rebuild || group) kept.restart(destination);
    closeDownloads();
    setPage(destination);
    setCatalogGroup(group);
    document.querySelector(".desktop-main")?.scrollTo({ top: 0, left: 0 });
  }
  /* Боковые кнопки мыши: те же страницы, что и рельса, без пересборки раздела. */
  function goToPlace(place) {
    enterSection(place.page, page, downloadsOpen, place.group);
    if (place.page === "detail") {
      trail.follow(page === "detail" ? detailMod : null, place.detailMod);
      setDetailMod(place.detailMod);
      setDetailReturnPage(place.detailReturnPage);
    } else resetTrail();
    setPage(place.page);
    setCatalogGroup(place.group);
    document.querySelector(".desktop-main")?.scrollTo({ top: 0, left: 0 });
  }
  useMouseNavigation({
    place: { page, group: catalogGroup, detailMod, detailReturnPage },
    closeOverlay: () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (downloadsOpen && !downloadsClosing) {
        closeDownloads();
        return true;
      }
      return false;
    },
    go: goToPlace,
  });
  function completeHomeProgress(progressSource) {
    if (!["catalog", "customization"].includes(progressSource)) return;
    localStorage.setItem(`modovik-home-progress-${progressSource}`, "1");
  }
  function installProgressSource() {
    if (page === "workshop" || (page === "detail" && detailReturnPage === "workshop")) {
      return "customization";
    }
    if (
      page === "catalog" ||
      (page === "detail" && detailReturnPage === "catalog")
    ) {
      return "catalog";
    }
    return null;
  }
  function enqueueInstall(
    mod,
    replaceIds = [],
    installPlan = null,
    progressSource = installProgressSource(),
  ) {
    if (
      queue.some(
        (item) =>
          !item.failed && item.id === mod.id && item.operation === "install",
      )
    ) {
      showNotice(notices.alreadyQueued(mod.name));
      return;
    }
    /* Что уйдёт из этого места — названиями, для строки в «Загрузках»: вопроса нет, «новый мод старше» (18.11.2026). */
    const replacedNames = replacedNamesOf(replaceIds, data.mods);
    const underWorks = underWorkNames(installPlan);
    /* Часть сборки без своей обложки идёт в «Загрузках» с обложкой сборки: картинка одна на строку, не на тик хода (`ribbon/row-photo.js`). */
    const coverFallback = !modPicture(mod) && mod.bundleId ? modPicture(data.mods.find((item) => item.id === mod.bundleId)) : "";
    /* Новая попытка вытесняет строку «Не удалось» того же мода: отказ
       говорился на кнопке, и повтор с любой кнопки — та же установка. */
    setQueue((previous) => [
      ...previous.filter((item) => !(item.failed && item.id === mod.id)),
      {
        ...mod,
        packageBaseUrl: demoMode
          ? "demo://astral-local"
          : packageUrlForRegion(mod, region),
        replaceIds,
        queueId: `install-${mod.id}-${Date.now()}`,
        queuedAt: Date.now(),
        operation: "install",
        progress: 0,
        installPlan,
        progressSource,
        replacedNames,
        underWorks,
        ...(coverFallback ? { coverFallback } : {}),
      },
    ]);
    const soundUnder = (installPlan?.soundUnder || []).map(
      (item) => item.title,
    );
    showNotice(
      soundUnder.length
        ? notices.soundUnder(mod.name, soundUnder.join(", "))
        : installPlan?.conflicts?.some((item) => item.stack)
          ? notices.layeredOver(mod.name)
          : replaceIds.length
            ? replacedNames.length
              ? replacedNotice(mod.name, replacedNames)
              : notices.safeReplacement(mod.name)
            : notices.queued(mod.name),
    );
  }
  /* Второй щелчок «Установить», пока первый ждёт грант и план, — не вторая установка. */
  const installOnce = useSingleFlight(install, (mod) => mod.id, (mod) => void import("../../features/catalog/install-prepare-wait.js").then((part) => part.repeatedClick(mod, showNotice, notices.alreadyQueued(mod.name))).catch(() => {}));
  /* Компоненты, ждущие после обновления игры новой версии, ставятся сами, когда она появилась в каталоге (А10, шаг 3). */
  useWaitingUpdates({
    removed: checkRemoval.removed,
    mods: data.mods,
    install: installOnce,
    ready: Boolean(account && game && !demoMode && preparation.status === "ready"),
  });
  useDeferredResume({ account, game, preparation, prepareGame, mods: data.mods, queue, install: installOnce, notify: showNotice }); /* отложенные из-за открытой GTA V установки доходят сами (`deferred-resume.js`) */
  /* `options.waitingAuto` — тихая попытка `useWaitingUpdates`: строка очереди помечается, итог говорит очередь (успех — уведомлением, отказ «прежняя версия» — молча). */
  async function install(shown, options = {}) {
    const mod = cloud.freshMod(shown); /* пакет — из отложенного каталога, если там мод новее (`catalog-freeze.js`); подпись функции не менять: на неё смотрят сторожа одежды */
    if (!account) {
      setOnboardingComplete(false);
      showNotice(notices.signInToInstall);
      return;
    }
    /* Работа мастерской ставится мастерской игрока (catalog-work.js). */
    if (catalogWork.isCatalogWork(mod)) return catalogWork[options.openInWorkshop ? "openFromShell" : "installFromShell"](mod, { navigate, showNotice, language });
    if (looksLikeClothing(mod) && (await import("../../features/clothing/install-guard.js").then((guard) => guard.openCardWithoutChoice(mod, options, { notify: showNotice, openMod, word: notices.chooseClothingTarget }), () => { showNotice(notices.chooseClothingUnavailable, "error"); return true; }))) return; /* вещь без выбора не ставится: `install-guard.js`; кусок не загрузился — слово и не ставим */
    if ((preparation.status !== "ready" || !game) && !(preparation.status === "running" && (await import("../../features/catalog/install-prepare-wait.js").then((part) => part.joinPreparing({ notify: showNotice, restart: () => installOnce(shown, options) }, mod), () => false)))) {
      if (await import("../../features/downloads/deferred-installs.js").then((part) => part.holdUntilGameCloses({ preparation, game, mod, options, notify: showNotice }), () => false)) return; /* GTA V открыта — нажатие не пропадает: мод ждёт в «Загрузках» и встанет сам */
      const stop = preparationStop(preparation.status, game, notices, preparation.message, language);
      showNotice(stop.text, stop.tone);
      if (stop.pick) void chooseGameTarget();
      if (stop.retry) void prepareGame(game, { force: true });
      return;
    }
    if (vanillaGuardBlocks()) return;
    if (isCatalogBundle(mod) && game && !demoMode) return installBundle(mod);
    /* «Эффекты» и «Трейсеры» редукса — набором пакетов, одной пачкой (`effects-install-run.js`). `single` — вызов за один пакет: части окна «Компоненты», «Повторить» одиночной строки. */
    if (!options?.single && !options?.waitingAuto) {
      const set = await (await import("../../features/catalog/effects-install-run.js")).installEffectsSet(mod, bundleShell(), options);
      if (set.handled) return;
      if (set.only) return install(set.only, { ...options, single: true });
    }
    if (installed.includes(mod.id)) {
      showNotice(notices.alreadyInstalled(mod.name));
      return;
    }
    if (demoMode) {
      enqueueInstall(mod, [], {
        summary: { fileCount: 0, writeBytes: 0 },
        conflicts: [],
        demo: true,
      });
      return;
    }
    let installable = mod;
    if (!installable.manifest || !packageUrlForRegion(installable, region)) {
      if (
        installable.packageStatus !== "preview" ||
        !cloudCatalogIDPattern.test(installable.id || "")
      ) {
        /* Причину знает каталог: пакета нет вовсе или он не подписан ключом каталога (apps/api/src/trusted-catalog.js). */
        showNotice(
          installable.packageStatus === "unsigned"
            ? notices.unsignedPackage
            : notices.noFiles,
          "error",
        );
        return;
      }
      try {
        const grant = await getCloudDownloadGrant(mod.id);
        recordDesktopCatalogDownload(mod.id);
        installable = {
          ...mod,
          manifest: grant.manifest,
          packageBaseUrl: grant.packageBaseUrl,
          packageStatus: "ready",
          sizeBytes: grant.bytes,
          artifactSha256: grant.sha256,
          signingKeyId: grant.signingKeyId,
        };
      } catch (error) {
        showNotice(
          humanFailure(error, language) || notices.noVerifiedPackage,
          "error",
        );
        return;
      }
    }
    /* Замененка ставится не своим манифестом, а пакетом под выбранную вещь сервера:
       его план и замену прежней на этой вещи делает Desktop при записи (`applyClothingReplacement`). */
    if (installable.clothingChoice || installable.tattooSetChoice) {
      if (installable.clothingChoice) showNotice(notices.swapStarted);
      enqueueInstall(installable, [], {
        summary: {
          fileCount: installable.tattooSetChoice ? installable.tattooSetChoice.picks.length : (installable.clothingChoice.target?.textures || 1) + 1,
          writeBytes: installable.sizeBytes || 0,
        },
        conflicts: [],
        clothing: true,
      });
      return;
    }
    /* Первая установка после «Вернуть GTA V без модов»: игра была штатной до этого щелчка (Т-87),
       теперь её готовим — план оружейного и одёжного DLC без подготовки не сходится. */
    if (preparation.stockHold) await import("../../features/catalog/install-prepare-wait.js").then((part) => part.releaseHeldGame({ game, prepareGame, notify: showNotice }, installable), () => prepareGame(game, { force: true, releaseStockHold: true }));
    if (
      game.installReadiness !== "ready" &&
      installable.manifest.scope !== "game-root" &&
      installable.manifest.requiresLoader !== false
    ) {
      /* Загрузчики ставит подготовка: запускается сама, человеку делать нечего. */
      showNotice(notices.finishPreparation);
      void prepareGame(game, { force: true });
      return;
    }
    try {
      const plan = await planLocalPackage({
        manifest: installable.manifest,
        gameRoot: game.path,
        targetId: game.id,
        edition: game.edition,
        allowGameRootWrites: installable.manifest?.scope === "game-root",
      });
      /* Два мода меняют одно и то же — «новый мод старше» (18.11.2026): прежний уходит той же установкой без вопроса,
         а что именно заменено, говорит строка в «Загрузках» (`enqueueInstall`). */
      const conflicts = planConflicts(plan, installable, installed, data.mods);
      /* «Выборочные»: размер модели в руках (0,5–2) едет с установкой скина; штатный — без поля. */
      const sized = options?.modelScale && options.modelScale !== 1 ? { ...installable, modelScale: options.modelScale } : installable;
      /* `options.bundle` — «Повторить» у части сборки: она остаётся частью сборки (`origin.bundleId`), и «Снять сборку» её снимет (разбор 17.11.2026). */
      const queued = { ...(options?.waitingAuto === true ? { ...sized, waitingAuto: true } : sized), ...bundleFieldsOf(mod, options, { bundleOf, removed: checkRemoval.removed, mods: data.mods }) };
      if (conflicts.length) enqueueInstall(queued, conflicts.map((item) => item.id), plan, installProgressSource());
      else enqueueInstall(queued, [], plan);
    } catch (error) {
      showNotice(humanFailure(error, language), "error");
    }
  }
  function removeInstalled(ids) {
    if (vanillaGuardBlocks()) return;
    const items = data.mods.filter(
      (mod) => ids.includes(mod.id) && installed.includes(mod.id),
    );
    setQueue((previous) => [
      ...previous,
      ...items
        .filter(
          (mod) =>
            !previous.some(
              (item) => item.id === mod.id && item.operation === "remove",
            ),
        )
        .map((mod, index) => ({
          ...mod,
          queueId: `remove-${mod.id}-${Date.now()}-${index}`,
          queuedAt: Date.now(),
          operation: "remove",
          progress: 0,
        })),
    ]);
    showNotice(
      ids.length > 1 ? notices.removalManyQueued : notices.removalQueued,
    );
  }
  /* «Удалить» на карточке «Эффектов» снимает весь набор, на «Трейсерах» — одни привязки (`effects-install-set.js`); `single` — один пакет, как части окна «Компоненты». */
  async function removeMod(mod, options) {
    const set = await import("../../features/catalog/effects-install-set.js");
    const ids = options?.single ? [mod.id] : set.removeIdsOf(mod, data.mods, installed, bundleOf);
    removeInstalled(ids);
    set.removePackExtras(ids, bundleShell());
  }
  /* Лаунчер откатил update.rpf (Т-98): подготовка пересобирает слой Astral на вернувшемся файле, потом «Установить снова» возвращает снятые моды и работы. */
  async function restoreGame() {
    if (game) await prepareGame(game, { force: true });
    await syncInstalledProfile().catch(() => {});
    await checkRemoval.reinstall();
  }
  /* Порядок ждущих строк «Загрузок» (перетаскивание и стрелки): очередь запускает первую живую, так что порядок в массиве и есть порядок установки. */
  const reorderQueue = (orderedIds) => setQueue((previous) => applyQueueOrder(previous, orderedIds));
  async function cancelOperation(queueId) {
    const target = queue.find((item) => item.queueId === queueId);
    const live = queue.find((item) => !item.failed);
    if (target === live && live?.started && live.cancellable !== false) {
      setQueue((previous) =>
        previous.map((item) =>
          item.queueId === queueId ? { ...item, cancelling: true } : item,
        ),
      );
      await cancelLocalOperation(queueId);
      return;
    }
    /* Неудачная строка счётчик уже не держит — её просто убирают. */
    if (!target?.failed)
      setQueueBatch((batch) => {
        const total = Math.max(batch.total, batch.completed + pending(queue));
        return {
          total: Math.max(batch.completed, total - 1),
          completed: batch.completed,
        };
      });
    setQueue((previous) => previous.filter((item) => item.queueId !== queueId));
    if (!target?.failed) showNotice(notices.cancelled);
  }
  /* «Повторить» у неудачной строки — операция заново: свежий грант и план. */
  function retryOperation(queueId) {
    const item = queue.find((entry) => entry.queueId === queueId);
    if (!item?.failed) return;
    /* Часть сборки ждёт ответа «оставить своё или заменить»: ответ общий на сборку, ждущие части встают заново теми же строками (`bundle-failure.js`). */
    if (item.operation === "install" && item.bundleId && item.failed.kind === "foreign-build") return void import("../../features/catalog/bundles/bundle-failure.js").then((kit) => kit.retryHeld({ queue, item, setQueue, notify: showNotice, language }));
    setQueue((previous) => previous.filter((entry) => entry !== item));
    if (item.operation === "remove") removeInstalled([item.id]);
    else if (item.operation === "reset") resetMods();
    else installOnce(withSavedChoice(data.mods.find((mod) => mod.id === item.id) || item, item), item.batch ? undefined : { single: true, ...(item.bundleId ? { bundle: { id: item.bundleId, name: item.bundleName } } : {}) });
  }
  function resetMods() {
    if (vanillaGuardBlocks()) return;
    if (queue.some((item) => !item.failed && item.operation === "reset")) {
      showNotice(notices.resetAlreadyQueued);
      return;
    }
    setQueue((previous) => [
      ...previous.filter((item) => !(item.failed && item.operation === "reset")),
      {
        id: "reset-mods",
        queueId: `reset-${Date.now()}`,
        queuedAt: Date.now(),
        name: notices.reset.name,
        description: notices.reset.description,
        categoryLabel: notices.reset.category,
        platformLabel: notices.reset.platform,
        operation: "reset",
        progress: 0,
      },
    ]);
  }
  function openMod(mod) {
    trail.follow(page === "detail" ? detailMod : null, mod);
    setDetailMod(mod);
    /* Из библиотеки мод открывают так же, как из мастерской, — и «назад» обязан
       вернуть туда, откуда пришли, а не в каталог. Мод со страницы мода —
       шаг следа (`detail-trail.js`), а конец пути прежний. */
    if (page !== "detail")
      setDetailReturnPage(
        ["workshop", "library", "search", "profiles", "profile"].includes(page)
          ? page
          : "catalog",
      );
    navigate("detail");
  }
  async function favorite(mod) {
    const removing = favorites.includes(mod.id);
    try {
      if (profilesMode === "cloud" && cloudCatalogIDPattern.test(mod.id)) {
        await setCloudFavorite(mod.id, !removing);
      }
      setFavorites((previous) =>
        removing
          ? previous.filter((id) => id !== mod.id)
          : [...new Set([...previous, mod.id])],
      );
      showNotice(removing ? notices.favoriteRemoved : notices.favoriteAdded);
    } catch (error) {
      showNotice(humanFailure(error, language), "error");
    }
  }
  async function createProfile(draft) {
    if (profilesMode === "cloud") {
      return createCloudBuild({
        /* Край берёт имя до 120 знаков без пробелов по краям; имя из чужого кода — любое. */
        name: String(draft.name || "").trim().slice(0, 120).trim(),
        items: cloudItemsForProfile(draft),
      });
    }
    return {
      ...draft,
      id: draft.id || `local-profile-${Date.now()}`,
      code: draft.code || encodePortableBuild(draft),
    };
  }
  async function deleteProfile(profile) {
    if (profile?.cloud)
      await deleteCloudBuild({ id: profile.id, version: profile.version });
  }
  async function importProfile(_code, decoded) {
    if (!decoded) throw new Error(notices.shareCodesUnsupported);
    return createProfile(decoded);
  }
  const cloudItemsForProfile = (profile) =>
    cloudItemsOf(profile, {
      mods: data.mods,
      pattern: cloudCatalogIDPattern,
      missingRelease: (name) => notices.noPublishedRelease(name),
    });
  /* Ходы сборки редукса и пачек пакетов живут в ленивых модулях `features/catalog/bundles` (Т-81d, этап 2): оболочка даёт им своё состояние — очередь, игру, каталог. */
  const bundleShell = () => ({ account, game, demoMode, preparation, prepareGame, language, mods: data.mods, installed, region, bundleOf, notify: showNotice, notices, queue, setQueue, source: installProgressSource(), enqueueInstall, removeInstalled, guard: vanillaGuardBlocks });
  const installBundle = async (bundle) => (await import("../../features/catalog/bundles/bundle-install.js")).installBundle(bundle, bundleShell());
  const installPackages = async (request) => (await import("../../features/catalog/bundles/batch-install.js")).installPackages(request, bundleShell());
  function removeBundle(bundle) {
    const { ids } = bundleRemoval(bundle, {
      installed,
      mods: data.mods,
      members: bundleMembers(bundle.id, bundleOf),
    });
    if (ids.length) removeInstalled(ids);
  }
  const bundleActions = {
    installed,
    mods: data.mods,
    bundleOf,
    queue,
    installPackages,
    installBundle: (bundle) => installOnce(bundle),
    removeBundle,
  };
  function applyPreparedBuild(state) {
    const removals = separateRemovals(state.removals, state.additions);
    if (removals.length) removeInstalled(removals.map((mod) => mod.id));
    for (const item of state.additions) {
      enqueueInstall(item.mod, item.replaceIds, item.plan);
    }
    showNotice(state.queuedWord || notices.buildQueued(state.profile.name));
  }
  async function installBuild(profile) {
    if (
      !previewBeforeRegistration &&
      (!account || preparation.status !== "ready")
    ) {
      showNotice(notices.signInAndPrepare);
      return;
    }
    if (vanillaGuardBlocks()) return;
    if (!game && !previewBeforeRegistration) {
      showNotice(notices.needGameFolder);
      void chooseGameTarget();
      return;
    }
    if (demoMode || previewBeforeRegistration) {
      const previewCatalog = [
        ...new globalThis.Map(
          [...publicCatalogPreviewMods, ...data.mods].map((mod) => [
            mod.id,
            mod,
          ]),
        ).values(),
      ];
      const desiredMods = previewCatalog.filter((mod) =>
        profile.modIds.includes(mod.id),
      );
      const removals = installed
        .filter((id) => !profile.modIds.includes(id))
        .map(
          (id) =>
            previewCatalog.find((mod) => mod.id === id) || { id, name: id },
        );
      const additions = desiredMods
        .filter((mod) => !installed.includes(mod.id))
        .map((mod) => ({
          mod,
          replaceIds: [],
          plan: {
            summary: { fileCount: 0, writeBytes: 0 },
            conflicts: [],
            demo: true,
          },
        }));
      applyPreparedBuild({
        profile,
        additions,
        removals,
        blocked: [],
        internalConflicts: [],
        summary: { fileCount: 0, writeBytes: 0, transactionBackupBytes: 0 },
      });
      return;
    }
    const requiresLoader = data.mods.some(
      (mod) =>
        profile.modIds.includes(mod.id) &&
        mod.manifest?.requiresLoader !== false,
    );
    if (game.installReadiness !== "ready" && requiresLoader) {
      showNotice(notices.finishPreparation);
      void prepareGame(game, { force: true });
      return;
    }
    const desiredMods = data.mods.filter((mod) =>
      profile.modIds.includes(mod.id),
    );
    const missingIds = profile.modIds.filter(
      (id) => !data.mods.some((mod) => mod.id === id),
    );
    const removals = installed
      .filter((id) => !profile.modIds.includes(id))
      .map(
        (id) =>
          data.mods.find((mod) => mod.id === id) || {
            id,
            name: id,
            cover: covers[0],
          },
      );
    if (preparation.stockHold) await import("../../features/catalog/install-prepare-wait.js").then((part) => part.releaseHeldGame({ game, prepareGame, notify: showNotice }, { id: `build:${profile.name}`, name: profile.name }), () => prepareGame(game, { force: true, releaseStockHold: true }));
    const { additions, blocked, internalConflicts, choosing, choosingWord, choosingQueuedWord } =
      await prepareBuildInstallPlan({
        profile,
        desiredMods,
        missingIds,
        installed,
        allMods: data.mods,
        region,
        game,
        getDownloadGrant: getCloudDownloadGrant,
        recordDownload: recordDesktopCatalogDownload,
        planPackage: planLocalPackage,
        packageURL: packageUrlForRegion,
      });
    const summary = additions.reduce(
      (total, item) => ({
        fileCount: total.fileCount + (item.plan.summary?.fileCount || 0),
        writeBytes: total.writeBytes + (item.plan.summary?.writeBytes || 0),
        transactionBackupBytes:
          total.transactionBackupBytes +
          (item.plan.summary?.transactionBackupBytes || 0),
      }),
      { fileCount: 0, writeBytes: 0, transactionBackupBytes: 0 },
    );
    if (!additions.length && !removals.length && !blocked.length) {
      showNotice(choosing.length ? await choosingWord(language) : notices.buildActive(profile.name));
      return;
    }
    if (blocked.length || internalConflicts.length) {
      showNotice(
        buildBlockedNotice(
          { build: profile.name, blocked, internalConflicts },
          language,
        ),
        "error",
      );
      return;
    }
    /* Одно слово: «остальное в очереди; вещи одежды — …» (`choosingQueuedWord`), а не «в очереди» и сразу затирающее его второе. */
    const queuedWord = choosing.length ? await choosingQueuedWord(language) : "";
    applyPreparedBuild({ profile, additions, removals, blocked, internalConflicts, summary, queuedWord });
  }
  function openSubscription() {
    const url = `${window.location.origin}/subscription`;
    if (window.modovik?.openExternal) window.modovik.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }
  const sidebarQueueMetrics = downloadsRailMetrics({
    queue,
    queueBatch,
    works: workshopInstalls,
  });
  const shellSurface = shellSurfaceProps(
    appearanceState,
    scenePalette,
    motionEnabled,
  );
  if (!bootstrapped) {
    return (
      <div className="desktop-app desktop-app-first-run" {...shellSurface}>
        <ShellScene />
      </div>
    );
  }
  if (!onboardingComplete || !account || gameGate.active) {
    return (
      <div className="desktop-app desktop-app-first-run" {...shellSurface}>
        <ShellScene />
        <ProductOnboardingScreen
          language={language}
          games={games}
          selectedGameId={selectedGameId}
          onSelectGame={selectGameTarget}
          onChooseGame={chooseGameTarget}
          onRefreshGames={refreshGames}
          onAccount={activateCloudAccount}
          onLanguage={(next) => void prepareUiText(next).then(() => setLanguage(next))}
          sessionEnded={cloud.ended}
          firstRun={!onboardingComplete}
          gameOnly={Boolean(account) && onboardingComplete}
          onFinish={(target) => gameGate.finish(() => finishOnboarding(target, setOnboardingComplete, prepareGame))}
        />
      </div>
    );
  }
  /* Тело раздела — функцией: страницу рисуют в двух местах (обычный контейнер и спрятанный каталог, `KeptPage`). */
  const renderPage = (pageId) => (
    <BundleContext.Provider value={bundleActions}>
      <GuardedDesktopPageRouter
        page={pageId}
        idle={splashGone}
        home={{
          catalogMods: publicCatalogPreviewMods,
          mods: data.mods,
          onNavigate: navigate,
          onSelect: openMod,
          language,
          catalogPending: Boolean(cloud.connection.gap?.catalog),
          catalogLoading: cloud.connection.catalogLoading,
          onRetryCatalog: cloud.connection.retry,
          installed,
          queue,
          onInstall: installOnce,
          onRemove: removeMod,
        }}
        catalog={{
          data,
          catalogPending: Boolean(cloud.connection.gap?.catalog),
          catalogLoading: cloud.connection.catalogLoading,
          onRetryCatalog: cloud.connection.retry,
          onSelect: openMod,
          onNavigate: navigate,
          language,
          initialFilter: catalogGroup,
          installed,
          onInstall: installOnce,
          onRemove: removeMod,
        }}
        search={{
          data,
          onSelect: openMod,
          onBack: () => navigate("overview"),
          language,
          initialFilter: catalogGroup,
        }}
        workshop={{
          data,
          installed,
          queue,
          favorites,
          initialGroup: catalogGroup,
          onSelect: openMod,
          onFavorite: favorite,
          onInstall: installOnce,
          onLaunch: startGameSession,
          onRemove: removeMod,
          onNavigate: navigate,
          onNotice: showNotice,
          language,
          /* Куратору студии дают «В каталог»: пак — во входящие. */
          isAdmin: account?.role === "admin",
          /* Полка мастерской и библиотеки — один компонент, и снятие из
           игры у него общее: ему нужна игра и перечитывание. */
          gameTargetId: selectedGameId,
          onLibraryChanged: () => syncInstalledProfile().catch(() => {}),
          checkRevision: checkRemoval.revision,
          onLibraryStatus: checkRemoval.onLibraryStatus,
        }}
        /* Экран оптимизации сидит на том же наборе: он сообщает об
         применении и об откате тем же уведомлением, что и остальной
         лаунчер, а цель диагностики берёт из выбранной игры, а не из
         localStorage, чтобы смена игры доходила без перезапуска. */
        gameSettings={{
          language,
          targetId: selectedGameId,
          onNotice: showNotice,
          onApplied: () => completeHomeProgress("customization"),
        }}
        detail={{
          mod: detailMod,
          allMods: data.mods,
          catalogMods: publicCatalogPreviewMods,
          installed,
          favorites,
          queue,
          language,
          returnTo: detailReturnPage,
          onBack: () => trail.back(setDetailMod) || navigate(detailReturnPage),
          backName: trail.backName,
          onNavigate: navigate,
          onInstall: installOnce,
          onRemove: removeMod,
          onRetry: retryOperation,
          onFavorite: favorite,
          /* Страница автора — запись следа (`catalog-authors.js`):
             открывается тем же `openMod`, «назад» — по следу. Оценок
             и отзывов на странице мода нет (владелец, 16.10). */
          onSelect: openMod,
        }}
        installed={{
          data,
          installed,
          favorites,
          onFavorite: favorite,
          onSelect: openMod,
          onRemove: removeInstalled,
        }}
        builds={{
          installed,
          data,
          onNotice: showNotice,
          profiles,
          setProfiles,
          onInstallBuild: installBuild,
          onNavigate: navigate,
          onSelect: openMod,
          onCreateProfile: createProfile,
          onDeleteProfile: deleteProfile,
          onImportProfile: importProfile,
          catalogMods: publicCatalogPreviewMods,
          cloudMode: profilesMode === "cloud",
          catalogConnection: cloud.connection,
          getModSize: modSizeBytes,
          animateInstall: animateInstallToDownloads,
          queue,
          language,
        }}
        profile={{ account, favorites, connected: !cloud.connection.gap, onSelect: openMod, onBack: profileOrigin ? backToSettings : null }}
        publisher={{
          isAdmin: account?.role === "admin",
          onPublished: (mod) =>
            setData((previous) => ({
              ...previous,
              mods: [
                mod,
                ...previous.mods.filter((item) => item.id !== mod.id),
              ],
            })),
          onNotice: showNotice,
        }}
      />
    </BundleContext.Provider>
  );
  return (
    <div className="desktop-app" {...shellSurface}>
      <ShellScene />
      <div className="desktop-titlebar">
        <Brand
          className="desktop-titlebar-brand"
          markClassName="desktop-titlebar-brand-mark"
          wordmarkAs="b"
        />
        <CloudConnectionStatus
          connection={cloud.connection}
          language={language}
        />
      </div>
      <DesktopNavigation
        page={page}
        language={language}
        downloadsOpen={downloadsOpen}
        queueMetrics={sidebarQueueMetrics}
        settingsOpen={settingsOpen}
        onNavigate={navigate}
        isAdmin={account?.role === "admin"}
        restoreCount={restoreMods.count}
      />
      <main className="desktop-main" ref={assemblyScopeRef}>
        {!KEPT_PAGES[contentPage] && (
          <div
            className="desktop-content page-assembly-active"
            data-page={contentPage}
            /* Возврат в начало раздела — новая сборка страницы: ключ меняется, раздел встречает человека своим корнем. */
            key={`${contentPage}:${sectionResets}`}
          >
            {renderPage(contentPage)}
          </div>
        )}
        <KeptPages kept={kept} page={page} contentPage={contentPage} render={renderPage} busy={Boolean(sidebarQueueMetrics) || !splashGone} />
      </main>
      {downloadsOpen && (
        <Suspense fallback={null}>
        <DownloadsPanel
          queue={queue}
          onCancel={cancelOperation}
          onRetry={retryOperation}
          onClose={closeDownloads}
          closing={downloadsClosing}
          onRetryWork={retryWorkshopInstall}
          onDismissWork={dismissWorkshopInstall}
          onCancelWork={cancelWorkshopInstall}
          onNotice={showNotice}
          onOpenLogs={() => { remember("settings:section", "logs"); closeDownloads(); navigate("settings"); }}
          onOpenCatalog={() => navigate("catalog")} onReorder={reorderQueue}
          game={game} language={language}
          library={{ data, installed, bundleOf, queue, onSelect: openMod, onInstall: installOnce, onRemove: removeMod, onNavigate: navigate, onNotice: showNotice, gameTargetId: selectedGameId, onLibraryChanged: () => syncInstalledProfile().catch(() => {}), onRestoreGame: restoreGame, checkRemoved: checkRemoval.removed, checkRevision: checkRemoval.revision, onLibraryStatus: checkRemoval.onLibraryStatus }}
        />
        </Suspense>
      )}
      <CartPanel mods={data.mods} installed={installed} queue={queue} onInstall={installOnce} onOpenMod={openMod} onNavigate={navigate} onNotice={showNotice} page={page} />
      <SettingsWindow
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={{
          account,
          onAccount:
            demoMode || localDeveloperMode || localFirstRunQaMode
              ? () => showNotice(notices.demoProfile)
              : activateCloudAccount,
          game,
          games,
          onSelectGame: selectGameTarget,
          onChooseGame: chooseGameTarget, onRefreshGames: refreshGames,
          onReset: resetMods, resetItem: queue.findLast((entry) => entry.operation === "reset"),
          language,
          onLanguage: (next) => void prepareUiText(next).then(() => setLanguage(next)), // скорость 12.10: словарь — отдельным куском, язык — когда он пришёл
          installing: Boolean(sidebarQueueMetrics), // идёт установка — окно настроек не прогревается (`SettingsPrewarm`)
          mods: data.mods, // миниатюра Главной в «Внешнем виде» (23.10.2026) берёт настоящие фото каталога
          motionChoice,
          onMotionChoice: setMotionChoice,
          motionEnabled,
          onNotice: showNotice,
          onSubscription: openSubscription,
          onOpenProfile: () => { setProfileOrigin({ page }); navigate("profile"); },
          restoreMods,
        }}
      />
      <PreparationDock
        state={preparation}
        language={language}
        onOpenSettings={() => navigate("settings")}
      />
      {notice && (
        <DesktopOverlayPortal>
          <div
            className={`desktop-action-toast is-${notice.tone}`}
            key={notice.id}
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live={notice.tone === "error" ? "assertive" : "polite"}
          >
            {notice.tone === "error" ? <WarningCircle /> : <CheckCircle />}
            <span>{notice.text}</span>
          </div>
        </DesktopOverlayPortal>
      )}
      <div className="desktop-overlay-host" data-desktop-overlay-host />
      <FastInstallOffer /><CloseAskHost queue={queue} language={language} />
      <FocusTip />
      <CommandPalette mods={publicCatalogPreviewMods} runtimeMods={data.mods} language={language} isAdmin={account?.role === "admin"} onSelect={openMod} onNavigate={navigate} />
    </div>
  );
}
