/*
 * Слова после установки заменёнки: увидит ли её игра (14.11.2026, `docs/clothing/server-routes.md`).
 *
 * Desktop отвечает кодами (`apps/desktop/src/clothing-install-visibility.js`: регистрация DLC в `update.rpf`, папка игры у RAGE MP и Majestic, куда легла запись и кто её увидит),
 * окно — словами на языке интерфейса. «Установлено» человек видит, только когда оговаривать нечего; иначе — что записано и что не сошлось: он знает это сразу, а не по тому, что в игре
 * ничего не изменилось. Модуль грузится лениво — после установки, а не при старте окна.
 */

import { tr } from "../../locales/ui.js";

const fill = (text, values) =>
  Object.entries(values).reduce(
    (line, [key, value]) => line.replace(`{${key}}`, String(value ?? "")),
    text,
  );

/* Слова по коду проблемы (`installVisibility`); русские строки — ключи словаря на шести языках. Информационные коды (`pack`, `pack-majestic`: записано в пак игры, как задумано) без слов: человек видит обычное «Установлено». */
const WORDS = {
  "registration-missing": () =>
    tr(
      "Astral Clothing DLC не записан в update.rpf: игра его не подключит, и вещь пока не появится. Astral вернёт запись сам при следующем запуске.",
    ),
  "rage-path": ({ path, gameRoot }) =>
    fill(
      tr(
        "RAGE MP запускает игру из другой папки («{path}»), а Astral пишет в «{gameRoot}»: на GTA 5 RP вещь не появится.",
      ),
      { path, gameRoot },
    ),
  "majestic-path": ({ path, gameRoot }) =>
    fill(
      tr(
        "Majestic запускает игру из другой папки («{path}»), а Astral пишет в «{gameRoot}»: на Majestic вещь не появится.",
      ),
      { path, gameRoot },
    ),
  /* Находка 5 ревью: один клиент из двух смотрит в чужую папку — вещь не появится именно у него; что второй её увидит, говорим, только когда его папка проверена. */
  "rage-path-partial": ({ path, gameRoot, otherOk }) =>
    [
      fill(
        tr(
          "RAGE MP запускает игру из другой папки («{path}»), а Astral пишет в «{gameRoot}»: на GTA 5 RP вещь не появится, пока RAGE MP смотрит туда.",
        ),
        { path, gameRoot },
      ),
      otherOk ? tr("На Majestic вещь должна появиться.") : "",
    ]
      .filter(Boolean)
      .join(" "),
  "majestic-path-partial": ({ path, gameRoot, otherOk }) =>
    [
      fill(
        tr(
          "Majestic запускает игру из другой папки («{path}»), а Astral пишет в «{gameRoot}»: на Majestic вещь не появится, пока Majestic смотрит туда.",
        ),
        { path, gameRoot },
      ),
      otherOk ? tr("На GTA 5 RP (RAGE MP) вещь должна появиться.") : "",
    ]
      .filter(Boolean)
      .join(" "),
  /* Находка 4 ревью: прежняя заменёнка на вещи в Astral Clothing DLC не снялась — на RAGE MP она с order 101 монтируется позже паков игры и перекроет новую. */
  "superseded-failed": () =>
    tr(
      "Прежняя заменёнка этой вещи могла остаться в Astral Clothing DLC: снять её не удалось. На RAGE MP она может перекрыть новую — удалите её в «Библиотеке».",
    ),
  /* Обратное направление (ревью 15.11, №8б): новая заменёнка легла в Astral Clothing DLC, а прежняя на месте в паке игры не снялась — на RAGE MP новая сильнее, а на Majestic (он DLC не грузит) видна прежняя. */
  "superseded-failed-pack": () =>
    tr(
      "Прежняя заменёнка этой вещи могла остаться в паке игры: снять её не удалось. Новая записана в Astral Clothing DLC: на RAGE MP она сильнее, а на Majestic может быть видна прежняя — удалите её в «Библиотеке».",
    ),
  /* Находка 1 перепроверки: цвет жилета встал на месте в паке игры, а прежний цвет той же буквы в Astral Clothing DLC снят без вопроса — человек должен знать, что стояло раньше. */
  "superseded-removed": () =>
    tr(
      "Прежний цвет этого жилета в Astral Clothing DLC снят: новый встал на место в паке игры.",
    ),
  /* Находка 3 ревью: цвет бронежилета не лёг на месте в паке игры — причины названы, а не «вещи нет в файлах игры». */
  "astral-colour": () =>
    tr(
      "У бронежилета в паке игры нет такого цвета: заменёнка записана в Astral Clothing DLC. Majestic её не увидит, и на GTA 5 RP (RAGE MP) её не видно: клиент сервера не подключает пакеты Astral.",
    ),
  "astral-split": () =>
    tr(
      "Модели бронежилета лежат в разных архивах игры, и цвет одной записью на месте не заменить: заменёнка записана в Astral Clothing DLC. Majestic её не увидит, и на GTA 5 RP (RAGE MP) её не видно: клиент сервера не подключает пакеты Astral.",
    ),
  overlay: ({ pack }) =>
    fill(
      tr(
        "Вещь Majestic записана в overlay пака «{pack}»: такой маршрут в игре не проверен — проверьте вещь на Majestic.",
      ),
      { pack },
    ),
  "astral-base": () =>
    tr(
      "Это вещь базовой игры, не из пакета: заменёнка записана в Astral Clothing DLC. Majestic её не увидит, и на GTA 5 RP (RAGE MP) её не видно: клиент сервера не подключает пакеты Astral.",
    ),
  "astral-pack": ({ pack }) =>
    fill(
      tr(
        "Вещь лежит в паке «{pack}», которого нет в списке Majestic: заменёнка записана в Astral Clothing DLC. Majestic её не увидит, и на GTA 5 RP (RAGE MP) её не видно: клиент сервера не подключает пакеты Astral.",
      ),
      { pack },
    ),
  "astral-later": ({ pack }) =>
    fill(
      tr(
        "Файлы вещи перекрыты копиями в патч-паках игры (например, «{pack}»), которых нет в списке Majestic: заменёнка записана в Astral Clothing DLC, он грузится последним. Majestic её не увидит, и на GTA 5 RP (RAGE MP) её не видно: клиент сервера не подключает пакеты Astral.",
      ),
      { pack },
    ),
  "astral-order": () =>
    tr(
      "Порядок паков вашей игры не прочитался, а файлы вещи лежат в нескольких архивах: заменёнка записана в Astral Clothing DLC. Majestic её не увидит, и на GTA 5 RP (RAGE MP) её не видно: клиент сервера не подключает пакеты Astral.",
    ),
  "astral-files": () =>
    tr(
      "У вещи нет файлов в её паке игры: заменёнка записана в Astral Clothing DLC. Majestic её не увидит, и на GTA 5 RP (RAGE MP) её не видно: клиент сервера не подключает пакеты Astral.",
    ),
  "astral-gta5rp": () =>
    tr(
      "Заменёнка записана в Astral Clothing DLC. На GTA 5 RP её не видно: клиент сервера не подключает пакеты Astral.",
    ),
  /* Режим контейнера (`ASTRAL_CLOTHING_VIA_UPDATE`, 21.11.2026): вещь ушла в контейнер внутри update.rpf, а не в пакет Astral. Говорим только то, что снято на сервере; про модели и реквизит слов нет. */
  "container-gta5rp": () => tr("Вещь записана в файл игры и на GTA 5 RP видна."),
  /* Режим RP (21.11.2026): картинка тату осталась в хосте `astral_clothing` (маршрут наложений отказал: `overlay-install-visibility.js`). Хост клиент RAGE MP не подключает — подтверждено для одежды, пакет тот же.
     Когда картинка ушла в контейнер, Desktop слов не присылает: на сервере тату не снимали, обещать нечего. `partial` — часть картинок ушла в контейнер, часть осталась. */
  "overlay-astral": ({ partial }) =>
    partial === true
      ? tr(
          "Часть картинок тату записана в Astral Clothing DLC. На GTA 5 RP эти картинки не видны: клиент сервера не подключает пакеты Astral.",
        )
      : tr(
          "Тату записано в Astral Clothing DLC. На GTA 5 RP его не видно: клиент сервера не подключает пакеты Astral.",
        ),
  "astral-unknown": () =>
    tr(
      "Такой вещи нет в файлах вашей игры: заменёнка записана в Astral Clothing DLC. Majestic её не увидит, и на GTA 5 RP (RAGE MP) её не видно: клиент сервера не подключает пакеты Astral.",
    ),
};

