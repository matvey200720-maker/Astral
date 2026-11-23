/*
 * «Загрузки» на языке окна: слова страницы-«Ленты» (`features/downloads/ribbon/`), строки очереди и всплывашки о том, чем
 * кончилась операция.
 *
 * Всё это было написано по-русски прямо в разметке и в DesktopShell: на
 * немецком человек ставил мод и читал «"DRAGON Minimap" установлен —
 * изменения будут в игре при следующем запуске». Название раздела в словах —
 * то же, что в рельсе (components/desktop/navigation/navigationRail.js).
 *
 * Счёт склоняется правилом языка (`Intl.PluralRules`); фазы движка приходят
 * ключами из install-phase.js (`installPhaseKey`).
 *
 * Слова — русские строки-ключи словаря (`locales/ui-text/zone-h2-downloads-copy-2410.js`), на язык окна их переводит `trIn` из куска
 * этого языка. Раньше здесь лежали пять блоков на пяти языках разом, и все они ехали в стартовый кусок (24.10.2026).
 */

import { roundedRemaining } from "./eta.js";
import { fillNamed } from "../../locales/tr-fill.js";
import { trIn } from "../../locales/ui.js";

const pluralRules = new Map();
function pluralOf(language, count, forms) {
  if (!pluralRules.has(language))
    pluralRules.set(language, new Intl.PluralRules(language));
  const form = pluralRules.get(language).select(count);
  return forms[form] || forms.other;
}

/*
 * Причина в середине фразы — со строчной, но только если это не имя и не
 * аббревиатура: «GTA V запущена» остаётся «GTA V», а не «gta v». В немецком
 * существительные пишутся с прописной, там регистр не трогают вовсе.
 */
function inSentence(reason, keepCase) {
  const text = String(reason || "");
  if (keepCase || !/^\p{Lu}\p{Ll}/u.test(text)) return text;
  return text[0].toLocaleLowerCase() + text.slice(1);
}

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

/* Кавычки языка: знаки, а не слова — в словарь не идут. */
const QUOTES = {
  ru: ["«", "»"],
  uk: ["«", "»"],
  en: ["“", "”"],
  de: ["„", "“"],
  pl: ["„", "”"],
  fr: ["«\u00a0", "\u00a0»"],
};

/*
 * Слова, у которых в общем словаре другой перевод (кнопка «Повторить» там — «Repeat», а в «Загрузках» всегда было «Retry»; «мод» — «the mod»
 * в фразе и «mod» в списке): здесь по языкам только отличия, остальное — из словаря.
 */
const OWN = {
  Подготовка: { en: "Preparing" },
  Проверка: { en: "Checking", pl: "Sprawdzanie", fr: "Vérification" },
  Повторить: { en: "Retry", pl: "Ponów", fr: "Réessayer" },
  мод: { en: "the mod", de: "die Mod" },
  "Подробности — в «Загрузках»": {
    uk: "Подробиці — у «Завантаженнях»",
    pl: "Szczegóły — w „Pobieraniu”",
    fr: "Détails — voir «\u00a0Téléchargements\u00a0»",
  },
};

/* Склонения: «категория:слово|…» — русские формы ключом, формы языка в словаре; категорию выбирает `Intl.PluralRules` языка. */
const FILES = "one:файла|other:файлов";
const DICTIONARIES = "one:словаря|few:словаря|many:словарей|other:словаря";
const OPERATIONS = "one:операции|other:операций";
const MINUTES = "one:минута|few:минуты|many:минут|other:минуты";
const SECONDS = "one:секунда|few:секунды|many:секунд|other:секунды";

