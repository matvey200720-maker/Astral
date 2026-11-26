/*
 * Очередь применения: всё, что мастерская пишет в игру прямо сейчас.
 *
 * ЗАЧЕМ ОНА ПОЯВИЛАСЬ
 *
 * «Применить» в редакторе открывало окно. В одних редакторах окно бралось за
 * дело само, в других предлагало нажать «Проверить и подготовить», а следом
 * «Создать backup и применить» — три нажатия после того, как человек уже
 * сказал «применить». Поверх окна ложился слой «идёт запись в архив игры»,
 * который накрывал приложение целиком на сорок пять секунд: пока он висел,
 * нельзя было ни вернуться к правке, ни посмотреть каталог. А после удачной
 * установки в том же окне оставалась кнопка «Повторить установку» — и второе
 * нажатие запускало ту же сорокапятисекундную запись ещё раз.
 *
 * При этом в лаунчере уже есть экран для ровно этого: «В процессе». Там идут
 * установки из каталога — с обложкой, шагами, временем и отменой. Установка
 * из мастерской — такая же установка, и делать ей второй, худший экран не за
 * чем.
 *
 * ЧТО ТЕПЕРЬ ПРОИСХОДИТ ПО «ПРИМЕНИТЬ»
 *
 * Правка сохраняется (у студии — в проект) и тем же нажатием встаёт в эту
 * очередь; в «Мои работы» она попадает только через «Сохранить в мои работы».
 * Дальше всё идёт само: очередь берёт работы по одной, показывает шаги на
 * экране «В процессе» и сообщает об итоге. Редактор при этом свободен —
 * можно править дальше, уйти в каталог, закрыть редактор совсем: очередь
 * живёт рядом с окном, а не внутри страницы, и переживает уход в любой
 * раздел.
 *
 * ПОЧЕМУ ПО ОДНОЙ
 *
 * Все установки мастерской пишут в один и тот же файл — `update/update.rpf`
 * на два гигабайта. Две записи разом главный процесс и так не пустит
 * («Мастерская уже применяет изменения»), только человек увидел бы это
 * красной строкой вместо обещанной установки. Очередь ставит вторую работу в
 * ожидание, а не отказывает ей.
 *
 * ЧУЖИЕ ОПЕРАЦИИ
 *
 * В тот же архив пишет удаление из библиотеки — его запускает не очередь.
 * Такие операции очередь узнаёт по потоку фаз главного процесса и показывает
 * отдельной строкой («Библиотека»), а свою работу при них не начинает: замок
 * в главном процессе один на всё окно.
 *
 * Очередь загрузок каталога пишет в тот же архив своим движком, и о ней
 * главный процесс в поток фаз не говорит. Оболочка сама держит эту очередь
 * (`holdWorkshopInstalls`), пока идёт установка из каталога, — и наоборот,
 * каталог не начинает, пока занята мастерская. Раньше они не знали друг о
 * друге: мод, поставленный во время «Применить», падал с «Мастерская уже
 * применяет изменения», а работа мастерской могла начать запись поверх
 * идущей установки каталога.
 *
 * СЛЕДУЮЩАЯ ВЕРСИЯ ТОЙ ЖЕ РАБОТЫ
 *
 * Трассеры, попадания и огонь — три редактора одного набора: набор уезжает в
 * игру одним патчем. Раньше очередь знала только ключ, и пока ставились
 * трассеры, «Применить» в попаданиях горело серым «Ставим в игру…» — будто
 * ставится то, что человек только что накрутил. На деле ставилась прежняя
 * версия набора, а новой идти было некуда.
 *
 * Теперь у работы есть подпись версии (`signature.js`): что именно уедет в
 * игру. Та же версия, пока идёт, второй раз не ставится — это по-прежнему
 * главное. А другая встаёт за ней следом: одна ждущая версия на ключ, и
 * каждое новое нажатие заменяет ждущую, а не копит по записи на два
 * гигабайта. Ключ у каждой части набора свой (`…install.v1:<часть>`): общий
 * заменял бы ждущую работу соседнего редактора. Попадания и огонь, нажатые
 * во время трассеров, встают за ними каждый своей строкой, и набор каждая
 * собирает в момент установки — из своей части и того, что к тому времени
 * стоит в игре.
 */

import {
  onWorkshopInstallProgress,
  sanitizeDesktopErrorMessage,
  workshopGameRunning,
} from "../../../api.js";
import {
  describeInstallFailure,
  failureLine,
} from "../../../utils/installFailure.js";
import { isGameRunningRefusal } from "../../../utils/game-running.js";
import {
  WORKSHOP_INSTALL_STEPS,
  WORKSHOP_REINSTALL_STEPS,
  WORKSHOP_REMOVAL_STEPS,
  WORKSHOP_RETIRE_STEP,
  fillSteps,
  installStageNote,
  workshopPhaseStepId,
} from "../../../install-phase.js";
import { currentUiLanguage, tr } from "../../../locales/ui.js";
import { recordRun, workshopRunKind } from "../../downloads/eta.js";
import { trailAfter } from "./prepare-progress.js";
import {
  closeWorkshopWrites,
  onWorkshopWrite,
  openWorkshopWrites,
} from "./write-gate.js";

/* Сколько готовая работа остаётся в списке. Строка, исчезающая в тот же такт,
   что и полоса, не успевает сказать «готово»: человек видит, что что-то
   пропало, и идёт проверять, установилось ли. */
