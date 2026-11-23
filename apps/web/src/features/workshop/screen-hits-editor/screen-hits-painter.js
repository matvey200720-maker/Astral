/*
 * След попадания на экране — один проход на кадр редактора, плитки и
 * обложку (задача 3 ТЗ 04.10.2026).
 *
 * Сцена — матовая стена Astral (`matteWall`, как у килл-эффекта): на ровной
 * стене видно ровно то, что меняет работа. Поверх — три попадания с разных
 * сторон: игра ставит след у края экрана со стороны выстрела и тянет его к
 * центру. Картинка следа — та же маска, что уйдёт в `dmg_overlay_fade`
 * (`screenHitsMask`), у «Как в игре» — капля из игры игрока, а без игры —
 * её очерк своим пером. Числа — те же `screenHitsValues`: длина, ширина у
 * основания и у кончика, цвет и прозрачность низа и верха экрана,
 * нарастание, удержание и спад.
 *
 * Сколько раз след появляется, решает игра — на каждое попадание по игроку;
 * три попадания в кадре — постановка, и подпись кадра говорит это прямо.
 */

import { SCREEN_HITS_EDGE, screenHitsMask, screenHitsMaskRgba, screenHitsValues } from "@modovik/kill-effects/screen-hits.js";
import { matteWall } from "../../../components/desktop/workshop/kill-effect-painter.js";
import { context2d } from "../../../components/desktop/workshop/canvas-surface.js";

const EDGE = SCREEN_HITS_EDGE;
/* Полосы, которыми капля ложится в трапецию: шире у основания, уже у кончика. */
const STRIPS = 16;
/* Где кончик следа: доля половины экрана от центра (ScreenSafeZoneLength 0,45 из 0,5). */
const SAFE_ZONE = 0.9;
/* Три попадания постановки: направление (0 — вправо, по часовой) и сдвиг во времени. */
export const SCREEN_HITS_SHOTS = Object.freeze([
  { angle: Math.PI, delay: 0 },
  { angle: Math.PI * 0.22, delay: 0.32 },
  { angle: -Math.PI * 0.42, delay: 0.62 },
]);

const hasDocument = () => typeof document !== "undefined";

