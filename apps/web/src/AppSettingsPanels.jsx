import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { useRememberedState } from "./section-memory.js";
import { CaretRight, Check } from "./components/ui/icons.jsx";
/* The maintenance section keeps only two marks: the one that names the section
   and the one that says a button hands the user over to Windows. The row glyphs
   it used to carry repeated their own labels, so they are gone. */
import { ArrowSquareOut as MaintenanceLeaveIcon } from "./components/ui/icons.jsx";
import LogsPanel from "./components/desktop/settings/LogsPanel.jsx";
import ToolsPanel from "./components/desktop/settings/ToolsPanel.jsx";
import Button from "./components/ui/Button.jsx";
import { ErrorReportingRow } from "./features/app-errors/index.js";
import AboutPanel from "./components/desktop/settings/AboutPanel.jsx";
import GamePanel from "./components/desktop/settings/GamePanel.jsx";
import GeneralPanel from "./components/desktop/settings/GeneralPanel.jsx";
import StoragePanel from "./components/desktop/settings/StoragePanel.jsx";
import RustSwitchesPanel from "./components/desktop/settings/RustSwitchesPanel.jsx";
import SettingsNav from "./components/desktop/settings/SettingsNav.jsx";
import {
  SettingsResults,
  useSettingsSearch,
} from "./components/desktop/settings/settings-search.jsx";
import {
  useNavMeta,
  useStorageStatus,
} from "./components/desktop/settings/settings-live.jsx";
import {
  READY_SECTIONS,
  groupOf,
  settingsText,
} from "./components/desktop/settings/settings-map.js";
import { useTr } from "./locales/ui.js";
import { supportedLanguages } from "./locales/desktop.js";

/* Вкладка «Rockstar Games» (14.11.2026) грузится по требованию: её тексты на шести языках не нужны стартовому куску окна. */
const RockstarPanel = lazy(
  () => import("./components/desktop/settings/RockstarPanel.jsx"),
);

