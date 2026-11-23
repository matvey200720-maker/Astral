/*
 * Знак на килле внутри `hud_reticle.gfx`.
 *
 * Крестик, который игра показывает над прицелом на убийство, — спрайт,
 * экспортированный как `hitmarkers` (в Legacy это символ 8). Его таймлайн:
 *
 *   кадр 1                  stop() — пусто;
 *   «playHitmarkerKill»     белый крестик, 15 кадров, gotoAndStop(1);
 *   «playHitmarkerShot»     красный крестик, 15 кадров, gotoAndStop(1).
 *
 * Код прицела (`HUD_RETICLE.SHOW_HITMARKER`) на килле зовёт
 * `hitmarker.gotoAndPlay(<метка>)`, а клип стоит в таймлайне прицела под
 * именем `hitmarker` и ездит за прицелом (`SET_RETICLE_POSITION`). Своя
 * картинка встаёт в тело того же спрайта: номер, метки и контракт
 * «кадр 1 пуст, метка играет и возвращается в кадр 1» остаются прежними, и
 * код игры зовёт знак так же, как звал крестик. ActionScript игры не
 * меняется ни в одном байте.
 *
 * Картинка — внешние текстуры `astral_kill_NN` в `hud_reticle.ytd`
 * (`DefineExternalImage2` + квадрат с заливкой 0x41): так хранят картинки
 * все фильмы игры, встроенного растра нет ни в одном из них. Движение —
 * кадрами: на каждый кадр таймлайна (1/30 с) своя матрица и прозрачность
 * клипа картинки, посчитанные `bakeKillMarkerTimeline` — той же функцией,
 * что рисует предпросмотр.
 *
 * Семейство Astral — символы 64900…64989 (прицел Astral занимает
 * 64990…64999). Прежнее тело спрайта лежит копией (64965), поэтому знак
 * снимается без резервной копии игры: тело возвращается из копии, а
 * семейство вынимается целиком. Собирается всегда поверх живого файла —
 * своего прицела, чужого мода или штатного, — и снимает свой прежний знак
 * сам: второе «Применить» не копит символы, а заменяет их.
 */

import {
  KILL_MARKER_FPS,
  bakeKillMarkerTimeline,
} from "@modovik/kill-effects";
import {
  SCALEFORM_TAG,
  SWF_TAG,
  TWIPS,
  composeMatrix,
  defineCentredBitmapShape,
  defineExternalImage,
  indexSwf,
  parseSwfTags,
  readPlacement,
  scaleformHeaderLength,
  swfTag,
  uncompressedScaleform,
  writeColorTransform,
  writeMatrix,
} from "./scaleform-swf.js";

export const KILL_MARKER_IDS = Object.freeze({
  firstImage: 64900,
  firstShape: 64932,
  frames: 64964,
  original: 64965,
  first: 64900,
  last: 64989,
});
export const KILL_MARKER_TEXTURE_PREFIX = "astral_kill_";
export const KILL_MARKER_LABEL_PREFIX = "astral_kill_";

const HITMARKER_EXPORT = "hitmarkers";
const LABELS = Object.freeze(["playHitmarkerKill", "playHitmarkerShot"]);
/* Пустой клип, которым прицел Astral прячет штатные метки. */
const RETICLE_EMPTY_SPRITE = 64999;
const FRAME_LABEL = 43;
const MAX_FRAMES = 32;

/* AVM1 штатного спрайта: stop(), play() и this.gotoAndStop(1) — байт в байт
   те же, что у крестика Rockstar. */
const ACTION_STOP = Buffer.from("0700", "hex");
const ACTION_PLAY = Buffer.from("0600", "hex");
const ACTION_BACK_TO_START = Buffer.from(
  "961000070100000007010000000074686973001c960d0000676f746f416e6453746f7000521700",
  "hex",
);

const inFamily = (id) =>
  id >= KILL_MARKER_IDS.first && id <= KILL_MARKER_IDS.last;
export const killMarkerTextureName = (index) =>
  `${KILL_MARKER_TEXTURE_PREFIX}${String(index).padStart(2, "0")}`;

const refuse = (what) => {
  throw new Error(`В hud_reticle.gfx ${what} — знак на килле не собрать.`);
};

