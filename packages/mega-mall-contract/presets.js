import {
  deepFreeze,
  enumeration,
  exact,
  identifier,
  text,
} from "./validation.js";

const palette = (base, trim, metal, glass, emissive) => ({
  base,
  trim,
  metal,
  glass,
  emissive,
});

const BUILTIN_LICENSE = Object.freeze({
  basis: "license",
  author: "ASTRAL Design",
  source: "builtin:astral-mega-mall",
  license: "LicenseRef-ASTRAL-Builtin",
  attribution: "ASTRAL Design",
});

export const MEGA_MALL_PRESETS = deepFreeze(
  [
    {
      id: "vanilla-clean",
      label: "Vanilla Clean",
      description: "Чистый нейтральный фасад",
      palette: palette(
        "#c8c1b5ff",
        "#f1eee8ff",
        "#77736fff",
        "#52758ab8",
        "#f5d17dff",
      ),
    },
    {
      id: "graphite-minimal",
      label: "Graphite Minimal",
      description: "Графит, сталь и холодный свет",
      palette: palette(
        "#24282eff",
        "#d8dde3ff",
        "#717984ff",
        "#405e70b8",
        "#78d9ffff",
      ),
    },
    {
      id: "white-blue",
      label: "White & Blue",
      description: "Светлый фасад с синими акцентами",
      palette: palette(
        "#e9eef2ff",
        "#1769a8ff",
        "#8c9aa6ff",
        "#5591b8b8",
        "#66c7ffff",
      ),
    },
    {
      id: "neon-night",
      label: "Neon Night",
      description: "Тёмная база и контрастный неон",
      palette: palette(
        "#15131dff",
        "#7837d6ff",
        "#45414fff",
        "#352f55b8",
        "#ff4fd8ff",
      ),
    },
    {
      id: "street-art",
      label: "Generic Street Art",
      description: "Насыщенная уличная палитра без брендов",
      palette: palette(
        "#29333aff",
        "#ef476fff",
        "#72828cff",
        "#355b70b8",
        "#ffd166ff",
      ),
    },
    {
      id: "orange-industrial",
      label: "Orange Industrial",
      description: "Индустриальный серый и сигнальный оранжевый",
      palette: palette(
        "#353a3dff",
        "#ef7d23ff",
        "#858b8eff",
        "#4d6975b8",
        "#ffae54ff",
      ),
    },
  ].map((preset) => ({ ...preset, rights: BUILTIN_LICENSE })),
);

export function getMegaMallPreset(presetId) {
  return MEGA_MALL_PRESETS.find((preset) => preset.id === presetId) || null;
}

export function normalizeMegaMallPresetReference(value, path = "preset") {
  exact(value, ["id", "source", "license"], path);
  return deepFreeze({
    id: identifier(value.id, `${path}.id`),
    source: enumeration(value.source, ["builtin", "local"], `${path}.source`),
    license: text(value.license, `${path}.license`, 1, 120),
  });
}
