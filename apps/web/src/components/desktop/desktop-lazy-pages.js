import * as lazy from "./lazy-page.jsx";

// Пути в import() нельзя прятать в таблицы: бандлер режет куски по литералам.
const feature = (name, loader) => lazy.featurePage(loader, name);

// «Каталог» и «Установленное» живут в одном куске, поэтому загрузчик общий.
function loadCatalogPages() {
  return import("../../features/catalog/pages.js");
}

export const OptimizationPage = feature("OptimizationPage", () =>
  import("../../features/optimization/index.js"),
);
export const ReshadePage = feature("ReshadePage", () => import("../../features/reshade/index.js"));
export const GameSettingsPage = feature("GameSettingsPage", () =>
  import("../../features/game-settings/index.js"),
);
export const BuildsPage = feature("BuildsPage", () => import("../../features/builds/index.js"));
export const ProfilePage = feature("ProfilePage", () =>
  import("../../features/profile/index.js"),
);

export const PublicationWorkbench = lazy.lazyPage(() => import("./PublicationWorkbench.jsx"));
export const ModDetailPage = lazy.lazyPage(() => import("./catalog/ModDetailPage.jsx"));

export const SearchPage = feature("AdvancedCatalogSearch", () =>
  import("./catalog/AdvancedCatalogSearch.jsx"),
);
export const CatalogPage = feature("CatalogPage", loadCatalogPages);
export const InstalledPage = feature("InstalledPage", loadCatalogPages);
export const WorkshopPage = feature("WorkshopPage", () =>
  import("../../features/workshop/index.js"),
);

// Подтяжка в простое идёт в этом порядке: частые страницы, редкие, затем тяжёлые.
// PublicationWorkbench (только администрация), InstalledPage (грузится с CatalogPage) и ProfilePage (открывают редко, кусок небольшой) не нужны.
const FREQUENT = [WorkshopPage, CatalogPage, BuildsPage];
const OCCASIONAL = [ModDetailPage, SearchPage];
const HEAVY = [ReshadePage, GameSettingsPage, OptimizationPage];

export const OPENED_BY_CLICK = [...FREQUENT, ...OCCASIONAL, ...HEAVY];