function tagId(buffer, tag) {
  if (tag.length < 2) return null;
  if (tag.code === SCALEFORM_TAG.DEFINE_EXTERNAL_IMAGE2)
    return buffer.readUInt32LE(tag.payloadStart) & 0xffff;
  if (
    tag.code === SWF_TAG.DEFINE_SHAPE ||
    tag.code === SWF_TAG.DEFINE_SHAPE2 ||
    tag.code === SWF_TAG.DEFINE_SHAPE3 ||
    tag.code === SWF_TAG.DEFINE_SHAPE4 ||
    tag.code === SWF_TAG.DEFINE_SPRITE
  )
    return buffer.readUInt16LE(tag.payloadStart);
  return null;
}

function frameLabel(buffer, tag) {
  const zero = buffer.indexOf(0, tag.payloadStart);
  return zero < 0 || zero > tag.end
    ? ""
    : buffer.toString("latin1", tag.payloadStart, zero);
}

const labelTag = (name) =>
  swfTag(FRAME_LABEL, Buffer.from(`${name}\0`, "latin1"), false);
const doAction = (bytes) => swfTag(SWF_TAG.DO_ACTION, bytes, false);
const showFrame = () => swfTag(SWF_TAG.SHOW_FRAME, Buffer.alloc(0), false);
const endTag = () => swfTag(SWF_TAG.END, Buffer.alloc(0), false);

function spriteTag(id, frameCount, children) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(frameCount, 2);
  return swfTag(
    SWF_TAG.DEFINE_SPRITE,
    Buffer.concat([header, ...children, endTag()]),
  );
}

/* PlaceObject2 с нужными полями: новый символ, замена символа на месте или
   только новая матрица и цвет. */
function place({ depth, characterId = null, move = false, matrix = null, cxform = null }) {
  const flags =
    (move ? 0x01 : 0) |
    (characterId !== null ? 0x02 : 0) |
    (matrix ? 0x04 : 0) |
    (cxform ? 0x08 : 0);
  const head = Buffer.alloc(characterId !== null ? 5 : 3);
  head[0] = flags;
  head.writeUInt16LE(depth, 1);
  if (characterId !== null) head.writeUInt16LE(characterId, 3);
  return swfTag(
    SWF_TAG.PLACE_OBJECT2,
    Buffer.concat([
      head,
      ...(matrix ? [writeMatrix(matrix)] : []),
      ...(cxform ? [writeColorTransform(cxform)] : []),
    ]),
    false,
  );
}

function removeDepth(depth) {
  const payload = Buffer.alloc(2);
  payload.writeUInt16LE(depth);
  return swfTag(SWF_TAG.REMOVE_OBJECT2, payload, false);
}

/**
 * Тело спрайта крестика: метки, что на них стоит, и крестики Rockstar под
 * каждой меткой (они нужны знаку, если человек оставил крестик игры).
 */
function readHitmarkerBody(buffer, sprite) {
  const tags = parseSwfTags(buffer, sprite.payloadStart + 4, sprite.end);
  const labels = {};
  const crosses = {};
  let frame = 0;
  let current = null;
  const placed = new Set();
  for (const tag of tags) {
    if (tag.code === SWF_TAG.SHOW_FRAME) {
      frame += 1;
      current = null;
      continue;
    }
    if (tag.code === FRAME_LABEL) {
      current = frameLabel(buffer, tag);
      labels[current] = frame;
      continue;
    }
    if (tag.code === SWF_TAG.PLACE_OBJECT2) {
      const placement = readPlacement(buffer, tag);
      if (placement?.characterId !== undefined) {
        placed.add(placement.characterId);
        if (current && LABELS.includes(current) && !crosses[current])
          crosses[current] = placement.characterId;
      }
    }
  }
  return {
    frameCount: buffer.readUInt16LE(sprite.payloadStart + 2),
    labels,
    crosses,
    placed,
  };
}

/** Где в таймлайне прицела стоят клипы `hitmarker` и чем они заняты. */
function hitmarkerPlacements(index, hitmarkerId) {
  const found = [];
  for (const tag of index.tags) {
    if (tag.code !== SWF_TAG.DEFINE_SPRITE) continue;
    const children = parseSwfTags(index.buffer, tag.payloadStart + 4, tag.end);
    for (const child of children) {
      if (child.code !== SWF_TAG.PLACE_OBJECT2) continue;
      const placement = readPlacement(index.buffer, child);
      if (placement?.name !== "hitmarker") continue;
      found.push(placement.characterId ?? hitmarkerId);
    }
  }
  return found;
}

/**
 * Что сейчас стоит в клипе крестика: штатный крестик, знак Astral (и какой —
 * по отпечатку) и не спрятан ли клип прицелом Astral («Отметка попадания»
 * выключена — тогда в игре не будет ни крестика, ни знака).
 */
