import { MINIMAP_SCENE, MINIMAP_TWIPS } from "@modovik/minimap-contract";
import { bridgeCoder, BRIDGE_METHOD_FLAGS } from "./hp-bridge-code.js";
import { defineFunction2 } from "./minimap-gps-line.js";
import { prologueEdit } from "./hud-ammo-gfx-compiler.js";
import { MINIMAP_WIDE_SCENE_MARK } from "./minimap-film-damage.js";
import {
  AVM1,
  action,
  assertActionStream,
  findMethod,
  parseActions,
  pushAction,
  readProgram,
  readPush,
  register,
  rewriteActions,
} from "./scaleform-avm1.js";
import {
  SWF_TAG,
  parseSwfTags,
  readRect,
  scaleformHeaderLength,
  swfTag,
  uncompressedScaleform,
} from "./scaleform-swf.js";

/*
 * «HP отдельно от карты»: сцена штатного размера, расширение — масштабом и сдвигом корня (21.11.2026, проба hpwide7 на стенде).
 *
 * ЗАЧЕМ. Раньше сцена фильма росла (заголовок 191×136 → W×H), а записи `minimap` и `bigmap` frontend.xml росли вместе с ней, чтобы
 * прежний кусок сцены лёг на экран туда же (`widenMinimapScene`). Но игра вписывает ТУ ЖЕ сцену в запись `pausemap`, и при выросшей
 * сцене карта паузы пропадала целиком (стенд 21.11: hpwide, hpwide2, hpwide5pm; запись `pausemap` и масштаб корня не помогали —
 * мешал сам объявленный размер). Здесь заголовок остаётся штатным 191×136, а то, что делал рост сцены, делают масштаб и сдвиг корня:
 *   • в игре корень сжат (`_xscale = 191/W`, `_yscale = 136/H`, проценты) и сдвинут на расширение × тот же коэффициент — кадр тот же, что у
 *     выросшей сцены (записи `minimap` и `bigmap` растут, как прежде);
 *   • на карте паузы корень штатный (`_x = _y = 0`, масштаб 100), сцена штатная — карта паузы как в чистой игре (стенд 21.11:
 *     карта на месте, как у штатной сборки).
 * Переключает сторож (`pauseGuardStep`): таймер на экземпляре фильма раз в 100 мс смотрит, скрыт ли `asRootContainerBlips.asHealthContainer` — контейнер
 * здоровья, который движок прячет на карте паузы (стенд 21.11, hpwide7b: в игре он виден при любом отдалении радара, в интерьере, в машине; на паузе скрыт).
 * Ширина содержимого корня признаком не годится: при сильном отдалении радара она в игре такая же, как на паузе (≈ 750 против 790). Нужен только у работы,
 * где сцена выросла: у обычной карты файл прежний байт в байт.
 */

/** Контейнер здоровья, который движок прячет на карте паузы: `корень.asRootContainerBlips.asHealthContainer` (стенд 21.11: в игре виден во всех состояниях — зумы радара, интерьер; на паузе скрыт). */
export const PAUSE_HIDDEN_PATH = Object.freeze([
  "asRootContainerBlips",
  "asHealthContainer",
]);
/** Сколько тиков таймера подряд признак должен держаться (тик — 100 мс), чтобы корень переключился. */
export const PAUSE_TICKS = 2;
/** Период таймера сторожа, мс. */
export const PAUSE_TIMER_MS = 100;
const r4 = (value) => Math.round(value * 10000) / 10000;
const THIS = 1;
const REGISTERS = 8;
const OP = Object.freeze({
  ADD2: 0x47,
  DIVIDE: 0x0d,
  MULTIPLY: 0x0c,
  GREATER: 0x67,
  STRICT_EQUALS: 0x66,
  CALL_FUNCTION: 0x3d,
});

/**
 * Игровое и паузное состояние корня для расширения `extent` (точки с каждой стороны):
 * в игре `{ xs, ys, x, y }` (проценты и сдвиг в точках штатной сцены), в паузе — штатное.
 */
