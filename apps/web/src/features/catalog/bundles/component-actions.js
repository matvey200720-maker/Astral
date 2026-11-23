import { useEffect, useMemo, useRef, useState } from "react";
import {
  bundleComponents,
  componentGroupOf,
  componentsOf,
  inBuildOrder,
  slotsOf,
  workReplacedParts,
  setComponentOff,
  setComponentSwap,
  setComponentWork,
  useBundleComponents,
} from "./component-choices.js";
import { installComponentWorks, ownWorkByKey, readOwnWorks, removeComponentWorks } from "./component-works.js";
import { useBundleActions } from "./BundleContext.js";
import { restorePlan, swapPlan, workPlan } from "./batch-plan.js";
import { sourceParts } from "./component-state.js";
import { isCatalogBundle } from "../../../catalog-utils.js";
import { tr } from "../../../locales/ui.js";

/*
 * Что делает окно «Компоненты» с выбором человека (ТЗ владельца 10.11.2026: «продумай систему, чтобы оно не багалось»).
 *
 * Компонент — слот (`componentsOf`): у него может быть несколько пакетов (таймцикл = маршруты + облака, арена = зал, экстерьер, LOD), и каждое действие
 * идёт над всеми пакетами слота разом. До установки выбор («не входит в сборку», «вместо неё — слот другой сборки», «вместо неё — своя работа»)
 * только меняет то, что поставится: пишется в `component-choices.js` и больше ничего. После установки (хоть одна часть сборки стоит в игре) отключение
 * снимает только пакеты этого слота, включение — доставляет их, замена ставит пакеты новой сборки (прежний владелец слота уходит по `partReplaces` →
 * `replaceIds`), своя работа — очередью мастерской; очередь «Загрузок» та же, что у кнопок части (`parts.install` / `parts.remove`). Выбор пишется сразу,
 * а подтверждается ходом очереди:
 *  • пакет ушёл из очереди без отказа — выбор остаётся;
 *  • отказ в очереди, отказ ещё до очереди (занята игра, нет пакета, нет обработчика) или ошибка мастерской — выбор возвращается как был, а у компонента
 *    остаётся слово «Не вышло», чтобы карточка не висела полувыбранной (одна отмена на все пакеты слота).
 *
 * Общий архив нескольких слотов (зоны: зелёная, запретные, ВЗХ) при замене закрывает их все: выбор пишется на каждый слот сборки, который он занимает.
 *
 * Хук живёт на карточке, а не в самом окне: закрытое окно не должно терять слежение за ходом. Закрыли карточку — слежение кончается и
 * запоздалый ответ выбор не трогает.
 */

// Столько ждём после ответа обработчика, прежде чем решить, что очередь запись не приняла (отказ приходит заметкой, а не ошибкой).
const SETTLE_DELAY_MS = 700;

/** Компоненты сборки по её частям в каталоге: `[{ key, parts }]` в порядке состава. */
export function componentsOfBundle(bundle, catalog = []) {
  if (!isCatalogBundle(bundle)) return [];
  const byId = new Map(catalog.map((mod) => [mod.id, mod]));
  return componentsOf((bundle.includedModIds || []).map((id) => byId.get(id)).filter(Boolean));
}

/** Карта «id части → ключ слота» для списка компонентов. */
export function keysOfComponents(list) {
  return new Map(list.flatMap((component) => component.parts.map((part) => [part.id, component.key])));
}

const failureNote = () => tr("Не вышло: выбор возвращён как был");

/**
 * Состояние выбора компонентов карточки и действия над слотом.
 * @returns {{ group: string, components: object, list: object[], keys: Map<string,string>, notes: object,
 *   toggle: Function, swap: Function, restore: Function, pickWork: Function }}
 */