export function inspectKillMarkerGfx(input) {
  const buffer = uncompressedScaleform(input);
  const index = indexSwf(buffer);
  const hitmarkerId = index.exports.get(HITMARKER_EXPORT);
  if (hitmarkerId === undefined) refuse("нет клипа крестика (hitmarkers)");
  const sprite = index.definitions.get(hitmarkerId);
  if (sprite?.code !== SWF_TAG.DEFINE_SPRITE) refuse("клип крестика — не спрайт");
  const body = readHitmarkerBody(buffer, sprite);
  for (const label of LABELS)
    if (body.labels[label] === undefined) refuse(`у крестика нет метки ${label}`);
  const frames = index.definitions.get(KILL_MARKER_IDS.frames);
  let signature = null;
  if (frames?.code === SWF_TAG.DEFINE_SPRITE) {
    for (const tag of parseSwfTags(buffer, frames.payloadStart + 4, frames.end)) {
      if (tag.code !== FRAME_LABEL) continue;
      const label = frameLabel(buffer, tag);
      if (label.startsWith(KILL_MARKER_LABEL_PREFIX))
        signature = label.slice(KILL_MARKER_LABEL_PREFIX.length);
      break;
    }
  }
  const placements = hitmarkerPlacements(index, hitmarkerId);
  return {
    hitmarkerId,
    installed: index.definitions.has(KILL_MARKER_IDS.original),
    signature,
    hidden:
      placements.length > 0 &&
      placements.every((id) => id === RETICLE_EMPTY_SPRITE),
  };
}

/*
 * Файл без знака Astral: тело крестика — из копии, семейство — вон.
 * Файл без знака возвращается как есть (тот же Buffer).
 */
function stripped(buffer) {
  const index = indexSwf(buffer);
  const original = index.definitions.get(KILL_MARKER_IDS.original);
  const hitmarkerId = index.exports.get(HITMARKER_EXPORT);
  const family = index.tags.some((tag) => {
    const id = tagId(buffer, tag);
    return id !== null && inFamily(id);
  });
  if (!family) return buffer;
  /* Символы в диапазоне Astral без копии крестика — не наш знак: их
     поставил кто-то другой, и вынимать их нельзя. */
  if (original?.code !== SWF_TAG.DEFINE_SPRITE || hitmarkerId === undefined)
    refuse(
      `номера ${KILL_MARKER_IDS.first}…${KILL_MARKER_IDS.last} семейства Astral уже заняты символами, которые поставил не Astral`,
    );
  const restoredBody = buffer.subarray(original.payloadStart + 2, original.end);
  const output = [buffer.subarray(0, index.headerLength)];
  for (const tag of index.tags) {
    const id = tagId(buffer, tag);
    if (id !== null && inFamily(id)) continue;
    if (tag.code === SWF_TAG.DEFINE_SPRITE && id === hitmarkerId) {
      const idBuffer = Buffer.alloc(2);
      idBuffer.writeUInt16LE(hitmarkerId);
      output.push(
        swfTag(SWF_TAG.DEFINE_SPRITE, Buffer.concat([idBuffer, restoredBody])),
      );
      continue;
    }
    output.push(buffer.subarray(tag.offset, tag.end));
  }
  const result = Buffer.concat(output);
  result.writeUInt32LE(result.length, 4);
  return result;
}

/** Файл без знака на килле: штатный крестик на месте. */
export function stripKillMarkerGfx(input) {
  return stripped(uncompressedScaleform(input));
}

/**
 * Знак на килле из живого файла — в свежую сборку прицела.
 *
 * Прицел Astral собирается поверх штатного файла, а не поверх живого: свою
 * прошлую сборку он разобрать обратно не может. Без переноса «Применить» в
 * прицеле молча стирало бы знак, поставленный килл-эффектом, — ровно тот
 * конфликт двух работ в одном файле, которого быть не должно. Знак
 * самодостаточен (своё семейство символов и тело клипа крестика), поэтому
 * переносится как есть, байт в байт. `transplanted: false` — в живом файле
 * знака нет, и сборка прицела остаётся нетронутой.
 */
