/*
 * Листы сцены 3D-кадра: откуда берутся и как доезжают до видеокарты.
 *
 * У записи текстуры сцены (`scene.bin`, `textures[]`) один из трёх
 * источников:
 *
 *   file — картинка в поставке (`/assets/workshop/…`): листы авторов модов;
 *   set  — лист из файла набора рядом с приложением: реквизит мода несёт
 *          текстуры в самих моделях;
 *   game — лист из игры игрока по адресу (`x64t.rpf:…/cs4_13_build3.ytd`):
 *          штатный вид для «Стандарта» и соседей.
 *
 * `set` и `game` читает Astral Desktop (`readWorkshopTextures`): запросы
 * одного кадра собираются в одну пачку. В браузере без приложения их нет —
 * кадр рисует такую поверхность средним цветом, и подпись кадра говорит об
 * этом.
 *
 * Картинки кэшируются на всё окно (ImageBitmap): кадр редактора, обложка и
 * плитки готовых видов берут одну и ту же.
 *
 * Сжатые листы (этап 2): за выключателем `localStorage["astral.sheets.bcn.v1"] === "1"` кадр сцены просит у читателя не WebP, а блоки BCn, что видеокарта
 * заливает без раскодирования (`loadSceneSheet`; её зовёт только `orbit-stage.js: textureFor`). Листы для холста (`loadSceneImage`: ImageBitmap, пиксели) идут
 * как прежде и в блоки не переводятся; у блоков свой ключ кэша окна, с суффиксом.
 */

import { desktopHost, readWorkshopTextures } from "../../../api.js";
import { detectLegacyGame } from "../install-queue/game-root.js";
import { isSheetContainer, parseSheets } from "./sheet-container.js";
import { imageBudgetBytes, stageExperiments } from "./stage-exp.js";
import { noteImageCall, noteImageLoaded } from "./image-ledger.js";
import { stageMark, stageMarksOn } from "./stage-marks.js";

/*
 * Картинка из WebP читателя. По умолчанию — как всегда: `createImageBitmap(blob)` без параметров, то есть с предумноженной альфой (RGB уже умножен на альфу).
 * Шейдер сцены читает лист как прямой (`recolor-material.js`: цвет — `rcTexel.rgb`, альфа — отдельно), у сжатых листов (блоки BCn игры) альфа прямая,
 * поэтому у листов с полупрозрачными местами два пути расходятся (проба 15.11.2026, `scripts/perf/baseline/alpha-gl-probe.mjs`). Прямую альфу
 * (`premultiplyAlpha: "none"`) картинка получает в двух случаях:
 *   - `frame` — лист просит кадр сцены через `loadSceneSheet` при включённом выключателе сжатых листов (запись с блоками: её запасной WebP — WebP внутри контейнера
 *     или обычный WebP, когда блоки листу не годятся или читатель их не умеет). Так на одной сцене не смешиваются прямые блоки и затемнённые картинки;
 *   - опыт `straight-alpha` (`stage-exp.js`): для сравнения старого пути со сжатым при выключенном выключателе.
 * Листы для холста (`loadSceneImage`) и весь кадр при выключенном выключателе — прежний вызов с одним аргументом, до пикселя.
 */
function bitmapOfWebp(bytes, { frame = false } = {}) {
  const straight = frame || stageExperiments().has("straight-alpha");
  return stageExperiments().has("bitmap-thread") ? bitmapInThread(bytes, straight) : bitmapHere(bytes, straight);
}

/* Прежний путь: Blob и `createImageBitmap` в главном потоке. */
function bitmapHere(bytes, straight) {
  const blob = new Blob([bytes], { type: "image/webp" });
  return straight ? createImageBitmap(blob, { premultiplyAlpha: "none" }) : createImageBitmap(blob);
}

/* Лист потерян вместе с потоком картинок: не «нет в игре», а «не дошёл» — как отказ читателя (спросят заново после паузы, `sheetRetryable`). */
function lostToThread(key) {
  outcomes.set(key, "unavailable");
  readerFailed.set(key, typeof performance !== "undefined" ? performance.now() : Date.now());
}

/*
 * Опыт `bitmap-thread` (`bitmap-thread.js`, по умолчанию выключен): Blob и `createImageBitmap` — в потоке, байты уходят переносом. Потока нет или он не умеет — главный поток, как прежде (байты не тронуты);
 * поток упал с байтами — `null`: лист «ещё может приехать», его спросят заново, а не «в игре нет».
 */
