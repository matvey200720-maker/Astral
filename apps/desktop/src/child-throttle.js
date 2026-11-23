/*
 * Дочерний процесс под регулятором диска (20.11.2026, `packages/install-engine/process-throttle.js`).
 *
 * Помощник .NET (`rpf-composer.js`) пишет собранный архив на 1,9 ГБ без потолка и без отдыха: ни движковые потолки, ни отдых `diskTurn` до него не доходят — в замере 20.11 ровно он держал диск
 * в сотку там, где движок под регулятором уже шёл на 40 %. Его темп задаётся снаружи: пока регулятор говорит «доля меньше 1», процесс по кругу в 200 мс работает эту долю и стоит остальное.
 * **ВРЕМЕННЫЙ, В ПОСТАВКУ НЕ ИДЁТ, не включать.** Решение ведущей 20.11: слой с новым контейнером сильный ПК переводит на движок (`rpf-composer.js: chooseComposeWriter`), а круг над чужим процессом
 * оставляет осиротевший приостановленный помощник, который держит `update.rpf` игры открытым, и вызовы ntdll из PowerShell — повод для срабатывания антивирусов. Выключен во всех каналах, включая
 * альфу; стенд включает его словом `ASTRAL_DISK_GOVERNOR_CHILD=1` (замер — справка в документе). Когда регулятор включён, а процесс уже стоит под кругом, «Быстрая установка» и доля 1 возвращают ход сразу.
 */

import {
  diskGovernor,
  governorSwitch,
} from "@modovik/install-engine/disk-governor.js";
import { createProcessThrottle } from "@modovik/install-engine/process-throttle.js";

export const CHILD_ENV = "ASTRAL_DISK_GOVERNOR_CHILD";
/* Процесс под кругом не стоит дольше этого суммарно: у помощника свой срок на пересборку — 10 минут (`rpf-composer.js`), и «установка не встаёт» важнее занятости диска. Потом круг снимается. */
export const CHILD_BUDGET_MS = 4 * 60 * 1000;
/* Доля работы за круг не ниже этой: на 5–10 % процесс по сути стоит, а занятость диска от этого не падает — сброс кэша идёт и без него. */
export const CHILD_MIN_DUTY = 0.2;

let shared = null;
function sharedThrottle() {
  if (!shared) {
    shared = createProcessThrottle({});
    process.once("exit", () => shared?.close());
  }
  return shared;
}

/** Закрыть общий ограничитель процессов: тестам и выходу. */
export function closeSharedChildThrottle() {
  shared?.close();
  shared = null;
}

/**
 * Взять процесс `child` под регулятор. Ответ — «отпустить» (вызывается и по выходу процесса). Без регулятора, с выключателем `ASTRAL_DISK_GOVERNOR_CHILD=off`, без номера процесса — ничего не делает.
 */
export function governChild(
  child,
  {
    governor = diskGovernor(),
    throttle = null,
    env = process.env,
    budgetMs = CHILD_BUDGET_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  /* Решение ведущей 20.11: круг в поставку НЕ идёт ни в одном канале, включая альфу — только стенд ставит `ASTRAL_DISK_GOVERNOR_CHILD=1`. */
  if (governorSwitch(env?.[CHILD_ENV]) !== true) return () => {};
  if (!governor.isActive() || !Number.isInteger(child?.pid)) return () => {};
  const limiter = throttle ?? sharedThrottle();
  const letGo = governor.hold();
  const release = limiter.govern(child);
  const follow = () =>
    limiter.setScale(Math.max(CHILD_MIN_DUTY, governor.scaleFor(null)));
  const stop = governor.subscribe(follow);
  follow();
  let done = false;
  const budget = setTimer(() => finish(), budgetMs);
  budget?.unref?.();
  const finish = () => {
    if (done) return;
    done = true;
    clearTimer(budget);
    stop();
    release();
    letGo();
    /* Своя доля больше никому не нужна: остальные процессы (если они есть) держат её по решениям регулятора. */
    if ((limiter.targets?.() ?? []).length === 0) limiter.setScale(1);
  };
  child.once?.("exit", finish);
  return finish;
}
