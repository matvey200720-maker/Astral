import os from "node:os";
import { IO_PRIORITY, setProcessIoPriority } from "@modovik/native-rs";

/*
 * Приоритет фоновой работы установки (30.10.2026, «скачивание и установка не должны съедать процессор и диск»).
 *
 * Установка пакета и сборка архивов — это минуты тяжёлой работы: движок (Rust) читает и пишет архивы по 2–3 ГБ, помощник RPF и ArchiveFix пересобирают
 * контейнеры. Замер на копии архива 3,3 ГБ (`docs/INSTALL-LOAD.md`): движок — 70–90 % ядра в среднем и до 165 %, диск занят до 100 %. Свой ввод-вывод движок
 * уже уводит в фоновый режим Windows (`disk.rs`, `THREAD_MODE_BACKGROUND_BEGIN`), а вот процессор — нет: на обычном приоритете он отбирает ядра у игры
 * и браузера, пока человек ждёт установку.
 *
 * Поэтому процесс установки получает приоритет «ниже обычного» (`PRIORITY_BELOW_NORMAL`): процессор, когда он нужен другим, достаётся им, а когда свободен —
 * установка идёт той же скоростью. Права администратора не нужны: приоритет своего дочернего процесса меняет любой процесс (Windows — `SetPriorityClass`,
 * Unix — `nice` вверх). Дети процесса (ArchiveFix у движка) наследуют класс от родителя. Сбой смены приоритета установку не трогает.
 *
 * Только для команд, которые пишут и пересобирают архивы (`BACKGROUND_COMMANDS`): быстрые команды чтения, от которых окно ждёт ответа (разбор модели
 * для предпросмотра), остаются на обычном приоритете.
 */

/** Команды движка, которые идут в фоне: запись и сборка архивов. */
export const BACKGROUND_COMMANDS = Object.freeze(new Set(["install-rpf-patch", "compose-rpf"]));

/* Класс приоритета процессора процессу `child`: `true` — сменился. */
function setProcessorPriority(child, setPriority, level) {
  const pid = child?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    setPriority(pid, level);
    return true;
  } catch {
    return false;
  }
}

/*
 * Ступень ввода-вывода фоновых процессов установки (18.11.2026, слово владельца «диск в сотку, ПК умирает»).
 *
 * Класс приоритета процессора диск не трогает: чтения и записи движка, помощника RPF и сборок стояли в одной очереди с
 * игрой и браузером (опыт 18.11: после `os.setPriority` ступень ввода-вывода остаётся обычной). Ступень ставит система
 * (`setProcessIoPriority` модуля `@modovik/native-rs`): обычный режим — «низкий», «Быстрая установка» — «обычный».
 *
 * Почему «низкий», а не «очень низкий» (замер 18.11.2026 на ПК владельца, NVMe, два круга по прогону на ступень,
 * `docs/VEGETATION-THIRD-PACK.md`, раздел 3): пользы чужим программам на быстром диске не показала ни одна ступень, а
 * «очень низкий» во втором круге растянул работу движка в 2,2 раза (рядом кто-то писал на диск). Фоновый ввод-вывод
 * уступает всем — и собственной загрузке Astral, которая идёт в главном процессе. Ставить его по умолчанию можно
 * только после замера на медленном диске с известной нагрузкой рядом: `ASTRAL_INSTALL_IO_PRIORITY=0`.
 * Режим сменили — ступень идущих процессов меняется сразу. Дети, которых процесс запустит после понижения, ступень
 * наследуют (ArchiveFix у движка, движок у сборки); уже запущенных детей возврат родителя не поднимает — замер 18.11.
 *
 * Понижаются только дочерние процессы фоновой работы. Главный процесс и окно не трогаются: потоки копии внутри главного
 * процесса (`copy-worker.js`) этой ступенью не достать — она у процесса целиком.
 *
 * Нет модуля, старый модуль, отказ системы — `false`, установка идёт как шла.
 */
const ioFollowers = new Set();
let ioGentle = true;

/** Своя ступень обычного режима для стендов: `0` — «очень низкий», `2` — не понижать. Без переменной — «низкий». */
export const GENTLE_IO_ENV = "ASTRAL_INSTALL_IO_PRIORITY";

