import { useEffect, useRef, useState } from "react";
import { useFrameHold } from "../../../components/ui/stage-busy.js";
import { nextLoaderVariant } from "./StageLoader.jsx";

/*
 * Когда показывать заставку и когда убирать (ТЗ 42В).
 *
 * Сцена из кэша встаёт за доли секунды, и заставка, мелькнувшая на такое
 * чтение, читалась бы как дрожь, а не как загрузка: она появляется, только если
 * загрузка идёт дольше `SHOW_AFTER_MS`. Ушла загрузка — заставка растворяется
 * (`OUT_MS`), и только потом её нет в дереве: холостых циклов не остаётся.
 * Вид анимации выбирается при появлении заставки и стоит до её ухода.
 */
export const SHOW_AFTER_MS = 140;
export const OUT_MS = 520;
/*
 * Длинный срок карточки (`longAfterMs`): сцена пришла раньше, чем карточка успела войти (повторный вход, сцена из кэша окна), — карточка входит, только если холст закрыт дольше этого от начала закрытия.
 * Замер повторного входа (×1, сервер разработки, Завод и Ашан): без него карточка входила на 604 и 801 мс при «готово» 696 и 895 мс и почти вся шла уже после готовности (затухание); с 1000 мс — кадров
 * карточки 0, «готово» 580 и 785 мс (`docs/perf/speed-3d-rust/08-next-series.md`, 2.1). На первом входе, где сцена читается секунды, срок прежний — `SHOW_AFTER_MS`.
 */
export const LONG_SHOW_AFTER_MS = 1000;
/* Потолок: загрузка, что тянется дольше, заставку не держит — инструменты редактора не должны оставаться
   приглушёнными навсегда, если ответ так и не пришёл (игры нет, хост молчит). */
export const MAX_SHOWN_MS = 30_000;
/*
 * QA: `?qa-slow-stage=8000` держит заставку ещё N мс после того, как сцена готова, — чтобы снять состояние «идёт» в
 * боевом редакторе. Только в разработке и в сборке замера: в поставке условие сворачивается в 0, и код не попадает
 * в бандл.
 */
export const QA_SLOW_STAGE_MS = (() => {
  if (
    !(import.meta.env.DEV || import.meta.env.MODE === "perf") ||
    typeof window === "undefined"
  )
    return 0;
  const ms = Number(
    new URLSearchParams(window.location.search).get("qa-slow-stage"),
  );
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60_000) : 0;
})();

/**
 * `{ shown, phase, variant, waiting }` по `busy` — «сцена ещё не готова». `holdRoom` (по умолчанию да) — пока сцена грузится,
 * держит и занавес над комнатой редактора, пока та открывается (`useFrameHold`); тонкая полоска правки (`soft`) комнату
 * не держит: сцена на кадре уже была. `maxMs` — свой потолок ожидания вместо `MAX_SHOWN_MS` (кадр с листами ждёт, пока они идут:
 * потолок у него свой, `use-sheets-progress.js`). `waiting` — загрузка идёт и потолок не вышел: кадр под заставкой, ещё не показанной,
 * прячется (сцену без текстур не показываем), и открывается ровно тогда же, когда заставка уходит.
 * `keep` — карточку держит и то, что `waiting` не считает занятостью (закрытый холст ждёт первого взгляда на листы, `ModelStage.jsx`): от прихода сцены до этого взгляда `busy` на один коммит гаснет, и таймер
 * показа шёл бы заново (карточка входила бы, когда закрытие почти снято). С `keep` отсчёт идёт от начала закрытия без разрыва; `waiting` от него не меняется. `showAfterMs` — свой срок показа вместо `SHOW_AFTER_MS`.
 * `reading` — булево или функция (ответ берётся в миг срабатывания таймера, а не на последней отрисовке React: иначе приход сцены на несколько мс раньше или позже срока решает, будет ли карточка; повторный вход Завода 16.11,
 * сцена из кэша загрузчика на 155–163 мс при сроке 145–151 мс). `longAfterMs` и `reading` — два срока: пока читается сама сцена (`reading`), карточка входит через `showAfterMs`; если к этому сроку сцена уже пришла (повторный вход, сцена из кэша окна), карточка
 * ждёт `longAfterMs` от НАЧАЛА закрытия и входит, только если закрытие тянется дольше (без `longAfterMs` срок один, как прежде). Закрытие снято раньше — карточки нет совсем.
 */
