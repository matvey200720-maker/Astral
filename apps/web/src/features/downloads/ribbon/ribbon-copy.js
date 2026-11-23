/*
 * Слова «Загрузок» v2-A «Лента» (15.11.2026): герой, полоса сводки, списки.
 *
 * Те же правила, что у `downloads-copy.js`: русские строки — ключи словаря (`locales/ui-text/zone-port-shell-1511-downloads.js` и
 * французский `fr/…`), на язык окна их переводит `trIn`; вставки именованные; склонения — «категория:слово|…», категорию выбирает
 * `Intl.PluralRules` языка. Модуль едет вместе со страницей загрузок по `import()`, в стартовом куске его нет.
 */

import { fillNamed } from "../../../locales/tr-fill.js";
import { trIn } from "../../../locales/ui.js";

const rules = new Map();
function pluralOf(language, count, forms) {
  if (!rules.has(language)) rules.set(language, new Intl.PluralRules(language));
  return forms[rules.get(language).select(count)] || forms.other;
}

/* Именительный падеж: «64 файла», «5 файлов»; «26 модов в игре». */
const FILE_COUNT = "one:файл|few:файла|many:файлов|other:файла";

/** Слова ленты на языке `language`: перевод этого языка должен быть подгружен окном. */
export function ribbonCopyFor(language) {
  const say = (text) => trIn(language, text);
  const fill = (text, values) => fillNamed(say(text), values);
  const noun = (forms, count) =>
    pluralOf(
      language,
      count,
      Object.fromEntries(
        say(forms)
          .split("|")
          .map((form) => form.split(":")),
      ),
    );

  return {
    title: say("Загрузки"),
    tabNow: (count) => fill("Сейчас {count}", { count }),
    /* «Отменить» в общем словаре — это «Undo»; кнопка героя отменяет операцию, поэтому у других языков — слово «Отмена» (Cancel). */
    cancel: language === "ru" ? "Отменить" : say("Отмена"),
    lockedCancel: say("Запись в игру прерывать нельзя"),
    gameUntouched: say("Файлы игры ещё не изменяются"),
    writing: say("Идёт запись в игру"),
    nothingWritten: say("В игру ничего не записано"),
    connectionLost: say("Связь прервалась"),
    resumeKicker: say("Докачка"),
    resumeNote: say("Продолжаем с места, где остановились"),
    needFree: (need, free) =>
      fill("нужно {need}, свободно {free}", { need, free }),
    onDisk: (percent) => fill("{percent} % уже на диске", { percent }),
    inGame: {
      legacy: say("в GTA V Legacy"),
      enhanced: say("в GTA V Enhanced"),
    },
    overall: say("общий ход"),
    stages: [say("Скачали"), say("Проверили"), say("Записали в игру")],
    stagesActive: [
      say("Скачиваем"),
      say("Проверяем"),
      say("Записываем в игру"),
    ],
    stageStopped: say("остановлено"),
    stageLocked: say("прерывать нельзя"),
    fileCount: (count) => `${count} ${noun(FILE_COUNT, count)}`,
    ready: say("Готово"),
    quiet: say("Пока тихо"),
    allDone: say("Всё готово"),
    nothingRuns: say("Ничего не устанавливается"),
    changesAfterLaunch: say(
      "Изменения появятся после следующего запуска GTA V",
    ),
    installedCount: (count) => fill("Установлено {count}", { count }),
    removedCount: (count) => fill("Убрано {count}", { count }),
    inTime: (time) => fill("за {time}", { time }),
    lastRun: (name, time) =>
      fill("Последняя установка: {name} · {time} · уже в игре", { name, time }),
    openCatalog: say("Открыть каталог"),
    moreFromCatalog: say("Ещё из каталога"),
    queueTitle: say("Дальше в очереди"),
    emptyQueueTitle: say("В очереди больше ничего"),
    emptyQueueText: say(
      "Добавьте мод в каталоге — он встанет сюда и начнётся сам, когда закончится эта установка.",
    ),
    emptyQueueTextIdle: say("Добавьте мод в каталоге — он начнётся сразу."),
    queueIdleTitle: say("Пока ничего не качается"),
    queueIdleText: say(
      "Положите моды в корзину и поставьте разом — очередь появится здесь.",
    ),
    openCart: say("Открыть корзину"),
    gripLabel: (name) =>
      fill("Переставить «{name}»: потяните или нажмите ↑ и ↓", { name }),
    movedTo: (name, place, total) =>
      fill("«{name}» — место {place} из {total}", { name, place, total }),
    libraryTitle: say("Библиотека"),
    libraryLoading: say("Читаю, что стоит в игре…"),
    libraryEmptyTitle: say("В игре пока ничего нет"),
    libraryEmptyText: say(
      "Здесь будет то, что вы поставили: моды, работы мастерской, одежда.",
    ),
    editWork: say("Доделать в редакторе"),
    editClothing: say("Сменить заменёнку"),
    removeFromGame: say("Убрать из игры"),
    editLabel: (verb, name) => fill("{verb}: {name}", { verb, name }),
    editFailed: say("Не удалось открыть редактор."),
  };
}
