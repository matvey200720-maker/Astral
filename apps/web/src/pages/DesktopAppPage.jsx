import { useEffect } from "react";
import DesktopShell from "../components/desktop/DesktopShell.jsx";
import { isPageHidden } from "../components/desktop/navigation/hidden-pages.js";
import { analyzeOptimization } from "../api.js";
import { UpdatesHost } from "../features/updates/index.js";
import StartupSplash from "../features/onboarding/splash/StartupSplash.jsx";

export default function DesktopAppPage(props) {
  useEffect(() => {
    /* Опрос железа греет только «Оптимизацию»: пока её нет в рейке, запуск
       на него не тратится. */
    if (isPageHidden("optimization")) return;
    const targetId = localStorage.getItem("modovik-game-target") || "";
    analyzeOptimization({ targetId }).catch(() => {});
  }, []);
  /* Слои обновлений и заставка запуска стоят рядом с оболочкой: сама она упирается в потолок строк. */
  return <><DesktopShell {...props} /><UpdatesHost /><StartupSplash /></>;
}