export function rootScaleStates(extent) {
  const x = Math.max(0, Math.round(Number(extent?.x) || 0));
  const y = Math.max(0, Math.round(Number(extent?.y) || 0));
  const width = MINIMAP_SCENE.width + 2 * x;
  const height = MINIMAP_SCENE.height + 2 * y;
  return {
    extent: { x, y },
    scene: { width, height },
    game: {
      xs: r4((MINIMAP_SCENE.width * 100) / width),
      ys: r4((MINIMAP_SCENE.height * 100) / height),
      x: r4((x * MINIMAP_SCENE.width) / width),
      y: r4((y * MINIMAP_SCENE.height) / height),
    },
    pause: { xs: 100, ys: 100, x: 0, y: 0 },
  };
}

const setThis = (name, value) =>
  Buffer.concat([
    pushAction(["this"]),
    action(AVM1.GET_VARIABLE),
    pushAction([name, value]),
    action(AVM1.SET_MEMBER),
  ]);

/**
 * Сцена штатная, расширение — игровое состояние корня в первом кадре: действие с меткой `astralWideScene` ставит `_xscale`, `_yscale`,
 * `_x`, `_y`. Без расширения — файл как был.
 */
export function rootScaleMinimapScene(buffer, extent) {
  const states = rootScaleStates(extent);
  if (!states.extent.x && !states.extent.y) return buffer;
  const headerLength = scaleformHeaderLength(buffer);
  const { rect } = readRect(buffer, 8);
  if (rect.xmin !== 0 || rect.ymin !== 0)
    throw new Error(
      "В minimap.gfx сцена начинается не с нуля — сжать корень нельзя.",
    );
  const tags = parseSwfTags(buffer, headerLength);
  const frameEnd = tags.findIndex((tag) => tag.code === SWF_TAG.SHOW_FRAME);
  if (frameEnd < 0)
    throw new Error("В minimap.gfx нет первого кадра — сжать корень нельзя.");
  const first =
    tags.slice(0, frameEnd).find((tag) => tag.code === SWF_TAG.DO_ACTION) ||
    tags[frameEnd];
  const { game } = states;
  const code = swfTag(
    SWF_TAG.DO_ACTION,
    Buffer.concat([
      setThis("_xscale", game.xs),
      setThis("_yscale", game.ys),
      setThis("_x", game.x),
      setThis("_y", game.y),
      setThis(MINIMAP_WIDE_SCENE_MARK, 1),
      action(AVM1.END),
    ]),
  );
  const result = Buffer.concat([
    buffer.subarray(0, first.offset),
    code,
    buffer.subarray(first.offset),
  ]);
  result.writeUInt32LE(result.length, 4);
  return result;
}

/**
 * Фильм работы «HP отдельно от карты» нынешней схемы: сцена штатная, первое действие кадра ставит `_xscale`, `_yscale`, `_x`, `_y` и метку.
 * Возвращает `{ scene: {width, height}, shift: {x, y} }` — расширение, которое он выражает, — или `null`.
 */
export function minimapRootScaleScene(bytes) {
  let buffer;
  let tags;
  try {
    buffer = uncompressedScaleform(bytes);
    const { rect } = readRect(buffer, 8);
    if (rect.xmin !== 0 || rect.ymin !== 0) return null;
    if (
      rect.xmax !== MINIMAP_SCENE.width * MINIMAP_TWIPS ||
      rect.ymax !== MINIMAP_SCENE.height * MINIMAP_TWIPS
    )
      return null;
    tags = parseSwfTags(buffer, scaleformHeaderLength(buffer));
  } catch {
    return null;
  }
  const frame = tags.findIndex((tag) => tag.code === SWF_TAG.SHOW_FRAME);
  if (frame < 0) return null;
  const hit = tags
    .slice(0, frame)
    .filter((tag) => tag.code === SWF_TAG.DO_ACTION)
    .find((tag) => {
      try {
        const records = parseActions(
          buffer,
          tag.payloadStart,
          tag.payloadStart + tag.length,
        );
        const names = [];
        for (
          let at = 0;
          records[at] && records[at].code !== AVM1.END;
          at += 4
        ) {
          const value = readPush(buffer, records[at + 2]);
          names.push(value[0]);
        }
        return (
          names.join(",") ===
          ["_xscale", "_yscale", "_x", "_y", MINIMAP_WIDE_SCENE_MARK].join(",")
        );
      } catch {
        return false;
      }
    });
  if (!hit) return null;
  const records = parseActions(
    buffer,
    hit.payloadStart,
    hit.payloadStart + hit.length,
  );
  const value = (at) => readPush(buffer, records[at * 4 + 2])[1];
  const xs = value(0);
  const ys = value(1);
  if (!(xs > 0 && xs <= 100 && ys > 0 && ys <= 100)) return null;
  const width = Math.round((MINIMAP_SCENE.width * 100) / xs);
  const height = Math.round((MINIMAP_SCENE.height * 100) / ys);
  return {
    scene: { width, height },
    shift: {
      x: Math.round((value(2) * width) / MINIMAP_SCENE.width),
      y: Math.round((value(3) * height) / MINIMAP_SCENE.height),
    },
  };
}