const storageCopy = {
  ru: {
    storageTitle: "Загрузки и хранилище",
    storageText:
      "Повторная установка использует уже проверенный пакет и не скачивает его заново.",
    cacheTitle: "Кэширование скачанных модов",
    clearCache: "Очистить папку кэша",
    clearing: "Очищаем…",
    cleared: "Папка кэша очищена",
    clearFailed: "Не удалось очистить папку кэша",
    desktopOnly: "Очистка доступна в приложении Astral для Windows",
    maintenanceTitle: "Восстановление и удаление",
    uninstallTitle: "Удалить Astral",
    uninstallText:
      "Откроет системное удаление приложения вместе с его компонентами.",
    uninstallOpened: "Открыт системный раздел удаления приложений.",
    uninstallUnavailable: "Удаление доступно в приложении Astral для Windows.",
    uninstallFailed: "Не удалось открыть системные настройки удаления.",
  },
  en: {
    storageTitle: "Downloads and storage",
    storageText:
      "Reinstallations reuse verified packages without downloading them again.",
    cacheTitle: "Cache downloaded mods",
    clearCache: "Clear cache folder",
    clearing: "Clearing…",
    cleared: "Cache folder cleared",
    clearFailed: "Could not clear the cache folder",
    desktopOnly: "Cache cleanup is available in the Astral Windows app",
    maintenanceTitle: "Recovery and removal",
    uninstallTitle: "Uninstall Astral",
    uninstallText: "Open the system uninstaller for Astral and its components.",
    uninstallOpened: "Windows app removal settings are open.",
    uninstallUnavailable: "Uninstall is available in the Astral Windows app.",
    uninstallFailed: "Could not open the system uninstall settings.",
  },
  uk: {
    storageTitle: "Завантаження і сховище",
    storageText: "Повторне встановлення використовує вже перевірені пакети.",
    cacheTitle: "Кешувати завантажені моди",
    clearCache: "Очистити папку кешу",
    clearing: "Очищення…",
    cleared: "Папку кешу очищено",
    clearFailed: "Не вдалося очистити папку кешу",
    desktopOnly: "Очищення доступне в застосунку Astral для Windows",
    maintenanceTitle: "Відновлення і видалення",
    uninstallTitle: "Видалити Astral",
    uninstallText: "Відкриє системне видалення Astral разом із компонентами.",
    uninstallOpened: "Відкрито системні параметри видалення застосунків.",
    uninstallUnavailable: "Видалення доступне в Astral для Windows.",
    uninstallFailed: "Не вдалося відкрити системні параметри видалення.",
    activeInstallation: "Активне встановлення GTA V",
  },
  de: {
    storageTitle: "Downloads und Speicher",
    storageText: "Erneute Installationen verwenden bereits geprüfte Pakete.",
    cacheTitle: "Heruntergeladene Mods zwischenspeichern",
    clearCache: "Cache-Ordner leeren",
    clearing: "Wird geleert…",
    cleared: "Cache-Ordner geleert",
    clearFailed: "Cache-Ordner konnte nicht geleert werden",
    desktopOnly: "Die Cache-Bereinigung ist in Astral für Windows verfügbar",
    maintenanceTitle: "Wiederherstellung und Deinstallation",
    uninstallTitle: "Astral deinstallieren",
    uninstallText:
      "Öffnet die Systemdeinstallation für Astral und seine Komponenten.",
    uninstallOpened:
      "Windows-Einstellungen zur App-Deinstallation wurden geöffnet.",
    uninstallUnavailable:
      "Die Deinstallation ist in Astral für Windows verfügbar.",
    uninstallFailed:
      "Systemeinstellungen zur Deinstallation konnten nicht geöffnet werden.",
    activeInstallation: "Aktive GTA-V-Installation",
  },
  pl: {
    storageTitle: "Pobieranie i pamięć",
    storageText: "Ponowna instalacja używa już zweryfikowanych pakietów.",
    cacheTitle: "Zachowuj pobrane mody w pamięci podręcznej",
    clearCache: "Wyczyść folder pamięci podręcznej",
    clearing: "Czyszczenie…",
    cleared: "Folder pamięci podręcznej został wyczyszczony",
    clearFailed: "Nie udało się wyczyścić folderu pamięci podręcznej",
    desktopOnly: "Czyszczenie jest dostępne w Astral dla Windows",
    maintenanceTitle: "Przywracanie i usuwanie",
    uninstallTitle: "Odinstaluj Astral",
    uninstallText: "Otwiera systemowe usuwanie Astral wraz z komponentami.",
    uninstallOpened: "Otwarto ustawienia usuwania aplikacji Windows.",
    uninstallUnavailable: "Odinstalowanie jest dostępne w Astral dla Windows.",
    uninstallFailed: "Nie udało się otworzyć ustawień odinstalowania.",
    activeInstallation: "Aktywna instalacja GTA V",
  },
  fr: {
    storageTitle: "Téléchargements et stockage",
    storageText:
      "La réinstallation utilise le paquet déjà vérifié, sans le télécharger à nouveau.",
    cacheTitle: "Mettre en cache les mods téléchargés",
    clearCache: "Vider le dossier du cache",
    clearing: "Nettoyage…",
    cleared: "Dossier du cache vidé",
    clearFailed: "Impossible de vider le dossier du cache",
    desktopOnly:
      "Le nettoyage est disponible dans l’application Astral pour Windows",
    maintenanceTitle: "Restauration et désinstallation",
    uninstallTitle: "Désinstaller Astral",
    uninstallText:
      "Ouvre la désinstallation système de l’application et de ses composants.",
    uninstallOpened:
      "La section système de désinstallation des applications est ouverte.",
    uninstallUnavailable:
      "La désinstallation est disponible dans l’application Astral pour Windows.",
    uninstallFailed:
      "Impossible d’ouvrir les paramètres système de désinstallation.",
    activeInstallation: "Installation active de GTA V",
  },
};

storageCopy.ru.activeInstallation = "Активная установка GTA V";
storageCopy.en.activeInstallation = "Active GTA V installation";

function getCopy(language) {
  return storageCopy[language] || storageCopy.en;
}

/* Six names, one choice, made once. A flag says nothing a language name does
   not already say better — English is not Great Britain — so the rows carry the
   name and a greeting written in that language instead of a picture. The chosen
   row is said once, by the surface underneath it: the check mark it used to
   carry as well was the same sentence twice, and it sat a thousand pixels from
   the word it belonged to. */
