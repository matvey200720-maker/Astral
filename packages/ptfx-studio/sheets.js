/*
 * Листы брызг крови, которые рисует приложение.
 *
 * Лист — сетка 4×4 кадров на квадрате 512: каждая частица пыли и каждая капля
 * крови в игре рисуется одним кадром такого листа. Штатный лист несёт красный
 * прямо в пикселях; наши листы белые с прозрачностью — цвет им даёт правило
 * клона, и один лист годится для любой крови.
 *
 * Лист описан SVG и растрируется дважды одним и тем же описанием: окно кладёт
 * его на холст, установщик отдаёт sharp и кодирует в DDS. Поэтому в игре
 * оказывается ровно то, что человек видел в окне, а сам лист детерминирован:
 * весь «случайный» разброс пятен идёт из генератора, засеянного стилем.
 *
 * Стили двух родов. Нарисованные брызги (кляксы, капли, дымка, осколки)
 * идут кадрами как развитие одного всплеска — частица проигрывает их за свою
 * жизнь, как штатная пыль. Значки и своя картинка — шестнадцать вариантов с
 * разным поворотом и размером: частица берёт один случайный кадр и держит
 * его, иначе сердечко мигало бы шестнадцатью сердечками.
 */

import { impactPictureMarkup } from "./pictures.js";
import {
  BLOOD_SHEET_GRID,
  BLOOD_SHEET_LAYOUT,
  findBloodSheet,
} from "./impact.js";
import { seedFrom } from "./shapes.js";

const SIZE = BLOOD_SHEET_LAYOUT.width;
export const BLOOD_SHEET_FRAMES =
  BLOOD_SHEET_GRID.columns * BLOOD_SHEET_GRID.rows;
export const BLOOD_SHEET_FRAME = SIZE / BLOOD_SHEET_GRID.columns;

/** Быстрый детерминированный генератор — тот же, что у текстур следа. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value) => Math.round(value * 100) / 100;
const between = (next, min, max) => min + (max - min) * next();
const TAU = Math.PI * 2;

/** Кадр листа: левый верхний угол по номеру. */
export function bloodSheetFrameOrigin(index) {
  const column = index % BLOOD_SHEET_GRID.columns;
  const row = Math.floor(index / BLOOD_SHEET_GRID.columns);
  return { x: column * BLOOD_SHEET_FRAME, y: row * BLOOD_SHEET_FRAME };
}

/*
 * Нарисованные брызги: кадр — момент одного всплеска, `phase` от 0 до 1.
 * Всё белое; форма и прозрачность — единственное, что лист несёт.
 */
function splatFrame(next, phase) {
  const parts = [];
  const cx = BLOOD_SHEET_FRAME / 2;
  const cy = BLOOD_SHEET_FRAME / 2;
  const grow = 0.55 + 0.45 * phase;
  const fade = 1 - 0.55 * phase * phase;
  /* Ядро кляксы — три наложенных эллипса со своим наклоном. */
  for (let blob = 0; blob < 3; blob += 1) {
    const rx = between(next, 16, 26) * grow;
    const ry = between(next, 12, 22) * grow;
    const turn = between(next, 0, 180);
    const dx = between(next, -6, 6);
    const dy = between(next, -6, 6);
    parts.push(
      `<ellipse cx="${round(cx + dx)}" cy="${round(cy + dy)}" rx="${round(rx)}" ry="${round(ry)}" transform="rotate(${round(turn)} ${round(cx + dx)} ${round(cy + dy)})" fill="#fff" fill-opacity="${round(fade)}"/>`,
    );
  }
  /* Брызги по краю: чем позже кадр, тем дальше от ядра и мельче. */
  const satellites = 6 + Math.round(next() * 5);
  for (let index = 0; index < satellites; index += 1) {
    const angle = next() * TAU;
    const away = between(next, 18, 30) + phase * between(next, 8, 26);
    const radius = between(next, 2.5, 7) * (1 - 0.4 * phase);
    parts.push(
      `<circle cx="${round(cx + Math.cos(angle) * away)}" cy="${round(cy + Math.sin(angle) * away)}" r="${round(radius)}" fill="#fff" fill-opacity="${round(fade * 0.9)}"/>`,
    );
  }
  return parts.join("");
}

function dropsFrame(next, phase) {
  const parts = [];
  const cx = BLOOD_SHEET_FRAME / 2;
  const cy = BLOOD_SHEET_FRAME / 2;
  const count = 4 + Math.round(next() * 3);
  const fade = 1 - 0.5 * phase;
  for (let index = 0; index < count; index += 1) {
    const angle = next() * TAU;
    const away = between(next, 4, 20) + phase * between(next, 10, 30);
    const rx = between(next, 4, 8) * (1 - 0.25 * phase);
    const ry = rx * between(next, 2.2, 3.4);
    const x = cx + Math.cos(angle) * away;
    const y = cy + Math.sin(angle) * away;
    const turn = (angle * 180) / Math.PI + 90;
    /* Капля — вытянутый эллипс с острым хвостом к центру. */
    parts.push(
      `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(rx)}" ry="${round(ry)}" transform="rotate(${round(turn)} ${round(x)} ${round(y)})" fill="#fff" fill-opacity="${round(fade)}"/>`,
    );
    parts.push(
      `<circle cx="${round(x)}" cy="${round(y)}" r="${round(rx * 1.15)}" fill="#fff" fill-opacity="${round(fade)}"/>`,
    );
  }
  return parts.join("");
}