function bitmapInThread(bytes, straight) {
  /* Модуль потока грузится только здесь — при выключенном опыте он не загружается вовсе, потока нет. */
  return import("./bitmap-thread.js").then(({ decodeInThread, ThreadLost }) =>
    decodeInThread(bytes, straight).then(
      (image) => (image === undefined ? bitmapHere(bytes, straight) : image),
      (failure) => {
        if (failure instanceof ThreadLost) return null;
        throw failure;
      },
    ),
  );
}

const images = new Map();
/*
 * Кэш листов — с пределом (ТЗ 06.10.2026, вечер). Прежде он рос весь сеанс:
 * каждый лист каждой сцены каждого открытого редактора оставался в памяти
 * (ImageBitmap у Chromium — память видеочипа), и после выхода из «Завода»
 * GPU-процесс держал сотни мегабайт. Теперь помнятся недавние листы до
 * бюджета; вытеснённый лист не закрывается — его ещё может держать живая
 * текстура кадра, — а просто отпускается сборщику мусора.
 */
const sizes = new Map();
let cachedBytes = 0;

function touch(key) {
  const value = images.get(key);
  images.delete(key);
  images.set(key, value);
}

/*
 * Предел кэша: `IMAGE_BUDGET_DEFAULT_BYTES` (256 МБ, `stage-exp.js`), а с опытом `image-budget` (`stage-exp.js`, по умолчанию выключен) — больший. «Мегамолл» целиком — 261,4 МБ картинок (замер `ledger.json`: создано 325,1 МБ, из них «Завод» 63,7 МБ), и на предел
 * в 256 МБ кэш выбрасывает самые давние листы самой сцены — 12; на повторе входа читатель берёт их заново (0,2–4,3 с), и закрытие холста держится дольше порога карточки.
 */
const imageBudget = () => imageBudgetBytes(stageExperiments());
/* Вытесненные листы (только с журналом меток): их повторный запрос — метка `reread`. */
const evicted = new Set();
const EVICTED_LIMIT = 4000;
const keyTail = (key) => String(key).slice(-80);

function trim() {
  const budget = imageBudget();
  for (const key of images.keys()) {
    if (cachedBytes <= budget) break;
    if (!sizes.has(key)) continue;
    const bytes = sizes.get(key);
    cachedBytes -= bytes;
    sizes.delete(key);
    images.delete(key);
    if (stageMarksOn()) {
      if (evicted.size < EVICTED_LIMIT) evicted.add(key);
      stageMark("evict", keyTail(key), bytes, cachedBytes);
    }
  }
}
/* Лист просят заново после вытеснения (только с журналом меток): называет, какие листы входа читатель перечитывает. */
function noteReread(key) {
  if (stageMarksOn() && evicted.delete(key)) stageMark("reread", keyTail(key));
}
/*
 * Учёт живых картинок (`image-ledger.js`, только с журналом меток `stage-marks.js`): вид кэша окна для снимка и пометка «просит кадр» на время вызова `loadSceneImage` из `loadSceneSheet`.
 * Без журнала меток ни то, ни другое не читается и не пишется.
 */
const cacheView = () => ({ entries: images.size, sized: sizes.size, accounted: cachedBytes, budget: imageBudget(), holds: (key, promise) => Boolean(promise) && images.get(key) === promise });
let frameCall = false;
let gameRoot = null;
let gameRootEmpty = false;
let gameRootAsked = 0;
let queue = [];
let flushTimer = 0;
/*
 * Пачки листов к Astral Desktop (ТЗ 42В-2, 20.10.2026). Прежде все просьбы тика уходили пачками по 48
 * и все разом: ответ приходил одной глыбой, и полоса загрузки стояла на «1 из N» и прыгала в конец.
 * Теперь пачки по 20: каждый ответ — настоящий шаг счёта (читатель держит в работе не больше восьми, по очереди прихода, `workshop-textures.js: READ_SLOTS`). Просьбы
 * перед нарезкой сгруппированы по файлу-источнику: у модели десяток листов, а хост читает ресурс по разу
 * на ответ, поэтому листы одного файла должны ехать в одной пачке. Замер на хосте (холодный кэш, медиана
 * трёх прогонов): Мегамолл (54 листа) 963 → 587 мс, арена GTA 5 RP (197) 915 → 997 мс (+9 %, в пределах
 * шума замера); пачки по 16 и 12 выходили у арены на 20–25 % медленнее — лишние чтения одних и тех же файлов.
 */