export function useComponentChoice({ bundle, catalog, parts }) {
  const group = isCatalogBundle(bundle) ? componentGroupOf(bundle) : "";
  const components = useBundleComponents(group);
  const list = useMemo(() => componentsOfBundle(bundle, catalog), [bundle, catalog]);
  const keys = useMemo(() => keysOfComponents(list), [list]);
  const latest = useRef(parts);
  latest.current = parts;
  /* Пачка пакетов одной транзакцией движка (`installPackages` оболочки): на установленном редуксе замена и возврат идут ею, без неё — прежним ходом по пакетам. */
  const installPackages = useBundleActions()?.installPackages;
  const batching = useRef(null);
  batching.current = typeof installPackages === "function" ? installPackages : null;
  const byId = useMemo(() => new Map(catalog.map((mod) => [mod.id, mod])), [catalog]);
  const jobs = useRef(new Map());
  const timers = useRef(new Set());
  const unmounted = useRef(false);
  const [notes, setNotes] = useState({});

  // Карточку закрыли: следить за ходом больше некому, и устаревший ответ не должен переписывать выбор.
  useEffect(() => {
    const waiting = timers.current;
    const running = jobs.current;
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      for (const timer of waiting) clearTimeout(timer);
      waiting.clear();
      running.clear();
    };
  }, []);

  const settle = (jobKey, job, failed) => {
    jobs.current.delete(jobKey);
    if (!failed) return;
    job.undo();
    setNotes((current) => ({ ...current, [job.key]: failureNote() }));
  };

  // Ход очереди подтверждает или отменяет выбор.
  useEffect(() => {
    for (const [jobKey, job] of [...jobs.current]) {
      const entry = (parts?.queue || []).find((item) => item.id === job.id && item.operation === job.operation);
      if (entry?.failed) settle(jobKey, job, true);
      else if (entry) job.seen = true;
      else if (job.seen) jobs.current.delete(jobKey);
    }
  });

  // Запись очередь не приняла: пакета нет ни в очереди, ни в игре в нужном виде.
  const verify = (jobKey, job) => {
    if (jobs.current.get(jobKey) !== job) return;
    const now = latest.current;
    const queued = (now?.queue || []).some((item) => item.id === job.id && item.operation === job.operation);
    if (queued) return;
    const standing = (now?.installed || []).includes(job.id);
    settle(jobKey, job, standing !== (job.operation === "install"));
  };

  const forget = (key) => {
    setNotes((current) => {
      if (!(key in current)) return current;
      const { [key]: dropped, ...rest } = current;
      void dropped;
      return rest;
    });
  };

  // Работа мастерской по ключу выбора: список читается в момент нажатия, а не держится в карточке.
  const workOf = async (workKey) => ownWorkByKey(await readOwnWorks(), workKey);

  /** Ход мастерской (своя работа): не удался или отказ — выбор возвращается и у компонента остаётся слово «Не вышло». */
  const runWorkshop = (key, task, undo) => {
    const fail = () => {
      if (unmounted.current) return;
      undo();
      setNotes((current) => ({ ...current, [key]: failureNote() }));
    };
    Promise.resolve()
      .then(task)
      .then((result) => {
        if (!result?.ok) fail();
      })
      .catch(fail);
  };

  // Пока хоть одна часть сборки стоит в игре, выбор человека сразу идёт в игру.
  const bundleStands = () => {
    const standing = latest.current?.installed || [];
    return (bundle?.includedModIds || []).some((id) => standing.includes(id));
  };

  // Выбор слота как он был: замена из другой сборки, своя работа и «отключено».
  const snapshot = (key) => {
    const now = bundleComponents(group);
    return { swap: now.swap[key] || "", work: now.work[key] || "", off: Boolean(now.off[key]) };
  };

  // Вернуть выбор слота таким, каким он был до хода.
  const putBack = (key, prev) => {
    if (prev.work) setComponentWork(group, key, prev.work);
    else setComponentSwap(group, key, prev.swap);
    setComponentOff(group, key, prev.off);
  };

  // Снять с места компонента прежнюю свою работу, если она стоит в игре; ok — можно идти дальше.
  const dropStandingWork = async (workKey) => {
    const work = await workOf(workKey);
    return work?.installed ? removeComponentWorks([work]) : { ok: true };
  };

  /** Один ход очереди над одним пакетом; `undo` вернёт выбор, если ход не удался. */
  const run = (key, part, operation, source, undo) => {
    const jobKey = `${key}#${part.id}`;
    const action = operation === "install" ? latest.current?.install : latest.current?.remove;
    const job = { id: part.id, key, operation, seen: false, undo };
    jobs.current.set(jobKey, job);
    if (typeof action !== "function") {
      settle(jobKey, job, true);
      return;
    }
    Promise.resolve()
      .then(() => action(part, source))
      .catch(() => {
        settle(jobKey, job, true);
      })
      .then(() => {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          verify(jobKey, job);
        }, SETTLE_DELAY_MS);
        timers.current.add(timer);
      });
  };

  /** Ход очереди над пакетами слота: ставятся не стоящие, снимаются стоящие; одна отмена на все пакеты. */
  const runParts = (key, list2, operation, source, undo) => {
    const standing = latest.current?.installed || [];
    const todo = list2.filter((part) => (operation === "install" ? !standing.includes(part.id) : standing.includes(part.id)));
    if (!todo.length) return;
    let undone = false;
    const undoOnce = () => {
      if (undone) return;
      undone = true;
      undo();
    };
    for (const part of todo) run(key, part, operation, source, undoOnce);
  };

  /** Не входит в сборку / снова входит (`slotParts` — пакеты слота, `also` — слоты, закрытые тем же общим архивом: выбор пишется и на них). */
  const toggle = (slotParts, key, on, source, also = []) => {
    if (!group || !key) return;
    const slots = [key, ...also.filter((slot) => slot && slot !== key)];
    const prevs = new Map(slots.map((slot) => [slot, snapshot(slot)]));
    const prev = prevs.get(key);
    forget(key);
    for (const slot of slots) setComponentOff(group, slot, !on);
    const undo = () => {
      for (const [slot, was] of prevs) setComponentOff(group, slot, was.off);
    };
    /* На месте компонента своя работа мастерской: включение и отключение — ход мастерской, а не очереди пакетов. */
    if (prev.work) {
      if (!bundleStands()) return;
      runWorkshop(
        key,
        async () => {
          const work = await workOf(prev.work);
          if (!work) return { ok: true };
          return on ? installComponentWorks([work]) : removeComponentWorks([work]);
        },
        undo,
      );
      return;
    }
    if (!on || bundleStands()) runParts(key, slotParts, on ? "install" : "remove", source, undo);
  };

  /**
   * Пачка одной транзакцией: пакеты слота ставятся, другие снимаются (`installPackages` оболочки; одна строка очереди). Пакеты настроек игры идут отдельно, как раньше.
   * Строка пачки носит id первого пакета, поэтому ход очереди и отказ читаются теми же `jobs`, что у одиночного пакета.
   */
  const runBatch = (key, plan, undo, name) => {
    let undone = false;
    const undoOnce = () => {
      if (undone) return;
      undone = true;
      undo();
    };
    for (const part of plan.settings.install) run(key, part, "install", null, undoOnce);
    for (const id of plan.settings.remove) if (byId.has(id)) run(key, byId.get(id), "remove", null, undoOnce);
    const { packages, removeModIds } = plan;
    if (!packages.length) {
      // Ставить нечего — снимается обычным снятием.
      for (const id of removeModIds) if (byId.has(id)) run(key, byId.get(id), "remove", null, undoOnce);
      return;
    }
    const jobKey = `${key}#batch:${packages[0].id}`;
    const job = { id: packages[0].id, key, operation: "install", seen: false, undo: undoOnce };
    jobs.current.set(jobKey, job);
    Promise.resolve()
      .then(() => batching.current({ name, parts: packages, removeModIds, bundle }))
      .then((queued) => {
        if (queued === false) {
          settle(jobKey, job, true);
          return;
        }
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          verify(jobKey, job);
        }, SETTLE_DELAY_MS);
        timers.current.add(timer);
      })
      .catch(() => {
        settle(jobKey, job, true);
      });
  };

  /**
   * Пакеты встают на место компонента (замена или родные): прежняя своя работа уходит, потом идёт ход. `make` строит пачку в момент хода (по тому, что стоит
   * тогда), `legacy` — прежний ход по пакетам, когда оболочка пачки не умеет.
   */
  const putPlan = (key, prev, undo, { make, name, legacy }) => {
    if (!bundleStands()) return;
    const go = () => (batching.current ? runBatch(key, make(), undo, name) : legacy());
    if (!prev.work) {
      go();
      return;
    }
    runWorkshop(
      key,
      async () => {
        const dropped = await dropStandingWork(prev.work);
        if (dropped.ok) go();
        return dropped;
      },
      undo,
    );
  };

  // Родные пакеты, что заменяет своя работа: у «Эффектов» только пакет попаданий, у остальных все пакеты компонента.
  const replacedByWork = (slotKeys) =>
    slotKeys.flatMap((slot) => {
      const component = list.find((one) => one.key === slot);
      return component ? workReplacedParts(component.key, component.parts) : [];
    });

  // Родные пакеты компонентов (слоты `slotKeys`) — всё, что у них есть в сборке.
  const nativeOf = (slotKeys) => slotKeys.flatMap((slot) => list.find((component) => component.key === slot)?.parts || []);

  // Пакеты замены, что стоят на этих слотах: у каждой чужой сборки — её пакеты слота (в том числе общим архивом нескольких слотов).
  const standingReplacement = (slotKeys, swaps) => {
    const own = nativeOf(slotKeys).flatMap(slotsOf);
    const found = new Map();
    for (const slot of slotKeys) {
      const source = swaps[slot] ? byId.get(swaps[slot]) : null;
      if (source) for (const part of sourceParts(source, slot, byId, own)) found.set(part.id, part);
    }
    return [...found.values()];
  };

  /**
   * Слот другой сборки вместо родного: `candidate` — строка `swapCandidates` (`source`, `parts`, `slots`). Общий архив нескольких слотов закрывает
   * все слоты сборки, что он занимает: выбор пишется на каждый.
   */
  const swap = (key, candidate, source) => {
    if (!group || !key || !candidate?.source) return;
    const own = new Set(list.map((component) => component.key));
    const covered = [...new Set([key, ...(candidate.slots || []).filter((slot) => own.has(slot))])];
    const prevs = new Map(covered.map((slot) => [slot, snapshot(slot)]));
    forget(key);
    for (const slot of covered) {
      setComponentSwap(group, slot, candidate.source.id);
      setComponentOff(group, slot, false);
    }
    const undo = () => {
      for (const [slot, prev] of prevs) putBack(slot, prev);
    };
    // Прежняя замена этих слотов (если стояла) уходит той же пачкой; читается из снимков до записи нового выбора.
    const previousSwaps = Object.fromEntries([...prevs].map(([slot, was]) => [slot, was.swap]));
    putPlan(key, prevs.get(key), undo, {
      name: candidate.parts[0]?.name || candidate.source.name,
      make: () => swapPlan({ replacement: candidate.parts, native: nativeOf(covered), previous: standingReplacement(covered, previousSwaps), installed: latest.current?.installed || [] }),
      legacy: () => runParts(key, candidate.parts, "install", source, undo),
    });
  };

  /** Вернуть родные пакеты слота на место замены или своей работы; слоты, закрытые тем же общим архивом, возвращаются вместе. */
  const restore = (key, source) => {
    if (!group || !key) return;
    const before = bundleComponents(group);
    const prev = snapshot(key);
    if (!prev.swap && !prev.work) return;
    const same = prev.swap
      ? Object.keys(before.swap).filter((slot) => before.swap[slot] === prev.swap)
      : Object.keys(before.work).filter((slot) => before.work[slot] === prev.work);
    const prevs = new Map(same.map((slot) => [slot, snapshot(slot)]));
    forget(key);
    for (const slot of same) {
      setComponentSwap(group, slot, "");
      setComponentWork(group, slot, "");
    }
    const undo = () => {
      for (const [slot, was] of prevs) putBack(slot, was);
    };
    /* Родные пакеты всех слотов, закрытых одной заменой или работой, возвращаются одним ходом: пакеты замены снимаются той же пачкой, своя работа — до неё. */
    const previousSwaps = Object.fromEntries([...prevs].map(([slot, was]) => [slot, was.swap]));
    /* Родные пакеты идут порядком сборки, а не порядком слотов, в каком их закрывали. */
    const natives = inBuildOrder(nativeOf(same), bundle);
    putPlan(key, prev, undo, {
      name: natives[0]?.name || "",
      make: () => restorePlan({ native: natives, replacement: standingReplacement(same, previousSwaps), installed: latest.current?.installed || [] }),
      legacy: () => {
        for (const slot of same) runParts(slot, nativeOf([slot]), "install", source, undo);
      },
    });
  };

  /**
   * Своя работа мастерской на месте компонента (`work` — запись списка работ мастерской). Одна работа «Запретных зон» встаёт на все три слота зон:
   * `covers` — слоты, куда её можно поставить, выбор пишется на каждый слот сборки из них, ход мастерской один.
   */
  const pickWork = (key, work, covers = []) => {
    if (!group || !key || !work) return;
    const own = new Set(list.map((component) => component.key));
    const covered = [...new Set([key, ...covers.filter((slot) => own.has(slot))])];
    const prevs = new Map(covered.map((slot) => [slot, snapshot(slot)]));
    forget(key);
    for (const slot of covered) {
      setComponentWork(group, slot, work.key);
      setComponentOff(group, slot, false);
    }
    if (!bundleStands()) return;
    runWorkshop(
      key,
      async () => {
        const result = await installComponentWorks([work]);
        /* Первым идёт ход мастерской, и отказ его ничего не меняет; встала работа — родные пакеты слота снимаются обычным снятием. */
        if (result?.ok) {
          const { removeModIds } = workPlan({ native: replacedByWork(covered), installed: latest.current?.installed || [] });
          for (const id of removeModIds) if (byId.has(id)) run(key, byId.get(id), "remove", null, () => {});
        }
        return result;
      },
      () => {
        for (const [slot, was] of prevs) putBack(slot, was);
      },
    );
  };

  return { group, components, list, keys, notes, toggle, swap, restore, pickWork };
}
