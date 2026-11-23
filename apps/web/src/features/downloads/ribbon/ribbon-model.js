import { useLayoutEffect, useState } from "react";
import { installPhaseKey } from "../../../install-phase.js";

/*
 * Расчёты «Загрузок» v2-A «Лента» без разметки: какой из трёх этапов идёт, на каком остановился отказ
 * и сколько строк списка не влезло. Разметка — `Hero.jsx`, `Lists.jsx`; слова — `ribbon-copy.js`.
 */

/** Этапы установки каталога: скачали, проверили, записали в игру. Точки возврата среди них нет (владелец, 16.11.2026: «точку возврата писать не нужно»): копия оригиналов делается молча внутри «Записали». */
export const STAGE_COUNT = 3;

/* Какой этап идёт на какой фазе движка (`install-phase.js`). Подготовка — ещё до скачивания, она в первом этапе. */
const PHASE_STAGE = new Map([
  ["prepare", 0],
  ["download", 0],
  ["verify", 1],
  ["backup", 2],
  ["commit", 2],
  ["compose", 2],
  ["components", 2],
  ["ready", 2],
  ["finish", 2],
]);

/* Шкала движка: скачивание занимает 2…84 %, дальше проверка и запись (`qa-desktop-bridge.js`, `useQueueProgress`). */
const DOWNLOAD_FROM = 2;
const DOWNLOAD_SPAN = 82;
const VERIFY_FROM_PERCENT = 88;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Номер идущего этапа (0…2) по фазе движка; фазы нет — по проценту шкалы. */
export function installStageIndex(phase, percent) {
  const known = PHASE_STAGE.get(installPhaseKey(phase));
  if (known !== undefined) return known;
  return percent >= VERIFY_FROM_PERCENT ? 1 : 0;
}

/** Доля этапа «Скачали»: честная доля по байтам, если движок её прислал, иначе пересчёт процента шкалы. */
export function downloadShare(fraction, percent) {
  if (typeof fraction === "number" && Number.isFinite(fraction))
    return clamp01(fraction);
  return clamp01((percent - DOWNLOAD_FROM) / DOWNLOAD_SPAN);
}

/**
 * Три этапа идущей установки. `measured` — у этапа есть настоящая доля (скачивание); у остальных идущий этап без числа:
 * полоса бежит, а не притворяется знающей. `pre` — какая доля первого этапа уже лежала на диске (штрих).
 * `pace` — ровный ход (`progress-pace.js`, склад `live-progress.js`): `{ stage, shares }`. Идёт он — этап и доля первого этапа берутся из него, а не из процента
 * движка (у движка скачивание занимает 2…84 %, у ровного хода — свою долю шкалы), и этап не откатывается назад на подготовке после проверки.
 */
export function installStages({
  phase,
  percent,
  fraction,
  pre = 0,
  pace = null,
}) {
  const current = pace
    ? Math.min(STAGE_COUNT - 1, Math.max(0, pace.stage))
    : installStageIndex(phase, percent);
  return Array.from({ length: STAGE_COUNT }, (_, index) => {
    if (index < current)
      return { state: "done", fraction: 1, measured: true, pre: 0 };
    if (index > current)
      return { state: "waiting", fraction: 0, measured: true, pre: 0 };
    if (index === 0)
      return {
        state: "active",
        fraction: pace ? pace.shares[0] : downloadShare(fraction, percent),
        measured: true,
        pre: clamp01(pre),
      };
    return { state: "active", fraction: 0, measured: false, pre: 0 };
  });
}

/* Где остановился отказ: те три семейства, что показаны в макете, стоят на своём этапе, остальные — на том, где был движок. */
const FAIL_STAGE = new Map([
  ["game-running", 2],
  ["no-space", 2],
  ["network", 0],
]);

export function failStageIndex(kind, phase) {
  const byKind = FAIL_STAGE.get(kind);
  if (byKind !== undefined) return byKind;
  return PHASE_STAGE.get(installPhaseKey(phase)) ?? 0;
}

/** Этапы остановившейся установки: что до отказа — готово, сам этап — красный, дальше — не дошли. */
export function failedStages(index, pre = 0) {
  return Array.from({ length: STAGE_COUNT }, (_, at) => {
    if (at < index)
      return { state: "done", fraction: 1, measured: true, pre: 0 };
    if (at === index)
      return {
        state: "bad",
        fraction: 0,
        measured: true,
        pre: at === 0 ? clamp01(pre) : 0,
      };
    return { state: "skip", fraction: 0, measured: true, pre: 0 };
  });
}

/** Строка «чч:мм» по местному времени. */
export function clockOf(at) {
  const date = new Date(at);
  const two = (value) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Сколько строк списка (`[data-row]`) не влезло под нижний край области: целиком или наполовину. */
export function useHiddenBelow(ref, signal) {
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return undefined;
    const measure = () => {
      const edge = area.getBoundingClientRect().bottom;
      let hidden = 0;
      for (const row of area.querySelectorAll("[data-row]")) {
        if (row.getBoundingClientRect().bottom > edge + 2) hidden += 1;
      }
      setCount(hidden);
    };
    measure();
    area.addEventListener("scroll", measure, { passive: true });
    const watcher =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    watcher?.observe(area);
    return () => {
      area.removeEventListener("scroll", measure);
      watcher?.disconnect();
    };
  }, [ref, signal]);
  return count;
}
