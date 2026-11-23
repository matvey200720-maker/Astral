/*
 * Листы частиц для рисовальщика: текстуры GPU по имени текстуры ядра.
 *
 * Имена — те же, что у правил в ядре игрока. Листы игры приходят с базой
 * эффектов (`impact.sheets`: PNG, ужатый до превью, и сетка кадров из
 * ptxclipregions.dat). Нейтральная копия листа кровяной пыли
 * (`astral_impact_blood_spray`) собирается так же, как её кладёт в ядро
 * установщик: яркость — старший канал оригинала. Свои картинки и листы брызг
 * окно рисует само — холстами, из которых установщик сделает DDS.
 *
 * Пиксели загружаются без перевода цвета: шейдер частиц, как в игре, сам
 * возводит цвет текстуры в квадрат.
 */

import * as THREE from "three";
import { setPngSource } from "../../../../utils/png-source.js";

function configure(texture) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/* Серая копия: та же форма, яркость — старший канал (как `neutralCopy`). */
function neutralCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.max(data[index], data[index + 1], data[index + 2]);
    data[index] = data[index + 1] = data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * Банк текстур. `onReady` зовётся, когда очередной лист догрузился: сцена
 * рисует частицы без листа, пока его нет, и не должна ждать движения мыши.
 */
export function createTextureBank({ onReady = () => {} } = {}) {
  let sheets = new Map();
  const loaded = new Map();
  const canvases = new Map();

  /** Листы игры из базы: `{ имя: { png, columns, rows } }`. */
  function provideSheets(source) {
    sheets = new Map(
      Object.entries(source || {}).map(([name, sheet]) => [String(name).toLowerCase(), sheet]),
    );
    for (const entry of loaded.values()) entry.texture?.dispose();
    loaded.clear();
  }

  /** Лист игры (или его нейтральная копия) — `{ texture, columns, rows }` или `null`, пока грузится. */
  function game(name, { neutral = false } = {}) {
    const lower = String(name || "").toLowerCase();
    const source = sheets.get(lower);
    if (!source?.png) return null;
    const key = `${lower}:${neutral ? "n" : "c"}`;
    const known = loaded.get(key);
    if (known) return known.texture ? known : null;
    if (typeof Image === "undefined") return null;
    const entry = {
      texture: null,
      columns: Math.max(1, source.columns || 1),
      rows: Math.max(1, source.rows || 1),
    };
    loaded.set(key, entry);
    const image = new Image();
    image.onload = () => {
      entry.texture = configure(new THREE.Texture(neutral ? neutralCanvas(image) : image));
      onReady();
    };
    image.onerror = () => loaded.delete(key);
    setPngSource(image, source.png);
    return null;
  }

  /**
   * Свой холст (картинка слоя, нарисованный лист брызг) под ключом: тот же
   * холст — та же текстура; другой — новая.
   */
  function canvas(key, source, grid = { columns: 1, rows: 1 }) {
    if (!source) return null;
    const known = canvases.get(key);
    if (known?.source === source) return known;
    known?.texture?.dispose();
    const entry = {
      source,
      texture: configure(new THREE.CanvasTexture(source)),
      columns: Math.max(1, grid.columns || 1),
      rows: Math.max(1, grid.rows || 1),
    };
    canvases.set(key, entry);
    return entry;
  }

  function dispose() {
    for (const entry of loaded.values()) entry.texture?.dispose();
    for (const entry of canvases.values()) entry.texture?.dispose();
    loaded.clear();
    canvases.clear();
  }

  /** Сколько листов игры ещё грузится (кадр обложки ждёт их). */
  function pending() {
    let count = 0;
    for (const entry of loaded.values()) if (!entry.texture) count += 1;
    return count;
  }

  return { provideSheets, game, canvas, dispose, pending, get hasSheets() {
    return sheets.size > 0;
  } };
}
