import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import {
  MAX_WEAPON_RETICLES,
  damageStyleTable,
  hexToRgb,
  normalizeDamageCounter,
  normalizeOrdinaryReticle,
  normalizeReloadIndicator,
  normalizeReloadTimes,
  normalizeReticleAnimation,
  normalizeSniperReticle,
  ordinaryReticleLayers,
  parseReticleStyleName,
  regionContours,
  reticleStyleHash,
  shimmerColourAt,
  shimmerFrameCount,
  sniperReticleLayers,
  storedOutline,
} from "@modovik/reticle-contract";
import {
  ANY,
  AVM1,
  action,
  assembleActions,
  assertActionStream,
  findMethod,
  findPattern,
  pushAction,
  readProgram,
  register,
  rewriteActions,
} from "./scaleform-avm1.js";
import { transplantKillMarkerGfx } from "./kill-marker-gfx.js";
import {
  HUD_GFX_TARGET,
  parameterRegisters,
  prologueEdit,
} from "./hud-ammo-gfx-compiler.js";
import { defineSpriteFrames, indexSwf, placeObject2, solidColor } from "./scaleform-swf.js";
import {
  DAMAGE_IDS,
  damageConstructorCode,
  damageCounterDefinitions,
  damageHitmarkerSteps,
  damageSniperSteps,
  damageWeaponCode,
} from "./reticle-damage-gfx.js";
import {
  RELOAD_IDS,
  reloadConstructorCode,
  reloadDefinitions,
} from "./reticle-reload-gfx.js";
import {
  HP_IDS,
  hpProbeConstructorCode,
  hpProbeDefinitions,
} from "./reticle-hp-gfx.js";

/*
 * База — hud_reticle.gfx из игры самого игрока, а не файл, приложенный к Astral.
 *
 * Раньше компилятор принимал одну копию (`runtime/gfx-inspection/combined.gfx`),
 * пришитую хешем, и правил в ней ActionScript точными байтами. Копия была
 * чужой сборкой: другой цвет по умолчанию, красные стили, оба снайпера на
 * одном кадре, Push по одному значению. В настоящем файле из update.rpf ни
 * одна «проверенная» последовательность не находилась, и прицел не собирался
 * вовсе. Теперь класс `HUD_RETICLE` читается как код (`scaleform-avm1.js`),
 * каждая правка ищет инструкцию по смыслу, а файл, где чего-то нет,
 * отвергается с объяснением — до записи в игру.
 *
 * Форма прицела — из `@modovik/reticle-contract`: те же фигуры рисует
 * редактор. В файл они уходят не набором многоугольников, а границей их
 * объединения (`regionContours`): у Scaleform перекрытие двух фигур одной
 * заливки вырезает дыру, и риски снайперки поверх линии выходили в игре с
 * тёмной серединой.
 */
export const RETICLE_GFX_ENTRY =
  "x64/data/cdimages/scaleform_generic.rpf/hud_reticle.gfx";
const GFX_TARGET = `update:/${RETICLE_GFX_ENTRY}`;
/* Словарь картинок прицела: в нём кадры знака на килле. */
export const RETICLE_YTD_ENTRY =
  "x64/data/cdimages/scaleform_generic.rpf/hud_reticle.ytd";
const YTD_TARGET = `update:/${RETICLE_YTD_ENTRY}`;
const ORDINARY_LABELS = new Set([
  "WEAPON_THROWN",
  "WEAPON_PISTOL",
  "WEAPONTYPE_SMG",
  "WEAPONTYPE_RIFLE",
  "WEAPONTYPE_SHOTGUN",
  "SIMPLE_RETICLE",
  "SIMPLE_MP_RETICLE",
]);
const IDS = Object.freeze({
  ordinaryOutline: 64990,
  ordinaryFill: 64991,
  ordinarySprite: 64992,
  sniperGlow: 64993,
  sniperFill: 64994,
  sniperSprite: 64995,
  sniperCentre: 64996,
  emptySprite: 64999,
});
/*
 * Рисунки стволов (задача 4 ТЗ 07.10.2026): у рисунка номер k обводка
 * 64770 + 2k и заливка 64771 + 2k — от 64772 до 64899, под семейством знака
 * на килле (64900…64989, `kill-marker-gfx.js`) и прицелом (64990…64999).
 */
const WEAPON_SHAPES = Object.freeze({ first: 64772, last: 64899 });
const weaponShapeIds = (slot) => ({
  outline: WEAPON_SHAPES.first - 2 + 2 * slot,
  fill: WEAPON_SHAPES.first - 1 + 2 * slot,
});

/*
 * Клипы перелива (10.11.2026, `reticle-contract/animation.js`): у каждого рисунка обычного прицела свой (основной — 64600, рисунок ствола номер k — 64600 + k),
 * у снайперки 64690. Свободный участок под знаком урона (64750…64771) и рисунками стволов (64772…64899).
 */
const SHIMMER_IDS = Object.freeze({ first: 64600, last: 64699, sniper: 64690 });
const shimmerSpriteId = (look) => SHIMMER_IDS.first + look;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const alphaByte = (percent) =>
  Math.round(Math.max(0, Math.min(100, Number(percent) || 0)) * 2.55);

/*
 * Свои рисунки стволов — как их собрала установка (`reticle-weapons.js`):
 * `[{ config, bindings: [{ weapon, name }] }]`, где номер рисунка — место в
 * списке, а `name` — имя стиля ствола в weapons.meta с тем же номером
 * (`ASTRAL_RETICLE_<номер>__<штатный стиль>`). Рисунок без стволов и ствол с
 * чужим номером — ошибка сборки, а не молча пропущенный прицел.
 */
function normalizeWeaponStyles(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input))
    throw new TypeError("Прицелы стволов должны быть списком.");
  if (input.length > MAX_WEAPON_RETICLES)
    throw new RangeError(
      `Своих прицелов у стволов больше ${MAX_WEAPON_RETICLES}.`,
    );
  const seen = new Set();
  return input.map((style, index) => {
    const slot = index + 1;
    const bindings = Array.isArray(style?.bindings) ? style.bindings : [];
    if (!bindings.length)
      throw new Error(`У прицела номер ${slot} нет ни одного ствола.`);
    return {
      config: normalizeOrdinaryReticle(
        style?.config && typeof style.config === "object" ? style.config : {},
      ),
      bindings: bindings.map((binding) => {
        const parsed = parseReticleStyleName(binding?.name);
        if (!parsed || parsed.slot !== slot)
          throw new Error(
            `Имя стиля ${binding?.name} не подходит прицелу номер ${slot}.`,
          );
        const name = String(binding.name).toUpperCase();
        if (seen.has(name))
          throw new Error(`Имя стиля ${name} встречается дважды.`);
        seen.add(name);
        return {
          weapon: String(binding.weapon || ""),
          name,
          original: parsed.original,
          hash: reticleStyleHash(name),
        };
      }),
    };
  });
}

/*
 * Урон стволов для счётчика (`reticle-weapons.js`): `own` — стволы со своим
 * именем стиля (`{ name, value, alias }`, `alias` — штатный стиль ствола без
 * своего рисунка), `styles` и `fallback` — значения для остальных хешей. Без
 * плана (проверка базы, сборка без игры) — значения по штатным стилям.
 */
function normalizeDamageTable(counter, input) {
  const stock = damageStyleTable(counter);
  const own = Array.isArray(input?.own) ? input.own : [];
  return {
    own: own.map((item) => ({
      hash: reticleStyleHash(String(item.name).toUpperCase()),
      value: Number(item.value) || 0,
      alias: item.alias ? String(item.alias) : null,
    })),
    styles: Array.isArray(input?.styles) ? input.styles : stock.styles,
    fallback: Number(input?.fallback) || stock.fallback,
  };
}

/**
 * Настройки прицела в границах контракта: те же значения, что видит
 * редактор (цвета строкой, размеры в точках сцены).
 */
export function normalizeReticleConfiguration(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const damage = normalizeDamageCounter(source.damage);
  return {
    ordinary: normalizeOrdinaryReticle(
      source.ordinary && typeof source.ordinary === "object"
        ? source.ordinary
        : {},
    ),
    sniper: normalizeSniperReticle(
      source.sniper && typeof source.sniper === "object" ? source.sniper : {},
    ),
    weaponStyles: normalizeWeaponStyles(source.weaponStyles),
    damage,
    damageTable: damage.enabled
      ? normalizeDamageTable(damage, source.damageTable)
      : null,
    /* Анимация прицела (10.11.2026, `reticle-contract/animation.js`): без поля — всё выключено, прицел собирается как раньше. */
    animation: normalizeReticleAnimation(source.animation),
    /* Индикатор перезарядки (14.11.2026, `reticle-contract/reload.js`): выключен — файл байт в байт прежний. */
    reload: normalizeReloadIndicator(source.reload),
    /* Длительности перезарядки стволов из файлов игры (`reticle-reload-files.js`): { хеш без знака: мс }. */
    reloadTimes: normalizeReloadTimes(source.reloadTimes),
    /* Проба моста HP радар → прицел (21.11.2026, `reticle-hp-gfx.js`): только для пробного листа, не из окна; без поля — файл байт в байт прежний. */
    hpProbe: source.hpProbe === true,
  };
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.current = 0;
    this.used = 0;
  }
  write(value, bits) {
    let next = BigInt(value);
    if (next < 0n) next = (1n << BigInt(bits)) + next;
    for (let index = bits - 1; index >= 0; index -= 1) {
      this.current = (this.current << 1) | Number((next >> BigInt(index)) & 1n);
      this.used += 1;
      if (this.used === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.used = 0;
      }
    }
  }
  finish() {
    if (this.used) this.bytes.push(this.current << (8 - this.used));
    return Buffer.from(this.bytes);
  }
}

