/*
 * Один экран игрока во всех редакторах HUD (ТЗ H1, 14.11.2026): ответ главного процесса одним запросом, строка «Экран игры»,
 * кадр монитора с растяжением и форма окна мини-карты. Редакторы берут отсюда, а не читают настройки игры каждый сам.
 */

export {
  loadGameScreen,
  refreshGameScreen,
  resetGameScreen,
  useGameScreen,
  useGameScreenInfo,
  gameAspectLabel,
} from "./useGameScreen.js";
export {
  DEFAULT_SCREEN_FORM,
  SCREEN_FORM_CHOICES,
  frameGameWidth,
  gameScreenForm,
  resolveScreenView,
} from "./game-screen-view.js";
export { default as GameScreenFrame } from "./GameScreenFrame.jsx";
export { default as GameScreenLine } from "./GameScreenLine.jsx";
export {
  PreviewOnlyList,
  PreviewOnlyMark,
  previewOnlyKeys,
  previewOnlyLabel,
} from "./PreviewOnly.jsx";
export {
  minimapScreenFormPlan,
  minimapShownConfig,
  minimapWithMonitor,
  minimapWithScreenForm,
  minimapWithoutMonitor,
  projectScreenInfo,
  viewportFollowsGame,
} from "./minimap-viewport.js";
