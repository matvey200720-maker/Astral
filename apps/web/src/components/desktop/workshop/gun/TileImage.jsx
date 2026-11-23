import { createElement as h, useEffect, useState } from "react";
import { coverThumbUrl, coverThumbWidthAt } from "../../../../utils/cover-thumb.js";

/*
 * Картинка плитки «Моделей» оружия и «Вещей» одежды (22.11.2026, снимок владельца: плитки в рамке, но без картинки).
 *
 * Прежде плитка рисовала обложку голым `<img loading="lazy">` по адресу мода: оригинал 1200 × 800 (медиана 263 КБ) ради плитки в 100–150 px, и ни слова на отказе — склад
 * временами не отвечает или отвечает 429 (`limit_conn`), картинка не приходила, а на её месте оставалась пустая рамка.
 * Теперь:
 *  - облачная обложка просится уменьшенной по ширине плитки (`?w=`, ряд тот же, что у карточек каталога, `cover-thumb.js`); прочие адреса (снимки студии, кадры поставки) — как есть;
 *  - пока картинка не пришла и после отказа стоит заглушка-силуэт плитки (`blank`), а не пустое место;
 *  - отказ — два повтора с паузой 1,5 и 3 с (склад мог просто занят); после них заглушка остаётся без «занято».
 */

const RETRIES = 2;
const RETRY_MS = 1500;
/** Ширина плитки в css px с запасом: из ряда ширин берётся наименьшая, которой хватает на этом экране. */
const TILE_CSS_WIDTH = 160;

export const tileSource = (src) => coverThumbUrl(src, coverThumbWidthAt(TILE_CSS_WIDTH));

/**
 * `src` — адрес картинки, `blank({ retrying })` — разметка заглушки плитки: `retrying` — ещё будет повтор. Вызывающий ставит `key={src}`: другой адрес — новая картинка и новые попытки.
 */
export default function TileImage({ src, blank }) {
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!broken || attempt >= RETRIES) return undefined;
    const timer = window.setTimeout(() => {
      setAttempt((value) => value + 1);
      setBroken(false);
    }, RETRY_MS * (attempt + 1));
    return () => window.clearTimeout(timer);
  }, [broken, attempt]);
  if (broken) return blank({ retrying: attempt < RETRIES });
  /* Новая попытка — новый элемент (`key`): браузер заново просит картинку, а не берёт отказ из памяти. */
  return h("img", { key: attempt, src: tileSource(src), alt: "", loading: "lazy", decoding: "async", draggable: "false", onError: () => setBroken(true) });
}
