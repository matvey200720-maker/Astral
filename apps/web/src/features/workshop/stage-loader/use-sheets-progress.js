import { useEffect, useState } from "react";
import { stageMark, stageMarksOn } from "../model-stage/stage-marks.js";

/*
 * Настоящий счёт загрузки сцены (ТЗ 42В): сколько листов и текстур, что просила
 * сцена, уже на месте из всех (`stage.texturesProgress()`).
 *
 * Листы просит облик, а он ложится эффектами уже после самой сцены, поэтому
 * счёт снимается шагами: первые шаги ничего не просили — это не «готово», а
 * «ещё не просили», но заставка из-за этого не держится (пока ни один лист не
 * замечен, ждать нечего). Увидели листы — ждём, пока они все на месте и
 * облик материалов их получил (`flushing`), и ещё `QUIET_TICKS` спокойных шагов:
 * облик мог попросить следующую пачку.
 *
 * Заставка держится, пока идёт подгрузка, и не дольше (решение владельца 13.11.2026: сцену без текстур не показываем, а когда всё доехало —
 * сцена появляется сразу целиком). Прежде в конце стояло лишнее: шаг опроса 160 мс и три спокойных шага — почти полсекунды после последнего листа,
 * дольше порога показа заставки (`SHOW_AFTER_MS`, 140 мс), поэтому сцена, чьи листы уже в кэше окна, каждый раз мигала карточкой; а потолок в 20 с
 * резал честную долгую загрузку (холодное чтение «Завода», арены — десятки секунд) и показывал сцену без текстур посреди подгрузки. Теперь потолок —
 * «листы не идут»: ни один лист не ответил `STALL_MS` (хост молчит, игры нет), а честно идущая загрузка держит заставку, сколько идёт
 * (`LIMIT_MS` — страховка от вечности).
 *
 * Следит за листами и после первого «готово», но не опросом, а по событию кадра (`stage.onSheetsWanted`: сцена попросила новый лист): показали материалы, сменили отделку —
 * началась волна. Волна — это лёгкая загрузка (`wave: true`: полоска, не карточка, холст открыт), и опрос идёт, только пока волна едет; в простое ничего не крутится (правило 21).
 */
export const TICK_MS = 25;
export const QUIET_TICKS = 2;
/* Сколько ждём, пока облик попросит первые листы (сцена без листов заставку не держит и опрос сворачивает). */
export const LOOKS_MS = 1000;
/* Листы не идут: ни один не ответил столько, а всё ещё ждём, и читателю игры ничего не отправлено (нечего считать «читатель работает») — ждём что-то своё, оно не придёт. */
export const STALL_MS = 15_000;
/*
 * Читатель игры должен листы (`counted.reading > 0`: просьбы ушли, ответов нет, поток не упал — упавший отклоняет, и окно досылает: `scene-textures.js`): молчание дольше `STALL_MS` ещё не «хост молчит».
 * Пачка из двадцати листов на холодном кэше и медленном диске отвечает долго, и сцена уходила в среднем цвете, а листы доезжали на виду (находка 8 ревью тестового ПК, 15.11.2026). Тишина, после которой
 * читатель считается зависшим, — 60 с: холодное чтение Мегамолла целиком — 8,2 с на быстром ПК (замер 14.11.2026, `00-baseline.md`, раздел 4), у медленного диска оценка — до пяти раз (около 40 с на всю
 * сцену, а пачка отвечает быстрее сцены). Ответ любого листа молчание считает заново, общий потолок — `LIMIT_MS`.
 */
export const READER_STALL_MS = 60_000;
/*
 * Страховка от вечности для загрузки, что идёт, но не кончается. Почему 180 с (а не прежние 20): самая тяжёлая холодная сцена, Мегамолл (374 листа), читается 8,2 с на быстром ПК (замер 14.11.2026,
 * `docs/perf/speed-3d-rust/00-baseline.md`, раздел 4) и 14,7–19,4 с в окне при ×4 (замер, там же); на ПК с медленным диском чтение дольше в разы (оценка: до пяти раз — около 100 с),
 * и 20 с отпускали такую загрузку посреди пути, сцена без текстур показывалась. 180 с — вдвое больше этой оценки. Счёт для потолка — только листы текущей сцены (`sheet-scope.js`): листы сцен,
 * что лежат в кэше кадра, его не растягивают и заставку нового места не держат (находка 6 ревью тестового ПК, 15.11.2026).
 */
export const LIMIT_MS = 180_000;

const IDLE = Object.freeze({ pending: false, done: 0, total: 0 });

/**
 * `{ pending, done, total }` для сцены `asset` кадра `stageRef`; у волны листов, что началась после первого «готово», — ещё `wave: true`.
 * `onSeen(asset)` — первый взгляд на листы этой сцены сделан, и его итог уже отдан (тем же проходом эффектов, что и итог): до него счёт принадлежит прежней сцене,
 * и заставка не знает, едут ли листы новой (`ModelStage.jsx`: кадр, закрытый до прихода сцены, не открывается в этот промежуток).
 */
