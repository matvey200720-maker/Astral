// Миниатюра плитки «Карта из мода» в «Виде карты»: вырезается один раз на
// ссылку на часть мода из уже нарисованного полного растра (Лос-Сантос, как на
// плитках паков). Без чтения пикселей: drawImage на малый холст и асинхронный toBlob.
import { MOD_PACK_TEMPLATE } from "@modovik/vector-map";
import { useEffect, useState } from "react";

const THUMB = Object.freeze({ width: 320, height: 200 });
// Кусок атласа с городом: доли ширины и высоты растра.
const CITY = Object.freeze({ left: 0.2, top: 0.7, width: 0.42 });

// Окно выреза в исходной картинке: x, y, ширина, высота (плитка 16 : 10).
const cityWindow = ({ width, height }) => {
  const span = width * CITY.width;
  return [width * CITY.left, height * CITY.top, span, (span * THUMB.height) / THUMB.width];
};

const blankThumb = () =>
  Object.assign(document.createElement("canvas"), { width: THUMB.width, height: THUMB.height });

// Холст с вырезкой города или null, если у холста нет 2d.
const paintCity = (bitmap) => {
  const canvas = blankThumb();
  const context = canvas.getContext("2d");
  context?.drawImage(bitmap, ...cityWindow(bitmap), 0, 0, THUMB.width, THUMB.height);
  return context ? canvas : null;
};

const webpBlobOf = (canvas) =>
  new Promise((done) => {
    canvas.toBlob(done, "image/webp", 0.86);
  });

// Ссылка на готовую миниатюру или null; картинка закрывается в любом исходе.
const cutCityThumb = async (rasterHref) => {
  const answer = await fetch(rasterHref);
  const bitmap = await createImageBitmap(await answer.blob());
  try {
    const canvas = paintCity(bitmap);
    const blob = canvas && (await webpBlobOf(canvas));
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    bitmap.close?.();
  }
};

// Адрес полного растра, если основа — шаблон «Карта из мода»; иначе null.
const fullRasterHref = (raster, base) => {
  const isModMap = base.source === "template" && base.templateId === MOD_PACK_TEMPLATE;
  return isModMap && raster?.quality === "full" ? raster.href : null;
};

const useModPackThumb = (raster, base, packKey) => {
  const [ready, setReady] = useState(null);
  const sourceHref = fullRasterHref(raster, base);
  const mustCut = Boolean(packKey) && ready?.key !== packKey;

  useEffect(() => {
    if (!sourceHref || !mustCut) return undefined;
    const run = { current: true };
    const accept = (href) => {
      if (!href) return;
      if (run.current) setReady({ key: packKey, href });
      else URL.revokeObjectURL(href);
    };
    cutCityThumb(sourceHref)
      .then(accept)
      .catch(() => undefined);
    return () => {
      run.current = false;
    };
  }, [sourceHref, mustCut, packKey]);

  // Прежняя ссылка отпускается, когда её заменили, и при размонтировании.
  useEffect(() => () => ready && URL.revokeObjectURL(ready.href), [ready]);

  const ownThumb = ready?.key === packKey;
  return ownThumb ? ready.href : null;
};

export { useModPackThumb };
