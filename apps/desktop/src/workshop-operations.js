/*
 * Один замок на все изменения игры из Мастерской.
 *
 * Любая установка из Мастерской переписывает `update/update.rpf` — архив на
 * два гигабайта. Движок копирует его в резерв, пересобирает helper'ом и
 * подменяет файл: на живой игре это 45 секунд, из них 25 внутри helper'а без
 * единого сообщения. Раньше окно всё это время молчало, а закрыть его никто
 * не мешал — то есть человеку нечем было отличить работу от зависания, и
 * единственное разумное для него действие (закрыть и открыть заново) рвало
 * пересборку.
 *
 * Поэтому операция обязана быть видимой и одна за раз:
 *   • `frame(title, run)` объявляет начало, обещает конец даже при ошибке и
 *     не пускает вторую операцию;
 *   • `report(status)` пересылает фазы движка в окно;
 *   • `isBusy()`/`describe()` читает обработчик закрытия окна, чтобы назвать
 *     в вопросе то, что действительно идёт.
 *
 * Замок общий с FiveM resource специально: обе операции трогают файлы игры, и
 * два независимых флага занятости означали бы, что окно знает про одну и не
 * знает про другую.
 *
 * Подготовка игры (`PREPARE_GAME`) пишет в тот же архив, но кнопкой «Применить» её не
 * вытеснить: она идёт при запуске и после правок, до минуты и больше. Работа, начатая
 * посреди неё, раньше падала на сверке архива («изменился, пока шла установка», проба
 * 04.11.2026). Теперь она занимает замок сразу, показывает «ждём подготовку» и начинает,
 * когда подготовка закончилась. Подготовка в обратную сторону отказывает, пока замок
 * занят (`assertNoWorkshopWrite`), так что ждущая работа и подготовка друг друга не ждут.
 */

import { RESTORE_POINTS_MOVING_MESSAGE, restorePointsMoving } from "./restore-points-move.js";

export const WORKSHOP_BUSY_MESSAGE =
  "Мастерская уже применяет изменения в игру. Дождитесь окончания.";

/* Фаза ожидания: окно называет её подписью этапа (`install-phase.js`) и не считает записью в игру. */
export const WAIT_PREPARE_PHASE = "wait-prepare";

/*
 * Каналы, которые пишут в файлы игры, и как называть их человеку.
 *
 * Список — по каналу, а не по модулю: у каждого редактора своя форма
 * зависимостей, а имя канала одно и то же в любом из них, и десять модулей,
 * каждый со своей обёрткой, — это десять мест, где про замок можно забыть.
 * Забыть здесь дорого: пропущенный канал означает окно, которое молчит сорок
 * секунд и закрывается посреди подмены update.rpf.
 *
 * Названия взяты с плиток Мастерской: человек читает в вопросе при закрытии
 * то же слово, по которому только что нажал «Применить».
 */