/* Информационные коды, о которых говорим (остальные info — «как задумано», без слов). */
const SAID_INFO = new Set(["superseded-removed", "container-gta5rp"]);

/** Слова одной проблемы или пустая строка, если код новее окна. */
export const problemWords = (problem) =>
  WORDS[problem?.code] ? WORDS[problem.code](problem) : "";

/**
 * Слова об установке для уведомления: `{ text, tone }`; `null` — оговаривать нечего (`visibility.clean`).
 * @param {{ visibility?: { problems?: Array<object>, clean?: boolean } }} result ответ Desktop (`applyClothingReplacement` / `applyClothingPaint`)
 * @param {string} title название работы или мода — в начало строки
 */
export function installNotice(result, title = "") {
  const visibility = result?.visibility;
  if (!visibility) return null;
  /* Говорим об оговорках и о тех информационных кодах, что человеку надо знать; «как задумано» (`pack`) — молча. */
  const problems = (visibility.problems || []).filter(
    (problem) => problem.level !== "info" || SAID_INFO.has(problem.code),
  );
  if (!problems.length) return null;
  const failed = problems.some((problem) => problem.level === "error");
  const head = failed
    ? tr("«{title}»: записано, но в игре пока не появится.")
    : tr("«{title}»: записано. Что стоит знать:");
  const lines = problems.map(problemWords).filter(Boolean);
  /* Все коды окну неизвестны (окно старше Desktop): общая строка, а не голый заголовок (мелочь 5 перепроверки). */
  if (!lines.length)
    lines.push(
      tr(
        "Причину это окно показать не может: обновите Astral, подробности — в журнале.",
      ),
    );
  return {
    text: [fill(head, { title: title || tr("Заменёнка") }), ...lines].join(" "),
    tone: failed ? "error" : "info",
  };
}

/** Текст для «установлено» в мастерской: прежние слова работы, а при оговорках — слова об установке вместо них. */
export const doneTextWith = (result, title, fallback) =>
  installNotice(result, title)?.text || fallback;

/**
 * Текст «установлена» для очереди мастерской (находка 1 ревью, 14.11.2026): очередь отдаёт `{ record, installed, displaced }` (`skin-installs.js`), а ответ Desktop с `visibility` лежит в
 * `installed`. Прежде слова брались из самого итога очереди — `visibility` там нет, и покраска из мастерской всегда говорила «установлена».
 */
export const doneTextOfQueue = (queueResult, title, fallback) =>
  doneTextWith(queueResult?.installed, title, fallback);