const signedBits = (value) => {
  const number = Math.trunc(value);
  for (let bits = 2; bits <= 31; bits += 1) {
    if (number >= -(2 ** (bits - 1)) && number < 2 ** (bits - 1)) return bits;
  }
  return 31;
};

function rectBuffer({ xmin, xmax, ymin, ymax }) {
  const bits = Math.max(
    signedBits(xmin),
    signedBits(xmax),
    signedBits(ymin),
    signedBits(ymax),
  );
  const writer = new BitWriter();
  writer.write(bits, 5);
  writer.write(xmin, bits);
  writer.write(xmax, bits);
  writer.write(ymin, bits);
  writer.write(ymax, bits);
  return writer.finish();
}

function matrixBuffer() {
  const writer = new BitWriter();
  writer.write(0, 1);
  writer.write(0, 1);
  writer.write(0, 5);
  return writer.finish();
}

function tag(code, payload, forceLong = true) {
  if (!forceLong && payload.length < 63) {
    const header = Buffer.alloc(2);
    header.writeUInt16LE((code << 6) | payload.length);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE((code << 6) | 63);
  header.writeUInt32LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function parseTags(buffer, start = 0, end = buffer.length) {
  const result = [];
  let offset = start;
  while (offset + 2 <= end) {
    const raw = buffer.readUInt16LE(offset);
    const code = raw >> 6;
    let length = raw & 63;
    let headerLength = 2;
    if (length === 63) {
      if (offset + 6 > end) throw new Error("Truncated long GFX tag header.");
      length = buffer.readUInt32LE(offset + 2);
      headerLength = 6;
    }
    const payloadStart = offset + headerLength;
    const next = payloadStart + length;
    if (next > end) throw new Error("Truncated GFX tag payload.");
    result.push({
      code,
      offset,
      headerLength,
      payloadStart,
      length,
      end: next,
      raw: buffer.subarray(offset, next),
    });
    offset = next;
    if (code === 0) break;
  }
  return result;
}

function frameLabel(payload) {
  const end = payload.indexOf(0);
  return end < 0 ? "" : payload.subarray(0, end).toString("utf8");
}

/*
 * Контуры — уже в твипах и уже без перекрытий: закрашенное справа по ходу,
 * как у фигур самого Rockstar (`fillStyle1`). Стиль заливки назначается
 * первой записи и дальше не меняется; каждый контур начинается переходом и
 * замыкается ребром в свою первую точку.
 */
function shapeRecords(contours) {
  const writer = new BitWriter();
  writer.write(1, 4);
  writer.write(0, 4);
  let hasFill = false;
  for (const points of contours) {
    if (points.length < 3) continue;
    const [firstX, firstY] = points[0];
    const moveBits = Math.max(signedBits(firstX), signedBits(firstY));
    writer.write(0, 1);
    writer.write(0, 1);
    writer.write(0, 1);
    writer.write(hasFill ? 0 : 1, 1);
    writer.write(0, 1);
    writer.write(1, 1);
    writer.write(moveBits, 5);
    writer.write(firstX, moveBits);
    writer.write(firstY, moveBits);
    if (!hasFill) {
      writer.write(1, 1);
      hasFill = true;
    }
    let previous = points[0];
    for (const point of [...points.slice(1), points[0]]) {
      const dx = point[0] - previous[0];
      const dy = point[1] - previous[1];
      if (dx === 0 && dy === 0) continue;
      const bits = Math.max(2, signedBits(dx), signedBits(dy));
      writer.write(1, 1);
      writer.write(1, 1);
      writer.write(bits - 2, 4);
      writer.write(1, 1);
      writer.write(dx, bits);
      writer.write(dy, bits);
      previous = point;
    }
  }
  writer.write(0, 6);
  return writer.finish();
}

function shapeTag(id, contours, rgba) {
  const points = contours.flat();
  const bounds = points.length
    ? {
        xmin: Math.min(...points.map(([x]) => x)),
        xmax: Math.max(...points.map(([x]) => x)),
        ymin: Math.min(...points.map(([, y]) => y)),
        ymax: Math.max(...points.map(([, y]) => y)),
      }
    : { xmin: 0, xmax: 0, ymin: 0, ymax: 0 };
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const styles = Buffer.from([1, 0, ...rgba, 0]);
  return tag(
    32,
    Buffer.concat([
      idBuffer,
      rectBuffer(bounds),
      styles,
      shapeRecords(contours),
    ]),
  );
}

function placeObject(characterId, depth, name = null, ratio = null) {
  const hasName = Boolean(name);
  const hasRatio = Number.isInteger(ratio);
  const flags = 0x02 | 0x04 | (hasName ? 0x20 : 0) | (hasRatio ? 0x10 : 0);
  const fixed = Buffer.alloc(5);
  fixed[0] = flags;
  fixed.writeUInt16LE(depth, 1);
  fixed.writeUInt16LE(characterId, 3);
  const chunks = [fixed, matrixBuffer()];
  if (hasRatio) {
    const value = Buffer.alloc(2);
    value.writeUInt16LE(ratio);
    chunks.push(value);
  }
  if (hasName) chunks.push(Buffer.from(`${name}\0`, "utf8"));
  return tag(26, Buffer.concat(chunks));
}

function spriteTag(id, shapeIds = [], frameCount = 1) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id);
  header.writeUInt16LE(frameCount, 2);
  const children = shapeIds.map((shapeId, index) =>
    placeObject(shapeId, index + 1),
  );
  for (let index = 0; index < frameCount; index += 1)
    children.push(tag(1, Buffer.alloc(0), false));
  children.push(tag(0, Buffer.alloc(0), false));
  return tag(39, Buffer.concat([header, ...children]));
}

/*
 * Клип обычного прицела с рисунками стволов: по два кадра на рисунок.
 *
 * Два — потому что так устроен штатный `reticle`: игра сама переключает его
 * `gotoAndStop(1)` и `gotoAndStop(2)` при смене цели. Рисунок номер k живёт
 * в кадрах 2k + 1 и 2k + 2, общий — в первых двух, и ActionScript прибавляет
 * к номеру кадра игры смещение взятого рисунка (`astralBase`). Каждый
 * рисунок снимает предыдущий: переход вперёд проигрывает кадры подряд, назад
 * — собирает с первого, и в обоих случаях на клипе ровно один рисунок.
 *
 * Без рисунков стволов клип байт в байт тот, что был: фигуры и два кадра.
 */
function ordinaryReticleSprite(id, looks) {
  /* Рисунок — список фигур либо `{ idle, target }`: при переливе в первом кадре клип перелива, во втором (враг, союзник, захват) обычная заливка. */
  const framesOf = (look) => (Array.isArray(look) ? { idle: look, target: look } : look);
  const same = (look) => framesOf(look).idle.join() === framesOf(look).target.join();
  if (!looks.every(same)) return shimmerReticleSprite(id, looks.map(framesOf));
  looks = looks.map((look) => framesOf(look).idle);
  if (looks.length === 1) return spriteTag(id, looks[0], 2);
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id);
  header.writeUInt16LE(looks.length * 2, 2);
  const children = [];
  let previous = [];
  for (const shapeIds of looks) {
    for (let depth = 1; depth <= previous.length; depth += 1)
      children.push(tag(28, Buffer.from([depth & 0xff, depth >> 8]), false));
    shapeIds.forEach((shapeId, index) =>
      children.push(placeObject(shapeId, index + 1)),
    );
    children.push(tag(1, Buffer.alloc(0), false), tag(1, Buffer.alloc(0), false));
    previous = shapeIds;
  }
  children.push(tag(0, Buffer.alloc(0), false));
  return tag(39, Buffer.concat([header, ...children]));
}

/**
 * Клип обычного прицела, когда у рисунков есть перелив: по два кадра на рисунок, как у `ordinaryReticleSprite`, но во втором кадре заливка меняется со
 * зацикленного клипа перелива на обычную белую фигуру (игра ставит этот кадр врагу, союзнику и захвату, и цвет там задаёт она).
 * Переход между кадрами снимает и ставит только то, что различается.
 */
function shimmerReticleSprite(id, looks) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id);
  header.writeUInt16LE(looks.length * 2, 2);
  const remove = (depth) => tag(28, Buffer.from([depth & 0xff, depth >> 8]), false);
  const show = () => tag(1, Buffer.alloc(0), false);
  const children = [];
  let shown = [];
  for (const look of looks) {
    for (let depth = 1; depth <= shown.length; depth += 1) children.push(remove(depth));
    look.idle.forEach((shapeId, index) => children.push(placeObject(shapeId, index + 1)));
    children.push(show());
    look.target.forEach((shapeId, index) => {
      if (look.idle[index] === shapeId) return;
      children.push(remove(index + 1), placeObject(shapeId, index + 1));
    });
    children.push(show());
    shown = look.target;
  }
  children.push(tag(0, Buffer.alloc(0), false));
  return tag(39, Buffer.concat([header, ...children]));
}

/**
 * Клип перелива: зацикленный спрайт из кадров, в каждом то же белое поле `shapeId` со сплошным цветом (`cxform`: множители цвета 0, прибавка — цвет кадра,
 * альфа фигуры сохраняется). Цвета и число кадров — из контракта (`shimmerColourAt`, `shimmerFrameCount`), та же арифметика, что в предпросмотре окна.
 */
