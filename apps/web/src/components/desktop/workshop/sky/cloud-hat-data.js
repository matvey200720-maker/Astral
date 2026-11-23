/*
 * Облачные шапки игрока в окне: модели и листы для кадра неба.
 *
 * Опись (`readCloudHats`) приходит одним ответом — вершины в base64, по
 * геометрии на материал. Здесь она раскладывается в типизированные массивы
 * один раз на папку игры, а листы грузятся по имени, когда их шапку
 * показывают: у шапки четыре-шесть листов, у всей игры — полсотни.
 *
 * Листы — данные, а не картинки: плотность в зелёном канале, нормали в
 * красном и зелёном. Поэтому они декодируются без премультипликации и без
 * цветового профиля — иначе браузер «поправил» бы числа, которые шейдер
 * читает как есть.
 */

import { useEffect, useState } from "react";
import { readCloudHatTexture, readCloudHats } from "../../../../api.js";

const manifests = new Map();
const textures = new Map();

function decode(base64, Type) {
  if (typeof base64 !== "string" || !base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  if (bytes.byteLength % Type.BYTES_PER_ELEMENT) return null;
  return new Type(bytes.buffer, 0, bytes.byteLength / Type.BYTES_PER_ELEMENT);
}

/* Сэмплер → лист, оба без регистра: в материалах «FINAL_nimbusclouds_AP»,
   в описи — «final_nimbusclouds_ap». */
const lowerEntries = (object) =>
  Object.fromEntries(
    Object.entries(object || {}).map(([key, value]) => [
      key.toLowerCase(),
      String(value).toLowerCase(),
    ]),
  );

function geometryOf(raw) {
  const count = Number(raw?.vertexCount) || 0;
  const position = decode(raw?.position, Float32Array);
  const normal = decode(raw?.normal, Float32Array);
  const tangent = decode(raw?.tangent, Float32Array);
  const uv = decode(raw?.uv, Float32Array);
  const colour = decode(raw?.colour, Uint8Array);
  const index = decode(raw?.index, Uint16Array);
  const complete =
    count > 0 &&
    position?.length === count * 3 &&
    normal?.length === count * 3 &&
    tangent?.length === count * 4 &&
    uv?.length === count * 2 &&
    colour?.length === count * 4 &&
    index?.length > 0;
  if (!complete) return null;
  return {
    vertexCount: count,
    position,
    normal,
    tangent,
    uv,
    colour,
    index,
    textures: lowerEntries(raw.textures),
    parameters: raw.parameters || {},
    /* Каким шейдером игра рисует геометрию (joaat `clouds_*.sps`): у
       `clouds_fast` и `clouds_soft` своя, простая формула плотности. */
    shader: Number(raw.shader) >>> 0,
  };
}

/** Опись → модели по имени (без регистра). Битые геометрии отбрасываются. */
export function decodeCloudHatManifest(manifest) {
  const drawables = new Map();
  for (const [name, drawable] of Object.entries(manifest?.drawables || {})) {
    const geometries = (drawable?.geometries || [])
      .map(geometryOf)
      .filter(Boolean);
    if (geometries.length) drawables.set(name.toLowerCase(), { name, geometries });
  }
  const sheets = new Set(
    Object.keys(manifest?.textures || {}).map((name) => name.toLowerCase()),
  );
  return { drawables, sheets };
}

const rootKey = (gameRoot) => String(gameRoot || "").toLowerCase();

/** Модели шапок этой установки; `null`, когда их взять неоткуда. */
export function loadCloudHats(gameRoot) {
  const key = rootKey(gameRoot);
  if (!manifests.has(key)) {
    const pending = readCloudHats({ gameRoot })
      .then((result) => (result?.manifest ? decodeCloudHatManifest(result.manifest) : null))
      .catch(() => null);
    manifests.set(key, pending);
    /* Неудача не запоминается навсегда: игру могли подключить позже. */
    pending.then((value) => {
      if (!value) manifests.delete(key);
    });
  }
  return manifests.get(key);
}

/**
 * То же, но отказ не глотается: печь обложек не может снять небо без облаков игры (кадр с процедурными облаками — не кадр игры). Кэш не трогает.
 * Не прочиталось — ошибка с текстом хозяина чтения (в нём имя архива), а не `null`.
 */
export async function loadCloudHatsOrThrow(gameRoot) {
  const result = await readCloudHats({ gameRoot });
  if (!result?.manifest) throw new Error("облачные шапки игры не прочитаны: чтение игры не ответило");
  const hats = decodeCloudHatManifest(result.manifest);
  if (!hats?.drawables?.size) throw new Error("в архивах игры нет облачных шапок");
  return hats;
}

/** Лист шапки по имени, без глотания отказа (см. `loadCloudHatsOrThrow`). */
export async function loadCloudHatSheetOrThrow(gameRoot, name) {
  const bytes = await readCloudHatTexture({ gameRoot, name: String(name || "").toLowerCase() });
  if (!bytes) throw new Error(`лист облаков «${name}» не прочитан`);
  return createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
}

/** Лист по имени — `ImageBitmap` с сырыми каналами или `null`. */
export function loadCloudHatSheet(gameRoot, name) {
  const sheet = String(name || "").toLowerCase();
  const key = `${rootKey(gameRoot)}\n${sheet}`;
  if (!textures.has(key)) {
    const pending = readCloudHatTexture({ gameRoot, name: sheet })
      .then((bytes) =>
        bytes
          ? createImageBitmap(new Blob([bytes], { type: "image/png" }), {
              premultiplyAlpha: "none",
              colorSpaceConversion: "none",
            })
          : null,
      )
      .catch(() => null);
    textures.set(key, pending);
    pending.then((value) => {
      if (!value) textures.delete(key);
    });
  }
  return textures.get(key);
}

/** Листы, которые нужны слоям шапки: имя → сэмплеры, где он стоит. */
export function sheetsForLayers(hats, layerFiles) {
  const names = new Set();
  for (const file of layerFiles || []) {
    const drawable = hats?.drawables.get(String(file).toLowerCase());
    for (const geometry of drawable?.geometries || [])
      for (const sheet of Object.values(geometry.textures))
        if (hats.sheets.has(sheet)) names.add(sheet);
  }
  return [...names];
}

/**
 * Листы для слоёв шапки. Загруженные копятся: вернуться к прежним облакам
 * должно быть мгновенно, а не ещё одним походом в архив.
 */
export function useCloudHatSheets(gameRoot, hats, layerFiles) {
  const [sheets, setSheets] = useState(() => new Map());
  const wanted = sheetsForLayers(hats, layerFiles).join("\n");
  useEffect(() => {
    setSheets(new Map());
  }, [gameRoot, hats]);
  useEffect(() => {
    if (!hats || !wanted) return undefined;
    let alive = true;
    for (const name of wanted.split("\n"))
      loadCloudHatSheet(gameRoot, name).then((image) => {
        if (!alive || !image) return;
        setSheets((current) => {
          if (current.get(name) === image) return current;
          const next = new Map(current);
          next.set(name, image);
          return next;
        });
      });
    return () => {
      alive = false;
    };
  }, [gameRoot, hats, wanted]);
  return sheets;
}

/** Модели шапок для кадра: пока грузятся или их нет — `null`. */
export function useCloudHats(gameRoot) {
  const [hats, setHats] = useState(null);
  useEffect(() => {
    let alive = true;
    setHats(null);
    if (!gameRoot) return undefined;
    loadCloudHats(gameRoot).then((value) => {
      if (alive) setHats(value);
    });
    return () => {
      alive = false;
    };
  }, [gameRoot]);
  return hats;
}
