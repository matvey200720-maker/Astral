/*
 * Признак фильма от опции «HP по всему экрану (проба)» — по байтам файла (подробно: `minimap-film-repair.js`).
 *
 * Рост сцены вернулся 02.11.2026 («HP отдельно от карты», группа за кадром), но теперь растут и записи `pausemap`, `gallery`,
 * `golf_courses`. Новый фильм несёт в том же действии метку `MINIMAP_WIDE_SCENE_MARK`: это работа человека, её не чинят
 * (`minimapFilmDamage` — `null`), но и основой она не бывает (`minimapWideScene`).
 *
 * Прежняя опция расширяла сцену на `x`, `y` точек с каждой стороны: рамка заголовка росла на `2x`, `2y`, а перед первым
 * действием первого кадра вставлялось своё — только `this._x = x` и `this._y = y`. Признак — обе части и их согласие: сцена
 * = штатная + удвоенный сдвиг. У чужой мини-карты со своим размером сцены такого действия нет, и она не трогается.
 *
 * Отдельным файлом, потому что признак нужен и основе мини-карты (`verifyMinimapBase`), и починке, а починка сама зависит
 * от компилятора.
 */

import { MINIMAP_SCENE, MINIMAP_TWIPS } from "@modovik/minimap-contract";
import { AVM1, parseActions, readPush } from "./scaleform-avm1.js";
import { SWF_TAG, parseSwfTags, readRect, scaleformHeaderLength, uncompressedScaleform } from "./scaleform-swf.js";

/** Метка широкого фильма: поле корня в первом действии рядом со сдвигом (`widenMinimapScene`). */
export const MINIMAP_WIDE_SCENE_MARK = "astralWideScene";

/* Значения сдвига из действия корня; `null` — действие не только про сдвиг корня (метка широкого фильма — про него). */
function rootShiftOf(buffer, tag) {
  const start = tag.payloadStart;
  const records = parseActions(buffer, start, start + tag.length);
  const shift = {};
  let at = 0;
  while (records[at] && records[at].code !== AVM1.END) {
    /* this._x = 510 → Push "this"; GetVariable; Push "_x", 510; SetMember */
    const [pushThis, get, pushValue, set] = records.slice(at, at + 4);
    if (
      pushThis?.code !== AVM1.PUSH ||
      get?.code !== AVM1.GET_VARIABLE ||
      pushValue?.code !== AVM1.PUSH ||
      set?.code !== AVM1.SET_MEMBER
    )
      return null;
    const target = readPush(buffer, pushThis);
    const [name, value, ...rest] = readPush(buffer, pushValue);
    if (target.length !== 1 || target[0] !== "this" || rest.length) return null;
    const known = name === "_x" || name === "_y" || name === MINIMAP_WIDE_SCENE_MARK;
    if (!known || typeof value !== "number" || name in shift) return null;
    shift[name] = value;
    at += 4;
  }
  if (shift._x === undefined && shift._y === undefined) return null;
  return { x: shift._x || 0, y: shift._y || 0, marked: MINIMAP_WIDE_SCENE_MARK in shift };
}

/**
 * Что опция сделала с фильмом: `{ scene: {width, height}, shift: {x, y} }` или `null`, если фильм такой не испорчен.
 * Файл, который не разбирается как фильм, — не её: `null`.
 */
export function minimapFilmDamage(bytes) {
  const film = widenedFilm(bytes);
  return film && !film.marked ? { scene: film.scene, shift: film.shift } : null;
}

/**
 * Широкий фильм работы «HP отдельно от карты»: `{ scene, shift }` или `null`. Его записи frontend.xml выросли вместе с ним.
 */
export function minimapWideScene(bytes) {
  const film = widenedFilm(bytes);
  return film?.marked ? { scene: film.scene, shift: film.shift } : null;
}

/* Сцена шире штатной ровно на удвоенный сдвиг корня, и первое действие кадра — только про это. */
function widenedFilm(bytes) {
  let buffer;
  let tags;
  let rect;
  try {
    buffer = uncompressedScaleform(bytes);
    ({ rect } = readRect(buffer, 8));
    tags = parseSwfTags(buffer, scaleformHeaderLength(buffer));
  } catch {
    return null;
  }
  if (rect.xmin !== 0 || rect.ymin !== 0) return null;
  const scene = { width: rect.xmax / MINIMAP_TWIPS, height: rect.ymax / MINIMAP_TWIPS };
  if (scene.width <= MINIMAP_SCENE.width && scene.height <= MINIMAP_SCENE.height) return null;
  const frame = tags.findIndex((tag) => tag.code === SWF_TAG.SHOW_FRAME);
  if (frame < 0) return null;
  const first = tags.slice(0, frame).find((tag) => tag.code === SWF_TAG.DO_ACTION);
  if (!first) return null;
  let shift;
  try {
    shift = rootShiftOf(buffer, first);
  } catch {
    return null;
  }
  if (!shift) return null;
  if (scene.width !== MINIMAP_SCENE.width + 2 * shift.x || scene.height !== MINIMAP_SCENE.height + 2 * shift.y) return null;
  return { scene, shift: { x: shift.x, y: shift.y }, marked: shift.marked };
}
