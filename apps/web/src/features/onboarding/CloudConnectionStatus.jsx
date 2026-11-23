import { ArrowClockwise, CloudSlash } from "../../components/ui/icons.jsx";
import Button from "../../components/ui/Button.jsx";

/*
 * Строка связи в заголовке окна.
 *
 * Молчит, пока всё доехало. Когда облако не ответило, говорит одно: чего не
 * хватает, что окно работает с тем, что есть на компьютере, и что
 * переподключение идёт само. Обратного отсчёта нет намеренно: он будил бы
 * окно раз в секунду всё время, пока нет сети, — ровно тогда, когда ноутбук
 * чаще всего на батарее.
 */
const COPY = {
  ru: {
    session: "Нет связи с Astral — вход сохранён",
    library: "Избранное и сборки не загрузились",
    catalog: "Каталог не загрузился",
    waiting: "Переподключимся сами",
    trying: "Подключаемся…",
    retry: "Повторить",
  },
  uk: {
    session: "Немає зв’язку з Astral — вхід збережено",
    library: "Обране та збірки не завантажилися",
    catalog: "Каталог не завантажився",
    waiting: "Перепідключимося самі",
    trying: "Підключаємося…",
    retry: "Повторити",
  },
  en: {
    session: "Astral is offline — you're still signed in",
    library: "Favorites and builds didn't load",
    catalog: "The catalog didn't load",
    waiting: "Reconnecting automatically",
    trying: "Connecting…",
    retry: "Retry",
  },
  de: {
    session: "Keine Verbindung zu Astral — Anmeldung bleibt",
    library: "Favoriten und Builds nicht geladen",
    catalog: "Katalog nicht geladen",
    waiting: "Verbindet sich automatisch",
    trying: "Verbinde…",
    retry: "Erneut",
  },
  pl: {
    session: "Brak połączenia z Astral — logowanie zachowane",
    library: "Ulubione i zestawy się nie wczytały",
    catalog: "Katalog się nie wczytał",
    waiting: "Połączymy się sami",
    trying: "Łączenie…",
    retry: "Ponów",
  },
  fr: {
    session: "Pas de connexion à Astral — votre session est conservée",
    library: "Favoris et builds non chargés",
    catalog: "Catalogue non chargé",
    waiting: "Reconnexion automatique",
    trying: "Connexion…",
    retry: "Réessayer",
  },
};

/* Главное, чего нет: без сессии остальное — следствие. */
function headline(gap, copy) {
  if (gap.session) return copy.session;
  if (gap.catalog && gap.library) return copy.session;
  if (gap.catalog) return copy.catalog;
  return copy.library;
}

export default function CloudConnectionStatus({ connection, language = "ru" }) {
  const { gap, trying, retry } = connection || {};
  if (!gap) return null;
  const copy = COPY[language] || COPY.ru;
  return (
    <div className="cloud-connection-status" role="status" aria-live="polite">
      <CloudSlash aria-hidden="true" weight="regular" />
      <span className="cloud-connection-copy">
        <span className="cloud-connection-title">{headline(gap, copy)}</span>
        <span className="cloud-connection-hint">
          {trying ? copy.trying : copy.waiting}
        </span>
      </span>
      <Button
        className="cloud-connection-retry"
        variant="ghost"
        size="sm"
        icon={<ArrowClockwise aria-hidden="true" />}
        disabled={trying}
        onClick={() => void retry?.()}
      >
        {copy.retry}
      </Button>
    </div>
  );
}
