/*
 * Свой текст на экране, вывеске и полосе банкомата (ТЗ 18.10.2026, задача 5.2:
 * «Свой текст на экране» — текст, шрифт, цвет, фон).
 *
 * Слова — та же картинка, что у надписей мест (`emblem-items.js`): окно рисует
 * плашку (фон цвета, слова по центру, кегль под рамку), кладёт PNG в хранилище
 * окна под отпечатком (`finish-image:<sha256>`, как свои картинки) и помнит, по
 * каким параметрам нарисовала (`image.name` = `atm-text:<ключ>`). Дальше у
 * текста и картинки один путь: кадр строит составной лист, установщик получает
 * base64 PNG. Рисуется во всю ширину листа (1024 px): слова должны остаться
 * чёткими, когда установщик поднимет лист экрана до ≥1024.
 *
 * Картинка достраивается без шага истории (`amend`), как у надписей мест:
 * человек правит слова, а не картинку.
 */

import { useEffect, useRef } from "react";
import { ATM_TEXT_ASPECT, ATM_TEXT_PARTS, atmSurfaceHasPicture, normalizeAtmText, normalizeAtmsProject, ATM_TYPES } from "@modovik/climb-contract/recolor/atms";
import { emblemTextFilled, emblemTextKey } from "@modovik/climb-contract/recolor/emblems";
import { emblemCanvasFont, ensureEmblemFont } from "../emblem/emblem-items.js";
import { saveFinishImage } from "../finish/finish-assets.js";

/** Сторона картинки текста, px: длинная сторона плашки. */
export const ATM_TEXT_SIDE = 1024;
const KEY_PREFIX = "atm-text:";
const DEBOUNCE_MS = 250;

/** Ключ нарисованного текста части: слова, шрифт, цвета и пропорция плашки. */
export const atmTextKey = (text, part) => `${emblemTextKey(normalizeAtmText(text))}@${part}`;

/** Плашка со словами на холсте или `null` (пусто, нет холста). */
export function renderAtmText(input, part) {
  const text = normalizeAtmText(input);
  if (!emblemTextFilled(text) || typeof document === "undefined") return null;
  const aspect = ATM_TEXT_ASPECT[part] || 1.3;
  const canvas = document.createElement("canvas");
  /* Длинная сторона — 1024: у экрана это высота и ширина вровень, у вывески — ширина. */
  canvas.width = ATM_TEXT_SIDE;
  canvas.height = Math.max(64, Math.round(ATM_TEXT_SIDE / aspect));
  let context = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    context = null;
  }
  if (!context) return null;
  context.fillStyle = text.backdrop;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const line = text.value.trim();
  const font = text.font === "custom" ? emblemCanvasFont(text) : emblemCanvasFont({ ...text, font: ["modern", "block", "wide", "serif", "stencil", "script", "mono"].includes(text.font) ? text.font : "modern" });
  context.font = font;
  const basePx = Number(/(\d+)px/.exec(font)?.[1] || 160);
  const natural = context.measureText(line).width;
  /* Кегль: слова целиком в рамку — и по ширине, и по высоте, с полем от краёв. */
  const scale = Math.min((canvas.width * 0.88) / Math.max(1, natural), (canvas.height * 0.72) / (basePx * 1.1), 8);
  context.font = font.replace(/(\d+)px/, `${Math.max(6, Math.round(basePx * scale))}px`);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = text.colour;
  context.fillText(line, canvas.width / 2, canvas.height / 2);
  return canvas;
}

const canvasBlob = (canvas) =>
  new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });

/* Что уже нарисовано в этом окне: ключ → поля картинки части. */
const drawn = new Map();

/** Рисует текст части и кладёт PNG в хранилище окна: поля `image` части или `null`, если рисовать нечем. */
export async function drawAtmText(text, part) {
  const key = atmTextKey(text, part);
  if (drawn.has(key)) return drawn.get(key);
  /* Свой шрифт — в набор шрифтов документа до холста: в картинке для игры не должно оказаться запасного. */
  if (text.font === "custom" && !(await ensureEmblemFont(text.fontAsset))) throw new Error("Файл своего шрифта пропал из хранилища окна — загрузите его ещё раз.");
  const canvas = renderAtmText(text, part);
  const blob = canvas ? await canvasBlob(canvas) : null;
  if (!blob) return null;
  const file = typeof File === "function" ? new File([blob], "text.png", { type: "image/png" }) : Object.assign(blob, { name: "text.png" });
  const saved = await saveFinishImage(file);
  const image = { asset: saved.asset, name: `${KEY_PREFIX}${key}`, width: saved.width, height: saved.height };
  drawn.set(key, image);
  return image;
}

/* Все облики работы со своим местом в ней: `[путь, облик]` — общий и заведённые у моделей. */
function looksOf(project) {
  const normal = normalizeAtmsProject(project);
  return [["all", normal.all], ...ATM_TYPES.filter((type) => normal.types[type.id]?.own).map((type) => [type.id, normal.types[type.id]])];
}

/** Тексты работы, у которых картинка не нарисована или устарела: `[{ key, text, part }]` без повторов. */
export function pendingAtmTexts(project) {
  const jobs = new Map();
  for (const [, look] of looksOf(project))
    for (const part of ATM_TEXT_PARTS) {
      const surface = look.parts[part];
      if (surface?.mode !== "text" || !emblemTextFilled(normalizeAtmText(surface.text))) continue;
      const key = atmTextKey(surface.text, part);
      if (atmSurfaceHasPicture(surface) && surface.image.name === `${KEY_PREFIX}${key}`) continue;
      jobs.set(key, { key, text: surface.text, part });
    }
  return [...jobs.values()];
}

/* Работа с картинками текстов, что нарисованы: у каждой части с этим ключом — своя картинка. */
function withDrawn(project, key, part, image) {
  const patchLook = (look) => ({
    ...look,
    parts: {
      ...look.parts,
      [part]: look.parts[part]?.mode === "text" && atmTextKey(look.parts[part].text, part) === key ? { ...look.parts[part], image: { ...look.parts[part].image, ...image } } : look.parts[part],
    },
  });
  const normal = normalizeAtmsProject(project);
  return {
    ...normal,
    all: patchLook(normal.all),
    types: Object.fromEntries(Object.entries(normal.types).map(([id, look]) => [id, { ...look, ...patchLook(look) }])),
  };
}

/**
 * Достраивает картинки текстов работы: слова поменяли — через четверть секунды
 * плашка рисуется заново и ложится в работу без шага истории. `onNotice` —
 * отказ хранилища (нет места, картинка отвергнута).
 */
export function useAtmTextImages({ project, amend, onNotice = null }) {
  const busy = useRef(new Set());
  useEffect(() => {
    const jobs = pendingAtmTexts(project).filter((job) => !busy.current.has(job.key));
    if (!jobs.length) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const job of jobs) {
        if (cancelled || busy.current.has(job.key)) continue;
        busy.current.add(job.key);
        try {
          const image = await drawAtmText(job.text, job.part);
          if (image && !cancelled) amend((current) => withDrawn(current, job.key, job.part, image));
        } catch (error) {
          onNotice?.(String(error?.message || error), "error");
        } finally {
          busy.current.delete(job.key);
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Рисуется по смыслу текстов работы, а не по каждой новой функции.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);
}