export const WORKSHOP_INSTALL_DONE_MS = 4_000;

/* Готовый ряд со словами про GTA 5 RP (`rpNote`) держится дольше: это строка, которую надо успеть прочитать («На GTA 5 RP видно: …. Не видно: ….»), а не «готово» на четыре секунды. */
export const WORKSHOP_INSTALL_RP_DONE_MS = 30_000;

/*
 * ИГРА ОТКРЫТА
 *
 * Пока GTA V запущена, писать в её архивы нельзя: движок откажет «Закройте
 * GTA V…», и человек увидит красную строку и «Повторить». Работа, которая
 * об этом знает (`waitForGame`, скины оружия и одежды), не начинается, а
 * ждёт: строка говорит, чего ждём, очередь заглядывает раз в несколько
 * секунд и ставит сама, как только игра закрыта.
 *
 * Работа с `waitOnRefusal` («Применить» редакторов, `apply.js`) игру заранее не
 * спрашивает, но отказ «Закройте GTA V…» (26.11.2026) её больше не роняет в
 * «Не удалось»: она возвращается в очередь ждать закрытия игры. Повторный отказ
 * растягивает паузу вдвое, до минуты: отказать может и то, чего вопрос
 * «запущена ли игра» не видит (окно-заглушка BattlEye), и гонять сборку каждые
 * четыре секунды незачем. Снятие из игры и прочие работы (переключатели
 * «Оптимизации» со своими словами на карточке) отказывают сразу, как раньше.
 */
export const GAME_WAIT_NOTE = "Ждём, пока закроется GTA V, — поставим сами";
const GAME_RECHECK_MS = 4_000;
const GAME_REFUSAL_PAUSE_MAX_MS = 60_000;
let gameRecheck = null;
function recheckGameLater() {
  if (gameRecheck) return;
  gameRecheck = setTimeout(() => {
    gameRecheck = null;
    void pump();
  }, GAME_RECHECK_MS);
}

/** Шаги по умолчанию — те же, что показывает движок для любой записи. */
export const DEFAULT_INSTALL_STEPS = WORKSHOP_INSTALL_STEPS;

/*
 * Шаги работы, которая заменяет собой прежнюю версию себя же (мини-карта,
 * прицел). У них после записи идёт второй проход по архиву — уборка точки
 * отката прежней версии.
 */
export const REPLACING_INSTALL_STEPS = Object.freeze([
  ...WORKSHOP_INSTALL_STEPS,
  WORKSHOP_RETIRE_STEP,
]);

const listeners = new Set();
/*
 * Слушатели устройства очереди (задача 1 ТЗ 08.10, вечер): какие работы,
 * в каком статусе и на каком шаге. Байты шага их не будят. Оболочка, полки
 * и редакторы спрашивают только это, а на каждый шаг копии архива (каждые
 * 50–200 мс) перерисовывались целиком; проценты читают кнопка «Применить» и
 * строка «Загрузок» — своими подписками.
 */
const structureListeners = new Set();

/** Работы: и ждущие, и текущая, и та, что не удалась. Порядок — очередь. */
let jobs = [];
/** Операция, начатая не отсюда (удаление из библиотеки) — или `null`. */
let external = null;
let sequence = 0;
/*
 * Партия: сколько работ поставлено с тех пор, как очередь в последний раз
 * опустела, и сколько из них уже в игре. Счётчик на рельсе («1/3») читает
 * её, а не список: готовая строка уходит с экрана через четыре секунды, и
 * по одному списку «1 из 3» превращалось бы в «0 из 2».
 */
const batchIds = new Set();
let batchCompleted = 0;
/* Идёт ли очередь каталога: счётчик на рельсе у них общий, и партия
   мастерской не кончается, пока каталог ещё ставит, — иначе «1/2»
   превращалось бы в «0/1», как только мастерская допишет первой. */
let batchPartner = false;
/** Кто ещё пишет в игру мимо этой очереди и держит её: имя → что именно. */
const holds = new Map();
/* Отмена работы в ходе запуска: `id` → AbortController, пока её `run` идёт. */
const runControllers = new Map();
let snapshot = {
  jobs: [],
  external: null,
  busy: false,
  held: "",
  batch: { total: 0, completed: 0 },
};
/* Снимок на последнюю смену устройства: его `jobs` несут байты того
   времени — читать из него проценты нельзя, для них есть `snapshot`. */
let structure = snapshot;
let bridgeStop = null;
let pumping = false;

const now = () => Date.now();

const isLive = (job) => job.status === "queued" || job.status === "running";

/**
 * @param {{bytesOnly?: boolean}} [options] `bytesOnly` — сменились только
 *   байты/доля шага: устройство очереди прежнее, его слушатели спят.
 */
function rebuild({ bytesOnly = false } = {}) {
  /* Очередь опустела — партия закончилась, следующая начнётся с нуля. */
  if (!jobs.some(isLive) && !batchPartner) {
    batchIds.clear();
    batchCompleted = 0;
  }
  snapshot = {
    jobs,
    external,
    busy: Boolean(external) || jobs.some((job) => job.status === "running"),
    /* Что держит очередь снаружи — для строки ждущей работы. */
    held: [...holds.values()][0] || "",
    batch: { total: batchIds.size, completed: batchCompleted },
  };
  if (!bytesOnly) {
    structure = snapshot;
    for (const listener of structureListeners) listener(structure);
  }
  for (const listener of listeners) listener(snapshot);
}