function mistFrame(next, phase, index) {
  const parts = [];
  const cx = BLOOD_SHEET_FRAME / 2;
  const cy = BLOOD_SHEET_FRAME / 2;
  const puffs = 3 + Math.round(next() * 2);
  const grow = 0.6 + 0.5 * phase;
  const fade = 0.85 * (1 - 0.6 * phase);
  for (let puff = 0; puff < puffs; puff += 1) {
    const id = `m${index}_${puff}`;
    const radius = between(next, 22, 38) * grow;
    const dx = between(next, -14, 14);
    const dy = between(next, -14, 14);
    parts.push(
      `<radialGradient id="${id}"><stop offset="0" stop-color="#fff" stop-opacity="${round(fade)}"/><stop offset="0.55" stop-color="#fff" stop-opacity="${round(fade * 0.45)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
    );
    parts.push(
      `<circle cx="${round(cx + dx)}" cy="${round(cy + dy)}" r="${round(radius)}" fill="url(#${id})"/>`,
    );
  }
  return parts.join("");
}

function shardsFrame(next, phase) {
  const parts = [];
  const cx = BLOOD_SHEET_FRAME / 2;
  const cy = BLOOD_SHEET_FRAME / 2;
  const count = 7 + Math.round(next() * 5);
  const fade = 1 - 0.5 * phase;
  for (let index = 0; index < count; index += 1) {
    const angle = next() * TAU;
    const away = between(next, 6, 22) + phase * between(next, 12, 30);
    const length = between(next, 10, 24) * (1 - 0.3 * phase);
    const width = between(next, 3, 7);
    const x = cx + Math.cos(angle) * away;
    const y = cy + Math.sin(angle) * away;
    const turn = round(next() * 360);
    /* Осколок — острый треугольник со случайным поворотом. */
    parts.push(
      `<polygon points="${round(-length / 2)},${round(width / 2)} ${round(length / 2)},0 ${round(-length / 2)},${round(-width / 2)}" transform="translate(${round(x)} ${round(y)}) rotate(${turn})" fill="#fff" fill-opacity="${round(fade)}"/>`,
    );
  }
  return parts.join("");
}

const DRAWN = Object.freeze({
  splat: splatFrame,
  drops: dropsFrame,
  mist: mistFrame,
  shards: shardsFrame,
});

/**
 * Разметка одного кадра — значок или своя картинка с поворотом и размером.
 * `href` — data-URL картинки человека (кадр 256×256 с прозрачным полем).
 */
function stampFrame(next, style, href) {
  const turn = round(between(next, -35, 35));
  const scale = round(between(next, 0.55, 0.92));
  const side = BLOOD_SHEET_FRAME * scale;
  const offset = round((BLOOD_SHEET_FRAME - side) / 2);
  const centre = round(BLOOD_SHEET_FRAME / 2);
  const inner = href
    ? `<image href="${href}" x="0" y="0" width="${BLOOD_SHEET_FRAME}" height="${BLOOD_SHEET_FRAME}" preserveAspectRatio="xMidYMid meet"/>`
    : impactPictureMarkup(style, BLOOD_SHEET_FRAME, "#ffffff");
  return (
    `<g transform="rotate(${turn} ${centre} ${centre}) translate(${offset} ${offset}) scale(${scale})">` +
    inner +
    "</g>"
  );
}

/**
 * SVG листа брызг: сетка 4×4 кадров на квадрате 512. `upload` — data-URL
 * картинки человека для стиля «своя картинка».
 */
export function bloodSheetSvg(style, { upload = null } = {}) {
  const item = findBloodSheet(style);
  if (!item || item.game) throw new Error(`Лист брызг ${style} не рисуется.`);
  if (item.upload && !upload)
    throw new Error("Для листа «Своя картинка» нужна сама картинка.");
  const next = seededRandom(seedFrom(["blood-sheet", style]));
  const frames = [];
  for (let index = 0; index < BLOOD_SHEET_FRAMES; index += 1) {
    const { x, y } = bloodSheetFrameOrigin(index);
    const phase = index / (BLOOD_SHEET_FRAMES - 1);
    const body = DRAWN[style]
      ? DRAWN[style](next, phase, index)
      : stampFrame(next, item.glyph || style, item.upload ? upload : null);
    frames.push(`<g transform="translate(${x} ${y})">${body}</g>`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    frames.join("") +
    "</svg>"
  );
}

/** Отпечаток листа для имени текстуры: стиль или стиль с картинкой. */
export function bloodSheetKey(style, uploadKey = "") {
  const clean = String(uploadKey || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
  return style === "upload" ? `u${clean || "none"}` : String(style);
}
