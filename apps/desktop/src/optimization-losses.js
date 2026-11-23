import { driveOf, isHardDisk, isSolidState } from "./optimization-probe.js";

/*
 * Потери кадров, которые не чинятся галочкой.
 *
 * Раздел оптимизации умеет переключать схему питания, предпочтение видеокарты
 * и фоновую запись Xbox. Всё это правда помогает, но на проценты. Настоящие
 * потери у большинства людей лежат там, куда приложение дотянуться не может:
 * в параметрах экрана, в UEFI и в том, на какой диск поставлена игра. Их не
 * видно, потому что никто про них не говорит, — и человек считает, что
 * «оптимизация» это три галочки.
 *
 * Поэтому проверки ниже ничего не переключают и не притворяются, что могут.
 * Они называют потерю числом, которое сняли с этой машины, и говорят, где
 * именно её чинят. Совет без числа — это форум; число без совета — это
 * диспетчер задач; вместе они и есть работа.
 *
 * Ни одна из них не «actionable»: Astral не меняет разрешение экрана вслепую
 * и не ходит в UEFI. Обещать иное значило бы поставить кнопку, после которой
 * ничего не изменилось, — а по нажатой кнопке судят, что стало лучше.
 */

const GB = 1024 * 1024 * 1024;

/* Ниже этого запаса Windows начинает жать файл подкачки, а установка мода в
   update.rpf требует места под копию архива: два гигабайта на копию плюс два
   на собранный. Двадцать — это «работает», десять — «уже мешает». */
const DISK_TIGHT_GB = 20;
const DISK_CRITICAL_GB = 10;

/* Разброс в проценты — это погрешность опроса, а не выключенный профиль:
   5600 против 5593 бывает от округления. Три процента ловят настоящий разрыв
   (5200 против 5600 — это девять) и молчат на шуме. */
const MEMORY_TOLERANCE = 0.97;

/* Один герц разницы — округление режима, а не потерянные кадры. */
const REFRESH_TOLERANCE_HZ = 1;

const round = (value) => Math.round(Number(value) || 0);
const gb = (bytes) => Math.round((Number(bytes) || 0) / GB);

/**
 * Проверки «где теряются кадры» по одному опросу железа.
 *
 * `gamePath` нужен ровно для одного: понять, на каком диске лежит игра.
 * Без него проверка диска молчит, а не гадает по системному разделу.
 */
export function hardwareLossChecks(probe, gamePath = "") {
  /* Опрос, который ничего не вернул, не даёт ни одной находки: пустота — это
     «не знаю», а не «всё выключено». */
  if (!probe?.measured) return [];
  return [
    refreshRateCheck(probe),
    memorySpeedCheck(probe),
    gameDiskCheck(probe, gamePath),
    diskSpaceCheck(probe, gamePath),
    pageFileCheck(probe),
  ].filter(Boolean);
}

function refreshRateCheck(probe) {
  const current = round(probe.display?.currentHz);
  const max = round(probe.display?.maxHz);
  if (!current || !max) return null;
  const behind = max - current > REFRESH_TOLERANCE_HZ;
  return {
    id: "refresh-rate",
    group: "windows",
    title: behind
      ? `Экран работает на ${current} Гц из ${max}`
      : `Экран работает на своих ${current} Гц`,
    detail: behind
      ? `Панель поддерживает ${max} Гц, а Windows выдаёт ${current}. Пока это так, в игре не будет больше ${current} кадров в секунду — сколько бы их ни рисовала видеокарта. Меняется в Windows: Параметры → Система → Дисплей → Дополнительные параметры дисплея → Частота обновления.`
      : `Панель и Windows сходятся на ${current} Гц — выше этой отметки кадры в игре не поднимутся, и это нормально.`,
    status: behind ? "recommended" : "healthy",
    severity: behind ? "important" : "healthy",
    actionable: false,
    evidence: { currentHz: current, maxHz: max },
    effect: behind ? `потолок кадров ${current} вместо ${max}` : null,
  };
}

/*
 * Игра сама себе ставит потолок кадров.
 *
 * В `settings.xml` лежит своя частота обновления, и она не обязана совпадать
 * с той, что выдаёт Windows: игра записывает её при первом запуске и потом
 * держится за неё. Человек ставит 144-герцовый экран, Windows переключается,
 * а игра остаётся на шестидесяти — и сколько бы кадров ни рисовала
 * видеокарта, на экран выйдет шестьдесят.
 *
 * Допуск обязателен, и его величина взята с живой машины: там экран работает
 * на 144, а игра записала 143 — округление её собственного списка режимов, а
 * не потеря. Потерей считается разрыв больше пяти процентов.
 *
 * Действия здесь нет намеренно. Частота в игре связана с разрешением: список
 * поддерживаемых пар Astral не знает (панель отдаёт частоты сама по себе), а
 * записать неподдерживаемую значит оставить человека с игрой, которая не
 * запускается. Сказать, где поменять, — честнее, чем угадать за него.
 */
const GAME_REFRESH_TOLERANCE = 0.95;

export function gameRefreshCheck(probe, gameRefreshHz) {
  const screen = round(probe?.display?.currentHz);
  const game = round(gameRefreshHz);
  if (!probe?.measured || !screen || !game) return null;

  const behind = game < screen * GAME_REFRESH_TOLERANCE;
  return {
    id: "game-refresh",
    group: "gta",
    title: behind
      ? `В игре выбрано ${game} Гц из ${screen}`
      : `Игра выводит свои ${game} Гц`,
    detail: behind
      ? `Экран работает на ${screen} Гц, а GTA V записала в settings.xml ${game}. Выше ${game} кадров в секунду игра не поднимется, сколько бы их ни рисовала видеокарта. Меняется в самой игре: Настройки → Графика → Частота обновления.`
      : `Частота в игре сходится с экраном — потолок кадров здесь не занижен.`,
    status: behind ? "recommended" : "healthy",
    severity: behind ? "important" : "healthy",
    actionable: false,
    evidence: { gameHz: game, screenHz: screen },
    effect: behind ? `потолок кадров ${game} вместо ${screen}` : null,
  };
}