/* Поля, смена которых — только ход шага, а не новое устройство очереди. */
const BYTE_FIELDS = new Set([
  "copiedBytes",
  "totalBytes",
  "fraction",
  "phaseStartedAt",
  "progress",
  "progressTrail",
  /* Ступень пересборки пакета поверх работы: её доля идёт часто, устройство очереди от неё не меняется. */
  "dependent",
]);

function patch(id, changes) {
  let touched = false;
  let bytesOnly = true;
  jobs = jobs.map((job) => {
    if (job.id !== id) return job;
    touched = true;
    for (const [field, value] of Object.entries(changes))
      if (!BYTE_FIELDS.has(field) && job[field] !== value) bytesOnly = false;
    return { ...job, ...changes };
  });
  if (touched) rebuild({ bytesOnly });
}

const findJob = (id) => jobs.find((job) => job.id === id) || null;
const runningJob = () => jobs.find((job) => job.status === "running") || null;

/* Первый `apply…`, прошедший затвор моста, — запись началась: с этого
   такта идущую работу отменить уже нельзя (`cancelWorkshopInstall`). */
onWorkshopWrite(() => {
  const job = runningJob();
  if (job && !job.wrote) patch(job.id, { wrote: true });
});

const stepIndexOf = (job, id) => job.steps.findIndex((step) => step.id === id);

/*
 * Шаг, если он дальше текущего; иначе текущий.
 *
 * `complete` движка сюда не годится: он означает «этот проход по архиву
 * закончен», а не «работа готова» — после него идёт уборка прежней версии.
 * Конец работы знает только `run`, и до его возврата строка стоит на
 * последнем пройденном шаге.
 */
function stepForward(job, id) {
  const next = stepIndexOf(job, id);
  if (next < 0) return job.phase;
  return next > stepIndexOf(job, job.phase) ? id : job.phase;
}

/*
 * Поток фаз главного процесса.
 *
 * Подписка заводится при первой работе и живёт дальше: отписываться не на
 * чем — очередь одна на окно, — а чужие операции она обязана видеть и тогда,
 * когда своих работ у неё нет.
 */
function listenToBridge() {
  if (bridgeStop) return;
  bridgeStop = onWorkshopInstallProgress((status) => {
    const active = status?.active === true;
    const job = runningJob();
    if (job) {
      /* Своя работа: фаза движка ложится на её собственный список шагов.
         Конец потока (`active: false`) ничего не решает — итог работы знает
         сам `run`, и до его возврата строка остаётся на последнем шаге. */
      if (!active) return;
      /*
       * Шаг вперёд, но не назад.
       *
       * За одну работу главный процесс проходит по архиву не один раз: после
       * записи он убирает точку отката прежней версии, и это второй проход со
       * своими «Подготовка → Резервная копия → …». Без этого правила строка
       * на сорок пятой секунде возвращалась к первому шагу, и выглядело это
       * как «всё началось заново». Байты при этом идут дальше: второй проход
       * тоже копирует архив, и полоса шага показывает его честно.
       */
      const phase = stepForward(job, workshopPhaseStepId(status.phase));
      patch(job.id, {
        /* Фазы движка идут только внутри записи в игру; ожидание подготовки игры — ещё не запись. */
        wrote: status.waiting ? Boolean(job.wrote) : true,
        phase,
        phaseStartedAt: phase === job.phase ? job.phaseStartedAt : now(),
        copiedBytes: Number(status.copiedBytes) || 0,
        totalBytes: Number(status.totalBytes) || 0,
        fraction: null,
        /* Подпись этапа движка («Проверяем архив игры»): переводится сейчас, на языке окна. */
        note: tr(installStageNote(status.phase)) || (phase === job.phase ? job.note : ""),
        dependent: status.dependent || null,
      });
      return;
    }
    if (!active) {
      if (!external) return;
      external = null;
      rebuild();
      /* Чужая операция кончилась — замок свободен, можно браться за своё. */
      void pump();
      return;
    }
    const removal = status.flow === "removal";
    /* «Установить снова» (задача 2): шаги по id, как у удаления. */
    const reinstall = status.flow === "reinstall";
    const planned = Array.isArray(status.steps) ? status.steps : null;
    const steps = removal
      ? WORKSHOP_REMOVAL_STEPS.filter(
          (step) => !planned || planned.includes(step.id),
        )
      : reinstall
        ? WORKSHOP_REINSTALL_STEPS
        : WORKSHOP_INSTALL_STEPS;
    const previous = external;
    const dependent = status.dependent || null;
    external = {
      id: "workshop-external",
      kind: "external",
      editor: removal || reinstall ? tr("Библиотека") : "GTA V Legacy",
      title: status.title || (removal ? tr("Удаление из игры") : tr("Запись в игру")),
      operation: removal ? "remove" : "install",
      steps,
      /* Пока идёт пересборка пакета поверх снятого, шаг остаётся тем, до которого дошло снятие: фазы сборки к нему не относятся и откатывали строку на «Подготовку». */
      phase: removal || reinstall
        ? (dependent && previous?.phase) || steps.find((step) => step.id === status.phase)?.id || steps[0].id
        : workshopPhaseStepId(status.phase),
      status: "running",
      startedAt: Number(status.startedAt) || external?.startedAt || now(),
      phaseStartedAt: external?.phaseStartedAt || now(),
      copiedBytes: Number(status.copiedBytes) || 0,
      totalBytes: Number(status.totalBytes) || 0,
      note: status.waiting ? tr(installStageNote(status.phase)) : "",
      dependent,
    };
    /* Та же операция на том же шаге — сменились только байты. */
    rebuild({
      bytesOnly: Boolean(
        previous &&
          previous.title === external.title &&
          previous.operation === external.operation &&
          previous.phase === external.phase &&
          previous.note === external.note &&
          (previous.dependent?.set || "") === (dependent?.set || "") &&
          previous.steps.length === external.steps.length,
      ),
    });
  });
}

