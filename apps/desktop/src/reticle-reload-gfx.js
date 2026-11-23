import {
  RELOAD_CAP,
  RELOAD_FADE_MS,
  RELOAD_FINISH_MS,
  RELOAD_HOLD_MS,
  RELOAD_PHASE,
  RELOAD_STEPS,
  RELOAD_TIMEOUT_MS,
  RELOAD_UNKNOWN_LIMIT_MS,
  RETICLE_STAGE,
  hexToRgb,
  normalizeReloadTimes,
  reloadFrameContours,
} from "@modovik/reticle-contract";
import { AVM1, action, assembleActions, register } from "./scaleform-avm1.js";
import { defineFunction2 } from "./minimap-gps-line.js";
import {
  SWF_TAG,
  definePolygonsShape,
  defineSpriteFrames,
  placeObject2,
  swfTag,
} from "./scaleform-swf.js";
import { coderFor } from "./reticle-damage-gfx.js";

/*
 * Индикатор перезарядки в `hud_reticle.gfx` (`@modovik/reticle-contract/reload.js`).
 *
 * Слова «перезарядка» игра фильму прицела не шлёт. Числа патронов приходят в
 * hud.gfx: `CONTAINER_METHOD(2, "SET_AMMO_COUNT", …)` — туда встаёт короткий
 * перехват (`hudReloadHookSteps`, `hud-ammo-gfx-compiler.js`), который отдаёт
 * их классу прицела через общий `_global.astralReloadHud`. Остальное — здесь:
 *
 *   1. Клип `astralReload` — RELOAD_STEPS + 1 кадров: в кадре k пустая часть и
 *      заливка доли k / STEPS (`reloadFrameContours` — те же фигуры рисует
 *      редактор). Цвета и прозрачность пустой части — в самих фигурах.
 *   2. Конец конструктора `HUD_RETICLE`: `_global.astralReloadHud = this`,
 *      состояние автомата на классе (`astralRP` фаза, `astralRS` часы в начале
 *      фазы, `astralRE` сколько прошло к кадру, `astralRD` длительность, мс,
 *      `astralRG` доля, `astralRO` откуда дозаливать, `astralRH` патрон за
 *      патроном, `astralRW` ствол, `astralRC` обойма) и четыре функции:
 *      `astralReloadWeapon`, `astralReloadAmmo`, `astralReloadTick` (кадр
 *      клипа) и `astralReloadDraw`.
 *   3. Длительности перезарядки стволов из файлов игры, мс — `astralRT` на
 *      классе: таблица вшита при сборке (`reloadTimeKey` — хеш без знака;
 *      хеш со знаком из `SET_PLAYER_WEAPON` приводится так же). Длительность —
 *      до мига, когда снова можно стрелять: полная обойма раньше неё заливку
 *      не обрывает (фаза `full`, кольцо доходит по часам). Ствола в таблице
 *      нет — длительность 0: заливки по ходу нет, есть дозаливка в конце.
 *
 * Время — `getTimer()` (действие 0x34), а не счёт кадров: клип тикает не 30 раз
 * в секунду (стенд 15.11.2026: ≈ 24,5) и стоит, пока игра прячет прицел. Часы у
 * hud.gfx и hud_reticle.gfx одни: фильмы HUD загружены в один контейнер и
 * делят один `_global` (стенд, пункт 2), так что начало, отмеченное в
 * `astralReloadAmmo` (его зовёт hud.gfx), и кадр клипа читают одно время.
 *
 * Клип появляется на первой перезарядке на корне фильма (`this.TIMELINE`),
 * выше `CONTENT`, как счётчик урона: прячет прицел игра через `CONTENT`, и
 * индикатор при этом остаётся. Код кадра стоит, только пока индикатор на виду.
 *
 * Автомат — тот же, что `reloadWeapon`, `reloadAmmo`, `reloadTick` и
 * `reloadLook` контракта: их исполняет кадр редактора, а тест прогоняет этот
 * код AVM1 и сверяет шаг за шагом. Без включённого индикатора файл байт в
 * байт прежний. Символы — 64480…64599, ниже перелива.
 */

