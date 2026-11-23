/*
 * Фразы, оставшиеся на обходе de, en, pl и uk (седьмая партия): фрагменты в смешанных строках
 * («Hinzufügen X в избранное») и категории одежды, которые выводятся без словаря категорий.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneRuns7 = {
  "в избранное": ["в обране", "to favourites", "zu Favoriten", "do ulubionych"],
  "Рюкзаки и сумки": ["Рюкзаки й сумки", "Bags", "Taschen", "Plecaki i torby"],
  "Руки и перчатки": ["Руки й рукавички", "Hands and gloves", "Hände und Handschuhe", "Dłonie i rękawice"],
  /* Сообщения хранилища администратора (packages/admin-store): API отдаёт их в поле error, клиент показывает. */
  "Код должен содержать 4–24 латинских символа или цифры.": ["Код має містити від 4 до 24 латинських літер або цифр.", "The code must contain 4–24 Latin letters or digits.", "Der Code muss 4–24 lateinische Buchstaben oder Ziffern enthalten.", "Kod musi zawierać 4–24 łacińskie litery lub cyfry."],
  "Такой код уже существует.": ["Такий код уже існує.", "Such a code already exists.", "Ein solcher Code existiert bereits.", "Taki kod już istnieje."],
  "Промокод не найден или отключён.": ["Промокод не знайдено або вимкнено.", "Promo code not found or disabled.", "Promocode nicht gefunden oder deaktiviert.", "Kod promocyjny nie został znaleziony lub jest wyłączony."],
  "Лимит активаций промокода исчерпан.": ["Ліміт активацій промокоду вичерпано.", "The promo code's activation limit has been reached.", "Das Aktivierungslimit des Promocodes ist erschöpft.", "Limit aktywacji kodu promocyjnego został wyczerpany."],
  "Заполните тему и подробное описание обращения.": ["Заповніть тему та детальний опис звернення.", "Fill in the subject and a detailed description of the request.", "Füllen Sie das Thema und eine ausführliche Beschreibung der Anfrage aus.", "Uzupełnij temat i szczegółowy opis zgłoszenia."],
  "Тикет не найден.": ["Тікет не знайдено.", "Ticket not found.", "Ticket nicht gefunden.", "Zgłoszenie nie zostało znalezione."],
  "Нет доступа к этому тикету.": ["Немає доступу до цього тікета.", "No access to this ticket.", "Kein Zugriff auf dieses Ticket.", "Brak dostępu do tego zgłoszenia."],
  "Закрытый тикет нельзя продолжить.": ["Закритий тікет не можна продовжити.", "A closed ticket cannot be continued.", "Ein geschlossenes Ticket kann nicht fortgesetzt werden.", "Zamkniętego zgłoszenia nie można kontynuować."],
  "Ответ слишком короткий.": ["Відповідь занадто коротка.", "The reply is too short.", "Die Antwort ist zu kurz.", "Odpowiedź jest zbyt krótka."],
  "Администратор закрыл обращение.": ["Адміністратор закрив звернення.", "The administrator closed the request.", "Der Administrator hat die Anfrage geschlossen.", "Administrator zamknął zgłoszenie."],
  "Пользователь закрыл обращение.": ["Користувач закрив звернення.", "The user closed the request.", "Der Benutzer hat die Anfrage geschlossen.", "Użytkownik zamknął zgłoszenie."],
  "Оценка должна быть целым числом от 1 до 5.": ["Оцінка має бути цілим числом від 1 до 5.", "The rating must be a whole number from 1 to 5.", "Die Bewertung muss eine ganze Zahl von 1 bis 5 sein.", "Ocena musi być liczbą całkowitą od 1 do 5."],
  "Название сборки должно содержать минимум 2 символа.": ["Назва збірки має містити щонайменше 2 символи.", "The build name must contain at least 2 characters.", "Der Name der Zusammenstellung muss mindestens 2 Zeichen enthalten.", "Nazwa zestawu musi mieć co najmniej 2 znaki."],
  "Сборка не найдена.": ["Збірку не знайдено.", "Build not found.", "Zusammenstellung nicht gefunden.", "Nie znaleziono zestawu."],
  "Сборка с таким кодом не найдена.": ["Збірку з таким кодом не знайдено.", "No build with this code was found.", "Keine Zusammenstellung mit diesem Code gefunden.", "Nie znaleziono zestawu o tym kodzie."],
  "Моя большая карта": ["Моя велика карта", "My large map", "Meine große Karte", "Moja duża mapa"],
  "Проект мастерской превышает 500 КБ.": ["Проєкт майстерні перевищує 500 КБ.", "The workshop project exceeds 500 KB.", "Das Werkstattprojekt überschreitet 500 KB.", "Projekt warsztatu przekracza 500 KB."],
  "Некорректный проект мастерской.": ["Некоректний проєкт майстерні.", "Invalid workshop project.", "Ungültiges Werkstattprojekt.", "Nieprawidłowy projekt warsztatu."],
  "В проекте нет поддерживаемой конфигурации мини-карты, прицела или большой карты.": ["У проєкті немає підтримуваної конфігурації міні-карти, прицілу або великої карти.", "The project has no supported configuration for the minimap, crosshair or large map.", "Das Projekt enthält keine unterstützte Konfiguration für Minikarte, Zielfernrohr oder große Karte.", "Projekt nie zawiera obsługiwanej konfiguracji minimapy, celownika ani dużej mapy."],
  "Некорректный код проекта мастерской.": ["Некоректний код проєкту майстерні.", "Invalid workshop project code.", "Ungültiger Code des Werkstattprojekts.", "Nieprawidłowy kod projektu warsztatu."],
  /* Проверка данных API (packages/contracts/src/api.js): подписи полей и сообщения, которые показывает клиент. */
  "Тело запроса": ["Тіло запиту", "Request body", "Anfragekörper", "Treść żądania"],
  "Имя": ["Ім’я", "Name", "Name", "Imię"],
  "Некорректный email.": ["Некоректна адреса email.", "Invalid email address.", "Ungültige E-Mail-Adresse.", "Nieprawidłowy adres e-mail."],
  "Пароль": ["Пароль", "Password", "Passwort", "Hasło"],
  "Промокод": ["Промокод", "Promo code", "Promocode", "Kod promocyjny"],
  "Код сборки": ["Код збірки", "Build code", "Zusammenstellungscode", "Kod zestawu"],
  "Неизвестный тариф.": ["Невідомий тариф.", "Unknown plan.", "Unbekannter Tarif.", "Nieznany plan."],
  "Некорректный период подписки.": ["Некоректний період підписки.", "Invalid subscription period.", "Ungültiger Abozeitraum.", "Nieprawidłowy okres subskrypcji."],
  "Проект с таким кодом не найден.":["Проєкт з таким кодом не знайдено.", "No project with this code was found.", "Kein Projekt mit diesem Code gefunden.", "Nie znaleziono projektu o tym kodzie."],
};