export function gentleIoLevel(env = process.env) {
  const word = String(env?.[GENTLE_IO_ENV] ?? "").trim();
  if (word === "0") return IO_PRIORITY.veryLow;
  if (word === "2") return IO_PRIORITY.normal;
  return IO_PRIORITY.low;
}

const ioLevelNow = () => (ioGentle ? gentleIoLevel() : IO_PRIORITY.normal);

function setIoLevel(follower, level) {
  try {
    return follower.setIoPriority(follower.child.pid, level) === true;
  } catch {
    return false;
  }
}

/*
 * Процесс `child` получает ступень режима и следует за ним до своего выхода. После выхода номер процесса может достаться
 * чужому — за вышедшим не следим; процесс без события `exit` получает ступень один раз.
 */
function followIoPriority(child, setIoPriority) {
  const pid = child?.pid;
  if (typeof setIoPriority !== "function" || !Number.isInteger(pid) || pid <= 0) return () => {};
  const follower = { child, setIoPriority };
  const level = ioLevelNow();
  /* Свежему процессу «обычную» ставить незачем: она у него и так обычная. */
  if (level !== IO_PRIORITY.normal) setIoLevel(follower, level);
  if (typeof child.once !== "function") return () => {};
  ioFollowers.add(follower);
  const stop = () => {
    ioFollowers.delete(follower);
  };
  child.once("exit", stop);
  return stop;
}

/* Свой `setPriority` (тесты, подставные процессы) — значит, и настоящую ступень диска чужому номеру процесса не ставим. */
const ioSetterFor = (setPriority, setIoPriority) =>
  setIoPriority !== undefined ? setIoPriority : setPriority === os.setPriority ? setProcessIoPriority : null;

/** Режим скорости для ввода-вывода: `true` — обычный (фоновые процессы уступают диск), `false` — «Быстрая установка». */
export function setBackgroundIoGentle(next) {
  ioGentle = next !== false;
  const level = ioLevelNow();
  for (const follower of ioFollowers) setIoLevel(follower, level);
}

export const backgroundIoGentle = () => ioGentle;

/**
 * Понизить приоритет процесса `child` до «ниже обычного» и дать его вводу-выводу ступень режима. `true` — приоритет процессора
 * сменился; `false` — нет процесса, нет такого права или платформа не даёт.
 */
export function lowerBackgroundPriority(
  child,
  { setPriority = os.setPriority, level = os.constants.priority.PRIORITY_BELOW_NORMAL, setIoPriority = undefined } = {},
) {
  const lowered = setProcessorPriority(child, setPriority, level);
  followIoPriority(child, ioSetterFor(setPriority, setIoPriority));
  return lowered;
}

/*
 * Процессы сборки наборов (растительность, дороги — `build-process.js`), 18.11.2026.
 *
 * Сборка растительности — минуты работы пула потоков на всех ядрах (у тестера альфы 0.9.0-beta.108 — 6,5 минуты), и шла она
 * на обычном приоритете: у движка установки ступень «ниже обычного» была, у сборок — нет. Теперь их приоритет следует за
 * «Быстрой установкой»: обычный режим — «ниже обычного» (окно и другие программы получают процессор первыми), быстрый —
 * обычный. Режим сменили посреди сборки — приоритет идущего процесса меняется сразу, в отличие от процесса движка.
 */
const followers = new Set();
let gentle = true;
const levelFor = (isGentle) => (isGentle ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_NORMAL);

/** Процесс `child` следует за режимом скорости установки. Ответ — функция «больше не следить» (процесс вышел). */
export function followInstallSpeed(child, { setPriority = os.setPriority, setIoPriority = undefined } = {}) {
  const follower = { child, setPriority };
  followers.add(follower);
  setProcessorPriority(child, setPriority, levelFor(gentle));
  const unfollowIo = followIoPriority(child, ioSetterFor(setPriority, setIoPriority));
  return () => {
    followers.delete(follower);
    unfollowIo();
  };
}

/** Режим скорости установки сменился: `true` — обычный (сборки уступают процессор), `false` — «Быстрая установка». */
export function setBackgroundGentle(next) {
  gentle = next !== false;
  for (const follower of followers) setProcessorPriority(follower.child, follower.setPriority, levelFor(gentle));
}

export const backgroundGentle = () => gentle;
