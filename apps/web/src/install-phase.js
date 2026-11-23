/*
 * Фазы установки на человеческом языке.
 *
 * Движок называет фазы так, как ему удобно писать код: `ready-to-commit`,
 * `compose`, `finalizing`. В окне это должно читаться одинаково везде — и в
 * очереди загрузок магазина, и в Мастерской, — иначе одна и та же работа
 * называется по-разному на двух экранах, и человек считает, что это разные
 * вещи.
 */

/*
 * Ключ фазы движка: `ready-to-commit`, `commit`, `compose` … Слова к нему —
 * на языке окна, в features/downloads/downloads-copy.js (`phases`), чтобы
 * фаза называлась одинаково на обоих экранах и на любом языке.
 */
/*
 * Подпись этапа движка в строке очереди (русская строка — ключ словаря, переводит окно): что
 * именно делает Astral сейчас, пока шаг не пересчитан в проценты. Процент — по байтам, если движок их шлёт.
 */
const STAGE_NOTE = Object.freeze({
  read: "Проверяем архив игры",
  prepare: "Готовим записи архива",
  compose: "Собираем архив игры",
  verify: "Проверяем собранный архив",
  /* Работа мастерской ждёт, пока Astral закончит подготовку игры (`workshop-operations.js`). */
  "wait-prepare": "Ждём конца подготовки игры",
});

/** Подпись этапа по фазе движка, или пустая строка, если у фазы своей подписи нет. */
export function installStageNote(phase) {
  return STAGE_NOTE[String(phase || "").toLowerCase()] || "";
}

export function installPhaseKey(phase) {
  const value = String(phase || "").toLowerCase();
  if (!value) return "";
  if (/ready-to-commit/.test(value)) return "ready";
  if (/commit/.test(value)) return "commit";
  if (/compose/.test(value)) return "compose";
  if (/components/.test(value)) return "components";
  if (/backup/.test(value)) return "backup";
  if (/verify|check/.test(value)) return "verify";
  if (/prepare/.test(value)) return "prepare";
  if (/download|write|extract|copy/.test(value)) return "download";
  if (/complete|finish|final/.test(value)) return "finish";
  return "";
}

/*
 * Шаги установки из Мастерской.
 *
 * Проценты движка сюда не годятся: его шкала отдаёт 0–90 скачиванию пакета,
 * а у Мастерской скачивания нет — полоса вставала бы на 90 % в первую секунду
 * и стояла там всю пересборку. Поэтому шкала считается по шагам, и честно:
 * на копировании и подмене архива движок присылает скопированные байты, а
 * внутри сборки helper молчит, и полоса на этом шаге не притворяется
 * знающей — она бежит без числа.
 *
 * Шаги названы тем, что видит человек в папке игры, а не тем, как называются
 * функции: «Резервная копия», «Сборка архива», «Применение». Подсказка при
 * каждом отвечает на два вопроса, которые задают про долгую операцию: «оно не
 * зависло?» — тем, что написано, чем именно занят Astral, — и «сколько ещё?»,
 * тем, что про самый долгий шаг честно сказано, что он самый долгий.
 */
export const WORKSHOP_INSTALL_STEPS = Object.freeze([
  {
    id: "prepare",
    label: "Подготовка",
    hint: "Astral проверяет состояние игры и прошлые установки",
  },
  {
    id: "backup",
    label: "Резервная копия",
    hint: "Оригинал архива копируется целиком — снять мод можно будет в один клик",
  },
  {
    id: "compose",
    label: "Сборка архива",
    hint: "Самая долгая часть: архив игры пересобирается вместе с модом",
  },
  {
    id: "verify",
    label: "Проверка",
    hint: "Astral перечитывает собранный архив и сверяет каждую запись",
  },
  {
    id: "commit",
    label: "Применение",
    hint: "Файл игры подменяется целиком — прерывать уже нельзя",
  },
]);

const STEP_OF_PHASE = (phase) => {
  const value = String(phase || "").toLowerCase();
  if (/complete/.test(value)) return WORKSHOP_INSTALL_STEPS.length;
  if (/commit|finalizing/.test(value)) return 4;
  if (/verify|check/.test(value)) return 3;
  if (/compose|rpf/.test(value)) return 2;
  if (/backup/.test(value)) return 1;
  return 0;
};

/*
 * Имя шага по фазе движка.
 *
 * Очередь применения ведёт свой список шагов: у большой карты перед записью
 * идёт отрисовка плиток, которой движок не знает и знать не может — она
 * происходит в окне. Поэтому шаг ищется по имени, а не по номеру: номер
 * четвёртого шага у карты и у мини-карты разный, а «Применение» у обеих одно.
 */
export function workshopPhaseStepId(phase) {
  const index = STEP_OF_PHASE(phase);
  return index >= WORKSHOP_INSTALL_STEPS.length
    ? "complete"
    : WORKSHOP_INSTALL_STEPS[index].id;
}

