/*
 * Каналы наборов перекраски: план и применение.
 *
 * План один на все наборы (только читает файлы набора и опись движка), а
 * «Применить» — свой канал у каждого: замок мастерской называет идущую
 * запись по каналу (`workshop-operations.js`), и человек при закрытии окна
 * читает «Завод» или «Зоны», а не безымянную «перекраску».
 * Применение идёт под предохранителем Legacy (игра закрыта, папка
 * подтверждена, копии update.rpf в mods нет). Снимаются наборы корзиной
 * библиотеки — как мод движка, по `layerModId` записи.
 */

import { legacyRuntimeGuard } from "./legacy-runtime-guard.js";
import { callNativeEngine } from "./native-engine.js";
import { compileWithGameDonor } from "./game-donor.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { appLog } from "./app-log.js";
import { buildShopSceneOffThread } from "./shop-scene-host.js";
import { createGameReadHost } from "./game-read-host.js";
import { journalInstall } from "./install-journal.js";

/* Читатели игры для окна — в своих потоках с пределом памяти (18.10, вылеты ssazzy). */
const texturesReader = createGameReadHost({ module: new URL("./workshop-textures.js", import.meta.url).href });
const fontsReader = createGameReadHost({ module: new URL("./recolor-fonts.js", import.meta.url).href });
import { registerLayerRebuilder } from "./layer-works.js";
import { holdHousekeeping } from "./cache-housekeeping.js";

/* Набор → канал «Применить» и имя для предохранителя. */
export const RECOLOR_APPLY_CHANNELS = Object.freeze({
  zones: Object.freeze({ key: "WORKSHOP_APPLY_ZONES", genitive: "зон", title: "Зоны" }),
  factory: Object.freeze({ key: "WORKSHOP_APPLY_FACTORY", genitive: "завода", title: "Завод" }),
  hangar: Object.freeze({ key: "WORKSHOP_APPLY_HANGAR", genitive: "ангара", title: "Ангар" }),
  mapping: Object.freeze({ key: "WORKSHOP_APPLY_MAPPING", genitive: "маппинга", title: "Маппинг" }),
  arenas: Object.freeze({ key: "WORKSHOP_APPLY_ARENAS", genitive: "арены", title: "Арена" }),
  /* Вода и растительность — наборы без файлов мода: собираются из игры игрока. */
  water: Object.freeze({ key: "WORKSHOP_APPLY_WATER", genitive: "воды", title: "Вода" }),
  vegetation: Object.freeze({ key: "WORKSHOP_APPLY_VEGETATION", genitive: "растительности", title: "Растительность" }),
  /* Шрифты — тоже без файлов мода: библиотеки шрифтов игры игрока. */
  fonts: Object.freeze({ key: "WORKSHOP_APPLY_FONTS", genitive: "шрифтов", title: "Шрифты" }),
  /* Здания из игры — штатные файлы игры игрока с правками и плашками. */
  megamall: Object.freeze({ key: "WORKSHOP_APPLY_MEGAMALL", genitive: "Мегамолла", title: "Мегамолл" }),
  youtool: Object.freeze({ key: "WORKSHOP_APPLY_YOUTOOL", genitive: "Ашана / Икеи", title: "Ашан / Икея" }),
  vinewood: Object.freeze({ key: "WORKSHOP_APPLY_VINEWOOD", genitive: "надписи Вайнвуд", title: "Вайнвуд" }),
  busstops: Object.freeze({ key: "WORKSHOP_APPLY_BUSSTOPS", genitive: "остановок", title: "Остановки" }),
  mslzones: Object.freeze({ key: "WORKSHOP_APPLY_MSLZONES", genitive: "МСЛ-зон", title: "МСЛ-зоны" }),
  floatlogo: Object.freeze({ key: "WORKSHOP_APPLY_FLOATLOGO", genitive: "летающего лого", title: "Летающее лого" }),
  /* «Дирижабли» (ТЗ 11.10.2026): дирижабль игры с надписью работы и летающие в небе. */
  airships: Object.freeze({ key: "WORKSHOP_APPLY_AIRSHIPS", genitive: "дирижаблей", title: "Дирижабли" }),
  /* Интерьеры — помещения магазинов из файлов игры игрока (задача 3 ТЗ 10.10.2026). */
  shops: Object.freeze({ key: "WORKSHOP_APPLY_SHOPS", genitive: "интерьеров", title: "Интерьеры" }),
  /* Билборды — рекламные щиты из файлов игры игрока (задача 4 ТЗ 10.10.2026, вечер). */
  billboards: Object.freeze({ key: "WORKSHOP_APPLY_BILLBOARDS", genitive: "билбордов", title: "Билборды" }),
  /* Зоны каптов — свои модели шайб мода heix (задача 8 ТЗ 10.10.2026, вечер). */
  captzones: Object.freeze({ key: "WORKSHOP_APPLY_CAPTZONES", genitive: "зон каптов", title: "Зоны каптов" }),
  /* Расписание — свои модели табло на местах табло сервера Majestic (задача 11 ТЗ 10.10.2026, вечер). */
  schedule: Object.freeze({ key: "WORKSHOP_APPLY_SCHEDULE", genitive: "расписания", title: "Расписание" }),
  /* Флаги — лист полотнища в штатных флагах игры игрока, ткань штатная (задача 7 ТЗ 10.10.2026, вечер). */
  flags: Object.freeze({ key: "WORKSHOP_APPLY_FLAGS", genitive: "флагов", title: "Флаги" }),
  /* Банкоматы — листы, палитры и свечение штатных банкоматов игры игрока (задача 4 ТЗ 17.10.2026). */
  atms: Object.freeze({ key: "WORKSHOP_APPLY_ATMS", genitive: "банкоматов", title: "Банкоматы" }),
  /* Интерьеры проектов — интерьеры из файлов игрока, каждый в своём контейнере (задача 10 ТЗ 17.10.2026, вечер). */
  projectinteriors: Object.freeze({ key: "WORKSHOP_APPLY_PROJECTINTERIORS", genitive: "интерьеров проектов", title: "Интерьеры проектов" }),
  /* Интерьеры Majestic RP — перекрашенные листы интерьеров сервера поверх файлов игрока (Хелпер 7, 25.10.2026). */
  majesticinteriors: Object.freeze({ key: "WORKSHOP_APPLY_MAJESTICINTERIORS", genitive: "интерьеров Majestic RP", title: "Интерьеры Majestic RP" }),
  /* Дороги — без файлов мода: словари карты игрока (задача 6 ТЗ 07.10.2026). */
  roads: Object.freeze({ key: "WORKSHOP_APPLY_ROADS", genitive: "дорог", title: "Дороги" }),
});

