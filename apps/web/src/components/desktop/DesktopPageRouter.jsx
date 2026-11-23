import HomePage from "../../features/home/HomePage.jsx";
import { isPageHidden } from "./navigation/hidden-pages.js";
import { usePreloadWhenIdle } from "./lazy-page.jsx";
import {
  BuildsPage,
  CatalogPage,
  GameSettingsPage,
  InstalledPage,
  ModDetailPage,
  OPENED_BY_CLICK,
  OptimizationPage,
  ProfilePage,
  PublicationWorkbench,
  ReshadePage,
  SearchPage,
  WorkshopPage,
} from "./desktop-lazy-pages.js";

/* Куски разделов начинают подтягиваться не сразу после монтирования, а когда Главная уже собрана (холодный старт ×4: карточка ленты на 1,6–1,8 с). */
const PRELOAD_START_MS = 2000;

export default function DesktopPageRouter({
  page,
  home,
  catalog,
  search,
  workshop,
  gameSettings,
  detail,
  installed,
  builds,
  profile,
  publisher,
  /* Заставка запуска ушла: до этого куски разделов не подтягиваются (под заставкой пробуждения мастерская не грузится и не исполняется). */
  idle = true,
}) {
  usePreloadWhenIdle(OPENED_BY_CLICK, {
    startDelay: PRELOAD_START_MS,
    enabled: idle,
  });
  if (isPageHidden(page)) return null;
  switch (page) {
    case "overview":
      return <HomePage {...home} />;
    case "catalog":
      return <CatalogPage {...catalog} />;
    case "search":
      return <SearchPage {...search} />;
    case "workshop":
      return <WorkshopPage {...workshop} />;
    case "game-settings":
      return <GameSettingsPage {...gameSettings} />;
    case "reshade":
      return <ReshadePage {...gameSettings} />;
    case "optimization":
      return <OptimizationPage {...gameSettings} />;
    case "detail":
      return detail.mod ? (
        <ModDetailPage key={detail.mod.id} {...detail} />
      ) : null;
    case "installed":
      return <InstalledPage {...installed} />;
    case "profiles":
      return <BuildsPage {...builds} />;
    case "profile":
      return <ProfilePage {...builds} {...profile} />;
    case "publisher":
      return <PublicationWorkbench {...publisher} />;
    default:
      return null;
  }
}
