export function renderFilteredWorkshopPreview(source, filter) {
  if (!source || !filter) return Promise.resolve(source);
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = Math.min(1, 1200 / Math.max(1, longestEdge));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(source);
        return;
      }
      context.filter = filter;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });
}

const workshopImagePreloadCache = new globalThis.Map();

export function preloadWorkshopImage(source) {
  if (!source || typeof Image === "undefined") return Promise.resolve(source);
  if (workshopImagePreloadCache.has(source)) {
    return workshopImagePreloadCache.get(source);
  }

  const preload = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try {
        await image.decode?.();
      } catch {
        // The decoded bitmap is still usable when decode() is unavailable.
      }
      resolve(source);
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });

  workshopImagePreloadCache.set(source, preload);
  return preload;
}

/*
 * Открыть страницу сверху, а не там, где человек бросил полку.
 *
 * `scrollTo` есть не везде: в jsdom его у элемента нет вовсе, и вызов ронял
 * весь обработчик нажатия — страница не открывалась, а прокрутка была в нём
 * делом десятым.
 */
export function scrollWorkshopSurfaceToTop() {
  for (const selector of [".desktop-main", ".catalog-v3"]) {
    const surface = document.querySelector(selector);
    if (typeof surface?.scrollTo === "function")
      surface.scrollTo({ top: 0, left: 0 });
  }
}