/*
 * Отказ «игра запущена»: в игру не записано ничего (или движок вернул всё назад), поэтому работа встаёт на своё место
 * ждущей и повторяется сама. Человеку об этом говорится один раз — уведомлением той работы.
 */
function waitForClosedGame(job) {
  const refusals = (job.refusals || 0) + 1;
  patch(job.id, {
    status: "queued",
    waitForGame: true,
    refusals,
    notBefore: now() + Math.min(GAME_RECHECK_MS * 2 ** (refusals - 1), GAME_REFUSAL_PAUSE_MAX_MS),
    note: GAME_WAIT_NOTE,
    phase: job.steps[0].id,
    startedAt: 0,
    phaseStartedAt: 0,
    copiedBytes: 0,
    totalBytes: 0,
    fraction: null,
    error: "",
    errorDetail: "",
    errorKind: "",
  });
  if (refusals === 1) job.onHeld?.(tr(GAME_WAIT_NOTE));
  recheckGameLater();
}

/*
 * Взять следующую работу.
 *
 * Повторный вход невозможен: `pumping` держит один проход, а следующая
 * работа берётся тем же `pump` из `finally`, а не рекурсией внутри него.
 */
async function pump() {
  if (pumping) return;
  const next = jobs.find((job) => job.status === "queued");
  if (!next || runningJob() || external || holds.size) return;
  if (next.notBefore && now() < next.notBefore) {
    recheckGameLater();
    return;
  }
  if (next.waitForGame) {
    pumping = true;
    let open = false;
    try {
      open = await workshopGameRunning();
    } catch {
      open = false;
    } finally {
      pumping = false;
    }
    if (open) {
      if (next.note !== GAME_WAIT_NOTE)
        patch(next.id, { note: GAME_WAIT_NOTE });
      recheckGameLater();
      return;
    }
    if (next.note === GAME_WAIT_NOTE) patch(next.id, { note: "" });
    /* Пока спрашивали игру, очередь могла поменяться. */
    if (
      jobs.find((job) => job.status === "queued") !== next ||
      runningJob() ||
      external ||
      holds.size
    )
      return void pump();
  }
  pumping = true;
  const stamp = now();
  patch(next.id, {
    status: "running",
    startedAt: stamp,
    phaseStartedAt: stamp,
    phase: next.steps[0].id,
    error: "",
    errorDetail: "",
    errorKind: "",
  });
  let outcome = null;
  /* Отмена, пока идёт подготовка: окно прерывает план в главном процессе (`signal`). Запись отменить
     нельзя — запись в игру по-прежнему идёт до конца. */
  const runAbort = new AbortController();
  runControllers.set(next.id, runAbort);
  try {
    outcome =
      (await next.run({
        report: (update) => report(next.id, update),
        saved: next.saved,
        signal: runAbort.signal,
        operationId: next.id,
      })) || {};
  } catch (error) {
    /* Отказ словами игрока (utils/installFailure.js): «Файл игры занят.
       Закройте GTA V, OpenIV…», а не «EBUSY: resource busy or locked». */
    const detail = sanitizeDesktopErrorMessage(error);
    const failure = describeInstallFailure(
      {
        name: error?.name,
        message: detail,
      },
      currentUiLanguage(),
    );
    outcome = {
      failed: failureLine(failure) || detail || tr("Установка не удалась."),
      failedDetail: detail,
      /* Семейство остаётся при строке: слова отказа окно берёт при показе, на
         языке окна, а не на русском, в котором строка записана здесь. */
      failedKind: failure?.kind || "",
    };
  } finally {
    pumping = false;
    runControllers.delete(next.id);
  }
  /* Отказ «игра запущена» — и брошенный, и возвращённый работой полем `failed`. */
  if (outcome?.failed && next.waitOnRefusal && next.operation !== "remove")
    outcome.gameRunning = isGameRunningRefusal(outcome.failedDetail || outcome.failed);
  const job = findJob(next.id);
  /* Отменённая крестиком: затвор открывается для следующей работы, а сама
     она уходит из списка — в игру она не записала ничего. Если запись всё же
     успела начаться (вложенный метод моста мимо затвора), работа доходит как
     обычно: строка не врёт, что её не было. */
  if (job?.cancelling) {
    openWorkshopWrites();
    if (!job.wrote || outcome.failed) {
      batchIds.delete(next.id);
      jobs = jobs.filter((item) => item.id !== next.id);
      rebuild();
      job.onCancelled?.();
      void pump();
      return;
    }
  }
  if (job && outcome.gameRunning) {
    waitForClosedGame(job);
    return;
  }
  /* Работу могли убрать из списка, пока она шла: тогда итог показывать негде,
     но сама установка уже случилась — и об этом скажет уведомление. */
  if (job) {
    if (outcome.failed) {
      patch(next.id, {
        status: "failed",
        dependent: null,
        error: outcome.failed,
        errorDetail: outcome.failedDetail || "",
        errorKind: outcome.failedKind || "",
        finishedAt: now(),
      });
      /* Всплывашка — тоже слова на языке окна в момент отказа (Khasti, 14.10: польский
         интерфейс, русский текст). */
      job.onFailed?.(outcome.failed);
    } else {
      if (batchIds.has(next.id)) batchCompleted += 1;
      /* Сколько заняла работа — «осталось ≈» следующей такой же. Пишет очередь,
         а не строка «Загрузок»: панель в этот момент может быть закрыта. */
      if (job.operation !== "remove") recordRun(workshopRunKind(job), now() - stamp);
      patch(next.id, {
        status: "done",
        phase: "complete",
        dependent: null,
        finishedAt: now(),
        note: outcome.note || "",
      });
      job.onDone?.(outcome);
      /* Слова про GTA 5 RP (`rpNote`) — ряд держится дольше обычного. */
      const hold = findJob(next.id)?.rpNote ? Math.max(job.doneHoldMs, WORKSHOP_INSTALL_RP_DONE_MS) : job.doneHoldMs;
      globalThis.setTimeout(() => dismiss(next.id, "done"), hold);
    }
  }
  void pump();
}