export function transplantKillMarkerGfx(target, source) {
  const donor = uncompressedScaleform(source);
  const donorIndex = indexSwf(donor);
  if (!donorIndex.definitions.has(KILL_MARKER_IDS.original))
    return { buffer: target, transplanted: false };
  const recipient = stripped(uncompressedScaleform(target));
  const index = indexSwf(recipient);
  for (const id of index.usedIds)
    if (inFamily(id))
      refuse(`номер ${id} из семейства Astral уже занят другим символом`);
  const hitmarkerId = index.exports.get(HITMARKER_EXPORT);
  const donorHitmarkerId = donorIndex.exports.get(HITMARKER_EXPORT);
  if (hitmarkerId === undefined || hitmarkerId !== donorHitmarkerId)
    refuse("клип крестика в прицеле и в живом файле — разные символы");
  const family = donorIndex.tags
    .filter((tag) => {
      const id = tagId(donor, tag);
      return id !== null && inFamily(id);
    })
    .map((tag) => donor.subarray(tag.offset, tag.end));
  const donorSprite = donorIndex.definitions.get(donorHitmarkerId);
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(hitmarkerId);
  const sprite = swfTag(
    SWF_TAG.DEFINE_SPRITE,
    Buffer.concat([
      idBuffer,
      donor.subarray(donorSprite.payloadStart + 2, donorSprite.end),
    ]),
  );
  const output = [recipient.subarray(0, index.headerLength)];
  for (const tag of index.tags) {
    if (tag.code === SWF_TAG.DEFINE_SPRITE && tagId(recipient, tag) === hitmarkerId) {
      output.push(...family, sprite);
      continue;
    }
    output.push(recipient.subarray(tag.offset, tag.end));
  }
  const buffer = Buffer.concat(output);
  buffer.writeUInt32LE(buffer.length, 4);
  const check = inspectKillMarkerGfx(buffer);
  if (!check.installed)
    throw new Error("Знак на килле не перенёсся в сборку прицела — файл не тронут.");
  return { buffer, transplanted: true, signature: check.signature };
}

const clampScale = (value) =>
  Math.abs(value) < 0.001 ? (value < 0 ? -0.001 : 0.001) : value;

function poseMatrix(pose) {
  return composeMatrix({
    scaleX: clampScale(pose.scaleX),
    scaleY: clampScale(pose.scaleY),
    rotation: pose.rotation,
    translateX: pose.x * TWIPS,
    translateY: pose.y * TWIPS,
  });
}

const poseAlpha = (pose) => ({
  mult: [256, 256, 256, Math.round(Math.max(0, Math.min(1, pose.alpha)) * 256)],
  add: [0, 0, 0, 0],
});

/*
 * Штатный крестик игры длится 15 кадров (кадры 2…16 спрайта): столько же он
 * держится и поверх знака, если человек его оставил.
 */
const CROSS_FRAMES = 15;

/**
 * Собирает знак поверх живого `hud_reticle.gfx`.
 *
 * `frames` — кадры картинки в том порядке, в каком они лежат в словаре:
 * `{ name, width, height }` (имя текстуры `astral_kill_NN`); `delays` — их
 * задержки, мс. Возвращает новый файл и отпечаток знака, который
 * `inspectKillMarkerGfx` прочтёт обратно.
 */