function blankCanvas(width, height) {
  if (!hasDocument()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/*
 * Очерк капли Rockstar своим пером — для кадра без игры: широкий тёмный
 * верх, узкий яркий кончик внизу. Текстур Rockstar в поставке нет.
 */
function penDrop() {
  const field = new Float32Array(EDGE * EDGE);
  for (let y = 0; y < EDGE; y += 1) {
    const v = (y + 0.5) / EDGE;
    const t = (v - 0.11) / 0.85;
    if (t <= 0 || t >= 1) continue;
    const half = 0.34 * Math.pow(1 - Math.pow(t, 2.4), 0.55);
    const shade = 0.12 + 0.88 * Math.pow(t, 1.3);
    for (let x = 0; x < EDGE; x += 1) {
      const u = Math.abs((x + 0.5) / EDGE - 0.5);
      const edge = Math.min(1, Math.max(0, (half - u) * EDGE * 0.5));
      field[y * EDGE + x] = shade * edge;
    }
  }
  return field;
}

const maskCache = new Map();

function maskAlphaCanvas(key, field) {
  if (maskCache.has(key)) return maskCache.get(key);
  const canvas = blankCanvas(EDGE, EDGE);
  const context = context2d(canvas);
  if (!context) return null;
  const image = context.createImageData(EDGE, EDGE);
  for (let index = 0; index < EDGE * EDGE; index += 1) {
    image.data[index * 4] = 255;
    image.data[index * 4 + 1] = 255;
    image.data[index * 4 + 2] = 255;
    image.data[index * 4 + 3] = Math.round(Math.min(1, Math.max(0, field[index])) * 255);
  }
  context.putImageData(image, 0, 0);
  if (maskCache.size > 24) maskCache.clear();
  maskCache.set(key, canvas);
  return canvas;
}

/* Капля из игры (PNG от главного процесса) → поле яркости. */
export function dropField(image) {
  const canvas = blankCanvas(EDGE, EDGE);
  const context = context2d(canvas, { willReadFrequently: true });
  if (!context || !image) return null;
  context.drawImage(image, 0, 0, EDGE, EDGE);
  const data = context.getImageData(0, 0, EDGE, EDGE).data;
  const field = new Float32Array(EDGE * EDGE);
  for (let index = 0; index < EDGE * EDGE; index += 1) field[index] = data[index * 4] / 255;
  return field;
}

/**
 * Маска следа как холст с альфой: своя картинка, готовая маска или капля
 * игры. `drop` — `{ key, field }` капли игрока или `null`; `picture` —
 * `{ asset, rgba }` своей картинки.
 */
export function screenHitsMaskCanvas(project, { drop = null, picture = null } = {}) {
  if (project.shape === "game") {
    if (drop?.field) return maskAlphaCanvas(`drop:${drop.key}`, drop.field);
    return maskAlphaCanvas("pen-drop", penDrop());
  }
  if (project.shape === "own") {
    if (!picture?.rgba) return null;
    const key = `own:${picture.asset}:${project.count}:${project.own.invert}`;
    if (maskCache.has(key)) return maskCache.get(key);
    const field = screenHitsMask(project, { width: EDGE, height: EDGE, rgba: picture.rgba });
    return field ? maskAlphaCanvas(key, field) : null;
  }
  const key = `${project.shape}:${project.count}`;
  if (maskCache.has(key)) return maskCache.get(key);
  return maskAlphaCanvas(key, screenHitsMask(project));
}

/** Маска как серый PNG-холст (плитки «Картинки»). */
export function screenHitsMaskPreview(project, options) {
  const mask = screenHitsMaskCanvas(project, options);
  if (!mask) return null;
  const canvas = blankCanvas(EDGE, EDGE);
  const context = context2d(canvas);
  if (!context) return null;
  context.fillStyle = "#000";
  context.fillRect(0, 0, EDGE, EDGE);
  context.drawImage(mask, 0, 0);
  return canvas;
}

/* Насколько след виден в момент `elapsed` (мс от начала попадания). */
export function screenHitsEnvelope(project, elapsed) {
  const { RampUpDuration: up, HoldDuration: hold, RampDownDuration: down } = screenHitsValues(project);
  if (elapsed < 0) return 0;
  if (elapsed < up) return up > 0 ? elapsed / up : 1;
  if (elapsed < up + hold) return 1;
  if (elapsed < up + hold + down) return 1 - (elapsed - up - hold) / Math.max(1, down);
  return 0;
}

/** Длина круга постановки: три попадания и пауза. */
export function screenHitsLoop(project) {
  const { RampUpDuration: up, HoldDuration: hold, RampDownDuration: down } = screenHitsValues(project);
  return Math.max(2200, (up + hold + down) * 1.9 + 600);
}

const mix = (a, b, t) => a + (b - a) * t;
const css = (rgb) => `rgb(${rgb.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255)).join(", ")})`;

const tintCache = new Map();

/* Маска, залитая цветом: цвет — по маске, альфа — её же. */
function tinted(mask, colour) {
  let entry = tintCache.get(mask);
  if (!entry) {
    if (tintCache.size > 32) tintCache.clear();
    entry = new Map();
    tintCache.set(mask, entry);
  }
  if (entry.has(colour)) return entry.get(colour);
  const canvas = blankCanvas(EDGE, EDGE);
  const context = context2d(canvas);
  if (!context) return null;
  context.fillStyle = colour;
  context.fillRect(0, 0, EDGE, EDGE);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(mask, 0, 0);
  if (entry.size > 16) entry.clear();
  entry.set(colour, canvas);
  return canvas;
}

/**
 * Где кончик следа: луч из центра экрана под углом `angle` (0 — вправо, по часовой, y вниз) до рамки безопасной зоны. Кончик лежит у края экрана
 * (в игре — `ScreenSafeZoneLength` от центра по лучу), а не на эллипсе, где диагональные следы оказывались почти в середине кадра (владелец,
 * 24.10 вечером: «правое попадание почти посередине»).
 */
export function screenHitTip({ width, height, angle }) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const reach = Math.min(Math.abs(dx) > 1e-9 ? ((width / 2) * SAFE_ZONE) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? ((height / 2) * SAFE_ZONE) / Math.abs(dy) : Infinity);
  return { x: width / 2 + dx * reach, y: height / 2 + dy * reach };
}

/*
 * Один след: кончик (низ маски) — у края экрана со стороны выстрела, основание
 * — к центру. Ширина плавно идёт от основания к кончику полосами.
 */
function paintShot(context, { width, height, mask, values, angle, strength }) {
  if (strength <= 0.001) return;
  const dy = Math.sin(angle);
  const { x: tipX, y: tipY } = screenHitTip({ width, height, angle });
  const length = values.SpriteLength * height;
  const base = values.SpriteBaseWidth * height;
  const tip = values.SpriteTipWidth * height;
  /* Низ и верх экрана: цвет и прозрачность — по высоте середины следа. */
  const middleY = tipY - dy * length * 0.5;
  const t = Math.min(1, Math.max(0, 1 - middleY / height));
  const colour = [0, 1, 2].map((index) => mix(values.ColorBottom[index], values.ColorTop[index], t));
  const alpha = mix(values.GlobalAlphaBottom, values.GlobalAlphaTop, t) * strength;
  drawSprite(context, { mask, colour, alpha, tipX, tipY, angle, length, base, tip });
}

/* Полоски следа складываются на отдельном холсте в полную силу, и только он ложится на кадр
   с прозрачностью работы: полоски, наложенные друг на друга краями с прозрачностью, оставляли на
   стыках тёмные черточки. Холст общий и растёт под самый большой след. */
let strips = null;

function stripsCanvas(width, height) {
  if (!hasDocument()) return null;
  if (!strips) strips = document.createElement("canvas");
  if (strips.width < width) strips.width = width;
  if (strips.height < height) strips.height = height;
  return strips;
}

/* Маска в трапеции: кончик в (tipX, tipY), ось «вверх по маске» — от угла. */
function drawSprite(context, { mask, colour, alpha, tipX, tipY, angle, length, base, tip }) {
  const paint = tinted(mask, css(colour));
  if (!paint || alpha <= 0.001) return;
  /* Плотность пикселей кадра: полоски собираются в пикселях устройства, иначе на плотном экране след мылится. */
  const ratio = context.getTransform?.().a || 1;
  const width = Math.ceil(Math.max(base, tip) * ratio) + 2;
  const height = Math.max(STRIPS, Math.ceil(length * ratio));
  const layer = stripsCanvas(width, height);
  const layerContext = layer?.getContext("2d");
  if (!layerContext) return;
  layerContext.setTransform(1, 0, 0, 1, 0, 0);
  layerContext.clearRect(0, 0, layer.width, layer.height);
  const slice = EDGE / STRIPS;
  for (let strip = 0; strip < STRIPS; strip += 1) {
    const v = (strip + 0.5) / STRIPS;
    const w = mix(base, tip, v) * ratio;
    /* Границы полосок — целые пиксели: без наложения и без щелей. */
    const top = Math.round((strip * height) / STRIPS);
    const bottom = Math.round(((strip + 1) * height) / STRIPS);
    layerContext.drawImage(paint, 0, strip * slice, EDGE, slice, (width - w) / 2, top, w, bottom - top);
  }
  context.save();
  context.translate(tipX, tipY);
  /* Ось «вверх по маске» смотрит к центру экрана. */
  context.rotate(angle - Math.PI / 2);
  context.globalAlpha = Math.min(1, alpha);
  context.drawImage(layer, 0, 0, width, height, -width / ratio / 2, -height / ratio, width / ratio, height / ratio);
  context.restore();
}

/**
 * Плитка готового вида: один след крупно — от левого края вглубь, теми же
 * цветом, прозрачностью и пропорциями, что в игре (середина экрана по
 * высоте). Целый экран в плитке шириной в палец не разглядеть.
 */
export function paintScreenHitsTile({ context, width, height, project, mask }) {
  const wall = matteWall(width, height);
  context.drawImage(wall, 0, 0, width, height);
  if (!mask) return;
  const values = screenHitsValues(project);
  const length = width * 0.8;
  const scale = length / Math.max(0.05, values.SpriteLength);
  const fit = Math.min(1, (height * 0.92) / Math.max(1e-3, values.SpriteBaseWidth * scale, values.SpriteTipWidth * scale));
  drawSprite(context, {
    mask,
    colour: [0, 1, 2].map((index) => mix(values.ColorBottom[index], values.ColorTop[index], 0.5)),
    alpha: mix(values.GlobalAlphaBottom, values.GlobalAlphaTop, 0.5),
    tipX: width * 0.04,
    tipY: height / 2,
    angle: Math.PI,
    length,
    base: values.SpriteBaseWidth * scale * fit,
    tip: values.SpriteTipWidth * scale * fit,
  });
}

/* Точка прицела посередине: по ней видно, где центр экрана. */
function paintCrosshair(context, width, height) {
  context.save();
  context.fillStyle = "rgba(255, 255, 255, 0.75)";
  context.beginPath();
  context.arc(width / 2, height / 2, Math.max(1.5, height * 0.004), 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/*
 * Тряска на попадание (редизайн 17.10.2026: «лёгкая тряска камеры на каждый
 * выстрел»). Трясётся мир за экраном, а не интерфейс: точка прицела и след
 * на экране стоят, как в игре. Камеру толкает от стороны выстрела, толчок
 * гаснет за четверть секунды. Сдвиг — в долях высоты кадра.
 */
const SHAKE_MS = 260;
const SHAKE_AMOUNT = 0.012;

export function screenHitsShake(project, moment) {
  if (moment === null) return { x: 0, y: 0 };
  const loop = screenHitsLoop(project);
  let x = 0;
  let y = 0;
  for (const shot of SCREEN_HITS_SHOTS) {
    const elapsed = (((moment - shot.delay * loop) % loop) + loop) % loop;
    if (elapsed >= SHAKE_MS) continue;
    const fade = (1 - elapsed / SHAKE_MS) ** 2;
    const swing = Math.sin((elapsed / SHAKE_MS) * Math.PI * 5);
    const push = SHAKE_AMOUNT * fade * swing;
    /* От выстрела — прочь, и чуть поперёк: живой толчок, а не рельс. */
    x += -Math.cos(shot.angle) * push + Math.sin(shot.angle) * push * 0.35;
    y += -Math.sin(shot.angle) * push - Math.cos(shot.angle) * push * 0.35;
  }
  return { x, y };
}

/*
 * Светлее матовой стены килла: след игры — полупрозрачная краска поверх
 * светлого мира, и на чёрном его 25 % не видно вовсе. Средняя яркость кадра
 * игры днём — около половины, отсюда серый, а не чёрный.
 */
function paintBackdrop(context, width, height, shake, matte) {
  /* Обложка полки — на чёрном, как все обложки (18.10.2026): серый подъём и
     свет стены нужны только кадру редактора. */
  if (matte) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    return;
  }
  const wall = matteWall(width, height);
  const grow = 1.04;
  context.save();
  context.translate(width / 2 + shake.x * height, height / 2 + shake.y * height);
  context.scale(grow, grow);
  context.drawImage(wall, -width / 2, -height / 2, width, height);
  const lift = context.createLinearGradient(0, -height / 2, 0, height / 2);
  lift.addColorStop(0, "rgba(150, 156, 164, 0.42)");
  lift.addColorStop(1, "rgba(98, 102, 108, 0.42)");
  context.fillStyle = lift;
  context.fillRect(-width / 2, -height / 2, width, height);
  context.restore();
}

/*
 * Лента времени внизу кадра: у каждого из трёх попаданий своя трапеция —
 * нарастание, удержание, спад (RampUp / Hold / RampDown игры) — и бегунок
 * «сейчас». По ней видно, что меняет каждое из трёх чисел времени.
 */
function paintTimeline(context, width, height, project, moment, colour) {
  const loop = screenHitsLoop(project);
  const { RampUpDuration: up, HoldDuration: hold, RampDownDuration: down } = screenHitsValues(project);
  const margin = Math.round(Math.max(14, width * 0.025));
  const barH = Math.round(Math.max(20, height * 0.038));
  /* Левая половина: справа внизу стоит подпись кадра. */
  const x0 = margin;
  const x1 = x0 + Math.min(width * 0.52, 520);
  const y1 = height - margin;
  const y0 = y1 - barH;
  const at = (ms) => x0 + ((x1 - x0) * ms) / loop;
  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.5)";
  context.beginPath();
  context.roundRect?.(x0 - 6, y0 - 6, x1 - x0 + 12, barH + 12, 8);
  if (!context.roundRect) context.rect(x0 - 6, y0 - 6, x1 - x0 + 12, barH + 12);
  context.fill();
  SCREEN_HITS_SHOTS.forEach((shot, index) => {
    const start = shot.delay * loop;
    const points = [
      [start, 0],
      [start + up, 1],
      [start + up + hold, 1],
      [start + up + hold + down, 0],
    ];
    const lane = y1 - index * 2;
    context.beginPath();
    for (const [ms, level] of points) {
      const px = at(Math.min(loop, ms));
      const py = lane - level * (barH - 6);
      if (ms === start) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.globalAlpha = 0.4;
    context.fillStyle = colour;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = "rgba(255, 255, 255, 0.4)";
    context.lineWidth = 1;
    context.stroke();
  });
  const head = at(((moment % loop) + loop) % loop);
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(head, y0 - 2);
  context.lineTo(head, y1 + 2);
  context.stroke();
  context.restore();
}

/**
 * Кадр: стена, точка прицела и три следа в момент `moment` круга (мс) —
 * или все три на пике (`moment = null`: плитки и обложка).
 * `view` — `third` или `first` (у вида от первого лица след крупнее).
 * `timeline` — ленту времени рисует только живой кадр редактора.
 */
export function paintScreenHits({ context, width, height, project, mask, moment = null, view = "third", timeline = false, matte = false }) {
  paintBackdrop(context, width, height, screenHitsShake(project, moment), matte);
  paintCrosshair(context, width, height);
  if (!mask) return;
  const values = screenHitsValues(project, view);
  const loop = screenHitsLoop(project);
  for (const shot of SCREEN_HITS_SHOTS) {
    const strength = moment === null ? 1 : screenHitsEnvelope(project, (((moment - shot.delay * loop) % loop) + loop) % loop);
    paintShot(context, { width, height, mask, values, angle: shot.angle, strength });
  }
  if (timeline && moment !== null)
    paintTimeline(context, width, height, project, moment, css([0, 1, 2].map((index) => mix(values.ColorBottom[index], values.ColorTop[index], 0.5))));
}

/** Сколько живёт одно попадание: нарастание, удержание и спад следа, мс. */
export function screenHitsSpan(project) {
  const { RampUpDuration: up, HoldDuration: hold, RampDownDuration: down } = screenHitsValues(project);
  return up + hold + down;
}

/**
 * Метки следов поверх живого 3D-кадра (`CombatScreenHitsStage.jsx`): ни стены,
 * ни точки прицела — под ними сцена боя. Каждая метка — одно попадание под своим
 * углом (откуда стреляли, `hitAngle`) и со своим временем; рисует их тот же `paintShot`,
 * что и плоский кадр, поэтому след на экране — тот же.
 *
 * @param {Array<{ angle: number, elapsedMs: number }>} marks
 */
export function paintScreenHitMarks({ context, width, height, project, mask, marks, view = "third" }) {
  context.clearRect(0, 0, width, height);
  if (!mask || !marks?.length) return;
  const values = screenHitsValues(project, view);
  for (const mark of marks)
    paintShot(context, { width, height, mask, values, angle: mark.angle, strength: screenHitsEnvelope(project, mark.elapsedMs) });
}

/** RGBA маски (для проверки и тестов) — та же, что уходит в игру. */
export const screenHitsMaskPixels = (project, picture = null) => {
  const field = screenHitsMask(project, picture);
  return field ? screenHitsMaskRgba(field) : null;
};
