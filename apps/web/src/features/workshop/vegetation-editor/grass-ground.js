/*
 * Трава вблизи — настоящий лист земли, а не фото (ТЗ 06.10.2026, вечер,
 * задача 4).
 *
 * В кадре и на плитках готовых видов — тот лист, что красит установщик:
 *  - в городе — газон гольф-клуба Лос-Сантоса (`bh1_43.ytd`,
 *    `im_grass13bdeep_greener`) из игры игрока;
 *  - за городом — земля у Сэнди-Шорс: пустыня Rockstar
 *    (`desertnorthgrp.ytd`, `cs_hp_rsl_hillsscrub`) из игры игрока, а с
 *    травой — лист мода «зеленый сенди шортс», который установщик кладёт на
 *    её место (склад, лист №8 сцены `sandy-terrain.bin`).
 * Свой цвет пересчитывается той же `recolourGrass`, что у установщика, —
 * вживую, на каждую правку. Листы игры читает Astral Desktop
 * (`loadSceneImage`): в браузере без него их нет, и кадр говорит об этом.
 */

import { recolourGrass } from "@modovik/climb-contract/recolor/vegetation";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import { tr } from "../../../locales/ui.js";

export const GOLF_LAWN = Object.freeze({
  game: "x64l.rpf:levels/gta5/_cityw/beverly_01/bh1_43.rpf/bh1_43.ytd",
  texture: "im_grass13bdeep_greener",
});
export const SANDY_DESERT = Object.freeze({
  game: "x64g.rpf:levels/gta5/generic/gtxd.rpf/desertnorthgrp.ytd",
  texture: "cs_hp_rsl_hillsscrub",
});
export const SANDY_GREEN = Object.freeze({ file: "/assets/workshop/vegetation/green/8.webp" });

/** Лист зоны: `{ entry, from, name }` — что в кадре и откуда. */
export function grassSheet(zone, enabled) {
  if (zone === "city")
    return {
      entry: GOLF_LAWN,
      from: "game",
      name: tr("газон гольф-клуба Лос-Сантоса (bh1_43 · im_grass13bdeep_greener)"),
    };
  return enabled
    ? {
        entry: SANDY_GREEN,
        from: "mod",
        name: tr("трава мода «зеленый сенди шортс» на месте пустыни у Сэнди-Шорс"),
      }
    : {
        entry: SANDY_DESERT,
        from: "game",
        name: tr("пустыня у Сэнди-Шорс (desertnorthgrp · cs_hp_rsl_hillsscrub)"),
      };
}

const pixels = new Map();

/**
 * Пиксели листа (`ImageData`) — один раз на окно; `null` — листа нет (игра
 * не подключена или лист не прочитался).
 */
export function loadGrassPixels(entry, size = 512) {
  const key = entry.file || `${entry.game}/${entry.texture}@${size}`;
  if (!pixels.has(key)) {
    const pending = loadSceneImage(entry, size)
      .then((image) => {
        if (!image || typeof document === "undefined") return null;
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      })
      .catch(() => null)
      .then((value) => {
        /* Неудача не остаётся: игру могли подключить позже. */
        if (!value && pixels.get(key) === pending) pixels.delete(key);
        return value;
      });
    pixels.set(key, pending);
  }
  return pixels.get(key);
}

/**
 * Плитка листа в облике работы — холст. `into` — холст прежней плитки того же листа: кадр перерисовывает ту же
 * текстуру, а не заводит новую на каждый шаг цвета (новая текстура ждала прогрева шейдера, и кадр стоял в прежнем
 * цвете).
 */
export function grassTile(base, colour, into = null) {
  const canvas = into && into.width === base.width && into.height === base.height ? into : document.createElement("canvas");
  canvas.width = base.width;
  canvas.height = base.height;
  const data = colour ? recolourGrass(base.data, colour) : base.data;
  canvas
    .getContext("2d")
    ?.putImageData(new ImageData(new Uint8ClampedArray(data), base.width, base.height), 0, 0);
  return canvas;
}

/**
 * Заливает холст повтором плитки: `across` плиток по ширине. Холста или
 * узора нет (jsdom) — ничего не делает.
 */
export function fillWithTile(canvas, tile, across) {
  const context = canvas?.getContext?.("2d");
  if (!context || !tile) return false;
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) return false;
  const scale = canvas.width / across / Math.max(tile.width, 1);
  if (typeof DOMMatrix === "function") pattern.setTransform?.(new DOMMatrix().scaleSelf(scale, scale));
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = pattern;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return true;
}
