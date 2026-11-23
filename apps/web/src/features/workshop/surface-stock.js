import { useEffect, useRef, useState } from "react";

const ENCODING = { type: "image/webp", quality: 0.9 };

// Длинная сторона картинки в рамке: колонка 290 px, на плотном экране вдвое
export const SURFACE_STOCK_SIDE = 640;

const wholeSide = (value) => Math.max(1, Math.round(value));

export const surfaceCanvas = (width, height) => {
  if (!globalThis.document) return null;
  const canvas = Object.assign(document.createElement("canvas"), {
    width: wholeSide(width),
    height: wholeSide(height),
  });
  const context = canvas.getContext?.("2d");
  return context ? { canvas, context } : null;
};

// Холст нужного размера, на котором рисует draw(контекст, холст)
function drawOnto(width, height, draw) {
  const target = surfaceCanvas(width, height);
  if (!target) return null;
  draw(target.context, target.canvas);
  return target.canvas;
}

// Растр длиннее рамки ужимаем, короткий не растягиваем
function shrinkFactor({ width, height }) {
  const longest = Math.max(width, height);
  return longest > SURFACE_STOCK_SIDE ? SURFACE_STOCK_SIDE / longest : 1;
}

const sheetKind = (sheet) => {
  if (typeof sheet.toBlob === "function") return "ready";
  if (!sheet.width || !sheet.height) return "empty";
  return sheet.rgba ? "pixels" : "bitmap";
};

// Откуда взять холст для кодирования, смотря что вернул загрузчик листа
const CANVAS_BY_KIND = {
  ready: (sheet) => sheet,
  empty: () => null,
  pixels: (sheet) =>
    drawOnto(sheet.width, sheet.height, (context) => {
      const copy = new Uint8ClampedArray(sheet.rgba);
      context.putImageData(new ImageData(copy, sheet.width, sheet.height), 0, 0);
    }),
  bitmap: (sheet) => {
    const factor = shrinkFactor(sheet);
    return drawOnto(sheet.width * factor, sheet.height * factor, (context, canvas) => {
      context.drawImage(sheet, 0, 0, canvas.width, canvas.height);
    });
  },
};

const encodeCanvas = (canvas) =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, ENCODING.type, ENCODING.quality);
  });

/** Лист -> блоб; undefined, если ответ уже не нужен (ключ сменился или окно ушло). */
async function readStock(pickLoader, isCurrent) {
  await null;
  const loader = pickLoader();
  const sheet = typeof loader === "function" ? await loader() : null;
  if (!isCurrent()) return undefined;
  const canvas = sheet ? CANVAS_BY_KIND[sheetKind(sheet)](sheet) : null;
  const blob = canvas ? await encodeCanvas(canvas) : null;
  return isCurrent() ? { blob } : undefined;
}

/** Держатель показанного адреса: новый встаёт на место прежнего, прежний отзывается. */
function urlHolder(publish) {
  let held = "";
  const drop = () => {
    if (held) URL.revokeObjectURL(held);
  };
  return {
    replace(next) {
      drop();
      held = next;
      publish(next);
    },
    release: drop,
  };
}

export const useSurfaceStock = (load, key) => {
  const [href, setHref] = useState("");
  const [holder] = useState(() => urlHolder(setHref));
  const loaderRef = useRef(load);
  const epoch = useRef(0);

  useEffect(() => {
    loaderRef.current = load;
  });

  useEffect(() => holder.release, [holder]);

  useEffect(() => {
    if (!key) {
      holder.replace("");
      return undefined;
    }
    const mine = epoch.current;
    (async () => {
      try {
        const stock = await readStock(() => loaderRef.current, () => epoch.current === mine);
        if (stock) holder.replace(stock.blob ? URL.createObjectURL(stock.blob) : "");
      } catch {
        // лист не прочитан или цепочка сорвалась: прежний адрес остаётся
      }
    })();
    return () => {
      epoch.current += 1;
    };
  }, [holder, key]);

  return href;
};
