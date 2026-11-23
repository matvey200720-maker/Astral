// apps/desktop/src/beta/messages.js
// Тексты системных окон беты (доступ закрыт/нужен интернет/самоудаление) на шести языках.
// Модуль без побочных действий и без импортов: только данные и чистые функции подстановки.

export const BETA_LANGUAGES = Object.freeze("ru uk en de pl fr".split(" "));

// Таблица «ключ текста → текст на каждом языке», языки в порядке BETA_LANGUAGES.
// Ключи — в порядке, заданном описанием модуля.
const TEXT_TABLE = [
  ["destroyTitle", [
    "Доступ к Astral закрыт",
    "Доступ до Astral закрито",
    "Access to Astral has ended",
    "Der Zugang zu Astral wurde beendet",
    "Dostęp do Astral został zakończony",
    "L’accès à Astral est fermé",
  ]],
  ["destroyRevoked", [
    "Ваш доступ к Astral отозван. Лаунчер удалит свои файлы с этого компьютера. Игра GTA V и ваши моды не затрагиваются.",
    "Ваш доступ до Astral відкликано. Лаунчер видалить свої файли з цього комп’ютера. Гра GTA V і ваші моди не зачіпаються.",
    "Your access to Astral has been revoked. The launcher will remove its own files from this computer. GTA V and your mods are not touched.",
    "Dein Zugang zu Astral wurde widerrufen. Der Launcher entfernt seine eigenen Dateien von diesem Computer. GTA V und deine Mods bleiben unberührt.",
    "Twój dostęp do Astral został cofnięty. Launcher usunie własne pliki z tego komputera. GTA V i Twoje mody pozostaną nietknięte.",
    "Votre accès à Astral a été révoqué. Le launcher supprimera ses fichiers de cet ordinateur. GTA V et vos mods ne sont pas touchés.",
  ]],
  ["destroyCopy", [
    "Эта копия лаунчера не привязана к вашему компьютеру или к вашей учётной записи Windows. Лаунчер удалит свои файлы. Игра GTA V и ваши моды не затрагиваются. Чтобы продолжить, установите Astral заново. Если не получается — напишите в поддержку.",
    "Ця копія лаунчера не прив’язана до вашого комп’ютера або до вашого облікового запису Windows. Лаунчер видалить свої файли. Гра GTA V і ваші моди не зачіпаються. Щоб продовжити, встановіть Astral заново. Якщо не виходить — напишіть у підтримку.",
    "This copy of the launcher is not bound to your computer or your Windows account. The launcher will remove its own files. GTA V and your mods are not touched. To continue, install Astral again. If that does not work, contact support.",
    "Diese Kopie des Launchers ist nicht an deinen Computer oder dein Windows-Konto gebunden. Der Launcher entfernt seine eigenen Dateien. GTA V und deine Mods bleiben unberührt. Um fortzufahren, installiere Astral erneut. Falls das nicht klappt, wende dich an den Support.",
    "Ta kopia launchera nie jest powiązana z Twoim komputerem ani kontem Windows. Launcher usunie własne pliki. GTA V i Twoje mody pozostaną nietknięte. Aby kontynuować, zainstaluj Astral ponownie. Jeśli to nie pomoże, skontaktuj się z pomocą techniczną.",
    "Cette copie du launcher n’est liée ni à votre ordinateur ni à votre compte Windows. Le launcher supprimera ses fichiers. GTA V et vos mods ne sont pas touchés. Pour continuer, réinstallez Astral. Si cela ne fonctionne pas, contactez le support.",
  ]],
  ["destroyBroken", [
    "Файлы доступа к Astral повреждены или изменены. Лаунчер удалит свои файлы. Игра GTA V и ваши моды не затрагиваются. Чтобы продолжить, установите Astral заново. Если не получается — напишите в поддержку.",
    "Файли доступу до Astral пошкоджені або змінені. Лаунчер видалить свої файли. Гра GTA V і ваші моди не зачіпаються. Щоб продовжити, встановіть Astral заново. Якщо не виходить — напишіть у підтримку.",
    "The Astral access files are damaged or have been changed. The launcher will remove its own files. GTA V and your mods are not touched. To continue, install Astral again. If that does not work, contact support.",
    "Die Zugangsdateien von Astral sind beschädigt oder wurden verändert. Der Launcher entfernt seine eigenen Dateien. GTA V und deine Mods bleiben unberührt. Um fortzufahren, installiere Astral erneut. Falls das nicht klappt, wende dich an den Support.",
    "Pliki dostępu do Astral są uszkodzone lub zostały zmienione. Launcher usunie własne pliki. GTA V i Twoje mody pozostaną nietknięte. Aby kontynuować, zainstaluj Astral ponownie. Jeśli to nie pomoże, skontaktuj się z pomocą techniczną.",
    "Les fichiers d’accès à Astral sont endommagés ou ont été modifiés. Le launcher supprimera ses fichiers. GTA V et vos mods ne sont pas touchés. Pour continuer, réinstallez Astral. Si cela ne fonctionne pas, contactez le support.",
  ]],
  ["destroyShared", [
    "Доступ к Astral отозван: аккаунт одновременно работал на двух компьютерах. Доступ личный. Лаунчер удалит свои файлы с этого компьютера; GTA V и моды не трогаются. Если это ошибка — напишите в поддержку Astral в Discord.",
    "Доступ до Astral відкликано: акаунт одночасно працював на двох комп’ютерах. Доступ особистий. Лаунчер видалить свої файли з цього комп’ютера; GTA V і моди не зачіпаються. Якщо це помилка — напишіть у підтримку Astral у Discord.",
    "Access to Astral revoked: this account was running on two computers at the same time. Access is personal. The launcher will remove its own files from this computer; GTA V and your mods are not touched. If this is a mistake, contact Astral support on Discord.",
    "Zugang zu Astral widerrufen: Dein Konto lief gleichzeitig auf zwei Computern. Der Zugang ist persönlich. Der Launcher entfernt seine eigenen Dateien von diesem Computer; GTA V und deine Mods bleiben unberührt. Falls das ein Irrtum ist, wende dich auf Discord an den Astral-Support.",
    "Dostęp do Astral cofnięty: konto działało jednocześnie na dwóch komputerach. Dostęp jest osobisty. Launcher usunie własne pliki z tego komputera; GTA V i Twoje mody pozostaną nietknięte. Jeśli to pomyłka, napisz do pomocy technicznej Astral na Discordzie.",
    "Accès à Astral révoqué\u00A0: le compte fonctionnait en même temps sur deux ordinateurs. L’accès est personnel. Le launcher supprimera ses fichiers de cet ordinateur\u00A0; GTA V et les mods ne sont pas touchés. S’il s’agit d’une erreur, contactez le support Astral sur Discord.",
  ]],
  ["replacedTitle", [
    "Установка Astral заменена новой",
    "Встановлення Astral замінено новим",
    "This Astral installation was replaced",
    "Diese Astral-Installation wurde ersetzt",
    "Ta instalacja Astral została zastąpiona",
    "L’installation d’Astral a été remplacée",
  ]],
  ["destroyReplaced", [
    "Ваш доступ перенесён на новую установку — на этом или на другом компьютере. Эта копия лаунчера больше не действует и удалит свои файлы с этого компьютера; GTA V и моды не трогаются. Если новую установку ставили не вы — напишите в поддержку Astral в Discord.",
    "Ваш доступ перенесено на нове встановлення — на цьому або на іншому комп’ютері. Ця копія лаунчера більше не діє й видалить свої файли з цього комп’ютера; GTA V і моди не зачіпаються. Якщо нове встановлення ставили не ви — напишіть у підтримку Astral у Discord.",
    "Your access has moved to a newer installation, on this or another computer. This copy of the launcher is no longer valid and will remove its own files from this computer; GTA V and your mods are not touched. If you did not make that installation, contact Astral support on Discord.",
    "Dein Zugang wurde auf eine neuere Installation übertragen – auf diesem oder einem anderen Computer. Diese Kopie des Launchers ist nicht mehr gültig und entfernt ihre eigenen Dateien von diesem Computer; GTA V und deine Mods bleiben unberührt. Wenn die neue Installation nicht von dir stammt, wende dich auf Discord an den Astral-Support.",
    "Twój dostęp został przeniesiony na nowszą instalację — na tym lub innym komputerze. Ta kopia launchera jest już nieważna i usunie własne pliki z tego komputera; GTA V i Twoje mody pozostaną nietknięte. Jeśli nowa instalacja nie pochodzi od Ciebie, napisz do pomocy technicznej Astral na Discordzie.",
    "Votre accès a été transféré vers une nouvelle installation, sur cet ordinateur ou sur un autre. Cette copie du launcher n’est plus valide et supprimera ses fichiers de cet ordinateur\u00A0; GTA V et les mods ne sont pas touchés. Si vous n’êtes pas à l’origine de la nouvelle installation, contactez le support Astral sur Discord.",
  ]],
  ["reasonLine", [
    "Код причины для поддержки: {code}",
    "Код причини для підтримки: {code}",
    "Reason code for support: {code}",
    "Fehlercode für den Support: {code}",
    "Kod przyczyny dla pomocy technicznej: {code}",
    "Code de motif pour le support\u00A0: {code}",
  ]],
  ["offlineTitle", [
    "Нужен интернет",
    "Потрібен інтернет",
    "Internet connection required",
    "Internetverbindung erforderlich",
    "Wymagane połączenie z internetem",
    "Connexion Internet requise",
  ]],
  ["offlineBody", [
    "{product} должен проверить доступ на сервере, но связи нет. Проверьте подключение к интернету и повторите.",
    "{product} має перевірити доступ на сервері, але зв’язку немає. Перевірте підключення до інтернету й повторіть.",
    "{product} needs to check your access on the server, but there is no connection. Check your internet connection and try again.",
    "{product} muss deinen Zugang auf dem Server prüfen, aber es besteht keine Verbindung. Prüfe deine Internetverbindung und versuche es erneut.",
    "{product} musi sprawdzić Twój dostęp na serwerze, ale nie ma połączenia. Sprawdź połączenie z internetem i spróbuj ponownie.",
    "{product} doit vérifier votre accès sur le serveur, mais il n’y a pas de connexion. Vérifiez votre connexion Internet et réessayez.",
  ]],
  ["retry", [
    "Повторить",
    "Повторити",
    "Retry",
    "Erneut versuchen",
    "Spróbuj ponownie",
    "Réessayer",
  ]],
  ["quit", [
    "Выйти",
    "Вийти",
    "Quit",
    "Beenden",
    "Zamknij",
    "Quitter",
  ]],
  ["ok", [
    "Понятно",
    "Зрозуміло",
    "Got it",
    "Verstanden",
    "Rozumiem",
    "Compris",
  ]],
  ["blockedTitle", [
    "{product} не может запуститься",
    "{product} не може запуститися",
    "{product} cannot start",
    "{product} kann nicht starten",
    "{product} nie może się uruchomić",
    "{product} ne peut pas démarrer",
  ]],
  ["blockedUnknown", [
    "Сервер не нашёл вашу установку. Установите Astral заново или напишите в поддержку.",
    "Сервер не знайшов вашу установку. Встановіть Astral заново або напишіть у підтримку.",
    "The server could not find your installation. Install Astral again or contact support.",
    "Der Server hat deine Installation nicht gefunden. Installiere Astral erneut oder wende dich an den Support.",
    "Serwer nie znalazł Twojej instalacji. Zainstaluj Astral ponownie lub skontaktuj się z pomocą techniczną.",
    "Le serveur n’a pas trouvé votre installation. Réinstallez Astral ou contactez le support.",
  ]],
  ["blockedBindInvalid", [
    "Файл привязки установки повреждён. Запустите установщик {product} заново или напишите в поддержку.",
    "Файл прив’язки установки пошкоджено. Запустіть інсталятор {product} заново або напишіть у підтримку.",
    "The installation binding file is damaged. Run the {product} installer again or contact support.",
    "Die Bindungsdatei der Installation ist beschädigt. Starte den {productCompound}-Installer erneut oder wende dich an den Support.",
    "Plik powiązania instalacji jest uszkodzony. Uruchom instalator {product} ponownie lub skontaktuj się z pomocą techniczną.",
    "Le fichier de liaison de l’installation est endommagé. Relancez l’installateur de {product} ou contactez le support.",
  ]],
  ["blockedBadRequest", [
    "Лаунчер не смог проверить доступ из-за ошибки в самой программе. Обновите {product} установщиком или напишите в поддержку.",
    "Лаунчер не зміг перевірити доступ через помилку в самій програмі. Оновіть {product} інсталятором або напишіть у підтримку.",
    "The launcher could not verify access because of an error in the program itself. Update {product} with the installer or contact support.",
    "Der Launcher konnte den Zugang wegen eines Fehlers im Programm selbst nicht prüfen. Aktualisiere {product} mit dem Installer oder wende dich an den Support.",
    "Launcher nie mógł sprawdzić dostępu z powodu błędu w samym programie. Zaktualizuj {product} instalatorem lub skontaktuj się z pomocą techniczną.",
    "Le launcher n’a pas pu vérifier l’accès à cause d’une erreur dans le programme lui-même. Mettez à jour {product} avec l’installateur ou contactez le support.",
  ]],
  ["blockedPlatform", [
    "{product} работает только в Windows.",
    "{product} працює лише у Windows.",
    "{product} only runs on Windows.",
    "{product} läuft nur unter Windows.",
    "{product} działa tylko w systemie Windows.",
    "{product} ne fonctionne que sous Windows.",
  ]],
  ["blockedLayout", [
    "{product} запущен не из своей папки установки. Установите его заново установщиком {product}.",
    "{product} запущено не зі своєї папки встановлення. Встановіть його заново інсталятором {product}.",
    "{product} was started outside its install folder. Reinstall it with the {product} installer.",
    "{product} wurde außerhalb seines Installationsordners gestartet. Installiere es erneut mit dem {productCompound}-Installer.",
    "{product} został uruchomiony poza własnym folderem instalacji. Zainstaluj go ponownie instalatorem {product}.",
    "{product} a été lancé en dehors de son dossier d’installation. Réinstallez-le avec l’installateur de {product}.",
  ]],
  ["blockedWeb", [
    "Файлы интерфейса повреждены. Запустите установщик {product} заново, чтобы восстановить их.",
    "Файли інтерфейсу пошкоджено. Запустіть інсталятор {product} заново, щоб відновити їх.",
    "The interface files are damaged. Run the {product} installer again to restore them.",
    "Die Oberflächendateien sind beschädigt. Starte den {productCompound}-Installer erneut, um sie wiederherzustellen.",
    "Pliki interfejsu są uszkodzone. Uruchom instalator {product} ponownie, aby je przywrócić.",
    "Les fichiers de l’interface sont endommagés. Relancez l’installateur de {product} pour les restaurer.",
  ]],
  ["blockedDeviceKey", [
    "{product} не нашёл ключ этого компьютера в учётной записи Windows, из которой запущен. Запустите его из той учётной записи, где ставили (если при запуске подтверждали UAC паролем администратора, то с тем же паролем). Если профиль Windows чистили или восстанавливали из копии, установите {product} заново с сайта. Файлы не тронуты.",
    "{product} не знайшов ключ цього комп’ютера в обліковому записі Windows, з якого запущено. Запустіть його з того облікового запису, де встановлювали (якщо під час запуску підтверджували UAC паролем адміністратора, то з тим самим паролем). Якщо профіль Windows чистили або відновлювали з копії, встановіть {product} заново з сайту. Файли не зачеплено.",
    "{product} could not find this computer’s key in the Windows account it was started from. Start it from the Windows account where you installed it (if you confirmed the UAC prompt with an administrator password, use the same password). If your Windows profile was cleaned or restored from a backup, install {product} again from the website. Your files are untouched.",
    "{product} hat den Schlüssel dieses Computers in dem Windows-Konto, aus dem es gestartet wurde, nicht gefunden. Starte es aus dem Windows-Konto, in dem du es installiert hast (falls du die UAC-Abfrage mit einem Administratorkennwort bestätigt hast, mit demselben Kennwort). Wurde dein Windows-Profil bereinigt oder aus einer Sicherung wiederhergestellt, installiere {product} erneut von der Website. Deine Dateien bleiben unberührt.",
    "{product} nie znalazł klucza tego komputera na koncie Windows, z którego został uruchomiony. Uruchom go z konta Windows, na którym go instalowano (jeśli potwierdzano okno UAC hasłem administratora, użyj tego samego hasła). Jeśli profil Windows był czyszczony lub przywracany z kopii, zainstaluj {product} ponownie ze strony. Pliki pozostały nietknięte.",
    "{product} n’a pas trouvé la clé de cet ordinateur dans le compte Windows depuis lequel il a été lancé. Lancez-le depuis le compte Windows où vous l’avez installé (si vous avez confirmé la fenêtre UAC avec un mot de passe administrateur, utilisez le même). Si votre profil Windows a été nettoyé ou restauré depuis une sauvegarde, réinstallez {product} depuis le site. Vos fichiers n’ont pas été touchés.",
  ]],
  ["blockedLicenseMissing", [
    "У {product} нет файла доступа: его могла убрать антивирусная программа или очистка диска. Установите {product} заново с сайта. Игра GTA V и ваши моды не затронуты.",
    "У {product} немає файлу доступу: його могла прибрати антивірусна програма або очищення диска. Встановіть {product} заново з сайту. Гра GTA V і ваші моди не зачеплено.",
    "{product} has no access file: an antivirus program or a disk cleaner may have removed it. Install {product} again from the website. GTA V and your mods are not touched.",
    "Für {product} fehlt die Zugangsdatei: Ein Virenscanner oder ein Aufräumprogramm hat sie möglicherweise entfernt. Installiere {product} erneut von der Website. GTA V und deine Mods bleiben unberührt.",
    "{product} nie ma pliku dostępu: mógł go usunąć program antywirusowy lub czyszczący dysk. Zainstaluj {product} ponownie ze strony. GTA V i Twoje mody pozostaną nietknięte.",
    "Il manque le fichier d’accès de {product} (un antivirus ou un nettoyeur de disque l’a peut-être supprimé). Réinstallez {product} depuis le site. GTA V et vos mods ne sont pas touchés.",
  ]],
  ["blockedBuild", [
    "Сборка {product} собрана неверно: в ней нет ключа проверки лицензий. Скачайте установщик заново или напишите в поддержку.",
    "Збірку {product} зібрано неправильно: у ній немає ключа перевірки ліцензій. Завантажте інсталятор заново або напишіть у підтримку.",
    "This {product} build is broken: it has no license verification key. Download the installer again or contact support.",
    "Dieser {productCompound}-Build ist fehlerhaft: Es fehlt der Schlüssel zur Lizenzprüfung. Lade den Installer erneut herunter oder wende dich an den Support.",
    "Ta wersja {product} jest zbudowana błędnie: brakuje w niej klucza do sprawdzania licencji. Pobierz instalator ponownie lub skontaktuj się z pomocą techniczną.",
    "Ce build de {product} est incorrect\u00A0: il ne contient pas la clé de vérification des licences. Téléchargez de nouveau l’installateur ou contactez le support.",
  ]],
  ["storageUnavailable", [
    "Хранилище ключей Windows сейчас недоступно. Перезагрузите компьютер или войдите в Windows заново и повторите.",
    "Сховище ключів Windows зараз недоступне. Перезавантажте комп’ютер або увійдіть у Windows заново й повторіть.",
    "The Windows key store is unavailable right now. Restart your computer or sign in to Windows again, then retry.",
    "Der Windows-Schlüsselspeicher ist gerade nicht verfügbar. Starte den Computer neu oder melde dich erneut bei Windows an und versuche es dann noch einmal.",
    "Magazyn kluczy Windows jest teraz niedostępny. Uruchom komputer ponownie lub zaloguj się do Windows jeszcze raz i spróbuj ponownie.",
    "Le magasin de clés de Windows est actuellement indisponible. Redémarrez l’ordinateur ou reconnectez-vous à Windows, puis réessayez.",
  ]],
  ["machineUnreadable", [
    "Не удалось прочитать идентификатор компьютера. Повторите; если не помогает — напишите в поддержку.",
    "Не вдалося прочитати ідентифікатор комп’ютера. Повторіть; якщо не допомагає — напишіть у підтримку.",
    "Could not read the computer identifier. Retry; if it does not help, contact support.",
    "Die Computerkennung konnte nicht gelesen werden. Versuche es erneut; hilft das nicht, wende dich an den Support.",
    "Nie udało się odczytać identyfikatora komputera. Spróbuj ponownie; jeśli to nie pomoże, skontaktuj się z pomocą techniczną.",
    "Impossible de lire l’identifiant de l’ordinateur. Réessayez\u00A0; si cela ne suffit pas, contactez le support.",
  ]],
  ["licenseUnreadable", [
    "Не удаётся прочитать файл лицензии (его могла занять антивирусная программа). Повторите через минуту.",
    "Не вдається прочитати файл ліцензії (його могла зайняти антивірусна програма). Повторіть за хвилину.",
    "Cannot read the license file (an antivirus program may be holding it). Try again in a minute.",
    "Die Lizenzdatei kann nicht gelesen werden (möglicherweise hält sie ein Virenscanner fest). Versuche es in einer Minute erneut.",
    "Nie można odczytać pliku licencji (mógł go zająć program antywirusowy). Spróbuj ponownie za minutę.",
    "Impossible de lire le fichier de licence (un antivirus l’utilise peut-être). Réessayez dans une minute.",
  ]],
  ["proofRejected", [
    "Сервер не принял подпись запроса. Проверьте, что дата и время в Windows верны, и повторите.",
    "Сервер не прийняв підпис запиту. Перевірте, що дата й час у Windows правильні, і повторіть.",
    "The server did not accept the request signature. Make sure the date and time in Windows are correct, then retry.",
    "Der Server hat die Anfragesignatur nicht akzeptiert. Prüfe, ob Datum und Uhrzeit in Windows stimmen, und versuche es erneut.",
    "Serwer nie przyjął podpisu żądania. Sprawdź, czy data i godzina w systemie Windows są prawidłowe, i spróbuj ponownie.",
    "Le serveur n’a pas accepté la signature de la requête. Vérifiez que la date et l’heure de Windows sont correctes, puis réessayez.",
  ]],
];

