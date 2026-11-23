import { useEffect, useRef, useState } from "react";

const TILE_TYPE = "image/png";
const DENSITY_CAP = 2;

// Адрес data: строит FileReader, а не URL.createObjectURL: объектный адрес держит блоб
// в памяти до отзыва, а кэш плиток ничего не отзывает.
const readDataUrl = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });

// Способы закодировать холст; первый подходящий побеждает
const ENCODERS = [
  [
    (canvas) => typeof canvas.toBlob === "function" && typeof FileReader === "function",
    (canvas, done) => {
      canvas.toBlob((blob) => {
        (blob ? readDataUrl(blob) : Promise.resolve("")).then(done);
      }, TILE_TYPE);
    },
  ],
  [
    () => true,
    (canvas, done) => done((typeof canvas.toDataURL === "function" && canvas.toDataURL()) || ""),
  ],
];

export const encodeTile = (canvas, done) => {
  if (!canvas) return done("");
  const [, encode] = ENCODERS.find(([fits]) => fits(canvas));
  return encode(canvas, done);
};

const screenDensity = () => Math.min(DENSITY_CAP, globalThis.devicePixelRatio || 1);

export const tileCanvas = (width, height, paint) => {
  if (!globalThis.document) return null;
  const scale = screenDensity();
  const canvas = Object.assign(document.createElement("canvas"), { width: width * scale, height: height * scale });
  const context = canvas.getContext("2d");
  if (context) {
    context.setTransform(scale, 0, 0, scale, 0, 0);
    paint(context);
  }
  return context ? canvas : null;
};

const tileKey = (key, id) => `${key}|${id}`;
const hasTile = (cache, key, id) => cache.has(tileKey(key, id));
const readTiles = (ids, key, cache) =>
  ids.reduce((tiles, id) => tiles.set(id, cache.get(tileKey(key, id)) ?? ""), new Map());

/**
 * Эстафета «одна плитка за таймер»: окно не замирает между плитками. Кодирование,
 * которое уже идёт, доигрывает после остановки, но его результат отбрасывается.
 */
class TileRelay {
  constructor(queue, work) {
    this.queue = queue;
    this.work = work;
    this.alive = true;
    this.handle = null;
    this.arm();
  }

  arm() {
    this.handle = setTimeout(() => this.advance(), 0);
  }

  advance() {
    if (!this.alive || this.queue.length === 0) return;
    this.work(this.queue.shift(), (effect) => {
      if (!this.alive) return;
      effect();
      this.arm();
    });
  }

  stop() {
    this.alive = false;
    clearTimeout(this.handle);
  }
}

function openRelay(key, cache, latest, setTiles) {
  const { ids } = latest.current;
  setTiles(readTiles(ids, key, cache));
  const relay = new TileRelay(
    ids.filter((id) => !hasTile(cache, key, id)),
    (id, land) => {
      const { paint: draw } = latest.current;
      encodeTile(draw(id), (href) =>
        land(() => {
          cache.set(tileKey(key, id), href);
          setTiles((prev) => new Map([...prev, [id, href]]));
        }),
      );
    },
  );
  return () => relay.stop();
}

export const usePresetTiles = (ids, key, paint, cache) => {
  const [tiles, setTiles] = useState(() => readTiles(ids, key, cache));
  const latest = useRef({ ids, paint });

  useEffect(() => {
    latest.current = { ids, paint };
  });

  // Набор плиток у полки постоянный, поэтому эффект зависит только от ключа и кэша
  useEffect(() => (key ? openRelay(key, cache, latest, setTiles) : undefined), [cache, key]);

  return tiles;
};
