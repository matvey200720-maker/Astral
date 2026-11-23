import {
  applyWorldMapTemplate,
  createDefaultWorldMap,
  MAP_TEMPLATE_CARD_RECT,
  WORLD_MAP_TEMPLATES,
} from "@modovik/vector-map";
import { useEffect, useState } from "react";

const THUMB = { width: 320, height: 200, releaseMs: 1500 };

const revokeUrl = (href) => URL.revokeObjectURL(href);

// Ссылка отпускается с запасом: карточка может ещё дорисовывать картинку.
const releaseLater = (href) => void setTimeout(revokeUrl, THUMB.releaseMs, href);

// Подложка миниатюры шаблона: каждый раз свежая копия, векторная.
function thumbBase(id) {
  const { base } = applyWorldMapTemplate(createDefaultWorldMap(), id);
  return { ...base, source: "game", render: "vector" };
}

// Книга миниатюр одного хука: что показано, что посчитано для нынешней геометрии.
class ThumbBook {
  shown = new Map();
  fresh = new Set();
  geometry = undefined;
  atlas = undefined;

  constructor(setThumbs) {
    this.show = (id, href) => setThumbs((before) => Object.assign({}, before, { [id]: href }));
  }

  // Новая геометрия или атлас делают всё посчитанное устаревшим; показанное остаётся до замены.
  track(geometry, atlas) {
    if (this.geometry === geometry && this.atlas === atlas) return;
    this.fresh.clear();
    this.geometry = geometry;
    this.atlas = atlas;
  }

  adopt(id, href) {
    const old = this.shown.get(id);
    this.shown.set(id, href);
    this.fresh.add(id);
    if (old) releaseLater(old);
    this.show(id, href);
  }

  // Считает по одной в порядке каталога; ушедший эффект отпускает пришедшую ссылку сразу.
  async paint(processor, wanted, signal) {
    for (const { id } of WORLD_MAP_TEMPLATES) {
      if (!wanted.has(id) || this.fresh.has(id)) continue;
      const answer = await processor
        .detail(thumbBase(id), MAP_TEMPLATE_CARD_RECT, THUMB.width, THUMB.height)
        .catch(() => null);
      const href = answer?.href;
      if (signal.aborted) {
        if (href) URL.revokeObjectURL(href);
        return;
      }
      if (href) this.adopt(id, href);
    }
  }

  release() {
    this.shown.forEach(releaseLater);
    this.shown.clear();
  }
}

const useStyleThumbs = (processor, geometry, atlas, enabled, ids = ["original"]) => {
  const [thumbs, setThumbs] = useState({});
  const [book] = useState(() => new ThumbBook(setThumbs));
  const idsKey = ids.join(",");

  useEffect(() => {
    book.track(geometry, atlas);
    if (!(enabled && geometry && processor)) return undefined;
    const abort = new AbortController();
    book.paint(processor, new Set(idsKey.split(",")), abort.signal);
    return () => abort.abort();
  }, [book, enabled, geometry, atlas, processor, idsKey]);

  useEffect(() => () => book.release(), [book]);

  return thumbs;
};

export default useStyleThumbs;