/*
 * Шаг после записи — у тех работ, что заменяют собой прежнюю версию.
 *
 * Поставив новую версию, Astral убирает точку отката прежней: иначе удаление
 * новой вернуло бы в игру не чистый архив, а предыдущую версию, и каждое
 * «Применить» копило бы по два гигабайта. Это второй проход по архиву, и он
 * такой же долгий, как первый, — молчать про него нельзя.
 */
export const WORKSHOP_RETIRE_STEP = Object.freeze({
  id: "retire",
  label: "Уборка",
  hint: "Точка отката прежней версии сливается с новой — архив не копится",
});

/*
 * Шаги удаления из библиотеки.
 *
 * У удаления нет «сборки с модом»: архив перематывается к копии без
 * удаляемого, моды каталога снимаются движком, а работы, лежавшие сверху,
 * ставятся обратно. Какие из шагов будут, операция знает заранее и присылает
 * списком (`steps`): удаление одной верхней работы — это только возврат
 * архива, и расписывать ему «Снятие модов» значило бы показать шаг, которого
 * не будет.
 */
export const WORKSHOP_REMOVAL_STEPS = Object.freeze([
  {
    id: "prepare",
    label: "Подготовка",
    hint: "Astral сверяет архив игры с тем, что ставил, и проверяет место на диске",
  },
  {
    id: "rewind",
    label: "Возврат архива",
    hint: "В игру кладётся копия архива без удаляемого — она сверяется по дороге",
  },
  {
    id: "remove-mod",
    label: "Снятие модов",
    hint: "Движок пересобирает архив без выбранных модов каталога",
  },
  {
    id: "replay",
    label: "Возврат остального",
    hint: "Работы, лежавшие поверх удалённого, ставятся обратно",
  },
]);

/*
 * Шаги «Установить снова» после проверки файлов игры (задача 2 ТЗ
 * 10.10.2026): движок кладёт снятые моды поверх нового архива одной сборкой,
 * потом работы мастерской встают по порядку, как стояли.
 */
export const WORKSHOP_REINSTALL_STEPS = Object.freeze([
  {
    id: "prepare",
    label: "Подготовка",
    hint: "Astral сверяет игру после проверки файлов и проверяет, что GTA V закрыта",
  },
  {
    id: "restore-mods",
    label: "Возврат модов",
    hint: "Движок кладёт снятые моды поверх нынешнего архива игры одной сборкой",
  },
  {
    id: "reinstall-works",
    label: "Работы мастерской",
    hint: "Работы, стоявшие до проверки файлов, ставятся заново по порядку",
  },
]);

function removalSteps(status) {
  const planned = Array.isArray(status?.steps) ? status.steps : null;
  return planned
    ? WORKSHOP_REMOVAL_STEPS.filter((step) => planned.includes(step.id))
    : WORKSHOP_REMOVAL_STEPS;
}

const flowSteps = (status) => {
  if (status?.flow === "removal") return removalSteps(status);
  return status?.flow === "reinstall" ? WORKSHOP_REINSTALL_STEPS : WORKSHOP_INSTALL_STEPS;
};

const stepIndex = (status, steps) => {
  if (status?.flow !== "removal" && status?.flow !== "reinstall")
    return STEP_OF_PHASE(status?.phase);
  const phase = String(status?.phase || "").toLowerCase();
  if (/complete/.test(phase)) return steps.length;
  const index = steps.findIndex((step) => step.id === phase);
  return Math.max(0, index);
};

const clampFraction = (value) => Math.max(0, Math.min(1, value));

/*
 * Полоса шага: заполнена у пройденных, пустая у будущих, а у текущего —
 * настоящая доля там, где она известна (копирование архива), и признак
 * «идёт, но без числа» там, где её нет (сборка helper'ом).
 *
 * `activeIndex` за концом списка означает «всё пройдено»: так выглядит фаза
 * `complete` до того, как операция снимется с экрана.
 */
export function fillSteps(steps, activeIndex, fraction = null) {
  return steps.map((step, index) => {
    if (index < activeIndex)
      return { ...step, state: "done", fraction: 1, unmeasured: false };
    if (index > activeIndex)
      return { ...step, state: "waiting", fraction: 0, unmeasured: false };
    return {
      ...step,
      state: "active",
      fraction: fraction === null ? 0 : clampFraction(fraction),
      unmeasured: fraction === null,
    };
  });
}

export function workshopInstallSteps(status) {
  const steps = flowSteps(status);
  const total = Number(status?.totalBytes) || 0;
  const copied = Number(status?.copiedBytes) || 0;
  return fillSteps(
    steps,
    stepIndex(status, steps),
    total > 0 ? copied / total : null,
  );
}

/* Шаг, на котором сейчас работа. Фаза `complete` выходит за конец списка:
   пока рамка не закрылась, показывается последний шаг, а не пустота. */
export function workshopInstallStep(status) {
  const steps = flowSteps(status);
  const index = Math.min(stepIndex(status, steps), steps.length - 1);
  return steps[index];
}

export function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