export const GAME_WRITING_CHANNELS = Object.freeze({
  /* Корзина библиотеки: снимает работы мастерской и моды каталога разом,
     перематывая update.rpf, — та же запись в игру, и окно обязано её видеть. */
  LIBRARY_REMOVE: "Удаление из игры",
  /* Новая версия работы встала — прежняя уходит из стопки. */
  LIBRARY_RETIRE: "Замена прежней версии",
  /* «Установить снова» после проверки файлов игры: моды и работы — разом. */
  LIBRARY_REINSTALL: "Установка заново",
  /* «Что стоит в игре» (Т-170): то же снятие, но любых вещей разом. */
  INSTALLED_UNINSTALL: "Удаление из игры",
  WORKSHOP_APPLY_ARENA: "Арена",
  WORKSHOP_REMOVE_ARENA: "Арена",
  WORKSHOP_APPLY_CLIMBS: "Залазы",
  WORKSHOP_REMOVE_CLIMBS: "Залазы",
  WORKSHOP_APPLY_INTERIOR: "Интерьеры",
  WORKSHOP_REMOVE_INTERIOR: "Интерьеры",
  WORKSHOP_APPLY_KILL_EFFECT: "Килл-эффект",
  /* Замены анимаций: пересборка архива игры (словарь клипов цели), как у остальных редакторов. */
  ANIMATIONS_APPLY_INSTALL: "Анимации",
  ANIMATIONS_REMOVE_INSTALL: "Анимации",
  WORKSHOP_APPLY_SCREEN_HITS: "Эффекты попадания на экране",
  RESHADE_APPLY: "ReShade",
  RESHADE_REMOVE: "ReShade",
  /* «Сбросить GTA до стандартной»: лишнее из папки игры — в карантин и обратно. */
  STOCK_RESET_APPLY: "Сброс GTA до стандартной",
  STOCK_QUARANTINE_RESTORE: "Сброс GTA до стандартной",
  WORKSHOP_APPLY_MAP: "Большая карта",
  WORKSHOP_REMOVE_MAP: "Большая карта",
  WORKSHOP_APPLY_MEGA_MALL: "Мегамолл",
  WORKSHOP_REMOVE_MEGA_MALL: "Мегамолл",
  WORKSHOP_APPLY_MINIMAP: "Мини-карта",
  /* Починка фильма мини-карты при запуске (`minimap-film-repair.js`). */
  WORKSHOP_APPLY_MINIMAP_FILM_REPAIR: "Мини-карта",
  WORKSHOP_APPLY_GPS: "Метки и GPS",
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  WORKSHOP_APPLY_TARGET_HP: "Полоска HP",
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  WORKSHOP_APPLY_GROUP_MARKERS: "Групповые метки",
  /* «Иконки» большой карты (05.11.2026). */
  WORKSHOP_APPLY_BLIP_ICONS: "Значки карты",
  /* «Дым из-под колёс» (задача 1 ТЗ 11.10.2026, вечер). */
  WORKSHOP_APPLY_WHEEL_SMOKE: "Настройка автомобиля",
  WORKSHOP_APPLY_PTFX: "Эффекты попадания",
  WORKSHOP_APPLY_RETICLE: "Прицел",
  WORKSHOP_APPLY_SOUND_PACK: "Набор звуков",
  WORKSHOP_REMOVE_SOUND_PACK: "Набор звуков",
  WORKSHOP_SOUND_APPLY: "Звуки",
  WORKSHOP_SOUND_REMOVE: "Звуки",
  WORKSHOP_APPLY_STREET_LIGHTS: "Фонари",
  WORKSHOP_REMOVE_STREET_LIGHTS: "Фонари",
  WORKSHOP_DISABLE_STREET_LIGHTS: "Фонари",
  WORKSHOP_APPLY_TIMECYCLE: "Таймциклы",
  WORKSHOP_APPLY_LAMPS: "Фонари",
  WORKSHOP_APPLY_WALLBANG: "Прострелы",
  WORKSHOP_APPLY_ANIMALS: "Животные",
  WORKSHOP_APPLY_ZONES: "Зоны",
  WORKSHOP_APPLY_FACTORY: "Завод",
  WORKSHOP_APPLY_HANGAR: "Ангар",
  WORKSHOP_APPLY_MAPPING: "Маппинг",
  WORKSHOP_APPLY_ARENAS: "Арена",
  WORKSHOP_APPLY_OPTIMIZATION_LAYER: "Оптимизация",
  WORKSHOP_APPLY_VEGETATION: "Растительность",
  WORKSHOP_APPLY_WATER: "Вода",
  WORKSHOP_APPLY_FONTS: "Шрифты",
  WORKSHOP_APPLY_MEGAMALL: "Мегамолл",
  WORKSHOP_APPLY_YOUTOOL: "Ашан / Икея",
  WORKSHOP_APPLY_VINEWOOD: "Вайнвуд",
  WORKSHOP_APPLY_BUSSTOPS: "Остановки",
  WORKSHOP_APPLY_MSLZONES: "МСЛ-зоны",
  WORKSHOP_APPLY_FLOATLOGO: "Летающее лого",
  /* «Дирижабли» (ТЗ 11.10.2026). */
  WORKSHOP_APPLY_AIRSHIPS: "Дирижабли",
  WORKSHOP_APPLY_SHOPS: "Интерьеры",
  WORKSHOP_APPLY_BILLBOARDS: "Билборды",
  WORKSHOP_APPLY_CAPTZONES: "Зоны каптов",
  WORKSHOP_APPLY_SCHEDULE: "Расписание",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  WORKSHOP_APPLY_FLAGS: "Флаги",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  WORKSHOP_APPLY_ATMS: "Банкоматы",
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
  WORKSHOP_APPLY_PROJECTINTERIORS: "Интерьеры проектов",
  WORKSHOP_APPLY_MAJESTICINTERIORS: "Интерьеры Majestic RP",
  WORKSHOP_APPLY_ROADS: "Дороги",
  WORKSHOP_APPLY_WEAPON_SKIN: "Скин оружия",
  WORKSHOP_REMOVE_WEAPON_SKIN: "Скин оружия",
  WORKSHOP_APPLY_GUNPACK: "Ганпак",
  WORKSHOP_REMOVE_GUNPACK: "Ганпак",
  WORKSHOP_REMOVE_GUNPACK_MODEL: "Ганпак",
  WORKSHOP_APPLY_PACK_SKIN: "Скин оружия",
  WORKSHOP_REMOVE_PACK_SKIN: "Скин оружия",
  WORKSHOP_APPLY_CLOTHING_SKIN: "Покраска одежды",
  WORKSHOP_REMOVE_CLOTHING_SKIN: "Покраска одежды",
  CLOTHING_REPLACE_APPLY: "Замена одежды",
  WORKSHOP_APPLY_SERVER_TATTOO: "Тату сервера",
  /* Тату игры (задача 10): пакет в Astral Clothing DLC — запись в игру. */
  WORKSHOP_APPLY_TATTOO_PAINT: "Тату",
  /* «Бороды игры» (c2f989530, 16.11): лист бороды ставится пакетом в Astral Clothing DLC тем же `installTattooPaintBuilt`, что и покраска тату, — запись в игру, значит под замком. Канал сняли с рамки, забыв назвать здесь. */
  WORKSHOP_APPLY_GAME_BEARD: "Борода игры",
});

