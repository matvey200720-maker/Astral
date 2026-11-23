/*
 * Картинка элемента зала для плитки (задача 10Б ТЗ 18.10.2026): у «Монитор игрока 2…13» и других экранов
 * плитка была серой, пока у экрана нет своего вида, — а экран в зале что-то показывает. Здесь берётся
 * то же, что рисует кадр: лист сцены (`asset.materials[].name` → `asset.textures[слот]`, тот же ключ кэша
 * `scene-textures.js`, лист второй раз не читается) и в нём остров полотна (`panel.island`) — вырезка
 * в маленькую картинку.
 *
 * Чистая часть (`elementPictureSource`) не знает ни холста, ни React: её проверяет тест на всех экранах зала.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { arenaPlaces, arenaServerInventory } from "@modovik/climb-contract/recolor/arenas";
import { loadSceneImage, textureKey } from "../model-stage/scene-textures.js";

/** Сцена кадра арены (`asset`) для плиток инспектора: её держит студия, плитки читают отсюда. */
export const ArenaSceneContext = createContext(null);

/* Сторона вырезки плитки, px: плитка узкая (28 px по высоте, до 150 по ширине), с запасом на плотный экран. */
const THUMB_LONG_SIDE = 160;

/*
 * Откуда брать картинку элемента: `{ entry, rect, name }` — запись листа в сцене и прямоугольник острова в долях
 * листа (`null` — лист целиком) — или `null`: элемент без листа в этой сцене (лист рисует другая сцена, элемент
 * без полотна), плитка остаётся пустой.
 */
export function elementPictureSource(server, asset, section, element) {
  if (!asset || !element) return null;
  const place = arenaPlaces(server, section).find((item) => item.id === element.place);
  const name = element.panel?.texture || element.texture || place?.textures?.[0] || "";
  if (!name) return null;
  const material = (asset.materials || []).find((item) => item.name === name && Number.isInteger(item.texture));
  const entry = material ? asset.textures?.[material.texture] : null;
  if (!entry) return null;
  const records = (arenaServerInventory(server)?.textures || []).filter((item) => item.name === name && item.islands?.length);
  const record = records.find((item) => item.group === section) || records[0] || null;
  /* Номер острова: у полотна — его, у элемента-куска места — первый из его островов; у листа целиком острова нет. */
  const index = Number.isInteger(element.panel?.island) && element.panel.island >= 0 ? element.panel.island : element.islands?.[0];
  const rect = record && Number.isInteger(index) ? record.islands[index]?.rect || null : null;
  return { entry, rect: rect && rect[2] > rect[0] && rect[3] > rect[1] ? rect : null, name };
}

const pictures = new Map();

/* Вырезка острова из листа в blob-картинку; `null`, если холста нет (тесты без canvas) или лист не пришёл. */
async function cut(source) {
  const image = await loadSceneImage(source.entry, 512);
  if (!image || typeof document === "undefined") return null;
  const [u0, v0, u1, v1] = source.rect || [0, 0, 1, 1];
  /* Развёртка игры: v растёт вниз, первая строка картинки — верх листа (как у `texture.flipY = false` в кадре). */
  const sx = Math.max(0, Math.floor(u0 * image.width));
  const sy = Math.max(0, Math.floor(v0 * image.height));
  const sw = Math.max(1, Math.min(image.width - sx, Math.ceil((u1 - u0) * image.width)));
  const sh = Math.max(1, Math.min(image.height - sy, Math.ceil((v1 - v0) * image.height)));
  const scale = Math.min(1, THUMB_LONG_SIDE / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext?.("2d");
  if (!context) return null;
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob(resolve, "image/webp", 0.8);
    else resolve(null);
  });
  return blob ? URL.createObjectURL(blob) : null;
}

/** Адрес картинки элемента (blob) для плитки; `""`, пока вырезка не готова или картинки у элемента нет. */
export function useElementPicture(server, section, element) {
  const asset = useContext(ArenaSceneContext);
  const [url, setUrl] = useState("");
  const source = elementPictureSource(server, asset, section, element);
  const key = source ? `${textureKey(source.entry, 512)}|${source.rect ? source.rect.join(",") : "all"}` : "";
  useEffect(() => {
    if (!key) {
      setUrl("");
      return undefined;
    }
    let live = true;
    let promise = pictures.get(key);
    if (!promise) {
      promise = cut(source).catch(() => null);
      pictures.set(key, promise);
      /* Неудача (лист ещё не приехал) в кэше не остаётся: следующая плитка спросит заново. */
      promise.then((value) => {
        if (!value && pictures.get(key) === promise) pictures.delete(key);
      });
    }
    promise.then((value) => live && setUrl(value || ""));
    return () => {
      live = false;
    };
    // `source` целиком определяется ключом: лист и остров те же — вырезка та же.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}
