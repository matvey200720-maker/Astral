/*
 * Звук студии в окне: стрельба, которая идёт, пока её не остановили, и
 * попадания.
 *
 * «Огонь» не играет заготовленную очередь — он держит курок (`live-fire.js`):
 * выстрелы идут темпом ствола из его метаданных, магазин за магазином, с
 * хвостом, когда курок отпущен, и каждый следующий выстрел звучит тем, что
 * стоит в студии сейчас. Правка во время стрельбы пересобирает звук в фоне
 * и подменяет его на ходу — очередь при этом не прерывается. Длины — длины
 * дорожек игры (`sound-kit-audio.js`): свой файл слышно ровно таким, каким
 * он будет в игре, а не целиком.
 *
 * Сцена получает выстрелы лентой (`weaponFeed`, `hitFeed`) на часах
 * страницы: вспышка у дула и звук выстрела совпадают до кадра, и React ради
 * каждого выстрела не перерисовывается.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIT_SOUND_PART_IDS } from "@modovik/sound-studio";
import { sanitizeDesktopErrorMessage } from "../../../../api.js";
import { createLruCache } from "../lru-cache.js";
import { tr } from "../../../../locales/ui.js";
import {
  audioBufferFromChannels,
  liveClock,
  scheduleVoice,
  stopPlayback,
  warmAudio,
} from "./WaveformPlayer.jsx";
import {
  HIT_FLIGHT_SECONDS,
  createLiveLoop,
  firePlan,
  fireState,
  nextFireEvents,
  nextSeriesEvents,
  seriesPattern,
  seriesState,
} from "./live-fire.js";
import { renderHitPreview, renderWeaponPreview } from "./sound-kit-audio.js";
import { designSignature } from "./sound-kit-model.js";

/* Первый звук — чуть позже «сейчас»: контексту нужно проснуться. */
const START_LEAD_SECONDS = 0.06;
/* Проба готового звука без стрельбы: у автомата — короткая очередь. */
const AUDITION_SHOTS = 5;
/*
 * Звук ствола собирается заранее, пока человек выбирает и правит: чтение игры, сведение и перевод в буферы окна
 * не должны приходиться на щелчок «Огонь». Пауза — чтобы листание стволов и ход ползунка не собирали звук на
 * каждый шаг (ТЗ 24.10.2026, п. 3).
 */
const PREPARE_DELAY_MS = 300;

function toBuffer(render) {
  if (!render) return null;
  return audioBufferFromChannels(render.channels, render.sampleRate);
}

/*
 * Темп стрельбы: у выстрела игры автомат стреляет тактом своей очереди из
 * дерева игры (у карабина 86 мс) — так его и слышно в игре; иначе — темп
 * ствола из weapons.meta.
 */
const planOf = (weapon, buffers) =>
  buffers?.cadence
    ? firePlan({ ...weapon, rpm: 60 / buffers.cadence })
    : firePlan(weapon);

/* Следующий выстрел очереди: варианты игры по кругу, иначе один звук. */
const shotBuffer = (buffers, index) =>
  buffers.shots?.length
    ? buffers.shots[(Math.max(1, index) - 1) % buffers.shots.length]
    : buffers.shot;

/* Живой палец не бьёт ровно: лёгкая разница громкости снимает «пулемёт из
   одного сэмпла». У выстрела игры разница уже в её вариантах. */
const shotGain = (buffers, index) =>
  buffers.shots?.length ? 1 : 1 - (index % 3) * 0.05;

/*
 * Сборка звука по ключу — одна на ключ. В запасе лежит обещание, а не
 * готовый звук: щелчок по готовому звуку посреди серии просит его и для
 * пробы, и для серии, и собирается он один раз. Упавшая сборка из запаса
 * уходит — следующая попытка соберёт заново, а не получит ту же ошибку.
 */
function cachedRender(cache, key, render) {
  const known = cache.get(key);
  if (known) return known;
  const pending = render();
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

/* Лента для сцены: подписка без перерисовки React. */
function createFeed() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(message) {
      for (const listener of [...listeners]) listener(message);
    },
  };
}