const languageSwitchNote = {
  ru: "Интерфейс переключается сразу — перезапускать Astral не нужно.",
  uk: "Інтерфейс перемикається одразу — перезапускати Astral не потрібно.",
  en: "The interface switches instantly — no need to restart Astral.",
  de: "Die Oberfläche wechselt sofort — Astral muss nicht neu starten.",
  pl: "Interfejs przełącza się od razu — bez ponownego uruchamiania Astral.",
  fr: "L’interface change aussitôt — inutile de redémarrer Astral.",
};

function LanguagePanel({ language, onLanguage }) {
  return (
    <article className="language-settings-card" data-setting="language">
      <div className="settings-card language-choice-list" role="group">
        {supportedLanguages.map((item) => {
          const chosen = language === item.id;
          return (
            <button
              type="button"
              className={`language-choice-row${chosen ? " active" : ""}`}
              aria-pressed={chosen}
              onClick={() => onLanguage(item.id)}
              key={item.id}
            >
              {/* Выбранная строка — белый кружок с галочкой, как в «Пульте»; остальные — пустой круг. */}
              <span className="language-choice-radio" aria-hidden="true">
                {chosen ? <Check /> : null}
              </span>
              <b lang={item.id}>{item.native}</b>
              {/* A sample of the language for the eye; a reader announcing
                  "Русский Привет" would only be reading the row twice. */}
              <small aria-hidden="true" lang={item.id}>
                {item.greeting}
              </small>
            </button>
          );
        })}
      </div>
      <small className="language-choice-note">
        {languageSwitchNote[language] || languageSwitchNote.en}
      </small>
    </article>
  );
}

/* The maintenance section is the one place in Astral where a click can throw
   installed work away, so the words that arm and describe that click live next
   to the panel that shows them. The consequence is carried by the sentence
   under the row name and by the verb on the confirming button — it is never a
   badge pinned to the heading, and it is never said twice. */
const maintenanceCopy = {
  ru: {
    lede: "Возврат игры к состоянию без модов и удаление Astral из Windows.",
    resetConfirm: "Да, удалить все моды",
    cancel: "Отмена",
    openRemoval: "Открыть удаление Windows",
  },
  uk: {
    lede: "Повернення гри до стану без модів і видалення Astral з Windows.",
    resetConfirm: "Так, видалити всі моди",
    cancel: "Скасувати",
    openRemoval: "Відкрити видалення Windows",
  },
  de: {
    lede: "Das Spiel auf den Zustand ohne Mods zurücksetzen und Astral aus Windows entfernen.",
    resetConfirm: "Ja, alle Mods entfernen",
    cancel: "Abbrechen",
    openRemoval: "Windows-Deinstallation öffnen",
  },
  pl: {
    lede: "Przywrócenie gry do stanu bez modów i usunięcie Astral z Windows.",
    resetConfirm: "Tak, usuń wszystkie mody",
    cancel: "Anuluj",
    openRemoval: "Otwórz usuwanie w Windows",
  },
  fr: {
    lede: "Remettre le jeu dans son état sans mods et supprimer Astral de Windows.",
    resetConfirm: "Oui, supprimer tous les mods",
    cancel: "Annuler",
    openRemoval: "Ouvrir la désinstallation de Windows",
  },
  en: {
    lede: "Return the game to its unmodded state and remove Astral from Windows.",
    resetConfirm: "Yes, remove every mod",
    cancel: "Cancel",
    openRemoval: "Open Windows removal",
  },
};

/* «Поддержка › Диагностика»: отчёты об ошибках и удаление Astral из Windows.
   «Вернуть GTA V без модов» с Т-160 стоит в опасной зоне раздела GTA V — там,
   где речь о самой игре. */