/** Шаг и подпись от самой работы: то, что делает окно, а не главный процесс. */
function report(id, update = {}) {
  const job = findJob(id);
  if (!job || job.status !== "running") return;
  const phase =
    update.step && job.steps.some((step) => step.id === update.step)
      ? update.step
      : job.phase;
  patch(id, {
    phase,
    phaseStartedAt: phase === job.phase ? job.phaseStartedAt : now(),
    note: typeof update.note === "string" ? update.note : job.note,
    /* Слова про GTA 5 RP — отдельное поле: подпись этапа движка (`note`) его не затирает, а ряд после установки его сохраняет. Пустая строка стирает. */
    rpNote: typeof update.rpNote === "string" ? update.rpNote : job.rpNote || "",
    /* Доля шага от самого окна — там, где она известна ему, а не движку:
       плиток карты шесть, и «третья из шести» честнее полосы без числа. */
    fraction: typeof update.fraction === "number" ? update.fraction : null,
    /* Ход подготовки растительности и дорог: этапы и файлы; образцы — для оценки и «нет движения». */
    progress: update.progress || null,
    progressTrail: update.progress ? trailAfter(job.progressTrail, update.progress, now()) : null,
  });
}

/*
 * Одна ли это версия. Без подписи у одной из сторон ответ «да»: так вела себя
 * очередь до подписей, и работы, которые подписи не дают, ведут себя так же —
 * пока идут, повторить их нечем.
 */
const sameVersion = (left, right) => !left || !right || left === right;

const signatureOf = (value) =>
  typeof value === "string" && value ? value : null;

/**
 * Поставить работу в очередь.
 *
 * `key` — какая это работа, `signature` — какая её версия.
 *
 *   • та же версия уже ставится — ничего не заводится: второй записи на два
 *     гигабайта ради того же самого не будет;
 *   • другая версия ставится — новая встаёт за ней следом;
 *   • версия уже ждёт — новое нажатие заменяет ждущую на том же месте в
 *     очереди, а не заводит ещё одну запись.
 *
 * Если человек вернулся к той версии, что сейчас ставится, ждущая за ней
 * становится лишней и уходит: иначе после установки поверх легла бы правка,
 * от которой он отказался.
 *
 * @param {{
 *   key: string,
 *   signature?: string|null,
 *   title: string,
 *   editor: string,
 *   coverSlotId?: string,
 *   coverProjectId?: string,
 *   coverState?: string|null,
 *   coverImage?: string,
 *   steps?: Array<{id: string, label: string, hint?: string}>,
 *   operation?: "install"|"remove",
 *   run: (context: {report: Function}) => Promise<{failed?: string}|void>,
 *   onDone?: Function,
 *   onFailed?: Function,
 *   onCancelled?: Function,
 * }} spec `operation: "remove"` — работа снимает из игры (библиотека
 *   пересобирает набор эффектов без отмеченных частей): строка говорит
 *   «Удаление», а не «Установка». `onCancelled` — ждущую работу убрали из
 *   очереди, итога у неё не будет.
 */