/*
 * Какой рассказ показывает окно. У установки шаги «резервная копия → сборка
 * → применение», у удаления из библиотеки свои: архив перематывается, моды
 * снимаются, работы, лежавшие сверху, встают обратно. Канал без записи здесь
 * — установка.
 */
export const GAME_WRITING_FLOWS = Object.freeze({
  LIBRARY_REMOVE: "removal",
  LIBRARY_RETIRE: "removal",
  INSTALLED_UNINSTALL: "removal",
  /* «Установить снова»: свои шаги — моды движка, потом работы хоста. */
  LIBRARY_REINSTALL: "reinstall",
});

/*
 * Изменяющие каналы, которые файлы игры не трогают, — и почему. Список
 * существует ради теста: он требует, чтобы каждый `APPLY`/`REMOVE` контракта
 * был назван в одном из двух списков, и следующий редактор нельзя будет
 * завести молча.
 */
export const NON_GAME_WRITING_CHANNELS = Object.freeze({
  WORKSHOP_APPLY_OPTIMIZER: "правит settings.xml, своя полоса и свой откат",
  WORKSHOP_ROLLBACK_OPTIMIZER: "правит settings.xml, своя полоса и свой откат",
  WORKSHOP_APPLY_RESOURCE: "папка resources сервера FiveM, свой замок",
  WORKSHOP_ROLLBACK_RESOURCE: "папка resources сервера FiveM, свой замок",
  WORKSHOP_IMPORT_GUNPACK: "разбирает ганпак в библиотеку приложения",
  WORKSHOP_IMPORT_MEGA_MALL_PROJECT: "кладёт проект в хранилище приложения",
  WORKSHOP_IMPORT_MEGA_MALL_SOURCE: "кладёт картинку в хранилище приложения",
});

/*
 * Обёртка над `handleIpc`: канал из списка выше идёт в рамке замка.
 *
 * Оборачивается именно регистрация, а не каждый обработчик по месту: так у
 * замка одна дверь, и добавить редактор мимо неё нельзя — новый канал либо
 * назван в списке, либо тест скажет, что его забыли.
 */
