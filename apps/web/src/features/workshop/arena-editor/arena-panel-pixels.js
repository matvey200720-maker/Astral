import {
  arenaPanelAtlas,
  arenaPanelFacePicture,
  arenaPanelPicture,
} from "@modovik/climb-contract/recolor/arenas";

// Дорога 1: живое полотно с гифкой даёт лист кадров (грани не читаются).
const atlasRoute = (task) => {
  if (!task.live) return null;
  const atlas = arenaPanelAtlas(task.look, task.picture, task.panel);
  return atlas ? { atlas } : null;
};

// Дорога 2: картинка полотна целиком, дальше по грани на каждую долю.
// Грань без crop получает тот же объект пикселей, нарезанная — новый.
const facesRoute = (task) => {
  const whole = arenaPanelPicture(task.look, task.picture, task.panel);
  const cutter = (face) => arenaPanelFacePicture(whole, face);
  return { faces: task.faces.map(cutter) };
};

export function panelJobPixels(task) {
  return atlasRoute(task) ?? facesRoute(task);
}

// Буферы ответа для переноса: лист главнее граней, повторы убираются по самому буферу.
export const panelJobBuffers = (answer) => {
  const sheets = answer.atlas ? [answer.atlas] : answer.faces;
  const unique = sheets.reduce((seen, { rgba }) => seen.add(rgba.buffer), new Set());
  return [...unique];
};