export const RELOAD_SYMBOL = "astralReload";
export const RELOAD_HUD_GLOBAL = "astralReloadHud";
export const RELOAD_IDS = Object.freeze({
  first: 64480,
  track: (step) => 64480 + step,
  fill: (step) => 64480 + RELOAD_STEPS + 1 + step,
  sprite: 64480 + 2 * (RELOAD_STEPS + 1),
  last: 64599,
});

const OP = Object.freeze({
  SUBTRACT: 0x0b,
  MULTIPLY: 0x0c,
  DIVIDE: 0x0d,
  /* ActionGetTime: getTimer(), миллисекунды с начала фильма. */
  GET_TIME: 0x34,
  DELETE: 0x3a,
  RETURN: 0x3e,
  ADD2: 0x47,
  LESS2: 0x48,
  EQUALS2: 0x49,
  TO_NUMBER: 0x4a,
  GREATER: 0x67,
});

const THIS = 1;
/* Флаги метода Rockstar: `this` — в регистре 1, без super и arguments. */
const METHOD_FLAGS = 0x29;

/* Члены класса с состоянием автомата. */
const S = Object.freeze({
  phase: "astralRP",
  since: "astralRS",
  elapsed: "astralRE",
  duration: "astralRD",
  progress: "astralRG",
  from: "astralRO",
  shell: "astralRH",
  weapon: "astralRW",
  clip: "astralRC",
});
const TIMES = "astralRT";
const CLIP_MEMBER = "astralReloadClip";

/* -------------------------------- символы -------------------------------- */

/**
 * Фигуры и клип индикатора. Кадр k ставит на глубину 1 пустую часть, на 2 —
 * заливку; переход снимает прежнее и ставит своё, так что и прыжок назад
 * (`gotoAndStop` на меньший кадр) собирает ровно один кадр.
 */
export function reloadDefinitions(config) {
  const fillColor = [...hexToRgb(config.color), 255];
  const trackColor = [
    ...hexToRgb(config.trackColor),
    Math.round((config.trackOpacity / 100) * 255),
  ];
  const tags = [];
  const frames = [];
  let shown = [null, null];
  for (let step = 0; step <= RELOAD_STEPS; step += 1) {
    const { fill, track } = reloadFrameContours(config, step);
    const ids = [
      track.length && trackColor[3] > 0 ? RELOAD_IDS.track(step) : null,
      fill.length ? RELOAD_IDS.fill(step) : null,
    ];
    if (ids[0] !== null)
      tags.push(definePolygonsShape(ids[0], track, trackColor));
    if (ids[1] !== null)
      tags.push(definePolygonsShape(ids[1], fill, fillColor));
    const frame = [];
    ids.forEach((id, index) => {
      const depth = index + 1;
      if (shown[index] === id) return;
      if (shown[index] !== null)
        frame.push(
          swfTag(
            SWF_TAG.REMOVE_OBJECT2,
            Buffer.from([depth & 0xff, depth >> 8]),
            false,
          ),
        );
      if (id !== null) frame.push(placeObject2({ depth, characterId: id }));
    });
    frames.push(frame);
    shown = ids;
  }
  const exported = Buffer.alloc(4);
  exported.writeUInt16LE(1, 0);
  exported.writeUInt16LE(RELOAD_IDS.sprite, 2);
  return [
    ...tags,
    defineSpriteFrames(RELOAD_IDS.sprite, frames),
    swfTag(
      SWF_TAG.EXPORT_ASSETS,
      Buffer.concat([exported, Buffer.from(`${RELOAD_SYMBOL}\0`, "latin1")]),
    ),
  ];
}

/* ------------------------------- код AVM1 ------------------------------- */