export function enqueueWorkshopInstall(spec) {
  listenToBridge();
  const steps = spec.steps?.length ? spec.steps : DEFAULT_INSTALL_STEPS;
  const signature = signatureOf(spec.signature);
  /* Отменённая, но ещё не упёршаяся в затвор работа — уже не «идёт»: новое
     нажатие встаёт за ней, а не сливается с той, что уйдёт из списка. */
  const running = jobs.find(
    (job) =>
      job.key === spec.key && job.status === "running" && !job.cancelling,
  );
  const waiting = jobs.find(
    (job) =>
      job.key === spec.key &&
      (job.status === "queued" || job.status === "failed"),
  );
  if (running && sameVersion(running.signature, signature)) {
    if (waiting?.status === "queued") {
      batchIds.delete(waiting.id);
      jobs = jobs.filter((job) => job.id !== waiting.id);
      rebuild();
    }
    return running.id;
  }
  sequence += 1;
  const job = {
    id: waiting?.id || `workshop-install-${sequence}`,
    key: spec.key,
    signature,
    kind: "install",
    operation: spec.operation === "remove" ? "remove" : "install",
    title: spec.title,
    editor: spec.editor,
    /* Обложка строки — та же вещь, что на полке: слот рисователя плюс то,
       что рисовать (проект студии или снимок правки отдельного редактора). */
    coverSlotId: spec.coverSlotId || "",
    coverProjectId: spec.coverProjectId || "",
    coverState: spec.coverState || null,
    /* Картинка вещи, когда обложки раздела у работы нет: ствол — иконкой из
       меню паузы игры (18.10.2026, «нету превьюшки на помповые дробовики»). */
    coverImage: spec.coverImage || "",
    steps,
    run: spec.run,
    /* Работа, какой её сохранили при нажатии: установка ставит именно её, а
       не то, что человек накрутил, пока она ждала своей очереди. */
    saved: spec.saved ?? null,
    onDone: spec.onDone || null,
    onFailed: spec.onFailed || null,
    onCancelled: spec.onCancelled || null,
    onHeld: spec.onHeld || null,
    waitForGame: Boolean(spec.waitForGame),
    waitOnRefusal: Boolean(spec.waitOnRefusal),
    doneHoldMs: Number(spec.doneHoldMs) || WORKSHOP_INSTALL_DONE_MS,
    status: "queued",
    phase: steps[0].id,
    note: "",
    rpNote: "",
    error: "",
    errorDetail: "",
    errorKind: "",
    /* Попытка — отдельное число, а не просто новая строка: у повторного
       нажатия по той же работе имя строки то же, и без этого оболочка не
       отличила бы «поставили заново» от «строка просто висит». Работа летит
       в «Загрузки» и в первом случае, и во втором (work-flight.js). */
    attempt: (waiting?.attempt || 0) + 1,
    queuedAt: waiting?.queuedAt || now(),
    startedAt: 0,
    phaseStartedAt: 0,
    finishedAt: 0,
    copiedBytes: 0,
    totalBytes: 0,
    fraction: null,
  };
  /* Ждущая версия заменяется на своём месте: она уже стояла в очереди.
     Неудавшаяся — нет: новое нажатие по ней — новая просьба, и встаёт она в
     конец, а не впереди тех, кто нажал раньше. */
  jobs =
    waiting?.status === "queued"
      ? jobs.map((item) => (item.id === waiting.id ? job : item))
      : [...jobs.filter((item) => item.id !== waiting?.id), job];
  batchIds.add(job.id);
  rebuild();
  void pump();
  return job.id;
}

/** Убрать строку: ждущую — из очереди, неудавшуюся или готовую — с экрана. */
export function dismissWorkshopInstall(id, expected = "") {
  const job = findJob(id);
  if (!job || job.status === "running") return false;
  if (expected && job.status !== expected) return false;
  /* Ждущая, убранная из очереди, в партию больше не входит: «0 из 2» при
     одной оставшейся работе — неправда. Готовая остаётся посчитанной. */
  if (job.status !== "done") batchIds.delete(id);
  jobs = jobs.filter((item) => item.id !== id);
  rebuild();
  /* Кто ждёт итога этой работы (окно корзины библиотеки), узнаёт, что его не
     будет: ни `onDone`, ни `onFailed` у убранной из очереди не случится. */
  if (job.status === "queued") job.onCancelled?.();
  return true;
}

const dismiss = dismissWorkshopInstall;

/** Можно ли крестиком остановить эту работу сейчас. */
export const workshopInstallCancellable = (job) =>
  job?.status !== "running" ||
  (!job.wrote && job.operation !== "remove");

/**
 * Крестик строки «В процессе» (19.10.2026). Ждущая уходит из очереди, как и
 * раньше. Идущая — отменяется, пока в игру ещё ничего не пошло (план, чтение
 * файлов игры): затвор моста (`write-gate.js`) не пустит её запись, и строка
 * уйдёт, как только работа в него упрётся. Запись уже идёт или это снятие из
 * игры — `false`: оборванный на середине архив хуже долгого ожидания.
 */
export function cancelWorkshopInstall(id) {
  const job = findJob(id);
  if (!job) return false;
  if (job.status !== "running") return dismissWorkshopInstall(id);
  if (!workshopInstallCancellable(job)) return false;
  if (job.cancelling) return true;
  closeWorkshopWrites();
  /* Подготовка (план) прерывается сразу; запись в игру не прерывается — у неё нет сигнала. */
  runControllers.get(id)?.abort();
  patch(id, { cancelling: true });
  return true;
}

/**
 * Повторить неудавшуюся работу — тем же замыканием, что и в первый раз.
 * `saved` — повтор с уточнённой целью, когда человек ответил на отказ
 * (оптимизация: «Вернуть россыпь штатной» — `forceScatter`, бета 15.10).
 */
export function retryWorkshopInstall(id, { saved } = {}) {
  const job = findJob(id);
  if (!job || job.status !== "failed") return false;
  /* В конец очереди, как и новое нажатие: повтор — это новая просьба. */
  jobs = [
    ...jobs.filter((item) => item.id !== id),
    {
      ...job,
      ...(saved && typeof saved === "object" ? { saved } : {}),
      status: "queued",
      error: "",
      errorDetail: "",
      errorKind: "",
      note: "",
      rpNote: "",
      phase: job.steps[0].id,
      attempt: job.attempt + 1,
    },
  ];
  batchIds.add(id);
  rebuild();
  void pump();
  return true;
}

/**
 * Придержать очередь: в игру пишет кто-то, кого главный процесс в поток
 * фаз не выводит, — очередь загрузок каталога. Пока держат, своя работа не
 * начинается; отпустили — берётся следующая.
 *
 * @param {string} name кто держит
 * @param {string} [title] что именно идёт — для строки ждущей работы
 */