/*
 * Сборщик наборов (`recolor-customizer.js`) и сцена «Интерьеров» грузятся по первому вызову (22.10.2026): с ними в
 * главный процесс приходят инвентари покраски, векторная карта и sharp — ~190 модулей и 8 МБ исходников. Окно
 * зовёт этот модуль ради чтения листов (`WORKSHOP_TEXTURES`: обложки каталога пекутся с главной), а чтения идут в
 * потоках и сборщика не требуют.
 */
/* Поля хода для строки прогресса в окне: то, что она показывает; остальное остаётся в журнале операций. */
function planProgressFields(status) {
  const out = {
    step: String(status?.step || ""),
    phase: String(status?.phase || ""),
    done: Number(status?.done) || 0,
    total: Number(status?.total) || 0,
  };
  if (status?.stage) out.stage = String(status.stage);
  /* `fraction` — доля хода сборки набора 0…1, не убывает (18.11.2026: процент в «Подготовке» с первой секунды). */
  /* `doneBytes` / `totalBytes` — пока окно считает процент по ним; уйдут, когда оно перейдёт на `fraction`. */
  for (const key of ["stageDone", "stageTotal", "bytes", "fraction", "doneBytes", "totalBytes", "archivesDone", "archivesTotal"]) if (Number.isFinite(status?.[key])) out[key] = status[key];
  if (status?.lastName) out.lastName = String(status.lastName).slice(0, 200);
  if (status?.stages && typeof status.stages === "object") {
    out.stages = Object.fromEntries(
      Object.entries(status.stages).map(([id, value]) => [id, { done: Number(value?.done) || 0, total: Number(value?.total) || 0 }]),
    );
  }
  return out;
}