function reloadCoder(pool) {
  const c = coderFor(pool);
  /* getTimer() на стеке */
  const now = () => [c.op(OP.GET_TIME)];
  /* _global.a.b… на стеке */
  const global = (...path) => [
    c.push("_global"),
    c.op(AVM1.GET_VARIABLE),
    ...path.flatMap((name) => [c.push(name), c.op(AVM1.GET_MEMBER)]),
  ];
  const equals = (left, right) => [...left, ...right, c.op(OP.EQUALS2)];
  /* Math.min / Math.max двух значений */
  const math2 = (name, first, second) => [
    ...second,
    ...first,
    c.push(2, "Math"),
    c.op(AVM1.GET_VARIABLE),
    c.push(name),
    c.op(AVM1.CALL_METHOD),
  ];
  const draw = (slot) => [
    c.push(0, register(slot), "astralReloadDraw"),
    c.op(AVM1.CALL_METHOD),
    c.op(AVM1.POP),
  ];
  const setState = (slot, values) =>
    Object.entries(values).flatMap(([name, value]) =>
      c.set(slot, [S[name]], Array.isArray(value) ? value : [c.push(value)]),
    );
  return { ...c, now, global, equals, math2, draw, setState };
}

/** `astralReloadDraw()`: `this` — класс прицела. Клип, кадр заливки, прозрачность. */
function drawFunction(pool, config) {
  const c = reloadCoder(pool);
  const CLIP = 2;
  const steps = [
    ...c.store(CLIP, c.get(THIS, CLIP_MEMBER)),
    ...c.when(c.equals(c.get(THIS, S.phase), [c.push(RELOAD_PHASE.idle)]), [
      ...c.when(
        [
          ...c.equals([c.push(register(CLIP))], [c.push(undefined)]),
          c.op(AVM1.NOT),
        ],
        [
          ...c.set(CLIP, ["_visible"], [c.push(false)]),
          c.push(register(CLIP), "onEnterFrame"),
          c.op(OP.DELETE),
          c.op(AVM1.POP),
        ],
      ),
      ...c.leave(),
    ]),
    ...c.when(c.equals([c.push(register(CLIP))], [c.push(undefined)]), [
      /* this.TIMELINE.attachMovie(символ, имя, this.TIMELINE.getNextHighestDepth()) */
      c.push(0),
      ...c.get(THIS, "TIMELINE"),
      c.push("getNextHighestDepth"),
      c.op(AVM1.CALL_METHOD),
      c.push(RELOAD_SYMBOL, RELOAD_SYMBOL, 3),
      ...c.get(THIS, "TIMELINE"),
      c.push("attachMovie"),
      c.op(AVM1.CALL_METHOD),
      action(AVM1.STORE_REGISTER, Buffer.from([CLIP])),
      c.op(AVM1.POP),
      ...c.set(THIS, [CLIP_MEMBER], [c.push(register(CLIP))]),
      ...c.set(CLIP, ["_x"], [c.push(RETICLE_STAGE.width / 2 + config.x)]),
      ...c.set(CLIP, ["_y"], [c.push(RETICLE_STAGE.height / 2 + config.y)]),
      ...c.set(CLIP, ["h"], [c.push(register(THIS))]),
    ]),
    ...c.set(CLIP, ["_visible"], [c.push(true)]),
    ...c.set(CLIP, ["onEnterFrame"], c.get(THIS, "astralReloadTick")),
    /* gotoAndStop(round(доля * STEPS) + 1) */
    ...c.math("round", [
      ...c.get(THIS, S.progress),
      c.push(RELOAD_STEPS),
      c.op(OP.MULTIPLY),
    ]),
    c.push(1),
    c.op(OP.ADD2),
    c.push(1, register(CLIP), "gotoAndStop"),
    c.op(AVM1.CALL_METHOD),
    c.op(AVM1.POP),
    /* Затухание: opacity * (1 - elapsed / FADE) */
    ...c.when(c.equals(c.get(THIS, S.phase), [c.push(RELOAD_PHASE.fade)]), [
      ...c.set(
        CLIP,
        ["_alpha"],
        [
          c.push(config.opacity),
          c.push(1),
          ...c.get(THIS, S.elapsed),
          c.push(RELOAD_FADE_MS),
          c.op(OP.DIVIDE),
          c.op(OP.SUBTRACT),
          c.op(OP.MULTIPLY),
        ],
      ),
      ...c.leave(),
    ]),
    ...c.set(CLIP, ["_alpha"], [c.push(config.opacity)]),
  ];
  return defineFunction2({ registers: 3, flags: METHOD_FLAGS, steps });
}

