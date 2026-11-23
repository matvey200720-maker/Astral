import { Component } from "react";
import * as report from "./report.js";
import Button from "../../components/ui/Button.jsx";
import { WarningCircle } from "../../components/ui/icons.jsx";
import * as stale from "./stale-build.js";
import EmptyState from "../../components/ui/EmptyState.jsx";

// Слова заглушки лежат здесь, а не в словаре tr(): она обязана работать, даже когда словарь языка не
// подгрузился или сам упал. Столбцы идут в порядке LANGS; незнакомый язык — английский.
// Совет называет пункты настроек так же, как меню (задача владельца 18.10.2026).
const LANGS = ["ru", "uk", "en", "de", "pl", "fr"];
const TITLES = [
  "Эта страница не открылась",
  "Ця сторінка не відкрилась",
  "This page could not open",
  "Diese Seite lässt sich nicht öffnen",
  "Ta strona się nie otworzyła",
  "Cette page n’a pas pu s’ouvrir",
];
const ACTIONS = ["Открыть заново", "Відкрити знову", "Open again", "Erneut öffnen", "Otwórz ponownie", "Rouvrir"];
const ADVICE = [
  "Остальное приложение работает. Нажмите «Открыть заново». Не помогло — закройте Astral и откройте снова. Повторяется и после этого — скачайте журнал (Настройки → Логи → «Скачать для тикета») и приложите его к тикету в поддержку Astral.",
  "Решта застосунку працює. Натисніть «Відкрити знову». Не допомогло — закрийте Astral і відкрийте знову. Повторюється й після цього — завантажте журнал (Налаштування → Логи → «Завантажити для тікета») і додайте його до тікета в підтримку Astral.",
  "The rest of the app still works. Press “Open again”. If that does not help, close Astral and open it again. If it keeps happening, download the log (Settings → Logs → “Download for a ticket”) and attach it to a ticket for Astral support.",
  "Der Rest der App funktioniert. Drücke „Erneut öffnen“. Hilft das nicht, schließe Astral und öffne es neu. Passiert es weiter, lade das Protokoll herunter (Einstellungen → Protokolle → „Für ein Ticket herunterladen“) und hänge es an ein Ticket für den Astral-Support.",
  "Reszta aplikacji działa. Naciśnij „Otwórz ponownie”. Jeśli nie pomoże, zamknij Astral i otwórz go ponownie. Jeśli to się powtarza, pobierz dziennik (Ustawienia → Logi → „Pobierz do zgłoszenia”) i dołącz go do zgłoszenia do wsparcia Astral.",
  "Le reste de l’application fonctionne. Cliquez sur «\u00a0Rouvrir\u00a0». Si cela ne suffit pas, fermez Astral et rouvrez-le. Si le problème persiste, téléchargez le journal (Paramètres → Journaux → «\u00a0Télécharger pour un ticket\u00a0») et joignez-le à un ticket auprès du support Astral.",
];

// Контур страниц (Т-130): упавшая страница не должна быть белым экраном. Сбрасывает его только key родителя
// (по странице) или кнопка; свойства page и children состояние не трогают.
export default class AppErrorBoundary extends Component {
  static getDerivedStateFromError(error) {
    return { stale: stale.isStaleBuildError(error) };
  }

  state = { stale: null };

  reopen = () => {
    if (this.state.stale) {
      window.location.reload();
      return;
    }
    this.setState({ stale: null });
  };

  componentDidMount() {
    report.setErrorPage(this.props.page);
  }

  componentDidUpdate({ page: previousPage }) {
    const { page } = this.props;
    if (previousPage !== page) report.setErrorPage(page);
  }

  componentDidCatch(caught, info) {
    const failure = caught instanceof Error ? caught : new Error(String(caught));
    const chain = String(info?.componentStack || "").trim();
    if (chain !== "" && !String(failure.stack).includes(chain)) {
      failure.stack = `${failure.stack}\n${chain}`;
    }
    report.captureRendererError(failure, { kind: failure.name || "Error" });
    if (import.meta.env.PROD && this.state.stale) stale.reloadForFreshBuild();
  }

  render() {
    const { children, language } = this.props;
    if (this.state.stale === null) return children;

    const found = LANGS.indexOf(language);
    const slot = found < 0 ? 2 : found;
    const retryButton = (
      <Button
        className="public-catalog-empty-action"
        onClick={this.reopen}
        variant="secondary"
      >
        {ACTIONS[slot]}
      </Button>
    );

    return (
      <EmptyState
        actions={retryButton}
        className="public-catalog-empty"
        headingLevel={3}
        icon={WarningCircle}
        role="alert"
        text={ADVICE[slot]}
        title={TITLES[slot]}
        tone="error"
      />
    );
  }
}
