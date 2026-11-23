import { useEffect } from "react";
import AppSettingsPanels from "../../../AppSettingsPanels.jsx";
import { settingsCopy } from "../../../locales/desktop.js";
import {
  MOTION_OFF,
  MOTION_ON,
  MOTION_SYSTEM,
} from "../../../motion-preference.js";
import Switch from "../../ui/Switch.jsx";
import SettingsToast, { useSettingsToast } from "./SettingsToast.jsx";
import { settingsText } from "./settings-map.js";
import { useGeneralPreferences } from "./useGeneralPreferences.js";
import { tr, useTr } from "../../../locales/ui.js";
import { requestDownloadsPanel } from "../../../features/downloads/open-requests.js";
import AppearanceLook from "../../../features/appearance/AppearanceLook.jsx";
import { isDefaultLook, useLook } from "../../../features/appearance/look.js";

/* Значения «по умолчанию» пунктов оформления: от них считается точка
   «изменено» у раздела и к ним ведёт «Сбросить» у пункта. */
const APPEARANCE_DEFAULTS = Object.freeze({
  motion: MOTION_SYSTEM,
});

/*
 * «Внешний вид» — акцент, знак, фон за окнами и анимации (`features/appearance`).
 *
 * Темы, стекла и двух фонов здесь больше нет (владелец, 24.09.2026): приложение всегда тёмное, а из сцен осталась одна
 * матовая. «Живой космос» и «Декор матовой сцены» с героями убраны 23.10.2026 — чистая поверхность и то, что выбрано
 * во «Внешнем виде». Темы серверов убраны тогда же: акцент выбирают сами.
 */