/* Каналы, что снимают, выключают и возвращают: для плашки первой установки это не установка. */
const NOT_AN_INSTALL = /(^|_)(REMOVE|DISABLE|RESET|RESTORE|UNINSTALL|RETIRE)(_|$)/;

export function guardGameWrites({ IPC, handleIpc, operations }) {
  const titles = new Map(
    Object.entries(GAME_WRITING_CHANNELS)
      .map(([key, title]) => [
        IPC[key],
        { title, flow: GAME_WRITING_FLOWS[key] || "install", installs: !GAME_WRITING_FLOWS[key] && !NOT_AN_INSTALL.test(key) },
      ])
      .filter(([channel]) => channel),
  );
  return (channel, handler) => {
    const framing = titles.get(channel);
    return handleIpc(
      channel,
      framing
        ? (event, input) =>
            operations.frame(framing.title, () => handler(event, input), {
              flow: framing.flow,
              installs: framing.installs,
            })
        : handler,
    );
  };
}

/*
 * Фазы движка приходят с процентами шкалы магазина, где 0–90 — это скачивание
 * пакета. У Мастерской скачивания нет вовсе, и та же шкала показала бы 90 %
 * на первой секунде и 100 % на последней. Проценты сюда не переносятся: окно
 * считает шкалу само — по фазе и по байтам там, где движок их присылает.
 */
const trackedPhase = (status) => {
  const phase = String(status?.phase || "").trim();
  return phase || "prepare";
};

/*
 * Байты шага — не чаще пяти раз в секунду (задача 1 ТЗ 08.10, вечер).
 *
 * Копия архива движка шлёт ход каждые 50 мс, хост — пять раз в секунду, и
 * всё это уходило в окно как есть. В окне каждое событие — новый снимок
 * очереди мастерской, а на нём перерисовывалась оболочка со всей страницей:
 * во время «Применить» интерфейс «долбился». Полосе пять шагов в секунду
 * хватает с запасом. То, что человек обязан увидеть сразу, не ждёт: начало и
 * конец операции, смена шага, «прервать уже нельзя», конец шага (все байты),
 * ход по вещам — и вытесняет отложенное, поэтому старое не приходит после
 * нового.
 */
export const WORKSHOP_BYTES_INTERVAL_MS = 200;

/*
 * `otherWriter` — кто ещё пишет в файлы игры мимо этого замка: очередь
 * загрузок каталога со своим движком. Раньше замок знал только про себя, и
 * работа мастерской могла начать пересборку update.rpf посреди установки из
 * каталога — две записи в один архив разом. Функция возвращает причину
 * отказа словами или пустоту; спрашивается она только у записи в игру
 * (`frame`), а не у FiveM resource — тот пишет в папку сервера.
 */
