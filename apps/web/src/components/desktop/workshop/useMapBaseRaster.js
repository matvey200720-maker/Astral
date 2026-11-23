import { useEffect, useRef, useState } from "react";

/*
 * Живая подложка: картинка обработанной карты, которая идёт за ползунком.
 *
 * Пересчёт подложки — асинхронная работа на десятки миллисекунд, а правки
 * сыплются чаще: мышь шлёт их на каждый кадр. Правило простое. Пока человек
 * ведёт ползунок, считается черновик (плитки в половинном размере) — не чаще
 * одного за раз и всегда по самому свежему стилю: устаревший на полпути
 * расчёт не показывается. Когда правки прекратились, один раз считается
 * полный размер. Черновик не может лечь поверх полного кадра того же стиля.
 *
 * Данные, а не правка (19.10.2026): плитки, геометрия, картинка и текстура приезжают
 * по одной, пять раз за открытие карты (`stamp` растёт, `rasterKey` тот же). Раньше каждый
 * приезд считал свой черновик и ждал полных 260 мс: открытие давало два лишних растра и
 * картинка «устаивалась» к 750 мс. Теперь после первой картинки приезд данных черновика не
 * просит и ждёт полный кадр только `DATA_DELAY_MS` — склейка приездов в один растр. Черновики
 * остаются для правки (ползунок): там их смысл — идти за рукой.
 *
 * Таймеры — `setTimeout`, а не кадр анимации: в свёрнутом окне кадры не
 * тикают, а подложка обязана досчитаться и там.
 *
 * `pending` — правка уже есть, а полного кадра под неё ещё нет: сцена
 * показывает прежнюю картинку и метку «перерисовываю», а не замирает.
 */

/** Не чаще одного черновика за этот интервал: быстрее глаз не различит. */
const DRAFT_INTERVAL_MS = 50;
/** Пауза после последней правки, после которой считается полный размер. */
const FULL_DELAY_MS = 260;
/** То же после приезда данных (плитки, геометрия, картинка): человек ничего не двигает, ждать нечего. */
const DATA_DELAY_MS = 90;

/**
 * @param {object} processor `createMapBaseProcessor()`
 * @param {object} base `config.base`
 * @param {string} rasterKey меняется, когда правка меняет пиксели подложки
 * @param {number} stamp растёт, когда у процессора новые плитки или текстура
 * @returns {{raster: {href: string, quality: "draft"|"full"}|null, pending: boolean}}
 */
export function useMapBaseRaster(processor, base, rasterKey, stamp) {
  const [raster, setRaster] = useState(null);
  const [pending, setPending] = useState(false);
  const work = useRef({
    base,
    version: 0,
    /* Версия последней правки человека (`rasterKey`): черновик нужен только ей и первой картинке. */
    editVersion: 0,
    /* Чем была последняя перемена: правкой или приездом данных. */
    lastChange: "edit",
    rasterKey: null,
    changedAt: 0,
    draftVersion: 0,
    fullVersion: 0,
    lastDraftAt: 0,
    busy: false,
    timer: 0,
    shown: null,
    alive: true,
  });
  work.current.base = base;

  useEffect(() => {
    const state = work.current;
    state.alive = true;
    return () => {
      state.alive = false;
      clearTimeout(state.timer);
      if (state.shown?.href) URL.revokeObjectURL(state.shown.href);
      state.shown = null;
    };
  }, []);

  useEffect(() => {
    const state = work.current;

    const show = (next) => {
      const previous = state.shown;
      state.shown = next;
      setRaster(next);
      /* Прежняя картинка отпускается с запасом: сцена держит её ссылку до
         следующей отрисовки, а браузер — до конца декодирования новой. */
      if (previous?.href)
        setTimeout(() => URL.revokeObjectURL(previous.href), 1500);
    };

    const pump = () => {
      if (!state.alive || state.busy) return;
      clearTimeout(state.timer);
      /* Одной картинкой окно показывает и плитки игры как есть: у шести
         плиток встык на приближении видны стыки (`windowRaster`). */
      const shown = processor.windowRaster ? processor.windowRaster(state.base) : processor.active(state.base);
      if (!shown) {
        state.draftVersion = state.version;
        state.fullVersion = state.version;
        setPending(false);
        if (state.shown) show(null);
        return;
      }
      const now = Date.now();
      /* Пока картинки нет, черновик нужен любой перемене (первая картинка — как можно раньше); когда есть —
         только правке человека, а приезд данных ждёт полного кадра. */
      const draftTarget = state.shown ? state.editVersion : state.version;
      const quality =
        state.draftVersion < draftTarget
          ? "draft"
          : state.fullVersion < state.version
            ? "full"
            : null;
      if (!quality) {
        setPending(false);
        return;
      }
      setPending(true);
      const dueAt =
        quality === "draft"
          ? state.lastDraftAt + DRAFT_INTERVAL_MS
          : state.changedAt + (state.lastChange === "edit" ? FULL_DELAY_MS : DATA_DELAY_MS);
      if (dueAt > now) {
        state.timer = setTimeout(pump, dueAt - now);
        return;
      }
      const version = state.version;
      state.busy = true;
      if (quality === "draft") state.lastDraftAt = now;
      processor
        .preview(state.base, quality)
        .catch(() => null)
        .then((result) => {
          state.busy = false;
          if (!state.alive) {
            if (result?.href) URL.revokeObjectURL(result.href);
            return;
          }
          /* Черновик, который процессор отдал сразу полным (склейка плиток
             как есть), второй раз не считается. */
          if (quality === "draft" && result?.quality !== "full") state.draftVersion = version;
          else {
            state.draftVersion = Math.max(state.draftVersion, version);
            state.fullVersion = version;
          }
          /* Устаревший полный кадр не показывается: стиль уже другой, а
             черновик свежего стиля человек увидит через мгновение. */
          const stale = quality === "full" && version < state.version;
          if (result && !stale) show(result);
          else if (result?.href) URL.revokeObjectURL(result.href);
          pump();
        });
    };

    state.version += 1;
    /* Первая перемена и смена ключа — правка; росла только метка `stamp` — приехали данные. */
    const edit = state.rasterKey === null || state.rasterKey !== rasterKey;
    state.rasterKey = rasterKey;
    state.lastChange = edit ? "edit" : "data";
    if (edit) state.editVersion = state.version;
    state.changedAt = Date.now();
    pump();
    // Процессор живёт столько же, сколько редактор: в зависимостях он лишний.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rasterKey, stamp]);

  return { raster, pending };
}