/** Слова «Загрузок» на языке `language`: перевод этого языка должен быть подгружен (окном или `loadUiText`). */
function copyOf(language) {
  const say = (text) => OWN[text]?.[language] ?? trIn(language, text);
  const fill = (text, values) => fillNamed(say(text), values);
  const noun = (forms, count) =>
    pluralOf(
      language,
      count,
      Object.fromEntries(say(forms).split("|").map((form) => form.split(":"))),
    );
  return {
    quotes: QUOTES[language],
    ...(language === "de" ? { keepCase: true } : {}),
    panel: {
      emptyText: say("Новые установки появятся здесь автоматически."),
    },
    kicker: {
      install: say("Установка"),
      remove: say("Удаление"),
      reset: say("Восстановление"),
      waiting: say("Ожидание"),
    },
    /* Ход подготовки растительности и дорог: этапы, «N из M», признак жизни и ожидание. */
    prepare: {
      title: say("Подготовка"),
      counting: say("Считаю файлы…"),
      stalled: (seconds) =>
        fill("Нет движения {seconds} с, возможно, занят диск", { seconds }),
      progress: (current, total, stage) =>
        fill("Подготовка {current} из {total} · {stage}", {
          current,
          total,
          stage,
        }),
      stages: {
        models: say("Перекрашиваю модели"),
        copies: say("Копии «В разнобой»"),
        maps: say("Карты и трава"),
        roads: say("Перекрашиваю дороги"),
        pack: say("Упаковка пакета"),
      },
      dictionaries: (done, total) =>
        fill("{done} из {total} {noun}", {
          done,
          total,
          noun: noun(DICTIONARIES, total),
        }),
      archives: (done, total) =>
        fill("Читаю архивы игры · {done} из {total}", { done, total }),
      waitingAfter: (name, eta) =>
        `${fill("Ожидание · начнётся после «{name}»", { name })}${eta ? `, ${eta}` : ""}`,
      through: (time) => fill("≈ через {time}", { time }),
    },
    waitsForWorkshop: say("Запустится, когда мастерская закончит запись в игру"),
    /* Ждущая строка каталога: какая работа мастерской держит очередь, на каком она шаге и сколько прошла. */
    waitsForWorkshopDetail: ({ title, stage, percent }) =>
      `${fill("Ждёт мастерскую: «{title}»", { title })}${stage ? ` — ${stage}` : ""}${percent === null ? "" : fill(", {percent}%", { percent })}`,
    startsAfterCurrent: say("Запустится после текущей операции"),
    startsAfter: (count) =>
      fill("Запустится после {count} {noun}", {
        count,
        noun: noun(OPERATIONS, count),
      }),
    /* Ускоренная загрузка: кнопка в шапке и пояснение под ней — что ускоряет,
       что нагрузит и что будет, если выключить (features/downloads/accelerated.js). */
    accel: {
      label: say("Ускоренная загрузка"),
      on: say(
        "Качает вдвое больше потоков и до 4 файлов сразу, ускоряет и уже идущую загрузку. Пока включено, компьютер может тормозить. Мастерская этим не ускоряется: её работы пишутся в игру по одной.",
      ),
      off: say(
        "Обычная скорость: по одному файлу. Включите — загрузка быстрее, но компьютер нагрузится.",
      ),
      stopped: say(
        "Обычная скорость. Файлы в работе доскачаются — ничего не отменено.",
      ),
    },
    /* Сколько ещё — примерно: «≈» стоит всегда (см. features/downloads/eta.js). */
    eta: {
      counting: say("считаю…"),
      almost: say("почти готово"),
      longer: say("дольше обычного"),
      left: (time) => fill("осталось ≈ {time}", { time }),
      time: ({ unit, value }) =>
        `${value} ${noun(unit === "min" ? MINUTES : SECONDS, value)}`,
    },
    files: (done, total) =>
      fill("{done} из {total} {noun}", {
        done,
        total,
        noun: noun(FILES, total),
      }),
    of: (done, total) => fill("{done} из {total}", { done, total }),
    perSec: say("/с"),
    cancelActive: say("Отменить операцию"),
    /* Крестик в шаге, который прервать нельзя: объяснение вместо тишины. */
    cannotCancelNow: say(
      "Сейчас мод записывается в игру — прервать нельзя: игра осталась бы с наполовину записанным архивом. Дождитесь конца, потом мод можно удалить в «Библиотеке».",
    ),
    cancelRestoring: say(
      "Идёт отмена: Astral возвращает файлы игры, как они были до установки. Дождитесь конца — прерывать на середине нельзя.",
    ),
    removeQueued: say("Убрать из очереди"),
    progress: (percent) => fill("Прогресс {percent}%", { percent }),
    activity: {
      cancelling: say("Безопасная отмена"),
      finishing: say("Завершение операции"),
      restoring: say("Восстановление файлов"),
      checkingClean: say("Проверка чистого состояния"),
      preparing: say("Подготовка файлов"),
    },
    phases: {
      ready: say("Подготовлено к применению"),
      commit: say("Применение файлов"),
      compose: say("Сборка и исправление RPF"),
      components: say("Подготовка компонентов Astral"),
      backup: say("Создание резервной копии"),
      verify: say("Проверка файлов"),
      prepare: say("Подготовка установки"),
      download: say("Скачивание файлов"),
      finish: say("Завершение операции"),
    },
    failedKicker: {
      install: say("Не удалось установить"),
      remove: say("Не удалось удалить"),
      reset: say("Не удалось восстановить"),
    },
    retry: say("Повторить"),
    retryFor: (name) => fill("Повторить: {name}", { name }),
    dismiss: say("Убрать из списка"),
    dismissFor: (name) => fill("Убрать из списка: {name}", { name }),
    work: {
      queued: say("Ожидание"),
      running: say("Установка"),
      removing: say("Удаление"),
      done: say("Готово"),
      failed: say("Не удалось"),
      doneRemoved: say(
        "Убрано из игры — изменения появятся после следующего запуска GTA V",
      ),
      doneInstalled: say(
        "Работа в игре — изменения появятся после следующего запуска GTA V",
      ),
      waitsFor: (name) =>
        fill(
          "Файлы ещё не изменяются — начнётся после установки «{name}» из каталога",
          { name },
        ),
      waitsCurrent: say(
        "Файлы ещё не изменяются — начнётся после текущей операции",
      ),
      retryRemoval: say("Повторить удаление"),
      retryInstall: say("Повторить установку"),
      cancelInstall: say("Отменить установку"),
      cancelling: say("Отменяю…"),
      cancellingLine: say("Отменяем — в игре ничего не поменяется"),
      cannotInterrupt: say("Запись в архив игры прерывать нельзя"),
      cannotInterruptLong: say(
        "Работа записывается в игру — прервать нельзя: игра осталась бы с наполовину записанным архивом. Когда закончится, её можно снять из игры в редакторе.",
      ),
    },
    nameless: say("мод"),
    namelessSubject: say("Мод"),
    failed: {
      install: (name) => fill("Не удалось установить {name}", { name }),
      remove: (name) => fill("Не удалось удалить {name}", { name }),
      reset: () => say("Не удалось вернуть GTA V без модов"),
    },
    details: say("Подробности — в «Загрузках»"),
    done: {
      removed: (name) =>
        fill("{name} удалён, оригинальные файлы на месте", { name }),
      reset: say("Все моды Astral удалены — GTA V как после установки"),
      replaced: (name) =>
        fill(
          "{name} установлен вместо конфликтующих — изменения будут в игре при следующем запуске",
          { name },
        ),
      installed: (name) =>
        fill("{name} установлен — изменения будут в игре при следующем запуске", {
          name,
        }),
    },
  };
}

