import "./styles/index.css";
import DesktopApp from "./desktop-entry.jsx";
import {
  installRendererErrorCapture,
  installStaleBuildRecovery,
  watchLongFrames,
} from "./features/app-errors/index.js";
import { normalizeLanguage } from "./locales/desktop.js";
import { languageFromTimeZone, systemTimeZone } from "./locales/time-zone-language.js";
import { prepareUiText } from "./locales/ui.js";
import { installHiddenRangeRelease } from "./utils/rangeSelection.js";
import { primeHibernation, startHibernationClient } from "./features/hibernation/hibernation-client.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const query = () => new URLSearchParams(window.location.search);

// Раньше всего и без условий: отчёты о сбоях окна и кадрах дольше секунды, снятие невидимого
// диапазона выделения (ронял Chromium посреди кадра, бета 14.10) и перезагрузка за свежей сборкой.
installRendererErrorCapture();
watchLongFrames();
installHiddenRangeRelease();
installStaleBuildRecovery();

const LANGUAGE_KEY = "modovik-language";

// Сверка со словарём и зонд замера — только в разработке и в сборке замера (vite build --mode perf).
// Vite сворачивает условия, и в продуктовый бандл модули dev/* не попадают.
if (import.meta.env.DEV) {
  import("./dev/ui-audit.js").then((chunk) => chunk.installUiAudit());
}
if (import.meta.env.DEV || import.meta.env.MODE === "perf") {
  void import("./dev/perf-probe.js").then((chunk) => {
    // зонд оборачивает rAF, таймеры и наблюдателей: ?qa-noprobe даёт чистый замер
    if (query().has("qa-noprobe")) {
      return;
    }
    const env = import.meta.env;
    chunk.installPerfProbe({ mode: env.MODE, dev: env.DEV });
  });
}

// Режим запуска: скрытые окна-съёмщики узнаются по мосту их preload, интерфейса у них нет (Т-83);
// живая модель на настоящем GLB без остального окна — только в разработке; иначе обычный запуск.
const { astralClothingShooter: clothing, astralGunpackShooter: gunpack, astralPartShooter: part } = window;
const served = clothing
  ? import("./features/clothing/shooter-service.js").then((chunk) => chunk.serveClothingShots(clothing))
  : gunpack
    ? import("./components/desktop/workshop/gunpack/shooter-service.js").then((chunk) =>
        chunk.serveGunpackShots(gunpack),
      )
    : part
      ? import("./features/catalog/part-covers/shooter-service.js").then((chunk) => chunk.servePartShots(part))
      : import.meta.env.DEV && query().get("qa-live-model")
        ? import("./dev/qa-live-model.jsx").then((chunk) =>
            chunk.mountQaLiveModel(document.getElementById("root"), query()),
          )
        : import.meta.env.DEV && query().get("qa-redux-layer-scene")
          ? import("./dev/qa-redux-layer-scene.jsx").then((chunk) =>
              chunk.mountQaReduxLayerScene(document.getElementById("root"), query()),
            )
          : null;

if (!served) {
  // Обычный запуск. Словарь (скорость 12.10) и память разделов после спячки (?hibernation=1) ждём до
  // первого кадра, но отказ любого шага окно не останавливает; ошибка самого запуска намеренно не
  // перехватывается. Условие фикстур свёрнуто Vite (Т-163).
  const fixtures =
    import.meta.env.MODE !== "perf" && !import.meta.env.DEV
      ? Promise.resolve()
      : import("./dev/qa-fixtures.js").then((chunk) => chunk.prepareQaFixtures());
  // Первый запуск: язык по часовому поясу системы, дальше его выбирают в настройках.
  // Хранилище может быть недоступно — тогда молча остаёмся на русском.
  let language = "ru";
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    const guess = stored ? null : languageFromTimeZone(systemTimeZone());
    if (guess) {
      localStorage.setItem(LANGUAGE_KEY, guess);
    }
  } catch {
    // хранилище недоступно
  }
  try {
    language = normalizeLanguage(localStorage.getItem(LANGUAGE_KEY));
  } catch {
    // хранилище недоступно
  }
  fixtures
    .finally(() => {
      return prepareUiText(language);
    })
    .finally(() => {
      return primeHibernation();
    })
    .catch(() => {})
    .then(() => {
      const container = document.getElementById("root");
      startHibernationClient();
      createRoot(container).render(
        <StrictMode>
          <DesktopApp />
        </StrictMode>,
      );
    });
}
