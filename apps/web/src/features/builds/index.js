import BuildsPage from "../../components/desktop/builds/BuildsPage.jsx";

export { BuildsPage };

// Остальное — логика сборок; оболочка окна берёт её из ./logic.js напрямую.
export { copyBuildCode, decodePortableBuild, encodePortableBuild } from "./logic.js";
export { buildIsInstalled, prepareBuildInstallPlan } from "./logic.js";
