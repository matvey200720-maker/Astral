import { useErrorReporting } from "./useErrorReporting.js";
import Switch from "../../components/ui/Switch.jsx";

// Строка настроек «Отправлять отчёты об ошибках» (Т-130, Т-160): согласие хранит главный процесс, окно его
// читает и передаёт новое значение. Слова лежат в компоненте, не в словаре tr() (как у AppErrorBoundary).
// С 14.10.2026 пояснение говорит и о журнале: к отчёту вошедшего человека уходит тот же журнал, что даёт
// «Скачать для тикета». Столбцы идут в порядке LANGS; незнакомый язык — английский.
const LANGS = ["ru", "uk", "en", "de", "pl", "fr"];
const TITLES = [
  "Отправлять отчёты об ошибках",
  "Надсилати звіти про помилки",
  "Send error reports",
  "Fehlerberichte senden",
  "Wysyłaj raporty błędów",
  "Envoyer les rapports d’erreurs",
];
const HINTS = [
  "Тип ошибки, её текст, версия приложения и журнал «Логов» — без имени, почты и путей к вашим файлам.",
  "Тип помилки, її текст, версія застосунку та журнал «Логів» — без імені, пошти та шляхів до ваших файлів.",
  "Error type, message, app version and the Logs journal — without your name, email or file paths.",
  "Fehlerart, Meldung, App-Version und das Protokoll aus „Logs“ — ohne Namen, E-Mail und Pfade zu deinen Dateien.",
  "Rodzaj błędu, jego treść, wersja aplikacji i dziennik z „Logów” — bez imienia, poczty i ścieżek do twoich plików.",
  "Type d’erreur, message, version de l’application et journal de la section «\u00a0Journaux\u00a0» — sans nom, e-mail ni chemins vers vos fichiers.",
];

const ErrorReportingRow = ({ language }) => {
  const reporting = useErrorReporting();
  // В браузере слать отчёты нечем: без моста (и до ответа главного процесса) строки нет вовсе
  if (!reporting.available) return null;
  const found = LANGS.indexOf(language);
  const at = found < 0 ? 2 : found;
  return (
    <div data-setting="reports" className="settings-row maintenance-errors">
      <span className="settings-row-copy">
        <b>{TITLES[at]}</b>
        <small>{HINTS[at]}</small>
      </span>
      <Switch checked={reporting.enabled} label={TITLES[at]} onChange={reporting.setEnabled} />
    </div>
  );
};

export default ErrorReportingRow;
