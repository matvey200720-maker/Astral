import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo } from "react";

/*
 * «Сцена ещё не готова» — от кадра к оболочке редактора (ТЗ 42В, 20.10.2026).
 *
 * Кадр (`ModelStage`, окно предпросмотра) грузит сцену, листы и текстуры, а
 * инструменты слева и колонка справа в это время уже стоят. Оболочка
 * (`EditorShell`) раздаёт кадру функцию `report(id, busy)` и по ней знает, что
 * грузится хоть один кадр: инструменты приглушаются (они по-прежнему видны и
 * листаются — посмотреть, какие есть), колонка правок становится недоступной,
 * а когда всё готово, инструменты плавно возвращаются в свой цвет.
 *
 * Вне оболочки контекста нет — вызов пустой.
 */
export const StageBusyContext = createContext(null);

/*
 * «Кадр ещё не показал сцену» — от кадра к комнате, пока она только открывается (ТЗ 24.10.2026 вечер).
 *
 * `StageBusyContext` говорит про заставку: она выходит через 140 мс, и инструменты приглушаются. Комнате этого мало:
 * занавес над ней (`screen-ready.js`, `EditorShell`) держится, пока кадр не отрисовал первую сцену, и знать про
 * загрузку она должна с первого кадра, а не со ста сорокового мс. Сообщение идёт из слоя эффектов, до того как
 * оболочка берёт комнату в группу, поэтому комната, которой ждать нечего, не показывает занавес вовсе. Держит комнату
 * только вход: новая сцена в уже открытой комнате (смена инструмента, района) занавеса не возвращает.
 */
export const FrameHoldContext = createContext(null);

/** Кадр говорит комнате: `busy` — пока сцена не отрисована или не отказала. Вне оболочки — пусто. */
export function useFrameHold(busy) {
  const hold = useContext(FrameHoldContext);
  const id = useId();
  const on = Boolean(busy);
  useLayoutEffect(() => {
    if (!hold) return undefined;
    hold(id, on);
    return () => hold(id, false);
  }, [hold, id, on]);
}

/**
 * То же, что `useFrameHold`, но из рук: кадр, у которого «готово» приходит не из отрисовки, а из событий (студия
 * ствола и одежды: модель читают и ставят после того, как оболочка встала). `set(true)` держит комнату, `set(false)`
 * отпускает. Дальше решает сам кадр: в слое эффектов — держать с входа, по первой удачной загрузке, отказу или
 * «модели нет и не будет» — отпускать. Вне оболочки — пусто.
 */
export function useFrameHoldHandle() {
  const hold = useContext(FrameHoldContext);
  const id = useId();
  return useMemo(() => ({ set: (on) => hold?.(id, Boolean(on)) }), [hold, id]);
}

/**
 * Порт удержания — для кадра, который стоит ВЫШЕ оболочки редактора: студия ствола и одежды сама рисует `EditorShell`, и
 * хук в её теле контекста оболочки не видит. Студия держит порт (`createHoldPort`, `port.set(on)`), а внутрь оболочки кладёт
 * `<FrameHoldPort port={port} />` — он встаёт под провайдером и отдаёт порту ручку комнаты. Комната держится с входа и
 * отпускается теми событиями, что студия сама выберет: первая удачная загрузка, отказ, «вещи нет».
 */
export function createHoldPort() {
  const port = {
    handle: null,
    set(on) {
      port.handle?.set(on);
    },
  };
  return port;
}

/** Ставится внутрь оболочки: держит комнату с входа и связывает её с портом студии. Ничего не рисует. */
export function FrameHoldPort({ port }) {
  const handle = useFrameHoldHandle();
  useLayoutEffect(() => {
    port.handle = handle;
    handle.set(true);
    return () => {
      handle.set(false);
      port.handle = null;
    };
  }, [handle, port]);
  return null;
}

/** Кадр сообщает оболочке: `busy` — пока сцена не готова. */
export function useStageBusy(busy) {
  const report = useContext(StageBusyContext);
  const id = useId();
  const on = Boolean(busy);
  useEffect(() => {
    if (!report) return undefined;
    report(id, on);
    return () => report(id, false);
  }, [report, id, on]);
}
