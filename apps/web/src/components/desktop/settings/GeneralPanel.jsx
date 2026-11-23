import { createElement, useMemo } from "react";
import * as Icons from "../../ui/icons.jsx";
import Select from "../../ui/Select.jsx";
import * as hintStore from "../../ui/hints-preference.js";
import Button from "../../ui/Button.jsx";
import * as updates from "../../../features/updates/index.js";
import { updateActions, useUpdates } from "../../../features/updates/store.js";
import { describe as describeUpdate } from "../../../features/updates/model.js";
import { statusOf } from "../../../features/updates/status.js";
import { updatesCopyFor } from "../../../features/updates/copy.js";
import UpdateBar from "../../../features/updates/UpdateBar.jsx";
import Switch from "../../ui/Switch.jsx";
import { Skeleton } from "../../ui/Skeleton.jsx";
import { desktopHost } from "../../../api.js";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import { useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { desktopNavigationItems } from "../navigation/DesktopNavigation.jsx";
import { formatBytes } from "./format-bytes.js";
import { useStorageStatus } from "./settings-live.jsx";
import { driveOf, middlePath } from "./middle-path.js";
import { storageParts } from "./storage-parts.js";
import { DEFAULT_START_PAGE, START_PAGES } from "./useGeneralPreferences.js";

// Порядок языков в каждой строке таблицы слов.
const LANGS = ["ru", "uk", "en", "de", "pl", "fr"];

// Слова раздела: ключ -> шесть переводов подряд, в порядке LANGS.
const WORDS = {
  gameReady: [
    "Готова к модам",
    "Готово для модів",
    "Ready for mods",
    "Bereit für Mods",
    "Gotowe na mody",
    "Prêt pour les mods",
  ],
  gameNoLoader: [
    "Моды не установятся",
    "Моди не встановляться",
    "Mods won’t install",
    "Mods werden nicht installiert",
    "Mody się nie zainstalują",
    "Les mods ne s'installeront pas",
  ],
  gameBusy: [
    "Закройте лаунчер Rockstar",
    "Закрийте Rockstar Launcher",
    "Close Rockstar Launcher",
    "Rockstar Launcher schließen",
    "Zamknij Rockstar Launcher",
    "Fermez Rockstar Launcher",
  ],
  gameMissing: [
    "Укажите папку с игрой",
    "Оберіть теку з грою",
    "Choose the game folder",
    "Spielordner wählen",
    "Wybierz folder z grą",
    "Choisissez le dossier du jeu",
  ],
  notFound: [
    "Не найдена",
    "Не знайдено",
    "Not found",
    "Nicht gefunden",
    "Nie znaleziono",
    "Introuvable",
  ],
  build: ["сборка", "збірка", "build", "Build", "build", "build"],
  space: [
    "Место Astral",
    "Місце Astral",
    "Astral storage",
    "Astral-Speicher",
    "Miejsce Astral",
    "Espace Astral",
  ],
  legendMods: ["моды", "моди", "mods", "Mods", "mody", "mods"],
  legendCache: ["кэш", "кеш", "cache", "Cache", "pamięć podręczna", "cache"],
  legendBackups: [
    "копии игры",
    "резервні копії гри",
    "game backups",
    "Spielsicherungen",
    "kopie gry",
    "sauvegardes du jeu",
  ],
  legendOther: ["прочее", "інше", "other", "Sonstiges", "inne", "autre"],
  spaceUnknown: [
    "Место считает приложение Astral для Windows",
    "Місце вимірює застосунок Astral для Windows",
    "Storage is measured by the Astral Windows app",
    "Der Speicher wird von der Astral-für-Windows-App gemessen",
    "Miejsce mierzy aplikacja Astral dla Windows",
    "L'espace est calculé par l'application Astral pour Windows",
  ],
  version: ["Версия", "Версія", "Version", "Version", "Wersja", "Version"],
  packaged: [
    "Установленная сборка",
    "Встановлена збірка",
    "Installed build",
    "Installierter Build",
    "Zainstalowany build",
    "Build installé",
  ],
  versionUnknown: [
    "Версию сообщает приложение Astral для Windows",
    "Застосунок Astral для Windows повідомляє свою версію",
    "The Astral Windows app reports its version",
    "Die Astral-für-Windows-App meldet ihre Version",
    "Aplikacja Astral dla Windows podaje swoją wersję",
    "La version est indiquée par l'application Astral pour Windows",
  ],
  startup: [
    "Запуск",
    "Запуск",
    "Startup",
    "Start",
    "Uruchamianie",
    "Démarrage",
  ],
  loginTitle: [
    "Запускать вместе с Windows",
    "Запускати з Windows",
    "Start with Windows",
    "Mit Windows starten",
    "Uruchamiaj z Windows",
    "Lancer avec Windows",
  ],
  loginHint: [
    "Astral открывается при входе в систему",
    "Astral відкривається під час входу в систему",
    "Astral opens when you sign in",
    "Astral öffnet sich bei der Anmeldung",
    "Astral otwiera się po zalogowaniu",
    "Astral s'ouvre à l'ouverture de session",
  ],
  loginNo: [
    "Работает в установленном Astral для Windows",
    "Працює у встановленому Astral для Windows",
    "Works in the installed Astral for Windows",
    "Funktioniert in der installierten Astral-für-Windows-App",
    "Działa w zainstalowanym Astral dla Windows",
    "Fonctionne dans Astral pour Windows installé",
  ],
  startPageTitle: [
    "Открывать при запуске",
    "Відкривати під час запуску",
    "Open on start",
    "Beim Start öffnen",
    "Otwieraj przy starcie",
    "Ouvrir au démarrage",
  ],
  startPageHint: [
    "Какой раздел показывать первым",
    "Який розділ показувати першим",
    "Which section to show first",
    "Welcher Bereich zuerst angezeigt wird",
    "Która sekcja ma być pokazana jako pierwsza",
    "Section à afficher en premier",
  ],
  closeTitle: [
    "Закрытие окна",
    "Закриття вікна",
    "Closing the window",
    "Fenster schließen",
    "Zamykanie okna",
    "Fermeture de la fenêtre",
  ],
  closeHint: [
    "В трей — загрузки и установки продолжаются",
    "У трей — завантаження й встановлення тривають",
    "To tray — downloads and installs keep going",
    "In den Infobereich — Downloads und Installationen laufen weiter",
    "Do zasobnika — pobieranie i instalacje trwają dalej",
    "Réduit dans la zone de notification — les téléchargements et installations continuent",
  ],
  trayOption: [
    "В трей",
    "У трей",
    "To tray",
    "In den Infobereich",
    "Do zasobnika",
    "Réduire",
  ],
  quitOption: ["Выйти", "Вийти", "Quit", "Beenden", "Zamknij", "Quitter"],
  closeNo: [
    "Трей есть только в Astral для Windows",
    "Трей є лише в Astral для Windows",
    "The tray exists only in Astral for Windows",
    "Den Infobereich gibt es nur in der Astral-für-Windows-App",
    "Zasobnik jest tylko w Astral dla Windows",
    "La zone de notification n'existe que dans Astral pour Windows",
  ],
  askCloseTitle: [
    "Спрашивать при закрытии",
    "Питати під час закриття",
    "Ask before closing",
    "Beim Schließen nachfragen",
    "Pytaj przy zamykaniu",
    "Demander avant de fermer",
  ],
  askCloseHint: [
    "Если идёт скачивание: свернуть в трей, закрыть или остаться",
    "Якщо триває завантаження: згорнути в трей, закрити або залишитися",
    "While something is downloading: minimize to tray, close or stay",
    "Während eines Downloads: in den Infobereich, schließen oder bleiben",
    "Gdy trwa pobieranie: do zasobnika, zamknąć lub zostać",
    "Pendant un téléchargement\u00a0: réduire, fermer ou rester",
  ],
  gpuTitle: [
    "Видеокарта",
    "Відеокарта",
    "Graphics card",
    "Grafikkarte",
    "Karta graficzna",
    "Carte graphique",
  ],
  gpuHint: [
    "Мощная — 3D-предпросмотры мастерской рисует дискретная видеокарта ноутбука",
    "Потужна — 3D-перегляди майстерні малює дискретна відеокарта ноутбука",
    "Powerful — the laptop discrete GPU draws workshop 3D previews",
    "Leistungsstark — die dedizierte Laptop-GPU zeichnet die 3D-Vorschauen der Werkstatt",
    "Wydajna — podglądy 3D warsztatu rysuje dedykowana karta laptopa",
    "Puissante — la carte graphique dédiée du portable dessine les aperçus 3D de l'Atelier",
  ],
  powerfulOption: [
    "Мощная",
    "Потужна",
    "Powerful",
    "Leistungsstark",
    "Wydajna",
    "Puissante",
  ],
  economyOption: [
    "Экономичная",
    "Економна",
    "Power saving",
    "Stromsparen",
    "Oszczędna",
    "Économe",
  ],
  gpuRestart: [
    "Сменится после перезапуска Astral",
    "Зміниться після перезапуску Astral",
    "Changes after restarting Astral",
    "Wird nach einem Neustart von Astral übernommen",
    "Zmieni się po ponownym uruchomieniu Astral",
    "Prendra effet après le redémarrage d'Astral",
  ],
  reset: [
    "Сбросить",
    "Скинути",
    "Reset",
    "Zurücksetzen",
    "Resetuj",
    "Réinitialiser",
  ],
  folder: [
    "Папка Astral",
    "Тека Astral",
    "Astral folder",
    "Astral-Ordner",
    "Folder Astral",
    "Dossier Astral",
  ],
  folderHint: [
    "Кэш скачанных модов и резервные копии",
    "Кеш завантажених модів і резервні копії",
    "Downloaded mod cache and backups",
    "Cache heruntergeladener Mods und Sicherungskopien",
    "Pamięć pobranych modów i kopie zapasowe",
    "Cache des mods téléchargés et sauvegardes",
  ],
  folderUnknown: [
    "Папку показывает приложение Astral для Windows",
    "Теку показує застосунок Astral для Windows",
    "The Astral Windows app shows the folder",
    "Den Ordner zeigt die Astral-für-Windows-App",
    "Folder pokazuje aplikacja Astral dla Windows",
    "Le dossier est indiqué par l'application Astral pour Windows",
  ],
  open: ["Открыть", "Відкрити", "Open", "Öffnen", "Otwórz", "Ouvrir"],
  change: ["Изменить", "Змінити", "Change", "Ändern", "Zmień", "Modifier"],
  hints: [
    "Подсказки",
    "Підказки",
    "Hints",
    "Hinweise",
    "Podpowiedzi",
    "Astuces",
  ],
  hintsTitle: [
    "Подсказки в редакторах",
    "Підказки в редакторах",
    "Hints in editors",
    "Hinweise in Editoren",
    "Podpowiedzi w edytorach",
    "Astuces dans les éditeurs",
  ],
  hintsHint: [
    "Встают при первом входе в редактор и первом взятии инструмента",
    "З’являються під час першого входу в редактор і першого вибору інструмента",
    "Shown on first entering an editor and first picking a tool",
    "Erscheinen beim ersten Öffnen eines Editors und beim ersten Wählen eines Werkzeugs",
    "Pojawiają się przy pierwszym wejściu do edytora i pierwszym wyborze narzędzia",
    "S'affichent à la première entrée dans un éditeur et au premier choix d'un outil",
  ],
  hintsOff: [
    "Выключены во всём приложении — «Пропустить» в любой подсказке выключает их везде",
    "Вимкнено в усьому застосунку — «Пропустити» в будь-якій підказці вимикає їх усі",
    "Off everywhere in the app — “Skip” in any hint turns them all off",
    "Überall in der App aus — „Überspringen“ in einem Hinweis schaltet alle aus",
    "Wyłączone w całej aplikacji — „Pomiń” w dowolnej podpowiedzi wyłącza wszystkie",
    "Désactivées dans toute l'application — «\u00a0Passer\u00a0» dans une astuce les désactive toutes",
  ],
  startupAndWindow: [
    "Запуск и окно",
    "Запуск і вікно",
    "Startup and window",
    "Start und Fenster",
    "Uruchamianie i okno",
    "Démarrage et fenêtre",
  ],
  gameFound: [
    "Игра найдена",
    "Гру знайдено",
    "Game found",
    "Spiel gefunden",
    "Gra znaleziona",
    "Jeu trouvé",
  ],
  pickFolder: [
    "Указать папку",
    "Вказати теку",
    "Choose folder",
    "Ordner wählen",
    "Wskaż folder",
    "Choisir le dossier",
  ],
  spaceUsed: ["занято", "зайнято", "used", "belegt", "zajęte", "utilisé"],
  diskFree: [
    "Диск {0} · свободно {1}",
    "Диск {0} · вільно {1}",
    "Drive {0} · {1} free",
    "Laufwerk {0} · {1} frei",
    "Dysk {0} · wolne {1}",
    "Disque {0} · {1} libres",
  ],
  freeOnly: [
    "Свободно {0}",
    "Вільно {0}",
    "{0} free",
    "{0} frei",
    "Wolne {0}",
    "{0} libres",
  ],
  clearCache: [
    "Очистить кэш",
    "Очистити кеш",
    "Clear cache",
    "Cache leeren",
    "Wyczyść pamięć podręczną",
    "Vider le cache",
  ],
};
const wordsBySlot = new Map();

// Слова одного языка; незнакомый язык читается как английский.
function wordsFor(language) {
  const found = LANGS.indexOf(language);
  const slot = found < 0 ? LANGS.indexOf("en") : found;
  if (!wordsBySlot.has(slot)) {
    const entries = Object.entries(WORDS).map(([key, sixWays]) => [
      key,
      sixWays[slot],
    ]);
    wordsBySlot.set(slot, Object.fromEntries(entries));
  }
  return wordsBySlot.get(slot);
}

const PATH_WIDTH = 34;

// Страницы запуска берутся из навигации: только допустимые и в её порядке.
function pagesFor(language) {
  const options = [];
  for (const [value, label] of desktopNavigationItems(language)) {
    if (START_PAGES.includes(value)) options.push({ value, label });
  }
  return options;
}

// Состояние игры для плитки: код состояния и строка статуса.
function readGame(game, t) {
  const labels = {
    ready: t.gameReady,
    "needs-loader": t.gameNoLoader,
    "launcher-busy": t.gameBusy,
    missing: t.gameMissing,
  };
  const asked = !game ? "missing" : game.installReadiness || "needs-loader";
  const known = Boolean(labels[asked]);
  const state = known ? asked : "needs-loader";
  const build = game?.buildId ? t.build + " " + game.buildId : "";
  const status = [labels[state], game?.store, build]
    .filter((part) => part)
    .join(" · ");
  return { state, status, label: labels[state] };
}

const patchOf = (key, value) => ({ [key]: value });

// Запись настройки приложения: ждём ответ главного процесса и только после него даём отмену.
async function writePreference(ctx, key, value) {
  const { app, setAppPreference, onSaved } = ctx;
  if (!app) return;
  const prior = app[key];
  if (prior === value) return;
  let refused = false;
  try {
    await setAppPreference(patchOf(key, value));
  } catch {
    refused = true;
  }
  if (!refused) onSaved(() => setAppPreference(patchOf(key, prior)));
}

const openCacheFolder = async () => {
  try {
    const host = desktopHost();
    await host?.openCacheDirectory?.();
  } catch {
    // Папку не открыли — сказать об этом нечем, поэтому молчим.
  }
};

// Ответ приложения о занятом месте обычно приходит сверху (`useStorageStatus` в `settings-live.jsx`): его же читает левое меню.
// Панель, поставленная отдельно, спрашивает сама.

/*
 * Обложка карточки игры (владелец, 16.11.2026: «вернуть солнышко красивенькое с небом, тот город», на макетах — рассвет над городом): настоящий кадр мода «Dawn Sky» из каталога; пока
 * каталог не пришёл или такого мода в нём нет — тот же кадр из поставки (`/media/showcase/sky-dawn.webp`, обложка этого мода). Прежде здесь стоял кадр баннера Главной, и карточка
 * менялась вместе с ним: то рассвет, то синяя снайперка. Откуда кадр, сказано в подсказке (`title`), подписи поверх него нет.
 */
const DAWN_COVER = { src: "/media/showcase/sky-dawn.webp", name: "Dawn Sky" };
const isDawnSky = (mod) =>
  /^dawn sky\b/i.test(String(mod?.title || mod?.name || "").trim());

function gameCover(mods) {
  const dawn = (mods || []).find(isDawnSky);
  const src = dawn?.resolvedCover || dawn?.cover || dawn?.image || "";
  return src ? { src, name: dawn.title || dawn.name || DAWN_COVER.name } : DAWN_COVER;
}

const iconRow = ({ name, icon: Glyph, copy, control }) => (
  <div className="settings-row" data-setting={name} key={name}>
    <span className="settings-row-icon" aria-hidden="true">
      <Glyph />
    </span>
    {copy}
    {control}
  </div>
);

const copyBlock = (heading, hint) => (
  <span className="settings-row-copy">
    {heading}
    <small>{hint}</small>
  </span>
);
const plainCopy = (title, hint) => copyBlock(<b>{title}</b>, hint);
const controlBox = (...items) =>
  createElement("span", { className: "settings-row-control" }, ...items);
const resetButton = (label, onClick) => (
  <button type="button" className="settings-item-reset" onClick={onClick}>
    {label}
  </button>
);
const segments = (props) => <SegmentedControl {...props} />;
const fill = (template, ...values) =>
  template.replace(/\{(\d+)\}/g, (_, at) => values[Number(at)] ?? "");

/* Занятое место ещё не пришло, но спросить есть у кого (мост окна есть): на месте цифр стоят серые плиты, а не «неизвестно».
   Нет моста (страница открыта вне приложения) — прежнее «Размер покажет приложение»: ждать там нечего. */
const storageComing = (storage) =>
  storage == null && desktopHost()?.getStorageStatus != null;

const SumLabel = ({ children }) => (
  <span className="settings-sum-label" data-audit-ignore="caps">
    {children}
  </span>
);

function GameCard({ game, mods, onChooseGame, onOpen, t }) {
  const { state, label } = readGame(game, t);
  const cover = useMemo(() => gameCover(mods), [mods]);
  const ready = state === "ready";
  const tone = ready ? "pos" : state === "missing" ? "bad" : "warn";
  const pill = game
    ? [t.gameFound, game.store].filter(Boolean).join(" · ")
    : t.notFound;
  const figure = game ? game.edition || "" : "";
  const Mark = ready ? Icons.Check : Icons.Warning;
  const open = game ? (
    <Button
      size="sm"
      className="settings-sum-open"
      onClick={() => onOpen("game")}
    >
      {t.open}
      <Icons.CaretRight aria-hidden="true" />
    </Button>
  ) : (
    <Button
      size="sm"
      className="settings-sum-open"
      onClick={() => onChooseGame?.()}
    >
      {t.pickFolder}
    </Button>
  );

  return (
    <div
      className="settings-sum settings-sum-game"
      data-state={state}
      title={cover?.name ? trFill("Кадр из мода «{0}»", cover.name) : undefined}
    >
      {cover ? (
        <img
          className="settings-sum-bg"
          src={cover.src}
          alt=""
          draggable="false"
        />
      ) : null}
      <div className="settings-sum-in">
        <span className="settings-sum-pill">
          <i className={`is-${tone}`} aria-hidden="true" />
          {pill}
        </span>
        <b className="settings-sum-title" data-audit-ignore="type-scale">
          GTA V{figure ? ` ${figure}` : ""}
          {game?.buildId ? <small>{t.build + " " + game.buildId}</small> : null}
        </b>
        {game?.path ? (
          <code className="settings-sum-path" title={game.path}>
            {middlePath(game.path, PATH_WIDTH)}
          </code>
        ) : null}
        <div className="settings-sum-foot">
          <span className={`settings-sum-stat is-${tone}`}>
            <i aria-hidden="true">
              <Mark />
            </i>
            {label}
          </span>
          {open}
        </div>
      </div>
    </div>
  );
}

function SpaceCard({ t, language, storage, onOpen }) {
  const labels = {
    mods: t.legendMods,
    cache: t.legendCache,
    backups: t.legendBackups,
    other: t.legendOther,
  };
  const coming = storageComing(storage);
  const parts = storage ? storageParts(storage, labels) : [];
  let total = 0;
  for (const part of parts) total += part.bytes;
  const scale = Math.max(1, total);
  const drive = driveOf(storage?.cachePath);
  const free =
    typeof storage?.diskFreeBytes === "number"
      ? formatBytes(storage.diskFreeBytes, language)
      : "";
  const disk = free
    ? drive
      ? fill(t.diskFree, drive.replace(":", ""), free)
      : fill(t.freeOnly, free)
    : "";

  return (
    <div className="settings-sum settings-sum-space" data-setting="usage">
      <SumLabel>{t.space}</SumLabel>
      {storage || coming ? (
        <>
          <b className="settings-sum-big" data-audit-ignore="type-scale">
            {storage ? formatBytes(total, language) : <Skeleton />}
            <small>{t.spaceUsed}</small>
          </b>
          <span className="storage-usage-meter" aria-hidden="true">
            {parts.map((part) => (
              <i
                key={part.id}
                className={`is-${part.id}`}
                style={{
                  width: part.bytes
                    ? `max(3px, ${(part.bytes / scale) * 100}%)`
                    : "0px",
                }}
              />
            ))}
          </span>
          <ul className="storage-legend">
            {(storage
              ? parts
              : Object.entries(labels).map(([id, label]) => ({ id, label }))
            ).map((part) => (
              <li key={part.id}>
                <i className={`is-${part.id}`} aria-hidden="true" />
                <span>{part.label}</span>
                {storage ? (
                  <b>{formatBytes(part.bytes, language)}</b>
                ) : (
                  <Skeleton className="settings-skel-value" />
                )}
              </li>
            ))}
          </ul>
          <div className="settings-sum-foot">
            <span className="settings-sum-note">
              {storage ? disk : <Skeleton line className="settings-skel-note" />}
            </span>
            <Button
              size="sm"
              className="settings-sum-open"
              onClick={() => onOpen("storage", "clear")}
            >
              {t.clearCache}
            </Button>
          </div>
        </>
      ) : (
        <small className="settings-tile-empty">{t.spaceUnknown}</small>
      )}
    </div>
  );
}

// Название платформы в подписи версии — как в «О программе».
const PLATFORM_NAMES = { win32: "Windows", darwin: "macOS", linux: "Linux" };

// Что показать под версией: найденное обновление, ход скачивания, готовность или ошибка; в покое — ничего.
function UpdateBox({ language, onOpen }) {
  const { state, loaded } = useUpdates();
  if (!loaded) return null;
  const copy = updatesCopyFor(language);
  const status = statusOf(state, copy, language);
  const { mode } = status;
  const shown = ["available", "downloading", "ready", "error"];
  if (!shown.includes(mode)) return null;
  const view = describeUpdate(state);
  const facts = view.facts;
  const run = (call) => () => {
    updateActions[call]();
  };
  const buttons = {
    available: [
      <Button
        key="get"
        size="sm"
        variant="primary"
        icon={<Icons.DownloadSimple />}
        onClick={run("download")}
      >
        {copy.actions.download}
      </Button>,
      <Button key="notes" size="sm" onClick={() => onOpen("about", "updates")}>
        {copy.actions.whatsNew}
      </Button>,
    ],
    ready: [
      <Button
        key="apply"
        size="sm"
        variant="primary"
        icon={<Icons.ArrowsClockwise />}
        onClick={run("apply")}
      >
        {copy.actions.restart}
      </Button>,
    ],
    error: [
      <Button
        key="retry"
        size="sm"
        icon={<Icons.ArrowClockwise />}
        onClick={run("retry")}
      >
        {copy.actions.retry}
      </Button>,
    ],
    downloading: [],
  }[mode];

  return (
    <div
      className={`settings-sum-update is-${mode}`}
      data-setting="overview-update"
      role="status"
    >
      <b>{status.title}</b>
      {status.sub ? <small>{status.sub}</small> : null}
      {mode === "downloading" ? (
        <UpdateBar
          percent={
            (facts?.stage === "verify"
              ? facts.verifyPercent
              : facts?.percent) ?? 0
          }
          label={status.title}
        />
      ) : null}
      {buttons.length > 0 ? (
        <span className="settings-sum-update-actions">{buttons}</span>
      ) : null}
    </div>
  );
}

function VersionCard({ t, language, general, onOpen }) {
  const release = updates.useInstalledRelease();
  const info = general.info;
  const platform = PLATFORM_NAMES[info?.platform];
  let body;

  if (release) {
    const detail = [updates.releaseDetail(release, language), platform]
      .filter(Boolean)
      .join(" · ");
    body = [
      <b className="settings-sum-version" key="v" title={release.version}>
        {`Astral ${release.version}`}
      </b>,
      <small className="settings-sum-sub" key="d">
        {detail}
      </small>,
    ];
  } else if (release === undefined) {
    /* Версия ещё едет: серые плиты точно под число и подпись, чтобы карточка не прыгала. */
    body = [
      <Skeleton key="v" className="settings-skel-version" />,
      <Skeleton key="d" line className="settings-skel-sub" />,
    ];
  } else if (info?.version && info.packaged) {
    body = [
      <b className="settings-sum-version" key="v">
        {`Astral ${info.version}`}
      </b>,
      <small className="settings-sum-sub" key="d">
        {[t.packaged, platform].filter(Boolean).join(" · ")}
      </small>,
    ];
  } else if (info?.version) {
    body = [
      <small className="settings-tile-empty" key="d">
        {updates.developmentVersionLabel(language)}
      </small>,
    ];
  } else {
    body = [
      <small className="settings-tile-empty" key="d">
        {t.versionUnknown}
      </small>,
    ];
  }

  return (
    <div
      className="settings-sum settings-sum-version-card"
      data-setting="version-card"
      aria-busy={release === undefined ? "true" : "false"}
    >
      <SumLabel>{t.version}</SumLabel>
      {body}
      <UpdateBox language={language} onOpen={onOpen} />
    </div>
  );
}

function StartupGroup(view) {
  const { t, language, general } = view;
  const { saveApp, onSaved } = view;
  const { app, startPage, setStartPage } = general;
  // startPage в замыкании — значение до выбора, его и возвращает отмена.
  const choosePage = (next) => {
    if (next === startPage) return;
    setStartPage(next);
    onSaved(() => setStartPage(startPage));
  };
  const chooseClose = (value) => saveApp("closeToTray", value === "tray");
  const gpuPending = app && app.powerfulGpu !== app.powerfulGpuActive;
  const cachePath = view.storage?.cachePath;
  const pathComing = !cachePath && storageComing(view.storage);
  const hintsOn = hintStore.useHintsEnabled();
  const toggleHints = (next) => {
    if (next) hintStore.enableHints();
    else hintStore.disableHints();
    onSaved(() =>
      next ? hintStore.disableHints() : hintStore.enableHints({ fresh: false }),
    );
  };

  const rows = [
    {
      name: "login",
      icon: Icons.Power,
      copy: plainCopy(
        t.loginTitle,
        app?.openAtLoginSupported ? t.loginHint : t.loginNo,
      ),
      control: (
        <Switch
          checked={Boolean(app?.openAtLogin)}
          disabled={!app?.openAtLoginSupported}
          label={t.loginTitle}
          onChange={(next) => saveApp("openAtLogin", next)}
        />
      ),
    },
    {
      name: "start-page",
      icon: Icons.House,
      copy: plainCopy(t.startPageTitle, t.startPageHint),
      control: controlBox(
        startPage !== DEFAULT_START_PAGE
          ? resetButton(t.reset, () => choosePage(DEFAULT_START_PAGE))
          : null,
        <Select
          ariaLabel={t.startPageTitle}
          value={startPage}
          options={pagesFor(language)}
          onChange={choosePage}
        />,
      ),
    },
    {
      name: "close",
      icon: Icons.X,
      copy: plainCopy(
        t.closeTitle,
        app?.closeToTraySupported ? t.closeHint : t.closeNo,
      ),
      control: controlBox(
        app?.closeToTray
          ? resetButton(t.reset, () => chooseClose("quit"))
          : null,
        segments({
          label: t.closeTitle,
          disabled: !app?.closeToTraySupported,
          options: [
            { value: "tray", label: t.trayOption },
            { value: "quit", label: t.quitOption },
          ],
          value: app?.closeToTray ? "tray" : "quit",
          onChange: chooseClose,
        }),
      ),
    },
    {
      name: "ask-close",
      icon: Icons.DownloadSimple,
      copy: plainCopy(t.askCloseTitle, t.askCloseHint),
      control: (
        <Switch
          checked={app?.askBeforeClose !== false}
          disabled={!app}
          label={t.askCloseTitle}
          onChange={(next) => saveApp("askBeforeClose", next)}
        />
      ),
    },
    {
      name: "gpu",
      icon: Icons.Cpu,
      copy: plainCopy(t.gpuTitle, gpuPending ? t.gpuRestart : t.gpuHint),
      control: controlBox(
        segments({
          label: t.gpuTitle,
          disabled: !app,
          options: [
            { value: "powerful", label: t.powerfulOption },
            { value: "economy", label: t.economyOption },
          ],
          value: app?.powerfulGpu === false ? "economy" : "powerful",
          onChange: (value) => saveApp("powerfulGpu", value === "powerful"),
        }),
      ),
    },
    {
      name: "folder",
      icon: Icons.FolderOpen,
      copy: copyBlock(
        cachePath ? (
          <code className="settings-path" title={cachePath}>
            {middlePath(cachePath, PATH_WIDTH)}
          </code>
        ) : pathComing ? (
          <Skeleton className="settings-skel-path" />
        ) : (
          <b>{t.folder}</b>
        ),
        cachePath || pathComing ? t.folderHint : t.folderUnknown,
      ),
      control: controlBox(
        cachePath || pathComing ? (
          <Button size="sm" onClick={openCacheFolder} disabled={pathComing}>
            {t.open}
          </Button>
        ) : null,
        <Button size="sm" onClick={() => view.onOpen("storage", "folder")}>
          {t.change}
        </Button>,
      ),
    },
    {
      name: "hints",
      icon: Icons.Sparkle,
      copy: plainCopy(t.hintsTitle, hintsOn ? t.hintsHint : t.hintsOff),
      control: (
        <Switch checked={hintsOn} label={t.hintsTitle} onChange={toggleHints} />
      ),
    },
  ];

  return (
    <section className="settings-group" data-setting="startup">
      <span className="settings-group-title" data-audit-ignore="caps">
        {t.startupAndWindow}
      </span>
      <div className="settings-card settings-card-cols">{rows.map(iconRow)}</div>
    </section>
  );
}

export default function GeneralPanel(props) {
  useTr();
  const t = wordsFor(props.language);
  const { app, setAppPreference } = props.general;
  const saveApp = (key, value) =>
    writePreference(
      { app, setAppPreference, onSaved: props.onSaved },
      key,
      value,
    );
  // Каждая часть берёт из общего вида только то, что ей нужно.
  const own = useStorageStatus(0, props.storage !== undefined);
  const view = {
    ...props,
    t,
    saveApp,
    storage: props.storage !== undefined ? props.storage : own,
  };

  return (
    <article className="settings-general">
      <div className="settings-general-sum" data-setting="overview">
        <GameCard {...view} />
        <SpaceCard {...view} />
        <VersionCard {...view} />
      </div>
      <StartupGroup {...view} />
    </article>
  );
}