function shimmerSpriteTag(id, shapeId, colours, seconds) {
  const count = shimmerFrameCount(seconds);
  const frames = Array.from({ length: count }, (_unused, at) => {
    const cxform = solidColor(shimmerColourAt(colours, at / count));
    return [placeObject2(at === 0 ? { depth: 1, characterId: shapeId, cxform } : { depth: 1, move: true, cxform })];
  });
  return defineSpriteFrames(id, frames);
}

/*
 * Формы прицела.
 *
 * Обычный прицел: заливка белая — игра красит её `Colourise` в выбранный
 * цвет, — обводка лежит сдвинутой (`storedOutline`), чтобы после того же
 * сдвига встать своим цветом. Под непрозрачной заливкой обводка лежит
 * целиком (без просвета на стыке), под полупрозрачной — только вокруг неё.
 *
 * Снайперка: игра её не перекрашивает, цвета лежат как есть. Сетка, центр
 * своим цветом (если он задан) и обводка под ними.
 */
/* Фигуры одного рисунка обычного прицела: обводка (если есть) и заливка. */
function ordinaryShapes(config, ids, shimmer = null) {
  const ordinary = ordinaryReticleLayers(config);
  const oc = ordinary.config;
  const fill = regionContours(ordinary.fill);
  const outline = regionContours(
    ordinary.outline,
    ordinary.outlineUnder ? [] : ordinary.fill,
  );
  const ordinaryAlpha = alphaByte(oc.opacity);
  const outlineAlpha = alphaByte((oc.opacity * oc.outlineOpacity) / 100);
  /* Перелив: игра красит клип белым, пока цели нет, поэтому обводка лежит без сдвига; заливка — клип перелива (первый кадр) либо белая фигура (кадр цели). */
  const outlineBase = shimmer ? "#ffffff" : oc.color;
  const outlinePlaced = outline.length ? [ids.outline] : [];
  return {
    tags: [
      ...(outline.length
        ? [
            shapeTag(ids.outline, outline, [
              ...storedOutline(oc.outlineColor, outlineBase),
              outlineAlpha,
            ]),
          ]
        : []),
      shapeTag(ids.fill, fill, [255, 255, 255, ordinaryAlpha]),
      ...(shimmer ? [shimmerSpriteTag(shimmer.id, ids.fill, shimmer.colours, shimmer.seconds)] : []),
    ],
    placed: shimmer
      ? { idle: [...outlinePlaced, shimmer.id], target: [...outlinePlaced, ids.fill] }
      : [...outlinePlaced, ids.fill],
  };
}

function customDefinitions(configuration) {
  const { animation } = configuration;
  const shimmerOf = (look) =>
    animation.shimmer
      ? { id: shimmerSpriteId(look), colours: animation.shimmerColours, seconds: animation.shimmerSeconds }
      : null;
  const looks = [
    ordinaryShapes(
      configuration.ordinary,
      {
        outline: IDS.ordinaryOutline,
        fill: IDS.ordinaryFill,
      },
      shimmerOf(0),
    ),
    ...configuration.weaponStyles.map((style, index) =>
      ordinaryShapes(style.config, weaponShapeIds(index + 1), shimmerOf(index + 1)),
    ),
  ];

  const sniper = sniperReticleLayers(configuration.sniper);
  const sc = sniper.config;
  const opaque = sc.opacity >= 100;
  const lines = regionContours(sniper.lines, opaque ? [] : sniper.centre);
  const centre = regionContours(sniper.centre);
  const glow = regionContours(
    sniper.glow,
    sniper.glowUnder ? [] : [...sniper.lines, ...sniper.centre],
  );
  const sniperAlpha = alphaByte(sc.opacity);
  const glowAlpha = alphaByte((sc.opacity * sc.glowOpacity) / 100);

  return [
    ...looks.flatMap((look) => look.tags),
    ordinaryReticleSprite(
      IDS.ordinarySprite,
      looks.map((look) => look.placed),
    ),
    ...(glow.length
      ? [shapeTag(IDS.sniperGlow, glow, [...hexToRgb(sc.glowColor), glowAlpha])]
      : []),
    shapeTag(IDS.sniperFill, lines, [...hexToRgb(sc.reticle), sniperAlpha]),
    /* Снайперку игра не красит, перелив тут без сдвигов: клип поверх сетки меняет её цвет целиком. */
    ...(animation.shimmer
      ? [shimmerSpriteTag(SHIMMER_IDS.sniper, IDS.sniperFill, animation.shimmerColours, animation.shimmerSeconds)]
      : []),
    ...(centre.length
      ? [
          shapeTag(IDS.sniperCentre, centre, [
            ...hexToRgb(sc.centerColor),
            sniperAlpha,
          ]),
        ]
      : []),
    spriteTag(IDS.sniperSprite, [
      ...(glow.length ? [IDS.sniperGlow] : []),
      animation.shimmer ? SHIMMER_IDS.sniper : IDS.sniperFill,
      ...(centre.length ? [IDS.sniperCentre] : []),
    ]),
    spriteTag(IDS.emptySprite),
  ];
}

/*
 * ActionScript прицела: что меняется и где это лежит в классе `HUD_RETICLE`.
 *
 * Цвет. Прицел красит `com.rockstargames.ui.utils.Colour.Colourise(mc, r, g,
 * b, a)` — ColorTransform со сдвигом (r − 255, g − 255, b − 255), поэтому
 * белая форма становится ровно этим цветом. Цвета записаны в классе числами:
 *
 *   - конструктор: `DEFAULT_COLOUR = [225, 225, 225, 100]` — им
 *     `STOP_FLASHING_RETICLE` красит прицел, пока игра не сообщила о цели;
 *   - `SET_RETICLE_LOCKON_TYPE`: в каждой из пяти веток `DEFAULT_COLOUR =
 *     [255, 255, 255, 100]`; «нет цели» (−1 и 3) — `Colourise(…, 255, 255,
 *     255, 100)`; захват (1) — мигание `START_FLASHING_RETICLE([255, 142,
 *     60, 100])` и `Colourise(…, 255, 142, 60, 100)`; враг (2) —
 *     `Colourise(…, 255, 28, 33, 100)`.
 *
 * Основной цвет встаёт вместо белого и серого, «цвет цели» — вместо
 * оранжевого и красного. Светло-зелёный цвет союзника (0) и стили
 * `SET_RETICLE_STYLE` остаются игре: в редакторе их нет, и перекрасить их
 * наугад значило бы разойтись с предпросмотром.
 *
 * Прозрачность в ActionScript не пишется. `_alpha` прицела перезаписывают
 * `START_DIM_RETICLE`, `RESET_RETICLE` и `SHOW_FRIENDLY_FIRE`, и число,
 * положенное туда, пропало бы при первом же затухании. Она живёт в самих
 * формах (альфа заливки и обводки), а `_alpha` остаётся долей, которую
 * задала игра: затухший прицел — это доля от выбранной прозрачности.
 *
 * Новый экземпляр. `SET_RETICLE_TYPE` красит старый прицел
 * (`STOP_FLASHING_RETICLE`) и только потом `reticleMC.gotoAndStop(кадр)`
 * ставит новый — без цвета. Штатный прицел белый, и этого не видно; свой
 * цветной до первого сообщения о цели был бы белым. Поэтому сразу за сменой
 * кадра вызывается тот же `STOP_FLASHING_RETICLE()`: он красит текущий
 * прицел в `DEFAULT_COLOUR` и снимает твин с `CONTENT`, уже снятый строкой
 * выше.
 *
 * Затухание. `START_DIM_RETICLE(params)` для не снайперского оружия пишет
 * `var a = params[0]; this.reticleMC.reticle._alpha = a;`:
 *
 *   - «Не затухает» — `a = 100` вместо `params[0]`;
 *   - «Своя задержка» — присваивание заменено ветвлением принятого ранее
 *     шаблона: темнее — `TweenStarLite.to(reticle, 0.01, {_alpha: a, delay:
 *     N})`, светлее — сразу и со снятием отложенного. `RESET_RETICLE` и
 *     `SET_RETICLE_VISIBLE(false)` отложенное затухание снимают, чтобы
 *     прицел не погас уже после сброса или скрытия.
 *
 * Рисунки стволов (задача 4 ТЗ 07.10.2026; имена стилей —
 * `@modovik/reticle-contract/weapons.js`). Ствол со своим прицелом приходит
 * в `SET_RETICLE_TYPE` своим хешем. Сразу за `this.weaponID = params[0]`
 * встаёт выбор:
 *
 *   this.astralBase = 0; this.astralPlain = [общий]; this.astralTarget = […];
 *   this.DEFAULT_COLOUR = [общий, 100];
 *   if (this.weaponID === хеш ствола) {
 *     this.weaponID = this.<штатный стиль>;   // дальше — как штатный ствол
 *     this.astralBase = 2k; …цвета рисунка k…
 *   } …
 *
 * Дальше метод идёт штатно: стиль ведёт к своему кадру таймлайна, разбросу и
 * прочей логике игры. После смены кадра клип `reticle` — наш, с рисунками
 * (`ordinaryReticleSprite`) — переходит на кадр `astralBase + 1`, а пять
 * `reticle.gotoAndStop(1 | 2)` в `SET_RETICLE_LOCKON_TYPE` получают то же
 * смещение. Цвета «без цели» и «на цели» читаются не числами, а из
 * `astralPlain` и `astralTarget`: у каждого рисунка свои. Конструктор
 * задаёт их общими — до первого `SET_RETICLE_TYPE` прицел такой, как был.
 *
 * Видимость и отметка попадания — общие: их держит таймлайн и методы игры,
 * а не рисунок.
 *
 * Каждое место обязано найтись ровно столько раз, сколько описано, и ищутся
 * все места при любых настройках: проверка базы (сборка по умолчанию) так
 * проверяет и то, что понадобится только «своей задержке» и стволам.
 */
