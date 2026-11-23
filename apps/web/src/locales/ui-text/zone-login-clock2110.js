/*
 * Ошибки входа лаунчера, которые присылает главный процесс (21.10.2026: у
 * владельца часы Windows отставали на три часа, и облако не принимало вход):
 * `apps/desktop/src/desktop-auth.js`, показ — `pages/ProductOnboardingPage.jsx`.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneLoginClock2110 = {
  "Часы компьютера сбиты, и облако Astral не приняло вход. Включите «Устанавливать время автоматически» в настройках Windows и войдите снова.": [
    "Годинник комп'ютера збитий, і хмара Astral не прийняла вхід. Увімкніть «Установлювати час автоматично» в налаштуваннях Windows і увійдіть знову.",
    "Your computer's clock is off, so Astral cloud refused the sign-in. Turn on “Set time automatically” in Windows settings and sign in again.",
    "Die Uhr des Computers geht falsch, deshalb hat die Astral-Cloud die Anmeldung abgelehnt. Aktivieren Sie in den Windows-Einstellungen „Uhrzeit automatisch festlegen“ und melden Sie sich erneut an.",
    "Zegar komputera jest przestawiony, więc chmura Astral nie przyjęła logowania. Włącz „Ustaw czas automatycznie” w ustawieniach Windows i zaloguj się ponownie.",
  ],
  "Облако Astral не приняло вход. Попробуйте войти ещё раз.": [
    "Хмара Astral не прийняла вхід. Спробуйте увійти ще раз.",
    "Astral cloud refused the sign-in. Please try signing in again.",
    "Die Astral-Cloud hat die Anmeldung abgelehnt. Bitte melden Sie sich erneut an.",
    "Chmura Astral nie przyjęła logowania. Spróbuj zalogować się jeszcze raz.",
  ],
  "Нет связи с облаком Astral. Проверьте интернет — Astral повторит сам.": [
    "Немає зв'язку з хмарою Astral. Перевірте інтернет — Astral повторить сам.",
    "No connection to Astral cloud. Check your internet — Astral will retry on its own.",
    "Keine Verbindung zur Astral-Cloud. Prüfen Sie das Internet – Astral versucht es selbst erneut.",
    "Brak połączenia z chmurą Astral. Sprawdź internet — Astral spróbuje ponownie sam.",
  ],
};