// Таблицы по языкам: столбец строки TEXT_TABLE → объект «ключ → шаблон».
export const BETA_MESSAGES = Object.freeze(
  Object.fromEntries(
    BETA_LANGUAGES.map((lang, column) => [
      lang,
      Object.fromEntries(TEXT_TABLE.map(([key, row]) => [key, row[column]])),
    ])
  )
);

// {имя}: буквы, цифры, подчёркивание.
const SLOT = /\{([A-Za-z0-9_]+)\}/g;

const printable = (value) => (value == null ? "" : String(value));

export function pickBetaLanguage(locale) {
  const raw = locale ? `${locale}` : "";
  let cut = raw.length;
  for (let at = 0; at < raw.length; at += 1) {
    if (raw[at] === "-" || raw[at] === "_") {
      cut = at;
      break;
    }
  }
  const code = raw.slice(0, cut).toLowerCase();
  return BETA_LANGUAGES.find((lang) => lang === code) ?? "en";
}

const tableOf = (language) => BETA_MESSAGES[BETA_LANGUAGES.includes(language) ? language : "en"];

export function betaText(language, key, params = {}) {
  // Свой язык → английский → сам ключ; «найденным» считается любое не-null значение.
  const template = [tableOf(language)[key], BETA_MESSAGES.en[key], key].find((item) => item != null);
  return template.replace(SLOT, (_whole, slot) => printable(params[slot]));
}

// Причина самоудаления → ключ текста сообщения.
const REASON_MESSAGE_KEY = {
  server_revoked: "destroyRevoked",
  server_account_shared: "destroyShared",
  server_replaced: "destroyReplaced",
  server_device_mismatch: "destroyCopy",
  server_machine_mismatch: "destroyCopy",
  server_bind_conflict: "destroyCopy",
  machine_mismatch: "destroyCopy",
  license_invalid: "destroyBroken",
};

const joinCode = (reason, serial) => {
  if (!serial) return reason == null ? "" : String(reason);
  return [String(reason), String(serial)].join(" · ");
};

// «Код причины для поддержки»: причина, после точки serial установки (его же показывают окна самоудаления).
export const supportCode = joinCode;

export const destroyDialogText = (language, reason, serial = "") => {
  const titleKey = reason === "server_replaced" ? "replacedTitle" : "destroyTitle";
  const messageKey = REASON_MESSAGE_KEY[reason] ?? "destroyBroken";
  return {
    title: betaText(language, titleKey),
    message: betaText(language, messageKey),
    detail: betaText(language, "reasonLine", { code: joinCode(reason, serial) }),
    ok: betaText(language, "ok"),
  };
};
