/* Рейка — итог F (владелец, 15.11.2026): каркас «Контур», значки «Силуэт» (`rail-glyphs.jsx`), подписей и раскрытия нет — имя и «Ctrl N» в подсказке.
   Список `desktopNavigationItems` со значками Phosphor нужен палитре команд, выбору стартовой страницы и образцу вида; сама рейка рисует свои значки. */
import {
  Books,
  DlssGlyph,
  Gauge,
  GraphicsGlyph,
  House,
  SquaresFour,
  Stack,
  UploadSimple,
  Wrench,
} from "../../ui/icons.jsx";
import {
  RAIL_SHORTCUTS,
  navigationLabels,
  replayMotionClass,
  useRailShortcuts,
  useRailSlot,
  utilityLabels,
} from "./navigationRail.js";
import { isPageHidden } from "./hidden-pages.js";
import RailGlyph, { RailBadge, RailTip } from "./rail-glyphs.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import CartRailButton from "../../../features/cart/CartRailButton.jsx";

export function desktopNavigationItems(language, isAdmin = false) {
  const labels = navigationLabels[language] || navigationLabels.en;
  /* Библиотека — сразу под мастерской: там собирают, здесь видно, что стоит в игре. */
  const items = [
    ["overview", labels[0], House],
    ["catalog", labels[1], SquaresFour],
    ["workshop", labels[2], Wrench],
    ["library", labels[3], Books],
    /* ReShade — две вкладки («ReShade» с пресетами и «DLSS 5»); имя собственное. Ключ раздела прежний — `reshade`: запомненные переходы не теряются. */
    ["reshade", "ReShade", DlssGlyph],
    ["game-settings", labels[4], GraphicsGlyph],
    ["optimization", labels[5], Gauge],
    ["profiles", labels[6], Stack],
  ];
  // Вкладка администратора: публикует в локальный каталог этой машины. На рейке её нет (итог F), её берёт палитра команд.
  if (isAdmin) items.push(["publisher", "Публикация", UploadSimple]);
  /* Раздел, убранный владельцем, остаётся в списке определением, но в рейку не встаёт (`hidden-pages.js`). */
  return items.filter(([id]) => !isPageHidden(id));
}

const LONG_NAMES = { reshade: "ReShade и DLSS 5" };

export default function DesktopNavigation({
  page,
  language,
  downloadsOpen,
  settingsOpen = false,
  queueMetrics,
  onNavigate,
  isAdmin = false,
  restoreCount = 0,
}) {
  useTr();
  /* «Публикации» на рейке нет (владелец, 15.11.2026): страница живёт, к ней
     ведут палитра команд и «Отправить в каталог» у работ мастерской. */
  const navigationItems = desktopNavigationItems(language, isAdmin).filter(
    ([id]) => id !== "publisher",
  );
  const [downloadsLabel, settingsLabel] =
    utilityLabels[language] || utilityLabels.en;
  /* Открытая страница загрузок или настроек (она закрывает область справа от рейки, как страница) горит одна: раздел под ней не отмечен. */
  const covered = downloadsOpen || settingsOpen;
  const activeIndex = covered
    ? -1
    : navigationItems.findIndex(([id]) => id === page);
  const settingsActive = !downloadsOpen && settingsOpen;
  const { slot, visible } = useRailSlot(activeIndex);
  const downloading = queueMetrics?.active ?? 0;
  useRailShortcuts(
    navigationItems.slice(0, RAIL_SHORTCUTS).map(([id]) => id),
    onNavigate,
  );

  function navigateWithMotion(event, destination, motionClass) {
    const button = event.currentTarget;
    onNavigate(destination);
    requestAnimationFrame(() => replayMotionClass(button, motionClass));
  }

  return (
    <aside className="desktop-sidebar compact-sidebar">
      <nav
        aria-label={
          language === "ru" ? tr("Основная навигация") : "Primary navigation"
        }
        data-rail-active={visible ? "" : undefined}
        style={{ "--rail-active": slot }}
      >
        <span className="nav-rail-pill" aria-hidden="true" />
        {navigationItems.map(([id, label], index) => {
          const active = !covered && page === id;
          return (
            <button
              type="button"
              className={active ? "active" : ""}
              onClick={(event) =>
                navigateWithMotion(event, id, "is-nav-icon-pop")
              }
              key={id}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              data-nav-motion={id}
              style={{ "--rail-index": index }}
            >
              <RailGlyph id={id} />
              <RailTip
                label={LONG_NAMES[id] ? tr(LONG_NAMES[id]) : label}
                keys={index < RAIL_SHORTCUTS ? `Ctrl ${index + 1}` : null}
              />
            </button>
          );
        })}
      </nav>
      <div className="desktop-sidebar-bottom">
        <div className="sidebar-account">
          <CartRailButton style={{ "--rail-index": navigationItems.length }} />
          {/* Во время установки кнопка не растёт и не качается (ТЗ 08.10,
              вечер). С итога F у неё нет ни кольца, ни полоски: в правом
              верхнем углу — сколько модов качается сейчас, а когда ничего не
              качается, числа нет. Ход виден в самих загрузках. */}
          <button
            type="button"
            className={`sidebar-download-button${downloadsOpen ? " active" : ""}${queueMetrics ? " has-downloads" : ""}`}
            onClick={(event) =>
              navigateWithMotion(event, "downloads", "is-download-impact")
            }
            aria-label={
              queueMetrics
                ? `${downloadsLabel}: ${queueMetrics.completedFiles} / ${queueMetrics.totalFiles}`
                : downloadsLabel
            }
            aria-expanded={downloadsOpen}
            data-nav-motion="downloads"
            style={{ "--rail-index": navigationItems.length }}
          >
            <RailGlyph id="downloads" />
            {downloading > 0 && <RailBadge count={downloading} />}
            <RailTip
              label={downloadsLabel}
              note={
                downloading > 0
                  ? trFill("Идёт загрузка: {0}", downloading)
                  : null
              }
            />
          </button>
          <button
            type="button"
            className={`app-settings-button${settingsActive ? " active" : ""}`}
            onClick={(event) =>
              navigateWithMotion(event, "settings", "is-settings-gear-spin")
            }
            aria-label={settingsLabel}
            aria-haspopup="dialog"
            aria-expanded={settingsActive}
            data-nav-motion="settings"
            style={{ "--rail-index": navigationItems.length + 1 }}
          >
            <RailGlyph id="settings" />
            {/* Моды пропали после проверки файлов игры: тихая янтарная точка зовёт в «Настройки → GTA V» (владелец, 16.11.2026). */}
            {restoreCount > 0 ? <i className="rail-alert-dot" aria-hidden="true" /> : null}
            <RailTip label={settingsLabel} />
          </button>
        </div>
      </div>
    </aside>
  );
}