/*
 * Ход плана в окно — не чаще раза в `everyMs` (IPC-троттлинг, 4 раза в секунду). Последнее событие не теряется:
 * оно уходит по таймеру, когда окно догонит.
 */
function throttledSend(send, everyMs = 250) {
  let last = 0;
  let pending = null;
  let timer = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const next = pending;
    pending = null;
    last = Date.now();
    send(next);
  };
  return (payload) => {
    pending = payload;
    const wait = last + everyMs - Date.now();
    if (wait <= 0) flush();
    else if (!timer) timer = setTimeout(flush, wait);
  };
}

/*
 * Каталог состояния для обработчиков «только чтение для кадра» (листы, сцены помещения и места мира, шрифты; 18.11.2026).
 *
 * `installOptions()` готовит корень кэша хранилища (`storage-manager.js: ensure`), и этот шаг может отказать, пока читать игру ему не мешает ничего: в стенде «Арен» перенос чужой папки в корне кэша
 * (кэш Chromium `Cache_Data`, он занят) давал EPERM, и все 27 просьб листов (9 пачек × 3 попытки) отклонялись за 9–39 мс — кадр оставался в среднем цвете. Чтению каталог нужен лишь как папка для своего кэша
 * (и ключей/оттисков), поэтому отказ хранилища ему не помеха. Порядок запасных: последний удачный каталог этого процесса; не было удачного — `null` (кэш во временной папке, листы игры «поверх мода»
 * не видны: `overModsOf` без каталога состояния даёт пустой набор). `orNull: false` (шрифты: каталог читают как состояние установки, `inspectProfile(null)` бросает) — без удачного запасного отказ остаётся отказом.
 * Каждая следующая просьба снова пробует `installOptions()`: подготовилось — возвращаемся на нормальный каталог. Отказ не глотается молча: предупреждение в журнал приложения, раз на череду отказов подряд.
 * Установка и запись в игру (`service()` ниже, каналы «Применить», план) этим путём не ходят: хранилище не готово — они обязаны падать.
 */
export function createFrameStateDir({ installOptions, log = () => {} }) {
  let last = null;
  let failing = false;
  return async function frameStateDir(label, { orNull = true } = {}) {
    try {
      const { stateDir } = await installOptions();
      if (stateDir) last = stateDir;
      failing = false;
      return stateDir;
    } catch (error) {
      if (!failing) {
        failing = true;
        log({
          level: "warn",
          source: "recolor-ipc",
          message: `Хранилище кэша не подготовилось (${label}): ${String(error?.message || error).slice(0, 300)}; чтение для кадра идёт ${last ? "с прежним каталогом состояния" : orNull ? "без каталога состояния (временная папка)" : "без запасного каталога — отказ остаётся"}.`,
        });
      }
      if (last) return last;
      if (orNull) return null;
      throw error;
    }
  };
}