/**
 * Сторож карты паузы и развёрнутого радара: функция таймера экземпляра фильма (`this` — экземпляр, состояние в его полях, клипа и экспорта нет: на стенде 21.11
 * атрибуты клипа сторожа в отладочной сборке не читались, а таймер на экземпляре от клипов не зависит). Каждые 100 мс смотрит, скрыт ли
 * контейнер здоровья, который движок прячет на карте паузы (`PAUSE_HIDDEN_PATH`): скрыт `PAUSE_TICKS + 1` тиков подряд — корень в паузное
 * состояние, виден столько же — в игровое. Контейнера ещё нет — состояние не трогается. Поля: `astralMgLo`, `astralMgHi` (тики подряд скрыт / виден),
 * `astralMgPaused` (выбор), `astralMgN` (число тиков).
 *
 * Развёрнутый радар (`mapType` = 2, 21.11.2026): запись `bigmap` не растёт, и корень там штатный (как на паузе) — вид как у штатной игры, штатные полоски на месте, а группа HP за кадром
 * мини-карты в развёрнутом радаре не показывается (за сценой). Пока `mapType` = 2, признак паузы не считается; вышли из развёрнутого — корень снова игровой (`astralMgBig`).
 */
export function pauseGuardStep(pool, states) {
  const c = bridgeCoder(pool);
  const ROOT = 3;
  const HC = 4;
  const toState = (state) => [
    ...c.set(ROOT, ["_xscale"], [c.push(state.xs)]),
    ...c.set(ROOT, ["_yscale"], [c.push(state.ys)]),
    ...c.set(ROOT, ["_x"], [c.push(state.x)]),
    ...c.set(ROOT, ["_y"], [c.push(state.y)]),
  ];
  const count = (name) => [
    ...c.set(THIS, [name], [...c.get(THIS, name), c.push(1), c.op(OP.ADD2)]),
  ];
  const big = [...c.get(THIS, "mapType"), c.push(2), c.op(OP.STRICT_EQUALS)];
  const notBig = [...big, c.op(AVM1.NOT)];
  const steps = [
    ...c.set(
      THIS,
      ["astralMgN"],
      [...c.get(THIS, "astralMgN"), c.push(1), c.op(OP.ADD2)],
    ),
    ...c.store(ROOT, c.get(THIS, "TIMELINE")),
    ...c.store(HC, c.get(ROOT, ...PAUSE_HIDDEN_PATH)),
    /* Развёрнутый радар: корень штатный, пока он открыт. */
    ...c.when(big, [
      ...c.when(
        [...c.get(THIS, "astralMgBig"), c.op(AVM1.NOT)],
        [
          ...toState(states.pause),
          ...c.set(THIS, ["astralMgBig"], [c.push(true)]),
          ...c.set(THIS, ["astralMgPaused"], [c.push(true)]),
        ],
      ),
    ]),
    /* Вышли из развёрнутого радара: корень снова игровой, счёт тиков начинается заново. */
    ...c.when(
      notBig,
      c.when(
        [...c.get(THIS, "astralMgBig")],
        [
          ...toState(states.game),
          ...c.set(THIS, ["astralMgBig"], [c.push(false)]),
          ...c.set(THIS, ["astralMgPaused"], [c.push(false)]),
          ...c.set(THIS, ["astralMgLo"], [c.push(0)]),
          ...c.set(THIS, ["astralMgHi"], [c.push(0)]),
        ],
      ),
    ),
    ...c.when(
      notBig,
      c.when(
        [
          c.push(register(HC)),
          c.push(undefined),
          c.op(OP.STRICT_EQUALS),
          c.op(AVM1.NOT),
        ],
        [
          ...c.when(
            [...c.get(HC, "_visible"), c.op(AVM1.NOT)],
            [
              ...count("astralMgLo"),
              ...c.set(THIS, ["astralMgHi"], [c.push(0)]),
            ],
          ),
          ...c.when(
            [...c.get(HC, "_visible")],
            [
              ...count("astralMgHi"),
              ...c.set(THIS, ["astralMgLo"], [c.push(0)]),
            ],
          ),
          ...c.when(
            [
              ...c.get(THIS, "astralMgLo"),
              c.push(PAUSE_TICKS),
              c.op(OP.GREATER),
            ],
            c.when(
              [...c.get(THIS, "astralMgPaused"), c.op(AVM1.NOT)],
              [
                ...toState(states.pause),
                ...c.set(THIS, ["astralMgPaused"], [c.push(true)]),
              ],
            ),
          ),
          ...c.when(
            [
              ...c.get(THIS, "astralMgHi"),
              c.push(PAUSE_TICKS),
              c.op(OP.GREATER),
            ],
            c.when(
              [...c.get(THIS, "astralMgPaused")],
              [
                ...toState(states.game),
                ...c.set(THIS, ["astralMgPaused"], [c.push(false)]),
              ],
            ),
          ),
        ],
      ),
    ),
  ];
  return defineFunction2({
    registers: REGISTERS,
    flags: BRIDGE_METHOD_FLAGS,
    steps,
  });
}