export function holdWorkshopInstalls(name, title = "") {
  if (holds.get(name) === title) return;
  holds.set(name, title);
  rebuild();
}

/** Отпустить очередь — и сразу взять следующую работу. */
export function releaseWorkshopInstalls(name) {
  if (!holds.delete(name)) return;
  rebuild();
  void pump();
}

/** Очередь каталога непуста — партия мастерской продолжается вместе с ней. */
export function setWorkshopBatchPartner(active) {
  if (batchPartner === Boolean(active)) return;
  batchPartner = Boolean(active);
  rebuild();
}

/*
 * Кто пишет в игру прямым вызовом главного процесса, мимо очереди, и ждёт её тишины («Установить снова»
 * после проверки файлов игры). Замок главного процесса один на всё окно и такому вызову отказывает
 * («Мастерская уже применяет изменения»), поэтому он встаёт в очередь здесь, как работа.
 */
const beside = new Set();

/* Тишина для `name`: нет идущей работы и чужой операции, и держит очередь только он сам. */
const quietFor = (name) => !runningJob() && !external && [...holds.keys()].every((owner) => owner === name);

function untilQuiet(name) {
  if (quietFor(name)) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!quietFor(name)) return;
      structureListeners.delete(check);
      resolve();
    };
    structureListeners.add(check);
  });
}

/**
 * Выполнить запись в игру мимо очереди: дождаться, пока идущая работа, чужая операция и установка из каталога
 * кончатся, не пустить за это время в игру ждущие работы и отпустить их, когда `task` закончилась — удачно или нет.
 * Отказа «дождитесь окончания» человек не видит: возврат просто встаёт за идущей записью (журнал 15.11.2026,
 * «Установить снова» против очереди из Ашана и Мегамолла).
 *
 * @param {string} name кто пишет — ключ удержания очереди
 * @param {string} title что идёт — для строки ждущей работы
 * @param {() => Promise<T>} task сама запись; зовётся, когда очередь затихла
 * @returns {Promise<T>}
 * @template T
 */
export async function runBesideWorkshopInstalls(name, title, task) {
  listenToBridge();
  beside.add(name);
  holdWorkshopInstalls(name, title);
  try {
    await untilQuiet(name);
    return await task();
  } finally {
    beside.delete(name);
    releaseWorkshopInstalls(name);
  }
}

/**
 * Пишет ли очередь в игру прямо сейчас — или собирается: ждущая работа
 * начнётся, как только освободится замок. Очередь каталога спрашивает
 * это перед каждой своей установкой.
 */
export function workshopInstallsWriting() {
  return Boolean(external) || beside.size > 0 || jobs.some(isLive);
}

/** Всё, вместе с байтами шага: строка «Загрузок» и заливка кнопки. */
export function subscribeWorkshopInstalls(listener) {
  listeners.add(listener);
  listenToBridge();
  return () => listeners.delete(listener);
}

export function workshopInstallsSnapshot() {
  return snapshot;
}

/** Только устройство очереди: оболочка, полки, редакторы, корзина. */
export function subscribeWorkshopInstallsStructure(listener) {
  structureListeners.add(listener);
  listenToBridge();
  return () => structureListeners.delete(listener);
}

export function workshopInstallsStructure() {
  return structure;
}

/**
 * Что с этой работой — для кнопки «Применить».
 *
 * Сравнивается с последней версией в очереди: ждущей, если она есть, иначе
 * с той, что ставится. Именно с последней — человек, вернувшийся к версии,
 * которая сейчас ставится, после неё получил бы ждущую, и кнопка обязана
 * сказать, что нажатие ещё нужно.
 *
 *   `""`             — этой работы в очереди нет;
 *   `running`        — ставится ровно эта версия;
 *   `queued`         — ровно эта версия ждёт;
 *   `running-other`  — ставится другая версия, эта встанет за ней;
 *   `queued-other`   — ждёт другая версия, нажатие заменит её этой.
 *
 * @param {string} key
 * @param {string|null} [signature] версия в редакторе сейчас
 */
/* Кнопке «Применить» отменённая работа уже не своя: она вот-вот уйдёт. */
const isOwnLive = (job) => isLive(job) && !job.cancelling;

export function workshopInstallStatusOf(key, signature = null) {
  const live = jobs.filter((job) => job.key === key && isOwnLive(job));
  if (!live.length) return "";
  const latest = live.find((job) => job.status === "queued") || live[0];
  if (sameVersion(latest.signature, signatureOf(signature)))
    return latest.status;
  return `${latest.status}-other`;
}

/**
 * Сколько этой версии работы уже прошло — для заливки кнопки «Применить».
 *
 * Числом, а не объектом: кнопка читает его через `useSyncExternalStore`, и
 * снимок обязан совпадать сам с собой, пока ничего не изменилось. Целые
 * проценты: заливке точнее не нужно, а каждое новое число — это отрисовка
 * кнопки.
 *
 *   `null`   — этой версии в очереди нет;
 *   `-1`     — ждёт своей очереди;
 *   `0…99`   — ставится, столько процентов пройдено;
 *   `100`    — только что встала в игру: строка «готово» ещё держится в
 *              очереди (`WORKSHOP_INSTALL_DONE_MS`). Снятие из игры сюда не
 *              считается — «готово» на кнопке «Применить» было бы неправдой.
 *
 * @param {string} key
 * @param {string|null} [signature] версия в редакторе сейчас
 */