export default function SettingsPage({
  account = null,
  onBack = null,
  onOpenProfile = null,
  game,
  games,
  onSelectGame,
  onChooseGame,
  onRefreshGames,
  onReset,
  resetItem = undefined,
  restoreMods = null,
  language,
  onLanguage,
  mods = [],
  motionChoice,
  onMotionChoice,
  motionEnabled,
}) {
  useTr();
  const { toast, saved, hide } = useSettingsToast();
  /* Из строки восстановления — в «Загрузки»: окно настроек закрывается. */
  const openDownloads = () => {
    onBack?.();
    requestDownloadsPanel();
  };
  /* Всё применяется сразу, а промах откатывается тостом: обёртка запоминает
     прежнее значение и отдаёт его «Отменить». */
  const undoable = (apply, current) => (next) => {
    if (next === current) return;
    apply(next);
    saved(() => apply(current));
  };
  const setMotion = undoable(onMotionChoice, motionChoice);
  const setLanguage = undoable(onLanguage, language);
  const general = useGeneralPreferences();
  const look = useLook();
  const changed = {
    general: general.changed,
    appearance:
      Number(motionChoice !== APPEARANCE_DEFAULTS.motion) +
      Number(!isDefaultLook(look)),
  };
  const resetLabel = settingsText(language).reset;
  useEffect(() => {
    localStorage.setItem("modovik-safe-install-queue", "1");
    localStorage.setItem("modovik-auto-updates", "1");
    localStorage.setItem("modovik-preflight-check", "1");
  }, []);
  const en = language !== "ru";
  const baseCopy = en
    ? {
        eyebrow: "APPLICATION PREFERENCES",
        title: "Settings",
        location: "GTA V location",
        locationText: "Game folder used by Astral.",
        notFound: "Game not found",
        choose: "Choose GTA V folder",
        change: "Change",
        lang: "Interface language",
        langText: "Language for the app and notifications.",
        langLabel: "Application language",
        instant: "Changes are applied instantly",
        updates: "Updates and startup",
        updatesText: "Background actions and file checks.",
        options: [
          [
            "updates",
            "Automatically update catalog",
            "Receive new mods and compatible versions without restarting",
          ],
          [
            "launch",
            "Check profile before launch",
            "Warn about conflicts and damaged files",
          ],
          [
            "telemetry",
            "Send crash reports",
            "Technical data only, without personal information",
          ],
        ],
        reset: "Clean GTA V state",
        resetText:
          "Remove installed layers and restore original files from the protected backup.",
        resetButton: "Restore GTA V without mods",
        resetHint:
          "The operation starts at 0% in the queue and can be cancelled.",
      }
    : {
        eyebrow: tr("ПАРАМЕТРЫ ПРИЛОЖЕНИЯ"),
        title: tr("Настройки"),
        location: tr("Расположение GTA V"),
        locationText: tr("Папка игры, которую использует Astral."),
        notFound: tr("Игра не найдена"),
        choose: tr("Выберите папку с GTA V"),
        change: tr("Изменить"),
        lang: tr("Язык интерфейса"),
        langText: tr("Язык приложения и уведомлений."),
        langLabel: tr("Язык приложения"),
        instant: tr("Изменение применится сразу"),
        updates: tr("Обновления и запуск"),
        updatesText: tr("Фоновые действия и проверка файлов."),
        options: [
          [
            "updates",
            tr("Автоматически обновлять каталог"),
            tr("Получать новые моды и совместимые версии без перезапуска"),
          ],
          [
            "launch",
            tr("Проверять профиль перед запуском"),
            tr("Предупреждать о конфликтах и повреждённых файлах"),
          ],
          [
            "telemetry",
            tr("Отправлять отчёты об ошибках"),
            tr("Только технические данные без личной информации"),
          ],
        ],
        reset: tr("Чистое состояние GTA V"),
        resetText: tr(
          "Удалить установленные слои и вернуть оригинальные файлы из защищённой копии.",
        ),
        resetButton: tr("Вернуть GTA V без модов"),
        resetHint: tr("Операция появится в очереди с 0% и её можно отменить."),
      };
  const copy = settingsCopy[language] || baseCopy;
  /* Строка называет настройку, а не состояние (ревью тимлида, 04.10):
     «Анимации интерфейса», а что сейчас — в пояснении. С 14.10.2026 Windows
     не решает (владелец): по умолчанию включены, выключает только этот
     тумблер. Про сцены мастерской здесь молчим намеренно — у них своя кнопка
     паузы, и этот выключатель их не касается. */
  const motionCopy = {
    ru: {
      label: tr("Анимации интерфейса"),
      onText: tr("Включены: переходы, появления и движение фона."),
      offText: tr("Выключены: интерфейс меняется сразу, фон стоит."),
    },
    uk: {
      label: tr("Анімації інтерфейсу"),
      /* Ключ словаря — русская строка: украинской записи в нём нет, и перевод берётся из колонки uk этой же. */
      onText: tr("Включены: переходы, появления и движение фона."),
      offText: tr("Вимкнено: інтерфейс змінюється одразу, тло стоїть."),
    },
    de: {
      label: "Oberflächenanimationen",
      onText: "An: Übergänge, Einblendungen und bewegter Hintergrund.",
      offText: "Aus: Die Oberfläche wechselt sofort, der Hintergrund steht.",
    },
    pl: {
      label: "Animacje interfejsu",
      onText: "Włączone: przejścia, pojawianie się i ruch tła.",
      offText: "Wyłączone: interfejs zmienia się od razu, tło stoi.",
    },
    fr: {
      label: "Animations de l'interface",
      onText: "Activées\u00a0: transitions, apparitions et mouvement du fond.",
      offText:
        "Désactivées\u00a0: l'interface change instantanément, le fond reste fixe.",
    },
    en: {
      label: "Interface animation",
      onText: "On: transitions, entrances and the moving background.",
      offText:
        "Off: the interface changes at once, the background stands still.",
    },
  };
  const motionText = motionCopy[language] || motionCopy.en;

  /* Four strings, four different jobs: the row name, the sentence that carries
     the consequence, the button that offers it, and the line that only appears
     once the button has been armed. None of them may repeat another. */
  const resetCopy = {
    ru: [
      tr("Восстановление GTA V"),
      tr("Удалит все установленные моды и вернёт оригинальные файлы игры."),
      tr("Вернуть без модов"),
      tr("Задача встанет в очередь — отменить её можно до начала работы."),
    ],
    uk: [
      tr("Відновлення GTA V"),
      tr("Видалить усі встановлені моди та поверне оригінальні файли гри."),
      tr("Повернути без модів"),
      tr("Задача стане в чергу — скасувати її можна до початку роботи."),
    ],
    de: [
      "GTA V wiederherstellen",
      "Entfernt alle installierten Mods und stellt die Originaldateien des Spiels wieder her.",
      "Ohne Mods wiederherstellen",
      "Die Aufgabe kommt in die Warteschlange und lässt sich vor dem Start abbrechen.",
    ],
    pl: [
      "Przywracanie GTA V",
      "Usunie wszystkie zainstalowane mody i przywróci oryginalne pliki gry.",
      "Przywróć bez modów",
      "Zadanie trafi do kolejki — można je anulować przed rozpoczęciem.",
    ],
    fr: [
      "Restauration de GTA V",
      "Supprime tous les mods installés et restaure les fichiers d'origine du jeu.",
      "Restaurer sans mods",
      "La tâche rejoint la file d'attente — vous pouvez l'annuler avant son démarrage.",
    ],
    en: [
      "Restore GTA V",
      "Removes every installed mod and restores the original game files.",
      "Restore without mods",
      "The task joins the queue — you can cancel it before it starts.",
    ],
  }[language] || [
    "Restore GTA V",
    "Removes every installed mod and restores the original game files.",
    "Restore without mods",
    "The task joins the queue — you can cancel it before it starts.",
  ];
  return (
    <div className="desktop-page settings-page">
      {/* Заголовок страницы — у раздела (крошки и его имя); большой
          «Настройки» над панелью только съедал высоту (ревью тимлида). */}
      <h1 className="settings-page-title" id="settings-page-title">
        {copy.title}
      </h1>
      <section className="desktop-settings clean-settings settings-unified-glass">
        <AppSettingsPanels
          account={account}
          changed={changed}
          general={general}
          onSaved={saved}
          quick={{
            motionEnabled,
            motionSystem: motionChoice === MOTION_SYSTEM,
            setMotion: (next) => setMotion(next ? MOTION_ON : MOTION_OFF),
          }}
          mods={mods}
          toast={
            <SettingsToast toast={toast} language={language} onHide={hide} />
          }
          appearance={
            <article className="appearance-settings settings-appearance">
              {/* Миниатюра Главной, акцент, знак и фон (17.10.2026; 23.10.2026 — без тем серверов и «Космоса»). */}
              <AppearanceLook
                language={language}
                mods={mods}
                resetLabel={resetLabel}
                onSaved={saved}
                aside={
                  <div className="settings-card" data-setting="motion">
                    <div className="settings-row">
                      <span className="settings-row-copy">
                        <b>{motionText.label}</b>
                        <small>
                          {motionEnabled
                            ? motionText.onText
                            : motionText.offText}
                        </small>
                      </span>
                      <span className="settings-row-control">
                        {motionChoice !== MOTION_SYSTEM && (
                          <button
                            type="button"
                            className="settings-item-reset"
                            onClick={() => setMotion(MOTION_SYSTEM)}
                          >
                            {resetLabel}
                          </button>
                        )}
                        <Switch
                          checked={motionEnabled}
                          label={motionText.label}
                          onChange={(next) =>
                            setMotion(next ? MOTION_ON : MOTION_OFF)
                          }
                        />
                      </span>
                    </div>
                  </div>
                }
              />
            </article>
          }
          copy={copy}
          game={game}
          games={games}
          language={language}
          onChooseGame={onChooseGame}
          onRefreshGames={onRefreshGames}
          onLanguage={setLanguage}
          onReset={onReset}
          onOpenDownloads={openDownloads}
          onOpenProfile={onOpenProfile}
          onSelectGame={onSelectGame}
          resetCopy={resetCopy}
          resetItem={resetItem}
          restoreMods={restoreMods}
        />
      </section>
    </div>
  );
}