export function createWorkshopOperations({
  send,
  clock = Date.now,
  otherWriter = () => "",
  /* Запись в игру закончилась — удачно или нет. Главный процесс ставит
     сюда уборку кэша (`cache-housekeeping.js`): каждая запись оставляет
     копии update.rpf по два гигабайта. */
  onSettled = () => {},
  /* Перед записью в игру — место в бюджете «Хранилища» (`makeRoomForGameWrite`); отказ запись не держит. */
  beforeWrite = () => {},
  /* Началась установка (не снятие): главный процесс предлагает «Быструю установку», если ещё не предлагал. */
  onInstallStart = () => {},
  bytesIntervalMs = WORKSHOP_BYTES_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const installStartWatchers = new Set();
  let current = null;
  let publishedAt = -Infinity;
  let deferred = null;
  /* Подготовки игры, которые идут сейчас: работа мастерской начинает, когда их нет. */
  const preparing = new Set();

  const snapshot = () =>
    current
      ? {
          active: true,
          title: current.title,
          flow: current.flow,
          phase: current.phase,
          detailed: current.detailed,
          startedAt: current.startedAt,
          ...(current.waiting ? { waiting: current.waiting } : {}),
          cancellable: current.cancellable,
          copiedBytes: current.copiedBytes,
          totalBytes: current.totalBytes,
          ...(current.steps ? { steps: current.steps } : {}),
          ...(current.items ? { items: current.items } : {}),
          ...(current.dependent ? { dependent: current.dependent } : {}),
        }
      : { active: false };

  const publish = () => {
    if (deferred) clearTimer(deferred);
    deferred = null;
    publishedAt = clock();
    try {
      send(snapshot());
    } catch {
      /* Окно могло закрыться между фазами: операция от этого не падает. */
    }
  };

  /* Только байты того же шага: последнее значение уходит в конце окна. */
  const publishBytes = () => {
    const wait = bytesIntervalMs - (clock() - publishedAt);
    if (wait <= 0) {
      publish();
      return;
    }
    if (deferred) return;
    deferred = setTimer(() => {
      deferred = null;
      if (current) publish();
    }, wait);
  };

  const begin = (title, { flow = "install", waiting = "" } = {}) => {
    if (current) throw new Error(WORKSHOP_BUSY_MESSAGE);
    current = {
      title: String(title || "Изменения в игре"),
      flow: flow === "removal" || flow === "reinstall" ? flow : "install",
      startedAt: clock(),
      waiting,
      phase: waiting ? WAIT_PREPARE_PHASE : "prepare",
      /*
       * До первой фазы операция — это имя, часы и предупреждение. Фазы
       * присылают движок установки (`onProgress`) и нативный хост
       * (`hostProgress`); старый хост, собранный до хода в stderr, не
       * присылает ничего, и расписывать ему шаги, которых никто не
       * подтверждал, значит рисовать «Подготовку» все сорок секунд подряд.
       */
      detailed: false,
      cancellable: true,
      copiedBytes: 0,
      totalBytes: 0,
    };
    publish();
  };

  const end = () => {
    if (!current) return;
    current = null;
    publish();
  };

  /* Приёмник `onProgress` движка. Событие вне рамки игнорируется: так в
     окно не попадёт фаза от установки из магазина, у которой своя очередь и
     своя полоса. */
  const report = (status) => {
    if (!current) return;
    /* Пересборка пакета поверх работы (растительность над дорогами и т. п.; 22.11.2026): ступень называется отдельно, фаза и байты остаются прежними. */
    if (status?.dependent && typeof status.dependent === "object" && status.phase === undefined) {
      const { set, state, base } = status.dependent;
      if (state === "start") current.dependent = { set: String(set || ""), base: String(base || ""), stage: "build" };
      else if (current.dependent && current.dependent.set === String(set || "")) delete current.dependent;
      publish();
      return;
    }
    if (current.dependent) {
      /* Ход сборки пакета: доля 0…1 только от самой сборки (растительность отдаёт её честно); запись в архив игры — следующая ступень, чисел у неё нет. */
      if (status?.step && status.step === current.dependent.set) {
        const fraction = Number.isFinite(status.fraction) ? status.fraction : Number(status.total) > 0 ? Number(status.done) / Number(status.total) : null;
        if (fraction !== null && current.dependent.stage === "build") {
          const next = Math.max(Number(current.dependent.fraction) || 0, Math.min(1, Math.max(0, fraction)));
          if (next !== current.dependent.fraction) current.dependent = { ...current.dependent, fraction: next };
          publishBytes();
        }
        return;
      }
      if (status?.phase !== undefined && current.dependent.stage === "build") current.dependent = { set: current.dependent.set, base: current.dependent.base, stage: "write" };
    }
    /* Только ход по вещам («Что стоит в игре») — фаза и байты остаются прежними. */
    if (status?.items && typeof status.items === "object" && status.phase === undefined) {
      current.items = { ...current.items, ...status.items };
      publish();
      return;
    }
    const phase = trackedPhase(status);
    const cancellable = status?.cancellable !== false;
    const copiedBytes = Number(status?.copiedBytes) || 0;
    const totalBytes = Number(status?.totalBytes) || 0;
    /* Что окно обязано увидеть сразу; иначе это только байты шага. */
    const urgent =
      phase !== current.phase ||
      !current.detailed ||
      cancellable !== current.cancellable ||
      Array.isArray(status?.steps) ||
      (status?.items && typeof status.items === "object") ||
      (totalBytes > 0 && copiedBytes >= totalBytes);
    current.phase = phase;
    current.detailed = true;
    current.cancellable = cancellable;
    /* Байты принадлежат тому шагу, который их прислал. Запоминать их
       дальше нельзя: окно показывало бы размер резервной копии, пока helper
       молча собирает архив, — то есть число, которое давно не про то, что
       происходит. */
    current.copiedBytes = copiedBytes;
    current.totalBytes = totalBytes;
    /* Удаление заранее знает, какие шаги у него будут, и говорит об этом
       окну: шагов, которых не случится, рисовать незачем. */
    if (Array.isArray(status?.steps))
      current.steps = status.steps.slice(0, 8).map(String);
    /* «Что стоит в игре»: ход по каждой вещи — ждёт / идёт / снято. */
    if (status?.items && typeof status.items === "object")
      current.items = { ...current.items, ...status.items };
    if (urgent) publish();
    else publishBytes();
  };

  return Object.freeze({
    isBusy: () => current !== null,
    describe: () => (current ? { title: current.title, ...(current.dependent ? { dependent: { set: current.dependent.set, base: current.dependent.base } } : {}) } : null),
    begin,
    end,
    report,

    /*
     * Ход нативного хоста (`install-rpf-patch`): резервная копия, сборка,
     * сверка — с байтами. Идёт тем же путём, что фазы движка, с одним
     * исключением: внутри удаления из библиотеки хост ставит обратно работы,
     * лежавшие сверху, и его «Резервная копия» там — часть шага «Возврат
     * остального», а не свой шаг. Удаление рассказывает о себе само, и
     * «Установить снова» после проверки файлов игры — тоже.
     */
    hostProgress(status) {
      if (!current || current.flow !== "install") return;
      report(status);
    },

    /*
     * Подготовка игры под замком: пока она идёт, работа мастерской ждёт её конца. Регистрация
     * и проверка в `frame` — без единого `await` между ними и замком, поэтому щели, в которую
     * обе начали бы разом, нет.
     */
    async trackPrepare(task) {
      const done = (() => {
        let release = () => {};
        const promise = new Promise((resolve) => {
          release = resolve;
        });
        return { promise, release };
      })();
      preparing.add(done.promise);
      try {
        return await task();
      } finally {
        preparing.delete(done.promise);
        done.release();
      }
    },

    isPreparing: () => preparing.size > 0,

    /* Кому сказать, что началась установка (не снятие): хранилище предлагает «Быструю установку» (`desktop-storage.js`). */
    watchInstallStart(listener) {
      installStartWatchers.add(listener);
      return () => installStartWatchers.delete(listener);
    },

    async frame(title, run, options) {
      /* Точки отката переезжают с кэшем (`restore-points-move.js`): запись в игру ждёт конца. */
      const blocked = restorePointsMoving() ? RESTORE_POINTS_MOVING_MESSAGE : otherWriter();
      if (blocked) throw new Error(blocked);
      const { installs = false, ...shown } = options || {};
      begin(title, { ...shown, waiting: preparing.size > 0 ? "prepare" : "" });
      if (installs) {
        for (const tell of [onInstallStart, ...installStartWatchers]) {
          try {
            tell();
          } catch {
            /* Плашка — не часть операции и не вправе её уронить. */
          }
        }
      }
      try {
        if (current.waiting) {
          /* Замок занят нами, а не подготовкой: вторая работа не втиснется, окно видит ожидание. */
          while (preparing.size > 0) await Promise.all([...preparing]);
          const late = restorePointsMoving() ? RESTORE_POINTS_MOVING_MESSAGE : otherWriter();
          if (late) throw new Error(late);
          current.waiting = "";
          current.phase = "prepare";
          current.startedAt = clock();
          publish();
        }
        await Promise.resolve()
          .then(() => beforeWrite(title))
          .catch(() => {});
        return await run();
      } finally {
        end();
        try {
          onSettled();
        } catch {
          /* Уборка — не часть операции и не вправе её уронить. */
        }
      }
    },
  });
}
