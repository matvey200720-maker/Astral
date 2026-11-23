/*
 * Ход запуска окна для заставки «Контур» (15.11.2026).
 *
 * `loadStartup` (`../startup.js`) сообщает, какой из четырёх запросов закрылся (`onStage`), оболочка — что окно открылось
 * (`ready`). Заставка живёт отдельно от оболочки (стоит рядом с ней, `pages/DesktopAppPage.jsx`) и читает это отсюда: её свет
 * идёт по факту, а не по сценарию. Сюда ничего не рисуется и React не нужен — это маленькое хранилище на модуль.
 *
 * Песочница и разработка: заставки там нет, пока в адресе не стоит `?qa-splash` (флаги — `startup-flow-qa.js`, в продуктовую
 * сборку они не попадают). В продуктовой сборке окна заставка идёт всегда.
 */

import { wokeFromHibernation } from "../../hibernation/hibernation-client.js";
import { qaPlan } from "./startup-flow-qa.js";

const COUNT = 4; // этапы — в порядке лучей знака, номера — `STARTUP_STAGE` из `../startup.js`
const QUIET_KEYS = ["preview", "qa", "demo", "developer", "qa-auth"];

function paramsOf() {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

export function createStartupFlow({
  params = paramsOf(),
  clock = () => performance.now(),
  dev = false,
  woke = () => false,
} = {}) {
  const qa = import.meta.env.DEV ? qaPlan(params, clock) : null;
  const quiet = dev || QUIET_KEYS.some((key) => params.has(key));
  const enabled = Boolean(qa?.enabled) || !quiet;
  const listeners = new Set();
  const reported = [false, false, false, false];
  let ready = false;
  let failure = null;
  let gone = !enabled;
  let waking = null;

  const flow = {
    enabled,
    /** Только песочница (`startup-flow-qa.js`): расписание и кадр на заданный миг. В продуктовой сборке — `null`. */
    qa,
    /** Пробуждение после сна: экран другой (знак уже горит). Читается при первом показе: память сна приходит позже загрузки модуля. */
    isWaking() {
      if (waking === null) waking = enabled && Boolean(qa?.wake || woke());
      return waking;
    },
    /** Сообщить: запрос этапа `index` закрылся (ответом или отказом — для хода это одно). */
    stage(index) {
      if (index >= 0 && index < COUNT) reported[index] = true;
    },
    /** Окно открылось: всё закрыто, дальше заставка уходит. */
    ready() {
      ready = true;
    },
    /** Запуск не удался; `info` — слова ошибки. Сейчас сюда пишет только песочница (`?qa-splash-fail`). */
    fail(info = {}) {
      failure = failure || info;
      listeners.forEach((listener) => listener());
    },
    /** Закрыто подряд с первого этапа. */
    closed() {
      let count = 0;
      while (count < COUNT && reported[count] && (!qa || qa.open(count)))
        count += 1;
      return count;
    },
    isReady: () => ready && (!qa || qa.ready()),
    isFailed() {
      if (!failure && qa?.failed()) flow.fail({ qa: true });
      return failure !== null;
    },
    failure: () => failure,
    /** Заставка ушла: слой снимается. */
    finish() {
      if (gone) return;
      gone = true;
      listeners.forEach((listener) => listener());
    },
    isGone: () => gone,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return flow;
}

export const startupFlow = createStartupFlow({
  dev: Boolean(import.meta.env?.DEV) || import.meta.env?.MODE === "perf",
  woke: () => {
    try {
      return wokeFromHibernation();
    } catch {
      return false;
    }
  },
});