const BATCH = 20;
/*
 * Все пачки уходят сразу, а не по восемь: следующая пачка раньше уходила из колбэка ответа предыдущей на главном потоке окна, а он занят кадрами (долгие кадры
 * 0,8–1,0 с при ×4): читатель отвечал пачке за 5–100 мс (кэш тёплый) и простаивал, пока окно «ждало само себя» — у «Ашана» последние пачки уходили на 7,7–10 с
 * (профиль «до», 14.11.2026). Порядок и число одновременных держит читатель (очередь с восемью местами), а не окно.
 */
/* Не нашли игру — спросим ещё раз не раньше, чем через столько: её могли
   подключить, пока окно живёт. */
const GAME_RETRY_MS = 4000;

/*
 * Поток читателя упал (память тяжёлого редукса, `game-read-host.js`: `ledger.rejectAll`) — отклонены сразу все пачки, что были у него в работе или в очереди. Раньше окно держало в пути не больше
 * восьми пачек и остальные слало уже новому потоку; теперь пачки уходят все сразу (читатель держит очередь сам), и без повтора одно падение гасило бы все листы сцены разом — сцена оставалась
 * в среднем цвете, а заставка уходила, потому что все листы «ответили». Отклонённая пачка досылается тому же читателю: поток поднимается заново при первом вызове. Повторов два (три попытки),
 * с паузой по нарастающей: редукс, что валит поток снова и снова, не зациклит окно, а честная неудача (`unavailable`) приходит не позже чем через секунду-две после третьего падения.
 */
const READER_RETRIES = 2;
const READER_RETRY_MS = 250;
/* Лист, что читатель так и не отдал, снова можно просить не раньше, чем через столько: кадр просит листы на каждом облике, и без паузы каждый ползунок гнал бы просьбы упавшему читателю. */
const READER_COOLDOWN_MS = 10_000;

/*
 * Чем кончилась просьба о листе. `absent` — Astral Desktop ответил, что листа
 * нет в самой игре (окончательно); `unavailable` — не ответил или игры нет
 * (лист ещё может приехать). Снимок сцены с недошедшими листами — неполный и
 * в хранилище обложек не ложится (`scene-snapshot.js`).
 */
const outcomes = new Map();
/* Ключ листа → когда читатель отказал окончательно (все попытки отклонены): ответ «нет» здесь — не окончательный, лист можно просить снова (`sheetRetryable`). */
const readerFailed = new Map();

/**
 * Лист, чей прошлый ответ — отказ читателя (а не «листа нет в игре»), можно просить заново: прошло `READER_COOLDOWN_MS`. Вернув `true`, забывает отказ: следующая просьба — с чистого листа.
 * Кадр зовёт это в `textureFor`, когда видит у себя ответивший пустой лист: пустой ответ упавшего потока не должен жить в кадре, пока сцену не вытеснят.
 */
export function sheetRetryable(entry, size = 512, now = typeof performance !== "undefined" ? performance.now() : Date.now()) {
  const key = textureKey(entry, size);
  const at = readerFailed.get(key);
  if (at === undefined || now - at < READER_COOLDOWN_MS) return false;
  readerFailed.delete(key);
  return true;
}

/** Лист ещё может приехать (игру не нашли, ответа нет), а не «его в игре нет». */
export function sheetUnavailable(entry, size = 512) {
  return outcomes.get(textureKey(entry, size)) === "unavailable";
}

/*
 * Сколько листов читатель игры должен окну: просьбы ждут отправки, в пути (в том числе повторы после падения потока) и ещё без ответа. Заставка (`use-sheets-progress.js`) по этому счёту отличает «читатель
 * работает, пачка тяжёлая» (холодный кэш, медленный диск — пачка из двадцати листов отвечает долго) от «ждём, а читателю ничего не отправлено»: первое терпит долго, второе — прежние 15 с.
 */
let owed = 0;
export function readerOwes() {
  return owed;
}

/** Приедут ли листы игры вообще: есть Astral Desktop. В браузере без него кадр — честная постановка, и она окончательна. */
export function sheetsExpected() {
  return typeof desktopHost()?.readWorkshopTextures === "function";
}