export function useSheetsProgress(stageRef, asset, onSeen = undefined) {
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    if (!asset) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    let timer = 0;
    /* Опрос закончился (листы на месте): дальше сцену будит только событие кадра. */
    let idle = false;
    const publish = (next) =>
      setState((prev) =>
        prev.pending === next.pending &&
        prev.done === next.done &&
        prev.total === next.total &&
        prev.wave === next.wave
          ? prev
          : next,
      );
    /* Одна загрузка: первая сцены (карточка) или волна листов после первого «готово» (полоска). */
    const begin = (wave) => {
      clearTimeout(timer);
      idle = false;
      const started = performance.now();
      let quiet = 0;
      let seen = wave;
      const base = wave ? stageRef.current?.texturesProgress?.() : null;
      let lastDone = base?.done ?? 0;
      let lastTotal = base?.total ?? 0;
      let lastProgress = started;
      /* Причина удержания на прошлом шаге (только с журналом меток): метка `sheetsWait` пишется на её смене, а не на каждом шаге в 25 мс. */
      let lastReason = "";
      const tail = wave ? { wave: true } : {};
      const tick = () => {
        if (cancelled) return;
        const counted = stageRef.current?.texturesProgress?.() || {
          done: 0,
          total: 0,
        };
        const now = performance.now();
        /* Ждём, пока листы едут и пока пришедшие не легли на материалы (`flushing`): сцена целиком — когда есть и то, и другое. */
        const waiting =
          (counted.total > 0 && counted.done < counted.total) ||
          Boolean(counted.flushing);
        /* Первый взгляд на листы сцены: всё уже на месте и лежит на материалах (сцена из кэша, листы в кэше окна) — ждать нечего, спокойные шаги не нужны. */
        const instant = !seen && counted.total > 0 && !waiting;
        if (counted.total > 0) seen = true;
        /* Движение — лист ответил или сцена попросила ещё (новая волна запросов): с этого момента отсчёт «не идут» заново. */
        if (counted.done > lastDone || counted.total > lastTotal) {
          lastDone = Math.max(lastDone, counted.done);
          lastTotal = Math.max(lastTotal, counted.total);
          lastProgress = now;
        }
        quiet = waiting ? 0 : instant ? QUIET_TICKS : quiet + 1;
        const over = now - started > LIMIT_MS;
        const stalled =
          waiting &&
          now - lastProgress >
            (counted.reading > 0 ? READER_STALL_MS : STALL_MS);
        const holding = waiting || (seen && quiet < QUIET_TICKS);
        /*
         * Метка `sheetsWait` (17.11.2026, повторный вход «Мегамолла»: закрытие держалось 0,45–1,18 с после итога листов без единой метки между итогом и открытием — это была отрисовка итога, её метки `draw` стенд отбрасывал):
         * на каждой смене причины, по которой заставка держит холст, — `[«first»/«wave», причина, листов ответило, листов всего, из чего сложено `flushing`, листы, что ещё не ответили]`. Причина: `sheets` (`done < total`), `flushing:…`
         * (`batch`, `finish:stale`, `finish:unpainted` — ждём отрисовку итога, `reveal:N`, `warming`, `warm-timer`), `quiet` (спокойные шаги после «всё на месте»), `open`, `limit`, `stalled`.
         */
        if (stageMarksOn()) {
          const behind = counted.total > 0 && counted.done < counted.total;
          const reason = over ? "limit" : stalled ? "stalled" : !holding ? "open" : behind || counted.flushing ? [behind ? "sheets" : "", counted.flushing ? `flushing:${counted.why || "?"}` : ""].filter(Boolean).join("+") : "quiet";
          if (reason !== lastReason) {
            lastReason = reason;
            stageMark("sheetsWait", wave ? "wave" : "first", reason, counted.done, counted.total, counted.why || "", (counted.unsettled || []).join(","));
          }
        }
        if (over || stalled || !holding) {
          publish({ pending: false, done: counted.done, total: counted.total });
          /* Листов не было и не просили — следить дальше нечем; были — ещё несколько шагов на «следующую пачку». */
          if (over || stalled || seen || now - started >= LOOKS_MS) {
            idle = true;
            return;
          }
        } else
          publish({
            pending: true,
            done: counted.done,
            total: counted.total,
            ...tail,
          });
        timer = setTimeout(tick, TICK_MS);
      };
      tick();
    };
    /* Первый шаг — сразу, в самом эффекте, а не таймером: эффект облика ModelStage объявлен раньше, и к его запуску листы уже запрошены; пока ждали таймер,
       холст был открыт, и новая сцена могла успеть нарисоваться в среднем цвете. */
    begin(false);
    /* Первый взгляд сделан и опубликован выше (тот же проход эффектов): об этом узнаёт и заставка — одним обновлением с итогом взгляда. */
    onSeen?.(asset);
    /* Волна: сцена попросила листы, когда опрос уже кончился. Пока опрос идёт, он сам увидит новые листы. */
    const unsubscribe = stageRef.current?.onSheetsWanted?.(() => {
      if (idle && !cancelled) begin(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [stageRef, asset, onSeen]);
  return state;
}