function memorySpeedCheck(probe) {
  const rated = round(probe.memory?.ratedMhz);
  const configured = round(probe.memory?.configuredMhz);
  if (!rated || !configured) return null;
  const slow = configured < rated * MEMORY_TOLERANCE;
  return {
    id: "memory-speed",
    group: "windows",
    title: slow
      ? `Память работает на ${configured} МГц из ${rated}`
      : `Память работает на своих ${configured} МГц`,
    detail: slow
      ? `Планки рассчитаны на ${rated} МГц, а идут на ${configured}: профиль XMP (Intel) или EXPO (AMD) не включён, и память работает на базовой частоте. GTA V упирается в задержку памяти сильнее, чем в видеокарту, поэтому здесь теряются заметные проценты кадров. Включается одной строкой в UEFI/BIOS при загрузке — Astral туда не лезет и лезть не должен.`
      : `Паспортная и рабочая частота совпадают: профиль памяти включён.`,
    status: slow ? "advisory" : "healthy",
    severity: slow ? "important" : "healthy",
    actionable: false,
    evidence: { ratedMhz: rated, configuredMhz: configured },
    effect: slow
      ? `память ниже своей частоты на ${rated - configured} МГц`
      : null,
  };
}

function gameDiskCheck(probe, gamePath) {
  const drive = driveOf(probe, gamePath);
  if (!drive) return null;
  const hdd = isHardDisk(drive);
  const ssd = isSolidState(drive);
  if (!hdd && !ssd) return null;
  return {
    id: "game-disk",
    group: "windows",
    title: hdd
      ? `Игра стоит на жёстком диске (${drive.letter}:)`
      : `Игра стоит на SSD (${drive.letter}:)`,
    detail: hdd
      ? "Мир GTA V подгружается на ходу, и на жёстком диске это видно рывками при быстрой езде и долгой загрузкой. Ни один ползунок графики этого не лечит: упирается не видеокарта, а диск. Перенос игры на SSD — самая большая разница, которую вообще можно получить."
      : "Подгрузка мира идёт с твердотельного диска — рывков от диска не будет.",
    status: hdd ? "advisory" : "healthy",
    severity: hdd ? "important" : "healthy",
    actionable: false,
    evidence: { letter: drive.letter, media: drive.media, bus: drive.bus },
    effect: hdd ? "подгрузка мира упирается в диск" : null,
  };
}

function diskSpaceCheck(probe, gamePath) {
  const drive = driveOf(probe, gamePath);
  if (!drive?.sizeBytes) return null;
  const free = gb(drive.freeBytes);
  const critical = free < DISK_CRITICAL_GB;
  const tight = free < DISK_TIGHT_GB;
  return {
    id: "disk-space",
    group: "windows",
    title: tight
      ? `На диске ${drive.letter}: осталось ${free} ГБ`
      : `Места на диске ${drive.letter}: хватает (${free} ГБ)`,
    detail: tight
      ? `Установка мода из Мастерской копирует update.rpf в резерв и собирает рядом новый: это около четырёх гигабайт сверх занятого. Windows на тесном диске ещё и жмёт файл подкачки, отчего игра начинает вылетать в местах, где раньше не вылетала.`
      : `Запаса хватает и на резервную копию архива игры, и на файл подкачки.`,
    status: critical ? "recommended" : tight ? "advisory" : "healthy",
    severity: critical ? "important" : tight ? "notice" : "healthy",
    actionable: false,
    evidence: {
      letter: drive.letter,
      freeBytes: drive.freeBytes,
      sizeBytes: drive.sizeBytes,
    },
    effect: tight ? `свободно ${free} ГБ` : null,
  };
}

function pageFileCheck(probe) {
  const page = probe.pageFile;
  if (!page) return null;
  const allocated = round(page.allocatedMb);
  const off = !page.automatic && allocated === 0;
  const small = !off && allocated > 0 && allocated < 4096;
  if (!off && !small) {
    return {
      id: "pagefile",
      group: "windows",
      title: "Файл подкачки на месте",
      detail: page.automatic
        ? "Размером управляет Windows — для GTA V этого достаточно."
        : `Задан вручную: ${allocated} МБ.`,
      status: "healthy",
      severity: "healthy",
      actionable: false,
      evidence: page,
    };
  }
  return {
    id: "pagefile",
    group: "windows",
    title: off
      ? "Файл подкачки выключен"
      : `Файл подкачки мал: ${allocated} МБ`,
    detail: off
      ? "GTA V резервирует памяти больше, чем занимает, и без файла подкачки вылетает на ровном месте — чаще всего при быстрой езде и на загрузке. Совет «отключить подкачку ради FPS» кочует по форумам с времён, когда оперативной памяти было два гигабайта; сегодня он ломает игру. Включается в Windows: Система → О системе → Дополнительные параметры системы → Быстродействие → Виртуальная память."
      : "Для GTA V этого мало: игра резервирует памяти больше, чем занимает, и упирается в потолок вылетом. Проще всего вернуть управление размером Windows — там же, в параметрах виртуальной памяти.",
    status: off ? "recommended" : "advisory",
    severity: off ? "important" : "notice",
    actionable: false,
    evidence: page,
  };
}