function MaintenancePanel({ labels, language }) {
  const copy = maintenanceCopy[language] || maintenanceCopy.en;
  const [notice, setNotice] = useState("");

  async function openApplicationRemoval() {
    setNotice("");
    try {
      if (!window.modovik?.openAppsSettings) {
        setNotice(labels.uninstallUnavailable);
        return;
      }
      await window.modovik.openAppsSettings();
      setNotice(labels.uninstallOpened);
    } catch {
      setNotice(labels.uninstallFailed);
    }
  }

  return (
    <article className="settings-maintenance">
      <section className="settings-card">
        <ErrorReportingRow language={language} />
        {/* Уход из продукта весит не как потеря установленного: кнопка лишь
            открывает удаление программ Windows, поэтому она нейтральная и
            так и говорит. */}
        <div className="settings-row" data-setting="uninstall">
          <span className="settings-row-copy">
            <b>{labels.uninstallTitle}</b>
            <small>{labels.uninstallText}</small>
            {notice && (
              <em className="settings-row-note" role="status">
                {notice}
              </em>
            )}
          </span>
          <Button
            size="sm"
            className="maintenance-exit"
            icon={<MaintenanceLeaveIcon />}
            onClick={openApplicationRemoval}
          >
            {copy.openRemoval}
          </Button>
        </div>
      </section>
      {/* Только в альфа-канале: панель сама не рисуется вне альфы. */}
      <RustSwitchesPanel />
    </article>
  );
}