export function workshopInstallShareOf(key, signature = null) {
  const wanted = signatureOf(signature);
  const own = jobs.filter(
    (job) => job.key === key && sameVersion(job.signature, wanted),
  );
  const live = own.find(isOwnLive);
  if (live) {
    if (live.status === "queued") return -1;
    return Math.min(99, Math.floor(workshopInstallShare(live) * 100));
  }
  return own.some((job) => job.status === "done" && job.operation !== "remove")
    ? 100
    : null;
}

/**
 * Чем кончилась последняя попытка этой работы, если не удалась, — для той же
 * кнопки «Применить»: отказ говорится на её месте, а не всплывашкой, которая
 * гаснет через семь секунд (задача 1 ТЗ 08.10, вечер). Строкой, чтобы снимок
 * совпадал сам с собой; пустая — отказа нет. Пока работа снова ждёт или
 * ставится, отказа нет: прежняя попытка уже не про то, что происходит.
 *
 * @param {string} key
 * @returns {string}
 */
export function workshopInstallFailureOf(key) {
  if (jobs.some((job) => job.key === key && isLive(job))) return "";
  const failed = jobs.find(
    (job) => job.key === key && job.status === "failed",
  );
  return failed ? failed.error || tr("Установка не удалась.") : "";
}

/**
 * Текст движка за тем же отказом, без перевода и без советов: по нему окно
 * узнаёт отказ-вопрос («оставить своё или заменить»), чья человеческая строка
 * зависит от языка.
 */
export function workshopInstallFailureDetailOf(key) {
  if (jobs.some((job) => job.key === key && isLive(job))) return "";
  const failed = jobs.find(
    (job) => job.key === key && job.status === "failed",
  );
  return failed ? failed.errorDetail || failed.error || "" : "";
}

/** Человек прочитал отказ и закрыл его: строка уходит и из «Загрузок». */
export function dismissWorkshopFailure(key) {
  for (const job of jobs.filter(
    (item) => item.key === key && item.status === "failed",
  ))
    dismissWorkshopInstall(job.id, "failed");
}

/**
 * Где работа в очереди — для слов после нажатия: «ставим» или «встанет
 * после текущей».
 *
 * @returns {{status: string, ahead: number}|null} `ahead` — сколько работ
 *   и чужих операций пройдут в игру раньше этой
 */
export function workshopInstallPlace(id) {
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) return null;
  const ahead =
    jobs.filter(
      (job, position) =>
        job.status === "running" ||
        (job.status === "queued" && position < index),
    ).length + (external ? 1 : 0);
  return { status: jobs[index].status, ahead };
}

/*
 * Строка для экрана «В процессе»: шаги с долями, подпись текущего шага и
 * то, чем строку можно закончить.
 */
export function describeWorkshopInstall(job) {
  const steps = job.steps;
  const index = steps.findIndex((step) => step.id === job.phase);
  const activeIndex =
    job.phase === "complete" || job.status === "done"
      ? steps.length
      : Math.max(0, index);
  /* Ход сборки растительности и дорог считается по файлам: M известно до сборки, поэтому доля честная. */
  const planned = job.progress?.phase === "build" && job.progress.total > 0 ? job.progress.done / job.progress.total : null;
  /* Идёт пересборка пакета поверх (слова и нормализация — `dependent-words.js`): доля есть только у сборки файлов, у записи в архив её нет — бегущая полоса, а не застывшие проценты прежней ступени. */
  const measured = job.dependent
    ? (job.dependent.fraction ?? null)
    : typeof job.fraction === "number"
      ? job.fraction
      : planned !== null
        ? planned
      : job.totalBytes > 0
        ? job.copiedBytes / job.totalBytes
        : null;
  const waiting = job.status === "queued";
  return {
    steps: fillSteps(steps, waiting ? -1 : activeIndex, waiting ? 0 : measured),
    step: steps[Math.min(activeIndex, steps.length - 1)],
    measured,
    done: job.status === "done",
    failed: job.status === "failed",
    waiting,
    /* Шаг идёт, а объём ещё не известен: процента нет — не «0 %», а бегущая полоса. */
    indeterminate: !waiting && job.status !== "done" && job.status !== "failed" && measured === null,
  };
}

/**
 * Доля всей работы: пройденные шаги плюс то, что известно о текущем. Одна на
 * строку экрана «В процессе» и на заливку кнопки «Применить» — иначе кнопка и
 * строка однажды показали бы разные проценты одной и той же записи.
 */
export function workshopInstallShare(job, view = describeWorkshopInstall(job)) {
  if (view.done) return 1;
  if (view.waiting) return 0;
  const index = job.steps.findIndex((step) => step.id === job.phase);
  const passed = Math.max(0, index);
  const inside = view.measured === null ? 0 : view.measured;
  return Math.min(1, (passed + inside) / job.steps.length);
}

/** Для тестов: очередь заводится заново. */
export function resetWorkshopInstalls() {
  if (gameRecheck) clearTimeout(gameRecheck);
  gameRecheck = null;
  jobs = [];
  external = null;
  pumping = false;
  batchIds.clear();
  batchCompleted = 0;
  batchPartner = false;
  holds.clear();
  beside.clear();
  openWorkshopWrites();
  bridgeStop?.();
  bridgeStop = null;
  rebuild();
}