const COLOURS = Object.freeze({
  initial: [225, 225, 225],
  plain: [255, 255, 255],
  lockOn: [255, 142, 60],
  enemy: [255, 28, 33],
});

/* InitArray берёт элементы с конца стека: [r, g, b, a] — это Push a, b, g, r, 4. */
const arrayValues = ([red, green, blue]) => [100, blue, green, red, 4];
const colouriseValues = ([red, green, blue]) => [
  100,
  blue,
  green,
  red,
  register(1),
  "reticleMC",
];

const defaultColourAssignment = (rgb) => [
  [AVM1.PUSH, [register(1), "DEFAULT_COLOUR", ...arrayValues(rgb)]],
  AVM1.INIT_ARRAY,
  AVM1.SET_MEMBER,
];

const colouriseReticle = (rgb) => [
  [AVM1.PUSH, colouriseValues(rgb)],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["reticle"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [5, "com"]],
  AVM1.GET_VARIABLE,
  [AVM1.PUSH, ["rockstargames"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["ui"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["utils"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["Colour"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["Colourise"]],
  AVM1.CALL_METHOD,
  AVM1.POP,
];

const LOCK_ON_FLASH = [
  [AVM1.PUSH, arrayValues(COLOURS.lockOn)],
  AVM1.INIT_ARRAY,
  [AVM1.PUSH, [1, register(1), "START_FLASHING_RETICLE"]],
  AVM1.CALL_METHOD,
  AVM1.POP,
];

const RETICLE_FRAME_CHANGE = [
  [AVM1.PUSH, [ANY, 1, register(1), "reticleMC"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["gotoAndStop"]],
  AVM1.CALL_METHOD,
  AVM1.POP,
];

/* this.weaponID = params[0]; — первая строка выбора стиля. */
const WEAPON_ID_ASSIGNMENT = [
  [AVM1.PUSH, [register(1), "weaponID", ANY, 0]],
  AVM1.GET_MEMBER,
  AVM1.SET_MEMBER,
];

/* this.reticleMC.reticle.gotoAndStop(1 | 2); — смена цели. */
const RETICLE_INNER_FRAME = [
  [AVM1.PUSH, [ANY, 1, register(1), "reticleMC"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["reticle"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["gotoAndStop"]],
  AVM1.CALL_METHOD,
  AVM1.POP,
];

const STRICT_EQUALS = 0x66;
const ADD2 = 0x47;

/** `this.<член>[2], [1], [0]` — синий, зелёный, красный в стек. */
const memberChannels = (pool, member) =>
  [2, 1, 0].flatMap((channel) => [
    pushAction([register(1), member], pool),
    action(AVM1.GET_MEMBER),
    pushAction([channel], pool),
    action(AVM1.GET_MEMBER),
  ]);

/** Push с цветом из члена класса вместо трёх чисел посередине. */
const memberColourPush = (pool, leading, member, trailing) =>
  Buffer.concat([
    pushAction(leading, pool),
    ...memberChannels(pool, member),
    pushAction(trailing, pool),
  ]);

/**
 * `this.astralBase = смещение; this.astralPlain = [r, g, b];
 * this.astralTarget = […]; this.DEFAULT_COLOUR = [r, g, b, 100];` —
 * рисунок, который сейчас на стволе.
 */
function chooseLook(pool, look, withDefault = true) {
  const [red, green, blue] = look.color;
  const [targetRed, targetGreen, targetBlue] = look.targetColor;
  return Buffer.concat([
    pushAction([register(1), "astralBase", look.base], pool),
    action(AVM1.SET_MEMBER),
    pushAction([register(1), "astralPlain", blue, green, red, 3], pool),
    action(AVM1.INIT_ARRAY),
    action(AVM1.SET_MEMBER),
    pushAction(
      [register(1), "astralTarget", targetBlue, targetGreen, targetRed, 3],
      pool,
    ),
    action(AVM1.INIT_ARRAY),
    action(AVM1.SET_MEMBER),
    ...(withDefault
      ? [
          pushAction(
            [register(1), "DEFAULT_COLOUR", ...arrayValues(look.color)],
            pool,
          ),
          action(AVM1.INIT_ARRAY),
          action(AVM1.SET_MEMBER),
        ]
      : []),
  ]);
}

/**
 * Выбор рисунка по хешу ствола — за `this.weaponID = params[0]`. Ствол со
 * своим рисунком дальше идёт штатным стилем: `this.weaponID =
 * this.<стиль>`, и switch метода ведёт его к своему кадру.
 */
function chooseWeaponLook(pool, shared, looks, before = Buffer.alloc(0)) {
  const steps = [action(AVM1.SET_MEMBER), before, chooseLook(pool, shared)];
  let next = 0;
  for (const look of looks)
    for (const binding of look.bindings) {
      next += 1;
      steps.push(
        pushAction([register(1), "weaponID"], pool),
        action(AVM1.GET_MEMBER),
        pushAction([binding.hash], pool),
        action(STRICT_EQUALS),
        action(AVM1.NOT),
        { branch: AVM1.IF, to: `other-${next}` },
        pushAction(
          [register(1), "weaponID", register(1), binding.original],
          pool,
        ),
        action(AVM1.GET_MEMBER),
        action(AVM1.SET_MEMBER),
        chooseLook(pool, look),
        { branch: AVM1.JUMP, to: "chosen" },
        { label: `other-${next}` },
      );
    }
  steps.push({ label: "chosen" });
  return assembleActions(steps);
}

/**
 * После смены кадра: если `reticle` — наш клип с рисунками (кадров ровно
 * столько, сколько у него), он переходит на кадр взятого рисунка.
 */
function showWeaponLook(pool, frames) {
  return assembleActions([
    pushAction([register(1), "reticleMC"], pool),
    action(AVM1.GET_MEMBER),
    pushAction(["reticle"], pool),
    action(AVM1.GET_MEMBER),
    pushAction(["_totalframes"], pool),
    action(AVM1.GET_MEMBER),
    pushAction([frames], pool),
    action(STRICT_EQUALS),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: "other" },
    pushAction([1, register(1), "astralBase"], pool),
    action(AVM1.GET_MEMBER),
    action(ADD2),
    pushAction([1, register(1), "reticleMC"], pool),
    action(AVM1.GET_MEMBER),
    pushAction(["reticle"], pool),
    action(AVM1.GET_MEMBER),
    pushAction(["gotoAndStop"], pool),
    action(AVM1.CALL_METHOD),
    action(AVM1.POP),
    { label: "other" },
  ]);
}

/* var a = params[0]; this.reticleMC.reticle._alpha = a; */
const DIM_ALPHA = [
  [AVM1.PUSH, [ANY, 0]],
  AVM1.GET_MEMBER,
  AVM1.STORE_REGISTER,
  AVM1.POP,
  [AVM1.PUSH, [register(1), "reticleMC"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["reticle"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["_alpha", ANY]],
  AVM1.SET_MEMBER,
];

/* this.reticleMC.reticle._alpha = this.DEFAULT_COLOUR[3]; */
const RESET_ALPHA = [
  [AVM1.PUSH, [register(1), "reticleMC"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["reticle"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["_alpha", register(1), "DEFAULT_COLOUR"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [3]],
  AVM1.GET_MEMBER,
  AVM1.SET_MEMBER,
];

/* this.CONTENT._visible = isVisible; */
const CONTENT_VISIBILITY = [
  [AVM1.PUSH, [register(1), "CONTENT"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["_visible", ANY]],
  AVM1.SET_MEMBER,
];

function matchesExactly(program, pattern, count, label, method) {
  const found = findPattern(program, pattern, {
    from: method.start,
    to: method.end,
  });
  if (found.length !== count)
    throw new Error(
      `В hud_reticle.gfx не найдено место «${label}»: совпадений ${found.length}, ожидалось ${count}.`,
    );
  return found.map((index) =>
    program.records.slice(index, index + pattern.length),
  );
}

function registerIn(program, record, position, label) {
  const value = program.pushValues(record)[position];
  if (!Number.isInteger(value?.register))
    throw new Error(
      `В hud_reticle.gfx место «${label}» устроено иначе: там не переменная.`,
    );
  return value.register;
}

/** `this.reticleMC.reticle` — со значениями, которые лягут в стек перед ним. */
const reticleReference = (pool, leading = []) => [
  pushAction([...leading, register(1), "reticleMC"], pool),
  action(AVM1.GET_MEMBER),
  pushAction(["reticle"], pool),
  action(AVM1.GET_MEMBER),
];

/** `com.rockstargames.ui.tweenStar.TweenStarLite.метод(…)` — аргументы уже в стеке. */
const tweenStarCall = (pool, argumentCount, method) => [
  pushAction([argumentCount, "com"], pool),
  action(AVM1.GET_VARIABLE),
  pushAction(["rockstargames"], pool),
  action(AVM1.GET_MEMBER),
  pushAction(["ui"], pool),
  action(AVM1.GET_MEMBER),
  pushAction(["tweenStar"], pool),
  action(AVM1.GET_MEMBER),
  pushAction(["TweenStarLite"], pool),
  action(AVM1.GET_MEMBER),
  pushAction([method], pool),
  action(AVM1.CALL_METHOD),
  action(AVM1.POP),
];

/** `TweenStarLite.removeTweenOf(this.reticleMC.reticle);` */
const removeReticleTween = (pool) =>
  Buffer.concat([
    ...reticleReference(pool),
    ...tweenStarCall(pool, 1, "removeTweenOf"),
  ]);

/**
 * if (a < this.reticleMC.reticle._alpha)
 *   TweenStarLite.to(this.reticleMC.reticle, 0.01, {_alpha: a, delay: N});
 * else {
 *   TweenStarLite.removeTweenOf(this.reticleMC.reticle);
 *   this.reticleMC.reticle._alpha = a;
 * }
 *
 * `to` сам снимает прежний твин прицела, поэтому повторное затухание
 * переносит срок, а не копит их.
 */
function delayedDim(pool, alphaRegister, seconds, fadeSeconds = 0.01, appearSeconds = 0) {
  const alpha = register(alphaRegister);
  return assembleActions([
    ...reticleReference(pool, [alpha]),
    pushAction(["_alpha"], pool),
    action(AVM1.GET_MEMBER),
    action(AVM1.LESS2),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: "brighter" },
    pushAction(["_alpha", alpha, "delay", seconds, 2], pool),
    action(AVM1.INIT_OBJECT),
    /* Длительность твина — затухание: 0,01 с — как в игре (одним шагом), больше — плавно (`animation.fadeSeconds`). */
    ...reticleReference(pool, [fadeSeconds]),
    ...tweenStarCall(pool, 3, "to"),
    { branch: AVM1.JUMP, to: "done" },
    { label: "brighter" },
    /* Светлее: сразу, как в игре, либо плавным твином вверх (`animation.appearSeconds`). */
    ...(appearSeconds > 0
      ? [
          pushAction(["_alpha", alpha, 1], pool),
          action(AVM1.INIT_OBJECT),
          ...reticleReference(pool, [appearSeconds]),
          ...tweenStarCall(pool, 3, "to"),
        ]
      : [
          removeReticleTween(pool),
          ...reticleReference(pool),
          pushAction(["_alpha", alpha], pool),
          action(AVM1.SET_MEMBER),
        ]),
    { label: "done" },
  ]);
}

/**
 * this.reticleMC.reticle._alpha = this.DEFAULT_COLOUR[3] — плавно: TweenStarLite.to(reticle, секунды, { _alpha: this.DEFAULT_COLOUR[3] }) —
 * для `RESET_RETICLE` при новом прицеливании (`animation.appearSeconds`). `to` сам снимает прежний твин того же клипа.
 */
function appearReset(pool, seconds) {
  return assembleActions([
    pushAction(["_alpha", register(1), "DEFAULT_COLOUR"], pool),
    action(AVM1.GET_MEMBER),
    pushAction([3], pool),
    action(AVM1.GET_MEMBER),
    pushAction([1], pool),
    action(AVM1.INIT_OBJECT),
    ...reticleReference(pool, [seconds]),
    ...tweenStarCall(pool, 3, "to"),
  ]);
}

/**
 * Пульс при попадании в начале `SHOW_HITMARKER`:
 *   this.CONTENT._alpha = 100 − сила;  TweenStarLite.to(this.CONTENT, секунды, { _alpha: 100 });
 * `CONTENT` штатный код прозрачностью не трогает (`_alpha` прицела пишут `START_DIM_RETICLE` и `RESET_RETICLE` — у клипа `reticle` внутри).
 */
function hitPulseSteps(pool, animation) {
  if (!animation?.hitPulse) return [];
  return [
    pushAction([register(1), "CONTENT"], pool),
    action(AVM1.GET_MEMBER),
    pushAction(["_alpha", 100 - animation.hitPulseStrength], pool),
    action(AVM1.SET_MEMBER),
    pushAction(["_alpha", 100, 1], pool),
    action(AVM1.INIT_OBJECT),
    pushAction([animation.hitPulseSeconds, register(1), "CONTENT"], pool),
    action(AVM1.GET_MEMBER),
    ...tweenStarCall(pool, 3, "to"),
  ];
}

/** Класс `HUD_RETICLE`: единственный DoInitAction с методами прицела. */
function reticleClassTag(buffer, tags) {
  const found = tags.filter((current) => {
    if (current.code !== 59 || current.length < 2) return false;
    try {
      const { pool } = readProgram(
        buffer,
        current.payloadStart + 2,
        current.end,
      );
      return [
        "HUD_RETICLE",
        "START_DIM_RETICLE",
        "SET_RETICLE_LOCKON_TYPE",
      ].every((name) => pool.includes(name));
    } catch {
      return false;
    }
  });
  if (found.length !== 1)
    throw new Error(
      `В hud_reticle.gfx класс HUD_RETICLE найден ${found.length} раз, ожидался один.`,
    );
  return found[0];
}

function patchReticleActionScript(buffer, classTag, ordinary, damage = null, reload = null, hpProbe = false) {
  const program = readProgram(buffer, classTag.payloadStart + 2, classTag.end);
  assertActionStream(buffer, program.start, program.end);
  const { pool } = program;
  const method = (name) => findMethod(program, name);
  const constructor = method("HUD_RETICLE");
  const setType = method("SET_RETICLE_TYPE");
  const dim = method("START_DIM_RETICLE");
  const reset = method("RESET_RETICLE");
  const visible = method("SET_RETICLE_VISIBLE");
  const lockOn = method("SET_RETICLE_LOCKON_TYPE");
  /* Куда встаёт счётчик урона — тоже при любых настройках. */
  const hitmarker = method("SHOW_HITMARKER");
  const sniperHit = method("SHOW_SNIPER_HIT");
  const hitParams = parameterRegisters(buffer, program, hitmarker).params;
  if (!Number.isInteger(hitParams) || hitParams < 1)
    throw new Error(
      "В hud_reticle.gfx место «отметка попадания» устроено иначе: у SHOW_HITMARKER нет параметра в регистре.",
    );
  const animation = ordinary.animation;
  const pulseSteps = hitPulseSteps(pool, animation);
  /* Одно место на начало `SHOW_HITMARKER`: счётчик урона и пульс — одной правкой (две правки одного места не пересекаются). */
  const hitmarkerEdit = prologueEdit(buffer, program, hitmarker, [...(damage ? damageHitmarkerSteps(pool, hitParams) : []), ...pulseSteps]);
  const damageHooks = [hitmarkerEdit, prologueEdit(buffer, program, sniperHit, damageSniperSteps(pool))];

  /* Сначала все места — при любых настройках, потом правки. */
  const [initialColour] = matchesExactly(
    program,
    defaultColourAssignment(COLOURS.initial),
    1,
    "цвет прицела по умолчанию",
    constructor,
  );
  const lockOnDefaults = matchesExactly(
    program,
    defaultColourAssignment(COLOURS.plain),
    5,
    "DEFAULT_COLOUR при смене цели",
    lockOn,
  );
  const plainColours = matchesExactly(
    program,
    colouriseReticle(COLOURS.plain),
    2,
    "цвет прицела без цели",
    lockOn,
  );
  const lockOnColours = matchesExactly(
    program,
    colouriseReticle(COLOURS.lockOn),
    1,
    "цвет захвата цели",
    lockOn,
  );
  const enemyColours = matchesExactly(
    program,
    colouriseReticle(COLOURS.enemy),
    1,
    "цвет прицела на враге",
    lockOn,
  );
  const [lockOnFlash] = matchesExactly(
    program,
    LOCK_ON_FLASH,
    1,
    "мигание при захвате цели",
    lockOn,
  );
  const [frameChange] = matchesExactly(
    program,
    RETICLE_FRAME_CHANGE,
    1,
    "смена кадра прицела",
    setType,
  );
  const [dimAlpha] = matchesExactly(
    program,
    DIM_ALPHA,
    1,
    "затухание прицела",
    dim,
  );
  const [resetAlpha] = matchesExactly(
    program,
    RESET_ALPHA,
    1,
    "сброс яркости прицела",
    reset,
  );
  const [visibility] = matchesExactly(
    program,
    CONTENT_VISIBILITY,
    1,
    "показ прицела",
    visible,
  );
  const [weaponAssignment] = matchesExactly(
    program,
    WEAPON_ID_ASSIGNMENT,
    1,
    "стиль прицела ствола",
    setType,
  );
  /* Кадр клипа при смене цели — только в SET_RETICLE_LOCKON_TYPE: место,
     которое осталось бы без смещения, показало бы стволу чужой рисунок. */
  const innerFrames = matchesExactly(
    program,
    RETICLE_INNER_FRAME,
    5,
    "кадр прицела при смене цели",
    lockOn,
  );
  if (
    findPattern(program, RETICLE_INNER_FRAME, { from: program.start }).length !==
    innerFrames.length
  )
    throw new Error(
      "В hud_reticle.gfx кадр прицела переключается не только при смене цели.",
    );
  const innerFrameNumbers = innerFrames.map(([push]) => {
    const value = program.pushValues(push)[0];
    if (value !== 1 && value !== 2)
      throw new Error(
        "В hud_reticle.gfx место «кадр прицела при смене цели» устроено иначе: кадр не первый и не второй.",
      );
    return value;
  });
  /* Перелив: кадр 1 клипа — перелив, кадр 2 — обычная заливка, которую красит игра. Пять веток `SET_RETICLE_LOCKON_TYPE` по порядку: нет цели (−1), союзник (0),
     захват (1), враг (2), нет цели (3) с кадрами 1, 1, 1, 2, 1; союзнику и захвату нужен кадр 2, чтобы цвет задала игра, а не смешался с переливом. */
  const shimmerSites = [1, 2];
  if (ordinary.animation.shimmer) {
    if (innerFrameNumbers.join() !== "1,1,1,2,1")
      throw new Error(
        "В hud_reticle.gfx кадры прицела при смене цели идут иначе, чем ждёт перелив (нет цели, союзник, захват, враг, нет цели = 1, 1, 1, 2, 1).",
      );
    for (const site of shimmerSites) innerFrameNumbers[site] = 2;
  }

  registerIn(program, dimAlpha[0], 0, "затухание прицела");
  const alphaRegister = buffer[dimAlpha[2].bodyStart];
  if (
    registerIn(program, dimAlpha[8], 1, "затухание прицела") !== alphaRegister
  )
    throw new Error(
      "В hud_reticle.gfx место «затухание прицела» устроено иначе: яркость пишется не из прочитанного значения.",
    );
  const visibleRegister = registerIn(
    program,
    visibility[2],
    1,
    "показ прицела",
  );

  const edits = [];
  const replacePush = (record, values) =>
    edits.push({
      start: record.offset,
      end: record.end,
      replacement: pushAction(values, pool),
    });
  const statement = (records) => ({
    start: records[0].offset,
    end: records.at(-1).end,
    bytes: buffer.subarray(records[0].offset, records.at(-1).end),
  });

  replacePush(initialColour[0], [
    register(1),
    "DEFAULT_COLOUR",
    ...arrayValues(ordinary.color),
  ]);
  const looks = ordinary.weaponLooks;
  const beforeLook = damage
    ? damageWeaponCode(pool, damage.table)
    : Buffer.alloc(0);
  /* Конец конструктора: функции счётчика урона и индикатора перезарядки. */
  const afterConstructor = Buffer.concat([
    damage ? damageConstructorCode(pool, damage.counter, damage.table) : Buffer.alloc(0),
    reload ? reloadConstructorCode(pool, reload) : Buffer.alloc(0),
    hpProbe ? hpProbeConstructorCode(pool) : Buffer.alloc(0),
  ]);
  if (!damage && pulseSteps.length) edits.push(hitmarkerEdit);
  if (damage) edits.push(...damageHooks);
  if (!looks.length && afterConstructor.length) {
    const constructorSet = initialColour.at(-1);
    edits.push({
      start: constructorSet.offset,
      end: constructorSet.end,
      replacement: Buffer.concat([action(AVM1.SET_MEMBER), afterConstructor]),
    });
  }
  if (damage && !looks.length) {
    const weaponSet = weaponAssignment.at(-1);
    edits.push({
      start: weaponSet.offset,
      end: weaponSet.end,
      replacement: Buffer.concat([action(AVM1.SET_MEMBER), beforeLook]),
    });
  }
  if (!looks.length) {
    for (const match of lockOnDefaults)
      replacePush(match[0], [
        register(1),
        "DEFAULT_COLOUR",
        ...arrayValues(ordinary.color),
      ]);
    for (const match of plainColours)
      replacePush(match[0], colouriseValues(ordinary.color));
    for (const match of [...lockOnColours, ...enemyColours])
      replacePush(match[0], colouriseValues(ordinary.targetColor));
    replacePush(lockOnFlash[0], arrayValues(ordinary.targetColor));
    if (ordinary.animation.shimmer)
      for (const site of shimmerSites)
        replacePush(innerFrames[site][0], [innerFrameNumbers[site], 1, register(1), "reticleMC"]);
  } else {
    /* Рисунки стволов: цвета — из рисунка, который сейчас на стволе. */
    const shared = { ...ordinary, base: 0 };
    const replaceWith = (record, replacement) =>
      edits.push({ start: record.offset, end: record.end, replacement });
    const constructorSet = initialColour.at(-1);
    replaceWith(
      constructorSet,
      Buffer.concat([
        action(AVM1.SET_MEMBER),
        chooseLook(pool, shared, false),
        afterConstructor,
      ]),
    );
    for (const match of lockOnDefaults)
      replaceWith(
        match[0],
        memberColourPush(
          pool,
          [register(1), "DEFAULT_COLOUR", 100],
          "astralPlain",
          [4],
        ),
      );
    for (const match of plainColours)
      replaceWith(
        match[0],
        memberColourPush(pool, [100], "astralPlain", [
          register(1),
          "reticleMC",
        ]),
      );
    for (const match of [...lockOnColours, ...enemyColours])
      replaceWith(
        match[0],
        memberColourPush(pool, [100], "astralTarget", [
          register(1),
          "reticleMC",
        ]),
      );
    replaceWith(
      lockOnFlash[0],
      memberColourPush(pool, [100], "astralTarget", [4]),
    );
    replaceWith(
      weaponAssignment.at(-1),
      chooseWeaponLook(pool, shared, looks, beforeLook),
    );
    innerFrames.forEach(([push], index) =>
      replaceWith(
        push,
        Buffer.concat([
          pushAction([innerFrameNumbers[index], register(1), "astralBase"], pool),
          action(AVM1.GET_MEMBER),
          action(ADD2),
          pushAction([1, register(1), "reticleMC"], pool),
        ]),
      ),
    );
  }

  const frameChangePop = frameChange.at(-1);
  edits.push({
    start: frameChangePop.offset,
    end: frameChangePop.end,
    replacement: Buffer.concat([
      action(AVM1.POP),
      ...(looks.length ? [showWeaponLook(pool, ordinary.spriteFrames)] : []),
      pushAction([0, register(1), "STOP_FLASHING_RETICLE"], pool),
      action(AVM1.CALL_METHOD),
      action(AVM1.POP),
    ]),
  });

  if (ordinary.visibilityMode === "persistent")
    edits.push({
      start: dimAlpha[0].offset,
      end: dimAlpha[1].end,
      replacement: pushAction([100], pool),
    });

  /* Плавность (10.11.2026): в режиме «как в GTA» — затухание и появление твином вместо одного шага. «Не затухает» ничего не гасит — анимировать нечего. */
  const smoothFade = animation.fadeSeconds > 0.01;
  const smoothAppear = animation.appearSeconds > 0;
  const resetStatement = statement(resetAlpha);
  if (ordinary.visibilityMode === "game" && (smoothFade || smoothAppear)) {
    const assignment = statement(dimAlpha.slice(4));
    edits.push({
      start: assignment.start,
      end: assignment.end,
      replacement: delayedDim(pool, alphaRegister, 0, animation.fadeSeconds, animation.appearSeconds),
    });
    if (smoothAppear)
      edits.push({
        start: resetStatement.start,
        end: resetStatement.end,
        replacement: appearReset(pool, animation.appearSeconds),
      });
  }

  if (ordinary.visibilityMode === "delayed") {
    const assignment = statement(dimAlpha.slice(4));
    edits.push({
      start: assignment.start,
      end: assignment.end,
      replacement: delayedDim(pool, alphaRegister, ordinary.fadeDelaySeconds, animation.fadeSeconds, animation.appearSeconds),
    });
    edits.push({
      start: resetStatement.start,
      end: resetStatement.end,
      replacement: smoothAppear
        ? appearReset(pool, animation.appearSeconds)
        : Buffer.concat([removeReticleTween(pool), resetStatement.bytes]),
    });
    const shown = statement(visibility);
    edits.push({
      start: shown.start,
      end: shown.end,
      replacement: assembleActions([
        shown.bytes,
        pushAction([register(visibleRegister)], pool),
        { branch: AVM1.IF, to: "visible" },
        removeReticleTween(pool),
        { label: "visible" },
      ]),
    });
  }

  const actions = rewriteActions(buffer, program.start, program.end, edits, {
    internalBranches: true,
    internalFunctions: Boolean(damage || reload || hpProbe),
  });
  assertActionStream(actions);
  return Buffer.concat([
    buffer.subarray(classTag.payloadStart, classTag.payloadStart + 2),
    actions,
  ]);
}

function placeObject2AtDepth(child, depth) {
  if (child.code !== 26 || child.length < 3)
    throw new Error("Expected a PlaceObject2 lens tag.");
  const rewritten = Buffer.from(child.raw);
  rewritten.writeUInt16LE(depth, child.headerLength + 1);
  return rewritten;
}

/*
 * Ставит ли тег персонажа на эту глубину под этим именем. Имя в PlaceObject2
 * идёт последним полем, если после него нет глубины маски и клип-действий, —
 * так у всех размещений таймлайна прицела.
 */
function isPlacement(payload, child, depth, name) {
  if (child.code !== 26 || child.length < 5) return false;
  const flags = payload[child.payloadStart];
  const suffix = Buffer.from(`${name}\0`, "utf8");
  return (
    (flags & 0x02) !== 0 &&
    (flags & 0x01) === 0 &&
    (flags & 0x20) !== 0 &&
    (flags & 0xc0) === 0 &&
    (depth === null ||
      payload.readUInt16LE(child.payloadStart + 1) === depth) &&
    child.length > suffix.length + 3 &&
    payload.subarray(child.end - suffix.length, child.end).equals(suffix)
  );
}

/*
 * То же размещение, но пустым клипом: глубина, матрица и имя остаются, и
 * ActionScript игры находит клип по имени, как прежде. Вызовы
 * `hitmarker.gotoAndPlay("…")` и `zoomMC.markerMC._x = …` на пустом клипе
 * ничего не делают — метка просто не появляется.
 */
function emptiedPlacement(child) {
  const rewritten = Buffer.from(child.raw);
  rewritten.writeUInt16LE(IDS.emptySprite, child.headerLength + 3);
  return rewritten;
}

/*
 * Таймлайн прицела (спрайт 135): кадр на тип оружия.
 *
 * В обычных кадрах штатный `reticle` на глубине 1 заменяется своим прицелом.
 * В `WEAPON_SNIPER_HEAVY` штатная маска окуляра (`bg_scope`, глубина 1)
 * поднимается на глубину 4 — над своей сеткой, чтобы линии за краем линзы
 * скрывались, как в предпросмотре, — а штатная сетка и точка уступают своей.
 * Маска этого кадра остаётся и в `WEAPON_SNIPER`: оба снайпера видят одну.
 *
 * Снимает маску первый `RemoveObject2` глубины 1 после неё. На глубине 4 он
 * её уже не находит, и при переходе вперёд — со снайпера на гранатомёт или
 * «простой прицел» — чёрная маска осталась бы поверх чужого прицела. Поэтому
 * рядом с ним ставится такое же снятие глубины 4.
 *
 * Штатные метки рядом с сеткой — отметка попадания обычного прицела
 * (`hitmarker`), отметки попадания снайперок (`hitmarkerMC`: зелёные дуги у
 * хевика, белая галочка у большого прицела) и отметка кратности (`zoomMC`)
 * — остаются игре, пока человек их не убрал; убранная ставится пустым
 * клипом под тем же именем. Места ищутся при любых настройках: проверка
 * базы находит и то, что понадобится только убранной метке.
 */
function patchReticleTimeline(payload, { ordinary, sniper }) {
  if (payload.length < 4)
    throw new Error("В hud_reticle.gfx спрайт прицела обрезан.");
  const children = parseTags(payload, 4);
  const output = [payload.subarray(0, 4)];
  const found = {
    ordinary: new Set(),
    heavyLens: 0,
    heavyReticle: 0,
    heavyDot: 0,
    sniperReticle: 0,
    lensRemoval: 0,
    hitmarker: 0,
    heavyHit: 0,
    sniperHit: 0,
    heavyZoom: 0,
  };
  const refuse = (what) => {
    throw new Error(
      `В hud_reticle.gfx таймлайн прицела устроен иначе: ${what}.`,
    );
  };
  let label = "";
  let ordinaryPlaced = false;
  let sniperReticlePlaced = false;
  let sniperLensPlaced = false;
  let lensRaised = false;
  for (const child of children) {
    if (child.code === 43) {
      label = frameLabel(payload.subarray(child.payloadStart, child.end));
      ordinaryPlaced = false;
      sniperReticlePlaced = false;
      sniperLensPlaced = false;
      output.push(child.raw);
      continue;
    }
    if (child.code === 1) label = "";
    if (isPlacement(payload, child, null, "hitmarker")) {
      found.hitmarker += 1;
      output.push(ordinary.hitMarker ? child.raw : emptiedPlacement(child));
      continue;
    }
    if (ORDINARY_LABELS.has(label) && child.code === 26 && !ordinaryPlaced) {
      if (!isPlacement(payload, child, 1, "reticle"))
        refuse(`в кадре ${label} первым стоит не reticle на глубине 1`);
      ordinaryPlaced = true;
      found.ordinary.add(label);
      output.push(placeObject(IDS.ordinarySprite, 1, "reticle", 1));
      continue;
    }
    if (label === "WEAPON_SNIPER_HEAVY") {
      if (child.code === 26 && !sniperLensPlaced) {
        if (!isPlacement(payload, child, 1, "bg_scope"))
          refuse("маска окуляра не на глубине 1");
        sniperLensPlaced = true;
        lensRaised = true;
        found.heavyLens += 1;
        output.push(
          sniper.lensEnabled
            ? placeObject2AtDepth(child, 4)
            : placeObject(IDS.emptySprite, 4, "bg_scope", 7),
        );
        continue;
      }
      if (child.code === 26 && !sniperReticlePlaced) {
        if (!isPlacement(payload, child, 3, "reticleSniperMC"))
          refuse("сетка тяжёлой снайперки не на глубине 3");
        sniperReticlePlaced = true;
        found.heavyReticle += 1;
        output.push(placeObject(IDS.sniperSprite, 3, "reticleSniperMC", 7));
        continue;
      }
      if (child.code === 70) {
        found.heavyDot += 1;
        continue;
      }
      if (isPlacement(payload, child, null, "zoomMC")) {
        found.heavyZoom += 1;
        output.push(sniper.zoomMarker ? child.raw : emptiedPlacement(child));
        continue;
      }
      if (isPlacement(payload, child, null, "hitmarkerMC")) {
        found.heavyHit += 1;
        output.push(sniper.hitMarker ? child.raw : emptiedPlacement(child));
        continue;
      }
    }
    if (label === "WEAPON_SNIPER" && child.code === 26) {
      if (!sniperReticlePlaced) {
        if (!isPlacement(payload, child, 3, "reticleSniperMC"))
          refuse("сетка снайперки не на глубине 3");
        sniperReticlePlaced = true;
        found.sniperReticle += 1;
        output.push(placeObject(IDS.sniperSprite, 3, "reticleSniperMC", 8));
        continue;
      }
      if (isPlacement(payload, child, null, "hitmarkerMC")) {
        found.sniperHit += 1;
        output.push(sniper.hitMarker ? child.raw : emptiedPlacement(child));
        continue;
      }
    }
    if (
      lensRaised &&
      child.code === 28 &&
      child.length === 2 &&
      payload.readUInt16LE(child.payloadStart) === 1
    ) {
      lensRaised = false;
      found.lensRemoval += 1;
      output.push(child.raw, tag(28, Buffer.from([4, 0]), false));
      continue;
    }
    output.push(child.raw);
  }
  const missingOrdinary = [...ORDINARY_LABELS].filter(
    (name) => !found.ordinary.has(name),
  );
  if (missingOrdinary.length)
    refuse(`нет обычного прицела в кадрах ${missingOrdinary.join(", ")}`);
  if (found.heavyLens !== 1) refuse("нет маски окуляра тяжёлой снайперки");
  if (found.heavyReticle !== 1) refuse("нет сетки тяжёлой снайперки");
  if (found.heavyDot !== 1) refuse("нет штатной точки тяжёлой снайперки");
  if (found.sniperReticle !== 1) refuse("нет сетки снайперки");
  if (found.lensRemoval !== 1) refuse("маска окуляра нигде не снимается");
  if (found.hitmarker < 1) refuse("нет отметки попадания обычного прицела");
  if (found.heavyHit !== 1) refuse("нет отметки попадания тяжёлой снайперки");
  if (found.sniperHit !== 1) refuse("нет отметки попадания снайперки");
  if (found.heavyZoom !== 1) refuse("нет отметки кратности тяжёлой снайперки");
  return Buffer.concat(output);
}

function gfxHeaderLength(buffer) {
  if (buffer.length < 16 || buffer.subarray(0, 3).toString("ascii") !== "GFX")
    throw new Error(
      "hud_reticle.gfx не похож на Scaleform-файл (нет подписи GFX).",
    );
  const nbits = buffer[8] >> 3;
  return 8 + Math.ceil((5 + nbits * 4) / 8) + 4;
}

/*
 * Штатный hud_reticle.gfx лежит несжатым, но авторы модов пересохраняют его
 * и сжатым (`CFX` — тот же файл под zlib). Игра читает оба вида, поэтому
 * сжатый разворачивается здесь, а собранный пакет уходит несжатым.
 */
function uncompressedScaleform(buffer) {
  if (buffer.subarray(0, 3).toString("ascii") !== "CFX") {
    gfxHeaderLength(buffer);
    return buffer;
  }
  const body = zlib.inflateSync(buffer.subarray(8));
  const result = Buffer.concat([
    Buffer.from("GFX", "ascii"),
    buffer.subarray(3, 8),
    body,
  ]);
  result.writeUInt32LE(result.length, 4);
  gfxHeaderLength(result);
  return result;
}

/* Собирать поверх своей же сборки нельзя: персонажи с этими номерами уже есть. */
function refuseAstralCharacters(buffer, tags) {
  const ours = new Set(Object.values(IDS));
  for (const current of tags) {
    if (![32, 39].includes(current.code) || current.length < 2) continue;
    const id = buffer.readUInt16LE(current.payloadStart);
    if (
      ours.has(id) ||
      (id >= WEAPON_SHAPES.first && id <= WEAPON_SHAPES.last) ||
      (id >= SHIMMER_IDS.first && id <= SHIMMER_IDS.last) ||
      (id >= DAMAGE_IDS.first && id <= DAMAGE_IDS.last) ||
      (id >= RELOAD_IDS.first && id <= RELOAD_IDS.last) ||
      (id >= HP_IDS.first && id <= HP_IDS.last)
    )
      throw new Error(
        "В hud_reticle.gfx уже стоит прицел Astral — собирать нужно поверх штатного файла.",
      );
  }
}

/* Перелив: пока цели нет, игра красит клип белым (сдвиг 0), и перелив выходит ровно заданных цветов; цвет цели остаётся тем, что выбрал человек. */
const lookColours = (config, shimmer = false) => ({
  color: shimmer ? [255, 255, 255] : hexToRgb(config.color),
  targetColor: hexToRgb(
    config.targetColorEnabled ? config.targetColor : config.color,
  ),
});

/*
 * Что ActionScript класса узнаёт об обычном прицеле: цвета и видимость
 * общего, рисунки стволов (цвета, смещение кадра, хеши стилей) и сколько
 * кадров у клипа с рисунками.
 */
function scriptSettings({ ordinary, weaponStyles, animation }) {
  return {
    animation,
    ...lookColours(ordinary, animation.shimmer),
    visibilityMode: ordinary.visibilityMode,
    fadeDelaySeconds: ordinary.fadeDelaySeconds,
    weaponLooks: weaponStyles.map((style, index) => ({
      ...lookColours(style.config, animation.shimmer),
      base: 2 * (index + 1),
      bindings: style.bindings,
    })),
    spriteFrames: 2 * (weaponStyles.length + 1),
  };
}

export function compileReticleGfx(baseBuffer, rawConfiguration) {
  if (!Buffer.isBuffer(baseBuffer))
    throw new TypeError("Base GFX must be a Buffer.");
  const base = uncompressedScaleform(baseBuffer);
  const configuration = normalizeReticleConfiguration(rawConfiguration);
  const headerLength = gfxHeaderLength(base);
  const tags = parseTags(base, headerLength);
  refuseAstralCharacters(base, tags);
  const classTag = reticleClassTag(base, tags);
  const damage = configuration.damage.enabled
    ? { counter: configuration.damage, table: configuration.damageTable }
    : null;
  const reload = configuration.reload.enabled
    ? { ...configuration.reload, times: configuration.reloadTimes }
    : null;
  const classPayload = patchReticleActionScript(
    base,
    classTag,
    scriptSettings(configuration),
    damage,
    reload,
    configuration.hpProbe,
  );
  const definitions = [
    ...customDefinitions(configuration),
    ...(damage ? damageCounterDefinitions(indexSwf(base), damage.counter) : []),
    ...(reload ? reloadDefinitions(reload) : []),
    ...(configuration.hpProbe ? hpProbeDefinitions(indexSwf(base)) : []),
  ];
  let timelines = 0;
  const output = [base.subarray(0, headerLength)];
  for (const current of tags) {
    if (current === classTag) {
      output.push(tag(59, classPayload));
    } else if (
      current.code === 39 &&
      current.length >= 4 &&
      base.readUInt16LE(current.payloadStart) === 135
    ) {
      output.push(...definitions);
      output.push(
        tag(
          39,
          patchReticleTimeline(
            base.subarray(current.payloadStart, current.end),
            configuration,
          ),
        ),
      );
      timelines += 1;
    } else {
      output.push(current.raw);
    }
  }
  if (timelines !== 1)
    throw new Error(
      `В hud_reticle.gfx таймлайн прицела (спрайт 135) найден ${timelines} раз, ожидался один.`,
    );
  const compiled = Buffer.concat(output);
  compiled.writeUInt32LE(compiled.length, 4);
  return { buffer: compiled, configuration, sha256: sha256(compiled) };
}

/**
 * Годится ли файл в базу прицела.
 *
 * Проверка — та же сборка со штатными настройками. Места ActionScript ищутся
 * при любых настройках, поэтому она проходит через всё, что меняет настоящая
 * сборка, и разойтись с ней не может. Бросает с объяснением, чего не нашлось.
 */
export function verifyReticleBase(gfxBuffer) {
  compileReticleGfx(gfxBuffer, {});
  compileReticleGfx(gfxBuffer, { damage: { enabled: true } });
  compileReticleGfx(gfxBuffer, { reload: { enabled: true } });
  compileReticleGfx(gfxBuffer, { animation: { shimmer: true } });
  return { gfxSha256: sha256(gfxBuffer) };
}

/*
 * Файлы оружия пакета (`reticle-weapons.js`): `{ entry, text, imported }` —
 * запись update.rpf, текст в latin1 (байт в байт как прочитан) и новая ли
 * это запись. Только описания оружия: другое в пакет прицела не попадает.
 */
const WEAPON_FILE_ENTRY =
  /^(?:dlc_patch\/[a-z0-9_]+\/)?common\/data\/ai\/[a-z0-9_]+\.meta$/i;
function weaponFileActions(weaponFiles) {
  if (!Array.isArray(weaponFiles)) return [];
  return weaponFiles.map((file, index) => {
    const entry = String(file?.entry || "").replaceAll("\\", "/");
    if (!WEAPON_FILE_ENTRY.test(entry))
      throw new Error(`Файл оружия ${entry} лежит не там, где игра их читает.`);
    if (file.imported && entry !== entry.toLowerCase())
      throw new Error(`Новая запись ${entry} должна быть строчными буквами.`);
    const bytes = Buffer.from(String(file.text || ""), "latin1");
    return {
      bytes,
      source: `payload/weapons/${index + 1}-${path.posix.basename(entry).toLowerCase()}`,
      action: {
        Type: file.imported ? "Import" : "Replace",
        TargetPath: `update:/${entry}`,
        Size: bytes.length,
        Sha256: sha256(bytes),
        IsWholeReplaceNestedRpf: false,
      },
    };
  });
}

export async function buildReticlePatch({
  baseGfx,
  configuration,
  cacheRoot,
  killMarker = null,
  weaponFiles = [],
  /* hud.gfx со счётчиком патронов (`hud-ammo-gfx-compiler.js`) или штатный —
     когда счётчик выключен, а в игре он стоит. `null` — hud.gfx не трогать. */
  hudGfx = null,
  /* mp_gamer_info.gfx (полоска HP над игроком) в пакет прицела больше не
     едет: у неё свой редактор и свой патч (`target-hp-customizer.js`). */
} = {}) {
  const base = await fs.readFile(path.resolve(String(baseGfx || "")));
  const compiled = compileReticleGfx(base, configuration);
  /*
   * Знак на килле живёт в том же файле, но ставит его килл-эффект. Прицел
   * собирается поверх штатного файла и без переноса стёр бы знак; перенос
   * берёт его из живого файла байт в байт, а словарь с его кадрами уезжает
   * тем же патчем — файл прицела и словарь всегда из одной сборки.
   */
  const marker = killMarker?.gfx
    ? transplantKillMarkerGfx(compiled.buffer, killMarker.gfx)
    : { buffer: compiled.buffer, transplanted: false };
  if (marker.transplanted && !killMarker.ytd)
    throw new Error(
      "В игре стоит знак на килле, но его словаря hud_reticle.ytd в update.rpf нет — прицел не собрать, не потеряв знак.",
    );
  const gfx = marker.buffer;
  const gfxSha256 = sha256(gfx);
  const root = path.resolve(
    cacheRoot || path.join(os.tmpdir(), "astral-reticle-patches"),
  );
  const patchDirectory = path.join(root, randomUUID());
  const payloadDirectory = path.join(patchDirectory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  const payload = path.join(payloadDirectory, "hud_reticle.gfx");
  await fs.writeFile(payload, gfx, { flag: "wx" });
  const actions = [
    {
      Type: "Replace",
      TargetPath: GFX_TARGET,
      SourcePath: "payload/hud_reticle.gfx",
      Size: gfx.length,
      Sha256: gfxSha256,
      IsWholeReplaceNestedRpf: false,
    },
  ];
  if (marker.transplanted) {
    await fs.writeFile(
      path.join(payloadDirectory, "hud_reticle.ytd"),
      killMarker.ytd,
      { flag: "wx" },
    );
    actions.push({
      Type: "Replace",
      TargetPath: YTD_TARGET,
      SourcePath: "payload/hud_reticle.ytd",
      Size: killMarker.ytd.length,
      Sha256: sha256(killMarker.ytd),
      IsWholeReplaceNestedRpf: false,
    });
  }
  /* Счётчик патронов — тем же пакетом: одно «Применить» прицела ставит и
     его, и точка отката у них одна. */
  if (hudGfx) {
    if (!Buffer.isBuffer(hudGfx)) throw new TypeError("hud.gfx must be a Buffer.");
    await fs.writeFile(path.join(payloadDirectory, "hud.gfx"), hudGfx, { flag: "wx" });
    actions.push({
      Type: "Replace",
      TargetPath: HUD_GFX_TARGET,
      SourcePath: "payload/hud.gfx",
      Size: hudGfx.length,
      Sha256: sha256(hudGfx),
      IsWholeReplaceNestedRpf: false,
    });
  }
  /* Стили прицела стволов — тем же пакетом: hud_reticle.gfx и weapons.meta
     всегда из одной сборки, и точка отката у них одна. */
  const weapons = weaponFileActions(weaponFiles);
  if (weapons.length)
    await fs.mkdir(path.join(payloadDirectory, "weapons"), { recursive: true });
  for (const item of weapons) {
    await fs.writeFile(path.join(patchDirectory, ...item.source.split("/")), item.bytes, {
      flag: "wx",
    });
    actions.push({ ...item.action, SourcePath: item.source });
  }
  const manifest = {
    ReduxName: "Astral Majestic / GTA5RP reticle",
    ParsedAt: new Date().toISOString(),
    TotalPatchSize: actions.reduce((total, action) => total + action.Size, 0),
    Actions: actions,
  };
  await fs.writeFile(
    path.join(patchDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return {
    patch: patchDirectory,
    target: manifest.Actions[0].TargetPath,
    size: gfx.length,
    sha256: gfxSha256,
    configuration: compiled.configuration,
    killMarker: marker.transplanted
      ? { kept: true, signature: marker.signature }
      : { kept: false },
  };
}