/**
 * Слова «Загрузок» на языке окна.
 *
 * @param {string} language
 */
export function downloadsCopyFor(language) {
  return copyOf(LANGUAGES.includes(language) ? language : "en");
}

function quoted(copy, name) {
  const [open, close] = copy.quotes;
  return `${open}${name}${close}`;
}

/** Всплывашка об отказе: коротко, подробности — в «Загрузках». */
/*
 * Оценка остатка словами: «осталось ≈ 2 минуты», «почти готово», «считаю…».
 * `estimate` — из `estimateByRate` / `estimateByHistory` (features/downloads/eta.js)
 * или `null`. Без оценки: «считаю…», если скорость ещё копится (`counting`), иначе
 * тишина — цифры, которой нечем подтвердить, на экране нет.
 */
export function etaWords(copy, estimate, counting = false) {
  if (!estimate) return counting ? copy.eta.counting : "";
  if (estimate.overdue) return copy.eta.longer;
  if (estimate.ms < 5000) return copy.eta.almost;
  return copy.eta.left(copy.eta.time(roundedRemaining(estimate.ms)));
}

export function failureNotice(item, failure, language = "ru") {
  const copy = downloadsCopyFor(language);
  const operation = copy.failed[item?.operation] ? item.operation : "install";
  const name = quoted(copy, item?.name || copy.nameless);
  const reason = inSentence(failure.reason, copy.keepCase);
  return `${copy.failed[operation](name)}: ${reason}. ${copy.details}`;
}

/** Всплывашка об успехе — с именем мода и тем, когда это увидеть в игре. */
export function successNotice(item, language = "ru") {
  const copy = downloadsCopyFor(language);
  const name = item?.name ? quoted(copy, item.name) : copy.namelessSubject;
  if (item?.operation === "remove") return copy.done.removed(name);
  if (item?.operation === "reset") return copy.done.reset;
  if (item?.replaceIds?.length) return copy.done.replaced(name);
  return copy.done.installed(name);
}