export function registerRecolorIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  operations = null,
  nativeContext = null,
  texturesHost = texturesReader,
  /* Привести память сборки к пределу кэша (`storage-manager.js`, `trimBuildMemory`); без него — ничего. */
  trimBuildMemory = null,
}) {
  const frameStateDir = createFrameStateDir({ installOptions, log: (entry) => appLog.record(entry) });
  /* После плана и после установки набора собранное не лежит сверх предела кэша человека (18.11.2026): отказ «не помещается»
     оставлял 7,35 ГБ при пределе 2 ГБ. Ответ окну этого не ждёт, сбой уборки работу не роняет. */
  const settleBuildMemory = () => {
    if (typeof trimBuildMemory !== "function") return;
    Promise.resolve()
      .then(() => trimBuildMemory())
      .then((trimmed) => {
        if (trimmed?.removed > 0)
          appLog.record({
            level: "info",
            source: "storage",
            message: `память сборки сверх предела кэша: убрано ${trimmed.removed} файлов, ${Math.round(trimmed.freedBytes / (1024 * 1024))} МБ`,
          });
      })
      .catch(() => {});
  };
  let servicePromise;
  /*
   * Служба перекраски: одна на успех, а отказ не запоминается (18.11.2026). `installOptions()` мог отказать временно — хранилище кэша занято (стенд «Арен»: перенос занятой папки Chromium, EPERM), и запомненное отклонение ломало бы план и «Применить» до перезапуска Astral.
   * Одновременные вызовы во время полёта делят один Promise (один вызов `installOptions()`); отклонённый сбрасывается, следующий вызов пробует заново. Установка по-прежнему падает, пока хранилище не готово.
   */
  const service = () => {
    if (!servicePromise) {
      const created = Promise.all([installOptions(), import("./recolor-customizer.js")]).then(([{ stateDir }, { createRecolorService }]) =>
        createRecolorService({
          stateDir,
          /* Плашка эмблемы завода и звезда арены — нативный хост в общей очереди моста; донор из игры добавляется здесь. */
          tools: {
            compile: (command, input) =>
              compileWithGameDonor(command, input, {
                stateDir,
                context: nativeContext?.(),
                call: callNativeEngine,
                provision: provisionArchiveSupport,
                log: (entry) => appLog.record(entry),
              }),
          },
          /* Фазы пересборки уходят в окно: без них «Применить» молчит
             десятки секунд, и это выглядит как зависание. */
          onProgress: (status) => {
            operations?.report(status);
            /* Ход плана — в окно по номеру работы; без активного плана — только в журнал операций. */
            if (planProgress) planProgress.send({ ...planProgressFields(status), operationId: planProgress.operationId });
          },
        }),
      );
      servicePromise = created;
      created.catch(() => {
        if (servicePromise === created) servicePromise = undefined;
      });
    }
    return servicePromise;
  };

  /* Растительность и дороги собираются заново поверх сменившихся работ
     прямо в операции работы снизу (задача 3 ТЗ 10.10.2026). */
  for (const set of ["vegetation", "roads"])
    registerLayerRebuilder(set, async (work, context) => (await service()).rebuild(set, work, context));
  /* Арена — заново поверх мода каталога, когда его ставят или снимают
     (`rebuildArenaOverMods`, 16.10). */
  registerLayerRebuilder("arenas", async (work, context) => (await service()).rebuild("arenas", work, context));

  /* План перекраски можно отменить по его номеру работы (`operationId`): отмена прерывает сборку
     в потоке и не оставляет в игре ничего — план в игру не пишет. */
  const activePlans = new Map();
  /* Работа плана, чей ход идёт в окно: `{ operationId, send }`, пока план идёт. */
  let planProgress = null;
  handleIpc(IPC.WORKSHOP_PLAN_RECOLOR, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const operationId = String(value?.operationId || "").replace(/[^a-z0-9._-]/gi, "").slice(0, 120);
      delete value?.operationId;
      const controller = new AbortController();
      if (operationId) activePlans.set(operationId, controller);
      const previous = planProgress;
      if (operationId) planProgress = { operationId, send: throttledSend((payload) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.WORKSHOP_PLAN_PROGRESS, payload); }) };
      /* Сборка набора — минуты работы на всех ядрах и гигабайты записи (растительность у тестера альфы 0.9.0-beta.108 — 6,5 минуты).
         Замка записи в игру план не берёт, и фоновая уборка кэша стартовала посреди сборки: её ворота открываются через
         5 минут после запуска (`housekeeping-gate.js`), а сборку они работой не считали. Теперь уборка ждёт конца плана,
         а идущий проход встаёт на следующем блоке (18.11.2026). */
      const releaseHousekeeping = holdHousekeeping();
      try {
        return await (await service()).plan(value, { signal: controller.signal });
      } catch (error) {
        /* Память сборки приводится к пределу кэша только при отказе плана (18.11.2026, замер сессии скорости): после удачного плана
           перепись кэша шла бы секунды ровно между планом и «Применить» и могла сорвать переименование папки пакета (EPERM);
           после «Применить» чистка идёт всегда. */
        settleBuildMemory();
        throw error;
      } finally {
        releaseHousekeeping();
        planProgress = previous;
        if (operationId && activePlans.get(operationId) === controller) activePlans.delete(operationId);
      }
    }),
  );
  handleIpc(IPC.WORKSHOP_CANCEL_RECOLOR_PLAN, (event, input) =>
    trusted(event, async () => {
      const operationId = String(safeInput(input)?.operationId || "").replace(/[^a-z0-9._-]/gi, "").slice(0, 120);
      const controller = activePlans.get(operationId);
      controller?.abort();
      return { cancelled: Boolean(controller) };
    }),
  );

  /* Листы для 3D-кадров: из файлов наборов и из игры игрока, только чтение. */
  if (IPC.WORKSHOP_TEXTURES)
    handleIpc(IPC.WORKSHOP_TEXTURES, (event, input) =>
      trusted(event, async () => {
        /* Только чтение для кадра: отказ хранилища (`installOptions`) чтению не помеха (`createFrameStateDir`). */
        const stateDir = await frameStateDir("листы кадра");
        /* В своём потоке: листы тяжёлого редукса не роняют главный процесс. Буферы ответа (блоки BCn и WebP) уходят главному процессу
           передачей, а не копией: ответ пачки — единицы и десятки мегабайт, копия по дороге к окну лишняя. */
        return texturesHost.callWithTools("readWorkshopTextures", [safeInput(input), stateDir], null, { transfer: true });
      }),
    );

  /* «Интерьеры»: сцена 3D-кадра помещения из игры игрока, только чтение
     (задача 5 ТЗ 11.10.2026). */
  if (IPC.WORKSHOP_SHOP_SCENE)
    handleIpc(IPC.WORKSHOP_SHOP_SCENE, (event, input) =>
      trusted(event, async () => {
        const stateDir = await frameStateDir("сцена интерьера");
        /* Сборка — в потоке с пределом памяти: тяжёлый редукс роняет поток, а не Astral. */
        const { readShopScene } = await import("./recolor-shops-scene.js");
        return readShopScene(safeInput(input), stateDir, { build: buildShopSceneOffThread });
      }),
    );

  /* «Зоны»: сцена места мира по координатам из игры игрока, только чтение (ТЗ 01.11.2026). Сборка — в потоке, одна за раз. */
  if (IPC.WORKSHOP_WORLD_PLACE_SCENE)
    handleIpc(IPC.WORKSHOP_WORLD_PLACE_SCENE, (event, input) =>
      trusted(event, async () => {
        const stateDir = await frameStateDir("сцена места мира");
        const [{ readWorldPlaceScene }, { buildWorldPlaceOffThread }] = await Promise.all([import("./world-place-scene.js"), import("./world-place-host.js")]);
        return readWorldPlaceScene(safeInput(input), stateDir, { build: buildWorldPlaceOffThread });
      }),
    );

  /* Предпросмотр «Шрифтов»: шаблоны Windows и штатная библиотека игрока,
     только чтение. */
  if (IPC.WORKSHOP_FONT_SOURCES)
    handleIpc(IPC.WORKSHOP_FONT_SOURCES, (event, input) =>
      trusted(event, async () => {
        /* Шрифтам каталог нужен как состояние установки (`inspectProfile`): запасной — только последний удачный, без него отказ остаётся. */
        const stateDir = await frameStateDir("предпросмотр шрифтов", { orNull: false });
        return fontsReader.call("readFontSources", safeInput(input) || {}, { stateDir });
      }),
    );

  for (const [set, channel] of Object.entries(RECOLOR_APPLY_CHANNELS)) {
    if (!IPC[channel.key]) continue;
    const guard = legacyRuntimeGuard(channel.genitive, channel.title);
    handleIpc(IPC[channel.key], (event, input) =>
      trusted(event, async () => {
        const request = safeInput(input);
        if (request?.set && request.set !== set) throw new Error("Канал другого набора.");
        try {
          return await journalInstall(set, async () =>
            (await service()).apply({ ...request, set }, { assertRuntimeSafety: guard.assertRuntimeSafety }),
          );
        } finally {
          /* Пакет плана ушёл в игру или отказал: память сборки, что осталась без второй ссылки, — в пределах кэша. */
          settleBuildMemory();
        }
      }),
    );
  }
}