/** Шаги в начале `INITIALISE`: поля сторожа и таймер на самом экземпляре (один раз). */
function guardBootSteps(pool, states) {
  const c = bridgeCoder(pool);
  return c.when(
    [...c.get(THIS, "astralMgStep"), c.push(undefined), c.op(OP.STRICT_EQUALS)],
    [
      ...c.set(THIS, ["astralMgN"], [c.push(0)]),
      ...c.set(THIS, ["astralMgLo"], [c.push(0)]),
      ...c.set(THIS, ["astralMgHi"], [c.push(0)]),
      ...c.set(THIS, ["astralMgPaused"], [c.push(false)]),
      ...c.set(THIS, ["astralMgBig"], [c.push(false)]),
      ...c.set(THIS, ["astralMgStep"], [pauseGuardStep(pool, states)]),
      /* setInterval(this, "astralMgStep", 100): функция вызывается как метод экземпляра. */
      c.push(PAUSE_TIMER_MS, "astralMgStep", register(THIS), 3, "setInterval"),
      c.op(OP.CALL_FUNCTION),
      c.op(AVM1.POP),
    ],
  );
}

/**
 * Фильм со сторожем карты паузы: в начале `INITIALISE` ставятся поля и таймер на экземпляре фильма (клипов и экспортов в библиотеке нет).
 * `classTag` — тег класса MINIMAP (`minimapClassTag` компилятора). Без расширения — файл как был.
 */
export function addPauseGuard(buffer, extent, { classTag }) {
  const states = rootScaleStates(extent);
  if (!states.extent.x && !states.extent.y) return buffer;
  const base = uncompressedScaleform(buffer);
  const tag = classTag(base);
  const program = readProgram(base, tag.payloadStart + 2, tag.end);
  assertActionStream(base, program.start, program.end);
  const method = findMethod(program, "INITIALISE");
  const edit = prologueEdit(
    base,
    program,
    { ...method, name: "INITIALISE" },
    guardBootSteps(program.pool, states),
  );
  const actions = rewriteActions(base, program.start, program.end, [edit], {
    internalBranches: true,
    internalFunctions: true,
  });
  const payload = Buffer.concat([
    base.subarray(tag.payloadStart, tag.payloadStart + 2),
    actions,
  ]);
  const result = Buffer.concat([
    base.subarray(0, tag.offset),
    swfTag(SWF_TAG.DO_INIT_ACTION, payload),
    base.subarray(tag.end),
  ]);
  result.writeUInt32LE(result.length, 4);
  return result;
}
