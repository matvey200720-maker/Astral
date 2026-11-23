// Единая точка входа в раздел «Сборка редукса одной кнопкой» (Т-81d, Т-97).
// Верхний features/catalog/index.js отдаёт дальше только часть этих имён;
// bundleVariantOf, queueBundle…, partVersions, catalogWork… и
// выбор версий берут прямо из файлов. Новые имена — только по согласованию.
export { BundleContext, useBundleActions } from "./BundleContext.js";
// `BundleInstallActions` (`./BundleInstallActions.jsx`) и `prepareBundleInstall` (`./bundle-install.js`) отсюда не отдаются: их берут напрямую страница и сцена карточки
// и оболочка по `import()`, а статическое ребро из стартового куска тянуло бы за собой хранилище выбора компонентов (потолок `main-*.js`).
export { bundleCopy, bundlePartsLabel } from "./bundle-copy.js";
export {
  bundleMembers,
  bundleOriginsOf,
  bundleParts,
  bundleProgress,
  bundleRemoval,
  dropBundleRest,
  installedBundles,
} from "./bundle-state.js";