/** `astralReloadWeapon(weapon)`: смена ствола — перезарядка прежнего забыта. */
function weaponFunction(pool) {
  const c = reloadCoder(pool);
  const WEAPON = 2;
  const steps = [
    ...c.when(
      c.equals(c.get(THIS, S.weapon), [c.push(register(WEAPON))]),
      c.leave(),
    ),
    ...c.setState(THIS, {
      weapon: [c.push(register(WEAPON))],
      phase: RELOAD_PHASE.idle,
      since: 0,
      elapsed: 0,
      duration: 0,
      progress: 0,
      from: 0,
      shell: 0,
      clip: -1,
    }),
    ...c.draw(THIS),
  ];
  return defineFunction2({
    params: [[WEAPON, "weapon"]],
    registers: 3,
    flags: METHOD_FLAGS,
    steps,
  });
}

/** `astralReloadAmmo(reserve, clip, size)`: числа `SET_AMMO_COUNT`. */
function ammoFunction(pool, config) {
  const c = reloadCoder(pool);
  const RESERVE = 2;
  const AMMO = 3;
  const SIZE = 4;
  const PREVIOUS = 5;
  const KNOWN = 6;
  const SHELL = 7;
  const NOW = 8;
  const ELAPSED = 9;
  const FROM = 10;
  const KEY = 11;
  const TIME = 12;
  const r = (slot) => [c.push(register(slot))];
  const greater = (left, right) => [...left, ...right, c.op(OP.GREATER)];
  const less = (left, right) => [...left, ...right, c.op(OP.LESS2)];
  const not = (test) => [...test, c.op(AVM1.NOT)];
  const finish = c.label("finish");
  const steps = [
    ...c.store(RESERVE, [...r(RESERVE), c.op(OP.TO_NUMBER)]),
    ...c.store(AMMO, [...r(AMMO), c.op(OP.TO_NUMBER)]),
    ...c.store(SIZE, [...r(SIZE), c.op(OP.TO_NUMBER)]),
    ...c.store(NOW, c.now()),
    ...c.store(PREVIOUS, c.get(THIS, S.clip)),
    ...c.set(THIS, [S.clip], r(AMMO)),
    ...c.when(not(greater(r(SIZE), [c.push(1)])), c.leave()),
    ...c.when(less(r(PREVIOUS), [c.push(0)]), c.leave()),
    /* Начало: обойма опустела, запас есть. */
    ...c.when(c.equals(r(AMMO), [c.push(0)]), [
      ...c.when(greater(r(PREVIOUS), [c.push(0)]), [
        ...c.when(not(greater(r(RESERVE), [c.push(0)])), c.leave()),
        /* Длительность ствола из таблицы: ключ — хеш без знака. */
        ...c.store(KEY, c.get(THIS, S.weapon)),
        ...c.when(
          less(r(KEY), [c.push(0)]),
          c.store(KEY, [...r(KEY), c.push(4294967296), c.op(OP.ADD2)]),
        ),
        ...c.store(KNOWN, [
          ...c.get(THIS, TIMES),
          ...r(KEY),
          c.op(AVM1.GET_MEMBER),
        ]),
        ...c.setState(THIS, {
          phase: RELOAD_PHASE.run,
          since: r(NOW),
          elapsed: 0,
          progress: 0,
          shell: 0,
          from: 0,
          duration: 0,
        }),
        ...c.when(
          not(c.equals(r(KNOWN), [c.push(undefined)])),
          c.setState(THIS, { duration: r(KNOWN) }),
        ),
        ...c.draw(THIS),
        ...c.leave(),
      ]),
    ]),
    ...c.when(greater(r(AMMO), r(PREVIOUS)), [
      ...c.when(c.equals(c.get(THIS, S.phase), [c.push(RELOAD_PHASE.run)]), [
        /* Конец: обойма полная или запас кончился. */
        ...not(less(r(AMMO), r(SIZE))),
        { branch: AVM1.IF, to: finish },
        ...not(greater(r(RESERVE), [c.push(0)])),
        { branch: AVM1.IF, to: finish },
        /* Патрон за патроном. */
        ...c.store(SHELL, [...r(AMMO), ...r(SIZE), c.op(OP.DIVIDE)]),
        ...c.setState(THIS, {
          shell: r(SHELL),
          progress: c.math2("max", c.get(THIS, S.progress), r(SHELL)),
        }),
        ...c.draw(THIS),
        ...c.leave(),
        { label: finish },
        /* elapsed = max(0, now - since): кадров могло не быть (прицел спрятан). */
        ...c.store(
          ELAPSED,
          c.math2(
            "max",
            [c.push(0)],
            [...r(NOW), ...c.get(THIS, S.since), c.op(OP.SUBTRACT)],
          ),
        ),
        /* Обойма полная раньше срока: стрелять ещё нельзя — заливка дорабатывает по часам. */
        ...c.when(
          greater(c.get(THIS, S.duration), [c.push(0)]),
          c.when(less(r(ELAPSED), c.get(THIS, S.duration)), [
            ...c.setState(THIS, {
              phase: RELOAD_PHASE.full,
              elapsed: r(ELAPSED),
              progress: c.math2(
                "max",
                c.get(THIS, S.progress),
                c.math2(
                  "max",
                  [...r(ELAPSED), ...c.get(THIS, S.duration), c.op(OP.DIVIDE)],
                  c.get(THIS, S.shell),
                ),
              ),
            }),
            ...c.draw(THIS),
            ...c.leave(),
          ]),
        ),
        /* Конец: длительность вышла (заливка на потолке) или её нет. */
        /* Доля по часам: min(CAP, elapsed / duration); без длительности — 0. */
        ...c.store(TIME, [c.push(0)]),
        ...c.when(
          greater(c.get(THIS, S.duration), [c.push(0)]),
          c.store(
            TIME,
            c.math2(
              "min",
              [c.push(RELOAD_CAP)],
              [...r(ELAPSED), ...c.get(THIS, S.duration), c.op(OP.DIVIDE)],
            ),
          ),
        ),
        /* from = max(доля, max(доля по часам, shell)) */
        ...c.store(
          FROM,
          c.math2(
            "max",
            c.get(THIS, S.progress),
            c.math2("max", r(TIME), c.get(THIS, S.shell)),
          ),
        ),
        ...c.setState(THIS, {
          phase: RELOAD_PHASE.finish,
          since: r(NOW),
          elapsed: 0,
          from: r(FROM),
          progress: r(FROM),
        }),
        ...c.draw(THIS),
        ...c.leave(),
      ]),
      /* После полной обоймы обойма больше не растёт; на всякий случай — не вспышка. */
      ...c.when(
        c.equals(c.get(THIS, S.phase), [c.push(RELOAD_PHASE.full)]),
        c.leave(),
      ),
      /* Ручная перезарядка: виден только конец. */
      ...(config.manualFlash
        ? [
            ...c.setState(THIS, {
              phase: RELOAD_PHASE.finish,
              since: r(NOW),
              elapsed: 0,
              from: 0,
              progress: 0,
              shell: 0,
            }),
            ...c.draw(THIS),
          ]
        : []),
      ...c.leave(),
    ]),
    /* Обойма убыла посреди перезарядки — её сбили. */
    ...c.when(less(r(AMMO), r(PREVIOUS)), [
      ...c.when(c.equals(c.get(THIS, S.phase), [c.push(RELOAD_PHASE.run)]), [
        ...c.setState(THIS, {
          phase: RELOAD_PHASE.fade,
          since: r(NOW),
          elapsed: 0,
        }),
        ...c.draw(THIS),
        ...c.leave(),
      ]),
      /* Выстрел после полной обоймы: стрелять уже можно — быстрая дозаливка от доли по часам. */
      ...c.when(c.equals(c.get(THIS, S.phase), [c.push(RELOAD_PHASE.full)]), [
        /* from = max(доля, min(1, max(0, now - since) / duration)) */
        ...c.store(
          FROM,
          c.math2("max", c.get(THIS, S.progress), [
            ...c.math2(
              "min",
              [c.push(1)],
              [
                ...c.math2(
                  "max",
                  [c.push(0)],
                  [...r(NOW), ...c.get(THIS, S.since), c.op(OP.SUBTRACT)],
                ),
                ...c.get(THIS, S.duration),
                c.op(OP.DIVIDE),
              ],
            ),
          ]),
        ),
        ...c.setState(THIS, {
          phase: RELOAD_PHASE.finish,
          since: r(NOW),
          elapsed: 0,
          from: r(FROM),
          progress: r(FROM),
        }),
        ...c.draw(THIS),
      ]),
    ]),
  ];
  return defineFunction2({
    params: [
      [RESERVE, "reserve"],
      [AMMO, "clip"],
      [SIZE, "size"],
    ],
    registers: 13,
    flags: METHOD_FLAGS,
    steps,
  });
}

