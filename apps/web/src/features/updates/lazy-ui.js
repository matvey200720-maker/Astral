import { featurePage } from "../../components/desktop/lazy-page.jsx";

// Карточки «Обновления» и «Версии Astral» и слои поверх окна едут одним ленивым куском ui.js
// со своим листом стилей. Загрузчик общий (не по копии на страницу): вторая загрузка берёт
// уже готовый модуль, а литерал пути нужен сборщику для отдельного куска.
// В основном куске окна остаются только хост, хранилище и модель обновлений.
const load = () => {
  return import("./ui.js");
};

// .preload() каждой страницы подтягивает кусок заранее: карточка в настройках бета-версии
// открывается без пустоты.
export const LazyUpdatesCard = featurePage(load, "UpdatesCard"),
  LazyUpdatesLayers = featurePage(load, "UpdatesLayers"),
  LazyBranchesCard = featurePage(load, "BranchesCard"),
  LazyBranchesLayers = featurePage(load, "BranchesLayers");