export default function AppSettingsPanels({
  appearance,
  changed = {},
  copy,
  game,
  games,
  general = null,
  language,
  mods = [],
  onChooseGame,
  onLanguage,
  onRefreshGames,
  onReset,
  onOpenDownloads = undefined,
  onOpenProfile = undefined,
  onSaved = () => {},
  onSelectGame,
  quick = null,
  resetCopy,
  resetItem = undefined,
  restoreMods = null,
  toast = null,
}) {
  useTr();
  const labels = getCopy(language);
  const text = settingsText(language);
  /* Разделы — в левом меню по группам (Т-160), а не семь вкладок в строку.
     Раздел помнится до закрытия окна: человек уходит из «Инструментов» в
     каталог за модом и возвращается доделывать — на «Внешний вид» его при
     этом не выкидывает. Ключ памяти и id разделов — прежние, поэтому и
     раздел, открытый до переделки, открывается на месте. */
  const [remembered, setSection] = useRememberedState(
    "settings:section",
    "general",
  );
  /* «Профиль» — не раздел с панелью, а вход на страницу профиля (владелец, 16.11.2026: «если нажимаю «Профиль», у меня открывается мой профиль… а не такие махинации»):
     запомненный до этого раздел «profile» открывается как «Общее». */
  const section =
    READY_SECTIONS.includes(remembered) && remembered !== "profile"
      ? remembered
      : "general";
  const [query, setQuery] = useState("");
  /* Пункт, к которому подвести после щелчка по найденному. */
  const [target, setTarget] = useState(null);
  const panelRef = useRef(null);
  /* Первое открытие страницы и переход между разделами — разные события.
     Страница собирается по группам, а переход меняет только содержимое
     панели, поэтому ему достаточно короткого проявления. Различает их эта
     отметка: она уходит в разметку, а длительности выбирает лист движения. */
  const switched = useRef(false);
  function openSection(id, item = null) {
    /* Из меню, из поиска и из горячих клавиш: «Профиль» сразу открывает страницу профиля (просмотр и правка в одном месте), без промежуточной панели. */
    if (id === "profile") {
      onOpenProfile?.();
      return;
    }
    setTarget(item ? { item, at: Date.now() } : null);
    if (id === section) return;
    switched.current = true;
    setSection(id);
  }
  /* Из меню и из результатов поиска: раздел открывается, а список результатов уступает ему место. */
  function openFromMenu(id, item = null) {
    if (query) setQuery("");
    openSection(id, item);
  }
  useEffect(() => {
    if (!target) return undefined;
    /* Пункт ленивой вкладки (`rockstar`) появляется, когда догрузится её кусок:
       ищем его несколько раз подряд, а не один раз в момент перехода. */
    let row = null;
    let tries = 0;
    let retry = 0;
    let hide = 0;
    const find = () => {
      row = panelRef.current?.querySelector(`[data-setting="${target.item}"]`);
      if (!row) {
        tries += 1;
        if (tries < 30) retry = window.setTimeout(find, 100);
        return;
      }
      row.scrollIntoView?.({ block: "center", behavior: "smooth" });
      row.classList.add("is-found");
      hide = window.setTimeout(() => row.classList.remove("is-found"), 1600);
    };
    find();
    return () => {
      window.clearTimeout(retry);
      window.clearTimeout(hide);
      row?.classList.remove("is-found");
    };
  }, [target, section]);
  const [title, description] = text.sections[section];
  /* Значения у разделов меню: ответ приложения о месте спрашивается заново, когда человек входит в «Хранилище» и выходит из него (там цифры меняются), а не при каждой смене раздела. */
  const storage = useStorageStatus(section === "storage");
  const meta = useNavMeta({ language, game, storage, info: general?.info, restoreCount: restoreMods?.count ?? 0 });
  const search = useSettingsSearch(query, language, READY_SECTIONS);

  return (
    <div className="settings-shell">
      <SettingsNav
        language={language}
        active={section}
        changed={changed}
        meta={meta}
        query={query}
        search={search}
        onQuery={setQuery}
        onOpen={openFromMenu}
      />
      <div className="settings-section-stage">
        {search.searching ? (
          <SettingsResults
            search={search}
            language={language}
            onOpen={openFromMenu}
            onClear={() => setQuery("")}
          />
        ) : (
          <>
            <header className="settings-section-head">
              <div className="settings-section-head-copy">
                <nav className="settings-crumbs" aria-label={text.crumbs}>
                  <span>{text.groups[groupOf(section)]}</span>
                  <CaretRight aria-hidden="true" />
                  <span aria-current="page">{title}</span>
                </nav>
                <h2>{title}</h2>
                <p data-audit-ignore="type-scale">{description}</p>
              </div>
            </header>
            {/* Ключ по разделу: без него React оставил бы тот же узел, и
            появление содержимого при переходе не проигрывалось бы вовсе. */}
            <div
              className="settings-section-panel"
              id="settings-section-panel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${section}`}
              data-settings-section={section}
              data-settings-entry={switched.current ? "switch" : "first"}
              key={section}
              ref={panelRef}
            >
              {section === "general" && general && (
                <GeneralPanel
                  language={language}
                  game={game}
                  storage={storage}
                  mods={mods}
                  onChooseGame={onChooseGame}
                  onOpen={openSection}
                  onLanguage={onLanguage}
                  general={general}
                  onSaved={onSaved}
                  quick={quick}
                />
              )}
              {section === "appearance" && appearance}
              {section === "language" && (
                <LanguagePanel language={language} onLanguage={onLanguage} />
              )}
              {section === "storage" && (
                <StoragePanel
                  language={language}
                  onNotify={(text) => onSaved(null, text)}
                  onOpenDownloads={onOpenDownloads}
                />
              )}
              {section === "tools" && <ToolsPanel language={language} />}
              {section === "game" && (
                <GamePanel
                  copy={copy}
                  game={game}
                  games={games}
                  language={language}
                  onChooseGame={onChooseGame}
                  onSelectGame={onSelectGame}
                  onReset={onReset}
                  onOpenDownloads={onOpenDownloads}
                  onOpenSection={openSection}
                  resetItem={resetItem}
                  resetCopy={resetCopy}
                  restoreMods={restoreMods}
                />
              )}
              {section === "rockstar" && (
                <Suspense fallback={null}>
                  <RockstarPanel
                    target={game}
                    games={games}
                    language={language}
                    onSelectGame={onSelectGame}
                    onRefreshGames={onRefreshGames}
                    onOpenSection={openSection}
                  />
                </Suspense>
              )}
              {section === "logs" && <LogsPanel language={language} />}
              {section === "about" && (
                <AboutPanel language={language} info={general?.info || null} />
              )}
              {section === "maintenance" && (
                <MaintenancePanel labels={labels} language={language} />
              )}
            </div>
          </>
        )}
      </div>
      {/* Тост — ребёнок рамки настроек, а не прокручиваемого раздела: в прокрутке он уезжал вверх вместе с
          содержимым и вставал у середины страницы (23.10.2026), а так он всегда в правом нижнем углу окна. */}
      {toast}
    </div>
  );
}
