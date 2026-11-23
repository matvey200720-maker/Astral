import { atlasSize, normalizeAtlas } from "@modovik/vector-map";

const ZOOM_FLOOR = 1e-6;
const CENTRE_DEFAULT = 0.5;
const ZOOM_DEFAULT = 1;

// Умолчание только для undefined: null остаётся null (как у значений параметров по умолчанию).
const orDefault = (value, fallback) => (value === undefined ? fallback : value);

// Размеры мира в единицах карты: [ширина, высота].
const worldExtents = (atlas) => {
  const { width, height } = atlasSize(normalizeAtlas(atlas));
  return [width, height];
};

export const mapView = ({ width, height, atlas, centerU, centerV, zoom }) => {
  const [worldWidth, worldHeight] = worldExtents(atlas);
  const axes = [
    [worldWidth, width],
    [worldHeight, height],
  ];
  const fit = Math.min.apply(null, axes.map(([ground, canvas]) => canvas / ground));
  const power = Math.max(ZOOM_FLOOR, orDefault(zoom, ZOOM_DEFAULT));

  // Растяжение по осям: размер мира на холсте, удвоенный, к размеру холста (без знака).
  const stretchOf = ([ground, canvas]) => (2 * (ground * fit * power)) / canvas;
  const [stretchU, stretchV] = axes.map(stretchOf);
  const shiftU = orDefault(centerU, CENTRE_DEFAULT);
  const shiftV = orDefault(centerV, CENTRE_DEFAULT);

  const view = { sx: stretchU };
  view.sy = -stretchV;
  view.ox = -shiftU * stretchU;
  view.oy = shiftV * stretchV;
  return view;
};