/* Папка игры — один поиск на окно; пустой ответ не навсегда. */
function gameRootOnce() {
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  if (!gameRoot || (gameRootEmpty && now - gameRootAsked > GAME_RETRY_MS)) {
    gameRootAsked = now;
    gameRootEmpty = false;
    /* Метка `sheetRoot` (только с журналом меток): чем кончился поиск папки игры и за сколько; пустая папка раздаёт всем пачкам «листа пока нет» (`sendBatch`). */
    const noting = stageMarksOn();
    gameRoot = detectLegacyGame()
      .then((root) => {
        if (!root) gameRootEmpty = true;
        if (noting) stageMark("sheetRoot", root ? "found" : "empty", Math.round(performance.now() - now));
        return root;
      })
      .catch((error) => {
        gameRootEmpty = true;
        if (noting) stageMark("sheetRoot", "threw", Math.round(performance.now() - now), String(error?.message ?? error).slice(0, 160));
        return "";
      });
  }
  return gameRoot;
}

/*
 * Метки чтения листов (17.11.2026, «Арены»: холст открылся с листами в среднем цвете, и карточка ушла по ответам, а не по картинкам). Только с журналом меток (`stage-marks.js`): без него ни меток, ни вычислений.
 * `sheetRead` — чем кончился заход пачки к читателю: `[попытка, листов в пачке, исход (threw — читатель отклонил; null — ответа нет вовсе; answer — ответ с листами), без картинки, из них absent, из них unavailable,
 * папка игры пуста (1/0, «-» — в пачке листов игры нет), мс на вызов читателя, retry/final — будет ли повтор, причина]`. Причина — текст ошибки, если читатель отклонил пачку; из ответа — `reason`, `error` или
 * ошибка движка в `timings`, если они есть (сегодня читатель называет только `status`, `workshop-textures.js: SHEET_STATUS`). Остальные «без картинки» — те, у кого статуса нет.
 */
function noteSheetRead({ attempt, batch, root, answer, thrown, ms, retry }) {
  let empty = 0;
  let absent = 0;
  let unavailable = 0;
  for (let at = 0; at < batch.length; at += 1) {
    if (thrown === undefined && answer?.textures?.[at]) continue;
    empty += 1;
    const state = thrown === undefined ? answer?.status?.[at] : undefined;
    if (state === "absent") absent += 1;
    else if (state === "unavailable") unavailable += 1;
  }
  const outcome = thrown !== undefined ? "threw" : Array.isArray(answer?.textures) ? "answer" : "null";
  const named = thrown !== undefined ? (thrown?.message ?? thrown) : (answer?.reason ?? answer?.error ?? answer?.timings?.engine?.error);
  const reason = named === undefined || named === null ? "" : String(named).slice(0, 160);
  stageMark("sheetRead", attempt, batch.length, outcome, empty, absent, unavailable, batch.some((item) => item.entry.game) ? (root ? 0 : 1) : "-", ms, retry ? "retry" : "final", reason);
}

/* Метка `sheetDecodeFail`: `createImageBitmap` отклонил картинку листа (любая причина — нехватка памяти видеочипа, битый WebP): лист объявляется «absent», то есть навсегда. Хвост ключа, имя и текст ошибки. */
function noteDecodeFail(key, error) {
  if (stageMarksOn()) stageMark("sheetDecodeFail", keyTail(key), String(error?.name || "Error"), String(error?.message ?? error).slice(0, 160));
}

/* Вид листа для desktop: карта нормалей или блеска переводится в свой вид (`normal` / `specular`). */
const mapFlag = (entry) => (entry.normal ? { normal: true } : entry.specular ? { specular: true } : {});

/** Ключ источника записи — для кэша и сравнения. */
export function textureKey(entry, size = 512) {
  if (!entry) return "";
  if (entry.file) return `file:${entry.file}`;
  /* Карта нормалей и блеска — свой ключ: лист переведён в другой вид, а не диффуз. */
  const suffix = entry.normal ? "|normal" : entry.specular ? "|specular" : "";
  if (entry.set)
    return `set:${entry.set}/${entry.resource}/${entry.texture}@${size}${suffix}`;
  if (entry.game) return `game:${entry.game}/${entry.texture}@${size}${suffix}`;
  return "";
}

/** Можно ли вообще получить лист записи в этом окне. */
export function textureAvailable(entry) {
  if (!entry) return false;
  if (entry.file) return true;
  return typeof desktopHost()?.readWorkshopTextures === "function";
}

