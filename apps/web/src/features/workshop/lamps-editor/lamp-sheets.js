/*
 * Листы роя фонаря: тот, что нарисует кадр, — из ядра игрока и из листов Astral.
 *
 * Листы Astral из листов ядра игрока — тем же кодом, что у установщика: крылья
 * (строка монархов под вариант) и листы видов для чужого движения (лепестки,
 * снег, огоньки, мотыльки). Своя картинка — тот же лист 128×128, что уедет в
 * ядро. Общее для нарисованного кадра (`lamp-scene.js`) и роя в кадре улицы из
 * игры (`lamp-swarm.js`): рой везде собран из одних и тех же листов.
 */

import {
  BUTTERFLY_SHEET,
  BUTTERFLY_VARIANTS,
  CUSTOM_TEXTURE,
  PARTICLE_LOOK_SHEETS,
  butterflySheet,
  lookSheet,
} from "@modovik/street-light-contract/lamps";
import { createTextureBank } from "../../../components/desktop/workshop/ptfx/ptfx-textures.js";
import { pngSize, setPngSource } from "../../../utils/png-source.js";

/**
 * Листы кадра. `onReady` зовётся, когда лист приехал или собрался: кадр надо
 * перерисовать.
 */
export function createLampSheets({ onReady = () => {} } = {}) {
  const bank = createTextureBank({ onReady: () => onReady() });
  let base = null;
  let picture = null;
  let wings = new Map();
  let wingsSource = "";

  /* Листы Astral из листов ядра игрока тем же кодом, что установщик. */
  function buildWings() {
    const sheets = base?.sheets || {};
    if (typeof Image === "undefined") return;
    const sources = [
      ...new Set([BUTTERFLY_SHEET.source, ...Object.values(PARTICLE_LOOK_SHEETS).map((item) => item.source)]),
    ].filter((name) => sheets[name]?.png);
    const key = sources.map((name) => pngSize(sheets[name].png)).join("|");
    if (!sources.length || wingsSource === key) return;
    wingsSource = key;
    const pixelsOf = (name) =>
      new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const scratch = document.createElement("canvas");
          scratch.width = image.naturalWidth;
          scratch.height = image.naturalHeight;
          const context = scratch.getContext("2d", { willReadFrequently: true });
          if (!context) return resolve(null);
          context.drawImage(image, 0, 0);
          resolve(context.getImageData(0, 0, scratch.width, scratch.height));
        };
        image.onerror = () => resolve(null);
        setPngSource(image, sheets[name].png);
      });
    const toCanvas = (sheet) => {
      const out = document.createElement("canvas");
      out.width = sheet.width;
      out.height = sheet.height;
      out
        .getContext("2d")
        ?.putImageData(new ImageData(new Uint8ClampedArray(sheet.rgba), sheet.width, sheet.height), 0, 0);
      return out;
    };
    Promise.all(sources.map(pixelsOf)).then((loaded) => {
      if (wingsSource !== key) return;
      const pixels = new Map(sources.map((name, index) => [name, loaded[index]]));
      const next = new Map();
      const insects = pixels.get(BUTTERFLY_SHEET.source);
      if (insects)
        for (const [id, variant] of Object.entries(BUTTERFLY_VARIANTS)) {
          const row = butterflySheet(insects.data, insects.width, insects.height, BUTTERFLY_SHEET, variant);
          next.set(variant.texture, { canvas: toCanvas(row), grid: { columns: BUTTERFLY_SHEET.columns, rows: 1 }, id });
        }
      for (const [id, spec] of Object.entries(PARTICLE_LOOK_SHEETS)) {
        const image = pixels.get(spec.source);
        if (!image) continue;
        const copy = Number.isInteger(spec.row) ? { rows: spec.sourceRows, row: spec.row } : {};
        const sheet = lookSheet(image.data, image.width, image.height, copy);
        next.set(spec.texture, { canvas: toCanvas(sheet), grid: { columns: spec.columns, rows: spec.rows }, id });
      }
      wings = next;
      onReady();
    });
  }

  return {
    /** База частиц из игры игрока: `{ model, sheets }` или `null`. */
    setBase(next) {
      base = next || null;
      bank.provideSheets(base?.sheets || null);
      wingsSource = "";
      wings = new Map();
      buildWings();
    },
    /** Своя картинка частиц: `{ key, canvas }` (лист 128×128) или `null`. */
    setPicture(next) {
      picture = next?.canvas ? next : null;
    },
    /** Лист по имени текстуры правила: `{ texture, ... }` или `null`, пока не приехал. */
    lookup(name) {
      if (!name) return null;
      const lower = String(name).toLowerCase();
      if (lower === CUSTOM_TEXTURE && picture?.canvas) return bank.canvas(`${lower}:${picture.key}`, picture.canvas, { columns: 1, rows: 1 });
      const own = wings.get(lower);
      if (own) return bank.canvas(lower, own.canvas, own.grid);
      return bank.game(lower);
    },
    get picture() {
      return picture;
    },
    dispose() {
      bank.dispose();
    },
  };
}