const hitKey = (design, target) =>
  `hit|${designSignature(design)}|${target?.sampleRate || 0}|${target?.maxSamples || 0}`;

export function useSoundKitAudio({ host, gameRoot, onNotice }) {
  const cache = useRef(null);
  if (!cache.current) cache.current = createLruCache(48);
  const notice = useRef(onNotice);
  notice.current = onNotice;
  const fail = useCallback((error) => {
    notice.current?.(sanitizeDesktopErrorMessage(error), "error");
  }, []);

  /* Контекст Web Audio — сразу, как открылась студия: его создание не должно стоять в щелчке «Огонь». */
  useEffect(() => {
    const idle = globalThis.requestIdleCallback || ((run) => globalThis.setTimeout(run, 200));
    const cancel = globalThis.cancelIdleCallback || globalThis.clearTimeout;
    const handle = idle(() => warmAudio());
    return () => cancel(handle);
  }, []);

  /* Идёт ли стрельба и серия; что готовится к звучанию. */
  const [firing, setFiring] = useState(false);
  const [series, setSeries] = useState(false);
  const [preparing, setPreparing] = useState("");
  const weaponFeed = useMemo(createFeed, []);
  const hitFeed = useMemo(createFeed, []);

  /* ── Звук ствола ───────────────────────────────────────────────────── */

  const weaponBuffers = useCallback(
    (weapon, design) =>
      cachedRender(
        cache.current,
        `${gameRoot}|${weapon.id}|${design ? designSignature(design) : "game"}`,
        async () => {
          const render = await renderWeaponPreview(weapon, design, {
            host,
            gameRoot,
          });
          return {
            first: toBuffer(render.first),
            shot: toBuffer(render.shot),
            shots: (render.shots || []).map(toBuffer),
            tail: toBuffer(render.tail),
            cadence: render.cadence || null,
          };
        },
      ),
    [host, gameRoot],
  );

  /* Что должно звучать (последняя правка) и что уже собрано. Между ними —
     сборка в фоне: пока она идёт, стрельба звучит прежним звуком. */
  const weaponWanted = useRef(null);
  const weaponReady = useRef(null);
  const weaponRendering = useRef(false);
  const fireLoop = useRef(null);
  const fire = useRef(null);

  const stopFire = useCallback(
    ({ release = true } = {}) => {
      const loop = fireLoop.current;
      if (!loop) return;
      fireLoop.current = null;
      loop.stop();
      const state = fire.current;
      fire.current = null;
      weaponFeed.emit({ type: "clear" });
      /* Отпущенный посреди очереди курок — хвост, как в игре. */
      const ready = weaponReady.current;
      const clock = liveClock();
      if (release && clock && state?.index > 0 && ready?.plan.auto)
        scheduleVoice(ready.buffers.tail, clock.now + 0.01);
      setFiring(false);
      setPreparing((current) => (current === "fire" ? "" : current));
    },
    [weaponFeed],
  );

  const pumpWeapon = useCallback(async () => {
    if (weaponRendering.current) return;
    weaponRendering.current = true;
    try {
      for (;;) {
        const wanted = weaponWanted.current;
        if (!wanted || weaponReady.current?.key === wanted.key) break;
        let buffers;
        try {
          buffers = await weaponBuffers(wanted.weapon, wanted.design);
        } catch (error) {
          /* Устаревшая правка упала — неважно, следом соберётся новая. */
          if (weaponWanted.current !== wanted) continue;
          stopFire({ release: false });
          fail(error);
          break;
        }
        weaponReady.current = {
          key: wanted.key,
          weapon: wanted.weapon,
          buffers,
          plan: planOf(wanted.weapon, buffers),
          shotSeconds: buffers.shot?.duration || 0,
        };
        fireLoop.current?.poke();
      }
    } finally {
      weaponRendering.current = false;
    }
  }, [weaponBuffers, stopFire, fail]);

  /* Заготовка звука ствола в тишине: по паузе после последней правки или выбора. Упавшую заготовку не показываем —
     её ошибка прозвучит, если человек всё же нажмёт «Огонь» (там `fail`). */
  const prepareTimer = useRef(0);
  const prepareWeapon = useCallback(() => {
    globalThis.clearTimeout(prepareTimer.current);
    prepareTimer.current = globalThis.setTimeout(() => {
      const wanted = weaponWanted.current;
      if (!wanted || fireLoop.current || weaponReady.current?.key === wanted.key) return;
      weaponBuffers(wanted.weapon, wanted.design).catch(() => {});
    }, PREPARE_DELAY_MS);
  }, [weaponBuffers]);
  useEffect(() => () => globalThis.clearTimeout(prepareTimer.current), []);

  /** Ствол и его замысел, которые звучат сейчас; `design = null` — игра. */
  const setWeapon = useCallback(
    (weapon, design) => {
      if (!weapon) return;
      const key = `${gameRoot}|${weapon.id}|${design ? designSignature(design) : "game"}`;
      if (weaponWanted.current?.key === key) return;
      weaponWanted.current = { weapon, design, key };
      if (fireLoop.current) void pumpWeapon();
    },
    [gameRoot, pumpWeapon],
  );

  /* ── Попадания ─────────────────────────────────────────────────────── */

  const hitBuffer = useCallback(
    (design, target) =>
      cachedRender(cache.current, hitKey(design, target), async () =>
        toBuffer(await renderHitPreview(design, target)),
      ),
    [],
  );

  const hitWanted = useRef({ hits: {}, targetOf: () => null });
  const hitReady = useRef({});
  const hitRendering = useRef(false);
  const seriesLoop = useRef(null);
  const seriesAt = useRef(null);

  /* Части со звуком и ключ их нынешнего звука — всегда из последней правки. */
  const wantedParts = useCallback(
    () => HIT_SOUND_PART_IDS.filter((part) => hitWanted.current.hits[part]),
    [],
  );
  const partKey = useCallback(
    (part) =>
      hitKey(hitWanted.current.hits[part], hitWanted.current.targetOf(part)),
    [],
  );

  const stopSeries = useCallback(() => {
    const loop = seriesLoop.current;
    if (!loop) return;
    seriesLoop.current = null;
    loop.stop();
    seriesAt.current = null;
    hitFeed.emit({ type: "clear" });
    setSeries(false);
    setPreparing((current) => (current === "hits" ? "" : current));
  }, [hitFeed]);

  const pumpHits = useCallback(async () => {
    if (hitRendering.current) return;
    hitRendering.current = true;
    try {
      for (;;) {
        const parts = wantedParts();
        const ready = { ...hitReady.current };
        for (const part of Object.keys(ready))
          if (!parts.includes(part)) delete ready[part];
        hitReady.current = ready;
        const part = parts.find((id) => ready[id]?.key !== partKey(id));
        if (!part) break;
        const key = partKey(part);
        const { hits, targetOf } = hitWanted.current;
        let buffer;
        try {
          buffer = await hitBuffer(hits[part], targetOf(part));
        } catch (error) {
          if (partKey(part) !== key) continue;
          stopSeries();
          fail(error);
          break;
        }
        hitReady.current = { ...hitReady.current, [part]: { key, buffer } };
        seriesLoop.current?.poke();
      }
    } finally {
      hitRendering.current = false;
    }
  }, [hitBuffer, stopSeries, fail, wantedParts, partKey]);

  /* То же для серии попаданий: звуки частей собираются в паузе, «Серия» не ждёт сборки (ТЗ 24.10.2026, п. 3). */
  const hitPrepareTimer = useRef(0);
  const prepareHits = useCallback(() => {
    globalThis.clearTimeout(hitPrepareTimer.current);
    hitPrepareTimer.current = globalThis.setTimeout(() => {
      if (seriesLoop.current) return;
      const { hits, targetOf } = hitWanted.current;
      for (const part of wantedParts()) hitBuffer(hits[part], targetOf(part)).catch(() => {});
    }, PREPARE_DELAY_MS);
  }, [hitBuffer, wantedParts]);
  useEffect(() => () => globalThis.clearTimeout(hitPrepareTimer.current), []);

  /**
   * Звуки попадания, которые звучат сейчас: `hits` — замыслы частей,
   * `targetOf(part)` — частота и предел дорожки игры (бюджет банка).
   */
  const setHits = useCallback(
    (hits, targetOf) => {
      hitWanted.current = { hits: hits || {}, targetOf };
      if (seriesLoop.current) void pumpHits();
    },
    [pumpHits],
  );

  /* ── Органы ────────────────────────────────────────────────────────── */

  const startFire = useCallback(() => {
    if (fireLoop.current || !weaponWanted.current) return;
    if (!liveClock()) {
      fail(new Error(tr("Браузер не поддерживает Web Audio.")));
      return;
    }
    stopSeries();
    stopPlayback();
    fire.current = null;
    const loop = createLiveLoop({
      produce: (until) => {
        const ready = weaponReady.current;
        if (!ready) return [];
        if (!fire.current) {
          /* Первый выстрел — уже нынешним звуком, а не прошлой правкой. */
          if (ready.key !== weaponWanted.current?.key) return [];
          const clock = liveClock();
          if (!clock) return [];
          fire.current = fireState(clock.now + START_LEAD_SECONDS);
          setPreparing((current) => (current === "fire" ? "" : current));
        }
        return nextFireEvents(
          fire.current,
          () => weaponReady.current.plan,
          until,
          {
            shotSeconds: ready.shotSeconds,
            hasTail: Boolean(ready.buffers.tail),
          },
        );
      },
      play: (event) => {
        const { buffers } = weaponReady.current;
        const buffer =
          event.kind === "first"
            ? buffers.first
            : event.kind === "tail"
              ? buffers.tail
              : shotBuffer(buffers, event.index);
        const gain = event.kind === "shot" ? shotGain(buffers, event.index) : 1;
        return scheduleVoice(buffer, event.at, { gain });
      },
      onEvents: (events) => {
        const times = events
          .filter((event) => event.kind !== "tail")
          .map((event) => event.page);
        if (times.length) weaponFeed.emit({ type: "shots", times });
      },
    });
    fireLoop.current = loop;
    setFiring(true);
    if (weaponReady.current?.key !== weaponWanted.current.key)
      setPreparing("fire");
    loop.start();
    void pumpWeapon();
  }, [stopSeries, pumpWeapon, weaponFeed, fail]);

  const toggleFire = useCallback(() => {
    if (fireLoop.current) stopFire();
    else startFire();
  }, [startFire, stopFire]);

  /**
   * Выстрел без стрельбы: одиночный по кнопке или короткая проба готового
   * звука (`audition`). `design` — замысел, который звучит прямо сейчас,
   * если студия ещё не успела его передать.
   */
  const shoot = useCallback(
    async ({ design, audition = false } = {}) => {
      const wanted = weaponWanted.current;
      if (!wanted) return;
      /* Пока идёт стрельба, проба — это сама стрельба: правка и так
         слышна на ходу. */
      if (fireLoop.current && audition) return;
      if (fireLoop.current) stopFire({ release: false });
      const weapon = wanted.weapon;
      const chosen = design === undefined ? wanted.design : design;
      setPreparing("single");
      try {
        const buffers = await weaponBuffers(weapon, chosen);
        const clock = liveClock();
        if (!clock || fireLoop.current) return;
        stopPlayback();
        const plan = planOf(weapon, buffers);
        const count =
          audition && plan.auto ? Math.min(AUDITION_SHOTS, plan.burst) : 1;
        const start = clock.now + START_LEAD_SECONDS;
        const times = [];
        for (let index = 0; index < count; index += 1) {
          const at = start + index * plan.cadence;
          scheduleVoice(
            index === 0 ? buffers.first : shotBuffer(buffers, index),
            at,
            {
              gain: index === 0 ? 1 : shotGain(buffers, index),
            },
          );
          times.push(clock.toPage(at));
        }
        if (plan.auto && buffers.tail)
          scheduleVoice(
            buffers.tail,
            start +
              (count - 1) * plan.cadence +
              Math.min(plan.cadence, buffers.shot?.duration || plan.cadence),
          );
        weaponFeed.emit({ type: "clear" });
        weaponFeed.emit({ type: "shots", times });
      } catch (error) {
        fail(error);
      } finally {
        setPreparing((current) => (current === "single" ? "" : current));
      }
    },
    [weaponBuffers, stopFire, weaponFeed, fail],
  );

  const startSeries = useCallback(() => {
    if (seriesLoop.current) return;
    if (!wantedParts().length) return;
    if (!liveClock()) {
      fail(new Error(tr("Браузер не поддерживает Web Audio.")));
      return;
    }
    stopFire({ release: false });
    stopPlayback();
    seriesAt.current = null;
    const loop = createLiveLoop({
      produce: (until) => {
        const parts = wantedParts();
        if (!parts.length) return [];
        if (!seriesAt.current) {
          if (
            parts.some((part) => hitReady.current[part]?.key !== partKey(part))
          )
            return [];
          const clock = liveClock();
          if (!clock) return [];
          seriesAt.current = seriesState(
            clock.now + START_LEAD_SECONDS + HIT_FLIGHT_SECONDS,
          );
          setPreparing((current) => (current === "hits" ? "" : current));
        }
        return nextSeriesEvents(
          seriesAt.current,
          () =>
            seriesPattern(
              wantedParts().filter((part) => hitReady.current[part]),
            ),
          until,
        );
      },
      play: (event) =>
        scheduleVoice(hitReady.current[event.part]?.buffer, event.at),
      onEvents: (events) =>
        hitFeed.emit({
          type: "hits",
          events: events.map((event) => ({ part: event.part, at: event.page })),
        }),
    });
    seriesLoop.current = loop;
    setSeries(true);
    if (
      wantedParts().some(
        (part) => hitReady.current[part]?.key !== partKey(part),
      )
    )
      setPreparing("hits");
    loop.start();
    void pumpHits();
  }, [stopFire, pumpHits, hitFeed, fail, wantedParts, partKey]);

  const toggleSeries = useCallback(() => {
    if (seriesLoop.current) stopSeries();
    else startSeries();
  }, [startSeries, stopSeries]);

  /**
   * Одно попадание в часть. `design` — замысел, если студия его только что
   * поменяла и ещё не передала сюда. Во время серии попадание ложится
   * поверх неё, серия не прерывается.
   */
  const hit = useCallback(
    async (part, design) => {
      const chosen =
        design === undefined ? hitWanted.current.hits[part] : design;
      if (!chosen) return;
      try {
        const buffer = await hitBuffer(
          chosen,
          hitWanted.current.targetOf(part),
        );
        const clock = liveClock();
        if (!clock) return;
        if (!seriesLoop.current) {
          stopFire({ release: false });
          stopPlayback();
        }
        const at = clock.now + START_LEAD_SECONDS + HIT_FLIGHT_SECONDS;
        scheduleVoice(buffer, at);
        hitFeed.emit({
          type: "hits",
          events: [{ part, at: clock.toPage(at) }],
        });
      } catch (error) {
        fail(error);
      }
    },
    [hitBuffer, stopFire, hitFeed, fail],
  );

  /** Тишина: стрельба, серия и всё, что звучит. */
  const stop = useCallback(() => {
    stopFire({ release: false });
    stopSeries();
    stopPlayback();
    setPreparing("");
  }, [stopFire, stopSeries]);

  useEffect(() => stop, [stop]);

  return {
    firing,
    series,
    preparing,
    weaponFeed,
    hitFeed,
    setWeapon,
    prepare: prepareWeapon,
    prepareHits,
    setHits,
    toggleFire,
    shoot,
    toggleSeries,
    hit,
    stop,
  };
}