export function useStageLoad(
  busy,
  {
    holdRoom = true,
    maxMs = MAX_SHOWN_MS,
    keep = false,
    showAfterMs = SHOW_AFTER_MS,
    longAfterMs = 0,
    reading = false,
    /* Сколько карточка растворяется после готовой сцены (по умолчанию `OUT_MS`). Короче — только у карточки, что мышь не блокирует и редактор не приглушает (студия ствола, 24.11.2026). */
    outMs = OUT_MS,
  } = {},
) {
  useFrameHold(holdRoom && Boolean(busy));
  const [phase, setPhase] = useState("idle");
  const [expired, setExpired] = useState(false);
  const variant = useRef("star");
  const phaseRef = useRef("idle");
  phaseRef.current = phase;

  /* Потолок ожидания: загрузка идёт, а заставке уже тридцать секунд, — отпускаем. Новая загрузка начинается с нуля. */
  useEffect(() => {
    if (!busy) {
      setExpired(false);
      return undefined;
    }
    const timer = setTimeout(() => setExpired(true), maxMs);
    return () => clearTimeout(timer);
  }, [busy, maxMs]);

  const waiting = Boolean(busy) && !expired;
  /* Карточка живёт, пока загрузка идёт или кадр её удерживает (`keep`). Без `keep` это ровно `waiting`. */
  const alive = waiting || Boolean(keep);
  /* Ответ на «живёт ли ещё» для таймера: перечитывается на каждой отрисовке, как `phaseRef`. */
  const aliveRef = useRef(false);
  aliveRef.current = alive;
  /* Читается ли сама сцена в этот миг (для двух сроков): как `aliveRef`, перечитывается на каждой отрисовке. */
  const readingRef = useRef(false);
  readingRef.current = reading;
  useEffect(() => {
    if (alive) {
      if (phaseRef.current === "in") return undefined;
      /* Заставка ещё растворялась, а загрузка началась снова: возвращаем её на месте, вид тот же. */
      if (phaseRef.current === "out") {
        setPhase("in");
        return undefined;
      }
      const began = performance.now();
      let timer = 0;
      const arm = (ms) => {
        timer = setTimeout(() => {
          /* Загрузка кончилась, а эффект с этим ещё не прошёл: таймер и сброс состояния разошлись во времени. Без этой
             проверки заставка вставала поверх готовой сцены и оставалась навсегда — ей некому сказать «уходи». */
          if (!aliveRef.current) return;
          /* Сцена уже пришла (не читается): карточка — только если закрытие тянется дольше `longAfterMs` от его начала; отсчёт не сбрасывается и заново не стартует. */
          const readingNow =
            typeof readingRef.current === "function"
              ? Boolean(readingRef.current())
              : Boolean(readingRef.current);
          if (longAfterMs > showAfterMs && !readingNow) {
            const left = longAfterMs - (performance.now() - began);
            if (left > 0) {
              arm(left);
              return;
            }
          }
          variant.current = nextLoaderVariant();
          setPhase("in");
        }, ms);
      };
      arm(showAfterMs);
      return () => clearTimeout(timer);
    }
    if (phaseRef.current !== "in") return undefined;
    if (!QA_SLOW_STAGE_MS) {
      setPhase("out");
      const gone = setTimeout(() => setPhase("idle"), outMs);
      return () => clearTimeout(gone);
    }
    /* QA: сцена готова, а заставка стоит ещё `QA_SLOW_STAGE_MS`. Новая загрузка удержание снимает (cleanup), фаза не меняется. */
    let gone = null;
    const hold = setTimeout(() => {
      setPhase("out");
      gone = setTimeout(() => setPhase("idle"), outMs);
    }, QA_SLOW_STAGE_MS);
    return () => {
      clearTimeout(hold);
      clearTimeout(gone);
    };
  }, [alive, showAfterMs, longAfterMs, outMs]);

  return {
    shown: phase !== "idle",
    phase: phase === "out" ? "out" : "in",
    variant: variant.current,
    waiting,
  };
}