export function compileKillMarkerGfx(input, { marker, frames, delays, signature }) {
  const base = stripped(uncompressedScaleform(input));
  if (!marker?.enabled) return { buffer: base, frames: 0, timelineFrames: 0 };
  const list = Array.isArray(frames) ? frames : [];
  if (!list.length) throw new Error("У знака на килле нет ни одного кадра картинки.");
  if (list.length > MAX_FRAMES)
    throw new Error(`У знака на килле больше ${MAX_FRAMES} кадров.`);
  if (!/^[0-9a-f]{8}$/.test(String(signature || "")))
    throw new Error("У знака на килле нет отпечатка.");

  const index = indexSwf(base);
  for (const id of index.usedIds)
    if (inFamily(id))
      refuse(`номер ${id} из семейства Astral уже занят другим символом`);
  const hitmarkerId = index.exports.get(HITMARKER_EXPORT);
  if (hitmarkerId === undefined) refuse("нет клипа крестика (hitmarkers)");
  const sprite = index.definitions.get(hitmarkerId);
  if (sprite?.code !== SWF_TAG.DEFINE_SPRITE) refuse("клип крестика — не спрайт");
  const body = readHitmarkerBody(base, sprite);
  for (const label of LABELS)
    if (body.labels[label] === undefined) refuse(`у крестика нет метки ${label}`);

  const baked = bakeKillMarkerTimeline(marker, delays);
  const side = Math.round(marker.size * TWIPS);

  /* Картинки и квадраты под ними. */
  const definitions = [];
  const originalId = Buffer.alloc(2);
  originalId.writeUInt16LE(KILL_MARKER_IDS.original);
  definitions.push(
    swfTag(
      SWF_TAG.DEFINE_SPRITE,
      Buffer.concat([
        originalId,
        base.subarray(sprite.payloadStart + 2, sprite.end),
      ]),
    ),
  );
  list.forEach((frame, position) => {
    if (frame.name !== killMarkerTextureName(position))
      throw new Error(`Кадр ${position} знака назван не по порядку: ${frame.name}.`);
    definitions.push(
      defineExternalImage(KILL_MARKER_IDS.firstImage + position, frame),
      defineCentredBitmapShape(
        KILL_MARKER_IDS.firstShape + position,
        KILL_MARKER_IDS.firstImage + position,
        frame.width,
        frame.height,
        side,
      ),
    );
  });

  /* Клип картинки: кадры гифки по 1/30 с, дальше — по кругу сам. */
  const shape = (image) =>
    KILL_MARKER_IDS.firstShape + Math.max(0, Math.min(list.length - 1, image));
  const gif = [labelTag(`${KILL_MARKER_LABEL_PREFIX}${signature}`)];
  baked.images.forEach((image, position) => {
    if (position === 0) gif.push(place({ depth: 1, characterId: shape(image) }));
    else if (image !== baked.images[position - 1])
      gif.push(place({ depth: 1, characterId: shape(image), move: true }));
    if (!baked.loop && position === baked.images.length - 1)
      gif.push(doAction(ACTION_STOP));
    gif.push(showFrame());
  });
  definitions.push(spriteTag(KILL_MARKER_IDS.frames, baked.images.length, gif));

  /* Новое тело крестика: кадр 1 пуст, под каждой меткой — знак. */
  const timeline = [doAction(ACTION_STOP), showFrame()];
  let frameCount = 1;
  for (const label of LABELS) {
    const cross = marker.keepCross ? body.crosses[label] : undefined;
    baked.poses.forEach((pose, position) => {
      if (position === 0) {
        timeline.push(doAction(ACTION_PLAY), labelTag(label));
        timeline.push(
          place({
            depth: 1,
            characterId: KILL_MARKER_IDS.frames,
            matrix: poseMatrix(pose),
            cxform: poseAlpha(pose),
          }),
        );
        if (cross !== undefined)
          timeline.push(place({ depth: 2, characterId: cross, matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } }));
      } else {
        timeline.push(
          place({
            depth: 1,
            move: true,
            matrix: poseMatrix(pose),
            cxform: poseAlpha(pose),
          }),
        );
        if (cross !== undefined && position === CROSS_FRAMES)
          timeline.push(removeDepth(2));
      }
      timeline.push(showFrame());
      frameCount += 1;
    });
    /*
     * Кадр возврата снимает знак с глубин сам. Таймлайн строится подряд, и
     * без снятия под второй меткой глубина 1 оставалась бы занятой знаком
     * первой: новое размещение туда игра не поставит (у Rockstar под второй
     * меткой поэтому стоит замена символа, а не размещение), а переход на
     * метку сразу из кадра 1 собирает список отображения по всем кадрам до
     * неё.
     */
    timeline.push(removeDepth(1));
    if (cross !== undefined && baked.poses.length <= CROSS_FRAMES)
      timeline.push(removeDepth(2));
    timeline.push(doAction(ACTION_BACK_TO_START), showFrame());
    frameCount += 1;
  }
  const replaced = spriteTag(hitmarkerId, frameCount, timeline);

  const output = [base.subarray(0, index.headerLength)];
  for (const tag of index.tags) {
    if (tag.code === SWF_TAG.DEFINE_SPRITE && tagId(base, tag) === hitmarkerId) {
      output.push(...definitions, replaced);
      continue;
    }
    output.push(base.subarray(tag.offset, tag.end));
  }
  const buffer = Buffer.concat(output);
  buffer.writeUInt32LE(buffer.length, 4);

  /* Перечитать собранное: знак обязан узнаваться тем же разбором, которым
     его потом проверит редактор. */
  const check = inspectKillMarkerGfx(buffer);
  if (!check.installed || check.signature !== signature)
    throw new Error("Сборка знака на килле не перечиталась — файл не тронут.");
  scaleformHeaderLength(buffer);
  return {
    buffer,
    frames: list.length,
    timelineFrames: frameCount,
    fps: KILL_MARKER_FPS,
    hidden: check.hidden,
  };
}
