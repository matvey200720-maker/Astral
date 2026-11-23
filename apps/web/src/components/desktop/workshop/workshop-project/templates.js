/*
 * Заготовки проекта: что подставляется в палитру и модули, когда набор
 * создают «тёмным», «соревновательным» или «под GTA IV». Значения здесь —
 * только отличия от значений модуля по умолчанию, остальное дособирает
 * createWorkshopProject.
 */

const PROJECT_TEMPLATES = {
  clean: {},
  dark: {
    palette: { accent: "#8792ff", secondary: "#5fc8c3", background: "#070b12" },
    modules: {
      minimap: { shape: "rounded", radius: 14, opacity: 88 },
      hud: { opacity: 88 },
    },
  },
  competitive: {
    palette: { accent: "#6d7cff", ally: "#63df91", enemy: "#ff516d" },
    modules: {
      minimap: { width: 230, height: 150, radius: 12, opacity: 100 },
      crosshair: {
        shape: "cross",
        gap: 5,
        length: 11,
        thickness: 2,
        dotSize: 2,
      },
      tracers: { type: "line", glow: 7, duration: 240 },
    },
  },
  cinematic: {
    palette: { accent: "#9d83ff", warning: "#ff9b58", glow: "#b36cff" },
    modules: {
      timecycle: {
        profile: "cinematic",
        saturation: 118,
        bloom: 42,
        fogDensity: 24,
      },
      "weapon-effects": { intensity: 160, glow: 72, smoke: 48 },
      weather: { profile: "cloudy", fog: 28 },
    },
  },
  realistic: {
    palette: { accent: "#759dcc", secondary: "#70b89d", warning: "#d7a86e" },
    modules: {
      timecycle: {
        profile: "realistic",
        saturation: 96,
        bloom: 12,
        fogDensity: 8,
      },
      weather: { profile: "clear", fog: 6 },
      tracers: { type: "line", glow: 4 },
    },
  },
  neon: {
    palette: {
      accent: "#7c73ff",
      secondary: "#25e0cb",
      enemy: "#ff3d79",
      glow: "#b64cff",
    },
    modules: {
      timecycle: {
        time: 23,
        profile: "neon",
        sky: "#171538",
        horizon: "#ba4cd6",
        bloom: 52,
      },
      tracers: {
        type: "neon",
        color: "#ff335f",
        endColor: "#8a5cff",
        glow: 28,
      },
      "weapon-effects": { flashColor: "#c54cff", glow: 82 },
    },
  },
  gta4: {
    palette: { accent: "#8da2a6", secondary: "#8f9e83", background: "#101415" },
    modules: {
      timecycle: {
        profile: "gta4",
        saturation: 62,
        sky: "#596b70",
        horizon: "#a19c78",
        fogDensity: 34,
        bloom: 9,
      },
      weather: { profile: "overcast", fog: 36 },
    },
  },
};

export { PROJECT_TEMPLATES };
