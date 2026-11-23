/*
 * Тексты окна установщика Astral, русский язык. Эталон набора ключей и вставок
 * для остальных языков (сверяет tests/installer-ui-i18n.test.js). Склонений
 * нет: числа и единицы читаются при любом значении.
 */
export default Object.freeze({
  "brand.beta": "Beta",

  "window.minimize": "Свернуть",
  "window.close": "Закрыть окно",

  "lang.label": "Язык",

  "common.continue": "Продолжить",
  "common.cancel": "Отмена",
  "common.retry": "Повторить",
  "common.close": "Закрыть",
  "common.copy": "Копировать",
  "common.copied": "Скопировано",
  "common.paste": "Вставить",
  "common.openLogs": "Открыть журнал",
  "common.showDetails": "Показать детали",
  "common.hideDetails": "Скрыть детали",
  "common.installer": "Установщик {version}",
  "frame.badge": "Кадр из игры",
  "frame.name": "Рассвет над городом",
  "common.version": "Версия {version}",

  "steps.label": "Шаги установки",
  "steps.code": "Код",
  "steps.confirm": "Подтверждение",
  "steps.install": "Установка",

  "unit.b": "Б",
  "unit.kb": "КБ",
  "unit.mb": "МБ",
  "unit.gb": "ГБ",
  "unit.perSecond": "/с",
  "unit.s": "с",
  "unit.min": "мин",
  "unit.h": "ч",

  "hero.welcome.title": "Закрытая бета Astral",
  "hero.welcome.sub": "Ставь моды. Делай свои.",
  "hero.confirm.title": "Почти готово",
  "hero.confirm.sub": "Остался последний шаг: подтвердите на сайте.",
  "hero.ready.title": "Всё готово",
  "hero.ready.sub": "Выберите ярлыки, и начнём.",
  "hero.download.title": "Скачиваем Astral",
  "hero.download.sub": "Обычно это несколько минут.",
  "hero.downloadQueue.title": "Ждём своей очереди",
  "hero.downloadQueue.sub": "Установка продолжится сама.",
  "hero.install.title": "Устанавливаем",
  "hero.install.sub": "Почти закончили.",
  "hero.done.title": "Готово",
  "hero.done.sub": "Приятной игры.",
  "hero.error.title": "Что-то пошло не так",
  "hero.error.sub": "Такое обычно легко исправить.",
  "hero.existing.title": "Astral уже у вас",
  "hero.existing.sub": "Запустите его или установите заново.",
  "hero.update.title": "Обновляем Astral",
  "hero.update.sub": "Это займёт меньше минуты.",
  "hero.updateDone.title": "Готово",
  "hero.updateDone.sub": "Версия самая свежая.",
  "hero.updateFailed.title": "Обновление не удалось",
  "hero.updateFailed.sub": "Всё работает, ничего не потеряно.",
  "hero.uninstall.title": "Удаление Astral",
  "hero.uninstall.sub": "Удалим программу, а файлы игры и моды не тронем.",
  "hero.uninstallDone.title": "Astral удалён",
  "hero.uninstallDone.sub": "Спасибо, что были с нами.",

  "welcome.title": "Введите код доступа",
  "welcome.text":
    "Код присылает команда Astral в ваш личный закрытый канал Discord. Он одноразовый.",
  "welcome.label": "Код беты",
  "welcome.placeholder": "XXXX-XXXX-XXXX-XXXX",
  "welcome.count": "{count} из {total}",
  "welcome.rejected": "Убрали лишние знаки: {chars}. Проверьте код.",
  "welcome.truncated": "В коде не больше 16 знаков, лишнее отрезали.",
  "welcome.submit": "Продолжить",
  "welcome.submitting": "Проверяем код…",
  "welcome.help": "Где взять код?",
  "welcome.hintDefault": "Буквы и цифры, регистр не важен. Дефисы ставятся сами.",
  "welcome.openSite": "Открыть сайт",
  "welcome.path": "Установка в {path}",
  "welcome.free": "Свободно {size}",
  "welcome.notice.expired":
    "Время подтверждения вышло. Введите тот же код ещё раз: он не потрачен.",

  "existing.title": "{name} уже установлен",
  "existing.text":
    "Версия {version}, ветка {channel}. Можно запустить Astral или установить заново.",
  "existing.launch": "Запустить Astral",
  "existing.reinstall": "Переустановить",
  "existing.hint":
    "Для переустановки нужен особый код. Его выдаёт только команда Astral.",

  "confirm.title": "Подтвердите в браузере",
  "confirm.text":
    "Мы открыли сайт в браузере. Войдите через Discord и подтвердите установку.",
  "confirm.codeLabel": "Введите этот код на сайте",
  "confirm.waiting": "Ждём подтверждения с сайта…",
  "confirm.offline": "Нет связи, пробуем снова…",
  "confirm.expires": "Код действует ещё {time}",
  "confirm.reopen": "Открыть сайт ещё раз",
  "confirm.cancel": "Отмена",
  "confirm.warning": "Установку начали не вы? Нажмите «Это не я» на сайте.",

  "ready.title": "Установка подтверждена",
  "ready.hello": "Здравствуйте, {name}!",
  "ready.helloAnon": "Здравствуйте!",
  "ready.text": "Ставим Astral {version}, ветка {channel}.",
  "ready.download": "Скачать",
  "ready.need": "Нужно места",
  "ready.free": "Свободно",
  "ready.desktop": "Ярлык на рабочем столе",
  "ready.menu": "Ярлык в меню «Пуск»",
  "ready.install": "Установить",
  "ready.noSpace":
    "Не хватает места: нужно {need}, свободно {free}. Освободите место и повторите.",
  "ready.folder": "Папка",
  "ready.change": "Изменить",
  "ready.pickTitle": "Куда установить Astral",
  "ready.folderProtected":
    "Эта папка защищена: для установки нужны права администратора. Выберите другую, например на диске D.",
  "ready.folderReadOnly": "В эту папку нельзя записывать. Выберите другую.",
  "ready.folderFailed": "Не удалось выбрать папку. Попробуйте ещё раз.",
  "ready.noSpaceChoose":
    "Не хватает места: нужно {need}, свободно {free}. Освободите место или выберите папку на другом диске.",

  "download.title": "Скачиваем Astral",
  "download.launcher": "Лаунчер",
  "download.interface": "Интерфейс",
  "download.eta": "осталось {time}",
  "download.attempt": "Попытка {n} из {total}",
  "download.offline": "Нет связи. Продолжим с того же места…",
  "download.queue": "Сейчас много желающих — ждём своей очереди. Установка продолжится сама. Следующая попытка через {time}.",
  "download.queueNow": "Пробуем снова…",
  "download.cancel": "Отменить установку",
  "download.overall": "Всего",

  "install.title": "Устанавливаем",
  "install.verify": "Проверяем файлы",
  "install.unpack": "Распаковываем",
  "install.shortcuts": "Создаём ярлыки",
  "install.finalize": "Завершаем",

  "done.title": "Astral установлен",
  "done.text": "Версия {version}. Можно играть.",
  "done.serial": "Номер активации",
  "done.launch": "Запустить Astral",

  "next.afterTitle": "После установки",
  "next.doneTitle": "Что дальше",
  "next.1.title": "Войдите через Discord",
  "next.1.text": "Откроется браузер. Пароль вводить не нужно.",
  "next.2.title": "Astral найдёт GTA V",
  "next.2.text": "Если не найдёт, папку выберете сами.",
  "next.3.title": "Поставьте первый мод",
  "next.3.text": "Откройте каталог и нажмите «Установить».",
  "done.warning.revoked":
    "Сервер не принял отметку об установке: ваш доступ к бете отозван. Файлы на месте, но Astral, скорее всего, не запустится. Напишите в поддержку.",
  "done.warning.expired":
    "Сервер не принял отметку об установке: истёк срок подтверждения входа. Astral установлен, но при первом запуске может понадобиться новый код.",
  "done.warning.report":
    "Сервер не принял отметку об установке, но на работу Astral это не влияет.",

  "closing.title": "Прервать установку?",
  "closing.text":
    "Код привязан к этому ПК. Пока Astral ни разу не запускали, установку можно повторить с тем же кодом и снова подтвердить на сайте. Если запуск уже был, нужен код переустановки от команды Astral.",
  "closing.stay": "Продолжить установку",
  "closing.quit": "Прервать и выйти",
  "closing.cancel": "Прервать установку",
  "closing.busyUpdateTitle": "Идёт обновление",
  "closing.busyUpdateText":
    "Прервать нельзя, подождите: это займёт меньше минуты.",
  "closing.busyUninstallTitle": "Идёт удаление",
  "closing.busyUninstallText":
    "Прервать нельзя, подождите: это займёт меньше минуты.",
  "closing.ok": "Понятно",

  "update.title": "Обновляем Astral",
  "update.download": "Скачиваем обновление",
  "update.verify": "Проверяем файлы",
  "update.unpack": "Распаковываем файлы",
  "update.swap": "Заменяем файлы",
  "update.start": "Запускаем Astral",
  "update.step.download": "Скачано",
  "update.step.verify": "Проверено",
  "update.step.unpack": "Распаковка",
  "update.step.swap": "Замена",
  "update.step.start": "Запуск",
  "update.steps": "Шаги обновления",
  "update.opens": "Astral откроется сам",
  "update.doneTitle": "Astral обновлён",
  "update.doneText": "Обновлено до {version}.",
  "update.failedTitle": "Обновление не удалось",
  "update.failedText":
    "Версия {version} не запустилась, поэтому мы вернули версию {restored}. Для вас ничего не изменилось.",

  "uninstall.title": "Удалить {name}?",
  "uninstall.text":
    "Удалим программу, ярлыки и записи в реестре. Файлы игры и ваши моды останутся.",
  "uninstall.deleteData": "Удалить и мои данные Astral",
  "uninstall.deleteDataHint":
    "Это настройки, вход и локальный кэш. Без галочки после новой установки всё вернётся само.",
  "uninstall.folders": "Папки с данными",
  "uninstall.running":
    "Astral запущен, удалить его нельзя. Закройте и повторите.",
  "uninstall.confirm": "Удалить",
  "uninstall.keep": "Отмена",
  "uninstall.willGo": "Удалится",
  "uninstall.willGoText": "Программа, ярлыки и записи в реестре",
  "uninstall.willStay": "Останется",
  "uninstall.stayAll": "Файлы игры, ваши моды и данные Astral",
  "uninstall.stayGame": "Файлы игры и ваши моды",
  "uninstall.progressTitle": "Удаляем {name}",
  "uninstall.files": "Удаляем файлы",
  "uninstall.shortcuts": "Убираем ярлыки",
  "uninstall.registry": "Чистим записи в реестре",
  "uninstall.data": "Удаляем данные",
  "uninstall.doneTitle": "{name} удалён",
  "uninstall.doneText": "Файлы игры и моды не тронуты.",
  "uninstall.doneData": "Данные Astral тоже удалены.",
  "uninstall.doneKept":
    "Данные Astral сохранены: после новой установки всё будет как раньше.",

  "error.supportCode": "Код для поддержки",
  "error.factInstaller": "Версия установщика",
  "error.support": "Если не получается, напишите в поддержку Astral в Discord и назовите этот код.",
  "error.restart": "Начать заново",

  "field.CODE_FORMAT": "Проверьте код: после BETA- должно быть 16 знаков.",
  "field.BETA_CODE_INVALID":
    "Такого кода нет. Возможно, скопирован не весь код: проверьте.",
  "field.BETA_CODE_USED":
    "Этот код уже использован. Если нужна повторная установка, напишите команде Astral.",
  "field.BETA_CODE_EXPIRED":
    "Срок действия кода истёк. Попросите у команды Astral новый.",
  "field.BETA_CODE_REVOKED": "Доступ по этому коду отозван.",
  "field.BETA_NOT_REGISTERED":
    "Сначала зарегистрируйтесь на сайте через Discord, потом вернитесь в это окно.",
  "field.RATE_LIMITED": "Слишком много попыток. Подождите {seconds} с.",
  "field.BETA_UNAVAILABLE":
    "Сервис беты временно недоступен. Попробуйте чуть позже.",
  "field.SERVER_UNAVAILABLE": "Сервер не отвечает. Повторите через минуту.",
  "field.NETWORK_UNAVAILABLE":
    "Нет подключения к интернету. Проверьте сеть и попробуйте снова.",
  "field.UNSUPPORTED_OS": "Нужна Windows 10 или новее.",
  "field.INTERNAL":
    "Что-то пошло не так. Попробуйте ещё раз, а если не выйдет, напишите команде.",

  "error.BETA_ACTIVATION_DENIED.title": "Установка отклонена",
  "error.BETA_ACTIVATION_DENIED.text":
    "На сайте нажали «Это не я», поэтому установку отклонили. Если это ошибка, начните заново.",
  "error.BETA_ACTIVATION_REVOKED.title": "Активация отозвана",
  "error.BETA_ACTIVATION_REVOKED.text":
    "Доступ к бете отозван. Если это ошибка, напишите команде Astral.",
  "error.DPOP_INVALID.title": "Проверьте время на ПК",
  "error.DPOP_INVALID.text":
    "Часы компьютера не совпадают с серверными, запрос отклонён. Включите в Windows автоматическую установку времени и начните заново.",
  "error.BETA_TICKET_INVALID.title": "Ссылка на файлы устарела",
  "error.BETA_TICKET_INVALID.text":
    "Начните установку заново с тем же кодом на том же ПК. Это возможно, пока Astral не запускали.",
  "error.BETA_UNAVAILABLE.title": "Сервис беты недоступен",
  "error.BETA_UNAVAILABLE.text":
    "Попробуйте через пару минут: скачанное сохранится.",
  "error.SERVER_UNAVAILABLE.title": "Сервер не отвечает",
  "error.SERVER_UNAVAILABLE.text":
    "Попробуйте через минуту: скачанное не потеряется.",
  "error.NETWORK_UNAVAILABLE.title": "Нет подключения",
  "error.NETWORK_UNAVAILABLE.text":
    "Связь пропала. Проверьте сеть и повторите: скачанное сохранено, скачивание продолжится с того же места.",
  "error.RATE_LIMITED.title": "Слишком много запросов",
  "error.RATE_LIMITED.text": "Подождите {seconds} с и повторите.",
  "error.DISK_FULL.title": "Мало места на диске",
  "error.DISK_FULL.text":
    "Нужно {need}, свободно {free}. Освободите место и повторите.",
  "error.ACCESS_DENIED.title": "Нет доступа к папке",
  "error.ACCESS_DENIED.text":
    "Не удалось записать файлы в {path}. Проверьте права на папку и антивирус.",
  "error.FOLDER_BUSY.title": "Папка не пуста",
  "error.FOLDER_BUSY.text":
    "В папке «{name}» уже есть чужие файлы. Выберите другое место или очистите эту папку.",
  "error.FOLDER_BUSY.action": "Выбрать папку",
  "error.APP_RUNNING.title": "Astral запущен",
  "error.APP_RUNNING.text": "Закройте Astral и повторите.",
  "error.HASH_MISMATCH.title": "Файл повреждён при скачивании",
  "error.HASH_MISMATCH.text": "Контрольная сумма не совпала. Скачайте ещё раз.",
  "error.SIGNATURE_INVALID.title": "Подпись сборки не прошла проверку",
  "error.SIGNATURE_INVALID.text":
    "Эта сборка не попала на диск: возможно, файл повреждён или изменён. Скачайте свежий установщик с сайта. Если не поможет, напишите команде Astral.",
  "error.INSTALL_FAILED.title": "Установка не удалась",
  "error.INSTALL_FAILED.text":
    "Что-то помешало записать файлы. Повторите попытку, а если снова не выйдет, отправьте файл журнала команде Astral.",
  "error.UNSUPPORTED_OS.title": "Нужна Windows 10 или новее",
  "error.UNSUPPORTED_OS.text": "Astral не работает на этой версии Windows.",
  "error.INTERNAL.title": "Что-то пошло не так",
  "error.INTERNAL.text":
    "Откройте файл журнала и передайте его команде Astral: мы разберёмся.",

  "hero.branch.title": "Какую ветку поставить?",
  "hero.branch.sub": "Остальные можно поставить рядом позже, когда захотите.",
  "hero.side.title": "Ставим рядом",
  "hero.side.sub": "Это займёт несколько минут.",
  "hero.sideDone.title": "Готово",
  "hero.sideDone.sub": "Новая ветка встала рядом с остальными.",

  "branch.label": "Ветки Astral",
  "branch.title": "Выберите ветку",
  "branch.text":
    "Каждая ветка ставится в свою папку. Общие для всех: вход, мастерская и настройки.",
  "branch.version": "Версия {version}",
  "branch.versionUnknown": "Точную версию узнаем при установке.",
  "branch.installed": "Установлена",
  "branch.continue": "Далее",
  "branch.change": "Выбрать другую ветку",

  "ready.textBranch": "Ставим {name} {version}.",
  "ready.textBranchUnknown": "Ставим свежую версию {name}.",

  "side.title": "Ставим {name} рядом",
  "side.download": "Скачиваем файлы",
  "side.verify": "Проверяем файлы",
  "side.unpack": "Распаковываем",
  "side.files": "Раскладываем файлы",
  "side.shortcuts": "Создаём ярлыки",
  "side.registry": "Записываем в реестр",
  "side.doneTitle": "{name} установлен рядом",
  "side.doneText":
    "Версия {version} стоит рядом с остальными, данные у всех общие.",
  "side.launch": "Запустить {name}",
  "side.enterCode": "Ввести код",

  "closing.busySideTitle": "Идёт установка",
  "closing.busySideText": "Прервать нельзя, подождите: это несколько минут.",

  "error.BETA_CHANNEL_DENIED.title": "Доступ к ветке снят",
  "error.BETA_CHANNEL_DENIED.text":
    "У вашего аккаунта больше нет доступа к этой ветке. На диске ничего не добавилось и не удалилось. Выберите другую ветку или спросите у команды Astral.",

  "uninstall.deleteDataShared":
    "Данные общие с ветками {names}: пока стоит хоть одна, они остаются. Поэтому галочка недоступна.",

  "error.DAILY_LIMIT.title": "Предел скачиваний на сегодня",
  "error.DAILY_LIMIT.text": "На сегодня предел скачиваний для этой установки исчерпан. Попробуйте позже.",

  // Открытый режим (19.11.2026): слова без ввода кода и без «беты»; окно берёт их вместо одноимённых, когда init.open.
  "open.steps.code": "Старт",
  "open.hero.welcome.title": "Установка Astral",
  "open.welcome.title": "Установим Astral",
  "open.welcome.text": "Код вводить не нужно. Нажмите «Продолжить» и подтвердите установку на сайте.",
  "open.welcome.submitting": "Открываем сайт…",
  "open.how.title": "Как это пройдёт",
  "open.how.1.title": "Откроется сайт Astral",
  "open.how.1.text": "Войдите через Discord, если ещё не вошли.",
  "open.how.2.title": "Подтвердите установку",
  "open.how.2.text": "Сверьте код с этим окном и нажмите «Подтвердить».",
  "open.how.3.title": "Мы скачаем и поставим",
  "open.how.3.text": "Обычно это несколько минут.",
  "open.welcome.notice.expired": "Время подтверждения вышло. Нажмите «Продолжить» ещё раз.",
  "open.existing.hint": "Для переустановки может понадобиться свежий установщик: если этот уже использован, мы подскажем, где скачать новый.",
  "open.again.title": "Скачайте установщик заново",
  "open.again.text": "Эта копия установщика больше не подходит: в ней нет ссылки для установки, срок вышел, установка уже выполнена или файл переименовали.",
  "open.again.hint": "Скачайте установщик заново на сайте.",
  "open.again.button": "Открыть страницу скачивания",
  "open.offline.title": "Нет связи с сервером",
  "open.offline.text": "Не удалось связаться с сервером Astral. Проверьте интернет и повторите.",
  "open.offline.hint": "Установщику нужен интернет: он подтверждает установку на сайте и скачивает Astral.",
  "open.side.enterCode": "Продолжить установку",
  "open.confirm.codeLabel": "Этот код должен совпасть с кодом на сайте",
  "open.redo.title": "Что сделать",
  "open.redo.1.title": "Откройте страницу скачивания",
  "open.redo.1.text": "Нажмите кнопку ниже. Если нужно, войдите через Discord.",
  "open.redo.2.title": "Скачайте и запустите новый файл",
  "open.redo.2.text": "Старый установщик можно удалить.",
  "open.field.BETA_UNAVAILABLE": "Сервер сейчас не принимает новые установки. Попробуйте позже.",
  "open.error.BETA_ACTIVATION_REVOKED.title": "Доступ закрыт",
  "open.error.BETA_ACTIVATION_REVOKED.text": "Доступ к Astral для этого аккаунта закрыт. Если это ошибка, напишите в поддержку Astral.",
  "open.error.BETA_TICKET_INVALID.text": "Начните установку заново на этом же ПК. Это возможно, пока Astral не запускали.",
  "open.error.BETA_UNAVAILABLE.title": "Сервис Astral недоступен",
  "open.done.warning.revoked": "Сервер не принял отметку об установке: доступ этого аккаунта закрыт. Файлы на месте, но Astral, скорее всего, не запустится. Напишите в поддержку.",
  "open.done.warning.expired": "Сервер не принял отметку об установке: истёк срок подтверждения входа. Astral установлен, но перед первым запуском его может понадобиться установить заново.",
  "open.closing.text": "Пока Astral ни разу не запускали, установку можно повторить: запустите установщик ещё раз и подтвердите на сайте. Если запуск уже был, скачайте установщик на сайте заново.",
});