/** Кадр клипа индикатора: `this` — клип, `this.h` — класс прицела. Время — по часам. */
function tickFunction(pool) {
  const c = reloadCoder(pool);
  const HUD = 2;
  const ELAPSED = 3;
  const NOW = 4;
  const LIMIT = 5;
  const TIME = 6;
  const e = [c.push(register(ELAPSED))];
  const now = [c.push(register(NOW))];
  const durationKnown = [
    ...c.get(HUD, S.duration),
    c.push(0),
    c.op(OP.GREATER),
  ];
  const phaseIs = (phase) => c.equals(c.get(HUD, S.phase), [c.push(phase)]);
  const notBelow = (limit) => [
    ...e,
    c.push(limit),
    c.op(OP.LESS2),
    c.op(AVM1.NOT),
  ];
  const done = [...c.draw(HUD), ...c.leave()];
  const steps = [
    ...c.store(HUD, c.get(THIS, "h")),
    ...c.when(phaseIs(RELOAD_PHASE.idle), [
      c.push(register(THIS), "onEnterFrame"),
      c.op(OP.DELETE),
      c.op(AVM1.POP),
      ...c.leave(),
    ]),
    ...c.store(NOW, c.now()),
    /* elapsed = max(0, now - since) */
    ...c.store(
      ELAPSED,
      c.math2(
        "max",
        [c.push(0)],
        [...now, ...c.get(HUD, S.since), c.op(OP.SUBTRACT)],
      ),
    ),
    ...c.when(phaseIs(RELOAD_PHASE.run), [
      /* Конца не дождались: elapsed > duration * 2 + TIMEOUT; без длительности — UNKNOWN_LIMIT. */
      ...c.store(LIMIT, [c.push(RELOAD_UNKNOWN_LIMIT_MS)]),
      ...c.when(
        durationKnown,
        c.store(LIMIT, [
          ...c.get(HUD, S.duration),
          c.push(2),
          c.op(OP.MULTIPLY),
          c.push(RELOAD_TIMEOUT_MS),
          c.op(OP.ADD2),
        ]),
      ),
      ...c.when(
        [...e, c.push(register(LIMIT)), c.op(OP.GREATER)],
        [
          ...c.setState(HUD, {
            phase: RELOAD_PHASE.fade,
            since: now,
            elapsed: 0,
          }),
          ...done,
        ],
      ),
      /* Доля по часам: min(CAP, elapsed / duration); без длительности — 0. */
      ...c.store(TIME, [c.push(0)]),
      ...c.when(
        durationKnown,
        c.store(
          TIME,
          c.math2(
            "min",
            [c.push(RELOAD_CAP)],
            [...e, ...c.get(HUD, S.duration), c.op(OP.DIVIDE)],
          ),
        ),
      ),
      ...c.setState(HUD, {
        elapsed: e,
        progress: c.math2("max", [c.push(register(TIME))], c.get(HUD, S.shell)),
      }),
      ...done,
    ]),
    /* Обойма полная раньше срока: по часам до конца длительности, потом удержание от её конца. */
    ...c.when(phaseIs(RELOAD_PHASE.full), [
      ...c.when(
        [...e, ...c.get(HUD, S.duration), c.op(OP.LESS2), c.op(AVM1.NOT)],
        [
          ...c.setState(HUD, {
            phase: RELOAD_PHASE.finish,
            since: [
              ...c.get(HUD, S.since),
              ...c.get(HUD, S.duration),
              c.op(OP.ADD2),
              c.push(RELOAD_FINISH_MS),
              c.op(OP.SUBTRACT),
            ],
            elapsed: 0,
            from: 1,
            progress: 1,
          }),
          ...done,
        ],
      ),
      ...c.setState(HUD, {
        elapsed: e,
        progress: c.math2(
          "max",
          [...e, ...c.get(HUD, S.duration), c.op(OP.DIVIDE)],
          c.get(HUD, S.shell),
        ),
      }),
      ...done,
    ]),
    ...c.when(phaseIs(RELOAD_PHASE.finish), [
      ...c.when(notBelow(RELOAD_FINISH_MS + RELOAD_HOLD_MS), [
        ...c.setState(HUD, {
          phase: RELOAD_PHASE.fade,
          since: now,
          elapsed: 0,
          progress: 1,
        }),
        ...done,
      ]),
      ...c.setState(HUD, { elapsed: e }),
      ...c.when(notBelow(RELOAD_FINISH_MS), [
        ...c.setState(HUD, { progress: 1 }),
        ...done,
      ]),
      /* from + ((1 - from) * elapsed) / FINISH */
      ...c.setState(HUD, {
        progress: [
          ...c.get(HUD, S.from),
          c.push(1),
          ...c.get(HUD, S.from),
          c.op(OP.SUBTRACT),
          ...e,
          c.op(OP.MULTIPLY),
          c.push(RELOAD_FINISH_MS),
          c.op(OP.DIVIDE),
          c.op(OP.ADD2),
        ],
      }),
      ...done,
    ]),
    /* Затухание. */
    ...c.when(notBelow(RELOAD_FADE_MS), [
      ...c.setState(HUD, {
        phase: RELOAD_PHASE.idle,
        elapsed: 0,
        progress: 0,
        from: 0,
        shell: 0,
      }),
      ...done,
    ]),
    ...c.setState(HUD, { elapsed: e }),
    ...done,
  ];
  return defineFunction2({ registers: 7, flags: METHOD_FLAGS, steps });
}