/* Файл-источник просьбы: листы одного файла идут в одной пачке. */
const sourceOf = ({ entry }) => entry.game || `${entry.set || ""}/${entry.resource || ""}`;

function flush() {
  flushTimer = 0;
  /* Группировка по файлу — на всё, что накопилось за тик: порядок внутри файла не меняется (сортировка устойчивая). */
  queue.sort((a, b) => {
    const left = sourceOf(a);
    const right = sourceOf(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  while (queue.length) void sendBatch(queue.splice(0, BATCH));
}

async function sendBatch(batch, attempt = 0) {
  const root = batch.some((item) => item.entry.game)
    ? await gameRootOnce()
    : "";
  let answer = null;
  let failed = false;
  let thrown;
  const noting = stageMarksOn();
  const began = noting ? performance.now() : 0;
  try {
    /* Блоки просят записи с `accept`; форматы верхнего уровня — объединение их списков (у окна он один — по видеокарте). Без таких записей запрос прежний. */
    const formats = [...new Set(batch.flatMap((item) => item.accept || []))].sort();
    answer = await readWorkshopTextures({
      gameRoot: root || undefined,
      /* Кадр редактора арен — в текстурах поставленного мода (16.10). */
      ...(overMods ? { overMods: true } : {}),
      ...(formats.length ? { accept: formats } : {}),
      /* Включён выключатель сжатых листов — пачки захода делят один сеанс чтения игры (`workshop-textures.js`, `share`). */
      ...(sheetsBcnEnabled() ? { share: true } : {}),
      textures: batch.map(({ entry, size, accept }) => ({
        ...(entry.set
          ? { set: entry.set, file: entry.resource, name: entry.texture, size, ...mapFlag(entry) }
          : { game: entry.game, name: entry.texture, size, ...mapFlag(entry) }),
        ...(accept ? { blocks: true } : {}),
      })),
    });
  } catch (error) {
    answer = null;
    failed = true;
    thrown = error ?? "";
  }
  if (noting) noteSheetRead({ attempt, batch, root, answer, thrown, ms: Math.round(performance.now() - began), retry: failed && attempt < READER_RETRIES });
  /* Читатель отклонил пачку (упал поток): листы не отвечены, а не «не пришли» — досылаем новому потоку. */
  if (failed && attempt < READER_RETRIES) {
    setTimeout(() => void sendBatch(batch, attempt + 1), READER_RETRY_MS * (attempt + 1));
    return;
  }
  batch.forEach((item, index) => {
    const buffer = answer?.textures?.[index];
    const key = textureKey(item.entry, item.size);
    if (failed) readerFailed.set(key, typeof performance !== "undefined" ? performance.now() : Date.now());
    /* Решает служба (`SHEET_STATUS`): `absent` — листа в игре нет, всё
       остальное — «ещё может приехать». Без ответа службы — тоже «может». */
    const state = answer?.status?.[index];
    if (item.accept && buffer) {
      settleSheet(item, key, buffer);
      return;
    }
    if (!buffer || typeof createImageBitmap !== "function") {
      outcomes.set(
        key,
        state === "absent" && !(item.entry.game && !root)
          ? "absent"
          : "unavailable",
      );
      item.resolve(null);
      return;
    }
    bitmapOfWebp(buffer)
      .then((image) => {
        /* Только у опыта `bitmap-thread`: поток упал с байтами — лист ещё может приехать, его спросят заново. */
        if (!image) {
          lostToThread(key);
          item.resolve(null);
          return;
        }
        outcomes.delete(key);
        item.resolve(image);
      })
      .catch((error) => {
        noteDecodeFail(key, error);
        outcomes.set(key, "absent");
        item.resolve(null);
      });
  });
}

/**
 * Ответ на запись с блоками: контейнер ASB1 с одной записью — блоки (`{ sheet }`) или WebP внутри него (`{ image }`, лист блокам не годился); не контейнер —
 * обычный WebP (читатель без блоков). Битый контейнер — лист «недоступен», а не исключение.
 * Сюда попадают только записи кадра сцены (`loadSceneSheet` при включённом выключателе: запись с `blocks`, свой ключ кэша окна с суффиксом) — их картинка
 * создаётся с прямой альфой, как блоки; у листов для холста (`loadSceneImage`) кэш и вызов прежние.
 */
function settleSheet(item, key, buffer) {
  const bitmap = (bytes) =>
    typeof createImageBitmap === "function"
      ? bitmapOfWebp(bytes, { frame: true })
          .then((image) => {
            /* Только у опыта `bitmap-thread`: поток упал с байтами — лист не «пришёл» и не «отсутствует». */
            if (!image) {
              lostToThread(key);
              item.resolve(null);
              return;
            }
            outcomes.delete(key);
            item.resolve({ image });
          })
          .catch((error) => {
            noteDecodeFail(key, error);
            outcomes.set(key, "absent");
            item.resolve(null);
          })
      : (outcomes.set(key, "unavailable"), item.resolve(null));
  if (!isSheetContainer(buffer)) {
    bitmap(buffer);
    return;
  }
  let entry = null;
  try {
    const entries = parseSheets(buffer);
    entry = entries.length === 1 ? entries[0] : null;
  } catch {
    entry = null;
  }
  if (!entry || entry.status !== "ok" || (entry.kind !== "bcn" && !entry.bytes)) {
    outcomes.set(key, "unavailable");
    item.resolve(null);
    return;
  }
  if (entry.kind === "bcn") {
    outcomes.delete(key);
    item.resolve({ sheet: entry });
    return;
  }
  bitmap(entry.bytes);
}

function requestDesktop(entry, size, accept = null) {
  return new Promise((resolve) => {
    owed += 1;
    queue.push({
      entry,
      size,
      accept,
      resolve: (value) => {
        owed = Math.max(0, owed - 1);
        resolve(value);
      },
    });
    if (!flushTimer) flushTimer = setTimeout(flush, 0);
  });
}

async function loadFile(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  return createImageBitmap(await response.blob());
}

/*
 * Свой источник листов (15.10): окно-съёмщик частей редукса получает листы
 * сцены вместе с запросом — листы мода поверх листов игры
 * (`apps/desktop/src/part-sheets.js`), моста Astral Desktop у него нет.
 * `source(entry)` → ImageBitmap | null; ключ — `sheetSourceKey`. Смена
 * источника забывает листы игры и наборов: у следующего мода они свои.
 */
let sheetSource = null;

/*
 * Листы игры — с текстурами поставленных модов (16.10): правку арены
 * мастерская соберёт поверх поставленного мода арены, и кадр редактора
 * показывает то же (`readWorkshopTextures` с `overMods`). Смена режима
 * забывает листы игры: у них теперь другой источник.
 */
let overMods = false;

export function setSceneOverMods(enabled) {
  if (overMods === Boolean(enabled)) return;
  overMods = Boolean(enabled);
  for (const key of [...images.keys()]) {
    if (!key.startsWith("game:")) continue;
    if (sizes.has(key)) cachedBytes -= sizes.get(key);
    sizes.delete(key);
    images.delete(key);
    outcomes.delete(key);
  }
}

/** Ключ листа для своего источника — как у `sheetKey` главного процесса. */
export function sheetSourceKey(entry) {
  if (entry?.game) return `game:${entry.game}/${entry.texture}`.toLowerCase();
  if (entry?.set)
    return `set:${entry.set}/${entry.resource}/${entry.texture}`.toLowerCase();
  return "";
}

export function setSceneSheetSource(source) {
  sheetSource = typeof source === "function" ? source : null;
  for (const key of [...images.keys()]) {
    if (key.startsWith("file:")) continue;
    if (sizes.has(key)) cachedBytes -= sizes.get(key);
    sizes.delete(key);
    images.delete(key);
    outcomes.delete(key);
  }
}

/**
 * Картинка листа (ImageBitmap) или `null` — обещание из кэша окна.
 * `size` — сторона, до которой уменьшить лист игры (у файлов поставки —
 * как есть).
 */
export function loadSceneImage(entry, size = 512) {
  const key = textureKey(entry, size);
  if (!key) return Promise.resolve(null);
  if (stageMarksOn()) {
    noteImageCall(key, frameCall ? "frame" : "", loadSceneImage);
    frameCall = false;
  }
  if (images.has(key)) {
    touch(key);
    return images.get(key);
  }
  noteReread(key);
  const pending = entry.file
    ? loadFile(entry.file).catch(() => {
        /* Файл поставки не читается — ждать нечего. */
        outcomes.set(key, "absent");
        return null;
      })
    : sheetSource
      ? Promise.resolve()
          .then(() => sheetSource(entry))
          .catch(() => null)
      : textureAvailable(entry)
        ? requestDesktop(entry, size)
        : Promise.resolve(null);
  const promise = pending.then((image) => {
    /* Неудача не остаётся в кэше: следующая сцена спросит заново. */
    if (!image) {
      if (images.get(key) === promise) images.delete(key);
      return image;
    }
    if (images.get(key) === promise && !sizes.has(key)) {
      const bytes = Math.max(1, (image.width || 0) * (image.height || 0) * 4);
      sizes.set(key, bytes);
      cachedBytes += bytes;
      trim();
    }
    if (stageMarksOn()) noteImageLoaded(key, image, "image", entry.file ? "file" : sheetSource ? "own" : "reader", promise, cacheView);
    return image;
  });
  images.set(key, promise);
  return promise;
}

/** Выключатель сжатых листов: `localStorage["astral.sheets.bcn.v1"] === "1"` (по умолчанию выключен). */
export const SHEETS_BCN_KEY = "astral.sheets.bcn.v1";
export function sheetsBcnEnabled() {
  try {
    return globalThis.localStorage?.getItem(SHEETS_BCN_KEY) === "1";
  } catch {
    return false;
  }
}

/* Ключ кэша окна для блоков: рядом с ключом картинки той же записи, но другой — листы для холста и листы сцены не путаются. */
const SHEET_KEY_SUFFIX = "|bcn";
const SHEET_FORMATS = ["BC7", "DXT1", "DXT3", "DXT5"];

/** Форматы для запроса блоков: пусто — блоки записи не нужны (файл поставки, свой источник, карта нормалей или блеска, нет Astral Desktop). */
function blocksAccept(entry, accept) {
  if (!entry || entry.file || sheetSource || entry.normal || entry.specular || !textureAvailable(entry) || !Array.isArray(accept)) return [];
  return [...new Set(accept.filter((name) => SHEET_FORMATS.includes(name)))].sort();
}

/**
 * Лист сцены: `{ sheet }` (блоки BCn, `parseSheets`), `{ image }` (ImageBitmap) или `null` — обещание из кэша окна. `accept` — форматы, которые умеет
 * видеокарта (`sheetFormatsOf(renderer)`). Выключатель выключен, форматов нет или записи блоки не нужны — то же, что `loadSceneImage`, и тот же кэш. Учёт
 * кэша — по размеру нагрузки: блоки — сумма уровней, картинка — ширина × высота × 4.
 */
export function loadSceneSheet(entry, size = 512, accept = []) {
  const formats = sheetsBcnEnabled() ? blocksAccept(entry, accept) : [];
  const key = textureKey(entry, size);
  if (!formats.length || !key) {
    if (stageMarksOn()) frameCall = Boolean(key);
    return loadSceneImage(entry, size).then((image) => (image ? { image } : null));
  }
  const sheetKey = `${key}${SHEET_KEY_SUFFIX}`;
  if (stageMarksOn()) noteImageCall(sheetKey, "frame", loadSceneSheet);
  if (images.has(sheetKey)) {
    touch(sheetKey);
    return images.get(sheetKey);
  }
  noteReread(sheetKey);
  const promise = requestDesktop(entry, size, formats).then((loaded) => {
    /* Неудача не остаётся в кэше: следующая сцена спросит заново. */
    if (!loaded) {
      if (images.get(sheetKey) === promise) images.delete(sheetKey);
      return loaded;
    }
    if (images.get(sheetKey) === promise && !sizes.has(sheetKey)) {
      const bytes = loaded.sheet ? loaded.sheet.mipmaps.reduce((sum, level) => sum + level.data.length, 0) : (loaded.image.width || 0) * (loaded.image.height || 0) * 4;
      sizes.set(sheetKey, Math.max(1, bytes));
      cachedBytes += Math.max(1, bytes);
      trim();
    }
    if (stageMarksOn()) noteImageLoaded(sheetKey, loaded.sheet ? loaded.sheet.mipmaps : loaded.image, loaded.sheet ? "bcn" : "image", "reader", promise, cacheView);
    return loaded;
  });
  images.set(sheetKey, promise);
  return promise;
}

/* Для тестов: кэш окна живёт весь сеанс. */
export function forgetSceneImages() {
  images.clear();
  evicted.clear();
  sizes.clear();
  outcomes.clear();
  readerFailed.clear();
  cachedBytes = 0;
  frameCall = false;
  queue = [];
  owed = 0;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = 0;
  gameRoot = null;
  gameRootEmpty = false;
  gameRootAsked = 0;
}
