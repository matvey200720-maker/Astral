import { localizedText } from "@modovik/optimizer";
import { normalizeOptimizationDomain } from "@modovik/optimizer/bundle-domain.js";
import { OPTIMIZATION_FPS, OPTIMIZATION_LAYER_MAP } from "@modovik/optimizer/layers.js";
import { optimizationCardOf, optimizationCardShotFiles, optimizationPartShotFiles } from "@modovik/optimizer/cards.js";

// Вид правки → полка мастерской, чья обложка подходит части.
const COVER_SLOT_OF = new Map(
  "decals:hit-effects screen:screen-hits explosions:fire-explosions weather:timecycle clouds:timecycle grass:vegetation".split(" ").map((pair) => pair.split(":")),
);

// Слои, которые видны на общем кадре карточки (у остальных слоёв без своего кадра показывать нечего).
const VISIBLE_ON_CARD_SHOT = new Map([
  ["effects", ["decals"]],
  ["vegetation", ["grass", "lawn-grass"]],
]);

const orNothing = (read) => {
  try {
    return read();
  } catch {
    return null;
  }
};

export const optimizationPart = (mod) => {
  if (mod?.catalogSlot !== "optimization" && mod?.category !== "optimization") return null;
  const block = orNothing(() => normalizeOptimizationDomain(mod.domain?.optimization));
  return { kind: block?.kind ?? "", layers: [...(block?.layers ?? [])], facts: [...(block?.facts ?? [])] };
};

export const optimizationCoverSlot = (mod) => COVER_SLOT_OF.get(optimizationPart(mod)?.kind) ?? "";

export const optimizationLayerText = (layerId, locale = "ru") => {
  const layer = OPTIMIZATION_LAYER_MAP[layerId];
  if (!layer) return null;
  const words = (field) => localizedText(field, locale);
  return { id: layerId, title: words(layer.title), summary: words(layer.summary), detail: words(layer.detail), fps: words(OPTIMIZATION_FPS[layer.fps]) };
};

// Кадр «до/после» одного слоя: свой кадр части, а без него — общий кадр карточки, если слой на нём виден.
const shotOfLayer = (layer, locale) => {
  const card = optimizationCardOf(layer);
  if (!card) return null;
  const own = card.partShots?.[layer];
  if (!own && !VISIBLE_ON_CARD_SHOT.get(card.id)?.includes(layer)) return null;
  const files = own ? optimizationPartShotFiles(card.id, layer) : optimizationCardShotFiles(card.id);
  return { key: files.before, files, title: localizedText(card.title, locale), caption: localizedText(own ? own.shot : card.shot, locale) };
};

export const optimizationShotsFor = (layers = [], locale = "ru") => {
  const found = [...layers].map((layer) => shotOfLayer(layer, locale)).filter(Boolean);
  return found.filter((shot, at) => found.findIndex((other) => other.key === shot.key) === at);
};
