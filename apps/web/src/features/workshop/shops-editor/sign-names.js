/*
 * Названия заправок — плашки-вывески (задача 5 ТЗ 17.10.2026, вечер).
 *
 * Название станции — одни слова и один вид (шрифт, цвет букв, фон плашки);
 * плашка встаёт на выбранные грани вывесок станции (`sign-faces.js`) и
 * закрывает старую надпись целиком: фон — цвет вывески, размер — грань.
 * Список лежит в работе отдельно от эмблем (`outside.names`), у каждой плашки
 * свой `location` — станция. Окно рисует плашку само (`emblem-items.js`) и
 * кладёт картинку в работу без шага истории — как у эмблем-надписей.
 */

import { useCallback, useEffect, useRef } from "react";
import { EMBLEM_BACKDROP_RATIO, emblemTextFilled, nextEmblemId } from "@modovik/climb-contract/recolor/emblems";
import { OUTSIDE_EMBLEM_SIZE, OUTSIDE_NAME_LIMIT } from "@modovik/climb-contract/recolor/shops-outside";
import { drawEmblemText, pendingTexts } from "../emblem/emblem-items.js";

export const readNames = (project) => project.outside.names || [];
export const writeNames = (project, names) => ({ ...project, outside: { ...project.outside, names } });

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));
const round2 = (value) => Math.round(value * 100) / 100;

/** Вид названия по умолчанию: слов нет, рубленый шрифт, фон — цвет вывески `backdrop`, буквы — светлые или тёмные по фону. */
export function defaultNameStyle(backdrop = "#c8c8c8") {
  const value = parseInt(String(backdrop).slice(1), 16) || 0;
  const luma = (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
  return { value: "", font: "block", colour: luma > 0.55 ? "#101114" : "#f6f6f6", outline: "none", backdrop };
}

/** Плашка названия на этой грани станции (по месту и нормали) или `null`. */
export const nameOnFace = (names, placeId, face) =>
  names.find((item) => item.location === placeId && item.point && dot(item.normal, face.normal) > 0.9 && Math.hypot(item.point[0] - face.centre[0], item.point[1] - face.centre[1], item.point[2] - face.centre[2]) <= 0.6) || null;

/** Плашки названия этой станции. */
export const namesOf = (names, placeId) => names.filter((item) => item.location === placeId);

/** Пропорции плашки по грани: ширина к высоте, в пределах договора. */
const ratioOf = (face) => round2(clamp(face.width / Math.max(0.1, face.height), EMBLEM_BACKDROP_RATIO));

/** Список с плашкой на грани: новая или обновлённая (слова и вид — `style`, пропорции — по грани). */
export function putName(names, placeId, face, style) {
  const text = { ...style, ratio: ratioOf(face) };
  const size = round2(clamp(face.height, OUTSIDE_EMBLEM_SIZE));
  const present = nameOnFace(names, placeId, face);
  if (present) return names.map((item) => (item === present ? { ...item, text, size, sign: face.id } : item));
  if (names.length >= OUTSIDE_NAME_LIMIT) return names;
  return [
    ...names,
    { id: nextEmblemId(names), kind: "text", text, label: "", location: placeId, point: [...face.centre], normal: [...face.normal], size, opacity: 100, angle: 0, sign: face.id, asset: "", name: "", width: 0, height: 0, drawn: "" },
  ];
}

/** Список без плашки на грани. */
export const dropName = (names, placeId, face) => {
  const present = nameOnFace(names, placeId, face);
  return present ? names.filter((item) => item !== present) : names;
};

/** Список без названия станции. */
export const clearNames = (names, placeId) => names.filter((item) => item.location !== placeId);

/** Новый вид всем плашкам станции (пропорции каждой остаются). */
export const restyleNames = (names, placeId, style) =>
  names.map((item) => (item.location === placeId ? { ...item, text: { ...style, ratio: item.text.ratio } } : item));

/** Слов нет — плашка не едет в игру; сколько таких плашек и сколько едет. */
export const namesReady = (names) => names.filter((item) => emblemTextFilled(item.text)).length;

/**
 * Хук названий: дорисовывает плашки без свежей картинки (шага истории не
 * делает). Правки идут через `commit` редактора — `update(change, подпись)`.
 */
export function useSignNames({ project, commit, amend, onNotice = null }) {
  const names = readNames(project);
  const drawing = useRef(new Set());
  const failed = useRef(new Set());
  useEffect(() => {
    for (const item of pendingTexts(names)) {
      const key = JSON.stringify(item.text);
      if (drawing.current.has(key) || failed.current.has(key)) continue;
      drawing.current.add(key);
      drawEmblemText(item.text)
        .then((drawn) => {
          if (!drawn) {
            failed.current.add(key);
            return;
          }
          amend((current) =>
            writeNames(
              current,
              readNames(current).map((other) =>
                other.id === item.id && JSON.stringify(other.text) === key ? { ...other, asset: drawn.asset, name: drawn.name, width: drawn.width, height: drawn.height, drawn: drawn.drawn } : other,
              ),
            ),
          );
        })
        .catch((error) => {
          failed.current.add(key);
          onNotice?.(String(error?.message || error), "error");
        })
        .finally(() => drawing.current.delete(key));
    }
  }, [names, amend, onNotice]);
  const update = useCallback((change, label) => commit((current) => writeNames(current, change(readNames(current))), label), [commit]);
  return { names, update };
}
