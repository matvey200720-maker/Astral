import { tr } from "../../locales/ui.js";
import { beginInstallWait, endInstallWait, isWaitingToInstall, settleInstallWait } from "../downloads/prepare-wait.js";

/*
 * Установка, которой нужна подготовка игры (T-0001, 22.11.2026). Один помощник на все входы, где перед очередью ждут подготовку: одиночный мод и
 * редукс, сборка, набор «Эффектов» и «Трейсеров», набор частей редукса. Зовётся только при `preparation.stockHold` — готовая игра идёт прежним ходом и сюда не попадает.
 * Ленивый модуль: слова и логика не едут в главный кусок окна.
 */

/* Подготовку по щелчку ведёт ровно одно ожидание: другой мод, нажатый, пока она идёт, присоединяется к нему (T-0001, доработка 2). */
let leader = null;

/** Слова человеку сразу после щелчка: что происходит, сколько и что будет дальше. */
export const prepareWaitWords = () => `${tr("Готовим игру к первой установке, до двух минут")}. ${tr("Установка начнётся сама")}.`;

/** Слово человеку, не роняя ничего: оповещение окна могло исчезнуть. */
const say = (notify) => {
  try {
    notify?.(prepareWaitWords());
  } catch {
    /* слово не показано — страница «Загрузки» всё равно держит героя */
  }
};

/**
 * Снимает удержание штатной игры и ждёт конца подготовки; пока ждёт, «Загрузки» показывают мод героем, а человеку сказано слово.
 * Отказ подготовки её слова (`preparationStop`, `humanFailure`) говорит сама оболочка на следующем шаге установки; запись ожидания уходит в любом случае.
 * @param {{ game: object, prepareGame: Function, notify: Function }} shell
 * @param {{ id: string, name: string }} mod
 */
export async function releaseHeldGame(shell, mod) {
  const run = holdRun(shell, mod);
  leader = run;
  try {
    await run;
  } finally {
    if (leader === run) leader = null;
  }
}

async function holdRun({ game, prepareGame, notify }, mod) {
  const wait = beginInstallWait(mod);
  try {
    say(notify); /* слово человеку не должно ронять установку: подготовка идёт, а запись ожидания снимется ниже */
    await prepareGame(game, { force: true, releaseStockHold: true });
    /* Подготовка кончилась: запись ещё недолго держится, пока идёт план и в очереди не появилась строка (`settleInstallWait`). */
    settleInstallWait(wait);
  } catch (error) {
    endInstallWait(wait);
    throw error;
  }
}

/** Второй щелчок по моду, пока он ждёт игру: слово человеку (готовое «уже в очереди» даёт оболочка), а не молчание. */
export function repeatedClick(mod, notify, word) {
  if (isWaitingToInstall(mod?.id)) notify?.(word);
}

/*
 * Другой мод во время идущей подготовки: запись ожидания, то же слово и один перезапуск его установки, когда подготовка кончилась. Перезапуск — `restart` оболочки
 * (`installOnce`, он зовёт последнюю отрисованную `install`), а не продолжение прежнего вызова: у того `game` и `preparation` из замыкания времени щелчка, до подготовки. Перезапуск
 * ждёт один ход событий, чтобы окно успело принять состояние «готово» (подготовка пишет его сразу перед возвратом). Отказ подготовки снимает запись; слова говорит оболочка у первого мода.
 */
function joinLeader({ notify, restart }, mod) {
  if (isWaitingToInstall(mod?.id)) return true;
  const wait = beginInstallWait(mod);
  say(notify);
  leader.then(
    () => {
      setTimeout(() => {
        settleInstallWait(wait);
        Promise.resolve(restart?.()).catch(() => {});
      }, 0);
    },
    () => endInstallWait(wait),
  );
  return true;
}

/**
 * Вход присоединения для оболочки (`DesktopShell.jsx`, проверка «подготовка идёт» в начале `install`). `true` — установка этого мода передана ожиданию, вызывающий выходит;
 * `false` — подготовку по щелчку никто не ведёт (обычная подготовка при запуске и т. п.), прежний путь с его словом «подготовка идёт» не меняется.
 * @param {{ notify: Function, restart: Function }} shell
 * @param {{ id: string, name: string }} mod
 */
export function joinPreparing(shell, mod) {
  return leader ? joinLeader(shell, mod) : false;
}
