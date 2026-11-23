import { createHash } from "node:crypto";
import { bridgeTailCode, BRIDGE_PROP } from "./hp-bridge-code.js";
import {
  matchesExactly,
  minimapClassTag,
  valueTail,
} from "./minimap-gfx-compiler.js";
import {
  assertActionStream,
  findMethod,
  readProgram,
  rewriteActions,
} from "./scaleform-avm1.js";
import { SWF_TAG, swfTag, uncompressedScaleform } from "./scaleform-swf.js";

/*
 * `minimap.gfx` только с мостом HP и брони (`hp-bridge-code.js`): штатный файл радара
 * игрока, в котором у `SET_PLAYER_HEALTH` и `SET_PLAYER_ARMOUR` в конце, сразу за
 * `this.previous… = this.current…`, добавлен вызов писателя. Больше ничего не
 * меняется: ни полосы, ни цифры, ни сцена, ни кадр.
 *
 * Это тот самый хвост, к которому уже цепляются цифры, вылетающие числа и
 * значки-шкалы мини-карты (`patchMinimapActionScript`), поэтому место ищется тем же
 * образцом `valueTail` и ровно один раз в каждом методе.
 *
 * Мини-карта человека собирается своим компилятором; когда мост понадобится и в
 * ней, он подключится к её хвостам через `bridgeTailCode` (одна функция на обе
 * сборки), а этот файл нужен там, где работы мини-карты нет.
 */

const SIDES = Object.freeze([
  {
    method: "SET_PLAYER_HEALTH",
    previous: "previousHealthValue",
    value: "currentHealthValue",
    property: BRIDGE_PROP.health,
  },
  {
    method: "SET_PLAYER_ARMOUR",
    previous: "previousArmourValue",
    value: "currentArmourValue",
    property: BRIDGE_PROP.armour,
  },
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function compileMinimapBridge(baseBuffer) {
  if (!Buffer.isBuffer(baseBuffer))
    throw new TypeError("Base minimap GFX must be a Buffer.");
  const base = uncompressedScaleform(baseBuffer);
  const classTag = minimapClassTag(base);
  const program = readProgram(base, classTag.payloadStart + 2, classTag.end);
  assertActionStream(base, program.start, program.end);
  const edits = SIDES.map((side) => {
    const body = findMethod(program, side.method);
    const [tail] = matchesExactly(
      program,
      valueTail(side.previous, side.value),
      1,
      `конец ${side.method}`,
      {
        from: body.start,
        to: body.end,
      },
    );
    return {
      start: tail.first.offset,
      end: tail.last.end,
      replacement: Buffer.concat([
        base.subarray(tail.first.offset, tail.last.end),
        bridgeTailCode(program.pool, side),
      ]),
    };
  });
  const actions = rewriteActions(base, program.start, program.end, edits, {
    internalBranches: true,
    internalFunctions: true,
  });
  const payload = Buffer.concat([
    base.subarray(classTag.payloadStart, classTag.payloadStart + 2),
    actions,
  ]);
  const compiled = Buffer.concat([
    base.subarray(0, classTag.offset),
    swfTag(SWF_TAG.DO_INIT_ACTION, payload),
    base.subarray(classTag.end),
  ]);
  compiled.writeUInt32LE(compiled.length, 4);
  return {
    buffer: compiled,
    sha256: sha256(compiled),
    sides: SIDES.map((side) => side.method),
  };
}