/** Конец конструктора `HUD_RETICLE`: связь с hud.gfx, состояние и функции. */
export function reloadConstructorCode(pool, config) {
  const c = reloadCoder(pool);
  const times = Object.entries(normalizeReloadTimes(config.times));
  return assembleActions([
    c.push("_global"),
    c.op(AVM1.GET_VARIABLE),
    c.push(RELOAD_HUD_GLOBAL, register(THIS)),
    c.op(AVM1.SET_MEMBER),
    /* Таблица длительностей из файлов игры: { "хеш без знака": мс }. */
    ...c.set(
      THIS,
      [TIMES],
      [
        ...times.map(([key, ms]) => c.push(key, ms)),
        c.push(times.length),
        c.op(AVM1.INIT_OBJECT),
      ],
    ),
    ...c.setState(THIS, {
      phase: RELOAD_PHASE.idle,
      since: 0,
      elapsed: 0,
      duration: 0,
      progress: 0,
      from: 0,
      shell: 0,
      weapon: null,
      clip: -1,
    }),
    ...c.set(THIS, ["astralReloadDraw"], [drawFunction(pool, config)]),
    ...c.set(THIS, ["astralReloadWeapon"], [weaponFunction(pool)]),
    ...c.set(THIS, ["astralReloadAmmo"], [ammoFunction(pool, config)]),
    ...c.set(THIS, ["astralReloadTick"], [tickFunction(pool)]),
  ]);
}
