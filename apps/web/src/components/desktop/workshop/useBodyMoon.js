import { useEffect, useMemo, useState } from "react";
import { renderBody, renderStarfield } from "@modovik/timecycle";

/*
 * Луна-тело и свой лист звёзд в кадре (21.11.2026).
 *
 * Обе картинки рисуются тем же кодом, что ляжет в игру (`renderBody` 128×128 и `renderStarfield` 512×512 — столько у `moon-new` и
 * `starfield` в Legacy), и подменяют картинки игры в кадре: размер, место, яркость и часы идут от обычных луны и звёзд. Рисуется в окне,
 * а не в главном процессе: кадр должен успевать за ползунком, и картинка не должна ходить по каналу. С небольшой задержкой — пока
 * ползунок ещё двигают, готовится последняя.
 */

const MOON_SIZE = 128;
const STAR_SIZE = 512;
const DEBOUNCE_MS = 60;

/** Картинка по описанию: `null`, пока описания нет или окно не умеет её собрать. */
function useRendered(spec, render) {
  const [bitmap, setBitmap] = useState(null);
  const key = spec ? JSON.stringify(spec) : "";

  useEffect(() => {
    if (!spec || typeof createImageBitmap !== "function" || typeof ImageData === "undefined") {
      setBitmap(null);
      return undefined;
    }
    let cancelled = false;
    let made = null;
    const timer = setTimeout(() => {
      try {
        const image = render(spec);
        createImageBitmap(new ImageData(image.rgba, image.width, image.height), { premultiplyAlpha: "none" })
          .then((result) => {
            if (cancelled) {
              result.close?.();
              return;
            }
            made = result;
            setBitmap(result);
          })
          .catch(() => {
            if (!cancelled) setBitmap(null);
          });
      } catch {
        if (!cancelled) setBitmap(null);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      made?.close?.();
    };
    // Описание целиком — в `key`: объект приходит новый на каждый разбор вида.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return spec ? bitmap : null;
}

/*
 * Настоящая Луна и настоящее небо (карта и кусок звёздного неба NASA) берутся из `sky-assets.js` — отдельного модуля на 350 КБ, он грузится
 * только тогда, когда нужен, и один раз. Пока не загрузился (или не разобрался), рисуется нарисованное; как только готов — картинка перерисуется.
 */
function useSkyAssets(needed) {
  const [assets, setAssets] = useState(null);
  useEffect(() => {
    if (!needed) return undefined;
    let cancelled = false;
    import("@modovik/timecycle/sky-assets.js")
      .then((module) => module.loadSkyAssets())
      .then((loaded) => {
        if (!cancelled) setAssets(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needed]);
  return needed ? assets : null;
}

export default function useBodyMoon(images, body, sheet = null) {
  const assets = useSkyAssets(body?.kind === "moon" || sheet?.real === true);
  const ready = Boolean(assets);
  /* Описание включает «карта готова»: ключ меняется, и картинка перерисовывается по настоящей карте. */
  const moon = useRendered(body ? { body, ready } : null, ({ body: wanted }) =>
    renderBody(wanted, { size: MOON_SIZE, maps: assets?.moon ? { moon: assets.moon } : null }),
  );
  const starfield = useRendered(sheet ? { sheet, ready } : null, ({ sheet: wanted }) =>
    renderStarfield(wanted, { size: STAR_SIZE, tile: assets?.starTile ?? null }),
  );
  return useMemo(() => {
    if (!moon && !starfield) return images;
    return { ...(images || {}), ...(moon ? { moon } : {}), ...(starfield ? { starfield } : {}) };
  }, [images, moon, starfield]);
}
